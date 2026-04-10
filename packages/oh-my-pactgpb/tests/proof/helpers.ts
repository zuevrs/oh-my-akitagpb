import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect } from 'vitest';

import {
  type FixtureRepo,
  invokeInstalledCli,
  parseJsonOutput,
} from '../helpers/fixture-repo.js';

export type CliResult = {
  subcommand: 'install' | 'update' | 'doctor' | 'unknown';
  status: 'ok' | 'blocked' | 'error';
  reason: string;
};

export function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

export function expectRequiredTopLevelFields(
  projectRoot: string,
  area: 'write' | 'validate',
  state: object,
): void {
  const contractPath = path.join(projectRoot, '.oma', 'packs', 'oh-my-pactgpb', 'templates', area, 'state-contract.json');
  const contract = readJsonFile<{
    requiredMachineState?: Array<{
      requiredTopLevelFields?: string[];
    }>;
  }>(contractPath);

  const requiredFields = contract.requiredMachineState?.[0]?.requiredTopLevelFields ?? [];
  for (const field of requiredFields) {
    expect(state).toHaveProperty(field);
  }
}

export function installFixture(fixture: FixtureRepo): void {
  const installResult = parseJsonOutput<CliResult>(invokeInstalledCli(fixture.rootDir, ['install']));
  expect(installResult).toMatchObject({
    subcommand: 'install',
    status: 'ok',
    reason: 'install-complete',
  });
}
