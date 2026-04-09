import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { hasInstallState } from './install-state.js';
import { hasManagedAgentsBlock, hasManagedOpencodeConfig } from './managed-blocks.js';

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
  return path.join(projectRoot, '.oma', 'runtime', 'local', 'project-mode.json');
}

function hasNamespacedEntries(dirPath: string): boolean {
  if (!existsSync(dirPath)) {
    return false;
  }

  const stat = lstatSync(dirPath);
  if (!stat.isDirectory()) {
    return false;
  }

  return readdirSync(dirPath).some((entry) => entry.startsWith('akita-'));
}

export function classifyProjectMode(projectRoot: string): ProjectModeClassification {
  const reasons: string[] = [];

  if (hasInstallState(projectRoot)) {
    reasons.push('.oma/install-state.json');
  }

  if (hasManagedAgentsBlock(path.join(projectRoot, 'AGENTS.md'))) {
    reasons.push('AGENTS.md managed block');
  }

  if (hasManagedOpencodeConfig(path.join(projectRoot, 'opencode.json'))) {
    reasons.push('opencode.json managed namespace');
  }

  if (hasNamespacedEntries(path.join(projectRoot, '.opencode', 'commands'))) {
    reasons.push('.opencode/commands/akita-*');
  }

  if (hasNamespacedEntries(path.join(projectRoot, '.opencode', 'skills'))) {
    reasons.push('.opencode/skills/akita-*');
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
