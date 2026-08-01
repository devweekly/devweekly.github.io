// ===========================================================================
// pipeline-logger.mjs — Structured pipeline timing logger
//
// Records every stage and major operation with timestamps + duration,
// writes to .working/<repo>/pipeline-timeline.json for post-run debugging.
//
// Usage:
//   import { PipelineLogger } from "./pipeline-logger.mjs";
//   const logger = new PipelineLogger(workDir);
//   logger.start("Stage 1: Scan");
//   ... do work ...
//   logger.end("Stage 1: Scan");
//   logger.llm("buildRepositoryModel", "start");
//   ... llm call ...
//   logger.llm("buildRepositoryModel", "end", { duration_ms, tokens? });
//   await logger.flush();
// ===========================================================================

import { writeFile, appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export class PipelineLogger {
  constructor(workDir) {
    this.workDir = workDir;
    this.events = [];
    this.activeTimers = new Map(); // key → startTs
    this.startTime = Date.now();
    this.logPath = join(workDir, "pipeline-timeline.jsonl");
  }

  _ts() {
    return new Date().toISOString();
  }

  _elapsed() {
    return Date.now() - this.startTime;
  }

  /** Record a stage/operation start. */
  start(label, meta = {}) {
    const ts = Date.now();
    const event = {
      ts: this._ts(),
      elapsed_ms: ts - this.startTime,
      label,
      phase: "start",
      ...meta,
    };
    this.events.push(event);
    this.activeTimers.set(label, ts);
    console.log(`  [log] ▶ ${label}`);
    return event;
  }

  /** Record a stage/operation end with computed duration. */
  end(label, meta = {}) {
    const ts = Date.now();
    const startTs = this.activeTimers.get(label);
    const duration_ms = startTs ? ts - startTs : null;
    const event = {
      ts: this._ts(),
      elapsed_ms: ts - this.startTime,
      label,
      phase: "end",
      duration_ms,
      ...meta,
    };
    this.events.push(event);
    this.activeTimers.delete(label);
    const durStr = duration_ms !== null ? ` (${(duration_ms / 1000).toFixed(1)}s)` : "";
    console.log(`  [log] ◀ ${label}${durStr}`);
    return event;
  }

  /** Record a point-in-time event (no start/end pairing). */
  mark(label, meta = {}) {
    const ts = Date.now();
    const event = {
      ts: this._ts(),
      elapsed_ms: ts - this.startTime,
      label,
      phase: "mark",
      ...meta,
    };
    this.events.push(event);
    return event;
  }

  /** Record an LLM call with prompt size and response status. */
  llmCall(name, { promptChars, status, duration_ms, error, model } = {}) {
    const event = {
      ts: this._ts(),
      elapsed_ms: Date.now() - this.startTime,
      label: `LLM: ${name}`,
      phase: "llm",
      model: model || "default",
      prompt_chars: promptChars,
      status, // "success" | "timeout" | "error" | "fallback"
      duration_ms,
      error: error || undefined,
    };
    this.events.push(event);
    const statusIcon = status === "success" ? "✓" : status === "timeout" ? "⏱" : status === "fallback" ? "↩" : "✗";
    const durStr = duration_ms ? ` ${(duration_ms / 1000).toFixed(1)}s` : "";
    console.log(`  [log] ${statusIcon} LLM:${name}${durStr} ${status}${error ? ` — ${error}` : ""}`);
    return event;
  }

  /** Append all collected events as JSONL to the timeline file. */
  async flush() {
    if (this.events.length === 0) return;
    await mkdir(this.workDir, { recursive: true });
    const lines = this.events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    await appendFile(this.logPath, lines, "utf-8");

    // Also write a human-readable summary
    const summaryPath = join(this.workDir, "pipeline-summary.txt");
    const lines2 = this._renderSummary();
    await writeFile(summaryPath, lines2, "utf-8");

    // Clear events to avoid double-flushing
    this.events = [];
  }

  _renderSummary() {
    const lines = [];
    lines.push("=== Pipeline Timeline Summary ===\n");
    lines.push(`Start: ${new Date(this.startTime).toISOString()}`);
    lines.push(`End:   ${new Date().toISOString()}`);
    lines.push(`Total: ${((Date.now() - this.startTime) / 1000).toFixed(1)}s\n`);

    // Group by label
    const stages = [];
    const llmCalls = [];
    const marks = [];
    const seen = new Set();

    for (const e of this.events) {
      if (e.phase === "start") {
        seen.add(e.label);
        stages.push(e);
      } else if (e.phase === "end" && seen.has(e.label)) {
        stages.push(e);
      } else if (e.phase === "llm") {
        llmCalls.push(e);
      } else if (e.phase === "mark") {
        marks.push(e);
      }
    }

    lines.push("\n--- Stages ---\n");
    const startMap = new Map();
    for (const e of this.events) {
      if (e.phase === "start") startMap.set(e.label, e.elapsed_ms);
      if (e.phase === "end" && startMap.has(e.label)) {
        const dur = e.duration_ms;
        lines.push(`  ${e.label}: ${(dur / 1000).toFixed(1)}s`);
        startMap.delete(e.label);
      }
    }

    lines.push("\n--- LLM Calls ---\n");
    let totalLlmMs = 0;
    let llmCount = 0;
    for (const e of llmCalls) {
      lines.push(`  ${e.label}: ${e.status} ${(e.duration_ms / 1000).toFixed(1)}s (prompt: ${e.prompt_chars || "?"} chars)`);
      if (e.duration_ms) {
        totalLlmMs += e.duration_ms;
        llmCount++;
      }
    }
    lines.push(`\n  Total LLM time: ${(totalLlmMs / 1000).toFixed(1)}s across ${llmCount} calls`);

    lines.push("\n--- Marks ---\n");
    for (const m of marks) {
      lines.push(`  ${(m.elapsed_ms / 1000).toFixed(1)}s ${m.label}`);
    }

    return lines.join("\n") + "\n";
  }
}
