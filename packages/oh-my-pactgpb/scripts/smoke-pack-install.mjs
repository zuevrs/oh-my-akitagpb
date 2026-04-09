#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureTemplateRoot = path.join(repoRoot, 'tests', 'fixtures', 'spring-pact-provider-local');
const smokeRoot = path.join(tmpdir(), 'oh-my-pactgpb-smoke-pack-install');
const fixtureRoot = path.join(smokeRoot, 'fixture');
const logPath = path.join(fixtureRoot, '.oh-my-pactgpb-smoke-log.json');
const npmCacheRoot = path.join(smokeRoot, '.npm-cache');

const log = {
  startedAt: new Date().toISOString(),
  repoRoot,
  fixtureRoot,
  steps: [],
};

function persistLog() {
  mkdirSync(path.dirname(logPath), { recursive: true });
  writeFileSync(logPath, `${JSON.stringify(log, null, 2)}\n`, 'utf8');
}

function runCommand(command, args, cwd, rejectOnNonZero = true) {
  mkdirSync(npmCacheRoot, { recursive: true });
  const startedAt = performance.now();
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    env: {
      ...process.env,
      npm_config_cache: npmCacheRoot,
    },
  });
  const durationMs = Math.round(performance.now() - startedAt);
  const execution = {
    command,
    args,
    cwd,
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    durationMs,
  };

  log.steps.push(execution);
  persistLog();

  if (result.error) {
    throw new Error(`Failed to launch ${command}: ${result.error.message}`);
  }

  if (rejectOnNonZero && execution.exitCode !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${execution.exitCode}.`);
  }

  return execution;
}

function parseJsonOutput(label, raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertFileExists(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Expected file to exist: ${filePath}`);
  }
}

function assertFileContains(filePath, expectedSnippet) {
  const content = readFileSync(filePath, 'utf8');
  if (!content.includes(expectedSnippet)) {
    throw new Error(`Expected file ${filePath} to contain: ${expectedSnippet}`);
  }
}

