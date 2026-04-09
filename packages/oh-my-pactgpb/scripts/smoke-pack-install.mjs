#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureTemplateRoot = path.join(repoRoot, 'tests', 'fixtures', 'empty-java-service');
const smokeRoot = path.join(tmpdir(), 'oh-my-akitagpb-smoke-pack-install');
const fixtureRoot = path.join(smokeRoot, 'fixture');
const logPath = path.join(fixtureRoot, '.oh-my-akitagpb-smoke-log.json');
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

function assertOpencodeConfigValid(filePath) {
  const config = parseJsonOutput('opencode-config', readFileSync(filePath, 'utf8'));
  if (config.ohMyAkitaGpb !== undefined) {
    throw new Error('Installed opencode.json still contains the unsupported ohMyAkitaGpb key.');
  }

  if (!Array.isArray(config.instructions) || config.instructions.length === 0) {
    throw new Error('Installed opencode.json did not preserve the managed instruction list.');
  }
}

function listBundleRuntimePaths(manifest) {
  if (!manifest || !Array.isArray(manifest.activeCapabilityBundles)) {
    throw new Error('capability-manifest.json did not include activeCapabilityBundles.');
  }

  return manifest.activeCapabilityBundles.flatMap((bundle) => {
    if (!bundle || typeof bundle !== 'object' || typeof bundle.skillPath !== 'string' || !bundle.references || typeof bundle.references !== 'object') {
      throw new Error('capability-manifest.json contained an invalid bundle entry.');
    }

    return [bundle.skillPath, ...Object.values(bundle.references)];
  });
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

  const installExecution = runCommand('npx', ['oh-my-akitagpb', 'install'], fixtureRoot, false);
  const installResult = parseJsonOutput('doctor smoke install', installExecution.stdout);
  if (installExecution.exitCode !== 0 || installResult.status !== 'ok' || installResult.reason !== 'install-complete') {
    throw new Error(`Published install failed: ${installResult.message ?? installExecution.stderr}`);
  }

  const doctorExecution = runCommand('npx', ['oh-my-akitagpb', 'doctor'], fixtureRoot, false);
  const doctorResult = parseJsonOutput('doctor smoke doctor', doctorExecution.stdout);
  if (doctorExecution.exitCode !== 0 || doctorResult.status !== 'ok') {
    throw new Error(`Published doctor failed: ${doctorResult.message ?? doctorExecution.stderr}`);
  }

  const capabilityManifestPath = path.join(fixtureRoot, '.oma', 'capability-manifest.json');
  const installStatePath = path.join(fixtureRoot, '.oma', 'install-state.json');
  const projectModePath = path.join(fixtureRoot, '.oma', 'runtime', 'local', 'project-mode.json');
  const doctorReportPath = path.join(fixtureRoot, '.oma', 'state', 'local', 'doctor', 'doctor-report.json');
  const opencodeConfigPath = path.join(fixtureRoot, 'opencode.json');
  const requiredInstalledPaths = [
    '.opencode/commands/akita-scan.md',
    '.opencode/commands/akita-plan.md',
    '.opencode/commands/akita-write.md',
    '.opencode/commands/akita-validate.md',
    '.opencode/commands/akita-promote.md',
    '.opencode/skills/akita-scan-workflow/SKILL.md',
    '.opencode/skills/akita-plan-workflow/SKILL.md',
    '.opencode/skills/akita-write-workflow/SKILL.md',
    '.opencode/skills/akita-validate-workflow/SKILL.md',
    '.opencode/skills/akita-promote-workflow/SKILL.md',
    '.oma/templates/scan/state-contract.json',
    '.oma/templates/plan/state-contract.json',
    '.oma/templates/write/state-contract.json',
    '.oma/templates/validate/state-contract.json',
    '.oma/templates/promote/state-contract.json',
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
  const activeCapabilityBundlePaths = listBundleRuntimePaths(capabilityManifest);

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

  for (const runtimePath of activeCapabilityBundlePaths) {
    const materializedPath = path.join(fixtureRoot, runtimePath);
    assertFileExists(materializedPath);
    if (!installState.ownedFiles.some((record) => record && record.relativePath === runtimePath)) {
      throw new Error(`install-state did not record capability bundle path: ${runtimePath}`);
    }
  }

  if (typeof projectMode.mode !== 'string') {
    throw new Error('project-mode.json did not include a mode classification.');
  }

  if (typeof doctorReport.nextStep !== 'string' || doctorReport.nextStep.length === 0) {
    throw new Error('doctor-report.json did not include a safe next step.');
  }

  assertOpencodeConfigValid(opencodeConfigPath);
  assertFileContains(path.join(fixtureRoot, '.opencode', 'commands', 'akita-scan.md'), '.oma/templates/scan/state-contract.json');
  assertFileContains(path.join(fixtureRoot, '.opencode', 'commands', 'akita-scan.md'), 'system under test');
  assertFileContains(path.join(fixtureRoot, '.opencode', 'commands', 'akita-scan.md'), 'OpenAPI and AsyncAPI');
  assertFileContains(path.join(fixtureRoot, '.opencode', 'commands', 'akita-plan.md'), '.oma/templates/plan/state-contract.json');
  assertFileContains(path.join(fixtureRoot, '.opencode', 'commands', 'akita-plan.md'), 'persisted scan evidence');
  assertFileContains(path.join(fixtureRoot, '.opencode', 'skills', 'akita-scan-workflow', 'SKILL.md'), 'machine-readable evidence map');
  assertFileContains(path.join(fixtureRoot, '.opencode', 'skills', 'akita-plan-workflow', 'SKILL.md'), 'OpenAPI or AsyncAPI evidence may strengthen a candidate');
  assertFileContains(path.join(fixtureRoot, '.opencode', 'commands', 'akita-write.md'), '.oma/templates/write/state-contract.json');
  assertFileContains(path.join(fixtureRoot, '.opencode', 'commands', 'akita-write.md'), '.oma/state/shared/plan/approved-plan.json');
  assertFileContains(path.join(fixtureRoot, '.opencode', 'commands', 'akita-validate.md'), '.oma/templates/validate/state-contract.json');
  assertFileContains(path.join(fixtureRoot, '.opencode', 'commands', 'akita-validate.md'), '.oma/state/shared/write/write-report.json');
  assertFileContains(path.join(fixtureRoot, '.opencode', 'commands', 'akita-validate.md'), '/akita-promote');
  assertFileContains(path.join(fixtureRoot, '.opencode', 'commands', 'akita-promote.md'), '.oma/templates/promote/state-contract.json');
  assertFileContains(path.join(fixtureRoot, '.opencode', 'commands', 'akita-promote.md'), '.oma/state/shared/write/write-report.json');
  assertFileContains(path.join(fixtureRoot, '.opencode', 'skills', 'akita-write-workflow', 'SKILL.md'), '.oma/state/shared/write/write-report.json');
  assertFileContains(path.join(fixtureRoot, '.opencode', 'skills', 'akita-write-workflow', 'SKILL.md'), '.oma/generated/**');
  assertFileContains(path.join(fixtureRoot, '.opencode', 'skills', 'akita-validate-workflow', 'SKILL.md'), '.oma/state/local/validate/validation-report.json');
  assertFileContains(path.join(fixtureRoot, '.opencode', 'skills', 'akita-validate-workflow', 'SKILL.md'), 'lineage-drift');
  assertFileContains(path.join(fixtureRoot, '.opencode', 'skills', 'akita-promote-workflow', 'SKILL.md'), '.oma/state/local/promote/promote-report.json');
  assertFileContains(path.join(fixtureRoot, '.opencode', 'skills', 'akita-promote-workflow', 'SKILL.md'), 'copy instead of move');

  const summary = {
    status: 'ok',
    fixtureRoot,
    logPath,
    capabilityManifestPath,
    activeCapabilityBundlePaths,
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
