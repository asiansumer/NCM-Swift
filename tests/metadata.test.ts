import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ID3Writer } from 'browser-id3-writer';
import JSZip from 'jszip';
import { TagLib } from 'taglib-wasm';
import { decodeNcm } from '../src/lib/ncm/decode.ts';
import { restoreMetadata } from '../src/lib/ncm/metadata.ts';
import { encodeMp3 } from '../src/lib/ncm/encode.ts';
import { wrapNcm } from '../tools/create-test-fixtures.mjs';

const audio = readFileSync(new URL('./fixtures/tone.mp3', import.meta.url));
const cover = readFileSync(new URL('../public/machine/ticket.jpg', import.meta.url));
const alternateCover = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const ab = (b: Uint8Array) => new Uint8Array(b).buffer;
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const ncmInfo = { musicName: '夜航 / Night Ride', artist: [['艺术家甲', 1], ['Artist B', 2]], album: '午夜电台', albumArtist: 'Various Artists', year: 2024, trackNumber: '03/12', discNumber: '1/2', genre: 'Electronic' };
const ffmpeg = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { maxBuffer: 8 * 1024 * 1024 });
const probe = (path: string) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path], { encoding: 'utf8' }));
const extractCover = (path: string) => ffmpeg(['-i', path, '-map', '0:v:0', '-c', 'copy', '-f', 'image2pipe', '-']);
const pcm = (path: string) => ffmpeg(['-i', path, '-map', '0:a:0', '-f', 's16le', '-']);

// All media are original synthetic tones. ffprobe independently validates output tags.
test('NCM artwork uses the image length, skips padding, and tolerates invalid optional images', () => {
  const decoded = decodeNcm(ab(wrapNcm(audio, ncmInfo, cover, 173)));
  assert.equal(hash(decoded.metadata.pictures![0].data), hash(cover));
  assert.deepEqual(Buffer.from(decoded.data), audio);
  assert.deepEqual(decoded.metadata.properties?.artist, ['艺术家甲', 'Artist B']);
  const png = decodeNcm(ab(wrapNcm(audio, ncmInfo, alternateCover)));
  assert.equal(png.metadata.pictures![0].mimeType, 'image/png');
  assert.deepEqual(Buffer.from(png.metadata.pictures![0].data), alternateCover);
  const invalid = decodeNcm(ab(wrapNcm(audio, ncmInfo, Buffer.from('not an image'), 30)));
  assert.equal(invalid.metadata.pictures, undefined);
  assert.deepEqual(Buffer.from(invalid.data), audio);
});

test('MP3 export embeds NCM title, artists, album, track, date and original artwork; ZIP keeps identical bytes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'swift-metadata-'));
  try {
    const restored = await restoreMetadata(decodeNcm(ab(wrapNcm(audio, ncmInfo, cover, 128))), 'fallback');
    const output = join(dir, 'output.mp3'), source = join(dir, 'source.mp3');
    writeFileSync(output, new Uint8Array(restored.data)); writeFileSync(source, audio);
    const tags = probe(output).format.tags;
    assert.equal(tags.title, ncmInfo.musicName); assert.equal(tags.album, ncmInfo.album);
    assert.match(tags.artist, /艺术家甲/);
    // ffprobe only reports the first value of a multi-value ID3 text frame.
    const reader = await (await TagLib.initialize()).open(new Uint8Array(restored.data));
    try { assert.deepEqual(reader.getProperty('artist'), ['艺术家甲', 'Artist B']); } finally { reader.dispose(); }
    assert.equal(tags.album_artist, ncmInfo.albumArtist); assert.equal(tags.track, '03/12'); assert.equal(tags.disc, '1/2');
    assert.equal(tags.date, '2024'); assert.equal(tags.genre, 'Electronic');
    assert.equal(hash(extractCover(output)), hash(cover));
    assert.equal(hash(pcm(output)), hash(pcm(source)), 'tagging must not alter decoded audio');
    const zip = new JSZip(); zip.file('song.mp3', restored.data);
    const reopened = await JSZip.loadAsync(await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' }));
    assert.deepEqual(await reopened.file('song.mp3')!.async('nodebuffer'), Buffer.from(restored.data));
  } finally { rmSync(dir, { recursive: true }); }
});

