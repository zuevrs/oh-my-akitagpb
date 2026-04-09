import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { hasInstallState } from './install-state.js';
import { resolveProjectModeAbsolutePath } from './layout.js';

export type ProjectMode = 'fresh' | 'resume';

export interface ProjectModeClassification {
  mode: ProjectMode;
  reasons: readonly string[];
}

export interface ProjectModeRecord extends ProjectModeClassification {
  schemaVersion: 1;
  classifiedAt: string;
  projectRoot: string;
}

export function resolveProjectModePath(projectRoot: string): string {
  return resolveProjectModeAbsolutePath(projectRoot);
}

function hasNamespacedEntries(dirPath: string): boolean {
  if (!existsSync(dirPath)) {
    return false;
  }

  const stat = lstatSync(dirPath);
  if (!stat.isDirectory()) {
    return false;
  }

  return readdirSync(dirPath).some((entry) => entry.startsWith('pact-'));
}

export function classifyProjectMode(projectRoot: string): ProjectModeClassification {
  const reasons: string[] = [];

  if (hasInstallState(projectRoot)) {
    reasons.push('pack install-state ledger');
  }

  if (hasNamespacedEntries(path.join(projectRoot, '.opencode', 'commands'))) {
    reasons.push('.opencode/commands/pact-*');
  }

  if (hasNamespacedEntries(path.join(projectRoot, '.opencode', 'skills'))) {
    reasons.push('.opencode/skills/pact-*');
  }

  return {
    mode: reasons.length === 0 ? 'fresh' : 'resume',
    reasons,
  };
}

export function readProjectModeRecord(projectRoot: string): ProjectModeRecord | null {
  const projectModePath = resolveProjectModePath(projectRoot);
  if (!existsSync(projectModePath)) {
    return null;
  }

  const stat = lstatSync(projectModePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(projectModePath, 'utf8')) as Partial<ProjectModeRecord>;
    if (
      parsed.schemaVersion !== 1 ||
      (parsed.mode !== 'fresh' && parsed.mode !== 'resume') ||
      !Array.isArray(parsed.reasons) ||
      !parsed.reasons.every((reason) => typeof reason === 'string') ||
      typeof parsed.classifiedAt !== 'string' ||
      typeof parsed.projectRoot !== 'string'
    ) {
      return null;
    }

    return parsed as ProjectModeRecord;
  } catch {
    return null;
  }
}

export function createProjectModeRecord(
  projectRoot: string,
  classification: ProjectModeClassification,
  classifiedAt: string = new Date().toISOString(),
): ProjectModeRecord {
  return {
    schemaVersion: 1,
    mode: classification.mode,
    reasons: classification.reasons,
    classifiedAt,
    projectRoot,
  };
}

export function writeProjectModeRecord(projectRoot: string, classification: ProjectModeClassification): ProjectModeRecord {
  const projectModePath = resolveProjectModePath(projectRoot);
  mkdirSync(path.dirname(projectModePath), { recursive: true });

  const existingRecord = readProjectModeRecord(projectRoot);
  const classifiedAt =
    existingRecord &&
    existingRecord.mode === classification.mode &&
    existingRecord.reasons.join('\u0000') === classification.reasons.join('\u0000')
      ? existingRecord.classifiedAt
      : new Date().toISOString();

  const record = createProjectModeRecord(projectRoot, classification, classifiedAt);
  writeFileSync(projectModePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return record;
}
