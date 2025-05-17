const { chromium } = require('@playwright/test');

// Get credentials and server ID (using FTP_USERNAME as ID) from environment variables (GitHub Secrets)
const MINEFORT_EMAIL = process.env.MINEFORT_EMAIL;
const MINEFORT_PASSWORD = process.env.MINEFORT_PASSWORD;
const FTP_USERNAME = process.env.FTP_USERNAME; // Using FTP_USERNAME as the server ID

// --- Selectors ---
const LOGIN_URL = 'https://minefort.com/login';
const SERVER_DASHBOARD_URL = `https://minefort.com/servers/${FTP_USERNAME}`; // Your specific server page URL
const SERVERS_LIST_URL_PREFIX = 'https://minefort.com/servers'; // Prefix for the servers list page

const SELECTORS = {
  cookieDialog: '#CybotCookiebotDialog',
  cookieDeny: '#CybotCookiebotDialogBodyButtonDecline',
  email: 'input#email',
  password: 'input#password',
  signIn: 'button:has-text("Sign In")',
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

    // Give a moment for navigation to potentially start
    await page.waitForTimeout(1000); // Wait for 1 second

    const signInButton = page.locator(SELECTORS.signIn);

    // Check if the Sign In button is still visible after pressing Enter
    if (await signInButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log('"Sign In" button is still visible after pressing Enter. Clicking the button...');
        await signInButton.click();
    } else {
        console.log('"Sign In" button is not visible after pressing Enter. Assuming navigation started.');
    }

    // --- MODIFICATION START ---
    console.log('Waiting for URL to change away from login page after login attempt...');
    let currentUrlAfterLoginAttempt = page.url(); // Capture URL before waiting
    try {
        // Wait until the URL is no longer the login URL
        // FIX: Use url.href to access the string representation of the URL
        await page.waitForURL(url => !url.href.startsWith(LOGIN_URL), { timeout: 45000 });
        currentUrlAfterLoginAttempt = page.url(); // Capture the new URL after successful wait
        console.log(`Successfully navigated away from login page. Current URL is: ${currentUrlAfterLoginAttempt}`);

    } catch (urlError) {
        currentUrlAfterLoginAttempt = page.url(); // Capture URL even if waitForURL times out
        console.error(`Timeout waiting for URL to change away from login page. Current URL: ${currentUrlAfterLoginAttempt}`);

        // If after the timeout, we are still on the login page, login failed.
        if (currentUrlAfterLoginAttempt.startsWith(LOGIN_URL)) {
             const loginErrorElement = page.locator(LOGIN_ERROR_SELECTOR).first();
             let loginErrorText = "No specific error message found on page (after waiting for URL change).";
              if (await loginErrorElement.isVisible({timeout: 2000}).catch(() => false)) {
                 loginErrorText = await loginErrorElement.textContent({timeout:1000}) || "Error message element found but was empty.";
             }
             throw new Error(`Login failed: Remained on login page after attempt. Page might have shown an error: "${loginErrorText}". URL after login attempt: ${currentUrlAfterLoginAttempt}. Original wait error: ${urlError.message}`);
        } else {
             // If timeout happened but we are on a different URL (like /servers),
             // it means we successfully navigated away from login but the waitForURL condition
             // might have timed out for another reason (e.g., page still loading).
             // We will proceed as we are off the login page.
             console.warn(`Timeout waiting for URL to change away from login page, but page is no longer login page. Current URL: ${currentUrlAfterLoginAttempt}. Proceeding.`);
             // Do NOT throw error here, continue execution.
        }
    }

    // Now that we are confirmed (either by waitForURL or by checking after timeout)
    // to be off the login page, check if we are on the servers list or specific server page.
    console.log(`Checking current page after login attempt: ${currentUrlAfterLoginAttempt}`);

    // If current URL is not the specific server dashboard, navigate there.
    // This handles both landing on /servers or any other page after login.
    if (!currentUrlAfterLoginAttempt.startsWith(SERVER_DASHBOARD_URL)) {
        console.log(`Current URL is not the specific server dashboard. Navigating to: ${SERVER_DASHBOARD_URL}`);
        // Use goto and wait for it to load the specific server page
        await page.goto(SERVER_DASHBOARD_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }); // Increased timeout for server page load
        console.log('Navigated to server dashboard.');
    } else {
        console.log('Already on the specific server dashboard or a subpage of it.');
    }
    // --- MODIFICATION END ---


    console.log('Waiting for server control buttons...');
    await page.waitForSelector(`${SELECTORS.wakeUp}, ${SELECTORS.startServer}`, { timeout: 60000 }); // Increased timeout for buttons
    console.log('Server dashboard buttons found.');

    const wakeUpButton = page.locator(SELECTORS.wakeUp);
    if (await wakeUpButton.isVisible({ timeout: 10000 }).catch(() => false)) { // Increased timeout for wake up check
      console.log('Server is sleeping. Clicking "Wake up server" button...');
      await wakeUpButton.click();
      console.log('Clicked "Wake up server". Waiting 20 seconds for state change...'); // Increased wait
      await page.waitForTimeout(20000);
      console.log('Finished waiting after Wake up.');
    } else {
      console.log('"Wake up server" button not visible. Assuming server is not sleeping or in a different state.');
    }

    const startServerButton = page.locator(SELECTORS.startServer);
    console.log('Looking for "Start server" button...');
    // Wait for the start button to be visible, indicating the server is ready to be started
    await startServerButton.waitFor({ state: 'visible', timeout: 120000 }); // Increased timeout significantly for server start readiness

    console.log('Clicking "Start server" button...');
    await startServerButton.click();
    console.log('Clicked "Start server".');

    const finalServerStartWait = 30 * 1000; // Increased wait
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