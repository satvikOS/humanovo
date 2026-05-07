# Landing-page Vercel config

Drop-in `vercel.json` for the **www.humanovo.net** Vercel project (this
file lives in the marketing-site repo, NOT in the humanovo backend
monorepo). Six 302 redirects so end users see only `humanovo.net/...`
URLs in their browser — never `github.com`.

## Install

```bash
# In the landing-page repo:
cp /path/to/this/vercel.json ./vercel.json
git add vercel.json
git commit -m "feat: download redirects to GitHub Releases"
git push          # Vercel auto-deploys on push
```

If `vercel.json` already exists in the landing repo, merge the
`redirects` array into the existing file rather than overwriting.

## Verify (after Vercel redeploys)

```bash
curl -sI https://www.humanovo.net/download/macos | grep -i location
# expect: location: https://github.com/satvikOS/humanovo/releases/latest/download/humanovo_universal.dmg

curl -sI https://www.humanovo.net/download/latest.json | grep -i location
# expect: location: https://github.com/satvikOS/humanovo/releases/latest/download/latest.json
```

Then in a fresh browser, click each download button on humanovo.net.
The download dialog should appear within 100-200ms of click.

## Stable filenames

Each redirect targets a stable, version-less filename
(`humanovo_universal.dmg`, `humanovo_x64-setup.exe`, etc.). The
backend repo's build workflow uploads these as aliases alongside the
versioned ones, so `releases/latest/download/<stable-name>` always
resolves to the most recent release. No landing-page change needed
when versions bump.

## Landing-page UI hookup

```html
<a href="/download/macos"           id="cta-mac">Download for Mac</a>
<a href="/download/windows"         id="cta-win">Download for Windows</a>
<a href="/download/linux/deb"       id="cta-deb">Download .deb</a>
<a href="/download/linux/appimage"  id="cta-app">Download .AppImage</a>
```

OS detection so the primary CTA matches the visitor's platform:

```ts
const ua = navigator.userAgent
const primary =
  /Mac/.test(ua)        ? '/download/macos'
  : /Windows/.test(ua)  ? '/download/windows'
  :                       '/download/linux/deb'
document.getElementById('primary-cta').href = primary
```

## Version display (optional)

Pull the live version label from the latest release manifest:

```ts
const m = await fetch('/download/latest.json').then(r => r.json())
document.getElementById('version-tag').textContent = `v${m.version}`
```

## Tauri auto-updater (later)

Once the redirects are verified live, edit
`frontend/src-tauri/tauri.conf.json` in the backend repo and swap the
updater endpoint to `https://www.humanovo.net/download/latest.json`.
Now installed apps fetch update manifests from humanovo.net too;
github.com disappears from network logs entirely.
