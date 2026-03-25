// Native Messaging protocol: 4-byte length-prefix framing over stdin/stdout
import { Buffer } from 'node:buffer';

export function readNMMessage(stdin: NodeJS.ReadableStream): Promise<any> {
  return new Promise((resolve, reject) => {
    let headerBuf = Buffer.alloc(0);

    const onReadable = () => {
      // Read 4-byte length header
      if (headerBuf.length < 4) {
        const chunk = stdin.read(4 - headerBuf.length) as Buffer | null;
        if (!chunk) return;
        headerBuf = Buffer.concat([headerBuf, Buffer.from(chunk)]);
        if (headerBuf.length < 4) return;
      }

      const msgLen = headerBuf.readUInt32LE(0);
      if (msgLen > 1024 * 1024) {
        cleanup();
        reject(new Error(`Message too large: ${msgLen}`));
        return;
      }

      const body = stdin.read(msgLen) as Buffer | null;
      if (!body) return;

      cleanup();
      try {
        resolve(JSON.parse(body.toString('utf-8')));
      } catch (e) {
        reject(e);
      }
    };

    const onEnd = () => {
      cleanup();
      reject(new Error('stdin closed'));
    };

    const cleanup = () => {
      stdin.removeListener('readable', onReadable);
      stdin.removeListener('end', onEnd);
    };

    stdin.on('readable', onReadable);
    stdin.on('end', onEnd);
    onReadable();
  });
}

export function writeNMMessage(stdout: NodeJS.WritableStream, msg: any): void {
  const json = JSON.stringify(msg);
  const body = Buffer.from(json, 'utf-8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  stdout.write(header);
  stdout.write(body);
}

export class NMReader {
  private buffer = Buffer.alloc(0);
  private onMessage: (msg: any) => void;

  constructor(stdin: NodeJS.ReadableStream, onMessage: (msg: any) => void) {
    this.onMessage = onMessage;
    stdin.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
  }

  private drain() {
    while (this.buffer.length >= 4) {
      const msgLen = this.buffer.readUInt32LE(0);
      if (this.buffer.length < 4 + msgLen) break;

      const body = this.buffer.subarray(4, 4 + msgLen);
      this.buffer = this.buffer.subarray(4 + msgLen);

      try {
        this.onMessage(JSON.parse(body.toString('utf-8')));
      } catch {}
    }
  }
}
