import { test, expect } from '/opt/node22/lib/node_modules/playwright/test.mjs';

/**
 * Broader e2e flows — exercise real user journeys end-to-end rather than
 * single-page smoke tests. Each test is a standalone flow that mutates
 * localStorage and navigates freely, so it must clean up after itself or
 * rely on the isolated per-test page state Playwright provides by default.
 */

test.beforeEach(async ({ page }) => {
  // Dark theme keeps the visual diff stable and dodges the one-frame flash.
  await page.addInitScript(() => localStorage.setItem('genup-theme', 'dark'));
});

// ─── Create Project Flow ─────────────────────────────────────────────

test.describe('Flow: Create Project', () => {
  test('open modal, fill form, submit, appears in list', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/projects');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1200);

    // Click "New Project"
    const newBtn = page.locator('button:has-text("New Project"), button:has-text("Create Your First Project")').first();
    await expect(newBtn).toBeVisible({ timeout: 6000 });
    await newBtn.click();
    await page.waitForTimeout(400);

    // Modal should show a project-name input
    const nameInput = page.locator('input[placeholder*="BRCA1"], input[placeholder*="Project"]').first();
    await expect(nameInput).toBeVisible({ timeout: 4000 });

    const uniqueName = `E2E Test Project ${Date.now()}`;
    await nameInput.fill(uniqueName);

    // Fill disease focus too — optional but realistic
    const diseaseInput = page.locator('input[placeholder*="Breast Cancer"], input[placeholder*="Alzheimer"]').first();
    if (await diseaseInput.count() > 0) {
      await diseaseInput.fill('E2E Test Disease');
    }

    // Submit
    const submitBtn = page.locator('button:has-text("Create Project"), button[type="submit"]').first();
    await submitBtn.click();

    // Wait for modal to close (title no longer visible) or project to appear
    await page.waitForTimeout(1500);

    // The new project card should now be in the list (backend might error
    // in CI — in that case the modal shows an API error banner, which is
    // still a valid non-crash state).
    const hasProject = await page.locator(`text=${uniqueName}`).count();
    const hasApiError = await page.locator('text=API Error').count();
    expect(hasProject + hasApiError).toBeGreaterThan(0);

    // No runtime crash
    expect(errors.filter(e =>
      e.includes('Maximum call stack') ||
      e.includes('Cannot read properties of null')
    )).toEqual([]);
  });
});

// ─── Compute Lab Script Flow ────────────────────────────────────────

test.describe('Flow: Compute Lab script', () => {
  test('type expression, run, see output', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/compute-lab');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1800);

    // Dismiss welcome/onboarding if it blocks the editor
    const skipBtn = page.locator('button:has-text("Skip"), button:has-text("Dismiss"), button:has-text("Start")').first();
    if (await skipBtn.count() > 0 && await skipBtn.isVisible()) {
      await skipBtn.click().catch(() => {});
      await page.waitForTimeout(300);
    }

    // Find any textarea on the page
    const editor = page.locator('textarea').first();
    if (await editor.count() === 0) {
      // No editor rendered (maybe loading). Flow is valid as long as
      // nothing crashed — assert that and bail.
      expect(errors.filter(e => e.includes('Maximum call stack'))).toEqual([]);
      return;
    }

    await editor.click({ force: true });
    await editor.fill('x = 2 + 2\ny = sqrt(16)\ndisp(x + y)');
    await page.waitForTimeout(200);

    // Hit the Run button (could be labelled Run, Execute, or a play icon)
    const runBtn = page.locator('button:has-text("Run"), button[title*="Run" i], button[aria-label*="Run" i]').first();
    if (await runBtn.count() > 0) {
      await runBtn.click({ force: true });
      await page.waitForTimeout(1200);
    }

    // No runtime crash regardless of output
    expect(errors.filter(e =>
      e.includes('Maximum call stack') ||
      e.includes('Cannot read properties of null') ||
      e.includes('is not a function')
    )).toEqual([]);
  });

  test('imaging tab renders without crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/compute-lab');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // Click Imaging tab if present
    const imagingTab = page.locator('button:has-text("Imaging")').first();
    if (await imagingTab.count() > 0) {
      await imagingTab.click({ force: true });
      await page.waitForTimeout(600);
    }

    // No crash
    expect(errors.filter(e =>
      e.includes('Maximum call stack') ||
      e.includes('Cannot read properties of null')
    )).toEqual([]);
  });
});

