import CryptoJS from 'crypto-js';

import type { Picture, PropertyMap } from 'taglib-wasm';

export type AudioMetadata = {
  title?: string; artist?: string; album?: string;
  properties?: PropertyMap;
  pictures?: Picture[];
  lyrics?: { text: string; description?: string; language?: string }[];
};
export type DecodedNcm = { data: ArrayBuffer; format: 'mp3' | 'flac'; metadata: AudioMetadata };

function decryptAes(bytes: Uint8Array, key: string) {
  const value = CryptoJS.AES.decrypt(
    CryptoJS.lib.CipherParams.create({ ciphertext: CryptoJS.lib.WordArray.create(bytes) }),
    CryptoJS.enc.Hex.parse(key),
    { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 },
  );
  if (value.sigBytes < 1) throw new Error('文件已损坏，无法读取');
  return Uint8Array.from({ length: value.sigBytes }, (_, i) => (value.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 255);
}

/** Decode in a worker. All metadata and audio come from the selected file; no network calls. */
export function decodeNcm(buffer: ArrayBuffer): DecodedNcm {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer);
  if (bytes.length < 14 || String.fromCharCode(...bytes.subarray(0, 8)) !== 'CTENFDAM') {
    throw new Error('不是有效的 NCM 文件');
  }
  let offset = 10;
  const requireBytes = (length: number) => {
    if (!Number.isSafeInteger(length) || length < 0 || offset + length > bytes.length) throw new Error('文件不完整或已损坏');
  };
  const block = () => {
    requireBytes(4);
    const length = view.getUint32(offset, true); offset += 4; requireBytes(length);
    const result = bytes.slice(offset, offset + length); offset += length; return result;
  };
  const keyPlain = decryptAes(block().map(x => x ^ 0x64), '687a4852416d736f356b496e62617857');
  if (new TextDecoder().decode(keyPlain.subarray(0, 17)) !== 'neteasecloudmusic') throw new Error('无法读取文件密钥');
  const key = keyPlain.subarray(17);
  if (!key.length) throw new Error('无法读取文件密钥');
  const box = Uint8Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) { j = (box[i] + j + key[i % key.length]) & 255; [box[i], box[j]] = [box[j], box[i]]; }
  const stream = box.map((_, i) => { const n = (i + 1) & 255; return box[(box[n] + box[(n + box[n]) & 255]) & 255]; });
  const metaBytes = block();
  let metadata: AudioMetadata = {};
  if (metaBytes.length) {
    try {
      const text = new TextDecoder().decode(metaBytes.map(x => x ^ 0x63)).slice(22);
      const cipher = CryptoJS.enc.Base64.parse(text);
      const raw = Uint8Array.from({ length: cipher.sigBytes }, (_, i) => (cipher.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 255);
      const plain = new TextDecoder().decode(decryptAes(raw, '2331346c6a6b5f215c5d2630553c2728'));
      const parsed = JSON.parse(plain.slice(plain.indexOf(':') + 1));
      const info = parsed.mainMusic ?? parsed;
      const strings = (value: unknown): string[] => (Array.isArray(value) ? value : [value])
        .map(a => Array.isArray(a) ? a[0] : a)
        .filter((a): a is string => typeof a === 'string' && !!a.trim());
      const properties: PropertyMap = {};
      const put = (key: string, value: unknown) => {
        const values = strings(typeof value === 'number' && Number.isFinite(value) ? String(value) : value);
        if (values.length) properties[key] = values;
      };
      put('title', info.musicName); put('artist', info.artist); put('album', info.album);
      put('albumArtist', info.albumArtist); put('genre', info.genre);
      put('trackNumber', info.trackNumber ?? info.trackNo); put('discNumber', info.discNumber ?? info.discNo);
      put('date', info.year ?? info.date); put('composer', info.composer); put('copyright', info.copyright);
      metadata = {
        title: properties.title?.[0], album: properties.album?.[0], artist: properties.artist?.join(', '), properties,
      };
    } catch { /* Optional tags must not prevent audio recovery. */ }
  }
  requireBytes(13);
  const coverSpace = view.getUint32(offset + 5, true);
  const coverLength = view.getUint32(offset + 9, true);
  // The allocated cover block can be larger than the image. Never include its padding.
  if (coverLength <= coverSpace && coverLength > 0) {
    requireBytes(13 + coverSpace);
    const data = bytes.slice(offset + 13, offset + 13 + coverLength);
    const mimeType = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff ? 'image/jpeg'
      : data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47 ? 'image/png' : null;
    if (mimeType) metadata.pictures = [{ data, mimeType, type: 'FrontCover', description: '' }];
  }
  requireBytes(13 + coverSpace); offset += 13 + coverSpace;
  const audio = bytes.slice(offset);
  if (!audio.length) throw new Error('文件中没有音频');
  for (let i = 0; i < audio.length; i++) audio[i] ^= stream[i & 255];
  const signature = String.fromCharCode(...audio.subarray(0, 4));
  const format = signature === 'fLaC' ? 'flac' : signature.startsWith('ID3') || (audio[0] === 255 && (audio[1] & 0xe0) === 0xe0) ? 'mp3' : null;
  if (!format) throw new Error('无法识别文件中的音频');
  return { data: audio.buffer, format, metadata };
}
