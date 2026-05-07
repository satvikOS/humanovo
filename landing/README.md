# humanovo — landing site

Next.js 16 (App Router) + React 19 + Tailwind 4 + Fraunces / JetBrains Mono.
Editorial-scientific aesthetic: Renaissance anatomical art on warm parchment,
typography-led, ornament-as-information.

Deployed to **www.humanovo.net** via Vercel. Vercel "Root Directory" project
setting points at this `landing/` directory inside the monorepo so the
site only rebuilds when files in this path change.

## Design language

> "Editorial scientific" — built like the title page of a 1543 anatomy
> textbook, animated like a 2026 product. Ink on paper. Restrained.

| | |
|---|---|
| Display + body | [Fraunces](https://fonts.google.com/specimen/Fraunces) (variable serif, opsz + SOFT + WONK axes) |
| Mono / labels | [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) |
| Palette | Paper (warm parchment) → Ink (charcoal) + Rust accent + Ochre / Sage / Wine for context |
| Motion | GSAP ScrollTrigger for narrative reveals; Framer Motion for component-level interactions; everything respects `prefers-reduced-motion` |
| Art | Public-domain Renaissance anatomy plates — Vesalius *Fabrica* 1543, Leonardo da Vinci, Bourgery & Jacob écorchés, Valverde |

Design tokens live in `src/app/globals.css` under `:root`. The full critique and
forward roadmap is in [`DESIGN_NOTES.md`](./DESIGN_NOTES.md).

## Page structure

```
PlatformLock         · gates non-desktop devices off the experience
AuroraBackdrop       · soft gradient field
Navigation           · sticky pill nav with morphing slider
ContactOverlay       · "Request access" form (POSTs to /api/contact via Resend)
─────────────────────────────────────────────
1. Page1Hero         · wordmark, rotating tagline, Vitruvian, proof-stats
2. PageWedge         · "Why humanovo" — typographic, no art, reset the eye
3. Page2Pipeline     · 4-stage adversarial pipeline with side-nav
4. PageTrust         · founders + privacy commitment + methodology
5. PageDownload      · Win / Mac / Linux native installers
```

## Deploy

This `landing/` directory is the **source of truth** but it is *not* the
repo Vercel pulls from. A GitHub Action
([`.github/workflows/mirror-landing-to-deploy.yml`](../.github/workflows/mirror-landing-to-deploy.yml))
mirrors this directory to a separate landing-only repo on every push to
`humanovo` that touches `landing/**`. Vercel is connected to that
sister repo and never sees the platform monorepo.

Why this matters:

- Vercel's git integration clones the **entire** repo into its build
  environment even when "Root Directory" is set to a subdirectory. For
  a monorepo carrying backend, infrastructure, and Terraform state
  references, that's a privacy + attack-surface concern.
- The mirror flow keeps Vercel scoped to a public-facing repo that
  contains only the landing source.
- The mirror is one-way (this repo → deploy repo). Edits in the deploy
  repo will be overwritten on the next sync; always edit here.

### One-time setup

1. **Create a fine-grained PAT**: GitHub Settings →
   [Personal access tokens (fine-grained)](https://github.com/settings/personal-access-tokens/new).
   - Repository access: **only** the destination landing-deploy repo.
   - Permissions: `Contents: Read and write`, `Metadata: Read`.
2. **Add the secret** in this repo (Settings → Secrets and variables → Actions):
   - Name: `LANDING_DEPLOY_PAT`
   - Value: the PAT from step 1.
3. **Set the destination repo**: edit `DEST_REPO` at the top of
   `.github/workflows/mirror-landing-to-deploy.yml` if your destination
   repo isn't `satvikOS/humanovo-landing`.
4. **Verify Vercel** is connected to the destination repo's `main`
   branch (not this repo).

### Manual triggers

- **Force mirror without code change**: GitHub Actions tab → Mirror
  landing/ to deploy repo → "Run workflow" → set `force = true`.
- **Local dry-run** of what would mirror:
  ```bash
  cd landing && find . -type f \
    -not -path "./node_modules/*" -not -path "./.next/*"
  ```

### Local development

```bash
cd landing
npm install
npm run dev
# open http://localhost:3000
```

Set `RESEND_API_KEY` in `.env.local` for the contact form to actually send.

The `.env.local` file is gitignored AND stripped during the mirror sync,
so local secrets never reach Vercel by accident.

## Brand fundamentals

- The wordmark is `humanovo` in Fraunces italic at opsz=72, SOFT=80, WONK=1.
  Lowercase is intentional. Tracking is `-0.045em`.
- The mark (when needed) is a charcoal rounded square with a rust dot.
- Never pair the wordmark with a tagline directly underneath in the same
  weight — let the tagline live elsewhere on the page in a softer treatment.
- Renaissance plates always sit in `<ArtFrame>` (sepia-graded, never raw),
  always with a journal-style figure caption beneath.
- "Coming soon" buttons are functional placeholders — pulse-dot in rust,
  ghost button, opacity 0.75. Do not promote them visually.
