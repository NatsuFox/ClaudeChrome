const textEncoder = new TextEncoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    const chunk = bytes.subarray(index, index + 0x8000);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function encodeUtf8ToBase64(text: string): string {
  return bytesToBase64(textEncoder.encode(text));
}

export function decodeBase64ToBytes(data: string): Uint8Array {
  const binary = atob(data);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
