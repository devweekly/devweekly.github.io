import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const commonDir = resolve(
  process.env.COMMON_AGENT_LIB_DIR ?? join(projectDir, '..', '..', '..', 'common-agent-lib'),
);
const packageNames = [
  'agent-contracts',
  'agent-tracing',
  'copilot-agent-runtime',
  'codebuddy-agent-runtime',
] as const;

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

function readManifest(filename) {
  if (!existsSync(filename)) throw new Error(`Cannot find ${filename}`);
  return JSON.parse(readFileSync(filename, 'utf8'));
}

const expected = {
  'agent-contracts': '0.1.0',
  'agent-tracing': '0.1.0',
  'copilot-agent-runtime': '0.1.0',
  'codebuddy-agent-runtime': '0.1.0',
};

for (const name of packageNames) {
  const manifest = join(commonDir, 'packages', name, 'package.json');
  const metadata = readManifest(manifest);
  if (metadata.name !== `@saga/${name}`) {
    throw new Error(`Unexpected package identity in ${manifest}: ${metadata.name}`);
  }
  if (metadata.version !== expected[name]) {
    throw new Error(
      `Unsupported @saga/${name} version ${metadata.version}; expected ${expected[name]}. ` +
      'Review its API changes before updating this integration.',
    );
  }
}

const copilotRuntime = readManifest(join(commonDir, 'packages/copilot-agent-runtime/package.json'));
const codeBuddyRuntime = readManifest(join(commonDir, 'packages/codebuddy-agent-runtime/package.json'));
if (copilotRuntime.dependencies?.['@github/copilot-sdk'] !== '^1.0.15') {
  throw new Error('The shared Copilot runtime SDK range changed; re-check the pinned host version before continuing.');
}
if (codeBuddyRuntime.dependencies?.['@tencent-ai/agent-sdk'] !== '0.3.276') {
  throw new Error('The shared CodeBuddy runtime SDK pin changed; re-run compatibility probes before continuing.');
}

console.log('Installing shared runtime dependencies...');
run('npm', ['install', '--package-lock=false'], commonDir);

// Keep both SDK runtimes aligned with the versions exercised by Saga applications:
// Copilot 1.0.17 is the agentic-data-architect lockfile version;
// CodeBuddy 0.3.276 is common-agent-lib's three-layer-probed exact pin.
run('npm', [
  'install',
  '--no-save',
  '--package-lock=false',
  '@github/copilot-sdk@1.0.17',
  '@tencent-ai/agent-sdk@0.3.276',
], commonDir);

console.log('Building common-agent-lib workspace packages...');
run('npm', ['run', 'build'], commonDir);

// The shared packages are local workspace packages and may not be published to npm.
// Temporarily resolve the declared @saga package names to this checkout. Do not
// persist absolute machine paths in package.json or generate a machine-specific lockfile.
const packageJsonPath = join(projectDir, 'package.json');
const originalPackageJson = readFileSync(packageJsonPath, 'utf8');
const projectManifest = JSON.parse(originalPackageJson);
const originalDependencies = { ...projectManifest.dependencies };

for (const name of packageNames) {
  projectManifest.dependencies[`@saga/${name}`] = `file:${join(commonDir, 'packages', name)}`;
}

try {
  writeFileSync(packageJsonPath, JSON.stringify(projectManifest, null, 2) + '\n', 'utf8');
  console.log('Installing Personal Agent Learning and resolving @saga packages from local source...');
  run('npm', ['install', '--no-package-lock'], projectDir);
} finally {
  projectManifest.dependencies = originalDependencies;
  writeFileSync(packageJsonPath, JSON.stringify(projectManifest, null, 2) + '\n', 'utf8');
}

console.log('Personal Agent Learning is installed against the common-agent-lib runtime packages.');
