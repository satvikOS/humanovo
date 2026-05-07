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

## Local development

```bash
cd landing
npm install
npm run dev
# open http://localhost:3000
```

Set `RESEND_API_KEY` in `.env.local` for the contact form to actually send.

## Deploy

Pushed automatically when `landing/` changes hit `humanovo` branch (Vercel git
integration with Root Directory = `landing`). The `vercel.json` in this
directory maps the public download endpoints (`/download/macos`,
`/download/windows`, etc.) to the GitHub Releases artifacts published by the
`build-native-apps.yml` workflow.

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
