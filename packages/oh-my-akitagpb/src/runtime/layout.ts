import path from 'node:path';

export const PACK_NAME = 'oh-my-akitagpb';
export const PACK_RUNTIME_ROOT = `.oma/packs/${PACK_NAME}`;
export const PACK_RUNTIME_ROOT_ABSOLUTE = (projectRoot: string): string => path.join(projectRoot, '.oma', 'packs', PACK_NAME);

export const CAPABILITY_MANIFEST_RELATIVE_PATH = `${PACK_RUNTIME_ROOT}/capability-manifest.json`;
export const INSTALL_STATE_RELATIVE_PATH = `${PACK_RUNTIME_ROOT}/install-state.json`;
export const PROJECT_MODE_RELATIVE_PATH = `${PACK_RUNTIME_ROOT}/runtime/local/project-mode.json`;
export const DOCTOR_REPORT_RELATIVE_PATH = `${PACK_RUNTIME_ROOT}/state/local/doctor/doctor-report.json`;
export const VERSION_RELATIVE_PATH = `${PACK_RUNTIME_ROOT}/runtime/shared/version.json`;
export const DATA_HANDLING_POLICY_RELATIVE_PATH = `${PACK_RUNTIME_ROOT}/runtime/shared/data-handling-policy.json`;
export const INSTRUCTIONS_ROOT_RELATIVE_PATH = `${PACK_RUNTIME_ROOT}/instructions`;
export const INSTRUCTION_RULES_ROOT_RELATIVE_PATH = `${INSTRUCTIONS_ROOT_RELATIVE_PATH}/rules`;
export const TEMPLATES_ROOT_RELATIVE_PATH = `${PACK_RUNTIME_ROOT}/templates`;
export const STATE_SHARED_ROOT_RELATIVE_PATH = `${PACK_RUNTIME_ROOT}/state/shared`;
export const STATE_LOCAL_ROOT_RELATIVE_PATH = `${PACK_RUNTIME_ROOT}/state/local`;
export const GENERATED_ROOT_RELATIVE_PATH = `${PACK_RUNTIME_ROOT}/generated`;

export function resolveInstallStateAbsolutePath(projectRoot: string): string {
  return path.join(projectRoot, INSTALL_STATE_RELATIVE_PATH);
}

export function resolveProjectModeAbsolutePath(projectRoot: string): string {
  return path.join(projectRoot, PROJECT_MODE_RELATIVE_PATH);
}

export function resolveDoctorReportAbsolutePath(projectRoot: string): string {
  return path.join(projectRoot, DOCTOR_REPORT_RELATIVE_PATH);
}

export function resolvePackRuntimeRootAbsolutePath(projectRoot: string): string {
  return PACK_RUNTIME_ROOT_ABSOLUTE(projectRoot);
}
