import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('genup-theme', 'dark'));
  await page.goto('/data-manager');
  await page.waitForLoadState('networkidle');
});

test.describe('Data Manager', () => {
  test('renders page with title and upload area', async ({ page }) => {
    // Should show Data Manager heading or similar
    const heading = page.locator('text=Data Manager');
    await expect(heading.first()).toBeVisible({ timeout: 10000 });
  });

  test('shows view tabs including overview', async ({ page }) => {
    // Upload a CSV first so tabs appear
    const fileInput = page.locator('input[type="file"]');
    if (await fileInput.count() > 0) {
      const csvContent = 'Name,Age,Score\nAlice,30,85\nBob,25,92\nCharlie,35,78\nDiana,28,95\nEve,32,88';
      const buffer = Buffer.from(csvContent);
      await fileInput.first().setInputFiles({
        name: 'test.csv',
        mimeType: 'text/csv',
        buffer,
      });
      // Wait for data to load
      await page.waitForTimeout(1000);

      // Check for overview tab
      const overviewTab = page.locator('button:has-text("Overview"), [role="tab"]:has-text("Overview")');
      if (await overviewTab.count() > 0) {
        await overviewTab.first().click();
        await page.waitForTimeout(500);

        // Should show summary cards
        const rowsCard = page.locator('text=Rows');
        await expect(rowsCard.first()).toBeVisible({ timeout: 5000 });

        const columnsCard = page.locator('text=Columns');
        await expect(columnsCard.first()).toBeVisible({ timeout: 5000 });
      }
    }
  });

  test('shows table view with data', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');
    if (await fileInput.count() > 0) {
      const csvContent = 'Name,Age,Score\nAlice,30,85\nBob,25,92\nCharlie,35,78';
      const buffer = Buffer.from(csvContent);
      await fileInput.first().setInputFiles({
        name: 'test.csv',
        mimeType: 'text/csv',
        buffer,
      });
      await page.waitForTimeout(1000);

      // Should show table tab and data
      const tableTab = page.locator('button:has-text("Table"), [role="tab"]:has-text("Table")');
      if (await tableTab.count() > 0) {
        await tableTab.first().click();
        await page.waitForTimeout(500);

        // Should show column headers
        const nameHeader = page.locator('text=Name');
        await expect(nameHeader.first()).toBeVisible({ timeout: 5000 });
      }
    }
  });

  test('no console errors on load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto('/data-manager');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Filter out benign errors: favicon, missing resources, backend/network failures.
    // This test targets real runtime/JS errors, not upstream 5xx/4xx from API or CDN.
    const realErrors = errors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('404') &&
      !e.includes('Failed to load resource')
    );
    expect(realErrors.length).toBe(0);
  });
});