function main() {
  rmSync(smokeRoot, { recursive: true, force: true });
  mkdirSync(smokeRoot, { recursive: true });
  cpSync(fixtureTemplateRoot, fixtureRoot, { recursive: true });
  persistLog();

  const packExecution = runCommand('npm', ['pack', '--json'], repoRoot);
  const packEntries = parseJsonOutput('npm pack', packExecution.stdout);
  const packEntry = Array.isArray(packEntries) ? packEntries[0] : null;
  const tarballName = packEntry && typeof packEntry === 'object' && typeof packEntry.filename === 'string'
    ? packEntry.filename
    : null;

  if (!tarballName) {
    throw new Error('npm pack did not produce a tarball filename.');
  }

  const tarballPath = path.join(repoRoot, tarballName);
  assertFileExists(tarballPath);

  runCommand('npm', ['install', '--no-fund', '--no-audit', '-D', tarballPath], fixtureRoot);

  const installExecution = runCommand('npx', ['oh-my-pactgpb', 'install'], fixtureRoot, false);
  const installResult = parseJsonOutput('smoke install', installExecution.stdout);
  if (installExecution.exitCode !== 0 || installResult.status !== 'ok' || installResult.reason !== 'install-complete') {
    throw new Error(`Published install failed: ${installResult.message ?? installExecution.stderr}`);
  }

  const doctorExecution = runCommand('npx', ['oh-my-pactgpb', 'doctor'], fixtureRoot, false);
  const doctorResult = parseJsonOutput('smoke doctor', doctorExecution.stdout);
  if (doctorExecution.exitCode !== 0 || doctorResult.status !== 'ok') {
    throw new Error(`Published doctor failed: ${doctorResult.message ?? doctorExecution.stderr}`);
  }

  const capabilityManifestPath = path.join(fixtureRoot, '.oma', 'packs', 'oh-my-pactgpb', 'capability-manifest.json');
  const installStatePath = path.join(fixtureRoot, '.oma', 'packs', 'oh-my-pactgpb', 'install-state.json');
  const projectModePath = path.join(fixtureRoot, '.oma', 'packs', 'oh-my-pactgpb', 'runtime', 'local', 'project-mode.json');
  const doctorReportPath = path.join(fixtureRoot, '.oma', 'packs', 'oh-my-pactgpb', 'state', 'local', 'doctor', 'doctor-report.json');
  const opencodeConfigPath = path.join(fixtureRoot, 'opencode.json');
  const requiredInstalledPaths = [
    '.opencode/commands/pact-scan.md',
    '.opencode/commands/pact-plan.md',
    '.opencode/commands/pact-write.md',
    '.opencode/skills/pact-scan-workflow/SKILL.md',
    '.opencode/skills/pact-plan-workflow/SKILL.md',
    '.opencode/skills/pact-write-workflow/SKILL.md',
    '.oma/packs/oh-my-pactgpb/templates/scan/state-contract.json',
    '.oma/packs/oh-my-pactgpb/templates/scan/scan-summary.md',
    '.oma/packs/oh-my-pactgpb/templates/plan/state-contract.json',
    '.oma/packs/oh-my-pactgpb/templates/plan/plan-summary.md',
    '.oma/packs/oh-my-pactgpb/templates/write/state-contract.json',
    '.oma/packs/oh-my-pactgpb/templates/write/write-summary.md',
  ];

  assertFileExists(path.join(fixtureRoot, 'pom.xml'));
  assertFileExists(capabilityManifestPath);
  assertFileExists(installStatePath);
  assertFileExists(projectModePath);
  assertFileExists(doctorReportPath);
  assertFileExists(opencodeConfigPath);

  for (const relativePath of requiredInstalledPaths) {
    assertFileExists(path.join(fixtureRoot, relativePath));
  }

  const capabilityManifest = parseJsonOutput('capability-manifest', readFileSync(capabilityManifestPath, 'utf8'));
  const installState = parseJsonOutput('install-state', readFileSync(installStatePath, 'utf8'));
  const projectMode = parseJsonOutput('project-mode', readFileSync(projectModePath, 'utf8'));
  const doctorReport = parseJsonOutput('doctor-report', readFileSync(doctorReportPath, 'utf8'));
  const opencodeConfig = parseJsonOutput('opencode-config', readFileSync(opencodeConfigPath, 'utf8'));

  if (!Array.isArray(installState.managedSurfaces) || installState.managedSurfaces.length === 0) {
    throw new Error('install-state did not record any managed surfaces.');
  }

  if (!Array.isArray(installState.ownedFiles)) {
    throw new Error('install-state did not record ownedFiles.');
  }

  for (const relativePath of requiredInstalledPaths) {
    if (!installState.ownedFiles.some((record) => record && record.relativePath === relativePath)) {
      throw new Error(`install-state did not record packaged path: ${relativePath}`);
    }
  }

  if (
    !Array.isArray(capabilityManifest.activeCommandIds) ||
    capabilityManifest.activeCommandIds.length !== 3 ||
    !capabilityManifest.activeCommandIds.includes('pact-scan') ||
    !capabilityManifest.activeCommandIds.includes('pact-plan') ||
    !capabilityManifest.activeCommandIds.includes('pact-write')
  ) {
    throw new Error('capability-manifest.json did not advertise the installed Pact commands.');
  }

  if (
    !Array.isArray(capabilityManifest.activeWorkflowSkills) ||
    capabilityManifest.activeWorkflowSkills.length !== 3 ||
    !capabilityManifest.activeWorkflowSkills.includes('pact-scan-workflow') ||
    !capabilityManifest.activeWorkflowSkills.includes('pact-plan-workflow') ||
    !capabilityManifest.activeWorkflowSkills.includes('pact-write-workflow')
  ) {
    throw new Error('capability-manifest.json did not advertise the installed Pact workflow skills.');
  }

  if (!Array.isArray(capabilityManifest.activeCapabilityBundles) || capabilityManifest.activeCapabilityBundles.length !== 0) {
    throw new Error('capability-manifest.json should not advertise capability bundles in Slice 1.');
  }

  if (!Array.isArray(opencodeConfig.instructions) || opencodeConfig.instructions.length === 0) {
    throw new Error('Installed opencode.json did not preserve the managed instruction list.');
  }

  if (typeof projectMode.mode !== 'string') {
    throw new Error('project-mode.json did not include a mode classification.');
  }

  if (typeof doctorReport.nextStep !== 'string' || doctorReport.nextStep.length === 0) {
    throw new Error('doctor-report.json did not include a safe next step.');
  }

  assertFileContains(path.join(fixtureRoot, '.opencode', 'commands', 'pact-scan.md'), '.oma/packs/oh-my-pactgpb/templates/scan/state-contract.json');
  assertFileContains(path.join(fixtureRoot, '.opencode', 'commands', 'pact-scan.md'), 'Pact provider verification');
  assertFileContains(path.join(fixtureRoot, '.opencode', 'commands', 'pact-plan.md'), '.oma/packs/oh-my-pactgpb/templates/plan/state-contract.json');
  assertFileContains(path.join(fixtureRoot, '.opencode', 'commands', 'pact-plan.md'), '.oma/packs/oh-my-pactgpb/state/shared/scan/scan-state.json');
  assertFileContains(path.join(fixtureRoot, '.opencode', 'commands', 'pact-write.md'), '.oma/packs/oh-my-pactgpb/templates/write/state-contract.json');
  assertFileContains(path.join(fixtureRoot, '.opencode', 'commands', 'pact-write.md'), '.oma/packs/oh-my-pactgpb/state/shared/plan/plan-state.json');
  assertFileContains(path.join(fixtureRoot, '.opencode', 'skills', 'pact-scan-workflow', 'SKILL.md'), 'artifact source');
  assertFileContains(path.join(fixtureRoot, '.opencode', 'skills', 'pact-scan-workflow', 'SKILL.md'), 'provider verification');
  assertFileContains(path.join(fixtureRoot, '.opencode', 'skills', 'pact-plan-workflow', 'SKILL.md'), 'persisted scan state');
  assertFileContains(path.join(fixtureRoot, '.opencode', 'skills', 'pact-plan-workflow', 'SKILL.md'), 'provider-verification plan');
  assertFileContains(path.join(fixtureRoot, '.opencode', 'skills', 'pact-write-workflow', 'SKILL.md'), 'plan-obedient Pact provider verification scaffolding');
  assertFileContains(path.join(fixtureRoot, '.opencode', 'skills', 'pact-write-workflow', 'SKILL.md'), 'write-state.json');
  assertFileContains(path.join(fixtureRoot, '.oma', 'packs', 'oh-my-pactgpb', 'templates', 'scan', 'state-contract.json'), 'artifactSource');
  assertFileContains(path.join(fixtureRoot, '.oma', 'packs', 'oh-my-pactgpb', 'templates', 'scan', 'scan-summary.md'), '### Provider under contract');
  assertFileContains(path.join(fixtureRoot, '.oma', 'packs', 'oh-my-pactgpb', 'templates', 'plan', 'state-contract.json'), 'providerSelection');
  assertFileContains(path.join(fixtureRoot, '.oma', 'packs', 'oh-my-pactgpb', 'templates', 'plan', 'state-contract.json'), 'verificationReadiness');
  assertFileContains(path.join(fixtureRoot, '.oma', 'packs', 'oh-my-pactgpb', 'templates', 'plan', 'plan-summary.md'), '### Provider selection');
  assertFileContains(path.join(fixtureRoot, '.oma', 'packs', 'oh-my-pactgpb', 'templates', 'write', 'state-contract.json'), 'inputPlanVerdict');
  assertFileContains(path.join(fixtureRoot, '.oma', 'packs', 'oh-my-pactgpb', 'templates', 'write', 'state-contract.json'), 'writeOutcome');
  assertFileContains(path.join(fixtureRoot, '.oma', 'packs', 'oh-my-pactgpb', 'templates', 'write', 'write-summary.md'), '### Verification next step');

  const summary = {
    status: 'ok',
    fixtureRoot,
    logPath,
    capabilityManifestPath,
    installStatePath,
    projectModePath,
    doctorReportPath,
    opencodeConfigPath,
    doctorStatus: doctorReport.status,
    doctorNextStep: doctorReport.nextStep,
  };

  console.log(JSON.stringify(summary, null, 2));
}

try {
  main();
} catch (error) {
  const failure = {
    status: 'error',
    message: error instanceof Error ? error.message : String(error),
    fixtureRoot,
    logPath,
  };
  persistLog();
  console.error(JSON.stringify(failure, null, 2));
  process.exit(1);
}
