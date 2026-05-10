/**
 * Custom plotly.js bundle — registers only the trace types this app
 * actually uses, instead of pulling the full plotly.js-dist-min.
 *
 * Traces in use (verified by grep across PlotlyPlot3D.tsx,
 * pages/compute/Workstation.tsx, utils/plotExport.ts):
 *   3D : scatter3d, surface, mesh3d, cone, isosurface
 *   2D : scatter, heatmap, pie, sankey
 *
 * The full plotly.js-dist-min bundle is ~3.5 MB minified because it
 * carries every trace type plotly ships (~30 of them — bar, scatterpolar,
 * scattergl, scatterternary, parcoords, choropleth, etc.). We use 9.
 * Vite's tree-shaker can't strip unused traces from the dist-min
 * bundle because they're registered at module import time inside it.
 *
 * The modular `plotly.js` core lets us register only what we need.
 * Bundle size drops materially for the desktop installer (the
 * plotExport chunk is currently the single biggest asset at ~5.3 MB
 * gzip:1.6 MB; this trim is the highest-leverage shrink available
 * without giving up 3D capability).
 *
 * Re-exported as the default import so existing call sites only need
 * to swap their import path: `from 'plotly.js-dist-min'` →
 * `from '../lib/plotlyMin'`. The Plotly object exposes the same API
 * surface (newPlot, react, toImage, etc.) since the core IS the
 * runtime — the dist bundle is just core + all-traces.
 */

import Plotly from 'plotly.js/lib/core'

// 3D traces — power surface_3d / wireframe_3d / contour_3d /
// scatter_3d / bubble_3d / line_3d / bar_3d (uses mesh3d) /
// trisurf_3d / quiver_3d (cone) / isosurface_3d / voxel_3d /
// streamline_3d / slice_3d / stem_3d / waterfall_3d / ribbon_3d.
import scatter3d from 'plotly.js/lib/scatter3d'
import surface from 'plotly.js/lib/surface'
import mesh3d from 'plotly.js/lib/mesh3d'
import cone from 'plotly.js/lib/cone'
import isosurface from 'plotly.js/lib/isosurface'

// 2D traces — power Workstation's heatmap mode + the plotly-backed
// pie_3d (which is actually a 2D pie with 3D-styled chrome) + the
// sankey chart type.
import heatmap from 'plotly.js/lib/heatmap'
import pie from 'plotly.js/lib/pie'
import sankey from 'plotly.js/lib/sankey'

// scatter is plotly's default 2D trace; needed for axis rendering on
// 3D scenes too (the 3D charts render their axis lines via the
// scatter trace's tooling).
import scatter from 'plotly.js/lib/scatter'

// Register everything onto the core. plotly.js's `register` is
// idempotent — calling it multiple times with the same trace is
// safe — but we bundle into one file so registration runs exactly
// once at first import.
Plotly.register([scatter, scatter3d, surface, mesh3d, cone, isosurface, heatmap, pie, sankey])

export default Plotly
