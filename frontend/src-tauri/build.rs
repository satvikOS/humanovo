// Tauri build script — wires up the platform-specific bundler hooks
// and embeds the icons / metadata into the final binary. Don't edit
// unless you know what you're doing; the tauri-build crate does the
// heavy lifting.

fn main() {
    tauri_build::build()
}
