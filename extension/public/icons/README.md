# Extension icons

Three PNG sizes required by Chrome Web Store: `16.png`, `48.png`, `128.png`.

**Source-of-truth:** export from Figma/Sketch using the CyberSkill saffron-gold mascot face (or a simple "SN" monogram on `#FAA227` background).

For now these files are intentionally absent; the extension loads with fallback browser icons in unpacked dev mode. Before submission to Chrome Web Store, drop the three PNGs in this folder and the `manifest.json` `icons` block will pick them up automatically.

Recommended generation:
```bash
# From a 1024×1024 master.png:
for s in 16 48 128; do
  magick master.png -resize ${s}x${s} ${s}.png
done
```
