import { decodeNcm, type AudioMetadata } from '../lib/ncm/decode';
import { restoreMetadata } from '../lib/ncm/metadata';
import { encodeMp3 } from '../lib/ncm/encode';

type Request = { kind: 'decode'; buffer: ArrayBuffer; fallbackTitle: string } | { kind: 'encode'; channels: Int16Array[]; sampleRate: number; metadata: AudioMetadata };
self.onmessage = async ({ data }: MessageEvent<Request>) => {
  try {
    if (data.kind === 'decode') {
      const result = await restoreMetadata(decodeNcm(data.buffer), data.fallbackTitle);
      self.postMessage({ kind: 'done', result }, { transfer: [result.data] });
      return;
    }
    const result = await encodeMp3(data.channels, data.sampleRate, data.metadata, progress => self.postMessage({ kind: 'progress', progress }));
    self.postMessage({ kind: 'done', result });
  } catch (error) {
    self.postMessage({ kind: 'error', error: error instanceof Error ? error.message : '转换失败，请重试' });
  }
};
