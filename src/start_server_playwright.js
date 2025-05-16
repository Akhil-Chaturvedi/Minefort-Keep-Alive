const { chromium } = require('@playwright/test');

// Get credentials and server ID (using FTP_USERNAME as ID) from environment variables (GitHub Secrets)
const MINEFORT_EMAIL = process.env.MINEFORT_EMAIL;
const MINEFORT_PASSWORD = process.env.MINEFORT_PASSWORD;
const FTP_USERNAME = process.env.FTP_USERNAME; // Using FTP_USERNAME as the server ID

// --- Selectors ---
const LOGIN_URL = 'https://minefort.com/login';
const SERVER_DASHBOARD_URL = `https://minefort.com/servers/${FTP_USERNAME}`;

const SELECTORS = {
  cookieDialog: '#CybotCookiebotDialog',
  cookieDeny: '#CybotCookiebotDialogBodyButtonDecline',
  email: 'input#email',
  password: 'input#password',
  signIn: 'button:has-text("Sign In")',
  wakeUp: 'button:has-text("Wake up server")',
  startServer: 'button:has-text("Start server")'
};

const LOGIN_ERROR_SELECTOR = 'div[class*="text-red-500"], p[role="alert"], .login-error-message';

(async () => {
  if (!MINEFORT_EMAIL || !MINEFORT_PASSWORD || !FTP_USERNAME) {
    console.error('Missing required environment variables. Make sure MINEFORT_EMAIL, MINEFORT_PASSWORD, and FTP_USERNAME secrets are set.');
    process.exit(1);
  }

  console.log('Launching headless browser...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    console.log(`Navigating to login: ${LOGIN_URL}`);
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 45000 }); // Slightly increased timeout for page load

    // --- More Robust Cookie Handling ---
    console.log('Attempting to handle cookie consent dialog if present...');
    const cookieDialogElement = page.locator(SELECTORS.cookieDialog);
    const cookieDenyButton = page.locator(SELECTORS.cookieDeny);

    try {
        // Wait for the dialog to become visible.
        // If it doesn't appear within this time, we assume it's not there or already handled.
        await cookieDialogElement.waitFor({ state: 'visible', timeout: 20000 }); // Wait up to 20s for dialog
        console.log('Cookie consent dialog is visible.');

        // If dialog is visible, ensure "Deny" button is also visible and then click it.
        console.log('Waiting for "Deny" button to be actionable...');
        await cookieDenyButton.waitFor({ state: 'visible', timeout: 5000 }); // Wait for deny button
        console.log('Clicking "Deny" on cookie dialog...');
        await cookieDenyButton.click({ timeout: 5000 }); // Click deny button

        // IMPORTANT: Wait for the dialog to actually disappear.
        console.log('Waiting for cookie dialog to become hidden...');
        await cookieDialogElement.waitFor({ state: 'hidden', timeout: 10000 }); // Wait up to 10s for it to hide
        console.log('Cookie consent dialog is now hidden.');

    } catch (error) {
        // This block catches errors from the try block above (e.g., timeouts)
        if (error.message.includes('Timeout') && error.message.includes(SELECTORS.cookieDialog) && error.message.includes("state: 'visible'")) {
            // This is okay: dialog didn't appear, so we assume it's not an issue.
            console.log('Cookie consent dialog did not become visible within the timeout. Assuming it is not present.');
        } else if (error.message.includes('Timeout') && error.message.includes(SELECTORS.cookieDialog) && error.message.includes("state: 'hidden'")) {
            // This is a warning: we clicked Deny, but the dialog didn't disappear.
            console.warn('Clicked "Deny" on cookie dialog, but it did not disappear within the timeout. It might interfere with subsequent actions.');
            console.log('Attempting to press Escape key as a fallback...');
            await page.keyboard.press('Escape');
            await page.waitForTimeout(1000); // Give it a moment
            if (await cookieDialogElement.isHidden({timeout: 2000})) {
                console.log('Dialog hidden after pressing Escape.');
            } else {
                console.warn('Escape key did not hide the cookie dialog. It may still be present and cause issues.');
            }
        } else {
            // Other errors during cookie handling (e.g., Deny button not found when dialog was expected)
            console.warn(`A warning or error occurred during cookie dialog handling: ${error.name} - ${error.message}. Attempting to proceed.`);
        }
    }
    // --- End of Cookie Handling ---

    console.log('Waiting specifically for email and password inputs...');
    await page.waitForSelector(SELECTORS.email, { state: 'attached', timeout: 30000 });
    await page.waitForSelector(SELECTORS.password, { state: 'attached', timeout: 30000 });

    console.log('Filling in email and password...');
    await page.fill(SELECTORS.email, MINEFORT_EMAIL);
    await page.fill(SELECTORS.password, MINEFORT_PASSWORD);

    console.log('Waiting briefly before clicking Sign In...');
    await page.waitForTimeout(2000); // Small pause

    // Now, attempt to click Sign In (the cookie dialog should be gone)
    console.log('Clicking Sign In button...');
    await page.click(SELECTORS.signIn, {timeout: 30000 }); // Click with a timeout, ensuring it is actionable

    console.log('Waiting for navigation to occur after clicking Sign In...');
    try {
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 });
        console.log(`Navigation completed. Current URL is: ${page.url()}`);
    } catch (navError) {
        console.error(`Timeout or error during page.waitForNavigation after sign-in. Current URL: ${page.url()}`);
        if (page.url().startsWith(LOGIN_URL)) {
            const loginErrorElement = page.locator(LOGIN_ERROR_SELECTOR).first();
            let loginErrorText = "No specific error message found on page.";
            if (await loginErrorElement.isVisible({timeout: 2000}).catch(() => false)) {
                loginErrorText = await loginErrorElement.textContent() || "Error message element found but was empty.";
            }
            throw new Error(`Login failed: Still on login page after navigation timeout. Page might have shown an error: "${loginErrorText}". Original navigation error: ${navError.message}`);
        }
        throw new Error(`Login failed: Navigation error after sign-in. Current URL: ${page.url()}. Original error: ${navError.message}`);
    }

    if (page.url().startsWith(LOGIN_URL)) {
        const loginErrorElement = page.locator(LOGIN_ERROR_SELECTOR).first();
        let loginErrorText = "No specific error message found on page after navigation.";
         if (await loginErrorElement.isVisible({timeout: 2000}).catch(() => false)) {
            loginErrorText = await loginErrorElement.textContent() || "Error message element found but was empty.";
        }
        throw new Error(`Login failed: Redirected back to or remained on login page. Page might have shown an error: "${loginErrorText}". URL: ${page.url()}`);
    }

    console.log(`Login appears successful or navigated away from login page. Current URL: ${page.url()}`);

    console.log(`Navigating directly to server dashboard: ${SERVER_DASHBOARD_URL}`);
    await page.goto(SERVER_DASHBOARD_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('Navigated to server dashboard.');

    console.log('Waiting for server control buttons...');
    await page.waitForSelector(`${SELECTORS.wakeUp}, ${SELECTORS.startServer}`, { timeout: 30000 });
    console.log('Server dashboard buttons found.');

    const wakeUpButton = page.locator(SELECTORS.wakeUp);
    if (await wakeUpButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('Server is sleeping. Clicking "Wake up server" button...');
      await wakeUpButton.click();
      console.log('Clicked "Wake up server". Waiting 10 seconds for state change...');
      await page.waitForTimeout(10000);
      console.log('Finished waiting after Wake up.');
    } else {
      console.log('"Wake up server" button not visible. Assuming server is not sleeping or in a different state.');
    }

    const startServerButton = page.locator(SELECTORS.startServer);
    console.log('Looking for "Start server" button...');
    await startServerButton.waitFor({ state: 'visible', timeout: 60000 });

    console.log('Clicking "Start server" button...');
    await startServerButton.click();
    console.log('Clicked "Start server".');

    const finalServerStartWait = 10 * 1000;
    console.log(`Clicked Start. Waiting ${finalServerStartWait / 1000} seconds for server to become ready...`);
    await page.waitForTimeout(finalServerStartWait);
    console.log('Finished waiting. Assuming server is ready for backup.');

    console.log('Playwright script finished successfully.');
    await browser.close();
    process.exit(0);

  } catch (err) {
    console.error('Error during automation:', err.message); // Log just the message for cleaner GitHub Action logs
    console.error('Full error object:', err); // Log the full error for detailed debugging if needed
    if (page && !page.isClosed()) {
        try {
            const screenshotPath = 'playwright_error.png';
            await page.screenshot({ path: screenshotPath });
            console.log(`Saved error screenshot: ${screenshotPath}`);
        } catch (screenshotError) {
            console.error('Could not take screenshot:', screenshotError);
        }
    }
    if (browser) {
      await browser.close();
    }
    process.exit(1);
  }
})();
