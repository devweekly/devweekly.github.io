import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const commonDir = resolve(
  process.env.COMMON_AGENT_LIB_DIR ?? join(projectDir, '..', '..', '..', 'common-agent-lib'),
);

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed in ${cwd} (exit ${result.status})`);
  }
}

const packageNames = [
  'agent-contracts',
  'agent-tracing',
  'copilot-agent-runtime',
  'codebuddy-agent-runtime',
];

for (const name of packageNames) {
  const manifest = join(commonDir, 'packages', name, 'package.json');
  if (!existsSync(manifest)) {
    throw new Error(
      `Cannot find ${manifest}. Clone saga/common-agent-lib beside saga/devweekly, or set COMMON_AGENT_LIB_DIR.`,
    );
  }
  const metadata = JSON.parse(readFileSync(manifest, 'utf8'));
  if (!metadata.name?.startsWith('@saga/')) {
    throw new Error(`Unexpected package identity in ${manifest}`);
  }
}

console.log('Installing the common-agent-lib workspace...');
run('npm', ['install'], commonDir);

// Keep the SDKs on the versions used by this integration: Copilot 1.0.17
// matches agentic-data-architect's lockfile; CodeBuddy 0.3.276 matches the
// tested common-agent-lib CodeBuddy runtime baseline.
run('npm', ['install', '--no-save', '@github/copilot-sdk@1.0.17', '@tencent-ai/agent-sdk@0.3.276'], commonDir);
run('npm', ['run', 'build'], commonDir);

console.log('Installing this tool's CLI dependencies...');
run('npm', ['install'], projectDir);

const scopeDir = join(projectDir, 'node_modules', '@saga');
mkdirSync(scopeDir, { recursive: true });

for (const name of packageNames) {
  const source = join(commonDir, 'packages', name);
  const target = join(scopeDir, name);
  if (existsSync(target) || (() => { try { lstatSync(target); return true; } catch { return false; } })()) {
    rmSync(target, { recursive: true, force: true });
  }
  symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir');
  console.log(`Linked @saga/${name}`);
}

console.log('Shared runtime packages are ready.');
