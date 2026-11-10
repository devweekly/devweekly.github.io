export const REQUIRED_WRITING_KNOWLEDGE_STEPS = [
  "style-profile",
  "character-profiles",
  "character-states",
  "as-of-dossier"
] as const;

export type WritingKnowledgeStep = typeof REQUIRED_WRITING_KNOWLEDGE_STEPS[number];

export function missingWritingKnowledgeSteps(
  steps: readonly { name?: string; status?: string }[] | undefined
): WritingKnowledgeStep[] {
  return REQUIRED_WRITING_KNOWLEDGE_STEPS.filter(name => !steps?.some(step =>
    step.name === name && (step.status === "completed" || step.status === "skipped")
  ));
}

export function isWritingKnowledgeReady(
  steps: readonly { name?: string; status?: string }[] | undefined
): boolean {
  return missingWritingKnowledgeSteps(steps).length === 0;
}