for (const version of [3, 4]) test(`existing ID3v2.${version} tags, lyrics, custom frames and cover survive supplementation`, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'swift-existing-'));
  try {
    const writer = new ID3Writer(ab(audio));
    writer.setFrame('TIT2', '原来的歌名').setFrame('TPE1', ['Original Artist']).setFrame('TALB', 'Original Album')
      .setFrame('TCOM', ['Original Composer']).setFrame('COMM', { description: '', text: 'Original comment', language: 'eng' })
      .setFrame('USLT', { description: '', lyrics: '保留原来的歌词', language: 'chi' })
      .setFrame('TXXX', { description: 'CUSTOM_NOTE', value: 'keep me' })
      .setFrame('PRIV', { id: 'swift-test', data: new Uint8Array([9, 8, 7]).buffer })
      .setFrame('APIC', { type: 3, data: ab(cover), description: 'Original cover' });
    const source = join(dir, 'source.mp3'); writeFileSync(source, new Uint8Array(writer.addTag()));
    if (version === 4) {
      ffmpeg(['-i', source, '-map', '0', '-c', 'copy', '-id3v2_version', '4', join(dir, 'v4.mp3')]);
      writeFileSync(source, readFileSync(join(dir, 'v4.mp3')));
    }
    const restored = await restoreMetadata(decodeNcm(ab(wrapNcm(readFileSync(source), ncmInfo, alternateCover))), 'fallback');
    assert.equal(restored.metadata.title, '原来的歌名'); assert.equal(restored.metadata.album, 'Original Album');
    assert.equal(restored.metadata.artist, 'Original Artist');
    const output = join(dir, 'output.mp3'); writeFileSync(output, new Uint8Array(restored.data));
    const tags = probe(output).format.tags;
    assert.equal(tags.composer, 'Original Composer'); assert.equal(tags.comment, 'Original comment');
    assert.equal(tags.CUSTOM_NOTE, 'keep me'); assert.ok(Object.values(tags).includes('保留原来的歌词'));
    assert.equal(hash(extractCover(output)), hash(cover)); assert.equal(hash(pcm(output)), hash(pcm(source)));
    const lib = await TagLib.initialize(), file = await lib.open(new Uint8Array(restored.data));
    try { assert.ok(file.getId3v2Frames('PRIV').some(frame => Buffer.from(frame.data).includes(Buffer.from('swift-test')))); }
    finally { file.dispose(); }
  } finally { rmSync(dir, { recursive: true }); }
});

test('FLAC conversion carries embedded tags, lyrics and artwork into a playable MP3', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'swift-flac-'));
  try {
    const source = join(dir, 'source.flac');
    ffmpeg(['-i', new URL('./fixtures/tone.flac', import.meta.url).pathname, '-i', new URL('../public/machine/ticket.jpg', import.meta.url).pathname,
      '-map', '0:a', '-map', '1:v', '-c', 'copy', '-disposition:v', 'attached_pic', '-metadata', 'title=FLAC 原始歌名', '-metadata', 'artist=Original Artist',
      '-metadata', 'album=原始专辑', '-metadata', 'track=07/09', '-metadata', 'date=2023-06-01', '-metadata', 'lyrics=原始歌词', '-metadata', 'CUSTOM_NOTE=keep flac note', source]);
    const restored = await restoreMetadata(decodeNcm(ab(wrapNcm(readFileSync(source), ncmInfo))), 'fallback');
    assert.equal(restored.metadata.title, 'FLAC 原始歌名');
    const raw = pcm(source), samples = new Int16Array(ab(raw));
    const channels = [new Int16Array(samples.length / 2), new Int16Array(samples.length / 2)];
    for (let i = 0; i < samples.length / 2; i++) { channels[0][i] = samples[i * 2]; channels[1][i] = samples[i * 2 + 1]; }
    const blob = await encodeMp3(channels, 44100, restored.metadata);
    const output = join(dir, 'output.mp3'); writeFileSync(output, new Uint8Array(await blob.arrayBuffer()));
    const info = probe(output), tags = info.format.tags;
    assert.equal(tags.title, 'FLAC 原始歌名'); assert.equal(tags.album, '原始专辑'); assert.equal(tags.artist, 'Original Artist');
    assert.equal(tags.track, '07/09'); assert.equal(tags.date, '2023-06-01'); assert.equal(tags.CUSTOM_NOTE, 'keep flac note');
    assert.ok(Object.values(tags).includes('原始歌词')); assert.equal(hash(extractCover(output)), hash(cover));
    assert.equal(info.streams.find((s: { codec_type: string }) => s.codec_type === 'audio').codec_name, 'mp3');
    assert.ok(Number(info.format.duration) >= 3 && Number(info.format.duration) < 3.2);
    assert.ok(pcm(output).length > 0);
  } finally { rmSync(dir, { recursive: true }); }
});
