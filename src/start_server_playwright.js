const { chromium } = require('@playwright/test');

// Get credentials and server ID (using FTP_USERNAME as ID) from environment variables (GitHub Secrets)
const MINEFORT_EMAIL = process.env.MINEFORT_EMAIL;
const MINEFORT_PASSWORD = process.env.MINEFORT_PASSWORD;
const FTP_USERNAME = process.env.FTP_USERNAME; // Using FTP_USERNAME as the server ID

// --- Selectors based on the HTML you provided ---
const LOGIN_URL = 'https://minefort.com/login';

// Use the server ID to construct the direct URL
const SERVER_DASHBOARD_URL = `https://minefort.com/servers/${FTP_USERNAME}`;

const SELECTORS = {
  cookieDialog: '#CybotCookiebotDialog',
  cookieDeny: '#CybotCookiebotDialogBodyButtonDecline',
  email: 'input#email', // Or '#email'
  password: 'input#password', // This one was already correct based on previous HTML
  signIn: 'button:has-text("Sign In")',

  // Selectors for buttons *on the individual server dashboard page*
  // Using text content for robustness, assuming the text is unique enough
  wakeUp: 'button:has-text("Wake up server")',
  startServer: 'button:has-text("Start server")'
};


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
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Handle cookie popup
    console.log('Checking for cookie consent dialog...');
    const cookieDialog = page.locator(SELECTORS.cookieDialog);
    // Use a slightly longer timeout here in case the dialog takes a moment to appear
    if (await cookieDialog.isVisible({ timeout: 15000 }).catch(() => false)) {
        console.log('Cookie consent dialog found.');
        const denyButton = page.locator(SELECTORS.cookieDeny);
        if (await denyButton.isVisible({ timeout: 5000 }).catch(() => false)) {
            console.log('Clicking "Deny" on cookie dialog...');
            await denyButton.click();
            console.log('Cookie dialog dismissed.');
            // Wait for the dialog to disappear, but don't fail if it doesn't immediately
            await cookieDialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
        } else {
            console.warn('Cookie dialog visible, but "Deny" button not found. Proceeding anyway.');
        }
    } else {
        console.log('Cookie consent dialog not found or did not appear.');
    }


    // Wait for email and password input to be attached to the DOM
    console.log('Waiting specifically for email and password inputs...');
    await page.waitForSelector(SELECTORS.email, { state: 'attached', timeout: 30000 });
    await page.waitForSelector(SELECTORS.password, { state: 'attached', timeout: 30000 });

    console.log('Filling in email and password...');
    await page.fill(SELECTORS.email, MINEFORT_EMAIL);
    await page.fill(SELECTORS.password, MINEFORT_PASSWORD);

    // --- ADDED: Small wait before clicking Sign In ---
    console.log('Waiting briefly before clicking Sign In...');
    await page.waitForTimeout(2000); // Wait 2 seconds - increased slightly
    // --- END ADDED ---

    console.log('Clicking Sign In...');
    // Wait for navigation away from the login page
    await Promise.all([
      // CORRECTED: Wait for ANY URL change, not specifically away from /login
      // This handles cases where it might redirect to an error page or similar
      page.waitForURL(url => url.toString() !== LOGIN_URL, { timeout: 30000 }),
      page.click(SELECTORS.signIn)
    ]);

    console.log(`Login successful. Current URL: ${page.url()}`);

    // --- Navigate directly to the server dashboard using the ID ---
    console.log(`Navigating directly to server dashboard: ${SERVER_DASHBOARD_URL}`);
    await page.goto(SERVER_DASHBOARD_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('Navigated to server dashboard.');
    // --- End Direct Navigation ---


    // Wait for the page content to load, specifically looking for one of the buttons
    console.log('Waiting for server control buttons...');
    await page.waitForSelector(`${SELECTORS.wakeUp}, ${SELECTORS.startServer}`, { timeout: 30000 });
    console.log('Server dashboard buttons found.');


    // Check if the server is sleeping (Wake up server button is visible)
    const wakeUpButton = page.locator(SELECTORS.wakeUp);
    if (await wakeUpButton.isVisible({ timeout: 5000 }).catch(() => false)) { // Check visibility with a short timeout
        console.log('Server is sleeping. Clicking "Wake up server" button...');
        await wakeUpButton.click();
        console.log('Clicked "Wake up server". Waiting 10 seconds for state change...');
        await page.waitForTimeout(10000); // Wait 10 seconds after clicking Wake up
        console.log('Finished waiting after Wake up.');
    } else {
        console.log('"Wake up server" button not visible. Assuming server is not sleeping or in a different state.');
    }


    // Now look for the "Start server" button
    const startServerButton = page.locator(SELECTORS.startServer);

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

  } catch (err) {
    console.error('Error during automation:', err);
    // Attempt to take a screenshot on any error for debugging
    try {
        await page.screenshot({ path: 'playwright_error.png' });
        console.log('Saved error screenshot: playwright_error.png');
    } catch (screenshotError) {
        console.error('Could not take screenshot:', screenshotError);
    }
    if (browser) {
      await browser.close();
    }
    process.exit(1); // Exit with error code
  }
})();
