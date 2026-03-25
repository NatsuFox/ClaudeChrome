import type { NMMessage, ChunkMessage } from './types';

const NM_HOST_NAME = 'com.anthropic.claudechrome';
const MAX_NM_SIZE = 900_000; // stay under 1MB limit with overhead

export function generateId(): string {
  return crypto.randomUUID();
}

export function encodeForNM(msg: NMMessage): string {
  return JSON.stringify(msg);
}

export function decodeFromNM(raw: string): NMMessage {
  return JSON.parse(raw) as NMMessage;
}

export { NM_HOST_NAME };
