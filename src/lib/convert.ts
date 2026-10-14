import type { DecodedNcm } from './ncm/decode';

export type ConvertedFile = { id: string; name: string; title: string; artist?: string; album?: string; cover?: Blob; coverUrl?: string; blob: Blob; url: string };
export const MAX_FILE_SIZE = 100 * 1024 * 1024;

function workerRequest<T>(data: object, transfer: Transferable[], signal: AbortSignal, progress?: (value: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(new URL('../worker/convert.worker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => { clearTimeout(timeout); worker.terminate(); signal.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(new DOMException('已取消', 'AbortError')); };
    const timeout = setTimeout(() => { cleanup(); reject(new Error('处理超时，请尝试较小的文件')); }, 180000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }) => {
      if (data.kind === 'progress') { progress?.(data.progress); return; }
      cleanup();
      if (data.kind === 'error') reject(new Error(data.error)); else resolve(data.result);
    };
    worker.onerror = () => { cleanup(); reject(new Error('无法处理此文件，请重试')); };
    worker.postMessage(data, transfer);
  });
}

export async function convertFile(file: File, signal: AbortSignal, progress: (value: number) => void): Promise<Omit<ConvertedFile, 'id' | 'name' | 'url'>> {
  const buffer = await file.arrayBuffer(); signal.throwIfAborted();
  const decoded = await workerRequest<DecodedNcm>({ kind: 'decode', buffer, fallbackTitle: file.name.replace(/\.ncm$/i, '') }, [buffer], signal);
  const title = decoded.metadata.title || file.name.replace(/\.ncm$/i, '');
  const picture = decoded.metadata.pictures?.find(p => p.type === 'FrontCover') ?? decoded.metadata.pictures?.[0];
  const details = { title, artist: decoded.metadata.artist, album: decoded.metadata.album, cover: picture ? new Blob([new Uint8Array(picture.data)], { type: picture.mimeType }) : undefined };
  if (decoded.format === 'mp3') return { ...details, blob: new Blob([decoded.data], { type: 'audio/mpeg' }) };
  progress(10);
  const context = new AudioContext({ sampleRate: 44100 });
  const close = () => { if (context.state !== 'closed') void context.close(); };
  signal.addEventListener('abort', close, { once: true });
  try {
    const audio = await context.decodeAudioData(decoded.data); signal.throwIfAborted();
    if (audio.numberOfChannels > 2) throw new Error('暂不支持多声道音频');
    const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => {
      const pcm = audio.getChannelData(i), output = new Int16Array(pcm.length);
      for (let n = 0; n < pcm.length; n++) output[n] = Math.round(Math.max(-1, Math.min(1, pcm[n])) * (pcm[n] < 0 ? 32768 : 32767));
      return output;
    });
    const blob = await workerRequest<Blob>({ kind: 'encode', channels, sampleRate: audio.sampleRate, metadata: { ...decoded.metadata, title } }, channels.map(c => c.buffer), signal, p => progress(10 + p * .9));
    return { ...details, blob };
  } catch (error) {
    if (signal.aborted) throw new DOMException('已取消', 'AbortError');
    if (error instanceof DOMException && error.name === 'EncodingError') throw new Error('浏览器无法解码此音频，请使用最新版 Chrome 或 Safari');
    throw error;
  } finally { signal.removeEventListener('abort', close); close(); }
}

export function uniqueName(name: string, used: Set<string>) {
  const stem = name.replace(/\.ncm$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+/, '').trim().slice(0, 160) || 'audio';
  let candidate = stem + '.mp3', i = 2;
  while (used.has(candidate.toLowerCase())) candidate = `${stem} (${i++}).mp3`;
  used.add(candidate.toLowerCase()); return candidate;
}
