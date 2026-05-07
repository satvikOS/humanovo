# humanovo — Landing-page download integration

End users never visit GitHub. They land on **www.humanovo.net**, see
"Download for Mac / Windows / Linux", click, and the platform-specific
installer comes straight from humanovo.net.

This doc explains how to wire the landing-page download buttons so the
binaries from `build-native-apps.yml` (auto-published to GitHub
Releases on every push to `humanovo`) flow to users without humanovo.net
ever exposing a github.com URL.

## Two integration patterns

### Pattern A — redirect (simplest, recommended)

humanovo.net hosts a small handler at `/download/{platform}` that
**302-redirects** to the GitHub Releases asset URL for the latest
release. The user's browser sees the redirect and follows it; the
download happens from `objects.githubusercontent.com` but the click
stays on humanovo.net.

Implementation: a static JSON manifest + 4 redirect routes. The
landing page reads the manifest at page load to populate the button
labels with the current version.

| User visits | Server returns | Browser ends up at |
|---|---|---|
| `humanovo.net/download/macos` | `302 Location: github.com/.../humanovo_<v>_universal.dmg` | `objects.githubusercontent.com/...` (download starts) |
| `humanovo.net/download/windows` | `302 Location: github.com/.../humanovo_<v>_x64-setup.exe` | (download starts) |
| `humanovo.net/download/linux/deb` | `302 Location: github.com/.../humanovo_<v>_amd64.deb` | (download starts) |
| `humanovo.net/download/linux/appimage` | `302 Location: github.com/.../humanovo_<v>_amd64.AppImage` | (download starts) |
| `humanovo.net/download/latest.json` | `302 Location: github.com/.../latest.json` | (Tauri updater hits this) |

Latency cost: ~50-150ms one-time redirect on click. Zero ongoing
hosting cost.

### Pattern B — full mirror (later, when scale or branding requires)

humanovo.net **proxies** the binaries through an S3 bucket
(`humanovo-releases-{region}`) fronted by CloudFront at
`releases.humanovo.com`. On every push the workflow uploads the same
artifacts to both GitHub Releases AND S3. User downloads come from
CloudFront → never touches github.com.

Tradeoffs: faster (CloudFront edges), branded URL throughout, but
adds an S3 bucket + ~$1-5/month at closed-beta scale, plus the
upload step in the workflow.

Recommended path: **start with Pattern A** (zero ops cost, ships
today), migrate to Pattern B when traffic justifies it (>10K
downloads/month or when "github.com appears in download URL" becomes
a customer-facing concern).

---

## Pattern A — landing-page implementation

### What humanovo.net needs to serve

If www.humanovo.net is a **Vercel / Netlify / Cloudflare Pages** site
(typical for a marketing landing page), drop these as serverless
redirect functions or static `_redirects` rules.

#### Vercel — `vercel.json`

```jsonc
{
  "redirects": [
    {
      "source": "/download/macos",
      "destination": "https://github.com/satvikOS/humanovo/releases/latest/download/humanovo_universal.dmg",
      "permanent": false
    },
    {
      "source": "/download/windows",
      "destination": "https://github.com/satvikOS/humanovo/releases/latest/download/humanovo_x64-setup.exe",
      "permanent": false
    },
    {
      "source": "/download/linux/deb",
      "destination": "https://github.com/satvikOS/humanovo/releases/latest/download/humanovo_amd64.deb",
      "permanent": false
    },
    {
      "source": "/download/linux/appimage",
      "destination": "https://github.com/satvikOS/humanovo/releases/latest/download/humanovo_amd64.AppImage",
      "permanent": false
    },
    {
      "source": "/download/latest.json",
      "destination": "https://github.com/satvikOS/humanovo/releases/latest/download/latest.json",
      "permanent": false
    }
  ]
}
```

#### Cloudflare Pages — `public/_redirects`

```
/download/macos             https://github.com/satvikOS/humanovo/releases/latest/download/humanovo_universal.dmg              302
/download/windows           https://github.com/satvikOS/humanovo/releases/latest/download/humanovo_x64-setup.exe              302
/download/linux/deb         https://github.com/satvikOS/humanovo/releases/latest/download/humanovo_amd64.deb                  302
/download/linux/appimage    https://github.com/satvikOS/humanovo/releases/latest/download/humanovo_amd64.AppImage             302
/download/latest.json       https://github.com/satvikOS/humanovo/releases/latest/download/latest.json                         302
```

#### Netlify — `netlify.toml`

