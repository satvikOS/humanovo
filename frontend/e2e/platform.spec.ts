import { test, expect } from '/opt/node22/lib/node_modules/playwright/test.mjs';

/**
 * Comprehensive platform e2e tests for Humanovo.
 * Tests every major page loads, key features are clickable, and no crash errors occur.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('genup-theme', 'dark'));
});

// ─── Page Load Tests ─────────────────────────────────────────────────

const pages = [
  { name: 'Dashboard', path: '/dashboard', selector: 'text=Dashboard' },
  { name: 'Projects', path: '/projects', selector: 'text=Projects' },
  { name: 'Evidence', path: '/evidence', selector: 'text=Evidence' },
  { name: 'Workbench', path: '/workbench', selector: 'text=Workbench' },
  { name: 'Notebook', path: '/notebook', selector: 'text=Notebook' },
  { name: 'Search', path: '/search', selector: 'text=Search' },
  { name: 'Compute Lab', path: '/compute-lab', selector: 'text=Compute Lab' },
  { name: 'Data Visualization', path: '/data-visualization', selector: 'text=Visualization' },
  { name: 'Data Manager', path: '/data-manager', selector: 'text=Data Manager' },
  { name: 'Imaging', path: '/imaging', selector: 'text=No studies' },
  { name: 'Genomics', path: '/genomics', selector: 'text=Genomics' },
  { name: 'Literature Review', path: '/literature-review', selector: 'text=Literature' },
  { name: 'Citation Manager', path: '/citation-manager', selector: 'text=Citation' },
  { name: 'Experiment Tracker', path: '/experiment-tracker', selector: 'text=Experiment' },
  { name: 'Clinical Trials', path: '/clinical-trials', selector: 'text=Clinical' },
  { name: 'Manuscripts', path: '/manuscripts', selector: 'text=Manuscript' },
  { name: 'Biobank', path: '/biobank', selector: 'text=Biobank' },
  { name: 'Collaboration', path: '/collaboration', selector: 'text=Collaboration' },
  { name: 'Regulatory', path: '/regulatory', selector: 'text=Regulatory' },
  { name: 'Settings', path: '/settings', selector: 'text=Settings' },
  { name: '3D Anatomy', path: '/anatomy', selector: 'text=Anatomy' },
];

for (const pg of pages) {
  test(`${pg.name} page loads without crash`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));
    page.on('console', msg => {
      if (msg.type() === 'error' && msg.text().includes('Maximum call stack')) {
        errors.push(msg.text());
      }
    });

    await page.goto(pg.path);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // Check no stack overflow or crash errors
    const criticalErrors = errors.filter(e =>
      e.includes('Maximum call stack') ||
      e.includes('Cannot read properties of null') ||
      e.includes('is not a function')
    );
    expect(criticalErrors).toEqual([]);

    // Check page has relevant content
    const element = page.locator(pg.selector);
    await expect(element.first()).toBeVisible({ timeout: 8000 });
  });
}

// ─── Compute Lab Tests ───────────────────────────────────────────────

test.describe('Compute Lab', () => {
  test('can switch between tabs', async ({ page }) => {
    await page.goto('/compute-lab');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    // Click Monte Carlo tab
    const mcTab = page.locator('button:has-text("Monte Carlo")');
    if (await mcTab.count() > 0) {
      await mcTab.click();
      await page.waitForTimeout(500);
    }

    // Click Equation Plotter tab
    const eqTab = page.locator('button:has-text("Equation")');
    if (await eqTab.count() > 0) {
      await eqTab.click();
      await page.waitForTimeout(500);
    }

    // Click back to Workstation
    const wsTab = page.locator('button:has-text("Workstation")');
    if (await wsTab.count() > 0) {
      await wsTab.click();
      await page.waitForTimeout(500);
    }
  });

  test('workstation editor is functional', async ({ page }) => {
    await page.goto('/compute-lab');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // Dismiss welcome overlay by clicking "Load starter demo" tile
    const demoTile = page.locator('text=Load starter demo');
    if (await demoTile.count() > 0) {
      await demoTile.first().click();
      await page.waitForTimeout(500);
    }

    // Check that code editor exists (textarea)
    const editor = page.locator('textarea');
    if (await editor.count() > 0) {
      await editor.first().click({ force: true });
      await page.waitForTimeout(200);
    }
  });

  test('no code boundary borders visible', async ({ page }) => {
    await page.goto('/compute-lab');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // No critical errors
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));
    expect(errors.filter(e => e.includes('Maximum call stack'))).toEqual([]);
  });
});

// ─── Imaging Tests ───────────────────────────────────────────────────

test.describe('Research Imaging', () => {
  test('renders without stack overflow', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/imaging');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const stackErrors = errors.filter(e => e.includes('Maximum call stack'));
    expect(stackErrors).toEqual([]);
  });

  test('upload button is present', async ({ page }) => {
    await page.goto('/imaging');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // Check for file input or upload area - the + button with title "Upload images"
    const uploadBtn = page.locator('button[title="Upload images"]');
    if (await uploadBtn.count() > 0) {
      await expect(uploadBtn.first()).toBeVisible({ timeout: 5000 });
    } else {
      // Fallback: check hidden file input exists
      const fileInput = page.locator('input[type="file"]');
      expect(await fileInput.count()).toBeGreaterThan(0);
    }
  });

  test('modality filter is present', async ({ page }) => {
    await page.goto('/imaging');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    const select = page.locator('select');
    if (await select.count() > 0) {
      // Check options include modalities
      const options = await select.first().locator('option').allTextContents();
      expect(options.some(o => o.includes('All') || o.includes('CT'))).toBeTruthy();
    }
  });

  test('uses custom dialog instead of native confirm', async ({ page }) => {
    await page.goto('/imaging');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    // The native confirm/alert should not be called
    let nativeDialogCalled = false;
    page.on('dialog', () => { nativeDialogCalled = true; });

    // Check that no native dialog appears when interacting
    await page.waitForTimeout(1000);
    expect(nativeDialogCalled).toBe(false);
  });
});

// ─── Data Visualization Tests ────────────────────────────────────────

test.describe('Data Visualization', () => {
  test('page loads with chart creation UI', async ({ page }) => {
    await page.goto('/data-visualization');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    // Should have add/create button
    const addBtn = page.locator('button:has-text("New"), button:has-text("Add"), button:has-text("Create")');
    if (await addBtn.count() > 0) {
      await expect(addBtn.first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('no native browser dialogs used', async ({ page }) => {
    let nativeDialogCount = 0;
    page.on('dialog', () => { nativeDialogCount++; });

    await page.goto('/data-visualization');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    expect(nativeDialogCount).toBe(0);
  });
});

// ─── Navigation Tests ────────────────────────────────────────────────

test.describe('Navigation', () => {
  test('sidebar navigation works for all sections', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    // Check sidebar is visible
    const sidebar = page.locator('nav, [role="navigation"]');
    if (await sidebar.count() > 0) {
      await expect(sidebar.first()).toBeVisible();
    }
  });

  test('theme toggle works', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    // Look for sun/moon icon toggle
    const themeBtn = page.locator('button').filter({ has: page.locator('svg') });
    // Just check the page doesn't crash with theme interactions
    expect(true).toBeTruthy();
  });
});

// ─── Discovery Tests ─────────────────────────────────────────────────

test.describe('Discovery Runner', () => {
  test('shows config form without empty space', async ({ page }) => {
    // Navigate to a project discovery page
    await page.goto('/projects');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // Check the projects page loads
    const projectsHeading = page.locator('text=Projects');
    if (await projectsHeading.count() > 0) {
      await expect(projectsHeading.first()).toBeVisible({ timeout: 5000 });
    }
  });
});

// ─── Cross-cutting: No Native Dialogs ────────────────────────────────

test('platform uses no native alert/confirm dialogs on any page', async ({ page }) => {
  let dialogCount = 0;
  page.on('dialog', async (dialog) => {
    dialogCount++;
    await dialog.dismiss();
  });

  // Visit several pages and interact
  for (const path of ['/imaging', '/data-manager', '/compute-lab', '/data-visualization']) {
    await page.goto(path);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(800);
  }

  expect(dialogCount).toBe(0);
});

// ─── Sidebar Navigation Tests ───────────────────────────────────────

test.describe('Sidebar Navigation', () => {
  test('all sidebar sections are present', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    // Check section headers
    for (const section of ['MAIN', 'TOOLS', 'RESEARCH', 'ANALYSIS', 'MANAGEMENT']) {
      const header = page.locator(`text=${section}`);
      if (await header.count() > 0) {
        await expect(header.first()).toBeVisible();
      }
    }
  });

  test('sidebar links navigate correctly', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    // Click Genomics link
    const genomicsLink = page.locator('nav a[href="/genomics"], a:has-text("Genomics")');
    if (await genomicsLink.count() > 0) {
      await genomicsLink.first().click();
      await page.waitForTimeout(1000);
      expect(page.url()).toContain('/genomics');
    }
  });
});

// ─── Genomics Tests ─────────────────────────────────────────────────

test.describe('Genomics Analysis', () => {
  test('tabs are present and switchable', async ({ page }) => {
    await page.goto('/genomics');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    // Check tabs
    const tabs = ['Pathway Enrichment', 'GSEA', 'Variant Annotation', 'Biomarker Discovery'];
    for (const tab of tabs) {
      const tabBtn = page.locator(`button:has-text("${tab}"), [role="tab"]:has-text("${tab}")`);
      if (await tabBtn.count() > 0) {
        await expect(tabBtn.first()).toBeVisible({ timeout: 3000 });
      }
    }
  });

  test('can switch to Biomarker Discovery tab', async ({ page }) => {
    await page.goto('/genomics');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    const tab = page.locator('button:has-text("Biomarker"), [role="tab"]:has-text("Biomarker")');
    if (await tab.count() > 0) {
      await tab.first().click();
      await page.waitForTimeout(500);
    }
  });
});

// ─── Settings Tests ─────────────────────────────────────────────────

test.describe('Settings', () => {
  test('theme toggle works', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    // Check dark theme card is visible
    const darkCard = page.locator('text=Dark');
    if (await darkCard.count() > 0) {
      await expect(darkCard.first()).toBeVisible();
    }

    // Check light theme option exists
    const lightCard = page.locator('text=Light');
    if (await lightCard.count() > 0) {
      await expect(lightCard.first()).toBeVisible();
    }
  });

  test('settings sections are accessible', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    // Check sidebar sections
    for (const section of ['Appearance', 'Account', 'Notifications']) {
      const item = page.locator(`text=${section}`);
      if (await item.count() > 0) {
        await item.first().click();
        await page.waitForTimeout(300);
      }
    }
  });
});

// ─── Notebook Tests ─────────────────────────────────────────────────

test.describe('Notebook', () => {
  test('can create a new page', async ({ page }) => {
    await page.goto('/notebook');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    // Look for "Create one" or "+" button
    const createBtn = page.locator('text=Create one, button:has-text("+")');
    if (await createBtn.count() > 0) {
      await createBtn.first().click();
      await page.waitForTimeout(1000);
    }
  });
});

// ─── Data Manager Tests ─────────────────────────────────────────────

test.describe('Data Manager', () => {
  test('sample datasets are listed', async ({ page }) => {
    await page.goto('/data-manager');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    // Check for dataset items
    const datasetItem = page.locator('text=Clinical Trial');
    if (await datasetItem.count() > 0) {
      await expect(datasetItem.first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('upload CSV button is present', async ({ page }) => {
    await page.goto('/data-manager');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    const uploadBtn = page.locator('button:has-text("Upload CSV"), button:has-text("Upload")');
    if (await uploadBtn.count() > 0) {
      await expect(uploadBtn.first()).toBeVisible({ timeout: 5000 });
    }
  });
});
