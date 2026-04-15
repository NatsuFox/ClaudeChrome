import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const HOME_PREFIX_RE = /^~(?:$|[\\/])/;
export const INVALID_WORKING_DIRECTORY_MESSAGE = 'Working directory must be an absolute path. Relative paths are not supported. Use ~ at the start to expand your home directory.';
export const MISSING_WORKING_DIRECTORY_MESSAGE = 'Working directory does not exist. Enter an existing absolute path or a path starting with ~.';
export const NOT_DIRECTORY_WORKING_DIRECTORY_MESSAGE = 'Working directory must point to an existing directory.';
export const PERMISSION_DENIED_WORKING_DIRECTORY_MESSAGE = 'ClaudeChrome does not have permission to access this working directory.';
export const UNKNOWN_WORKING_DIRECTORY_MESSAGE = 'ClaudeChrome could not validate this working directory.';

export type HostWorkingDirectoryValidationCode =
  | 'valid'
  | 'empty'
  | 'invalid_syntax'
  | 'not_found'
  | 'not_directory'
  | 'permission_denied'
  | 'unknown_error';

export interface HostWorkingDirectoryValidationResult {
  code: HostWorkingDirectoryValidationCode;
  normalizedPath: string;
  message?: string;
}

export function expandUserHomePrefix(pathValue: string, homeDir = os.homedir()): string {
  const trimmed = pathValue.trim();
  if (trimmed === '~') {
    return homeDir;
  }

  if (HOME_PREFIX_RE.test(trimmed)) {
    return path.join(homeDir, trimmed.slice(2));
  }

  return trimmed;
}

export function isAbsoluteConfiguredWorkingDirectory(pathValue: string): boolean {
  const expanded = expandUserHomePrefix(pathValue);
  return path.isAbsolute(expanded);
}

function withCheckedPath(message: string, checkedPath: string): string {
  return checkedPath ? `${message} Checked path: ${checkedPath}` : message;
}

export function validateConfiguredWorkingDirectory(pathValue: string, homeDir = os.homedir()): HostWorkingDirectoryValidationResult {
  const trimmed = pathValue.trim();
  if (!trimmed) {
    return { code: 'empty', normalizedPath: '' };
  }

  const expanded = expandUserHomePrefix(trimmed, homeDir);
  if (!path.isAbsolute(expanded)) {
    return {
      code: 'invalid_syntax',
      normalizedPath: expanded,
      message: withCheckedPath(INVALID_WORKING_DIRECTORY_MESSAGE, expanded),
    };
  }

  try {
    const stats = fs.statSync(expanded);
    if (!stats.isDirectory()) {
      return {
        code: 'not_directory',
        normalizedPath: expanded,
        message: withCheckedPath(NOT_DIRECTORY_WORKING_DIRECTORY_MESSAGE, expanded),
      };
    }
  } catch (error) {
    const fsError = error as NodeJS.ErrnoException;
    if (fsError.code === 'ENOENT') {
      return {
        code: 'not_found',
        normalizedPath: expanded,
        message: withCheckedPath(MISSING_WORKING_DIRECTORY_MESSAGE, expanded),
      };
    }
    if (fsError.code === 'EACCES' || fsError.code === 'EPERM') {
      return {
        code: 'permission_denied',
        normalizedPath: expanded,
        message: `${withCheckedPath(PERMISSION_DENIED_WORKING_DIRECTORY_MESSAGE, expanded)} ${fsError.message}`,
      };
    }
    return {
      code: 'unknown_error',
      normalizedPath: expanded,
      message: `${withCheckedPath(UNKNOWN_WORKING_DIRECTORY_MESSAGE, expanded)} ${fsError.message || String(error)}`,
    };
  }

  return {
    code: 'valid',
    normalizedPath: expanded,
  };
}

export function resolveConfiguredWorkingDirectory(
  configuredWorkingDirectory: string | undefined,
  explicitCwd: string | null,
  sessionWorkspace: string,
): string {
  const configured = configuredWorkingDirectory?.trim() || '';
  if (configured) {
    const validation = validateConfiguredWorkingDirectory(configured);
    if (validation.code !== 'valid') {
      throw new Error(validation.message || INVALID_WORKING_DIRECTORY_MESSAGE);
    }
    return validation.normalizedPath;
  }

  return explicitCwd?.trim() || sessionWorkspace;
}
