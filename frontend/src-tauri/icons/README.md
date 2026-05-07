# Icon assets

Tauri requires the following files:

| File | Purpose |
|---|---|
| `32x32.png` | Linux taskbar |
| `128x128.png` | Linux launcher / about dialog |
| `128x128@2x.png` | Linux retina (256×256 actual pixels) |
| `icon.icns` | macOS app icon (multi-resolution Apple bundle) |
| `icon.ico` | Windows taskbar / installer icon |

The Tauri CLI generates all five from a single 1024×1024 source PNG:

```
cd frontend
npm run tauri icon path/to/source.png
```

This must be run **before** the first `npm run tauri build`, otherwise
the bundler will fail with "icon file does not exist".

For the closed-beta demo a placeholder humanovo glyph (the same one
in `frontend/src/components/HumanovoGlyph.tsx`) is fine — replace
with a properly-designed app icon before public release.

These icon files are intentionally NOT committed to git (added to
`.gitignore` once generated to keep the binary blobs out of the
repo). The first build on each machine regenerates them.
