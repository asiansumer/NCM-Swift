import { decodeNcm, type AudioMetadata } from '../lib/ncm/decode';

type Request = { kind: 'decode'; buffer: ArrayBuffer } | { kind: 'encode'; channels: Int16Array[]; sampleRate: number; metadata: AudioMetadata };
self.onmessage = async ({ data }: MessageEvent<Request>) => {
  try {
    if (data.kind === 'decode') {
      const result = decodeNcm(data.buffer);
      self.postMessage({ kind: 'done', result }, { transfer: [result.data] });
      return;
    }
    const { Mp3Encoder } = await import('@breezystack/lamejs');
    const encoder = new Mp3Encoder(data.channels.length, data.sampleRate, 320);
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    const [left, right] = data.channels;
    let lastProgress = 0;
    for (let i = 0; i < left.length; i += 1152) {
      const chunk = encoder.encodeBuffer(left.subarray(i, i + 1152), right?.subarray(i, i + 1152));
      if (chunk.length) chunks.push(new Uint8Array(chunk));
      const progress = Math.floor(i / left.length * 100);
      if (progress >= lastProgress + 3) { self.postMessage({ kind: 'progress', progress }); lastProgress = progress; }
    }
    const tail = encoder.flush(); if (tail.length) chunks.push(new Uint8Array(tail));
    let blob = new Blob(chunks, { type: 'audio/mpeg' });
    const { ID3Writer } = await import('browser-id3-writer');
    const tags = new ID3Writer(await blob.arrayBuffer());
    if (data.metadata.title) tags.setFrame('TIT2', data.metadata.title);
    if (data.metadata.artist) tags.setFrame('TPE1', [data.metadata.artist]);
    if (data.metadata.album) tags.setFrame('TALB', data.metadata.album);
    blob = new Blob([tags.addTag()], { type: 'audio/mpeg' });
    self.postMessage({ kind: 'done', result: blob });
  } catch (error) {
    self.postMessage({ kind: 'error', error: error instanceof Error ? error.message : '转换失败，请重试' });
  }
};
