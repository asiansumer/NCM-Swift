# Release QA — minimal NCM → MP3 converter

final result: passed

## Scope and visual truth

The user accepted the v4 machine, then explicitly requested a minimal working converter and GitHub deployment. The machine geometry, materials, lighting and projected-card handoff are preserved. Removing the demo console, prose, navigation and sample tracks is an intentional change.

- Source: `../../outputs/music-machine-v4/preview.png` (1425 × 710; accepted READY hero).
- Implementation: `../../outputs/release-check/desktop-ready-final.png` (1440 × 1024, CSS 1440 × 1024, density 1).
- Combined comparison opened and reviewed: `../../outputs/release-check/source-comparison.png` (1800 × 720). Both full captures were scaled proportionally to equal-width columns; heights differ because the new view includes its full viewport and footer. This is a machine/material continuity review, not a pixel match to the old text-heavy layout.
- Focused machine review is visible within that combined image: same housing, metal lid/tray, glass, rollers, highlights and contact shadow. No separate crop was needed.
- Mobile READY: `../../outputs/release-check/mobile-ready-final.png` (390 × 844).
- Desktop results: `../../outputs/release-check/desktop-results.png` (1440 × 1024).
- Mobile results: `../../outputs/release-check/mobile-results.png` (390 × 908; before the final compact-spacing pass).

## Iterations

1. P2: Output camera cut the bottom of the tray and left excess distance above the list. Increased the final camera distance and placed the list relative to the stage midpoint. Rechecked the whole model and five-file list in `desktop-results.png`; no clipping remains.
2. P2: Mobile READY left too much blank space before the machine. Shortened the stage, moved its top boundary, and adjusted its initial camera aim. The final capture shows the complete model, upload button, hint and footer in one 390 × 844 view. Mobile lists now show three rows with scrolling to preserve room for the machine.

No actionable P0/P1/P2 visual findings remain within the requested scope.

## Functional verification

- Production build, TypeScript and ESLint pass.
- Five automated tests pass: byte-exact MP3/FLAC recovery, real metadata extraction, truncated/invalid headers, invalid audio and optional corrupt metadata.
- Browser converted an MP3 NCM, a FLAC NCM and a broken NCM in one batch: two successes, one isolated error.
- Browser converted five files in one batch; visible selection count and the scrollable list match the actual results.
- Selection changes update the ZIP count. Preview changes to pause and completes. Clearing returns to READY.
- Actual ZIP downloaded and opened: both expected MP3 files are present.
- Original MP3 SHA-1 is unchanged: `9e31a103d197eb642d3260b12280a09425dd2ead`.
- FLAC-derived output verified with ffprobe: MP3, 44100 Hz, stereo, 3.0302 seconds.
- Single MP3 download verified independently; its SHA-1 matches the same file inside the ZIP: `2221a28942632244fffe04d2a6a85f9c2bebf632`.
- Browser console: no warnings or errors in the tested conversion flow.
- Production dependency audit: zero reported vulnerabilities after pruning legacy dependencies and applying compatible patches. Five dev-only findings remain in the ESLint glob chain; these do not ship in the runtime.
- No platform links, remote cover fetches or audio uploads were added.

## Limits of this verification

Tests use original synthetic NCM fixtures, not a user's music library. Responsive checks use browser viewports, not physical phones. Physical-device Safari/Firefox, prolonged large-file runs and cancellation during an active long encode were not exercised. Cancellation and worker/object-URL cleanup are implemented, but those cases are not claimed as browser-verified here.

## Production smoke check

The deployed site at https://www.ncmswift.xyz successfully converted the synthetic FLAC-containing NCM to a 122 KB MP3. The machine, result row, preview and download controls rendered with no browser console errors. The apex domain redirects to www.
