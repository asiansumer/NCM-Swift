import { createCipheriv } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

// Original synthetic tones only. No downloaded music or user library files.
export function wrapNcm(audio, metadata = {}, cover = Buffer.alloc(0), padding = 0) {
  const aes = (data, key) => { const cipher = createCipheriv('aes-128-ecb', Buffer.from(key, 'hex'), null); return Buffer.concat([cipher.update(data), cipher.final()]); };
  const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  const key = Buffer.from('swift-test-audio-key');
  const keyBlock = aes(Buffer.concat([Buffer.from('neteasecloudmusic'), key]), '687a4852416d736f356b496e62617857').map(b => b ^ 0x64);
  const meta = Buffer.from('163 key(Don\'t modify):' + aes(Buffer.from('music:' + JSON.stringify(metadata)), '2331346c6a6b5f215c5d2630553c2728').toString('base64')).map(b => b ^ 0x63);
  // The actual NCM metadata prefix is 22 bytes (including its trailing colon).
  const box = Uint8Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) { j = (j + box[i] + key[i % key.length]) % 256; const tmp = box[i]; box[i] = box[j]; box[j] = tmp; }
  const encrypted = Buffer.from(audio);
  for (let i = 0; i < encrypted.length; i++) { const k = (i + 1) % 256; encrypted[i] ^= box[(box[k] + box[(box[k] + k) % 256]) % 256]; }
  const header = Buffer.concat([Buffer.from('CTENFDAM'), Buffer.alloc(2), u32(keyBlock.length), keyBlock, u32(meta.length), meta, Buffer.alloc(5), u32(cover.length + padding), u32(cover.length), cover, Buffer.alloc(padding)]);
  return Buffer.concat([header, encrypted]);
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const dir = resolve('tests/fixtures'); mkdirSync(dir, { recursive: true });
  for (const format of ['mp3', 'flac']) {
    const file = join(tmpdir(), 'ncm-swift-tone.' + format);
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3:sample_rate=44100', '-ac', '2', '-y', file]);
    const audio = readFileSync(file);
    writeFileSync(join(dir, `tone-${format}.ncm`), wrapNcm(audio, { musicName: `Tone ${format.toUpperCase()}`, artist: [['NCM Swift', 0]], format }));
    writeFileSync(join(dir, `tone.${format}`), audio);
  }
  writeFileSync(join(dir, 'broken.ncm'), Buffer.from('not a real NCM file'));
}
