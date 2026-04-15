const HOME_PREFIX_RE = /^~(?:$|[\\/])/;
const WINDOWS_DRIVE_ABSOLUTE_RE = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC_RE = /^(?:\\\\|\/\/)/;

export function supportsHomePrefix(pathValue: string): boolean {
  return HOME_PREFIX_RE.test(pathValue.trim());
}

export function isAbsoluteLikePath(pathValue: string): boolean {
  const trimmed = pathValue.trim();
  if (!trimmed) {
    return false;
  }

  return trimmed.startsWith('/')
    || WINDOWS_DRIVE_ABSOLUTE_RE.test(trimmed)
    || WINDOWS_UNC_RE.test(trimmed);
}

export function isValidConfiguredWorkingDirectory(pathValue: string): boolean {
  const trimmed = pathValue.trim();
  if (!trimmed) {
    return true;
  }

  return supportsHomePrefix(trimmed) || isAbsoluteLikePath(trimmed);
}
