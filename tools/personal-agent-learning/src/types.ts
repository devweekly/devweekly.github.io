export type Provider = 'copilot' | 'codebuddy';
export type FeedbackKind =
  | 'correction'
  | 'preference'
  | 'pairwise_choice'
  | 'accepted'
  | 'rejected'
  | 'edit'
  | 'undo'
  | 'clarification'
  | 'friction';
export type OutcomeStatus = 'delivered' | 'accepted' | 'reworked' | 'rejected' | 'abandoned' | 'verified';

export interface ObserverContext {
  provider: Provider;
  agentId: string;
  model?: string;
  project?: string;
  taskType?: string;
  sessionId?: string;
  turnId: string;
  traceId: string;
  correlationId: string;
}

export interface LearningEventInput {
  kind: 'feedback' | 'outcome' | 'delivery';
  provider?: Provider;
  agentId?: string;
  project?: string;
  taskType?: string;
  sessionId?: string;
  turnId?: string;
  text?: string;
  metadata?: Record<string, unknown>;
  scope?: Record<string, string | string[]>;
}

export interface LearningEvent {
  id: string;
  occurredAt: string;
  kind: 'feedback' | 'outcome' | 'delivery';
  provider?: Provider;
  agentId?: string;
  project?: string;
  taskType?: string;
  sessionId?: string;
  turnId?: string;
  text?: string;
  metadata: Record<string, unknown>;
  scope: Record<string, string | string[]>;
}

export interface PreferenceCandidate {
  dimension: string;
  direction: 'prefer' | 'avoid' | 'require' | 'discourage';
  statement: string;
  scope: {
    agent?: string;
    project?: string;
    taskType?: string;
    provider?: Provider;
  };
  confidence: number;
  evidenceIds: string[];
  rationale: string;
  counterEvidenceIds?: string[];
}

export interface StoredCandidate extends PreferenceCandidate {
  id: string;
  createdAt: string;
  status: 'pending' | 'accepted' | 'rejected';
  reflectionRunId: string;
  reviewNote?: string;
}

export interface ProfilePreference {
  id: string;
  dimension: string;
  direction: PreferenceCandidate['direction'];
  statement: string;
  scope: PreferenceCandidate['scope'];
  confidence: number;
  evidenceIds: string[];
  sourceCandidateId: string;
  acceptedAt: string;
}

export interface PreferenceProfile {
  version: number;
  updatedAt: string;
  preferences: ProfilePreference[];
}
