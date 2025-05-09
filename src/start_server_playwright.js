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

    console.log('Filling login form...');
    await page.fill(EMAIL_INPUT_SELECTOR, MINEFORT_EMAIL);
    await page.fill(PASSWORD_INPUT_SELECTOR, MINEFORT_PASSWORD);

    console.log('Clicking Sign In button...');
    await page.click(SIGN_IN_BUTTON_SELECTOR);

    console.log(`Waiting for navigation to servers page: ${SERVERS_URL}`);
    // Use waitUntil 'domcontentloaded' or 'networkidle' for robustness
    await page.waitForURL(SERVERS_URL, { waitUntil: 'domcontentloaded' });
    console.log('Successfully navigated to servers page.');

    console.log(`Looking for server card for "${MINEFORT_SERVER_NAME}"...`);
    // Find the specific server card element
    const serverCard = await page.locator(SERVER_CARD_SELECTOR).first();

    if (await serverCard.count() === 0) {
        console.error(`Error: Could not find server card for "${MINEFORT_SERVER_NAME}". Make sure the server name is correct and visible on the dashboard.`);
        process.exit(1);
    }
    console.log(`Found server card for "${MINEFORT_SERVER_NAME}".`);

    // Check if the server is sleeping (Wake up button is visible)
    const wakeUpButton = serverCard.locator(WAKE_UP_BUTTON_SELECTOR);
    if (await wakeUpButton.isVisible()) {
        console.log('Server is sleeping. Clicking "Wake up" button...');
        await wakeUpButton.click();
        console.log('Clicked "Wake up". Waiting 10 seconds...');
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
    console.log(`Waiting ${finalServerStartWait / 1000} seconds for server to fully start...`);
    await page.waitForTimeout(finalServerStartWait);
    console.log('Finished waiting. Assuming server is started.');


    console.log('Playwright script finished successfully.');
    await browser.close();
    process.exit(0); // Exit successfully

  } catch (error) {
    console.error('Playwright script failed:', error);
    if (browser) {
      await browser.close();
    }
    process.exit(1); // Exit with error code
  }
})();
