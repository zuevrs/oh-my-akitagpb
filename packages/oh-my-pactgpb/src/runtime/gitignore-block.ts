import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';

import { PackageSurfaceError } from './asset-catalog.js';
import { hashContent, type ManagedSurfaceInspection } from './managed-blocks.js';

export const GITIGNORE_MANAGED_BLOCK_ID = 'oh-my-pactgpb';

const DURABLE_SURFACE_UNIGNORE_PATTERNS = [
  '!AGENTS.md',
  '!opencode.json',
  '!.opencode/',
  '!.opencode/commands/',
  '!.opencode/commands/pact-*.md',
  '!.opencode/skills/',
  '!.opencode/skills/pact-*/',
  '!.opencode/skills/pact-*/**',
  '!.oma/',
  '!.oma/capability-manifest.json',
  '!.oma/instructions/',
  '!.oma/instructions/rules/',
  '!.oma/instructions/rules/**',
  '!.oma/templates/',
  '!.oma/templates/**',
  '!.oma/runtime/',
  '!.oma/runtime/shared/',
  '!.oma/runtime/shared/**',
  '!.oma/state/',
  '!.oma/state/shared/',
  '!.oma/state/shared/**',
] as const;

const LOCAL_ONLY_IGNORE_PATTERNS = [
  '.oma/install-state.json',
  '.oma/runtime/local/',
  '.oma/state/local/',
  '.oma/generated/',
] as const;

function createGitignoreBeginMarker(blockId: string = GITIGNORE_MANAGED_BLOCK_ID): string {
  return `# ${blockId}:begin`;
}

function createGitignoreEndMarker(blockId: string = GITIGNORE_MANAGED_BLOCK_ID): string {
  return `# ${blockId}:end`;
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

function inspectGitignoreContent(content: string, blockId: string = GITIGNORE_MANAGED_BLOCK_ID): ManagedSurfaceInspection {
  if (content.trim().length === 0) {
    return { state: 'empty', content };
  }

  const beginMarker = createGitignoreBeginMarker(blockId);
  const endMarker = createGitignoreEndMarker(blockId);
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

export function inspectGitignoreFile(filePath: string, blockId: string = GITIGNORE_MANAGED_BLOCK_ID): ManagedSurfaceInspection {
  if (!existsSync(filePath)) {
    return { state: 'missing' };
  }

  const stat = lstatSync(filePath);
  if (stat.isSymbolicLink()) {
    return { state: 'symlink' };
  }

  return inspectGitignoreContent(readFileSync(filePath, 'utf8'), blockId);
}

export function extractManagedGitignoreBlock(content: string, blockId: string = GITIGNORE_MANAGED_BLOCK_ID): string | null {
  const inspection = inspectGitignoreContent(content, blockId);
  if (inspection.state !== 'managed') {
    return null;
  }

  const beginMarker = createGitignoreBeginMarker(blockId);
  const endMarker = createGitignoreEndMarker(blockId);
  const startIndex = content.indexOf(beginMarker);
  const endIndex = content.indexOf(endMarker);

  if (startIndex < 0 || endIndex < 0 || startIndex > endIndex) {
    return null;
  }

  const blockEndIndex = resolveTrailingNewlineIndex(content, endIndex + endMarker.length);
  return content.slice(startIndex, blockEndIndex);
}

export function renderManagedGitignoreBlock(): string {
  const beginMarker = createGitignoreBeginMarker();
  const endMarker = createGitignoreEndMarker();
  const lines = [
    beginMarker,
    '# Pack-managed VCS policy for oh-my-pactgpb.',
    '# Commit durable pack surfaces and shared workflow state.',
    '# Ignore only local machine state, local execution reports, and generated staging artifacts.',
    ...DURABLE_SURFACE_UNIGNORE_PATTERNS,
    ...LOCAL_ONLY_IGNORE_PATTERNS,
    endMarker,
  ];

  return `${lines.join('\n')}\n`;
}

function buildManagedGitignoreContent(inspection: ManagedSurfaceInspection): string {
  const block = renderManagedGitignoreBlock();

  if (inspection.state === 'missing' || inspection.state === 'empty') {
    return block;
  }

  if (inspection.state === 'user-owned') {
    const currentContent = inspection.content ?? '';
    const separator = currentContent.endsWith('\n') ? '\n' : '\n\n';
    return `${currentContent}${separator}${block}`;
  }

  if (inspection.state === 'managed') {
    const beginMarker = createGitignoreBeginMarker();
    const endMarker = createGitignoreEndMarker();
    const source = inspection.content ?? '';
    const startIndex = source.indexOf(beginMarker);
    const endIndex = source.indexOf(endMarker);
    const trailingIndex = resolveTrailingNewlineIndex(source, endIndex + endMarker.length);
    let nextContent = `${source.slice(0, startIndex)}${block.trimEnd()}${source.slice(trailingIndex)}`;
    if (!nextContent.endsWith('\n')) {
      nextContent = `${nextContent}\n`;
    }
    return nextContent;
  }

  if (inspection.state === 'symlink') {
    throw new PackageSurfaceError('gitignore-managed-block-symlink', '.gitignore is a symlink, so the pack-managed ignore block is unsafe.', {
      nextStep: 'Replace the symlink with a normal file before running install or update again.',
    });
  }

  throw new PackageSurfaceError('gitignore-managed-block-malformed', '.gitignore contains malformed oh-my-pactgpb managed markers.', {
    nextStep: 'Repair or remove the malformed managed block before running install or update again.',
  });
}

export function renderManagedGitignoreFileContent(currentContent: string): string {
  return buildManagedGitignoreContent(inspectGitignoreContent(currentContent));
}

export function applyManagedGitignoreBlock(filePath: string) {
  const inspection = inspectGitignoreFile(filePath);
  const rendered = buildManagedGitignoreContent(inspection);
  const block = renderManagedGitignoreBlock();

  writeFileSync(filePath, rendered, 'utf8');

  return {
    relativePath: '.gitignore',
    sha256: hashContent(block),
    manager: 'gitignore-block' as const,
  };
}

export function hasManagedGitignoreBlock(filePath: string): boolean {
  return inspectGitignoreFile(filePath).state === 'managed';
}
