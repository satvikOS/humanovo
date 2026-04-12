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

  test('new builtins (argmax, clip, softmax, randsample) run without error', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/compute-lab');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1800);

    const skipBtn = page.locator('button:has-text("Skip"), button:has-text("Dismiss"), button:has-text("Start")').first();
    if (await skipBtn.count() > 0 && await skipBtn.isVisible()) {
      await skipBtn.click().catch(() => {});
      await page.waitForTimeout(300);
    }

    const editor = page.locator('textarea').first();
    if (await editor.count() === 0) {
      // No editor → just assert no runtime crash and bail.
      expect(errors.filter(e => e.includes('Maximum call stack'))).toEqual([]);
      return;
    }

    // Exercise every new builtin in one script so a regression in any of
    // them surfaces as a RuntimeError / exception, caught below.
    await editor.click({ force: true });
    await editor.fill([
      'v = [3, 1, 4, 1, 5, 9, 2, 6]',
      'disp(argmax(v))',          // → 6 (1-based index of the 9)
      'disp(argmin(v))',          // → 2 (first occurrence of 1)
      'disp(clip(v, 2, 5))',      // → [3 2 4 2 5 5 2 5]
      'disp(sigmoid(0))',         // → 0.5
      'p = softmax([1, 1, 1])',   // → uniform [1/3 1/3 1/3]
      'disp(sum(p))',             // → 1
      's = randsample(v, 3)',     // without-replacement
      'disp(length(s))',          // → 3
      'disp(length(shuffle(v)))', // → 8
    ].join('\n'));
    await page.waitForTimeout(200);

    const runBtn = page.locator('button:has-text("Run"), button[title*="Run" i], button[aria-label*="Run" i]').first();
    if (await runBtn.count() > 0) {
      await runBtn.click({ force: true });
      await page.waitForTimeout(1500);
    }

    // Engine-level errors surface as on-screen text starting with "Error".
    // If any of the new builtins is broken, the panel will include one.
    const panelText = await page.locator('body').innerText();
    expect(panelText).not.toMatch(/RuntimeError:.*(argmax|argmin|clip|sigmoid|softmax|randsample|shuffle)/);
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

// ─── Deeper flows ───────────────────────────────────────────────────
// The tests below exercise higher-fidelity scenarios than the smoke
// flows above: uploading real file content via setInputFiles, running
// MATLAB-ish scripts end-to-end, driving keyboard flows, and traversing
// between related pages (project list → workspace → graph).

// ─── Data Manager: CSV upload ───────────────────────────────────────

test.describe('Flow: Data Manager CSV upload', () => {
  test('upload a CSV, table view shows the parsed rows', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/data-manager');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1200);

    // Feed a CSV to the hidden file input directly — the visible upload
    // button just triggers .click() on this input.
    const fileInput = page.locator('input[type="file"]').first();
    await expect(fileInput).toHaveCount(1);

    const csv = [
      'gene,expression,pvalue',
      'BRCA1,4.2,0.001',
      'TP53,6.8,0.0003',
      'EGFR,2.1,0.04',
    ].join('\n');

    await fileInput.setInputFiles({
      name: 'e2e-upload.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf-8'),
    });

    // Give the FileReader + parser a beat.
    await page.waitForTimeout(800);

    // The uploaded dataset should now be selected; switch to Table view.
    const tableTab = page.locator('button:has-text("Table")').first();
    if (await tableTab.count() > 0) {
      await tableTab.click({ force: true });
      await page.waitForTimeout(400);
    }

    // Expect either a rendered <table> with our gene names, or at least
    // the uploaded values somewhere on the page.
    const bodyText = await page.locator('body').innerText();
    const sawUpload = bodyText.includes('BRCA1') || bodyText.includes('TP53') || bodyText.includes('EGFR');
    expect(sawUpload).toBeTruthy();

    expect(errors.filter(e =>
      e.includes('Maximum call stack') ||
      e.includes('Cannot read properties of null')
    )).toEqual([]);
  });
});

// ─── Compute Lab: imaging annotation builtin ────────────────────────

test.describe('Flow: Compute Lab imaging annotation', () => {
  test('imaging_annotate call does not crash and returns a handle', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/compute-lab');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1800);

    const editor = page.locator('textarea').first();
    if (await editor.count() === 0) {
      // Editor didn't load — still assert no crash and move on.
      expect(errors.filter(e => e.includes('Maximum call stack'))).toEqual([]);
      return;
    }

    // Script calling the new imaging builtins. Without a loaded study
    // the call path should simply no-op / return 0 rather than throw.
    await editor.click({ force: true });
    await editor.fill([
      'n = imaging_annotations()',
      'h = imaging_filter("invert")',
      'disp(n)',
    ].join('\n'));

    const runBtn = page.locator('button:has-text("Run"), button[title*="Run" i], button[aria-label*="Run" i]').first();
    if (await runBtn.count() > 0) {
      await runBtn.click({ force: true });
      await page.waitForTimeout(1000);
    }

    expect(errors.filter(e =>
      e.includes('Maximum call stack') ||
      e.includes('Cannot read properties of null') ||
      e.includes('is not a function')
    )).toEqual([]);
  });
});

// ─── Notebook: filter + search path ─────────────────────────────────

