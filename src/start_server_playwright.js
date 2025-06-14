const { chromium } = require('@playwright/test');
const path = require('path'); // Import path module for joining paths

// Get credentials and server ID (using FTP_USERNAME as ID) from environment variables (GitHub Secrets)
const MINEFORT_EMAIL = process.env.MINEFORT_EMAIL;
const MINEFORT_PASSWORD = process.env.MINEFORT_PASSWORD;
const FTP_USERNAME = process.env.FTP_USERNAME; // Using FTP_USERNAME as the server ID

// --- URLs ---
const LOGIN_URL = 'https://minefort.com/login';
const SERVER_DASHBOARD_URL = `https://minefort.com/servers/${FTP_USERNAME}`;
// Construct the specific backups URL using the server ID
const SERVER_BACKUPS_URL = `https://minefort.com/servers/${FTP_USERNAME}/backups`;


// --- Selectors ---
const SELECTORS = {
  cookieDialog: '#CybotCookiebotDialog',
  cookieDeny: '#CybotCookiebotDialogBodyButtonDecline',
  email: 'input#email',
  password: 'input#password',
  signIn: 'button:has-text("Sign In")', // Keep this selector for explicit click
  wakeUp: 'button:has-text("Wake up server")',
  startServer: 'button:has-text("Start server")',

  // --- Backup Page Selectors ---
  // Selector for the 'Create backup' button based on the provided HTML and recording
  createBackupButton: 'button:has-text("Create backup")', // Recording also suggests 'aria/Create backup' and 'text/Create backup' which this covers
  // Refined Selector for the download SVG icon based on recording output
  downloadBackupIcon: 'td.flex > svg:nth-of-type(1)', // Recording suggests 'td.flex > svg:nth-of-type(1)'
  // Refined Selector for the delete SVG icon based on recording output and HTML
  deleteBackupIcon: 'td.flex > svg:nth-of-type(3)', // Recording suggests 'svg:nth-of-type(3)' within td.flex

  // Selector for the delete confirmation button based on provided HTML and recording
  confirmDeleteButton: 'button:has-text("Confirm")', // Recording also suggests 'aria/Confirm' and 'text/Confirm' which this covers


  // Selector for a loading spinner or status text after creating backup
  // You might need to adjust these based on actual UI elements
  backupCreationLoading: 'div:has-text("Creating backup...")', // Placeholder
  backupCreationSuccess: 'div:has-text("Backup created successfully")', // Placeholder
  // Selector for a single backup entry row - Added for potential future use or context
  backupEntry: 'tbody.divide-y.divide-minefort-800 tr',
};

// IMPORTANT: Update this selector if you find a specific error message on playwright_error.png
const LOGIN_ERROR_SELECTOR = 'div[class*="text-red-500"], p[role="alert"], .login-error-message, .error-message';

