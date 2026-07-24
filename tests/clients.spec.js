import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  // Pre-seed local storage so the app recognizes a valid session on load
  await page.addInitScript(() => {
    localStorage.setItem('practice_suite_google_email', 'eyt.sasn@gmail.com');
    localStorage.setItem('practice_suite_session_id', 'test-session-id-123');
    localStorage.setItem('sasson_practice_settings', JSON.stringify({ country: "UK", practiceName: "Test Practice" }));
    localStorage.setItem('sasson_practice_secure_store', JSON.stringify({ clients: [] }));
  });

  // Mock get-token to match what attemptSilentReconnect() actually reads: data.access_token
  await page.route('**/get-token**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: 'mock-test-token-abc123',
        expires_in: 3600
      })
    });
  });

  // Google Drive API calls will use our fake token and fail — that's fine,
  // the app catches those errors silently. But let's stub them anyway to
  // avoid noisy 401s and keep behavior predictable.
  await page.route('https://www.googleapis.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ files: [], user: { emailAddress: 'eyt.sasn@gmail.com' } })
    });
  });
});

test('Should successfully add a new client', async ({ page }) => {
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  // 1. Set a standard desktop viewport
  await page.setViewportSize({ width: 1280, height: 800 });

  // 2. Navigate to your local server
  await page.goto('http://127.0.0.1:5500/index.html');

  // 3. The app may prompt to register a passkey after login — skip it if it appears
  const skipPasskeyBtn = page.locator('#btn-skip-passkey');
  try {
    await skipPasskeyBtn.waitFor({ state: 'visible', timeout: 8000 });
    await skipPasskeyBtn.click();
  } catch (e) {
    // Overlay didn't appear — proceed as normal
  }

  // 4. Wait for the dashboard to become visible
  await page.waitForSelector('text=Monthly Performance', { state: 'visible', timeout: 10000 });

  // 5. Navigate to clients view
  await page.evaluate(() => navigate('clients'));

  // 6. Wait for the "+ Add Client" button and click it
  const addClientBtn = page.locator('button:has-text("+ Add Client")');
  await addClientBtn.waitFor({ state: 'visible', timeout: 10000 });
  await addClientBtn.click();

  // 7. Fill out the form
  await page.fill('#new-name', 'Jane Test User');
  await page.fill('#new-phone', '07123456789');
  await page.fill('#new-rate', '60');

  // 8. Submit the form
  await page.click('button:has-text("Create & Open Profile")');

  // 9. Verify the profile opened successfully with the right name
  const profileName = page.locator('#profile-client-name');
  await expect(profileName).toHaveText('Jane Test User');
});