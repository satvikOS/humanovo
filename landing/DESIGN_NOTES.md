# Landing — Design Notes & Roadmap

Lead-designer critique of the inherited landing source, the changes
shipped in this round, and the deferred items prioritised for later.
Tone: how a senior designer at Anthropic / Stripe / Recursion would
read this if they were brought in for a one-week polish sprint.

## What's already strong (don't change)

The foundation is genuinely above-average for a pre-launch AI startup:

- **Differentiated visual identity.** Renaissance anatomical art on
  warm parchment is unique in the biomedical-AI space — every other
  player ships gradients, cell-microscopy imagery, or "abstract DNA
  helix #4." Vesalius *Fabrica*, Leonardo, Bourgery écorchés signal
  *we made this for serious people who like serious things*.
- **Two-font typography.** Fraunces (variable serif, opsz + SOFT +
  WONK axes) + JetBrains Mono is the right pairing for an editorial-
  scientific brand. Anthropic uses two fonts. Stripe uses two. Linear
  uses two. It works because every weight, every variant comes from
  the same family — the eye reads "one voice, many registers."
- **Editorial framing.** "Vol. I · No. 01," "Pl. III," "Stage 02 / 04,"
  italic figure captions — these tiny details signal *we respect your
  intelligence*. Researchers, the audience, will notice. They are
  the people who notice.
- **Restrained motion.** GSAP ScrollTrigger drives narrative reveals,
  not decoration. Each animation has a job (hero entrance, stage
  reveal, tagline crossfade). No animation for animation's sake.

## What was missing (shipped this round)

### 1. The "wedge" — answering *why this, why now, why not ChatGPT*

The original page goes Hero → Pipeline → Download. It says **what
humanovo does** but never **why a researcher should switch from
Elicit, Consensus, ChatGPT, or their existing workflow**. That's the
single largest conversion-killer on AI-tool landing pages.

**Shipped:** `PageWedge.tsx` between hero and pipeline. Pure typography
(no art, deliberately, to reset the eye after the heavy hero plate).
A single italic Fraunces statement: *"ChatGPT doesn't know what your
lab read yesterday. humanovo does."* Followed by three precise
contrasts (humanovo vs literature search, vs notebook apps, vs LLM
chat). One wedge, three angles.

### 2. The "trust" surface — founders, privacy, methodology

Researchers are professional skeptics. They will not give you an
email address until they know:
- Who built this. (Specifically: do you understand my world?)
- What you do with my data. (Specifically: do you train on it?)
- How the methodology actually works. (Specifically: are these
  citations real, or hallucinated?)

The original page answered none of these.

**Shipped:** `PageTrust.tsx` before the download section. Three-column
editorial layout: founder credentials, privacy commitment, citation-
roundtrip methodology. Each block in a distinct register (italic
quote, all-caps mono commitment, bordered scientific spec). Reads
like the colophon page of a journal issue.

### 3. Concrete proof-stats instead of marketing numbers

Original stats: "12× faster · 7M+ papers · 0 ctx-switches." All
three of those would fail a researcher's BS-detector. "12× faster
than what?" "7M+ papers — relative to PubMed's 36M, this is a
quarter of the literature." "0 context-switches" is a vague UX claim.

**Shipped:** swapped the stats row to factual, verifiable claims:
"12 adversarial stages · 26 biomedical sources · 100% citation
roundtrip." Every number is one a researcher could audit against the
actual product. Trust earned by precision, not superlatives.

### 4. Hero CTA contradiction

Original primary CTA: "Download" — but the download section is three
"Coming soon" cards. That's a bait-and-switch the user catches
within five seconds.

**Shipped:** primary CTA in hero is now "Request early access" which
opens the contact overlay. Secondary CTA stays "See how it works"
linking to the pipeline section. The download section keeps its
"Coming soon" cards but no longer pretends to be the page's
destination.

### 5. Reduced-motion respect

The blur-fade tagline crossfade and the parallax scroll on the hero
will trigger vestibular discomfort in roughly a third of users
(per Web Almanac 2024). Anthropic, Stripe, Apple all wrap their
GSAP/motion calls in `prefers-reduced-motion` queries.

**Shipped:** `globals.css` adds a `@media (prefers-reduced-motion:
reduce)` block that disables every transform, blur-filter, and
scroll-driven animation. Components also key off `useReducedMotion`
where the GSAP timeline can skip the choreography entirely.

### 6. SEO + Open Graph

Original `<head>` had a title + description. That's it. Modern AI
landing pages ship structured data (Organization + Product schemas),
Twitter cards, OG images, sitemap, and analytics tags.

**Shipped:** `layout.tsx` now ships full Open Graph + Twitter card
metadata, an `Organization` JSON-LD block, theme-color for both light
and dark, and the proper canonical URL. `<meta name="robots">` is
explicit. The og-image.png placeholder is documented in the
Followups section below.

### 7. Skip-to-content link + accessibility baseline

Original page had no keyboard skip link, generic alt-text on art
plates, and no aria-live for the rotating tagline.

