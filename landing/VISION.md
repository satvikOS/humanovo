# The Vision

> "The future here lies in the past, and in how well we understand it."

Everything below extends that thesis. Fortune-100 lead-designer-brain
output, intentionally non-generic. Some of these moves are work
of weeks; some are work of an afternoon. All of them sharpen the
proposition that humanovo is not "AI for biology" — it is *the next
chapter of the impulse Vesalius started in 1543*.

This is the operating creative brief. Anything that contradicts it
should be questioned before it ships.

---

## The thesis, sharpened

When Vesalius dissected cadavers in Padua and drew what he saw — not
what Galen had said for thirteen centuries — he did three things:

1. He **read everything** the canon said about the body.
2. He **looked himself**, with his own hands, on a real cadaver.
3. He **rendered the discrepancies** as a public, beautiful artifact
   anyone could verify.

That's the entire scientific method, compressed. *De humani corporis
fabrica* (1543) was the first peer-reviewable atlas. Leonardo's
notebooks, Valverde's *Historia*, Bourgery & Jacob's écorchés — they
all sit in the same lineage: read, observe, render, defend.

humanovo is doing exactly the same thing, 483 years later, on a
different scale of corpus. We **read every paper** that has ever been
published. We **observe the patterns** the eye would miss across that
scale. We **render the hypothesis** as a public, citable artifact
that any working researcher can verify — claim by claim, citation by
citation.

The brand isn't "AI for biology." It's **the next entry in a 500-
year-old conversation about how we know living things**.

This is why the Renaissance plates aren't decoration. They're
**ancestors**. Every page of the site is a quiet act of lineage
declaration: *we know who we descend from, and we are extending
the line, not breaking it*.

Hold this. Every design decision below is in service of it.

---

## Five big bets (each a week of work, each defining)

### 1. The page is a folio, not a website

The site should feel like opening *Fabrica* itself. Not literal page-
turn skeumorphism — that would be twee. But the same *register* of
unhurried materiality. Sections should "settle" as you scroll, the
way ink dries on vellum. Plates should reveal in two passes (faint
silvergrey, then warm sepia, like the moment a print comes up in the
developer). The cursor should be a quill nib on interactive text and
a Renaissance pointing-hand on links. The colophon at the foot of the
page should be set in real type, not "© 2026 Humanovo Inc." in size 11.

Outcome: the user feels they have entered a *book*, and the brand has
declared *we are publishers, not vendors*.

### 2. Each plate teaches the pipeline

Right now the four pipeline stages each carry a Renaissance plate as
a parallel illustration. Stronger move: **each plate is annotated to
show how anatomical illustration was already a multi-stage pipeline**.
The Vesalius frontispiece (Stage I — Ingest) carried scholars,
specimens, manuscripts, instruments — all the inputs of synthesis,
held in one composition. Leonardo's heart (Stage II — Analyse) is
literally cross-correlation: he drew the same muscle from four angles
on one page so the inconsistencies revealed themselves. Vesalius's
*Prima Musculorum Tabula* (Stage III — Generate) is the moment
illustration *becomes* hypothesis: a body posed in landscape, asking
the viewer to look at the muscles in their world. The écorché
(Stage IV — Manage) is the institutional library — figures with
ancillary studies, organized for later researchers.

We don't add this as a wall of text. We add **margin glosses** in
italic Fraunces beside each plate — the way a manuscript scholar
would annotate. Three lines, max. Quiet but transformative.

Outcome: the visitor doesn't feel "branded at." They feel **taught**.
That is the most powerful gesture a research-tool can make.

### 3. The Atlas — an interactive plate of a real hypothesis

The page builds, builds, builds toward "humanovo generates grounded
hypotheses." Then the visitor must take that on faith. Worse: they
must imagine what a generated hypothesis *looks like*.

Big bet: **embed one real hypothesis in the page, rendered as a
Vesalius plate**. A central anatomical illustration of the proposed
mechanism (commissioned, period-style, in sepia ink). Around it,
marginalia — every claim hyperlinked to its citation, every entity
to its KG node. Hover a claim, the source paper opens in a side panel
with the cited paragraph highlighted. Click a target gene, it traces
through every linked claim in red ink, like a Renaissance scholar
following a single argument across folios.

This single feature is the entire wedge. No competitor has anything
close. It also doubles as **proof** (the hypothesis is real,
verifiable, scrollable) and as **demo** (you experience the product
without signing up). Stripe has nothing this good. Anthropic has
nothing this good.

