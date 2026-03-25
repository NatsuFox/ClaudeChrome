import type { ChunkMessage } from './types';

const MAX_CHUNK_SIZE = 800_000; // ~800KB per chunk, well under 1MB NM limit

export function needsChunking(data: string): boolean {
  return data.length > MAX_CHUNK_SIZE;
}

export function chunkData(data: string): ChunkMessage[] {
  const chunkId = crypto.randomUUID();
  const chunks: ChunkMessage[] = [];
  const total = Math.ceil(data.length / MAX_CHUNK_SIZE);

  for (let i = 0; i < total; i++) {
    chunks.push({
      type: 'chunk',
      chunk_id: chunkId,
      index: i,
      total,
      data: data.slice(i * MAX_CHUNK_SIZE, (i + 1) * MAX_CHUNK_SIZE),
    });
  }
  return chunks;
}

export class ChunkAssembler {
  private pending = new Map<string, { parts: string[]; total: number; received: number }>();

  /** Returns assembled data when all chunks received, null otherwise */
  addChunk(chunk: ChunkMessage): string | null {
    let entry = this.pending.get(chunk.chunk_id);
    if (!entry) {
      entry = { parts: new Array(chunk.total), total: chunk.total, received: 0 };
      this.pending.set(chunk.chunk_id, entry);
    }

    if (!entry.parts[chunk.index]) {
      entry.parts[chunk.index] = chunk.data;
      entry.received++;
    }

    if (entry.received === entry.total) {
      const assembled = entry.parts.join('');
      this.pending.delete(chunk.chunk_id);
      return assembled;
    }
    return null;
  }

  clear(): void {
    this.pending.clear();
  }
}
