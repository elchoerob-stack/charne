import { expect, test } from '@playwright/test';

// The core loop from the brief: plan → log → review.
test('plan a week, log activity, review and close it', async ({ page }) => {
  // Friday afternoon, when the full review (with misses) is ready.
  await page.clock.install({ time: new Date('2026-10-30T16:00:00+02:00') });
  await page.goto('/');

  // First run
  await expect(page.getByRole('heading', { name: 'Agent Momentum' })).toBeVisible();
  await page.getByRole('button', { name: 'Plan my first week' }).click();

  // 5-step wizard: accept defaults, add one buyer and one deal
  await expect(page.getByRole('heading', { name: 'Where’s your focus?' })).toBeVisible();
  await page.getByRole('button', { name: /R3m – R4m/ }).click();
  await page.getByRole('button', { name: 'The Hills' }).click();
  await page.getByRole('button', { name: /Next: Targets/ }).click();
  await page.getByRole('button', { name: 'More valuations' }).click();
  await page.getByRole('button', { name: /Next: Buyers/ }).click();
  await page.getByRole('button', { name: 'Add a buyer' }).click();
  await page.getByLabel('Maximum budget').fill('3.5m');
  await page.getByRole('button', { name: 'Pre-approved' }).click();
  await page.getByRole('button', { name: 'Add buyer', exact: true }).click();
  await expect(page.getByText('Buyer B1')).toBeVisible();
  await page.getByRole('button', { name: /Next: Top 3/ }).click();
  await page.getByRole('button', { name: 'Add a deal' }).click();
  await page.getByLabel('Reference').fill('12 Oak St');
  await page.getByLabel('Next action').fill('Send comparable sales');
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Add opportunity' }).click();
  await expect(page.getByText('1 of 3 starred')).toBeVisible();
  await page.getByRole('button', { name: /Next: Listings/ }).click();
  await page.getByRole('button', { name: 'Start my week' }).click();

  // Today: one tap on a ring logs it
  await expect(page.getByText(/Good (morning|afternoon|evening), Charné/)).toBeVisible();
  const ring = page.getByRole('button', { name: /^Seller conversations: 0 of 20/ });
  await ring.click();
  await expect(page.getByText('Logged 1 seller conversation')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Seller conversations: 1 of 20/ })).toBeVisible();
  // Undo works
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: /^Seller conversations: 0 of 20/ })).toBeVisible();

  // Two taps from the + button, then optional details
  await page.getByRole('button', { name: 'Log activity' }).click();
  const sheet = page.getByRole('dialog', { name: 'Log activity' });
  await sheet.getByRole('button', { name: /^Valuation \d/ }).click();
  await expect(page.getByText('Logged.')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Mandate likely' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: /^Valuations: 1 of 4/ })).toBeVisible();

  // Due next action shows on Today and can be completed
  await expect(page.getByText('Send comparable sales')).toBeVisible();
  await page.getByRole('button', { name: 'Mark done' }).click();
  await expect(page.getByText(/Done: Send comparable sales/)).toBeVisible();

  // Review reflects exactly what was logged, then close the week
  await page.getByRole('link', { name: 'Review' }).click();
  await expect(page.getByText('Valuations').first()).toBeVisible();
  await expect(page.getByText('Mandates', { exact: true }).first()).toBeVisible();
  await page.getByLabel('Why, in one line').first().fill('Slow start');
  await page.getByRole('button', { name: 'Close week' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Close week' }).click();
  await expect(page.getByText('Week closed. Nicely done.')).toBeVisible();
  await expect(page.getByText(/Closed \w{3} \d+ \w{3}/)).toBeVisible();

  // Survives a reload (IndexedDB)
  await page.reload();
  await expect(page.getByText(/Closed \w{3} \d+ \w{3}/)).toBeVisible();
});

test('sample data fills Insights and can be removed', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore with sample data first' }).click();
  await expect(page.getByRole('heading', { name: 'Insights' })).toBeVisible();
  await expect(page.getByText('Am I improving?')).toBeVisible();
  await expect(page.getByText('Where does my funnel leak?')).toBeVisible();
  await page.getByRole('link', { name: 'Today' }).click();
  await page.getByRole('button', { name: 'Remove sample data' }).click();
  await expect(page.getByText('Sample data removed')).toBeVisible();
});
