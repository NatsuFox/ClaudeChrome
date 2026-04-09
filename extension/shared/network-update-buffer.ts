import type { CapturedRequest } from './types';

type PendingTabBatch = {
  requests: Map<string, CapturedRequest>;
  timer: ReturnType<typeof setTimeout> | null;
  estimatedBytes: number;
};

export class NetworkUpdateBuffer {
  private readonly pendingByTab = new Map<number, PendingTabBatch>();

  constructor(
    private readonly delayMs: number,
    private readonly maxBatchBytes: number,
    private readonly onFlush: (tabId: number, payload: CapturedRequest | CapturedRequest[]) => void
  ) {}

  enqueue(tabId: number, request: CapturedRequest): void {
    let batch = this.ensureBatch(tabId);
    const previous = batch.requests.get(request.id);
    const previousBytes = previous ? this.estimateRequestBytes(previous) : 0;
    const nextBytes = this.estimateRequestBytes(request);
    const nextBatchBytes = batch.estimatedBytes - previousBytes + nextBytes;

    if (batch.requests.size > 0 && nextBatchBytes > this.maxBatchBytes) {
      this.flushTab(tabId);
      batch = this.ensureBatch(tabId);
    }

    batch.requests.set(request.id, request);
    batch.estimatedBytes = batch.estimatedBytes - previousBytes + nextBytes;
    if (batch.timer != null) {
      return;
    }

    batch.timer = setTimeout(() => {
      this.flushTab(tabId);
    }, this.delayMs);
  }

  flushTab(tabId: number): void {
    const batch = this.pendingByTab.get(tabId);
    if (!batch || batch.requests.size === 0) {
      this.clearTab(tabId);
      return;
    }

    if (batch.timer != null) {
      clearTimeout(batch.timer);
      batch.timer = null;
    }

    const requests = Array.from(batch.requests.values());
    batch.requests.clear();
    batch.estimatedBytes = 0;
    this.pendingByTab.delete(tabId);

    this.onFlush(tabId, requests.length === 1 ? requests[0] : requests);
  }

  clearTab(tabId: number): void {
    const batch = this.pendingByTab.get(tabId);
    if (!batch) {
      return;
    }

    if (batch.timer != null) {
      clearTimeout(batch.timer);
    }
    batch.estimatedBytes = 0;
    this.pendingByTab.delete(tabId);
  }

  private ensureBatch(tabId: number): PendingTabBatch {
    let batch = this.pendingByTab.get(tabId);
    if (!batch) {
      batch = {
        requests: new Map<string, CapturedRequest>(),
        timer: null,
        estimatedBytes: 0,
      };
      this.pendingByTab.set(tabId, batch);
    }
    return batch;
  }

  private estimateRequestBytes(request: CapturedRequest): number {
    try {
      return JSON.stringify(request).length;
    } catch {
      return 0;
    }
  }
}
