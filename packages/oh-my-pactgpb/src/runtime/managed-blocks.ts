import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

import { PackageSurfaceError } from './asset-catalog.js';

export const AGENTS_MANAGED_BLOCK_ID = 'oh-my-akitagpb';

const REQUIRED_OPENCODE_MANAGED_INSTRUCTIONS = [
  'AGENTS.md',
  '.oma/instructions/rules/manifest-first.md',
  '.oma/instructions/rules/default-language-russian.md',
  '.oma/instructions/rules/never-invent-steps.md',
  '.oma/instructions/rules/redact-shared-state.md',
  '.oma/instructions/rules/prefer-existing-prior-art.md',
  '.oma/instructions/rules/explicit-unsupported.md',
  '.oma/instructions/rules/respect-pack-ownership.md',
] as const;
const MANAGED_OPENCODE_RULE_PREFIX = '.oma/instructions/rules/';

function hasPackManagedOpencodeSignature(instructions: readonly string[]): boolean {
  const instructionSet = new Set(instructions);
  if (!instructionSet.has('AGENTS.md')) {
    return false;
  }

  return instructions.some((instruction) => instruction.startsWith(MANAGED_OPENCODE_RULE_PREFIX));
}

export type ManagedSurfaceState = 'missing' | 'empty' | 'managed' | 'user-owned' | 'malformed' | 'symlink';

export interface ManagedSurfaceInspection {
  state: ManagedSurfaceState;
  content?: string;
}

export interface ManagedSurfaceWriteResult {
  relativePath: string;
  sha256: string;
  manager: 'agents-markdown' | 'opencode-json' | 'gitignore-block';
}