Effort: ~2 weeks of coupled design + engineering for one hypothesis.
Then the same template carries every subsequent featured one.

### 4. humanovo as a journal

The hero already says "Vol. I · No. 01 · for scientists." Make it
real. The site is published as a journal:

- A new **issue** every month: same shell, fresh featured hypothesis,
  fresh essay, fresh plate-of-the-month, fresh advisor quote.
- A `/archive` page lists every prior issue. (The first three
  months we ship empty issues marked "in preparation" so the archive
  reveals editorial intention immediately.)
- A small **masthead** at the bottom of the front page: "Editor: …
  · Production: … · Plate Editor: … · Web: …" — even if every line
  is the founder's name. The Adobe-sized brand cost of doing this
  is ~zero. The brand-credibility lift is enormous.

Outcome: researchers come back. They share. The site is no longer a
landing page — it is a publication that happens to also accept
signups.

### 5. The wordmark breathes

Fraunces ships a WONK axis (0 → 1, manuscript-flourish ↔ formal) and
a SOFT axis (0 → 100, hard-edge ↔ deckle-edge). Use them. As the
user scrolls — slowly, almost imperceptibly — the nav wordmark drifts
between WONK 0/SOFT 50 (calm, sober) and WONK 1/SOFT 100 (alive,
flourished). It is so subtle most users will not notice. The ones
who do will know they are on a site that takes itself seriously.

This is a 30-line CSS variable interpolation tied to scroll position
through a `requestAnimationFrame` loop. Two hours of work. It is the
kind of detail Anthropic and Stripe both quietly do, that competitors
do not.

---

## The editorial surfaces (small pages, real prose)

### `/manifesto`

A 500–800-word essay in the voice of the founder. Not "our mission is
to accelerate biomedical research." A real declaration:

> What I wanted, when I was a graduate student, was a co-investigator
> who had read everything. Not a search engine. Not a notes app. Not
> an LLM that hallucinates. A peer who had done the reading I could
> never do, who would say "the paper you're looking for is from 1991,
> in *Brain*, by a postdoc named Lehmann, and the figure you need is
> the one Lehmann himself thought was a mistake." That's humanovo.

Set in Fraunces, body at 19px, max-width 64ch, dark ink on warm
parchment. Linked from the colophon. Researchers will read it.
Researchers will *forward* it.

### `/provenance`

A technical brief. The exact algorithm: claim extraction → DOI
candidate generation → CrossRef fetch → NCBI cross-reference →
metadata roundtrip → display. With code samples. With the actual
test suite that runs on every release. Public. Auditable.

This is the "trust by precision" play. A reader who skims it will
not understand it. But they will *trust* that we ship something
they could verify if they bothered. That perception is gold.

### `/atlas`

A gallery of every plate used on the site. Each with full
attribution: artist, year, plate name, source manuscript, public-
domain license, and a sentence on why we chose it. Sortable by
artist, year, technique. Sharable. This becomes a SHAREABLE asset
that drives traffic; researchers studying the history of medicine
will link to it from Wikipedia, art historians will cite it.

### `/colophon`

A real one. Set in JetBrains Mono. Lists:

- **Set in**: Fraunces (Phaedra Charles, David Jonathan Ross,
  2017–) at the opsz, SOFT, and WONK axes, with JetBrains Mono
  (JetBrains, 2020) for technical labels.
