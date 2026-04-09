import path from 'node:path';

import type { PackageSurface } from './asset-catalog.js';
import { PackageSurfaceError } from './asset-catalog.js';
import { type InstallState, readInstallState } from './install-state.js';
import { classifyProjectMode, type ProjectModeClassification } from './project-mode.js';

export type CompatibilityClassification = 'fresh' | 'resume' | 'update-required' | 'conflict' | 'blocked';

export interface CompatibilityAssessment {
  classification: CompatibilityClassification;
  reason: string;
  message: string;
  nextStep: string;
  details: Record<string, string>;
  projectMode: ProjectModeClassification;
  installState?: InstallState;
}

function buildAssessment(
  classification: CompatibilityClassification,
  projectMode: ProjectModeClassification,
  reason: string,
  message: string,
  nextStep: string,
  details: Record<string, string> = {},
  installState?: InstallState,
): CompatibilityAssessment {
  return {
    classification,
    reason,
    message,
    nextStep,
    details: {
      classification,
      projectMode: projectMode.mode,
      detectedManagedSurface: projectMode.reasons.join(', ') || '(none)',
      ...details,
    },
    projectMode,
    installState,
  };
}

function loadValidatedInstallState(projectRoot: string, packageSurface?: PackageSurface): InstallState {
  const installState = readInstallState(projectRoot);

  if (path.resolve(installState.projectRoot) !== path.resolve(projectRoot)) {
    throw new PackageSurfaceError('install-state-project-root-mismatch', 'The install-state ledger belongs to a different project root.', {
      installStatePath: installState.installStatePath,
      recordedProjectRoot: installState.projectRoot,
      requestedProjectRoot: projectRoot,
    });
  }

  if (packageSurface && installState.packageName !== packageSurface.packageName) {
    throw new PackageSurfaceError('install-state-package-mismatch', 'The install-state ledger belongs to a different bootstrap package.', {
      installStatePath: installState.installStatePath,
      recordedPackageName: installState.packageName,
      requestedPackageName: packageSurface.packageName,
    });
  }

  return installState;
}

function assessInitializedProject(
  command: 'install' | 'update',
  projectRoot: string,
  packageSurface?: PackageSurface,
): CompatibilityAssessment {
  const projectMode = classifyProjectMode(projectRoot);

  if (projectMode.mode === 'fresh') {
    if (command === 'install') {
      return buildAssessment(
        'fresh',
        projectMode,
        'fresh-install-ready',
        'This repository is ready for a first bootstrap install.',
        'Run `npx oh-my-pactgpb install` to materialize the managed bootstrap surface.',
      );
    }

    return buildAssessment(
      'blocked',
      projectMode,
      'update-not-initialized',
      'Update requires an existing install-state ledger and managed bootstrap surfaces.',
      'Run `npx oh-my-pactgpb install` first.',
    );
  }

  let installState: InstallState;
  try {
    installState = loadValidatedInstallState(projectRoot, packageSurface);
  } catch (error) {
    if (error instanceof PackageSurfaceError) {
      const classification = error.code === 'install-state-missing' ? 'conflict' : 'blocked';
      const message =
        classification === 'conflict'
          ? 'Managed bootstrap surfaces were detected without a trustworthy install-state ledger.'
          : error.message;
      return buildAssessment(
        classification,
        projectMode,
        error.code,
        message,
        'Run `npx oh-my-pactgpb doctor` before retrying.',
        error.details ?? {},
      );
    }

    throw error;
  }

  if (command === 'install') {
    return buildAssessment(
      'resume',
      projectMode,
      'install-already-initialized',
      'This repository already contains pack-managed bootstrap surfaces, so install will not refresh them implicitly.',
      'Run `npx oh-my-pactgpb update` to refresh or `npx oh-my-pactgpb doctor` to inspect the current state.',
      {
        installStatePath: installState.installStatePath,
        installedPackageVersion: installState.packageVersion,
        currentPackageVersion: packageSurface?.packageVersion ?? installState.packageVersion,
      },
      installState,
    );
  }

  return buildAssessment(
    'update-required',
    projectMode,
    'update-ready',
    'This repository has a trusted install-state ledger, so update can refresh recorded pack-owned artifacts.',
    'Run `npx oh-my-pactgpb update` to rematerialize recorded pack-owned surfaces.',
    {
      installStatePath: installState.installStatePath,
      installedPackageVersion: installState.packageVersion,
      currentPackageVersion: packageSurface?.packageVersion ?? installState.packageVersion,
    },
    installState,
  );
}

export function assessInstallCompatibility(projectRoot: string, packageSurface?: PackageSurface): CompatibilityAssessment {
  return assessInitializedProject('install', projectRoot, packageSurface);
}

export function assessUpdateCompatibility(projectRoot: string, packageSurface?: PackageSurface): CompatibilityAssessment {
  return assessInitializedProject('update', projectRoot, packageSurface);
}
