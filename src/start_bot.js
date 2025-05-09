const mineflayer = require('mineflayer');
const { setTimeout } = require('timers/promises');

const serverName = process.env.MINEFORT_SERVER_NAME; // e.g., 'ForAboniii'
// We no longer strictly need targetServerHost/Port for bot logic,
// but keep serverName for the /start command.
const lobbyHost = 'play.minefort.com';
const targetServerPort = 25565; // Standard Minecraft Java port for connection
const botUsername = "AutomationBot"; // Choose a static username for the offline mode bot

if (!serverName) {
    console.error('Error: MINEFORT_SERVER_NAME environment variable must be set.');
    process.exit(1);
}

console.log(`Attempting to connect to Minefort lobby (${lobbyHost}:${targetServerPort}) as offline player "${botUsername}"...`);

const bot = mineflayer.createBot({
  host: lobbyHost, // Connect to lobby host
  port: targetServerPort, // Use the standard Minecraft port
  username: botUsername,
  offline: true, // Use offline mode
  version: false // Let mineflayer detect the version
});

let startCommandSent = false;

bot.on('login', () => {
  console.log(`Bot logged into ${bot.options.host}:${bot.options.port} as ${bot.username}.`);
});

bot.on('spawn', async () => {
    console.log('Bot spawned in the lobby.');

    if (!startCommandSent) {
        startCommandSent = true;
        await setTimeout(5000); // Wait 5 seconds after spawn before sending command
        console.log(`Sending start command: /start ${serverName}`);
        bot.chat(`/start ${serverName}`);
        console.log(`Start command sent. Waiting 3 minutes for server to start before exiting...`);

        // --- FIXED WAIT TIME AFTER SENDING COMMAND ---
        const fixedWaitAfterCommand = 3 * 60 * 1000; // 3 minutes in milliseconds
        await setTimeout(fixedWaitAfterCommand);
        console.log('Fixed wait time finished. Assuming server has had time to start. Disconnecting bot.');
        bot.quit();
        console.log('Bot disconnected.');
        process.exit(0); // Exit successfully after waiting
        // --- END FIXED WAIT TIME ---
    }
    // If spawn fires again (e.g., after transfer), and command was already sent,
    // the fixed timeout is already running, just log it.
     console.log("Spawn event fired again after command sent. Fixed timeout is active.");

});

// Basic error handlers to prevent hanging and provide info
bot.on('kicked', (reason, loggedIn) => {
  console.error(`Bot kicked. Reason: ${reason} LoggedIn: ${loggedIn}`);
  process.exit(1); // Any kick is a failure in this simplified flow
});

bot.on('error', (err) => {
  console.error(`Bot error: ${err.message}`);
  // Log common error types
  if (err.message.includes('Invalid credentials')) {
      console.error("Authentication failed. Ensure server is in offline mode and bot username is valid ('AutomationBot').");
  } else if (err.message.includes('connect ECONNREFUSED')) {
      console.error("Connection refused. Is the lobby address play.minefort.com correct? Is port 25565 open?");
  } else if (err.message.includes('unsupported/unknown protocol version')) {
       console.error("Protocol version error during handshake. This might happen if connecting to the wrong address or a non-Minecraft service.");
  } else if (err.message.includes('ETIMEDOUT')) {
       console.error("Connection timed out.");
  } else {
       console.error("An unhandled bot error occurred.");
  }
  process.exit(1); // Any error is a failure
});

bot.on('end', (reason) => {
    console.log(`Bot disconnected from server. Reason: ${reason}`);
    // In this simplified flow, we only exit 0 after the fixed wait.
    // If 'end' happens before that, it's a failure.
    console.error("Bot disconnected unexpectedly before completing its task.");
    process.exit(1);
});


console.log('Mineflayer bot script started.');

// Set an overall timeout for the entire bot script execution
// This should be longer than the fixed wait time (3 mins + 5s spawn delay)
const overallTimeout = 5 * 60 * 1000; // 5 minutes overall timeout (e.g., 3 mins wait + buffer)
console.log(`Setting overall bot script timeout to ${overallTimeout / 1000} seconds.`);
const timeoutId = setTimeout(overallTimeout, null, { ref: false }) // Use reference-less timer
  .then(() => {
      // This part only runs if the script hasn't already exited (e.g. due to success or error)
      console.error(`Overall timeout reached: Bot script did not complete within ${overallTimeout / 1000} seconds.`);
      bot.quit(); // Ensure bot is disconnected
      process.exit(1); // Exit with error code
  });
