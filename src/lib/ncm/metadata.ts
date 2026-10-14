import { TagLib, type Picture, type PropertyMap } from 'taglib-wasm';
import type { AudioMetadata, DecodedNcm } from './decode.ts';

let library: Promise<TagLib> | undefined;
const getLibrary = () => library ??= TagLib.initialize();
const copyPictures = (pictures: Picture[]): Picture[] => pictures.map(p => ({ ...p, data: new Uint8Array(p.data) }));
const describe = (properties: PropertyMap, pictures: Picture[], lyrics: AudioMetadata['lyrics']): AudioMetadata => ({
  properties, pictures, lyrics,
  title: properties.title?.[0], artist: properties.artist?.join(', '), album: properties.album?.[0],
});

/** Keep existing audio tags; supplement missing fields from the NCM container. */
export async function restoreMetadata(decoded: DecodedNcm, fallbackTitle: string): Promise<DecodedNcm> {
  const file = await (await getLibrary()).open(new Uint8Array(decoded.data), { partial: false });
  try {
    const existing = file.properties();
    const properties = { ...existing };
    let changed = false;
    for (const [key, values] of Object.entries({ title: [fallbackTitle], ...decoded.metadata.properties })) {
      if (!properties[key]?.some(value => value.trim()) && values?.length) { properties[key] = values; changed = true; }
    }
    const pictures = copyPictures(file.getPictures());
    const cover = decoded.metadata.pictures?.[0];
    const addCover = cover && !pictures.some(p => p.type === 'FrontCover');
    if (addCover) pictures.push(cover);
    const lyrics = file.getLyrics();
    // Native MP3 needs tagging too. Updating its container never re-encodes the audio.
    if (decoded.format === 'mp3' && (changed || addCover)) {
      if (changed) file.setProperties(properties);
      if (addCover) file.addPicture(cover);
      if (!file.save()) throw new Error('无法保存歌曲信息，请重试');
      decoded.data = new Uint8Array(file.getFileBuffer()).buffer;
    }
    return { ...decoded, metadata: describe(properties, pictures, lyrics) };
  } finally { file.dispose(); }
}

/** Copy the FLAC source tags and artwork into the newly encoded MP3. */
export async function tagMp3(data: ArrayBuffer, metadata: AudioMetadata): Promise<Blob> {
  const file = await (await getLibrary()).open(new Uint8Array(data), { partial: false });
  try {
    file.setProperties({ ...file.properties(), ...metadata.properties });
    if (metadata.pictures?.length) file.setPictures(metadata.pictures);
    if (metadata.lyrics?.length) file.setLyrics(metadata.lyrics);
    if (!file.save()) throw new Error('无法保存歌曲信息，请重试');
    return new Blob([new Uint8Array(file.getFileBuffer())], { type: 'audio/mpeg' });
  } finally { file.dispose(); }
}
