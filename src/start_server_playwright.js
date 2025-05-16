const { chromium } = require('@playwright/test');

// Get credentials and server ID from environment variables (GitHub Secrets)
const MINEFORT_EMAIL = process.env.MINEFORT_EMAIL;
const MINEFORT_PASSWORD = process.env.MINEFORT_PASSWORD;
const FTP_USERNAME = process.env.FTP_USERNAME;

const LOGIN_URL = 'https://minefort.com/login';
const EMAIL_INPUT_SELECTOR = 'input[name="email"]';
const PASSWORD_INPUT_SELECTOR = 'input[name="password"]';
const SIGN_IN_BUTTON_SELECTOR = 'button[type="submit"]';
const SERVER_DASHBOARD_URL = `https://minefort.com/servers/${FTP_USERNAME}`;
const WAKE_UP_BUTTON_SELECTOR = 'button:has-text("Wake up server")';
const START_SERVER_BUTTON_SELECTOR = 'button:has-text("Start server")';

const COOKIE_DIALOG_SELECTOR = '#CybotCookiebotDialog';
const COOKIE_DENY_BUTTON_SELECTOR = '#CybotCookiebotDialogBodyButtonDecline';

(async () => {
  if (!MINEFORT_EMAIL || !MINEFORT_PASSWORD || !FTP_USERNAME) {
    console.error('Missing required environment variables.');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log(`Navigating to login: ${LOGIN_URL}`);
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Dismiss cookie popup if present
    const cookieDialog = page.locator(COOKIE_DIALOG_SELECTOR);
    if (await cookieDialog.isVisible().catch(() => false)) {
      const denyButton = page.locator(COOKIE_DENY_BUTTON_SELECTOR);
      if (await denyButton.isVisible().catch(() => false)) {
        console.log('Dismissing cookie dialog...');
        await denyButton.click().catch(() => {});
        await cookieDialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      }
    }

    console.log('Filling in email and password...');
    await page.fill(EMAIL_INPUT_SELECTOR, MINEFORT_EMAIL);
    await page.fill(PASSWORD_INPUT_SELECTOR, MINEFORT_PASSWORD);

    // Confirm fields filled
    const filledEmail = await page.inputValue(EMAIL_INPUT_SELECTOR);
    const filledPassword = await page.inputValue(PASSWORD_INPUT_SELECTOR);
    if (!filledEmail || !filledPassword) throw new Error('Login form not properly filled');

    console.log('Clicking Sign In...');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }),
      page.click(SIGN_IN_BUTTON_SELECTOR)
    ]);

    if (page.url().includes('/login')) {
      throw new Error('Still on login page. Login may have failed (invalid credentials or CAPTCHA).');
    }

    console.log(`Login successful. URL: ${page.url()}`);

    console.log(`Navigating to server dashboard: ${SERVER_DASHBOARD_URL}`);
    await page.goto(SERVER_DASHBOARD_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    console.log('Waiting for server control buttons...');
    await page.waitForSelector(`${WAKE_UP_BUTTON_SELECTOR}, ${START_SERVER_BUTTON_SELECTOR}`, { timeout: 30000 });

    const wakeUpButton = page.locator(WAKE_UP_BUTTON_SELECTOR);
    if (await wakeUpButton.isVisible().catch(() => false)) {
      console.log('Server is sleeping. Waking up...');
      await wakeUpButton.click();
      await page.waitForTimeout(10000);
    }

    const startServerButton = page.locator(START_SERVER_BUTTON_SELECTOR);
    await startServerButton.waitFor({ state: 'visible', timeout: 60000 });
    console.log('Starting server...');
    await startServerButton.click();

    console.log('Waiting 10 seconds after starting server...');
    await page.waitForTimeout(10000);

    console.log('Server should now be starting. Done.');
    await browser.close();
    process.exit(0);

  } catch (err) {
    console.error('Error during automation:', err);
    try {
      await page.screenshot({ path: 'playwright_error.png' });
      console.log('Saved error screenshot: playwright_error.png');
    } catch (screenshotError) {
      console.error('Could not take screenshot:', screenshotError);
    }
    await browser.close();
    process.exit(1);
  }
})();