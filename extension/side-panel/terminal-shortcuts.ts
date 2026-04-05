export type TerminalShortcutAction =
  | { kind: 'paste' }
  | { kind: 'sequence'; sequence: string };

export interface TerminalShortcutKeyboardEvent {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export const SHIFT_ENTER_SEQUENCE = '\u001b[27;2;13~';
export const WORD_BACKWARD_SEQUENCE = '\u001bb';
export const WORD_FORWARD_SEQUENCE = '\u001bf';

const VERTICAL_ARROW_SEQUENCES: Record<string, string> = {
  ArrowUp: '\u001b[1;5A',
  ArrowDown: '\u001b[1;5B',
};

export function isMacPlatform(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}

export function resolveTerminalShortcut(
  event: TerminalShortcutKeyboardEvent,
  isMacLikePlatform: boolean,
): TerminalShortcutAction | null {
  const normalizedKey = event.key.toLowerCase();

  if (isPasteShortcut(normalizedKey, event)) {
    return { kind: 'paste' };
  }

  if (isShiftEnterShortcut(event)) {
    return { kind: 'sequence', sequence: SHIFT_ENTER_SEQUENCE };
  }

  if (isHorizontalWordJumpShortcut(event, isMacLikePlatform)) {
    return {
      kind: 'sequence',
      sequence: event.key === 'ArrowLeft' ? WORD_BACKWARD_SEQUENCE : WORD_FORWARD_SEQUENCE,
    };
  }

  if (isVerticalMovementShortcut(event, isMacLikePlatform)) {
    return { kind: 'sequence', sequence: VERTICAL_ARROW_SEQUENCES[event.key] };
  }

  return null;
}

function isPasteShortcut(key: string, event: TerminalShortcutKeyboardEvent): boolean {
  return key === 'v' && !event.altKey && (event.ctrlKey || event.metaKey);
}

function isShiftEnterShortcut(event: TerminalShortcutKeyboardEvent): boolean {
  return event.key === 'Enter' && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;
}

function isHorizontalWordJumpShortcut(
  event: TerminalShortcutKeyboardEvent,
  isMacLikePlatform: boolean,
): boolean {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
    return false;
  }
  return hasSingleMovementModifier(event, isMacLikePlatform);
}

function isVerticalMovementShortcut(
  event: TerminalShortcutKeyboardEvent,
  isMacLikePlatform: boolean,
): boolean {
  return Boolean(VERTICAL_ARROW_SEQUENCES[event.key]) && hasSingleMovementModifier(event, isMacLikePlatform);
}

function hasSingleMovementModifier(
  event: TerminalShortcutKeyboardEvent,
  isMacLikePlatform: boolean,
): boolean {
  if (event.shiftKey) {
    return false;
  }

  const modifierCount = Number(event.ctrlKey) + Number(event.altKey) + Number(event.metaKey);
  if (modifierCount !== 1) {
    return false;
  }

  if (event.metaKey) {
    return isMacLikePlatform;
  }

  return true;
}

