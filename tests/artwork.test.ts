import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TagLib } from 'taglib-wasm';
import { artworkUrl, fetchArtwork, MAX_ARTWORK_BYTES } from '../src/lib/ncm/artwork.ts';
import { decodeNcm } from '../src/lib/ncm/decode.ts';
import { restoreMetadata, tagMp3 } from '../src/lib/ncm/metadata.ts';
import { wrapNcm } from '../tools/create-test-fixtures.mjs';

const sourceUrl = 'http://p2.music.126.net/cPwdlJxGCtX0e2L3SMQksg==/18915998044327357.jpg?param=300y300';
const expectedUrl = 'https://p2.music.126.net/cPwdlJxGCtX0e2L3SMQksg==/18915998044327357.jpg';
const cover = readFileSync(new URL('../public/machine/ticket.jpg', import.meta.url));
const mp3 = readFileSync(new URL('./fixtures/tone.mp3', import.meta.url));
const ab = (data: Uint8Array) => new Uint8Array(data).buffer;
const picture = { data: new Uint8Array(cover), mimeType: 'image/jpeg', type: 'FrontCover' as const };

for (const format of ['mp3', 'flac'] as const) test(`URL-only ${format} NCM downloads artwork and embeds it in MP3 output`, async () => {
  const source = readFileSync(new URL(`./fixtures/tone.${format}`, import.meta.url));
  // Newer NCM layout: a reserved cover block with zero actual image bytes.
  const decoded = decodeNcm(ab(wrapNcm(source, { musicName: 'URL-only cover', albumPic: sourceUrl }, undefined, 4096)));
  assert.equal(decoded.metadata.artworkUrl, expectedUrl);
  assert.equal(decoded.metadata.pictures, undefined);
  let requests = 0;
  const restored = await restoreMetadata(decoded, 'fallback', async url => { requests++; assert.equal(url, expectedUrl); return picture; });
  assert.equal(requests, 1); assert.equal(restored.metadata.artworkUnavailable, false);
  const output = format === 'mp3' ? restored.data : await (await tagMp3(ab(mp3), restored.metadata)).arrayBuffer();
  const file = await (await TagLib.initialize()).open(new Uint8Array(output));
  try { assert.deepEqual(Buffer.from(file.getPictures()[0].data), cover); assert.equal(file.tag().title, 'URL-only cover'); }
  finally { file.dispose(); }
});

test('embedded artwork takes precedence without any network request', async () => {
  const decoded = decodeNcm(ab(wrapNcm(mp3, { albumPic: sourceUrl }, cover)));
  const restored = await restoreMetadata(decoded, 'fallback', async () => { assert.fail('must not fetch when artwork is embedded'); });
  assert.deepEqual(Buffer.from(restored.metadata.pictures![0].data), cover);
  const alreadyTagged = { ...restored, metadata: { artworkUrl: expectedUrl } };
  await restoreMetadata(alreadyTagged, 'fallback', async () => { assert.fail('audio tag artwork must also take precedence'); });
});

test('unavailable cover reports a recoverable warning and keeps valid MP3 output', async () => {
  const decoded = decodeNcm(ab(wrapNcm(mp3, { musicName: 'Still playable', albumPic: sourceUrl })));
  const restored = await restoreMetadata(decoded, 'fallback', async () => { throw new Error('offline'); });
  assert.equal(restored.metadata.artworkUnavailable, true);
  const file = await (await TagLib.initialize()).open(new Uint8Array(restored.data));
  try { assert.equal(file.tag().title, 'Still playable'); assert.equal(file.getPictures().length, 0); assert.ok(file.isValid()); }
  finally { file.dispose(); }
});

test('cover requests are HTTPS, credential-free and restricted to NetEase image URLs', async t => {
  for (const invalid of ['https://localhost/a.jpg', 'https://p2.music.126.net.evil.com/hash/123.jpg', 'https://user:pass@p2.music.126.net/hash/123.jpg', 'file:///tmp/cover.jpg', 'https://p2.music.126.net:8443/hash/123.jpg']) assert.equal(artworkUrl(invalid), undefined);
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, expectedUrl); assert.equal(options.credentials, 'omit'); assert.equal(options.referrerPolicy, 'no-referrer'); assert.equal(options.redirect, 'error');
    return new Response(cover, { headers: { 'Content-Type': 'image/jpg' } });
  });
  const result = await fetchArtwork(sourceUrl);
  assert.deepEqual(Buffer.from(result!.data), cover); assert.equal(result!.mimeType, 'image/jpeg');
});

test('non-image and oversized CDN responses cannot become artwork', async t => {
  const mocked = t.mock.method(globalThis, 'fetch', async () => new Response('<html>CDN error</html>'));
  assert.equal(await fetchArtwork(sourceUrl), undefined);
  mocked.mock.mockImplementation(async () => new Response(cover, { headers: { 'Content-Length': String(MAX_ARTWORK_BYTES + 1) } }));
  assert.equal(await fetchArtwork(sourceUrl), undefined);
  let cancelled = false;
  mocked.mock.mockImplementation(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(MAX_ARTWORK_BYTES + 1)); },
    cancel() { cancelled = true; },
  })));
  assert.equal(await fetchArtwork(sourceUrl), undefined); assert.equal(cancelled, true);
});
