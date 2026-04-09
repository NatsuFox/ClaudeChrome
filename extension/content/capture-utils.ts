export const MAX_CAPTURED_BODY_BYTES = 65_536;

const CAPTURABLE_CONTENT_TYPE_RE =
  /^(text\/|application\/(?:json|javascript|xml)(?:\s*;|$)|application\/[\w.+-]+\+(?:json|xml)(?:\s*;|$))/i;

export function isCapturableResponseContentType(contentType: string): boolean {
  return CAPTURABLE_CONTENT_TYPE_RE.test(contentType.trim());
}

export function parseContentLengthHeader(contentLength: string | null | undefined): number | null {
  if (typeof contentLength !== 'string' || contentLength.trim() === '') {
    return null;
  }

  const parsed = Number.parseInt(contentLength, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

export function isKnownContentLengthWithinLimit(
  contentLength: string | null | undefined,
  maxBytes = MAX_CAPTURED_BODY_BYTES
): boolean {
  const parsed = parseContentLengthHeader(contentLength);
  return parsed == null || parsed <= maxBytes;
}

export function shouldCaptureXhrBody(
  contentType: string,
  contentLength: string | null | undefined,
  maxBytes = MAX_CAPTURED_BODY_BYTES
): boolean {
  const parsed = parseContentLengthHeader(contentLength);
  return isCapturableResponseContentType(contentType) && parsed != null && parsed <= maxBytes;
}

export async function readResponseBodyPreview(
  response: Response,
  maxBytes = MAX_CAPTURED_BODY_BYTES,
  maxChars = maxBytes
): Promise<string> {
  const body = response.body;
  if (!body) {
    return '';
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let text = '';

  try {
    while (receivedBytes < maxBytes && text.length < maxChars) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!(value instanceof Uint8Array) || value.byteLength === 0) {
        continue;
      }

      const remainingBytes = maxBytes - receivedBytes;
      const chunk = value.byteLength > remainingBytes
        ? value.subarray(0, remainingBytes)
        : value;

      receivedBytes += chunk.byteLength;
      text += decoder.decode(chunk, { stream: true });

      if (chunk.byteLength < value.byteLength || text.length >= maxChars) {
        break;
      }
    }

    text += decoder.decode();
  } catch {
    return text.slice(0, maxChars);
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Ignore cancellation failures after consuming the preview budget.
    }
  }

  return text.slice(0, maxChars);
}
