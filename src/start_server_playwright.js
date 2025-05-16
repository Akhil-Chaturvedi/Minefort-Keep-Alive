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
  // signIn: 'button:has-text("Sign In")', // We'll try pressing Enter first
  wakeUp: 'button:has-text("Wake up server")',
  startServer: 'button:has-text("Start server")'
};

// IMPORTANT: Update this selector if you find a specific error message on playwright_error.png
const LOGIN_ERROR_SELECTOR = 'div[class*="text-red-500"], p[role="alert"], .login-error-message, .error-message';

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
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });

    console.log('Attempting to handle cookie consent dialog if present...');
    const cookieDialogElement = page.locator(SELECTORS.cookieDialog);
    const cookieDenyButton = page.locator(SELECTORS.cookieDeny);

    try {
        await cookieDialogElement.waitFor({ state: 'visible', timeout: 20000 });
        console.log('Cookie consent dialog is visible.');
        await cookieDenyButton.waitFor({ state: 'visible', timeout: 5000 });
        console.log('Clicking "Deny" on cookie dialog...');
        await cookieDenyButton.click({ timeout: 5000 });
        await cookieDialogElement.waitFor({ state: 'hidden', timeout: 10000 });
        console.log('Cookie consent dialog is now hidden.');
    } catch (error) {
        if (error.message.includes('Timeout') && error.message.includes(SELECTORS.cookieDialog) && error.message.includes("state: 'visible'")) {
            console.log('Cookie consent dialog did not become visible within the timeout. Assuming it is not present.');
        } else if (error.message.includes('Timeout') && error.message.includes(SELECTORS.cookieDialog) && error.message.includes("state: 'hidden'")) {
            console.warn('Clicked "Deny" on cookie dialog, but it did not disappear. Trying Escape key...');
            await page.keyboard.press('Escape');
            await page.waitForTimeout(1000);
            if (await cookieDialogElement.isHidden({timeout: 2000})) {
                console.log('Dialog hidden after pressing Escape.');
            } else {
                console.warn('Escape key did not hide the cookie dialog.');
            }
        } else {
            console.warn(`Warning during cookie dialog handling: ${error.name} - ${error.message}. Attempting to proceed.`);
        }
    }

    console.log('Waiting specifically for email and password inputs...');
    await page.waitForSelector(SELECTORS.email, { state: 'attached', timeout: 30000 });
    await page.waitForSelector(SELECTORS.password, { state: 'attached', timeout: 30000 });

    console.log('Filling in email and password...');
    await page.fill(SELECTORS.email, MINEFORT_EMAIL);
    await page.fill(SELECTORS.password, MINEFORT_PASSWORD);

    console.log('Attempting to log in by pressing Enter in the password field...');
    await page.locator(SELECTORS.password).press('Enter');

    console.log('Waiting for navigation to occur after login attempt...');
    let navigatedUrlAfterLoginAttempt = '';
    try {
        // Wait for navigation to complete after pressing Enter
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 });
        navigatedUrlAfterLoginAttempt = page.url(); // Capture URL immediately
        console.log(`Navigation completed. Current URL is: ${navigatedUrlAfterLoginAttempt}`);
    } catch (navError) {
        navigatedUrlAfterLoginAttempt = page.url(); // Capture URL even if navigation times out
        console.error(`Timeout or error during page.waitForNavigation after login attempt. Current URL: ${navigatedUrlAfterLoginAttempt}`);
        if (navigatedUrlAfterLoginAttempt.startsWith(LOGIN_URL)) {
            const loginErrorElement = page.locator(LOGIN_ERROR_SELECTOR).first();
            let loginErrorText = "No specific error message found on page (during navError).";
            if (await loginErrorElement.isVisible({timeout: 1000}).catch(() => false)) { // Shorter timeout for error check
                loginErrorText = await loginErrorElement.textContent({timeout:1000}) || "Error message element found but was empty.";
            }
            throw new Error(`Login failed: Still on login page after navigation timeout. Page might have shown an error: "${loginErrorText}". URL during navError: ${navigatedUrlAfterLoginAttempt}. Original navigation error: ${navError.message}`);
        }
        throw new Error(`Login failed: Navigation error after login attempt. Current URL: ${navigatedUrlAfterLoginAttempt}. Original error: ${navError.message}`);
    }

    // Check the captured URL after navigation attempt
    if (navigatedUrlAfterLoginAttempt.startsWith(LOGIN_URL)) {
        const loginErrorElement = page.locator(LOGIN_ERROR_SELECTOR).first();
        let loginErrorText = "No specific error message found on page after navigation.";
         if (await loginErrorElement.isVisible({timeout: 2000}).catch(() => false)) { // Slightly longer here as page should be 'stable'
            loginErrorText = await loginErrorElement.textContent({timeout:1000}) || "Error message element found but was empty.";
        }
        throw new Error(`Login failed: Redirected back to or remained on login page. Page might have shown an error: "${loginErrorText}". URL after login attempt: ${navigatedUrlAfterLoginAttempt}`);
    }

    console.log(`Login appears successful. Navigated away from login page. Current URL: ${navigatedUrlAfterLoginAttempt}`);

    // If login was successful and we are not on SERVER_DASHBOARD_URL, navigate there.
    if (!navigatedUrlAfterLoginAttempt.startsWith(SERVER_DASHBOARD_URL)) {
        console.log(`Current URL is not the server dashboard. Navigating to: ${SERVER_DASHBOARD_URL}`);
        await page.goto(SERVER_DASHBOARD_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        console.log('Navigated to server dashboard.');
    } else {
        console.log('Already on the server dashboard or a subpage of it.');
    }


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
    console.error('Error during automation:', err.message);
    console.error('Full error object for debugging:', err); // Keep this for detailed trace
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
