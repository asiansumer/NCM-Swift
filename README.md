# NCM Swift

A minimal, local NCM → MP3 converter with an interactive 3D music machine.

Production: https://www.ncmswift.xyz

## Use

Choose or drop `.ncm` files. Conversion starts automatically. Preview, download individual files, or select files and download a ZIP.

- Audio stays in the browser. No audio uploads, accounts or analytics. When embedded artwork is absent, the browser downloads the public NetEase image URL already stored in the NCM metadata; it sends no audio, filename, cookies or referrer.
- Embedded artwork and tags (title, artists, album, track/disc, date, genre and existing lyrics) are carried into the output. Existing audio tags take precedence; NCM tags fill missing fields. Embedded artwork takes priority. Newer NCM files with an empty image block use their `albumPic` URL to complete the artwork, which is then embedded in the output. Failed cover requests leave the audio usable and show a brief warning.
- NCM containing MP3 preserves its audio stream; its tag container is updated where necessary.
- NCM containing FLAC is decoded locally and encoded as 320 kbps MP3. This is a lossy conversion; it does not improve the source quality.
- Files are processed sequentially in workers. Cancel keeps completed files.
- Limits: 100 MB per file, 100 files / 500 MB per batch. Results are temporary and are cleared when the page closes or a new batch starts.
- Current Chrome, Edge, Firefox and Safari are intended targets. FLAC conversion needs browser FLAC decoding; unavailable formats produce an error rather than a falsely named MP3.
- No Spotify, SoundCloud or NetEase song/playlist link integration. Artwork completion only uses the image address already stored in a selected local NCM file.

## Development

Node 24+ and ffmpeg/ffprobe for metadata regression tests.

```sh
npm ci
npm run dev
npm test
npm run lint
npm run build
```

`/` is the converter. Legacy `/convert`, `/machine` and `/contact` links redirect to `/`.

The synthetic fixtures in `tests/fixtures` contain original test tones. Regenerate with `node tools/create-test-fixtures.mjs` (requires ffmpeg). Tests compare recovered bytes with the source MP3/FLAC, check malformed files, and use ffprobe to independently inspect exported metadata and artwork. They run the same TagLib Emscripten backend used in the browser, including ID3v2.3/v2.4 tag preservation and FLAC-to-MP3 metadata transfer. Browser QA also covers FLAC → MP3, mixed batches, playback and ZIP output.

The Blender-authored model can be rebuilt with `tools/build_machine.py`. See `public/machine/ASSETS.md` for asset credits.

## Deployment

GitHub repository: `asiansumer/NCM-Swift`, production branch `master`. The existing Vercel project builds Next.js automatically. No environment variables or backend services are required. The local `.vercel` link is intentionally ignored; connect to the current account/project before using the CLI.

## Third-party notices

MP3 encoding uses [`@breezystack/lamejs` 1.2.7](https://github.com/shijinyu/lamejs), licensed under LGPL-3.0. The encoder is based on [LAME](https://lame.sourceforge.net/). Its upstream notice and the full LGPL/GPL texts are distributed under `/licenses/`; corresponding source is available from the linked repository and the pinned npm package. The application source and lockfile are public, so this library can be replaced and the app rebuilt.

Metadata uses [`taglib-wasm` 2.4.0](https://github.com/CharlesWiltgen/TagLib-Wasm): JavaScript/TypeScript under MIT and unmodified TagLib WebAssembly under LGPL-2.1-or-later. Both notices are in `/licenses/`. The WASM is shipped as a separate webpack asset, not embedded into application code. To replace it, build a modified TagLib-Wasm from the linked source, substitute `dist/taglib-web.wasm` in the package, and rebuild this public application. The lockfile records the exact package. `browser-id3-writer` is used only to construct independent regression fixtures.

### URL-only cover regression

Some newer NCM files reserve a cover block but set the actual image length to zero. `albumPic` in their metadata is the only source of artwork. The browser normalizes those URLs to HTTPS and accepts only public `pN.music.126.net` JPEG/PNG image paths. Fetches have a 4.5-second timeout and an 8 MiB limit; failures never discard audio. Existing embedded pictures do not trigger a network request. There is no image proxy or audio backend.

The automated suite covers URL-only MP3/FLAC metadata, offline fallback, embedded-art precedence, URL restrictions and invalid/oversized responses. The reported real-file case was also verified in the browser and its downloaded MP3: 800 × 800 embedded JPEG, source audio payload unchanged. User music and converted music are never added to the repository.
