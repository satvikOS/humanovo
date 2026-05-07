#!/usr/bin/env python3
"""
Generate a 1024x1024 placeholder app icon as a solid-color PNG.

Used by the build-native-apps.yml workflow when there's no committed
icon for Tauri's bundler to consume. Pure-stdlib (no Pillow / IM
dependency) so the build runner doesn't need extra packages.

Output:  frontend/src-tauri/icons/icon.png  (humanovo bronze #C4956A)

Usage:
    python3 scripts/generate_placeholder_icon.py [output_path]

Default output path: frontend/src-tauri/icons/icon.png
"""
from __future__ import annotations

import struct
import sys
import zlib
from pathlib import Path

WIDTH = HEIGHT = 1024
# humanovo accent color — keep in sync with the brand palette in
# frontend/tailwind.config.js if that ever changes.
PIXEL = bytes([0xC4, 0x95, 0x6A, 0xFF])


def png(width: int, height: int, rgba: bytes) -> bytes:
    """Build a minimal RGBA PNG byte stream for a solid color."""
    row = b"\x00" + rgba * width  # filter byte 0 (None) + scanline
    raw = row * height

    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    ihdr = struct.pack(
        ">IIBBBBB",
        width,
        height,
        8,  # bit depth
        6,  # color type: RGBA
        0,  # compression
        0,  # filter
        0,  # interlace
    )
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def main() -> int:
    out = Path(
        sys.argv[1] if len(sys.argv) > 1 else "frontend/src-tauri/icons/icon.png"
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(png(WIDTH, HEIGHT, PIXEL))
    print(f"wrote {out} ({WIDTH}x{HEIGHT}, {out.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
