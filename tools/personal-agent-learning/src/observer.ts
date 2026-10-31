import { appendFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { AgentTraceRecorder, SqliteTraceStore } from '@saga/agent-tracing';
import type { AgentTokenUsage } from '@saga/agent-contracts';
import type { LearningConfig } from './config.js';
import {
  asRecord,
  byteLength,
  newId,
  nonNegative,
  safeKeys,
  stringValue,
} from './security.js';
import type { ObserverContext, Provider } from './types.js';

type CopilotEvent = {
  type?: unknown;
  data?: unknown;
  id?: unknown;
  timestamp?: unknown;
};

function recordTextSize(value: unknown): number | undefined {
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8');
  return byteLength(value);
}

function makeUsage(input: Record<string, unknown>, provider: Provider): AgentTokenUsage | undefined {
  const fields: Array<[keyof AgentTokenUsage, string]> = [
    ['inputTokens', 'inputTokens'],
    ['outputTokens', 'outputTokens'],
    ['totalTokens', 'totalTokens'],
    ['cachedInputTokens', provider === 'codebuddy' ? 'cacheReadTokens' : 'cachedInputTokens'],
    ['cacheWriteTokens', provider === 'codebuddy' ? 'cacheCreationTokens' : 'cacheWriteTokens'],
    ['reasoningTokens', 'reasoningTokens'],
    ['modelCalls', 'modelCalls'],
    ['premiumRequestCost', provider === 'codebuddy' ? 'premiumRequestCost' : 'cost'],
    ['totalNanoAiu', 'totalNanoAiu'],
  ];
  const usage: Record<string, unknown> = { source: 'provider-event' };
  for (const [target, source] of fields) {
    const value = nonNegative(input[source]);
    if (value !== undefined) usage[target] = Math.floor(value);
  }
  if (provider === 'codebuddy') {
    const totalCost = nonNegative(input.totalCostUsd);
    if (totalCost !== undefined) {
      usage.providerCost = totalCost;
      usage.providerCostUnit = 'USD';
    }
  }
  return Object.keys(usage).length > 1 ? usage as AgentTokenUsage : undefined;
}

export class AgentObserver {
  private readonly recorder: AgentTraceRecorder;
  private readonly eventDirectory: string;
  private pending: Promise<void> = Promise.resolve();
  private readonly failures: string[] = [];
  private closed = false;

  constructor(config: LearningConfig) {
    this.eventDirectory = config.eventDirectory;
    this.recorder = new AgentTraceRecorder(
      new SqliteTraceStore({ filename: config.traceDatabase }),
      { maxPayloadBytes: 16 * 1024, previewChars: 0, redactSecrets: true },
    );
  }

  createContext(input: {
    provider: Provider;
    agentId: string;
    model?: string;
    project?: string;
    taskType?: string;
    sessionId?: string;
    turnId?: string;
  }): ObserverContext {
    const turnId = input.turnId || newId('turn');
    const context = this.recorder.createContext({
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      agentId: input.agentId,
      turnId,
      correlationId: newId('corr'),
    });
    return {
      ...input,
      turnId,
      traceId: context.traceId,
      correlationId: context.correlationId ?? newId('corr'),
    };
  }

  private async archiveJsonl(saved: Awaited<ReturnType<AgentTraceRecorder['record']>>): Promise<void> {
    const day = saved.timestamp.slice(0, 10).split('-');
    const sessionKey = createHash('sha256')
      .update(saved.sessionId ?? saved.traceId)
      .digest('hex')
      .slice(0, 20);
    const directory = join(this.eventDirectory, ...day);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const filename = join(directory, sessionKey + '.jsonl');
    // Mirror the already bounded and redacted event, never the raw SDK payload.
    await appendFile(filename, JSON.stringify(saved) + '\\n', {
      encoding: 'utf8',
      flag: 'a',
      mode: 0o600,
    });
  }

  private enqueue(event: Parameters<AgentTraceRecorder['record']>[0]): void {
    if (this.closed) return;
    this.pending = this.pending
      .then(async () => {
        const saved = await this.recorder.record(event);
        await this.archiveJsonl(saved);
      })
      .catch((error: unknown) => {
        this.failures.push(error instanceof Error ? error.message : String(error));
      });
  }

  private base(context: ObserverContext, type: string, data: Record<string, unknown>, extra: {
    category?: string;
    status?: string;
    durationMs?: number;
    usage?: AgentTokenUsage;
  } = {}): Parameters<AgentTraceRecorder['record']>[0] {
    return {
      id: newId('trace'),
      timestamp: new Date().toISOString(),
      traceId: context.traceId,
      correlationId: context.correlationId,
      turnId: context.turnId,
      ...(context.sessionId ? { sessionId: context.sessionId } : {}),
      agentId: context.agentId,
      provider: context.provider,
      ...(context.model ? { model: context.model } : {}),
      category: extra.category ?? 'agent',
      type,
      ...(extra.status ? { status: extra.status } : {}),
      ...(extra.durationMs !== undefined ? { durationMs: extra.durationMs } : {}),
      ...(extra.usage ? { usage: extra.usage } : {}),
      data,
      metadata: {
        ...(context.project ? { project: context.project } : {}),
        ...(context.taskType ? { taskType: context.taskType } : {}),
        capturePolicy: 'metadata-only',
      },
    };
  }

  captureCopilotEvent(context: ObserverContext, raw: unknown): void {
    const event = raw as CopilotEvent;
    const type = stringValue(event?.type);
    const data = asRecord(event?.data);
    if (!type) return;

    // Deliberately omit assistant.reasoning_delta, prompt content, tool arguments and results.
    if (type === 'assistant.message_delta' || type === 'assistant.reasoning_delta') return;

    if (type === 'assistant.turn_start') {
      this.enqueue(this.base(context, 'assistant.turn.started', {}, { status: 'running' }));
      return;
    }
    if (type === 'assistant.turn_end') {
      this.enqueue(this.base(context, 'assistant.turn.ended', {
        turnId: stringValue(data.turnId) ?? context.turnId,
      }, { status: 'completed' }));
      return;
    }
    if (type === 'assistant.message') {
      const content = stringValue(data.content) ?? '';
      this.enqueue(this.base(context, 'assistant.message.completed', {
        chars: content.length,
        bytes: Buffer.byteLength(content, 'utf8'),
      }, { status: 'completed' }));
      return;
    }
    if (type === 'tool.execution_start') {
      const args = data.arguments;
      this.enqueue(this.base(context, 'tool.execution.started', {
        toolCallId: stringValue(data.toolCallId) ?? '',
        toolName: stringValue(data.toolName) ?? 'unknown',
        argumentKeys: safeKeys(args),
        argumentBytes: byteLength(args) ?? null,
      }, { category: 'tool', status: 'running' }));
      return;
    }
    if (type === 'tool.execution_progress') {
      this.enqueue(this.base(context, 'tool.execution.progress', {
        toolCallId: stringValue(data.toolCallId) ?? '',
        progressMessagePresent: Boolean(stringValue(data.progressMessage)),
      }, { category: 'tool', status: 'running' }));
      return;
    }
    if (type === 'tool.execution_complete') {
      const result = asRecord(data.result);
      const content = result.content;
      this.enqueue(this.base(context, 'tool.execution.completed', {
        toolCallId: stringValue(data.toolCallId) ?? '',
        success: data.success !== false,
        resultBytes: recordTextSize(content) ?? null,
        errorPresent: data.error !== undefined && data.error !== null,
      }, {
        category: 'tool',
        status: data.success === false ? 'failed' : 'completed',
        ...(nonNegative(data.durationMs) !== undefined ? { durationMs: nonNegative(data.durationMs)! } : {}),
      }));
      return;
    }
    if (type === 'assistant.usage') {
      const usage = makeUsage(data, 'copilot');
      this.enqueue(this.base(context, 'model.usage', {
        model: stringValue(data.model) ?? context.model ?? 'unknown',
        durationMs: nonNegative(data.duration),
        finishReason: stringValue(data.finishReason) ?? null,
      }, { category: 'model', status: 'completed', ...(nonNegative(data.duration) !== undefined ? { durationMs: nonNegative(data.duration)! } : {}), ...(usage ? { usage } : {}) }));
      return;
    }
    if (type === 'session.usage_info') {
      this.enqueue(this.base(context, 'session.context_usage', {
        currentTokens: nonNegative(data.currentTokens) ?? null,
        tokenLimit: nonNegative(data.tokenLimit) ?? null,
        messagesLength: nonNegative(data.messagesLength) ?? null,
      }, { category: 'context' }));
      return;
    }
    if (type === 'permission.requested') {
      const request = asRecord(data.permissionRequest);
      this.enqueue(this.base(context, 'permission.requested', {
        requestId: stringValue(data.requestId) ?? '',
        permissionKind: stringValue(request.kind) ?? 'unknown',
      }, { category: 'permission', status: 'pending' }));
    }
  }

  copilotHandlers(context: ObserverContext): { onEvent: (event: unknown) => void } {
    return { onEvent: (event) => this.captureCopilotEvent(context, event) };
  }

  captureCodeBuddyEvent(context: ObserverContext, raw: unknown): void {
    const event = asRecord(raw);
    const type = stringValue(event.type);
    if (!type) return;

    if (type === 'system') {
      const sessionId = stringValue(event.session_id);
      this.enqueue(this.base({ ...context, ...(sessionId ? { sessionId } : {}) }, 'session.started', {
        sessionId: sessionId ?? '',
      }, { category: 'session', status: 'started' }));
      return;
    }

    if (type === 'assistant') {
      const message = asRecord(event.message);
      const blocks = Array.isArray(message.content) ? message.content : [];
      const textChars = blocks.reduce((sum, block) => {
        const part = asRecord(block);
        return sum + (part.type === 'text' && typeof part.text === 'string' ? part.text.length : 0);
      }, 0);
      if (textChars > 0) {
        this.enqueue(this.base(context, 'assistant.message.completed', {
          chars: textChars,
        }, { status: 'completed' }));
      }
      for (const value of blocks) {
        const part = asRecord(value);
        if (part.type === 'thinking' || part.type === 'reasoning') continue;
        if (part.type === 'tool_use') {
          this.enqueue(this.base(context, 'tool.execution.started', {
            toolName: stringValue(part.name) ?? 'unknown',
            toolCallId: stringValue(part.id) ?? '',
            argumentKeys: safeKeys(part.input),
            argumentBytes: byteLength(part.input) ?? null,
          }, { category: 'tool', status: 'running' }));
        } else if (part.type === 'tool_result') {
          this.enqueue(this.base(context, 'tool.execution.completed', {
            toolName: stringValue(part.name) ?? 'unknown',
            success: part.is_error !== true && part.isError !== true && part.error === undefined,
            resultBytes: recordTextSize(part.content) ?? null,
            errorPresent: part.error !== undefined,
          }, {
            category: 'tool',
            status: part.is_error === true || part.isError === true ? 'failed' : 'completed',
          }));
        }
      }
      return;
    }

    if (type === 'result') {
      const usageRaw = asRecord(event.usage);
      const usage = makeUsage({
        inputTokens: usageRaw.input_tokens,
        outputTokens: usageRaw.output_tokens,
        cacheReadTokens: usageRaw.cache_read_input_tokens,
        cacheCreationTokens: usageRaw.cache_creation_input_tokens,
        totalCostUsd: event.total_cost_usd,
      }, 'codebuddy');
      const cost = nonNegative(event.total_cost_usd);
      this.enqueue(this.base(context, 'agent.result', {
        subtype: stringValue(event.subtype) ?? 'unknown',
        isError: event.is_error === true,
        durationMs: nonNegative(event.duration_ms) ?? null,
        turns: nonNegative(event.num_turns) ?? null,
        ...(cost !== undefined ? { totalCostUsd: cost } : {}),
      }, {
        category: 'agent',
        status: event.is_error === true || event.subtype !== 'success' ? 'failed' : 'completed',
        ...(nonNegative(event.duration_ms) !== undefined ? { durationMs: nonNegative(event.duration_ms)! } : {}),
        ...(usage ? { usage } : {}),
      }));
    }
  }

  codeBuddyHandlers(context: ObserverContext): {
    onEvent: (event: unknown) => void;
    onSessionId: (sessionId: string) => void;
  } {
    return {
      onEvent: (event) => this.captureCodeBuddyEvent(context, event),
      onSessionId: (sessionId) => {
        // The SDK returns the session id after query initialization. Do not expect it
        // to be available when the observer context is first constructed.
        this.captureSessionId(context, sessionId);
      },
    };
  }

  captureSessionId(context: ObserverContext, sessionId: string): void {
    this.enqueue(this.base({ ...context, sessionId }, 'session.id', {
      sessionId,
    }, { category: 'session', status: 'identified' }));
  }

  recordTurnResult(context: ObserverContext, result: unknown): void {
    const value = asRecord(result);
    const rawUsage = asRecord(value.usage);
    const usage = makeUsage(context.provider === 'copilot' ? rawUsage : {
      ...rawUsage,
      cacheReadTokens: rawUsage.cacheReadTokens,
      cacheCreationTokens: rawUsage.cacheCreationTokens,
      totalCostUsd: rawUsage.totalCostUsd,
    }, context.provider);
    this.enqueue(this.base(context, 'agent.turn.result', {
      textChars: typeof value.text === 'string' ? value.text.length : typeof value.content === 'string' ? value.content.length : 0,
      durationMs: nonNegative(value.durationMs) ?? null,
      messageCount: nonNegative(value.messageCount) ?? null,
      hasStructuredOutput: value.structuredOutput !== undefined,
    }, {
      category: 'agent',
      status: 'completed',
      durationMs: nonNegative(value.durationMs),
      ...(usage ? { usage } : {}),
    }));
  }

  async flush(): Promise<void> {
    await this.pending;
    if (this.failures.length) {
      const failures = this.failures.splice(0);
      throw new AggregateError(failures.map((message) => new Error(message)), '部分 Agent 事件未能写入本地轨迹数据库');
    }
  }

  async close(): Promise<void> {
    await this.flush();
    this.closed = true;
    await this.recorder.close();
  }
}