- **Plates**: each with full attribution.
- **Composed at**: humanovo.net, beginning May 2026.
- **First impression**: 14 May 2026. (Publication date, not "version
  number.")
- **Editorial decisions**: a one-paragraph summary of the design
  philosophy. The same VISION.md you're reading.

This is referenced from the foot of every page. Tiny. Italics. The
visual brand cost is two lines of text. The signal is *we are not
playing*.

---

## The tiny touches (each is 2–6 hours of work)

These are what make the site **alive without being decorative**. They
are what separates Anthropic-level execution from average-startup
execution. Each is small. None is generic.

### Custom cursors, scoped

- Default: system cursor untouched (accessibility).
- Hovering interactive text in body content: a feather-quill nib
  cursor, in rust ink, drawn in 24×24 SVG.
- Hovering plates: a Renaissance pointing-hand cursor, the way
  printers used to mark important passages with a "manicule."
- Hovering CTAs: an inkwell cursor.

Three SVGs, scoped via `cursor: url(...)` on specific surfaces. The
visitor will not consciously register it. They will feel it.

### Plate "ink-drying" reveal

Each plate enters the viewport as a faint silvergrey image, then a
0.8s CSS filter transition resolves it to the warm-sepia final. Same
animation as a print coming up in the developer tray. Materiality.

### The proof-stat row counts UP on first reveal

`12` → `12 stages`. `26` → `26 sources`. `100%` → `100% roundtrip`.
The numbers *count up* over 1.2 seconds. Tiny. Honors `prefers-
reduced-motion`. Communicates "these are real numbers we're actually
counting" — not "marketing copy that happens to use numbers."

### Marginalia on hover

When a section heading is hovered, a faint Roman numeral appears in
the left margin (Pl. I, Pl. II, etc.). Like a Renaissance compositor
marking the printer's plates. Disappears on un-hover. Tiny detail,
huge editorial mood.

### Variable-weight body type

Body copy is set in Fraunces with `font-variation-settings` keyed
to read-distance: tighter at narrow widths, looser at wide. The
`opsz` axis is used as it should be. Almost no site does this.

### Acknowledged dissection

A line at the bottom of the colophon: "We acknowledge that the
foundational anatomical illustrations on this page were possible
because of the dissection of unclaimed bodies, often without consent
or payment to families. We hold this in mind." Eight lines. Quiet.
Important. Distinguishes us from every brand that uses these plates
as decoration.

---

## What I would NOT do

- **No motion graphics that aren't physical metaphors**. No bouncing,
  no springs, no "delightful micro-interactions." The mood is
  candlelit, not Pixar.
- **No gradient meshes**. We are paper and ink. Even our "aurora"
  backdrop should read as parchment-light, not Stripe-mesh.
- **No customer logos until they earn the slot**. A thin row of
  unbranded "Researchers from these institutions are using humanovo"
  is fine. Real logos go up only when there are 5+ logos to put up.
  Anything less reads as desperate.
- **No "AI" branding**. The word "AI" appears nowhere on the site.
  Not because we're hiding it; because the brand declares the work,
  not the technology. Vesalius did not call his book "Powered by
  Empirical Observation." We don't call our site "Powered by AI."
- **No dark-pattern signups**. No exit-intent modals. No "limited
  spots remaining." No countdown timers. The brand is: we are
  serious people doing serious work; we will earn your attention
  by being worth it.

---

## What I'd ship next, in order

If I had two weeks of focused design + engineering, ranked by
signal-per-hour:

1. **Colophon component, persistent on every page** (Big Bet 1
   foundation). 3 hours. Massive editorial gravity.
2. **`/manifesto` page** with a real essay. 4 hours of writing +
   2 hours of typesetting. The essay is the most-shareable artifact.
3. **Wordmark breathing** (Big Bet 5). 2 hours. Subtle, signature.
4. **Plate "ink-drying" reveal**. 1 hour. Materiality.
5. **Marginalia annotations on each pipeline plate** (Big Bet 2).
   1 day. Transforms the pipeline section into a teaching artifact.
6. **`/provenance` page** with the real algorithm. 1 day. The
   skeptic-converter.
7. **Custom cursors, scoped**. 4 hours. Tiny but signature.
8. **`/atlas` gallery page**. 1 day. Shareable, links-from-Wikipedia
   asset.
9. **Acknowledged-dissection line in the colophon**. 30 minutes.
   The most important line on the site.
10. **The Atlas** (Big Bet 3 — interactive featured hypothesis as
    a Vesalius plate). 2 weeks of coupled design + engineering.
    The wedge becomes irrefutable.

---

## What this protects against

A landing page only fails one of three ways:

1. **The visitor leaves immediately** (it didn't communicate fast).
2. **The visitor reads but doesn't sign up** (it didn't earn trust).
3. **The visitor signs up but doesn't tell anyone** (it didn't
   create the kind of brand-level affection people share).

The current page handles (1) well — the editorial-luxury aesthetic
is a strong instant-impression. The Trust + Wedge sections shipped
in the last commit handle (2). What this VISION addresses is (3) —
**making the site itself an artifact people share, link to, and
return to**. Not because we asked them, but because the site
*deserves* it.

That is the only marketing move that compounds.

— composed in May 2026, in service of humanovo Vol. I.
