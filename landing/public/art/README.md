# /public/art — Renaissance artwork for the landing page

The landing page references real Renaissance medical and anatomical artwork.
The sandbox that built this cannot fetch external images, so **drop the
original files here with the exact filenames below** and they render
automatically with a warm sepia overlay that blends them into the cream /
ink / rust palette.

All of the following are public-domain works; suggested sources are given,
but any high-resolution scan of each work will do.

## Required files

| Filename          | Subject                                                  | Typical source                                                    |
| ----------------- | -------------------------------------------------------- | ----------------------------------------------------------------- |
| `vitruvian.jpg`   | Leonardo da Vinci — *Vitruvian Man* (c. 1490)            | Wikimedia Commons / Gallerie dell'Accademia, Venice               |
| `ingest.jpg`      | A gathering of knowledge — e.g. Vesalius title plate from *De humani corporis fabrica*, or a Leonardo studies sheet with multiple sketches | Wikimedia Commons       |
| `analyze.jpg`     | Leonardo's anatomical heart studies — ventricles / vessels | Royal Collection Trust / Wikimedia Commons                       |
| `generate.jpg`    | Vesalius — skull / cranium plate, or a Galen cranial diagram | Wikimedia Commons                                                |
| `manage.jpg`      | Vesalius — écorché or skeletal figure in pose            | Wikimedia Commons                                                 |

File format: JPEG or PNG. 1200–2000px on the long edge is plenty —
`next/image` will downsize. If you have higher-res TIFF scans, export to
JPEG quality ≈ 88.

## Aspect hints

- `vitruvian.jpg` is rendered at ~520×620 aspect (tall portrait). The
  Vitruvian original is roughly that ratio.
- `ingest/analyze/generate/manage.jpg` are rendered at ~360×220 aspect
  (wide landscape) inside each pipeline plate. If your chosen scan is
  portrait, you can either crop to landscape or I'll adjust the plate
  aspect ratio — tell me which.

## How the colors work

Images are shown behind a multiply-blended warm wash so they sit on the
page as if printed on the same parchment as the surrounding layout.
The CSS filter is `sepia(.35) hue-rotate(-8deg) saturate(1.08)` plus
`mix-blend-mode: multiply`. If a specific image looks wrong under the
filter, let me know which one and I'll tune per-image.

## When files are missing

Until a file is committed, its slot shows a cream placeholder with a
"pending — drop artwork here" caption. The page still lints, builds, and
ships — images are progressive.
