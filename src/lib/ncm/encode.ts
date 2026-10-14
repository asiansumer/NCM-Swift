import type { AudioMetadata } from './decode.ts';
import { tagMp3 } from './metadata.ts';

export async function encodeMp3(channels: Int16Array[], sampleRate: number, metadata: AudioMetadata, onProgress?: (value: number) => void) {
  const { Mp3Encoder } = await import('@breezystack/lamejs');
  const encoder = new Mp3Encoder(channels.length, sampleRate, 320);
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const [left, right] = channels;
  let lastProgress = 0;
  for (let i = 0; i < left.length; i += 1152) {
    const chunk = encoder.encodeBuffer(left.subarray(i, i + 1152), right?.subarray(i, i + 1152));
    if (chunk.length) chunks.push(new Uint8Array(chunk));
    const progress = Math.floor(i / left.length * 100);
    if (progress >= lastProgress + 3) { onProgress?.(progress); lastProgress = progress; }
  }
  const tail = encoder.flush(); if (tail.length) chunks.push(new Uint8Array(tail));
  return tagMp3(await new Blob(chunks).arrayBuffer(), metadata);
}