(async () => {
  if (!MINEFORT_EMAIL || !MINEFORT_PASSWORD || !FTP_USERNAME) {
    console.error('Missing required environment variables. Make sure MINEFORT_EMAIL, MINEFORT_PASSWORD, and FTP_USERNAME secrets are set.');
    process.exit(1);
  }

  console.log('Launching headless browser...');
  // Set up a download directory for Playwright
  const downloadDir = path.join(__dirname, '..', 'temp_downloads'); // Save downloads to a temp_downloads folder relative to script
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
      acceptDownloads: true, // Enable download handling
      downloadsPath: downloadDir // Set the download directory
  });
  const page = await context.newPage();


  try {
    console.log(`Navigating to login: ${LOGIN_URL}`);
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

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
                console.warn(`Escape key did not hide the cookie dialog: ${error.name} - ${error.message}. Attempting to proceed.`);
            }
        } else {
            console.warn(`Warning during cookie dialog handling: ${error.name} - ${error.message}. Attempting to proceed.`);
        }
    }

    console.log('Waiting specifically for email and password inputs...');
    await page.waitForSelector(SELECTORS.email, { state: 'attached', timeout: 45000 });
    await page.waitForSelector(SELECTORS.password, { state: 'attached', timeout: 45000 });

    console.log('Filling in email and password...');
    await page.fill(SELECTORS.email, MINEFORT_EMAIL);
    await page.fill(SELECTORS.password, MINEFORT_PASSWORD);

    console.log('Attempting to log in by pressing Enter in the password field...');
    await page.locator(SELECTORS.password).press('Enter');

    await page.waitForTimeout(1500); // Give a moment for navigation to potentially start

    const signInButton = page.locator(SELECTORS.signIn);

    if (await signInButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log('"Sign In" button is still visible after pressing Enter. Clicking the button...');
        await signInButton.click();
        console.log('Clicked "Sign In" button.');
    } else {
        console.log('"Sign In" button is not visible after pressing Enter. Assuming navigation started.');
    }

    console.log('Waiting for URL to change away from login page after login attempt...');
    let currentUrlAfterLoginAttempt = page.url();
    try {
        await page.waitForURL((url) => !url.href.startsWith(LOGIN_URL), { timeout: 60000 });
        currentUrlAfterLoginAttempt = page.url();
        console.log(`Successfully navigated away from login page. Current URL is: ${currentUrlAfterLoginAttempt}`);

    } catch (urlError) {
        currentUrlAfterLoginAttempt = page.url();
        console.error(`Timeout waiting for URL to change away from login page. Current URL: ${currentUrlAfterLoginAttempt}`);

        if (currentUrlAfterLoginAttempt.startsWith(LOGIN_URL)) {
             const loginErrorElement = page.locator(LOGIN_ERROR_SELECTOR).first();
             let loginErrorText = "No specific error message found on page (after waiting for URL change).";
              if (await loginErrorElement.isVisible({timeout: 3000}).catch(() => false)) {
                 loginErrorText = await loginErrorElement.textContent({timeout:2000}) || "Error message element found but was empty.";
             }
             throw new Error(`Login failed: Remained on login page after attempt. Page might have shown an error: "${loginErrorText}". URL after login attempt: ${currentUrlAfterLoginAttempt}. Original wait error: ${urlError.message}`);
        } else {
             console.warn(`Timeout waiting for URL to change away from login page, but page is no longer login page. Current URL: ${currentUrlAfterLoginAttempt}. Proceeding.`);
        }
    }

    // Navigate to the specific server dashboard if not already there.
    console.log(`Checking current page after login attempt: ${currentUrlAfterLoginAttempt}`);
    if (!currentUrlAfterLoginAttempt.startsWith(SERVER_DASHBOARD_URL)) {
        console.log(`Current URL is not the specific server dashboard. Navigating to: ${SERVER_DASHBOARD_URL}`);
        await page.goto(SERVER_DASHBOARD_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
        console.log('Navigated to server dashboard.');
    } else {
        console.log('Already on the specific server dashboard or a subpage of it.');
    }


    console.log('Waiting for server control buttons...');
    await page.waitForSelector(`${SELECTORS.wakeUp}, ${SELECTORS.startServer}`, { timeout: 60000 });
    console.log('Server dashboard buttons found.');

    const wakeUpButton = page.locator(SELECTORS.wakeUp);
    if (await wakeUpButton.isVisible({ timeout: 15000 }).catch(() => false)) {
      console.log('Server is sleeping. Clicking "Wake up server" button...');
      await wakeUpButton.click();
      console.log('Clicked "Wake up server". Waiting for state change...');
      // Wait for the wake up button to disappear or the start button to appear
      await wakeUpButton.waitFor({ state: 'hidden', timeout: 180000 }); // Increased wait for wake up
      console.log('Wake up button is hidden.');
    } else {
      console.log('"Wake up server" button not visible. Assuming server is not sleeping or in a different state.');
    }

    const startServerButton = page.locator(SELECTORS.startServer);
    console.log('Looking for "Start server" button...');
    // Wait for the start button to be visible, indicating the server is ready to be started
    await startServerButton.waitFor({ state: 'visible', timeout: 180000 }); // 3 minutes

    console.log('Clicking "Start server" button...');
    await startServerButton.click();
    console.log('Clicked "Start server".');

    console.log('Playwright script finished successfully.');
    await browser.close();
    // Exit with 0 to indicate success, the next step will handle the file
    process.exit(0);


  } catch (err) {
    console.error('Error during automation:', err.message);
    console.error('Full error object for debugging:', err);
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
    // Exit with 1 to indicate failure
    process.exit(1);
  }
})();