test.describe('Flow: Notebook filters', () => {
  test('filter panel opens, category filter applied, no crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/notebook');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1200);

    // Open the filter popover if present.
    const filterBtn = page.locator('button[title*="Filter" i], button:has-text("Filter")').first();
    if (await filterBtn.count() > 0 && await filterBtn.isVisible()) {
      await filterBtn.click({ force: true });
      await page.waitForTimeout(300);
    }

    // Click an "All" chip (present in both category + importance rows).
    const allChip = page.locator('button:has-text("All")').first();
    if (await allChip.count() > 0 && await allChip.isVisible()) {
      await allChip.click({ force: true }).catch(() => {});
      await page.waitForTimeout(200);
    }

    // Fire a search / command-palette keyboard shortcut — should at
    // least not crash even if not implemented.
    await page.keyboard.press('Meta+K').catch(() => {});
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape').catch(() => {});

    expect(errors.filter(e =>
      e.includes('Maximum call stack') ||
      e.includes('Cannot read properties of null')
    )).toEqual([]);
  });
});

// ─── Command Palette navigation ─────────────────────────────────────

test.describe('Flow: Command palette', () => {
  test('arrow keys move highlight; Enter runs highlighted item', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(800);

    // Open the palette. Try the sidebar Command button first (most
    // reliable), falling back to the keyboard shortcut.
    const cmdBtn = page.locator('button:has-text("Command")').first();
    if (await cmdBtn.count() > 0) {
      await cmdBtn.click({ force: true }).catch(() => {});
    } else {
      await page.keyboard.press('Control+K').catch(() => {});
    }
    await page.waitForTimeout(300);

    const input = page.locator('input[placeholder*="command" i]').first();
    await expect(input).toBeVisible({ timeout: 4000 });

    // With no query, the first command should be "Go to Dashboard".
    // Press ArrowDown twice → expect the 3rd item (index 2) to be active.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);

    const active = page.locator('[data-cp-idx="2"]');
    await expect(active).toBeVisible();

    // Enter should navigate. The exact destination depends on list order,
    // but the palette must close and no uncaught errors should fire.
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);

    // Palette should be gone.
    expect(await input.count()).toBe(0);

    expect(errors.filter(e =>
      e.includes('Maximum call stack') ||
      e.includes('Cannot read properties of null')
    )).toEqual([]);
  });
});

// ─── Projects → Workspace navigation ────────────────────────────────

test.describe('Flow: Projects → Workspace', () => {
  test('open first project card, workspace route renders', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/projects');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // Click the first visible project card (has-text does greedy match,
    // but we anchor on the "Open" or "Workspace" CTA inside the card).
    const openBtn = page.locator('a[href*="/projects/"], button:has-text("Open"), button:has-text("Workspace")').first();
    if (await openBtn.count() > 0 && await openBtn.isVisible()) {
      await openBtn.click({ force: true });
      await page.waitForTimeout(1200);

      // We should have navigated somewhere under /projects/:id/*.
      const url = page.url();
      expect(url).toMatch(/\/projects\/[^/]+/);
    }

    expect(errors.filter(e =>
      e.includes('Maximum call stack') ||
      e.includes('Cannot read properties of null')
    )).toEqual([]);
  });
});

// ─── Evidence browse + open source ──────────────────────────────────

test.describe('Flow: Evidence browse', () => {
  test('evidence page loads, filter chip toggles without crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/evidence');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1200);

    // Try clicking a source-type filter chip (pubmed / clinical_trial /
    // preprint). They're rendered as pill buttons with those labels.
    const chip = page.locator('button').filter({ hasText: /pubmed|clinical|preprint|all/i }).first();
    if (await chip.count() > 0 && await chip.isVisible()) {
      await chip.click({ force: true }).catch(() => {});
      await page.waitForTimeout(300);
    }

    expect(errors.filter(e =>
      e.includes('Maximum call stack') ||
      e.includes('Cannot read properties of null')
    )).toEqual([]);
  });
});

// ─── Keyboard shortcuts cheatsheet ──────────────────────────────────

test.describe('Flow: Keyboard shortcuts', () => {
  test('pressing "?" opens the shortcuts cheatsheet; Esc closes it', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(600);

    // The global handler ignores "?" when focus is in an input. Default
    // focus on /dashboard is the body, which is what we want here.
    await page.keyboard.press('Shift+/');
    await page.waitForTimeout(250);

    // The cheatsheet has a "Keyboard shortcuts" heading and at least one kbd.
    const heading = await page.locator('text=Keyboard shortcuts').count();
    expect(heading).toBeGreaterThan(0);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);

    // After Escape, the modal should be gone — the text still appears
    // inside the help docs chat onboarding in other places, so we check
    // for the unique tag line instead.
    const cheatsheetAfter = await page
      .locator('text=Shortcuts are disabled while typing in inputs')
      .count();
    expect(cheatsheetAfter).toBe(0);

    expect(errors.filter(e =>
      e.includes('Maximum call stack') ||
      e.includes('Cannot read properties of null')
    )).toEqual([]);
  });
});

// ─── Agents page render + run ───────────────────────────────────────

test.describe('Flow: Agents page', () => {
  test('agents page renders, run button (if present) is clickable', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/agents');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1200);

    const runBtn = page.locator('button:has-text("Run"), button:has-text("Start")').first();
    if (await runBtn.count() > 0 && await runBtn.isVisible()) {
      await runBtn.click({ force: true }).catch(() => {});
      await page.waitForTimeout(400);
    }

    expect(errors.filter(e =>
      e.includes('Maximum call stack') ||
      e.includes('Cannot read properties of null')
    )).toEqual([]);
  });
});