```toml
[[redirects]]
  from = "/download/macos"
  to = "https://github.com/satvikOS/humanovo/releases/latest/download/humanovo_universal.dmg"
  status = 302
  force = true

# ...repeat for windows / linux / latest.json
```

#### Plain Nginx (if humanovo.net is self-hosted)

```nginx
location = /download/macos {
    return 302 https://github.com/satvikOS/humanovo/releases/latest/download/humanovo_universal.dmg;
}
location = /download/windows {
    return 302 https://github.com/satvikOS/humanovo/releases/latest/download/humanovo_x64-setup.exe;
}
location = /download/linux/deb {
    return 302 https://github.com/satvikOS/humanovo/releases/latest/download/humanovo_amd64.deb;
}
location = /download/linux/appimage {
    return 302 https://github.com/satvikOS/humanovo/releases/latest/download/humanovo_amd64.AppImage;
}
location = /download/latest.json {
    return 302 https://github.com/satvikOS/humanovo/releases/latest/download/latest.json;
}
```

### Filename caveat — versioning

GitHub Releases serves assets at the *exact* filename uploaded by the
build workflow. Tauri-action names them with the version embedded,
e.g. `humanovo_0.2.0+abcd1234_universal.dmg`. The `latest/download/`
shortcut serves the latest release's asset by name *without* the
version embedded, so `humanovo_universal.dmg` would 404 because the
real asset is `humanovo_0.2.0+abcd1234_universal.dmg`.

Two ways to fix this:

**Option 1 — strip the version from the bundle filename** in
`tauri.conf.json` so artifacts come out as `humanovo_universal.dmg`
flat. This makes the redirect URLs above work as-is.

**Option 2 — landing page reads `/download/latest.json` first**, then
constructs the full filename from the `version` field, then redirects.
Requires JavaScript on the landing page.

Recommended: **Option 1 for closed beta**, switch to Option 2 once we
have a frontend developer maintaining the landing page.

### Landing page UI snippet

Pseudocode for the marketing site to populate buttons with the
current version pulled from latest.json:

```ts
// On page load:
const manifest = await fetch('/download/latest.json').then(r => r.json())
const version = manifest.version  // e.g., "0.2.0+abcd1234"

document.getElementById('mac-btn').href     = '/download/macos'
document.getElementById('win-btn').href     = '/download/windows'
document.getElementById('linux-btn').href   = '/download/linux/deb'
document.getElementById('appimg-btn').href  = '/download/linux/appimage'

// And surface the version in subtle text under the buttons:
document.getElementById('version-tag').textContent = `v${version}`

// OS detection so the most-prominent button matches the visitor's OS
const ua = navigator.userAgent
const primary =
  /Mac/.test(ua)     ? '/download/macos'
  : /Windows/.test(ua) ? '/download/windows'
  : '/download/linux/deb'
document.getElementById('primary-cta').href = primary
```

---

## Tauri auto-updater — also goes through humanovo.net

Currently the updater config in `tauri.conf.json` points directly at
GitHub:

```jsonc
"updater": {
  "endpoints": [
    "https://github.com/satvikOS/humanovo/releases/latest/download/latest.json"
  ]
}
```

Once the landing-page redirect handlers are in place, swap this to:

```jsonc
"updater": {
  "endpoints": [
    "https://www.humanovo.net/download/latest.json"
  ]
}
```

Now installed apps fetch the manifest from humanovo.net (which 302's
to GitHub for the actual JSON). End users never see github.com,
including in their device's network logs. Makes future migration to
Pattern B (full S3 mirror) a no-op on the client side.

---

## What to do today

1. Confirm where www.humanovo.net is hosted (Vercel / Cloudflare /
   Netlify / self-hosted Nginx).
2. Drop the matching redirect rules from above into the landing-page
   repo.
3. Add four download buttons to the landing page (Mac / Windows / Linux
   .deb / Linux .AppImage). Each button is just a link to
   `/download/<platform>`.
4. After the next humanovo build publishes a release, click each button
   from a fresh browser to verify the redirect resolves and the
   download starts.
5. Once verified, edit `frontend/src-tauri/tauri.conf.json` to point
   the updater endpoint at `https://www.humanovo.net/download/latest.json`
   and push — every installed app's next launch will hit the new
   endpoint.

Until step 5, the auto-updater still works (it just resolves through
github.com directly). New downloads from the marketing page will
already be visibly humanovo.net once steps 1-3 are done.
