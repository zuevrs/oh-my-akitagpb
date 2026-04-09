import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { PackageSurface } from './asset-catalog.js';
import { extractManagedGitignoreBlock, inspectGitignoreFile } from './gitignore-block.js';
import { hashContent, extractManagedAgentsBlock, inspectAgentsFile, inspectOpencodeConfig, type ManagedSurfaceState } from './managed-blocks.js';
import {
  INSTALL_STATE_RELATIVE_PATH,
  PROJECT_MODE_RELATIVE_PATH,
  resolveDoctorReportAbsolutePath,
  resolvePackRuntimeRootAbsolutePath,
} from './layout.js';
import { readInstallState, resolveInstallStatePath, type InstallState } from './install-state.js';
import { classifyProjectMode, readProjectModeRecord, resolveProjectModePath } from './project-mode.js';
import { MANAGED_INSTRUCTION_PATHS } from './materialize-install.js';

export type DoctorStatus = 'compatible' | 'migrate-required' | 'blocked';
export type DoctorFindingSeverity = 'info' | 'warning' | 'error';

export interface DoctorFinding {
  code: string;
  severity: DoctorFindingSeverity;
  message: string;
  path?: string;
  nextStep?: string;
}

export interface DoctorReport {
  schemaVersion: 1;
  generatedAt: string;
  projectRoot: string;
  reportPath: string;
  packageName: string;
  packageVersion: string;
  status: DoctorStatus;
  reason: string;
  summary: string;
  nextStep: string;
  compatibility: {
    installedPackageVersion: string | null;
    detectedProjectMode: 'fresh' | 'resume';
    detectedReasons: readonly string[];
  };
  runtime: {
    installStatePath: string;
    installStateStatus: 'missing' | 'valid' | 'invalid';
    projectModePath: string;
    projectModeRecordStatus: 'missing' | 'valid' | 'invalid';
    recordedProjectMode: 'fresh' | 'resume' | null;
    recordedProjectModeReasons: readonly string[];
  };
  ownership: {
    agents: ManagedSurfaceState;
    opencode: ManagedSurfaceState;
    conflicts: readonly string[];
  };
  drift: {
    packageVersionMismatch: boolean;
    ownedModified: readonly string[];
    ownedMissing: readonly string[];
    managedModified: readonly string[];
  };
  findings: readonly DoctorFinding[];
}

interface DoctorReportDraft extends Omit<DoctorReport, 'reportPath'> {}

interface ProjectModeRecordInspection {
  status: 'missing' | 'valid' | 'invalid';
  recordedMode: 'fresh' | 'resume' | null;
  recordedReasons: readonly string[];
}

interface OwnedFileInspection {
  kind: 'ok' | 'modified' | 'missing';
}

function resolveDoctorStateDir(projectRoot: string): string {
  return path.dirname(resolveDoctorReportAbsolutePath(projectRoot));
}

export function resolveDoctorReportPath(projectRoot: string): string {
  return resolveDoctorReportAbsolutePath(projectRoot);
}

function inspectProjectModeRecord(projectRoot: string): ProjectModeRecordInspection {
  const projectModePath = resolveProjectModePath(projectRoot);
  if (!existsSync(projectModePath)) {
    return {
      status: 'missing',
      recordedMode: null,
      recordedReasons: [],
    };
  }

  const stat = lstatSync(projectModePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return {
      status: 'invalid',
      recordedMode: null,
      recordedReasons: [],
    };
  }

  const record = readProjectModeRecord(projectRoot);
  if (!record) {
    return {
      status: 'invalid',
      recordedMode: null,
      recordedReasons: [],
    };
  }

  return {
    status: 'valid',
    recordedMode: record.mode,
    recordedReasons: record.reasons,
  };
}

