/**
 * Ambient module declarations for Tauri v2 plugin packages.
 *
 * The Tauri plugins (`@tauri-apps/plugin-shell`, etc.) are NOT in
 * `frontend/package.json` because they only get installed when a
 * developer runs `npm run tauri:dev` or `npm run tauri:build` locally
 * (the `tauri` CLI installs them on first invocation). The web build
 * never imports them at runtime — `native.ts` guards every import with
 * `if (isNativeApp())`.
 *
 * Without these ambient declarations TypeScript would error out on
 * the dynamic-import expressions in `native.ts` because it can't
 * find the modules in `node_modules`. Declaring them as `unknown`
 * surface lets the web build compile cleanly; the native build picks
 * up the real types from the actually-installed packages (which take
 * precedence over ambient `.d.ts` files).
 */

declare module '@tauri-apps/plugin-shell' {
  export const open: (path: string) => Promise<void>
  export const Command: unknown
}

declare module '@tauri-apps/plugin-deep-link' {
  export type DeepLinkHandler = (urls: string[]) => void
  export const onOpenUrl: (handler: DeepLinkHandler) => Promise<() => void>
}

declare module '@tauri-apps/plugin-os' {
  export const platform: () => Promise<
    'macos' | 'windows' | 'linux' | 'ios' | 'android' | string
  >
}

declare module '@tauri-apps/plugin-process' {
  export const exit: (code?: number) => Promise<void>
  export const relaunch: () => Promise<void>
}

declare module '@tauri-apps/plugin-updater' {
  export const check: () => Promise<unknown>
}

declare module '@tauri-apps/api' {
  export const event: unknown
  export const window: unknown
}