**Shipped:** skip link before nav, descriptive aria-labels on every
icon-only button, and the rotating tagline gets `aria-live="polite"`
so screen-readers announce changes politely.

### 8. README rewrite

Original `README.md` was the default `create-next-app` boilerplate
(literally — it referenced "Geist font" and "Vercel deploy templates"
verbatim). For a polished site, that's a tell that nobody loved
this repo.

**Shipped:** project-specific README with stack, design tokens, page
structure, deploy instructions, and brand fundamentals.

### 9. `vercel.json` co-located with the source

The download-redirect spec was sitting in `docs/landing/vercel.json`
waiting to be manually copied into the (separate) landing repo.
Now that the landing source lives in the monorepo, the redirect
spec belongs alongside it.

**Shipped:** `landing/vercel.json` is the authoritative source. The
old `docs/landing/vercel.json` can be deleted in a follow-up commit
(left in place this round to avoid breaking external references).

### 10. Killed the orphan `gsap-skills-main.zip`

That 62 KB zip was a Claude Code GSAP skill plugin from the original
build session. It had no role in the deployed site.

**Shipped:** deleted.

## Deferred — next round of polish

Listed in priority order. Each item is well-scoped (≤ 1 day except
where noted).

### Visual / structural

- **Real OG image.** `og-image.png` is referenced in metadata but
  doesn't exist. Should be 1200×630, hand-composed (Vesalius detail
  + wordmark + rust accent), not a screenshot.
- **Product preview section.** Researchers will not trust an AI
  research tool without seeing the actual UI. Add a "What it looks
  like" section between Pipeline and Trust with 2–3 screenshots
  (annotated like figure plates). Defer until we have UI screenshots
  worth showing — current frontend isn't there yet.
- **Founders block real content.** Currently `PageTrust.tsx` ships
  with a placeholder for founder credentials. User to fill in:
  Jamison Seabury (URMC Neuroimaging, advisor), Satvik (founder),
  any others.
- **Logo strip.** Once first 3–5 customer institutions sign on,
  replace the methodology block in `PageTrust.tsx` with a logo strip
  ("Used by labs at Stanford, MIT, URMC…"). Highest-value trust
  signal once real.
- **A genuine dark mode.** Currently the page is light-only. The
  desktop app ships dark by default — landing should mirror so the
  download experience feels continuous. Adds a `[data-theme]`
  toggle + `prefers-color-scheme` respect.

### Copy / messaging

- **Hero one-liner refinement.** Current rotating taglines are good
  but can drift. The official elevator-pitch one-liner should be
  declarative and stable: *"humanovo reads everything, so you can
  think about what's next."* Lock it as the meta-description and the
  default rotating-tagline first frame.
- **Wedge expansion.** The wedge ships with three contrasts. As we
  hear from beta users, refine to the contrast that converts best.
  The wedge slot is designed to be edited monthly.
- **Pricing teaser.** Once tier pricing stabilises, add a 4th
  section ("Pricing") between Trust and Download. Trial / Researcher
  / Lab / Institution. Keep editorial register (no SaaS-style "MOST
  POPULAR" badges).
- **Single FAQ section.** Three questions, max — "Do you train on
  my data?" / "How accurate are citations?" / "What does it cost?"
  Italic questions, paragraph answers. No accordion theatre.

### Performance / engineering

- **Next.js `<Image>`.** Replace the raw `<img>` inside `ArtFrame`
  with `next/image` so the framework auto-generates AVIF/WebP
  variants and serves the right size for the viewport. The 1.8 MB
  Vesalius hero image is the biggest LCP risk.
- **Per-page bundle audit.** Currently every page loads GSAP +
  Framer Motion + every component. Code-split: GSAP only on
  Pipeline section, Framer only on overlays.
- **Analytics wiring.** Vercel Analytics is one line. PostHog if we
  want session replays. Either is fine; ship one.
- **Sitemap + robots.** `app/sitemap.ts` + `app/robots.ts` (Next.js
  conventions). Trivial.
- **Structured-data audit.** Validate the Organization JSON-LD I
  added against schema.org/Organization. Add Product schema once
  pricing stabilises.

### Conversion

- **Email-capture in hero.** A single-field "your@lab.org" inline in
  the hero gives users a no-friction option vs the current
  "Request access" full-form. Both should coexist; the form is for
  power users, the inline is for "just notify me at launch."
- **Calendar-booking link.** For Lab+ tier interest, a "book a
  demo" link routing to Cal.com / SavvyCal. Bottom of `PageTrust.tsx`
  is the right slot.
- **Founder DM offer.** "Or email satvik@humanovo.net directly — I
  read every reply." Tiny, italic, in the colophon. Converts
  high-intent visitors at near-100%.

## Brand-team requests (when this exists)

- Custom OG image, hand-composed
- Favicon refresh — current is a generic SVG; should be the rust-dot-
  on-charcoal mark from the nav logo
- Apple touch icon
- A 60-second product video, embedded above the wedge
- Press kit page (`/press`) with logos, screenshots, founder bios
- A `/manifesto` page with the full editorial statement