function inspectOwnedFile(projectRoot: string, relativePath: string, expectedHash: string): OwnedFileInspection {
  const absolutePath = path.join(projectRoot, relativePath);
  if (!existsSync(absolutePath)) {
    return { kind: 'missing' };
  }

  const stat = lstatSync(absolutePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return { kind: 'missing' };
  }

  const currentHash = hashContent(readFileSync(absolutePath, 'utf8'));
  if (currentHash !== expectedHash) {
    return { kind: 'modified' };
  }

  return { kind: 'ok' };
}

function inspectManagedSurface(
  projectRoot: string,
  record: InstallState['managedSurfaces'][number],
): { kind: 'ok' | 'modified' | 'conflict'; ownershipState: ManagedSurfaceState } {
  const absolutePath = path.join(projectRoot, record.relativePath);

  if (record.relativePath === 'AGENTS.md') {
    const inspection = inspectAgentsFile(absolutePath);
    if (inspection.state !== 'managed' || inspection.content === undefined) {
      return {
        kind: 'conflict',
        ownershipState: inspection.state,
      };
    }

    const block = extractManagedAgentsBlock(inspection.content);
    if (!block) {
      return {
        kind: 'conflict',
        ownershipState: 'malformed',
      };
    }

    return {
      kind: hashContent(block) === record.sha256 ? 'ok' : 'modified',
      ownershipState: inspection.state,
    };
  }

  if (record.relativePath === 'opencode.json') {
    const inspection = inspectOpencodeConfig(absolutePath);
    if (inspection.state !== 'managed' || inspection.content === undefined) {
      return {
        kind: 'conflict',
        ownershipState: inspection.state,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(inspection.content);
    } catch {
      return {
        kind: 'conflict',
        ownershipState: 'malformed',
      };
    }

    const instructions = parsed && typeof parsed === 'object' && Array.isArray((parsed as { instructions?: unknown }).instructions)
      ? (parsed as { instructions: unknown[] }).instructions.filter((entry): entry is string => typeof entry === 'string')
      : [];
    const hasCurrentPackInstructions = MANAGED_INSTRUCTION_PATHS.every((instructionPath) => instructions.includes(instructionPath));

    return {
      kind: hasCurrentPackInstructions ? 'ok' : 'modified',
      ownershipState: inspection.state,
    };
  }

  if (record.relativePath === '.gitignore') {
    const inspection = inspectGitignoreFile(absolutePath);
    if (inspection.state === 'symlink' || inspection.state === 'malformed') {
      return {
        kind: 'conflict',
        ownershipState: inspection.state,
      };
    }

    if (inspection.state !== 'managed' || inspection.content === undefined) {
      return {
        kind: 'modified',
        ownershipState: inspection.state,
      };
    }

    const block = extractManagedGitignoreBlock(inspection.content);
    if (!block) {
      return {
        kind: 'conflict',
        ownershipState: 'malformed',
      };
    }

    return {
      kind: hashContent(block) === record.sha256 ? 'ok' : 'modified',
      ownershipState: inspection.state,
    };
  }

  return {
    kind: 'conflict',
    ownershipState: 'malformed',
  };
}

function hasUnexpectedOmaState(projectRoot: string): boolean {
  const omaRoot = path.join(projectRoot, '.oma');
  if (!existsSync(omaRoot)) {
    return false;
  }

  try {
    const stat = statSync(omaRoot);
    if (!stat.isDirectory()) {
      return true;
    }
  } catch {
    return true;
  }

  const omaEntries = readdirSync(omaRoot);
  for (const entry of omaEntries) {
    if (entry !== 'packs') {
      return true;
    }
  }

  const packsRoot = path.join(omaRoot, 'packs');
  if (!existsSync(packsRoot)) {
    return false;
  }

  try {
    const stat = statSync(packsRoot);
    if (!stat.isDirectory()) {
      return true;
    }
  } catch {
    return true;
  }

  const currentPackRoot = resolvePackRuntimeRootAbsolutePath(projectRoot);
  if (!existsSync(currentPackRoot)) {
    return false;
  }

  const currentPackEntries = readdirSync(currentPackRoot);
  for (const entry of currentPackEntries) {
    if (entry === 'state') {
      const stateRoot = path.join(currentPackRoot, 'state');
      if (!existsSync(stateRoot)) {
        continue;
      }

      const localRoot = path.join(stateRoot, 'local');
      if (!existsSync(localRoot)) {
        return true;
      }

      const localEntries = readdirSync(localRoot).filter((value) => value !== 'doctor');
      const stateEntries = readdirSync(stateRoot).filter((value) => value !== 'local');
      if (stateEntries.length > 0 || localEntries.length > 0) {
        return true;
      }
      continue;
    }

    return true;
  }

  return false;
}

function blockedNextStepForFinding(finding: DoctorFinding): string {
  if (finding.nextStep) {
    return finding.nextStep;
  }

  if (finding.path) {
    return `Repair or move aside \`${finding.path}\`, then rerun \`npx oh-my-akitagpb doctor\`.`;
  }

  return 'Inspect the findings in the doctor report, repair the conflicting state, then rerun `npx oh-my-akitagpb doctor`.';
}

function buildFreshReport(projectRoot: string, packageSurface: PackageSurface, findings: DoctorFinding[], draftBase: Omit<DoctorReportDraft, 'status' | 'reason' | 'summary' | 'nextStep' | 'findings'>): DoctorReportDraft {
  findings.push({
    code: 'install-required',
    severity: 'info',
    message: 'This repository has no pack-managed bootstrap state yet.',
    nextStep: 'Run `npx oh-my-akitagpb install` to materialize the managed bootstrap surface.',
  });

  return {
    ...draftBase,
    status: 'migrate-required',
    reason: 'install-required',
    summary: 'This repository is ready for a first bootstrap install.',
    nextStep: 'Run `npx oh-my-akitagpb install` to materialize the managed bootstrap surface.',
    findings,
  };
}

export function buildDoctorReport(projectRoot: string, packageSurface: PackageSurface): DoctorReportDraft {
  const generatedAt = new Date().toISOString();
  const installStatePath = resolveInstallStatePath(projectRoot);
  const projectModePath = resolveProjectModePath(projectRoot);
  const detectedProjectMode = classifyProjectMode(projectRoot);
  const projectModeRecord = inspectProjectModeRecord(projectRoot);
  const agentsInspection = inspectAgentsFile(path.join(projectRoot, 'AGENTS.md'));
  const opencodeInspection = inspectOpencodeConfig(path.join(projectRoot, 'opencode.json'));
  const findings: DoctorFinding[] = [];
  const ownershipConflicts: string[] = [];
  const ownedModified: string[] = [];
  const ownedMissing: string[] = [];
  const managedModified: string[] = [];

  const draftBase: Omit<DoctorReportDraft, 'status' | 'reason' | 'summary' | 'nextStep' | 'findings'> = {
    schemaVersion: 1,
    generatedAt,
    projectRoot,
    packageName: packageSurface.packageName,
    packageVersion: packageSurface.packageVersion,
    compatibility: {
      installedPackageVersion: null,
      detectedProjectMode: detectedProjectMode.mode,
      detectedReasons: detectedProjectMode.reasons,
    },
    runtime: {
      installStatePath,
      installStateStatus: 'missing',
      projectModePath,
      projectModeRecordStatus: projectModeRecord.status,
      recordedProjectMode: projectModeRecord.recordedMode,
      recordedProjectModeReasons: projectModeRecord.recordedReasons,
    },
    ownership: {
      agents: agentsInspection.state,
      opencode: opencodeInspection.state,
      conflicts: ownershipConflicts,
    },
    drift: {
      packageVersionMismatch: false,
      ownedModified,
      ownedMissing,
      managedModified,
    },
  };

  for (const [relativePath, state] of [
    ['AGENTS.md', agentsInspection.state],
    ['opencode.json', opencodeInspection.state],
  ] as const) {
    if (state === 'user-owned' || state === 'malformed' || state === 'symlink') {
      ownershipConflicts.push(relativePath);
      findings.push({
        code: `managed-surface-${state}`,
        severity: 'error',
        message: `${relativePath} is not in a pack-managed state, so install/update cannot safely claim it.`,
        path: relativePath,
        nextStep: `Repair or move aside \`${relativePath}\` until it becomes safe to manage, then rerun \`npx oh-my-akitagpb doctor\`.`,
      });
    }
  }

  if (detectedProjectMode.mode === 'fresh') {
    if (hasUnexpectedOmaState(projectRoot)) {
      ownershipConflicts.push('.oma');
      findings.push({
        code: 'partial-oma-state',
        severity: 'error',
        message: 'Partial .oma state exists without a trusted install-state ledger.',
        path: '.oma',
        nextStep: 'Move aside the partial `.oma` state before running `npx oh-my-akitagpb install`.',
      });
    }

    if (ownershipConflicts.length > 0) {
      const firstConflict = findings.find((finding) => finding.severity === 'error');
      return {
        ...draftBase,
        status: 'blocked',
        reason: firstConflict?.code ?? 'ownership-conflict',
        summary: 'Bootstrap state is not safe to install because ownership is ambiguous.',
        nextStep: firstConflict ? blockedNextStepForFinding(firstConflict) : 'Repair the conflicting ownership state, then rerun `npx oh-my-akitagpb doctor`.',
        findings,
      };
    }

    return buildFreshReport(projectRoot, packageSurface, findings, draftBase);
  }

  let installState: InstallState;
  try {
    installState = readInstallState(projectRoot);
    draftBase.runtime.installStateStatus = 'valid';
  } catch (error) {
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'install-state-invalid';
    const message = error instanceof Error ? error.message : 'The install-state ledger could not be read.';
    draftBase.runtime.installStateStatus = existsSync(installStatePath) ? 'invalid' : 'missing';
    const installStateFinding: DoctorFinding = {
      code,
      severity: 'error',
      message,
      path: INSTALL_STATE_RELATIVE_PATH,
      nextStep:
        code === 'install-state-missing'
          ? `Restore \`${INSTALL_STATE_RELATIVE_PATH}\` from a trusted copy or remove the partial bootstrap surfaces before reinstalling.`
          : `Repair \`${INSTALL_STATE_RELATIVE_PATH}\` so it contains valid ownership metadata, then rerun \`npx oh-my-akitagpb doctor\`.`,
    };
    findings.push(installStateFinding);

    return {
      ...draftBase,
      status: 'blocked',
      reason: code,
      summary: 'Managed bootstrap surfaces were detected without a trustworthy install-state ledger.',
      nextStep: blockedNextStepForFinding(installStateFinding),
      findings,
    };
  }

  draftBase.compatibility.installedPackageVersion = installState.packageVersion;

  if (path.resolve(installState.projectRoot) !== path.resolve(projectRoot)) {
    findings.push({
      code: 'install-state-project-root-mismatch',
      severity: 'error',
      message: 'The install-state ledger belongs to a different project root.',
      path: '.oma/install-state.json',
      nextStep: 'Remove the mismatched install-state ledger or reinstall the bootstrap in this repository before updating.',
    });
  }

  if (installState.packageName !== packageSurface.packageName) {
    findings.push({
      code: 'install-state-package-mismatch',
      severity: 'error',
      message: 'The install-state ledger belongs to a different bootstrap package.',
      path: '.oma/install-state.json',
      nextStep: 'Reinstall this repository with the correct bootstrap package before running update.',
    });
  }

  if (installState.packageVersion !== packageSurface.packageVersion) {
    draftBase.drift.packageVersionMismatch = true;
    findings.push({
      code: 'package-version-drift',
      severity: 'warning',
      message: `The recorded bootstrap version is ${installState.packageVersion}, but the current package is ${packageSurface.packageVersion}.`,
      path: INSTALL_STATE_RELATIVE_PATH,
    });
  }

  if (projectModeRecord.status === 'invalid') {
    findings.push({
      code: 'project-mode-invalid',
      severity: 'warning',
      message: 'The recorded runtime project-mode metadata is malformed and should be refreshed by update.',
      path: PROJECT_MODE_RELATIVE_PATH,
    });
  }

  for (const record of installState.ownedFiles) {
    const inspection = inspectOwnedFile(projectRoot, record.relativePath, record.sha256);
    if (inspection.kind === 'missing') {
      ownedMissing.push(record.relativePath);
      findings.push({
        code: 'owned-file-missing',
        severity: 'error',
        message: `${record.relativePath} is missing or no longer a normal file.`,
        path: record.relativePath,
        nextStep: `Restore \`${record.relativePath}\` from a trusted copy before running \`npx oh-my-akitagpb update\`.`,
      });
      continue;
    }

    if (inspection.kind === 'modified') {
      ownedModified.push(record.relativePath);
      findings.push({
        code: 'owned-file-drift',
        severity: 'warning',
        message: `${record.relativePath} has drifted from the recorded bootstrap content.`,
        path: record.relativePath,
      });
    }
  }

  for (const record of installState.managedSurfaces) {
    const inspection = inspectManagedSurface(projectRoot, record);
    if (inspection.kind === 'conflict') {
      ownershipConflicts.push(record.relativePath);
      findings.push({
        code: 'managed-surface-conflict',
        severity: 'error',
        message: `${record.relativePath} is no longer in a safely managed state (${inspection.ownershipState}).`,
        path: record.relativePath,
        nextStep: `Repair or move aside \`${record.relativePath}\` until it returns to a pack-managed shape, then rerun \`npx oh-my-akitagpb doctor\`.`,
      });
      continue;
    }

    if (inspection.kind === 'modified') {
      managedModified.push(record.relativePath);
      findings.push({
        code: 'managed-surface-drift',
        severity: 'warning',
        message: `${record.relativePath} still looks managed, but its content no longer matches the recorded bootstrap state.`,
        path: record.relativePath,
      });
    }
  }

  const firstError = findings.find((finding) => finding.severity === 'error');
  if (firstError) {
    return {
      ...draftBase,
      status: 'blocked',
      reason: firstError.code,
      summary: 'Bootstrap state is not safe to refresh automatically because ownership is ambiguous or required artifacts are missing.',
      nextStep: blockedNextStepForFinding(firstError),
      findings,
    };
  }

  const hasWarnings = findings.some((finding) => finding.severity === 'warning');
  if (hasWarnings) {
    return {
      ...draftBase,
      status: 'migrate-required',
      reason: 'update-recommended',
      summary: 'Bootstrap state is trusted, but explicit update work is needed to reconcile drift.',
      nextStep: 'Run `npx oh-my-akitagpb update` to refresh the recorded pack-owned surfaces.',
      findings,
    };
  }

  findings.push({
    code: 'doctor-compatible',
    severity: 'info',
    message: 'The recorded bootstrap state matches the current on-disk ownership ledger.',
  });

  return {
    ...draftBase,
    status: 'compatible',
    reason: 'doctor-compatible',
    summary: 'Bootstrap state is compatible with the current package and ownership ledger.',
    nextStep: 'No action is required. Rerun `npx oh-my-akitagpb doctor` after future manual edits or package upgrades.',
    findings,
  };
}

export function writeDoctorReport(projectRoot: string, report: DoctorReportDraft): DoctorReport {
  const reportPath = resolveDoctorReportPath(projectRoot);
  mkdirSync(path.dirname(reportPath), { recursive: true });

  const persisted: DoctorReport = {
    ...report,
    reportPath,
  };

  writeFileSync(reportPath, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');
  return persisted;
}
