import type { Picture } from 'taglib-wasm';

export const MAX_ARTWORK_BYTES = 8 * 1024 * 1024;

/** Only follow the public NetEase image address stored in the NCM metadata. */
export function artworkUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return;
    if (!/^p[1-9][0-9]?\.music\.126\.net$/.test(url.hostname)) return;
    if (!/^\/[A-Za-z0-9_=-]+\/\d+\.(?:jpe?g|png)$/i.test(url.pathname)) return;
    url.protocol = 'https:';
    // Download the original artwork rather than an optional thumbnail or tracking query.
    url.search = ''; url.hash = '';
    return url.href;
  } catch { return; }
}

export function artworkMime(data: Uint8Array): 'image/jpeg' | 'image/png' | undefined {
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return 'image/png';
}

/** The browser contacts the image CDN only. No audio, filename, cookies or referrer is sent. */
export async function fetchArtwork(source: string): Promise<Picture | undefined> {
  const url = artworkUrl(source);
  if (!url) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch(url, {
      credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: controller.signal,
    });
    if (!response.ok || Number(response.headers.get('content-length')) > MAX_ARTWORK_BYTES || !response.body) {
      await response.body?.cancel(); return;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_ARTWORK_BYTES) { await reader.cancel(); return; }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const data = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
    const mimeType = artworkMime(data);
    if (mimeType) return { data, mimeType, type: 'FrontCover', description: '' };
  } catch { /* An unavailable cover must not discard successfully recovered audio. */ }
  finally { clearTimeout(timeout); }
}
