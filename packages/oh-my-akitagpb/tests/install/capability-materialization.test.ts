import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createAssetCatalog,
  PackageSurfaceError,
  resolveCapabilityBundleAssetFiles,
} from '../../src/runtime/asset-catalog.js';
import {
  createInstalledFixture,
  type FixtureRepo,
  invokeInstalledCli,
  parseJsonOutput,
} from '../helpers/fixture-repo.js';

type CliResult = {
  subcommand: 'install' | 'update' | 'doctor' | 'unknown';
  status: 'ok' | 'blocked' | 'error';
  reason: string;
};

type InstallState = {
  schemaVersion: 1;
  ownedFiles: Array<{ relativePath: string }>;
};

type CapabilityManifest = {
  activeCapabilityBundles: Array<{
    bundleId: string;
    skillPath: string;
    references: Record<string, string>;
  }>;
};

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const fixtures: FixtureRepo[] = [];
const tempRoots: string[] = [];

function trackFixture<T extends FixtureRepo>(fixture: T): T {
  fixtures.push(fixture);
  return fixture;
}

function trackTempRoot(rootDir: string): string {
  tempRoots.push(rootDir);
  return rootDir;
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function listBundleRuntimePaths(manifest: CapabilityManifest): string[] {
  return manifest.activeCapabilityBundles.flatMap((bundle) => [bundle.skillPath, ...Object.values(bundle.references)]);
}

function createAssetFixtureRoot(): string {
  const rootDir = trackTempRoot(mkdtempSync(path.join(tmpdir(), 'oh-my-akitagpb-capability-assets-')));
  cpSync(path.join(repoRoot, 'assets', 'oma'), path.join(rootDir, 'assets', 'oma'), { recursive: true });
  cpSync(path.join(repoRoot, 'assets', 'opencode'), path.join(rootDir, 'assets', 'opencode'), { recursive: true });
  return rootDir;
}

function readWorkflowSkill(workflowId: string): string {
  return readFileSync(path.join(repoRoot, 'assets', 'opencode', 'skills', workflowId, 'SKILL.md'), 'utf8');
}

afterEach(() => {
  while (fixtures.length > 0) {
    fixtures.pop()?.cleanup();
  }

  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop() ?? '', { recursive: true, force: true });
  }
});

describe('capability materialization', () => {
  it('materializes every manifest-listed capability bundle file on fresh install without claiming unrelated user-owned skills', () => {
    const fixture = trackFixture(createInstalledFixture({ template: 'java-service' }));
    const userSkillPath = path.join(fixture.rootDir, '.opencode', 'skills', 'user-owned-skill', 'SKILL.md');
    mkdirSync(path.dirname(userSkillPath), { recursive: true });
    writeFileSync(userSkillPath, '# user owned\n', 'utf8');

    const execution = invokeInstalledCli(fixture.rootDir, ['install']);
    const result = parseJsonOutput<CliResult>(execution);
    const manifestPath = path.join(fixture.rootDir, '.oma', 'capability-manifest.json');
    const installStatePath = path.join(fixture.rootDir, '.oma', 'install-state.json');
    const manifest = readJsonFile<CapabilityManifest>(manifestPath);
    const installState = readJsonFile<InstallState>(installStatePath);
    const manifestRuntimePaths = listBundleRuntimePaths(manifest);

    expect(execution.exitCode).toBe(0);
    expect(result).toMatchObject({
      subcommand: 'install',
      status: 'ok',
      reason: 'install-complete',
    });

    for (const runtimePath of manifestRuntimePaths) {
      expect(existsSync(path.join(fixture.rootDir, runtimePath)), runtimePath).toBe(true);
      expect(installState.ownedFiles.some((file) => file.relativePath === runtimePath), runtimePath).toBe(true);
    }

    const installedCapabilitySkillDirs = readdirSync(path.join(fixture.rootDir, '.opencode', 'skills')).filter((entry) =>
      entry.startsWith('akita-capability-'),
    );

    expect(installedCapabilitySkillDirs.sort()).toEqual(
      manifest.activeCapabilityBundles.map((bundle) => bundle.bundleId).sort(),
    );
    expect(readFileSync(userSkillPath, 'utf8')).toBe('# user owned\n');
    expect(installState.ownedFiles.some((file) => file.relativePath === '.opencode/skills/user-owned-skill/SKILL.md')).toBe(false);
  });

  it('fails when the capability manifest contains duplicate bundle ids', () => {
    const packageRoot = createAssetFixtureRoot();
    const manifestPath = path.join(packageRoot, 'assets', 'oma', 'capability-manifest.json');
    const manifest = readJsonFile<CapabilityManifest>(manifestPath);
    manifest.activeCapabilityBundles = [manifest.activeCapabilityBundles[0]!, manifest.activeCapabilityBundles[0]!];
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    try {
      resolveCapabilityBundleAssetFiles(createAssetCatalog(packageRoot));
      throw new Error('expected duplicate bundle ids to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(PackageSurfaceError);
      expect((error as PackageSurfaceError).code).toBe('capability-manifest-invalid');
    }
  });

  it('fails when a manifest-listed bundle file is missing from the shipped assets', () => {
    const packageRoot = createAssetFixtureRoot();
    const missingAssetPath = path.join(
      packageRoot,
      'assets',
      'opencode',
      'skills',
      'akita-capability-akita-gpb-core-module-c795936046e',
      'references',
      'examples.json',
    );
    rmSync(missingAssetPath);

    try {
      resolveCapabilityBundleAssetFiles(createAssetCatalog(packageRoot));
      throw new Error('expected missing bundle asset to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(PackageSurfaceError);
      expect((error as PackageSurfaceError).code).toBe('asset-file-missing');
    }
  });

  it('fails when the capability manifest points at a stale bundle path', () => {
    const packageRoot = createAssetFixtureRoot();
    const manifestPath = path.join(packageRoot, 'assets', 'oma', 'capability-manifest.json');
    const manifest = readJsonFile<CapabilityManifest>(manifestPath);
    manifest.activeCapabilityBundles[0]!.references.examples = '.opencode/skills/akita-capability-akita-gpb-core-module-c795936046e/references/examples-stale.json';
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    try {
      resolveCapabilityBundleAssetFiles(createAssetCatalog(packageRoot));
      throw new Error('expected stale bundle path to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(PackageSurfaceError);
      expect((error as PackageSurfaceError).code).toBe('capability-manifest-invalid');
    }
  });
});

describe('workflow capability loading instructions', () => {
  it('require manifest-first bundle resolution and explicit stop conditions', () => {
    for (const workflowId of [
      'akita-scan-workflow',
      'akita-plan-workflow',
      'akita-write-workflow',
      'akita-validate-workflow',
    ] as const) {
      const skill = readWorkflowSkill(workflowId);
      expect(skill, workflowId).toContain('.oma/capability-manifest.json');
      expect(skill, workflowId).toMatch(/resolve every manifest-listed capability bundle|resolve every manifest-listed `activeCapabilityBundles/i);
      expect(skill, workflowId).toMatch(/stop/i);
      expect(skill, workflowId).toMatch(/unsupported|missing/);
    }
  });
});
