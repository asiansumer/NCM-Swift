# Machine assets

- `studio-small-09.hdr`: Poly Haven, Studio Small 09 by Sergej Majboroda, CC0. 1K HDR source: https://polyhaven.com/a/studio_small_09 ; https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr . Bundled locally for predictable loading and no third-party runtime requests.
- `grain.jpg`, `ticket.jpg`: generated for this prototype from its approved Signal Press direction; optimized from PNG masters archived with the design work.
- The production app contains no demo audio or platform integrations.

- `signal-press.glb`: original hard-surface model authored locally in Blender. Rebuild with `tools/build_machine.py`; includes chamfered cast housing, rolled sheet metal, lathed rollers, machined bearings, separate glass and switch, and baked vertex contact occlusion. Static components are merged by material; rollers retain independent pivots.
