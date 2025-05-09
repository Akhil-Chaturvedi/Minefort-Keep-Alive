const { chromium } = require('@playwright/test');

// Get credentials and server name from environment variables (GitHub Secrets)
const MINEFORT_EMAIL = process.env.MINEFORT_EMAIL;
const MINEFORT_PASSWORD = process.env.MINEFORT_PASSWORD;
const MINEFORT_SERVER_NAME = process.env.MINEFORT_SERVER_NAME; // e.g., 'ForAboniii'

// --- Selectors based on the HTML you provided ---
const LOGIN_URL = 'https://minefort.com/login';
const EMAIL_INPUT_SELECTOR = 'input#email';
const PASSWORD_INPUT_SELECTOR = 'input#password';
const SIGN_IN_BUTTON_SELECTOR = 'button:has-text("Sign In")'; // Using text content as a selector

const SERVERS_URL = 'https://minefort.com/servers';
// Selector for the specific server card using the server name
// This looks for a div that contains an h5 with the server name text
const SERVER_CARD_SELECTOR = `div:has(h5:has-text("${MINEFORT_SERVER_NAME}"))`;
// Selectors for buttons *within* the server card
const WAKE_UP_BUTTON_SELECTOR = 'button:has-text("Wake up")';
const START_SERVER_BUTTON_SELECTOR = 'button:has-text("Start server")';
// --- Cookie Dialog Selectors ---
const COOKIE_DIALOG_SELECTOR = '#CybotCookiebotDialog'; // Selector for the main dialog
const COOKIE_DENY_BUTTON_SELECTOR = '#CybotCookiebotDialogBodyButtonDecline'; // Selector for the "Deny" button
// --- End Selectors ---


(async () => {
  if (!MINEFORT_EMAIL || !MINEFORT_PASSWORD || !MINEFORT_SERVER_NAME) {
    console.error('Error: MINEFORT_EMAIL, MINEFORT_PASSWORD, and MINEFORT_SERVER_NAME environment variables must be set.');
    process.exit(1);
  }

  console.log('Launching headless browser...');
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    console.log(`Navigating to login page: ${LOGIN_URL}`);
    await page.goto(LOGIN_URL);

    // --- ADDED: Handle Cookie Consent Dialog ---
    console.log('Checking for cookie consent dialog...');
    const cookieDialog = page.locator(COOKIE_DIALOG_SELECTOR);
    if (await cookieDialog.isVisible({ timeout: 10000 })) { // Check visibility with a timeout
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
    // --- END ADDED: Handle Cookie Consent Dialog ---


    console.log('Filling login form...');
    await page.fill(EMAIL_INPUT_SELECTOR, MINEFORT_EMAIL);
    await page.fill(PASSWORD_INPUT_SELECTOR, MINEFORT_PASSWORD);

    console.log('Clicking Sign In button...');
    // Now the click should not be intercepted by the cookie dialog
    await page.click(SIGN_IN_BUTTON_SELECTOR);

    console.log(`Waiting for navigation to servers page: ${SERVERS_URL}`);
    // Use waitUntil 'domcontentloaded' or 'networkidle' for robustness
    await page.waitForURL(SERVERS_URL, { waitUntil: 'domcontentloaded' });
    console.log('Successfully navigated to servers page.');

    console.log(`Looking for server card for "${MINEFORT_SERVER_NAME}"...`);
    // Find the specific server card element
    const serverCard = await page.locator(SERVER_CARD_SELECTOR).first();

    if (await serverCard.count() === 0) {
        console.error(`Error: Could not find server card for "${MINEFORT_SERVER_NAME}". Make sure the server name is correct ("${MINEFORT_SERVER_NAME}") and visible on the dashboard.`);
        // Attempt to take a screenshot for debugging if the server card isn't found
        await page.screenshot({ path: 'server_card_not_found_error.png' });
        console.log('Screenshot saved as server_card_not_found_error.png');
        process.exit(1);
    }
    console.log(`Found server card for "${MINEFORT_SERVER_NAME}".`);

    // Check if the server is sleeping (Wake up button is visible)
    const wakeUpButton = serverCard.locator(WAKE_UP_BUTTON_SELECTOR);
    if (await wakeUpButton.isVisible({ timeout: 5000 })) { // Check visibility with a short timeout
        console.log('Server is sleeping. Clicking "Wake up" button...');
        await wakeUpButton.click();
        console.log('Clicked "Wake up". Waiting 10 seconds for state change...');
        await page.waitForTimeout(10000); // Wait 10 seconds after clicking Wake up
        console.log('Finished waiting after Wake up.');
    } else {
        console.log('"Wake up" button not visible. Assuming server is not sleeping.');
    }


    // Now look for the "Start server" button (it appears after waking up or if already awake)
    const startServerButton = serverCard.locator(START_SERVER_BUTTON_SELECTOR);

    console.log('Looking for "Start server" button...');
     // Wait for the start button to become visible, up to a certain timeout
    await startServerButton.waitFor({ state: 'visible', timeout: 60000 }); // Wait up to 60 seconds for Start button

    console.log('Clicking "Start server" button...');
    await startServerButton.click();
    console.log('Clicked "Start server".');

    // Add a final wait to allow the server to fully start before the script exits
    const finalServerStartWait = 3 * 60 * 1000; // 3 minutes
    console.log(`Clicked Start. Waiting ${finalServerStartWait / 1000} seconds for server to fully start...`);
    await page.waitForTimeout(finalServerStartWait);
    console.log('Finished waiting. Assuming server is started.');


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
