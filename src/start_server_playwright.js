const { chromium } = require('@playwright/test');

// Get credentials and server ID (using FTP_USERNAME as ID) from environment variables (GitHub Secrets)
const MINEFORT_EMAIL = process.env.MINEFORT_EMAIL;
const MINEFORT_PASSWORD = process.env.MINEFORT_PASSWORD;
const FTP_USERNAME = process.env.FTP_USERNAME; // Using FTP_USERNAME as the server ID

// --- Selectors ---
const LOGIN_URL = 'https://minefort.com/login';
const SERVER_DASHBOARD_URL = `https://minefort.com/servers/${FTP_USERNAME}`; // Your specific server page URL

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
    console.log('Waiting for initial navigation after login attempt (expecting /servers)...');
    let currentUrlAfterLogin = '';
    try {
        // Wait for the first navigation that should land on /servers
        // Increased timeout slightly as login redirects can sometimes take longer
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 });
        currentUrlAfterLogin = page.url();
        console.log(`Initial navigation completed. Current URL is: ${currentUrlAfterLogin}`);
    } catch (navError) {
        currentUrlAfterLogin = page.url();
         // If timeout occurred and we are on the servers page, we can potentially proceed.
         // If still on login page, throw the error.
         if (currentUrlAfterLogin.startsWith(LOGIN_URL)) {
             const loginErrorElement = page.locator(LOGIN_ERROR_SELECTOR).first();
             let loginErrorText = "No specific error message found on page after initial nav timeout.";
              if (await loginErrorElement.isVisible({timeout: 1000}).catch(() => false)) {
                 loginErrorText = await loginErrorElement.textContent({timeout:1000}) || "Error message element found but was empty.";
             }
             throw new Error(`Login failed: Still on login page after initial navigation timeout. Page might have shown an error: "${loginErrorText}". URL during navError: ${currentUrlAfterLogin}. Original navigation error: ${navError.message}`);
         } else if (currentUrlAfterLogin.startsWith('https://minefort.com/servers')) {
             console.warn(`Initial navigation timeout on servers list page (${currentUrlAfterLogin}), but proceeding as we might have reached the correct general area.`);
         } else {
            // Unexpected page after navigation attempt
            throw new Error(`Login failed: Unexpected navigation error after login attempt. Current URL: ${currentUrlAfterLogin}. Original error: ${navError.message}`);
         }
    }


    // Check if the initial navigation landed on the expected servers page or was an error
    if (currentUrlAfterLogin.startsWith(LOGIN_URL)) {
         const loginErrorElement = page.locator(LOGIN_ERROR_SELECTOR).first();
        let loginErrorText = "No specific error message found on page after initial navigation completed (but still on login page).";
         if (await loginErrorElement.isVisible({timeout: 2000}).catch(() => false)) {
            loginErrorText = await loginErrorElement.textContent({timeout:1000}) || "Error message element found but was empty.";
        }
        throw new Error(`Login failed: Redirected back to or remained on login page after initial navigation. Page might have shown an error: "${loginErrorText}". URL after login attempt: ${currentUrlAfterLogin}`);
    } else if (!currentUrlAfterLogin.startsWith('https://minefort.com/servers')) {
         // If not on login page, but also not on the servers list page, something else is wrong
         console.warn(`Unexpected initial landing page after login. Expected to land on /servers, but landed on: ${currentUrlAfterLogin}. Attempting to proceed to server dashboard anyway.`);
    } else {
         console.log(`Successfully reached the servers list page: ${currentUrlAfterLogin}`);
    }

    // Now, explicitly navigate to the specific server dashboard URL
    console.log(`Navigating to specific server dashboard: ${SERVER_DASHBOARD_URL}`);
    // Use goto and wait for it to load the specific server page
    await page.goto(SERVER_DASHBOARD_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }); // Increased timeout for server page load
    console.log('Navigated to server dashboard.');

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