export interface ManagedOpencodePayload {
  packageName: string;
  packageVersion: string;
  instructions: readonly string[];
  commands: readonly string[];
  skills: readonly string[];
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function createAgentsBeginMarker(blockId: string = AGENTS_MANAGED_BLOCK_ID): string {
  return `<!-- ${blockId}:begin -->`;
}

function createAgentsEndMarker(blockId: string = AGENTS_MANAGED_BLOCK_ID): string {
  return `<!-- ${blockId}:end -->`;
}

function countOccurrences(content: string, marker: string): number {
  return content.split(marker).length - 1;
}

function resolveTrailingNewlineIndex(content: string, index: number): number {
  if (content[index] === '\r' && content[index + 1] === '\n') {
    return index + 2;
  }

  if (content[index] === '\n') {
    return index + 1;
  }

  return index;
}

function inspectAgentsContent(content: string, blockId: string = AGENTS_MANAGED_BLOCK_ID): ManagedSurfaceInspection {
  if (content.trim().length === 0) {
    return { state: 'empty', content };
  }

  const beginMarker = createAgentsBeginMarker(blockId);
  const endMarker = createAgentsEndMarker(blockId);
  const beginCount = countOccurrences(content, beginMarker);
  const endCount = countOccurrences(content, endMarker);

  if (beginCount === 0 && endCount === 0) {
    return { state: 'user-owned', content };
  }

  if (beginCount !== 1 || endCount !== 1 || content.indexOf(beginMarker) > content.indexOf(endMarker)) {
    return { state: 'malformed', content };
  }

  return { state: 'managed', content };
}

export function inspectAgentsFile(filePath: string, blockId: string = AGENTS_MANAGED_BLOCK_ID): ManagedSurfaceInspection {
  if (!existsSync(filePath)) {
    return { state: 'missing' };
  }

  const stat = lstatSync(filePath);
  if (stat.isSymbolicLink()) {
    return { state: 'symlink' };
  }

  return inspectAgentsContent(readFileSync(filePath, 'utf8'), blockId);
}

export function extractManagedAgentsBlock(content: string, blockId: string = AGENTS_MANAGED_BLOCK_ID): string | null {
  const inspection = inspectAgentsContent(content, blockId);
  if (inspection.state !== 'managed') {
    return null;
  }

  const beginMarker = createAgentsBeginMarker(blockId);
  const endMarker = createAgentsEndMarker(blockId);
  const startIndex = content.indexOf(beginMarker);
  const endIndex = content.indexOf(endMarker);

  if (startIndex < 0 || endIndex < 0 || startIndex > endIndex) {
    return null;
  }

  const blockEndIndex = resolveTrailingNewlineIndex(content, endIndex + endMarker.length);
  return content.slice(startIndex, blockEndIndex);
}

export function renderManagedAgentsBlock(packageName: string, packageVersion: string, commands: readonly string[]): string {
  const beginMarker = createAgentsBeginMarker();
  const endMarker = createAgentsEndMarker();
  const lines = [
    beginMarker,
    '# Oh My AkitaGPB bootstrap',
    '',
    `Installed from \`${packageName}@${packageVersion}\`.`,
    '',
    'Pack-owned runtime lives under `.oma/` and `.opencode/`.',
    'Use `npx oh-my-akitagpb update` to refresh managed surfaces and `npx oh-my-akitagpb doctor` to inspect conflicts.',
    '',
    'Available commands:',
    ...commands.map((command) => `- \`/${command}\``),
    endMarker,
  ];

  return `${lines.join('\n')}\n`;
}

function buildManagedAgentsContent(
  inspection: ManagedSurfaceInspection,
  packageName: string,
  packageVersion: string,
  commands: readonly string[],
): string {
  const block = renderManagedAgentsBlock(packageName, packageVersion, commands);

  if (inspection.state === 'missing' || inspection.state === 'empty') {
    return block;
  }

  if (inspection.state === 'managed') {
    const beginMarker = createAgentsBeginMarker();
    const endMarker = createAgentsEndMarker();
    const source = inspection.content ?? '';
    const startIndex = source.indexOf(beginMarker);
    const endIndex = source.indexOf(endMarker);
    const trailingIndex = endIndex + endMarker.length;
    let nextContent = `${source.slice(0, startIndex)}${block.trimEnd()}${source.slice(trailingIndex)}`;
    if (!nextContent.endsWith('\n')) {
      nextContent = `${nextContent}\n`;
    }
    return nextContent;
  }

  if (inspection.state === 'symlink') {
    throw new PackageSurfaceError('agents-managed-block-symlink', 'AGENTS.md is a symlink, so ownership is unsafe.', {
      nextStep: 'Run `npx oh-my-akitagpb doctor` after replacing the symlink with a normal file.',
    });
  }

  if (inspection.state === 'malformed') {
    throw new PackageSurfaceError('agents-managed-block-malformed', 'AGENTS.md contains malformed oh-my-akitagpb managed markers.', {
      nextStep: 'Run `npx oh-my-akitagpb doctor` to inspect and repair the managed surface safely.',
    });
  }

  throw new PackageSurfaceError('agents-managed-block-conflict', 'AGENTS.md already contains user-owned content outside the pack-managed block.', {
    nextStep: 'Move the existing instructions aside or merge them manually before reinstalling.',
  });
}

export function renderManagedAgentsFileContent(currentContent: string, packageName: string, packageVersion: string, commands: readonly string[]): string {
  const inspection = inspectAgentsContent(currentContent);
  if (inspection.state !== 'managed') {
    throw new PackageSurfaceError('agents-managed-block-conflict', 'AGENTS.md is not in a managed state, so update cannot safely rewrite it.', {
      nextStep: 'Run `npx oh-my-akitagpb doctor` to inspect and repair the managed surface safely.',
    });
  }

  return buildManagedAgentsContent(inspection, packageName, packageVersion, commands);
}

export function applyManagedAgentsBlock(
  filePath: string,
  packageName: string,
  packageVersion: string,
  commands: readonly string[],
): ManagedSurfaceWriteResult {
  const inspection = inspectAgentsFile(filePath);
  const nextContent = buildManagedAgentsContent(inspection, packageName, packageVersion, commands);
  const block = renderManagedAgentsBlock(packageName, packageVersion, commands);

  writeFileSync(filePath, nextContent, 'utf8');
  return {
    relativePath: 'AGENTS.md',
    sha256: hashContent(block),
    manager: 'agents-markdown',
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function inspectOpencodeContent(content: string): ManagedSurfaceInspection {
  if (content.trim().length === 0) {
    return { state: 'empty', content };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { state: 'malformed', content };
  }

  if (!isPlainObject(parsed)) {
    return { state: 'malformed', content };
  }

  const instructions = Array.isArray(parsed.instructions)
    ? parsed.instructions.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const hasManagedInstructions = hasPackManagedOpencodeSignature(instructions);

  return { state: hasManagedInstructions ? 'managed' : 'user-owned', content };
}

export function inspectOpencodeConfig(filePath: string): ManagedSurfaceInspection {
  if (!existsSync(filePath)) {
    return { state: 'missing' };
  }

  const stat = lstatSync(filePath);
  if (stat.isSymbolicLink()) {
    return { state: 'symlink' };
  }

  return inspectOpencodeContent(readFileSync(filePath, 'utf8'));
}

function mergeInstructionList(existingValue: unknown, managedInstructions: readonly string[]): string[] {
  const seeded = Array.isArray(existingValue)
    ? existingValue.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const merged = new Set(seeded);
  for (const instruction of managedInstructions) {
    merged.add(instruction);
  }

  return [...merged];
}

function buildManagedOpencodeContent(inspection: ManagedSurfaceInspection, payload: ManagedOpencodePayload): string {
  let document: Record<string, unknown>;

  if (inspection.state === 'missing' || inspection.state === 'empty') {
    document = {
      $schema: 'https://opencode.ai/config.json',
    };
  } else if (inspection.state === 'managed') {
    const parsed = JSON.parse(inspection.content ?? '{}');
    if (!isPlainObject(parsed)) {
      throw new PackageSurfaceError('opencode-config-malformed', 'opencode.json contains malformed managed wiring.', {
        nextStep: 'Run `npx oh-my-akitagpb doctor` to inspect the config safely.',
      });
    }
    document = parsed;
  } else if (inspection.state === 'symlink') {
    throw new PackageSurfaceError('opencode-config-symlink', 'opencode.json is a symlink, so ownership is unsafe.', {
      nextStep: 'Replace the symlink with a normal file before reinstalling.',
    });
  } else if (inspection.state === 'malformed') {
    throw new PackageSurfaceError('opencode-config-malformed', 'opencode.json is not valid JSON.', {
      nextStep: 'Fix the JSON or run `npx oh-my-akitagpb doctor` before reinstalling.',
    });
  } else {
    throw new PackageSurfaceError('opencode-config-conflict', 'opencode.json already exists without the pack-managed namespace.', {
      nextStep: 'Move the existing config aside or merge it manually before reinstalling.',
    });
  }

  document.instructions = mergeInstructionList(document.instructions, payload.instructions);

  return `${JSON.stringify(document, null, 2)}\n`;
}

export function renderManagedOpencodeContent(currentContent: string, payload: ManagedOpencodePayload): string {
  const inspection = inspectOpencodeContent(currentContent);
  if (inspection.state !== 'managed') {
    throw new PackageSurfaceError('opencode-config-conflict', 'opencode.json is not in a managed state, so update cannot safely rewrite it.', {
      nextStep: 'Run `npx oh-my-akitagpb doctor` to inspect the config safely.',
    });
  }

  return buildManagedOpencodeContent(inspection, payload);
}

export function applyManagedOpencodeConfig(filePath: string, payload: ManagedOpencodePayload): ManagedSurfaceWriteResult {
  const inspection = inspectOpencodeConfig(filePath);
  const rendered = buildManagedOpencodeContent(inspection, payload);

  writeFileSync(filePath, rendered, 'utf8');

  return {
    relativePath: 'opencode.json',
    sha256: hashContent(rendered),
    manager: 'opencode-json',
  };
}

export function hasManagedAgentsBlock(filePath: string): boolean {
  return inspectAgentsFile(filePath).state === 'managed';
}

export function hasManagedOpencodeConfig(filePath: string): boolean {
  return inspectOpencodeConfig(filePath).state === 'managed';
}
