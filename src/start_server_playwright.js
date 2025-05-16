const { chromium } = require('@playwright/test');

const MINEFORT_EMAIL = process.env.MINEFORT_EMAIL;
const MINEFORT_PASSWORD = process.env.MINEFORT_PASSWORD;
const FTP_USERNAME = process.env.FTP_USERNAME;

const LOGIN_URL = 'https://minefort.com/login';
const SERVER_DASHBOARD_URL = `https://minefort.com/servers/${FTP_USERNAME}`;

const SELECTORS = {
  cookieDialog: '#CybotCookiebotDialog',
  cookieDeny: '#CybotCookiebotDialogBodyButtonDecline',
  email: 'input[name="email"]',
  password: 'input[name="password"]',
  signIn: 'button:has-text("Sign In")',
  wakeUp: 'button:has-text("Wake up server")',
  startServer: 'button:has-text("Start server")'
};

(async () => {
  if (!MINEFORT_EMAIL || !MINEFORT_PASSWORD || !FTP_USERNAME) {
    console.error('Missing required environment variables.');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    console.log(`Navigating to login: ${LOGIN_URL}`);
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Handle cookie popup
    const cookieDialog = page.locator(SELECTORS.cookieDialog);
    if (await cookieDialog.isVisible({ timeout: 5000 }).catch(() => false)) {
      const denyButton = page.locator(SELECTORS.cookieDeny);
      if (await denyButton.isVisible().catch(() => false)) {
        console.log('Dismissing cookie dialog...');
        await denyButton.click();
        await cookieDialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      }
    }

    // Wait for the login form container to be visible
    console.log('Waiting for login form container...');
    await page.waitForSelector('form', { timeout: 30000 });

    // Wait for email and password input to be attached to the DOM
    console.log('Waiting specifically for email and password inputs to be attached...');
    await page.waitForSelector(SELECTORS.email, { state: 'attached', timeout: 30000 });
    await page.waitForSelector(SELECTORS.password, { state: 'attached' });

    console.log('Filling in email and password...');
    await page.fill(SELECTORS.email, MINEFORT_EMAIL);
    await page.fill(SELECTORS.password, MINEFORT_PASSWORD);

    console.log('Clicking Sign In...');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }),
      page.click(SELECTORS.signIn)
    ]);

    // Check if login failed (still on login page)
    if (page.url().includes('/login')) {
      throw new Error('Still on login page. Login may have failed.');
    }

    console.log(`Login successful. URL: ${page.url()}`);
    console.log(`Navigating to server dashboard: ${SERVER_DASHBOARD_URL}`);
    await page.goto(SERVER_DASHBOARD_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    console.log('Waiting for server control buttons...');
    await page.waitForSelector(`${SELECTORS.wakeUp}, ${SELECTORS.startServer}`, { timeout: 30000 });

    const wakeUp = page.locator(SELECTORS.wakeUp);
    if (await wakeUp.isVisible().catch(() => false)) {
      console.log('Server is sleeping. Waking up...');
      await wakeUp.click();
      await page.waitForTimeout(10000);
    }

    const startBtn = page.locator(SELECTORS.startServer);
    await startBtn.waitFor({ state: 'visible', timeout: 60000 });
    console.log('Starting server...');
    await startBtn.click();

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