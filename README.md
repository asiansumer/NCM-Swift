# NCM Swift

A minimal, local NCM → MP3 converter with an interactive 3D music machine.

Production: https://www.ncmswift.xyz

## Use

Choose or drop `.ncm` files. Conversion starts automatically. Preview, download individual files, or select files and download a ZIP.

- Audio stays in the browser. No file uploads, accounts, analytics or cover-art requests.
- NCM containing MP3 preserves the original audio bytes.
- NCM containing FLAC is decoded locally and encoded as 320 kbps MP3. This is a lossy conversion; it does not improve the source quality.
- Files are processed sequentially in workers. Cancel keeps completed files.
- Limits: 100 MB per file, 100 files / 500 MB per batch. Results are temporary and are cleared when the page closes or a new batch starts.
- Current Chrome, Edge, Firefox and Safari are intended targets. FLAC conversion needs browser FLAC decoding; unavailable formats produce an error rather than a falsely named MP3.
- No Spotify, SoundCloud or NetEase link integration.

## Development

Node 22.18+ (Node 24 LTS recommended).

```sh
npm ci
npm run dev
npm test
npm run lint
npm run build
```

`/` is the converter. Legacy `/convert`, `/machine` and `/contact` links redirect to `/`.

The synthetic fixtures in `tests/fixtures` contain original test tones. Regenerate with `node tools/create-test-fixtures.mjs` (requires ffmpeg). Tests compare recovered bytes with the source MP3/FLAC and check malformed files. Browser QA also covers FLAC → MP3, mixed batches, playback and ZIP output.

The Blender-authored model can be rebuilt with `tools/build_machine.py`. See `public/machine/ASSETS.md` for asset credits.

## Deployment

GitHub repository: `asiansumer/NCM-Swift`, production branch `master`. The existing Vercel project builds Next.js automatically. No environment variables or backend services are required. The local `.vercel` link is intentionally ignored; connect to the current account/project before using the CLI.

## Third-party notices

MP3 encoding uses [`@breezystack/lamejs` 1.2.7](https://github.com/shijinyu/lamejs), licensed under LGPL-3.0. Its license is distributed at `/licenses/lamejs-LICENSE.txt`; corresponding source is available from the linked repository and the pinned npm package. The application source and lockfile are public, so this library can be replaced and the app rebuilt.
