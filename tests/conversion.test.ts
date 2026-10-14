import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeNcm } from '../src/lib/ncm/decode.ts';
import { wrapNcm } from '../tools/create-test-fixtures.mjs';

const buffer = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
for (const format of ['mp3', 'flac'] as const) {
  test(`recovers ${format} audio byte-for-byte and reads NCM metadata`, () => {
    const result = decodeNcm(buffer(readFileSync(new URL(`./fixtures/tone-${format}.ncm`, import.meta.url))));
    assert.equal(result.format, format);
    assert.deepEqual(Buffer.from(result.data), readFileSync(new URL(`./fixtures/tone.${format}`, import.meta.url)));
    assert.equal(result.metadata.title, `Tone ${format.toUpperCase()}`);
    assert.equal(result.metadata.artist, 'NCM Swift');
  });
}
test('rejects a false header and truncated length fields', () => {
  assert.throws(() => decodeNcm(new ArrayBuffer(0)), /有效/);
  const fixture = readFileSync(new URL('./fixtures/tone-mp3.ncm', import.meta.url));
  assert.throws(() => decodeNcm(buffer(fixture.subarray(0, 12))), /有效/);
  const corrupt = Buffer.from(fixture); corrupt.writeUInt32LE(0xffffffff, 10);
  assert.throws(() => decodeNcm(buffer(corrupt)), /损坏/);
});
test('rejects encrypted non-audio instead of mislabeling it MP3', () => {
  assert.throws(() => decodeNcm(buffer(wrapNcm(Buffer.from('not music')))), /识别/);
});
test('recovers audio when optional metadata is corrupt', () => {
  const fixture = readFileSync(new URL('./fixtures/tone-mp3.ncm', import.meta.url));
  const keyLength = fixture.readUInt32LE(10), metaOffset = 14 + keyLength;
  fixture.fill(0, metaOffset + 4, metaOffset + 4 + fixture.readUInt32LE(metaOffset));
  const result = decodeNcm(buffer(fixture));
  assert.deepEqual(result.metadata, {});
  assert.equal(result.format, 'mp3');
});