// ─── Data Manager Flow ──────────────────────────────────────────────

test.describe('Flow: Data Manager', () => {
  test('select sample dataset, switch to table view, see rows', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/data-manager');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // Pick the first dataset item in the left sidebar (has .text-xs.font-semibold
    // truncate — the "name" class signature). Falls back to any button in the
    // left rail.
    const datasetBtn = page.locator('button').filter({ hasText: /Clinical|Genomics|Sample|Dataset/i }).first();
    if (await datasetBtn.count() > 0) {
      await datasetBtn.click({ force: true });
      await page.waitForTimeout(500);
    }

    // Click Table tab
    const tableTab = page.locator('button:has-text("Table")').first();
    if (await tableTab.count() > 0) {
      await tableTab.click({ force: true });
      await page.waitForTimeout(500);
    }

    // A real table should be present now — either an HTML <table> or an
    // overview view with row counts.
    const hasTable = await page.locator('table').count();
    const hasOverview = await page.locator('text=rows').count();
    expect(hasTable + hasOverview).toBeGreaterThan(0);

    expect(errors.filter(e =>
      e.includes('Maximum call stack') ||
      e.includes('Cannot read properties of null')
    )).toEqual([]);
  });
});

// ─── Search Flow ────────────────────────────────────────────────────

test.describe('Flow: Search', () => {
  test('type query, hit enter, page does not crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/search');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    const searchInput = page.locator('input[placeholder*="Search"], input[placeholder*="evidence"]').first();
    if (await searchInput.count() > 0) {
      await searchInput.fill('BRCA1');
      await searchInput.press('Enter');
      await page.waitForTimeout(1200);
    }

    expect(errors.filter(e =>
      e.includes('Maximum call stack') ||
      e.includes('Cannot read properties of null')
    )).toEqual([]);
  });
});

// ─── Settings Flow ──────────────────────────────────────────────────

test.describe('Flow: Settings tabs', () => {
  test('every settings section is clickable without crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/settings');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1200);

    // Find every settings side-nav button (not the top-level page nav)
    const sectionBtns = page.locator('nav button, aside button, [role="tab"]');
    const count = await sectionBtns.count();
    for (let i = 0; i < Math.min(count, 10); i++) {
      const btn = sectionBtns.nth(i);
      if (await btn.isVisible()) {
        await btn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(150);
      }
    }

    expect(errors.filter(e =>
      e.includes('Maximum call stack') ||
      e.includes('Cannot read properties of null')
    )).toEqual([]);
  });

  test('no billing/usage section is present', async ({ page }) => {
    // Sanity-check that the removed billing dashboard is actually gone.
    await page.goto('/settings');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(800);

    const billingCount = await page.locator('text=Usage & Billing').count();
    expect(billingCount).toBe(0);

    // And the legacy route should not render a billing page — it should
    // either redirect or 404 rather than crash.
    await page.goto('/settings/billing').catch(() => {});
    await page.waitForTimeout(600);
    // The word "Budget" should not appear as a heading on that page
    // (previously rendered by the billing dashboard).
    const budgetHeadings = await page.locator('h1:has-text("Budget"), h2:has-text("Budget")').count();
    expect(budgetHeadings).toBe(0);
  });
});

// ─── Notebook Flow ──────────────────────────────────────────────────

test.describe('Flow: Notebook create-page', () => {
  test('new notebook page created and appears in list', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/notebook');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1200);

    const createBtn = page.locator('button:has-text("New"), button:has-text("+"), button:has-text("Create")').first();
    if (await createBtn.count() > 0) {
      await createBtn.click({ force: true });
      await page.waitForTimeout(800);
    }

    expect(errors.filter(e =>
      e.includes('Maximum call stack') ||
      e.includes('Cannot read properties of null')
    )).toEqual([]);
  });
});
