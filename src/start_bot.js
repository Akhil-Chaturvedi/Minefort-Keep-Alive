const mineflayer = require('mineflayer');

const email = process.env.MINEFORT_EMAIL;
const password = process.env.MINEFORT_PASSWORD;
const serverName = process.env.MINEFORT_SERVER_NAME;
const minefortHost = 'minefort.com'; // Minefort lobby server

if (!email || !password || !serverName) {
    console.error('Error: MINEFORT_EMAIL, MINEFORT_PASSWORD, and MINEFORT_SERVER_NAME environment variables must be set.');
    process.exit(1);
}

console.log(`Attempting to connect to Minefort lobby as ${email}...`);

const bot = mineflayer.createBot({
  host: minefortHost,
  auth: 'microsoft', // Assuming your Minefort account uses Microsoft login
  username: email,
  password: password,
  // If Minefort supports cracked/offline mode, you might not need password and can use offline: true
  // offline: true, // Uncomment if using cracked/offline mode support
  version: false // Let mineflayer detect the version
});

bot.on('login', () => {
  console.log(`Logged into Minefort lobby as ${bot.username}`);

  // Wait a moment for the bot to fully spawn
  setTimeout(() => {
    console.log(`Sending start command: /start ${serverName}`);
    bot.chat(`/start ${serverName}`);

    // Keep the bot connected for 5 minutes to simulate activity
    const activityDuration = 5 * 60 * 1000; // 5 minutes in milliseconds
    console.log(`Keeping bot connected for ${activityDuration / 1000} seconds...`);

    setTimeout(() => {
      console.log('Activity time finished. Disconnecting bot.');
      bot.quit();
      console.log('Bot disconnected.');
      process.exit(0); // Exit successfully
    }, activityDuration);

  }, 5000); // Wait 5 seconds after login before sending command
});

bot.on('spawn', () => {
    console.log('Bot spawned in the lobby.');
    // The chat command is sent after a timeout from the 'login' event
    // The bot should ideally be teleported to the server after it starts
});

bot.on('kicked', (reason, loggedIn) => {
  console.error(`Bot kicked. Reason: ${reason} LoggedIn: ${loggedIn}`);
  process.exit(1); // Exit with error code
});

bot.on('error', (err) => {
  console.error(`Bot error: ${err.message}`);
  process.exit(1); // Exit with error code
});

console.log('Mineflayer bot script started.');
