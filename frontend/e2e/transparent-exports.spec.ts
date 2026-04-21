import { test, expect } from '@playwright/test';

/**
 * Regression spec for the publication-ready export contract:
 *
 *   The platform's "Copy / Export PNG" paths must produce images with
 *   a fully transparent background so figures drop into papers and
 *   slide decks without the app shell's chrome bleeding through.
 *
 * We don't need to render a real plot to verify the utility — we import
 * the export helper into page context, hand it a hand-rolled SVG host,
 * and inspect the resulting PNG's corner pixels. If the plumbing keeps
 * a transparent background end-to-end, the alpha channel at the image
 * edge will be 0.
 */

test('plotExport getPlotBlob produces transparent-alpha PNG', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const result = await page.evaluate(async () => {
    // Build an inline SVG in a detached host so the utility's SVG path
    // kicks in (no Plotly). A single colored rect guarantees the center
    // is opaque while the margins (outside the rect) stay transparent.
    const host = document.createElement('div');
    host.style.position = 'absolute';
    host.style.left = '-9999px';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100');
    svg.setAttribute('height', '100');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', '30');
    rect.setAttribute('y', '30');
    rect.setAttribute('width', '40');
    rect.setAttribute('height', '40');
    rect.setAttribute('fill', '#ff0000');
    svg.appendChild(rect);
    host.appendChild(svg);
    document.body.appendChild(host);
    try {
      const mod: any = await import('/src/utils/plotExport.ts');
      const blob: Blob | null = await mod.getPlotBlob(host, 'png');
      if (!blob) return { ok: false as const, reason: 'no blob' };
      const bmp = await createImageBitmap(blob);
      const cvs = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = cvs.getContext('2d');
      if (!ctx) return { ok: false as const, reason: 'no ctx' };
      ctx.drawImage(bmp, 0, 0);
      const corner = ctx.getImageData(2, 2, 1, 1).data;
      const center = ctx.getImageData(
        Math.floor(bmp.width / 2),
        Math.floor(bmp.height / 2),
        1,
        1,
      ).data;
      return {
        ok: true as const,
        cornerAlpha: corner[3],
        centerAlpha: center[3],
        centerR: center[0],
      };
    } finally {
      host.remove();
    }
  });

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  // Transparent margin: alpha at the corner should be 0 (or very close).
  expect(result.cornerAlpha).toBeLessThanOrEqual(4);
  // Opaque figure body: center alpha should be full.
  expect(result.centerAlpha).toBeGreaterThanOrEqual(250);
  // The red rect should come through.
  expect(result.centerR).toBeGreaterThanOrEqual(200);
});
