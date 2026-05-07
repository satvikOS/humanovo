#!/usr/bin/env bash
#
# Fetch hi-res, public-domain Renaissance anatomical plates for the
# landing site. Run this on your local machine; the cultural-heritage
# hosts (Wikimedia, NLM, Wellcome, Library of Congress, Gallica,
# Royal Collection Trust, Internet Archive) block outbound traffic
# from the build sandbox.
#
# Usage:
#   cd landing
#   ./scripts/fetch-hi-res-art.sh           # download all
#   ./scripts/fetch-hi-res-art.sh vitruvian # download just one
#
# After running, commit the resulting JPGs to landing/public/art/ and
# update the corresponding `art:` paths in:
#   - src/components/Page1Hero.tsx
#   - src/components/Page2Pipeline.tsx
#
# All sources are unambiguously public-domain (pre-1928 publication
# or institutionally released). See public/art/SOURCES.md for the
# full attribution table that lands in the page colophon.

set -euo pipefail

cd "$(dirname "$0")/.."

ART_DIR="public/art"
mkdir -p "$ART_DIR"

# A polite User-Agent so the host knows who's fetching. Wikimedia
# documents the convention; cultural-heritage IIIF endpoints use it
# for usage analytics + abuse mitigation.
UA="humanovo-landing-fetch/0.1 (+https://www.humanovo.net) curl"

fetch() {
  local key="$1"
  local url="$2"
  local out="$ART_DIR/$3"
  echo "→ $key  ($url)"
  curl --fail --silent --show-error --location \
       --max-time 120 \
       --user-agent "$UA" \
       --output "$out.tmp" \
       "$url"
  # Verify it's actually an image, not an error page.
  if ! file "$out.tmp" | grep -qE 'image|JPEG|PNG'; then
    echo "  ⚠ result is not an image — keeping previous file (if any)"
    rm -f "$out.tmp"
    return 1
  fi
  mv "$out.tmp" "$out"
  ls -la "$out" | awk '{print "  ✓ saved:", $NF, "(" $5 " bytes)"}'
}

case "${1:-all}" in

  all|vitruvian)
    fetch "Vitruvian Man (Leonardo, c. 1490, 2258×3070)" \
      "https://upload.wikimedia.org/wikipedia/commons/d/d2/Da_Vinci_Vitruve_Luc_Viatour.jpg" \
      "leonardo-vitruvian-man.jpg" || true
    [ "${1:-all}" != "all" ] && exit 0
    ;;&

  all|frontispiece)
    fetch "Vesalius Fabrica frontispiece (1543, woodcut)" \
      "https://upload.wikimedia.org/wikipedia/commons/3/3e/Vesalius_Fabrica_fronticepiece.jpg" \
      "vesalius-fabrica-frontispiece.jpg" || true
    [ "${1:-all}" != "all" ] && exit 0
    ;;&

  all|prima-musculorum)
    # Prima Musculorum Tabula — the standing muscle figure in landscape.
    # NLM doesn't expose a stable canonical URL; the Wikimedia Commons
    # facsimile is the most-direct fetchable copy.
    fetch "Vesalius Prima Musculorum Tabula (1543)" \
      "https://upload.wikimedia.org/wikipedia/commons/8/8d/Vesalius_Fabrica_p190.jpg" \
      "vesalius-prima-musculorum.jpg" || true
    [ "${1:-all}" != "all" ] && exit 0
    ;;&

  all|leonardo-heart)
    # Royal Collection Trust hosts the canonical Leonardo anatomical
    # studies but doesn't expose a clean direct-download. Wikimedia
    # mirrors several plates from the Windsor collection.
    fetch "Leonardo — heart, lungs, vessels (c. 1508–1513)" \
      "https://upload.wikimedia.org/wikipedia/commons/0/04/Leonardo_da_Vinci_-_Studies_of_the_arm_showing_the_movements_made_by_the_biceps.jpg" \
      "leonardo-heart.jpg" || true
    [ "${1:-all}" != "all" ] && exit 0
    ;;&

  all|bourgery)
    fetch "Bourgery & Jacob écorché (1831–1854)" \
      "https://upload.wikimedia.org/wikipedia/commons/9/91/Bourgery_-_Trait%C3%A9_complet_de_l%27anatomie_de_l%27homme%2C_t._5%2C_pl._12.jpg" \
      "bourgery-ecorche.jpg" || true
    [ "${1:-all}" != "all" ] && exit 0
    ;;&

  all|valverde)
    fetch "Valverde Historia plate (1556)" \
      "https://upload.wikimedia.org/wikipedia/commons/4/4a/Valverde_-_Historia_de_la_composicion_del_cuerpo_humano_-_plate.jpg" \
      "valverde-historia.jpg" || true
    [ "${1:-all}" != "all" ] && exit 0
    ;;&

  all|atlas-additions)
    # Plates pinned for the future /atlas gallery. Pulled together
    # so the gallery is one commit away from being shippable.
    fetch "Hortus Sanitatis (1491, mandrake woodcut)" \
      "https://upload.wikimedia.org/wikipedia/commons/8/8d/Hortus_Sanitatis_-_Mandrake.jpg" \
      "hortus-sanitatis.jpg" || true
    fetch "Vesalius skeleton plate (1543)" \
      "https://upload.wikimedia.org/wikipedia/commons/8/8b/Vesalius_Fabrica_p163.jpg" \
      "vesalius-skeleton.jpg" || true
    fetch "William Hunter — gravid uterus (1774)" \
      "https://upload.wikimedia.org/wikipedia/commons/1/14/William_Hunter_gravid_uterus_1774.jpg" \
      "hunter-gravid-uterus.jpg" || true
    fetch "Albinus & Wandelaar — Tabulae (1747)" \
      "https://upload.wikimedia.org/wikipedia/commons/d/d3/Tabulae_sceleti_et_musculorum_corporis_humani_-_Wandelaar_skeleton.jpg" \
      "albinus-tabulae.jpg" || true
    fetch "Bidloo — Anatomia humani corporis (1685)" \
      "https://upload.wikimedia.org/wikipedia/commons/8/8d/Bidloo_Anatomia_Humani_Corporis_1685.jpg" \
      "bidloo-anatomia.jpg" || true
    ;;

  *)
    echo "unknown target: $1"
    echo "Valid targets: all | vitruvian | frontispiece | prima-musculorum |"
    echo "               leonardo-heart | bourgery | valverde | atlas-additions"
    exit 2
    ;;
esac

echo ""
echo "Done. Verify each downloaded file is the expected plate, then:"
echo "  1. Update src/components/Page1Hero.tsx  (hero plate path)"
echo "  2. Update src/components/Page2Pipeline.tsx  (stage art paths)"
echo "  3. (optional) Delete the legacy low-res files now-superseded"
echo "  4. git add public/art/*.jpg && git commit"
echo ""
echo "If any URL above 404s — Wikimedia file paths shift over time —"
echo "search the canonical institution (NLM, Wellcome, Gallica, RCT,"
echo "LoC, Internet Archive) for the same plate and update this script."
