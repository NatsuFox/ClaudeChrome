import type { AgentChatMessage, AgentChatUpdateMessage } from '../shared/types';

const MAX_MESSAGES_PER_SESSION = 200;

export class AgentChatBuffer {
  private readonly messages: AgentChatMessage[] = [];
  private readonly indexById = new Map<string, number>();

  apply(message: AgentChatUpdateMessage): AgentChatMessage {
    if (message.reset) {
      this.clear();
    }

    const existingIndex = this.indexById.get(message.message.id);
    if (existingIndex !== undefined) {
      this.messages[existingIndex] = message.message;
      return message.message;
    }

    this.messages.push(message.message);
    this.indexById.set(message.message.id, this.messages.length - 1);

    if (this.messages.length > MAX_MESSAGES_PER_SESSION) {
      const removed = this.messages.shift();
      if (removed) {
        this.indexById.delete(removed.id);
      }
      this.rebuildIndex();
    }

    return message.message;
  }

  getAll(): AgentChatMessage[] {
    return [...this.messages];
  }

  get(id: string): AgentChatMessage | null {
    const index = this.indexById.get(id);
    return index === undefined ? null : this.messages[index] ?? null;
  }

  remove(id: string): void {
    const index = this.indexById.get(id);
    if (index === undefined) {
      return;
    }
    this.messages.splice(index, 1);
    this.rebuildIndex();
  }

  get size(): number {
    return this.messages.length;
  }

  clear(): void {
    this.messages.length = 0;
    this.indexById.clear();
  }

  private rebuildIndex(): void {
    this.indexById.clear();
    this.messages.forEach((message, index) => {
      this.indexById.set(message.id, index);
    });
  }
}
