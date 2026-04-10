import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export type FixtureTemplate =
  | 'empty'
  | 'package-only'
  | 'java-service'
  | 'spring-provider-init-openapi'
  | 'spring-provider-init-codefirst'
  | 'spring-provider-init-internal'
  | 'spring-provider-init-ambiguous'
  | 'spring-pact-provider-local'
  | 'spring-pact-provider-unclear'
  | 'spring-pact-provider-broker'
  | 'spring-pact-provider-stale'
  | 'spring-pact-provider-ambiguous'
  | 'spring-pact-provider-partial';

export interface CommandExecution {
  command: string;
  args: string[];
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface FixtureRepo {
  rootDir: string;
  template: FixtureTemplate;
  cleanup: () => void;
}

export class FixtureRepoError extends Error {
  readonly code: string;
  readonly details?: Record<string, string>;

  constructor(code: string, message: string, details?: Record<string, string>) {
    super(message);
    this.name = 'FixtureRepoError';
    this.code = code;
    this.details = details;
  }
}

interface CreateFixtureRepoOptions {
  template?: FixtureTemplate;
  parentDir?: string;
  rootDir?: string;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const packLockRoot = path.join(tmpdir(), 'oh-my-pactgpb-pack-lock');
const packLockDir = path.join(packLockRoot, 'lock');
const npmCacheRoot = path.join(tmpdir(), 'oh-my-pactgpb-npm-cache');
const fixtureTemplateRoots: Partial<Record<FixtureTemplate, string>> = {
  'java-service': path.join(repoRoot, 'tests', 'fixtures', 'empty-java-service'),
  'spring-provider-init-openapi': path.join(repoRoot, 'tests', 'fixtures', 'spring-provider-init-openapi'),
  'spring-provider-init-codefirst': path.join(repoRoot, 'tests', 'fixtures', 'spring-provider-init-codefirst'),
  'spring-provider-init-internal': path.join(repoRoot, 'tests', 'fixtures', 'spring-provider-init-internal'),
  'spring-provider-init-ambiguous': path.join(repoRoot, 'tests', 'fixtures', 'spring-provider-init-ambiguous'),
  'spring-pact-provider-local': path.join(repoRoot, 'tests', 'fixtures', 'spring-pact-provider-local'),
  'spring-pact-provider-unclear': path.join(repoRoot, 'tests', 'fixtures', 'spring-pact-provider-unclear'),
  'spring-pact-provider-broker': path.join(repoRoot, 'tests', 'fixtures', 'spring-pact-provider-broker'),
  'spring-pact-provider-stale': path.join(repoRoot, 'tests', 'fixtures', 'spring-pact-provider-stale'),
  'spring-pact-provider-ambiguous': path.join(repoRoot, 'tests', 'fixtures', 'spring-pact-provider-ambiguous'),
  'spring-pact-provider-partial': path.join(repoRoot, 'tests', 'fixtures', 'spring-pact-provider-partial'),
};
let packedTarballPath: string | undefined;

function runCommand(command: string, args: string[], cwd: string, rejectOnNonZero: boolean = true): CommandExecution {
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
  const execution: CommandExecution = {
    command,
    args,
    cwd,
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    durationMs,
  };

  if (result.error) {
    throw new FixtureRepoError('command-launch-failed', `Failed to launch ${command}.`, {
      command,
      cwd,
      cause: result.error.message,
    });
  }

  if (rejectOnNonZero && execution.exitCode !== 0) {
    throw new FixtureRepoError('command-failed', `${command} ${args.join(' ')} failed with exit code ${execution.exitCode}.`, {
      command,
      cwd,
      exitCode: String(execution.exitCode),
      stdout: execution.stdout,
      stderr: execution.stderr,
    });
  }

  return execution;
}

function prepareFixtureRoot(rootDir: string): void {
  rmSync(rootDir, { recursive: true, force: true });
  mkdirSync(rootDir, { recursive: true });
}

function sleepMs(durationMs: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, durationMs);
}

function acquirePackLock(timeoutMs: number = 60_000): void {
  mkdirSync(packLockRoot, { recursive: true });
  const startedAt = Date.now();

  while (true) {
    try {
      mkdirSync(packLockDir);
      return;
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String(error.code) : 'unknown';
      if (code !== 'EEXIST') {
        throw error;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        throw new FixtureRepoError('pack-lock-timeout', 'Timed out waiting for the local npm pack lock.', {
          lockPath: packLockDir,
          timeoutMs: String(timeoutMs),
        });
      }

      sleepMs(50);
    }
  }
}

function releasePackLock(): void {
  rmSync(packLockDir, { recursive: true, force: true });
}

function writeFixtureFiles(rootDir: string, template: FixtureTemplate): void {
  if (template === 'package-only') {
    writeFileSync(
      path.join(rootDir, 'package.json'),
      `${JSON.stringify(
        {
          name: 'fixture-package-only',
          private: true,
          version: '0.0.0',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    return;
  }

  const templateRoot = fixtureTemplateRoots[template];
  if (templateRoot) {
    cpSync(templateRoot, rootDir, {
      recursive: true,
    });
  }
}

export function createFixtureRepo(options: CreateFixtureRepoOptions = {}): FixtureRepo {
  const template = options.template ?? 'java-service';
  const parentDir = options.parentDir ?? path.join(tmpdir(), 'oh-my-pactgpb-tests-');

  try {
    const rootDir = options.rootDir ?? mkdtempSync(parentDir);
    if (options.rootDir) {
      prepareFixtureRoot(rootDir);
    }
    writeFixtureFiles(rootDir, template);

    return {
      rootDir,
      template,
      cleanup: () => {
        rmSync(rootDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    throw new FixtureRepoError('fixture-setup-failed', 'Failed to create fixture repository.', {
      template,
      parentDir,
      cause: error instanceof Error ? error.message : 'unknown failure',
    });
  }
}

export function packLocalPackage(): string {
  if (packedTarballPath && existsSync(packedTarballPath)) {
    return packedTarballPath;
  }

  acquirePackLock();
  try {
    if (packedTarballPath && existsSync(packedTarballPath)) {
      return packedTarballPath;
    }

    const packDestination = mkdtempSync(path.join(tmpdir(), 'oh-my-pactgpb-pack-'));
    const execution = runCommand('npm', ['pack', '--json', '--pack-destination', packDestination], repoRoot);
    let parsed: unknown;

    try {
      parsed = JSON.parse(execution.stdout);
    } catch (error) {
      throw new FixtureRepoError('pack-output-invalid', 'npm pack did not return valid JSON.', {
        stdout: execution.stdout,
        stderr: execution.stderr,
        cause: error instanceof Error ? error.message : 'unknown parse failure',
      });
    }

    const packEntries = Array.isArray(parsed) ? parsed : undefined;
    const firstEntry = packEntries?.[0];
    const filename =
      firstEntry && typeof firstEntry === 'object' && 'filename' in firstEntry && typeof firstEntry.filename === 'string'
        ? firstEntry.filename
        : undefined;

    if (typeof filename !== 'string') {
      throw new FixtureRepoError('pack-output-missing-filename', 'npm pack JSON did not include a tarball filename.', {
        stdout: execution.stdout,
      });
    }

    packedTarballPath = path.join(packDestination, filename);
    return packedTarballPath;
  } finally {
    releasePackLock();
  }
}

export function installPackedPackage(fixtureRoot: string): CommandExecution {
  const tarballPath = packLocalPackage();
  return runCommand('npm', ['install', '--no-fund', '--no-audit', '-D', tarballPath], fixtureRoot);
}

export function invokeInstalledCli(
  fixtureRoot: string,
  args: readonly string[],
  options: { rejectOnNonZero?: boolean } = {},
): CommandExecution {
  return runCommand('npx', ['oh-my-pactgpb', ...args], fixtureRoot, options.rejectOnNonZero ?? false);
}

export function createInstalledFixture(options: CreateFixtureRepoOptions = {}): FixtureRepo {
  const fixture = createFixtureRepo(options);
  installPackedPackage(fixture.rootDir);
  return fixture;
}

export function parseJsonOutput<T>(execution: CommandExecution): T {
  try {
    return JSON.parse(execution.stdout) as T;
  } catch (error) {
    throw new FixtureRepoError('cli-output-invalid', 'CLI output was not valid JSON.', {
      stdout: execution.stdout,
      stderr: execution.stderr,
      cause: error instanceof Error ? error.message : 'unknown parse failure',
    });
  }
}
