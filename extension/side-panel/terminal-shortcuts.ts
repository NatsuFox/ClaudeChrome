export type TerminalShortcutAction =
  | { kind: 'paste' }
  | { kind: 'sequence'; sequence: string };

export type TerminalShortcutProfile = 'default' | 'codex';

export interface TerminalShortcutKeyboardEvent {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export const SHIFT_ENTER_SEQUENCE = '\u001b[27;2;13~';
export const CODEX_SHIFT_ENTER_SEQUENCE = '\u000a';
export const LINE_START_SEQUENCE = '\u0001';
export const LINE_END_SEQUENCE = '\u0005';
export const WORD_BACKWARD_SEQUENCE = '\u001bb';
export const WORD_FORWARD_SEQUENCE = '\u001bf';
export const DELETE_PREVIOUS_WORD_SEQUENCE = '\u0017';
export const DELETE_NEXT_WORD_SEQUENCE = '\u001bd';
export const DELETE_TO_LINE_START_SEQUENCE = '\u0015';
export const DELETE_TO_LINE_END_SEQUENCE = '\u000b';
export const CLEAR_SCREEN_SEQUENCE = '\u000c';

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
  profile: TerminalShortcutProfile = 'default',
): TerminalShortcutAction | null {
  const normalizedKey = event.key.toLowerCase();

  if (isPasteShortcut(normalizedKey, event)) {
    return { kind: 'paste' };
  }

  if (isShiftEnterShortcut(event)) {
    return {
      kind: 'sequence',
      sequence: profile === 'codex' ? CODEX_SHIFT_ENTER_SEQUENCE : SHIFT_ENTER_SEQUENCE,
    };
  }

  if (isReadlineShortcut(normalizedKey, event)) {
    return { kind: 'sequence', sequence: resolveReadlineSequence(normalizedKey)! };
  }

  if (isDeleteToLineStartShortcut(event, isMacLikePlatform)) {
    return { kind: 'sequence', sequence: DELETE_TO_LINE_START_SEQUENCE };
  }

  if (isDeleteToLineEndShortcut(event, isMacLikePlatform)) {
    return { kind: 'sequence', sequence: DELETE_TO_LINE_END_SEQUENCE };
  }

  if (isDeletePreviousWordShortcut(event, isMacLikePlatform)) {
    return { kind: 'sequence', sequence: DELETE_PREVIOUS_WORD_SEQUENCE };
  }

  if (isDeleteNextWordShortcut(event, isMacLikePlatform)) {
    return { kind: 'sequence', sequence: DELETE_NEXT_WORD_SEQUENCE };
  }

  if (isMacHorizontalLineJumpShortcut(event, isMacLikePlatform)) {
    return {
      kind: 'sequence',
      sequence: event.key === 'ArrowLeft' ? LINE_START_SEQUENCE : LINE_END_SEQUENCE,
    };
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
  if (event.key === 'Insert') {
    return event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;
  }

  return key === 'v' && !event.altKey && (event.ctrlKey || event.metaKey);
}

function isShiftEnterShortcut(event: TerminalShortcutKeyboardEvent): boolean {
  return event.key === 'Enter' && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;
}

function isReadlineShortcut(key: string, event: TerminalShortcutKeyboardEvent): boolean {
  return !event.altKey && !event.metaKey && !event.shiftKey && event.ctrlKey
    && Boolean(resolveReadlineSequence(key));
}

function resolveReadlineSequence(key: string): string | null {
  switch (key) {
    case 'a':
      return LINE_START_SEQUENCE;
    case 'e':
      return LINE_END_SEQUENCE;
    case 'k':
      return DELETE_TO_LINE_END_SEQUENCE;
    case 'l':
      return CLEAR_SCREEN_SEQUENCE;
    case 'u':
      return DELETE_TO_LINE_START_SEQUENCE;
    case 'w':
      return DELETE_PREVIOUS_WORD_SEQUENCE;
    default:
      return null;
  }
}

function isDeleteToLineStartShortcut(
  event: TerminalShortcutKeyboardEvent,
  isMacLikePlatform: boolean,
): boolean {
  return Boolean(
    isMacLikePlatform
      && event.key === 'Backspace'
      && event.metaKey
      && !event.ctrlKey
      && !event.altKey
      && !event.shiftKey,
  );
}

function isDeleteToLineEndShortcut(
  event: TerminalShortcutKeyboardEvent,
  isMacLikePlatform: boolean,
): boolean {
  return Boolean(
    isMacLikePlatform
      && event.key === 'Delete'
      && event.metaKey
      && !event.ctrlKey
      && !event.altKey
      && !event.shiftKey,
  );
}

function isDeletePreviousWordShortcut(
  event: TerminalShortcutKeyboardEvent,
  isMacLikePlatform: boolean,
): boolean {
  if (event.key !== 'Backspace' || event.shiftKey || event.metaKey) {
    return false;
  }

  if (isMacLikePlatform) {
    return event.altKey && !event.ctrlKey;
  }

  return (event.ctrlKey || event.altKey) && !(event.ctrlKey && event.altKey);
}

function isDeleteNextWordShortcut(
  event: TerminalShortcutKeyboardEvent,
  isMacLikePlatform: boolean,
): boolean {
  if (event.key !== 'Delete' || event.shiftKey || event.metaKey) {
    return false;
  }

  if (isMacLikePlatform) {
    return event.altKey && !event.ctrlKey;
  }

  return (event.ctrlKey || event.altKey) && !(event.ctrlKey && event.altKey);
}

function isMacHorizontalLineJumpShortcut(
  event: TerminalShortcutKeyboardEvent,
  isMacLikePlatform: boolean,
): boolean {
  return Boolean(
    isMacLikePlatform
      && event.metaKey
      && !event.ctrlKey
      && !event.altKey
      && !event.shiftKey
      && (event.key === 'ArrowLeft' || event.key === 'ArrowRight'),
  );
}

function isHorizontalWordJumpShortcut(
  event: TerminalShortcutKeyboardEvent,
  isMacLikePlatform: boolean,
): boolean {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
    return false;
  }
  if (isMacHorizontalLineJumpShortcut(event, isMacLikePlatform)) {
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
