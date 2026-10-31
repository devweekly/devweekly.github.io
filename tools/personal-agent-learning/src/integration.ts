import { ensureConfigDirectories, loadConfig } from './config.js';
import { AgentObserver } from './observer.js';

export async function openPersonalAgentLearning(): Promise<AgentObserver> {
  const config = loadConfig();
  ensureConfigDirectories(config);
  return new AgentObserver(config);
}
