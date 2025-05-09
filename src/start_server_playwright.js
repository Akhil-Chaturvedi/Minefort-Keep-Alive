const { chromium } = require('@playwright/test');

// Get credentials and server ID from environment variables (GitHub Secrets)
const MINEFORT_EMAIL = process.env.MINEFORT_EMAIL;
const MINEFORT_PASSWORD = process.env.MINEFORT_PASSWORD;
const MINEFORT_SERVER_ID = process.env.MINEFORT_SERVER_ID; // e.g., 'PTHOzcWHNb'

// --- Selectors based on the HTML you provided ---
const LOGIN_URL = 'https://minefort.com/login';
const EMAIL_INPUT_SELECTOR = 'input#email';
const PASSWORD_INPUT_SELECTOR = 'input#password';
const SIGN_IN_BUTTON_SELECTOR = 'button:has-text("Sign In")';

// Use the server ID to construct the direct URL
const SERVER_DASHBOARD_URL = `https://minefort.com/servers/${MINEFORT_SERVER_ID}`;

// Selectors for buttons *on the individual server dashboard page*
// Using text content for robustness, assuming the text is unique enough
const WAKE_UP_BUTTON_SELECTOR = 'button:has-text("Wake up server")';
const START_SERVER_BUTTON_SELECTOR = 'button:has-text("Start server")';

// --- Cookie Dialog Selectors ---
const COOKIE_DIALOG_SELECTOR = '#CybotCookiebotDialog'; // Selector for the main dialog
const COOKIE_DENY_BUTTON_SELECTOR = '#CybotCookiebotDialogBodyButtonDecline'; // Selector for the "Deny" button
// --- End Selectors ---


(async () => {
  if (!MINEFORT_EMAIL || !MINEFORT_PASSWORD || !MINEFORT_SERVER_ID) {
    console.error('Error: MINEFORT_EMAIL, MINEFORT_PASSWORD, and MINEFORT_SERVER_ID environment variables must be set.');
    process.exit(1);
  }

  console.log('Launching headless browser...');
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    console.log(`Navigating to login page: ${LOGIN_URL}`);
    await page.goto(LOGIN_URL);

    // --- Handle Cookie Consent Dialog ---
    console.log('Checking for cookie consent dialog...');
    const cookieDialog = page.locator(COOKIE_DIALOG_SELECTOR);
    // Use a slightly longer timeout here in case the dialog takes a moment to appear
    if (await cookieDialog.isVisible({ timeout: 15000 })) {
        console.log('Cookie consent dialog found. Attempting to dismiss...');
        const denyButton = page.locator(COOKIE_DENY_BUTTON_SELECTOR);
        if (await denyButton.isVisible()) {
            console.log('Clicking "Deny" on cookie dialog...');
            await denyButton.click();
            console.log('Cookie dialog dismissed.');
            // Wait for the dialog to disappear
            await cookieDialog.waitFor({ state: 'hidden', timeout: 5000 });
        } else {
            console.warn('Cookie dialog visible, but "Deny" button not found. Proceeding anyway.');
        }
    } else {
        console.log('Cookie consent dialog not found or did not appear.');
    }
    // --- End Handle Cookie Consent Dialog ---


    console.log('Filling login form...');
    await page.fill(EMAIL_INPUT_SELECTOR, MINEFORT_EMAIL);
    await page.fill(PASSWORD_INPUT_SELECTOR, MINEFORT_PASSWORD);

    console.log('Clicking Sign In button...');
    await page.click(SIGN_IN_BUTTON_SELECTOR);

    // Wait for successful login and potential redirect (usually back to /servers or dashboard)
    console.log('Waiting for successful login (expecting navigation away from login page)...');
    // Corrected line: Check the pathname of the URL object
    await page.waitForURL(url => url.pathname !== '/login', { timeout: 30000 });
    console.log(`Login successful. Current URL: ${page.url()}`);


    // --- Navigate directly to the server dashboard using the ID ---
    console.log(`Navigating directly to server dashboard: ${SERVER_DASHBOARD_URL}`);
    await page.goto(SERVER_DASHBOARD_URL, { waitUntil: 'domcontentloaded' });
    console.log('Navigated to server dashboard.');
    // --- End Direct Navigation ---


    // Wait for the page content to load, specifically looking for one of the buttons
    console.log('Waiting for server dashboard content to load...');
    await page.waitForSelector(WAKE_UP_BUTTON_SELECTOR + ', ' + START_SERVER_BUTTON_SELECTOR, { timeout: 30000 });
    console.log('Server dashboard buttons found.');


    // Check if the server is sleeping (Wake up server button is visible)
    const wakeUpButton = page.locator(WAKE_UP_BUTTON_SELECTOR);
    if (await wakeUpButton.isVisible({ timeout: 5000 })) { // Check visibility with a short timeout
        console.log('Server is sleeping. Clicking "Wake up server" button...');
        await wakeUpButton.click();
        console.log('Clicked "Wake up server". Waiting 10 seconds for state change...');
        await page.waitForTimeout(10000); // Wait 10 seconds after clicking Wake up
        console.log('Finished waiting after Wake up.');
    } else {
        console.log('"Wake up server" button not visible. Assuming server is not sleeping or in a different state.');
    }


    // Now look for the "Start server" button
    const startServerButton = page.locator(START_SERVER_BUTTON_SELECTOR);

    console.log('Looking for "Start server" button...');
     // Wait for the start button to become visible, up to a certain timeout
    await startServerButton.waitFor({ state: 'visible', timeout: 60000 }); // Wait up to 60 seconds for Start button

    console.log('Clicking "Start server" button...');
    await startServerButton.click();
    console.log('Clicked "Start server".');

    // Add a final wait to allow the server to fully start before the script exits
    // Based on your input, 10 seconds after clicking Start should be enough for it to be 'ready'
    const finalServerStartWait = 10 * 1000; // 10 seconds
    console.log(`Clicked Start. Waiting ${finalServerStartWait / 1000} seconds for server to become ready...`);
    await page.waitForTimeout(finalServerStartWait);
    console.log('Finished waiting. Assuming server is ready for backup.');


    console.log('Playwright script finished successfully.');
    await browser.close();
    process.exit(0); // Exit successfully

  } catch (error) {
    console.error('Playwright script failed:', error);
    // Attempt to take a screenshot on any error for debugging
    try {
        await page.screenshot({ path: 'playwright_error.png' });
        console.log('Screenshot saved as playwright_error.png');
    } catch (screenshotError) {
        console.error('Failed to take screenshot:', screenshotError);
    }
    if (browser) {
      await browser.close();
    }
    process.exit(1); // Exit with error code
  }
})();
