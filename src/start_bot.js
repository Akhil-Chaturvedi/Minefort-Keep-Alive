const mineflayer = require('mineflayer');
const { setTimeout } = require('timers/promises');

const serverName = process.env.MINEFORT_SERVER_NAME; // e.g., 'ForAboniii'
// const targetServerHost = `${serverName}.minefort.com`; // No longer the initial connect host
const targetServerHost = `${serverName}.minefort.com`; // Still need this to detect joining the target server later
const targetServerPort = 25565; // Standard Minecraft Java port
const lobbyHost = 'play.minefort.com'; // Explicitly connect to the lobby first
const botUsername = "AutomationBot"; // Choose a static username for the offline mode bot

if (!serverName) {
    console.error('Error: MINEFORT_SERVER_NAME environment variable must be set.');
    process.exit(1);
}

console.log(`Attempting to connect to Minefort lobby (${lobbyHost}:${targetServerPort}) as offline player "${botUsername}"...`);

const bot = mineflayer.createBot({
  host: lobbyHost, // --- Connect to lobby host first ---
  port: targetServerPort, // Use the standard Minecraft port
  username: botUsername,
  offline: true, // --- Use offline mode ---
  version: false // Let mineflayer detect the version
});

let inLobby = false; // Track if bot is currently in the lobby
let startCommandSent = false; // Track if the start command has been sent
let targetServerJoined = false; // Track if bot has successfully joined the target server world


bot.on('login', () => {
  console.log(`Bot logged into ${bot.options.host}:${bot.options.port} as ${bot.username}.`);
  // 'login' fires when the initial connection to the host in createBot succeeds.
  // For play.minefort.com, this should succeed if the lobby is online.
});

bot.on('spawn', async () => {
    console.log('Bot spawned.');
    // Check the bot's current server information after spawning.
    // mineflayer might update bot.currentServer after teleport/transfer.
    const currentServer = bot.currentServer;
    const currentHost = currentServer ? currentServer.host : 'Unknown';
    const currentPort = currentServer ? currentServer.port : 'Unknown';
    console.log(`Bot reports current server: ${currentHost}:${currentPort}`);

    if (!inLobby && currentHost === lobbyHost) {
        // Initial spawn in the lobby
        inLobby = true;
        console.log(`Bot confirmed in the lobby (${lobbyHost}).`);

        // Wait a moment, then send the start command if not already sent
        if (!startCommandSent) {
            startCommandSent = true;
            await setTimeout(5000); // Wait 5 seconds
            console.log(`Sending start command: /start ${serverName}`);
            bot.chat(`/start ${serverName}`);
            console.log(`Command sent. Waiting to be transferred to ${targetServerHost}:${targetServerPort}...`);

            // The 'spawn' event should fire again when the bot is transferred to the target server.
            // The logic below handles that subsequent 'spawn'.
        }


    } else if (inLobby && currentHost === targetServerHost && currentPort === targetServerPort) {
        // Subsequent spawn event, indicates successful transfer to the target server
        if (!targetServerJoined) { // Ensure this logic runs only once upon first joining the target server
            targetServerJoined = true;
            console.log(`Successfully joined target server: ${targetServerHost}:${targetServerPort}`);

            // Keep the bot connected for 5 minutes to simulate activity
            const activityDuration = 5 * 60 * 1000; // 5 minutes in milliseconds
            console.log(`Keeping bot connected for ${activityDuration / 1000} seconds on the target server...`);

            await setTimeout(activityDuration);
            console.log('Activity time finished on target server. Disconnecting bot.');
            bot.quit();
            console.log('Bot disconnected.');
            process.exit(0); // Exit successfully ONLY after joining target server and idling
        }
    } else if (currentHost === targetServerHost && currentPort === targetServerPort) {
        // Edge case: Bot might connect directly to target server if it was already online?
        // Handle this as successfully joined immediately.
         if (!targetServerJoined) {
            targetServerJoined = true;
            console.log(`Bot connected directly to target server: ${targetServerHost}:${targetServerPort}`);
             // Proceed with idling and exit like above
            const activityDuration = 5 * 60 * 1000;
            console.log(`Keeping bot connected for ${activityDuration / 1000} seconds on the target server...`);
            await setTimeout(activityDuration);
            console.log('Activity time finished. Disconnecting bot.');
            bot.quit();
            process.exit(0);
         }
    }
    // If spawn happens in other unexpected scenarios, just log and the overall timeout will handle it.
    console.log("Bot spawned in an unexpected state or server. Waiting for timeout or kick.");
});


bot.on('kicked', (reason, loggedIn) => {
  console.error(`Bot kicked. Reason: ${reason} LoggedIn: ${loggedIn}`);
  process.exit(1); // Exit with error code on kick
});

bot.on('error', (err) => {
  console.error(`Bot error: ${err.message}`);
  // Check for specific errors
  if (err.message.includes('Invalid credentials')) {
      console.error("Authentication failed. Ensure server is in offline mode and bot username is valid ('AutomationBot').");
  } else if (err.message.includes('connect ECONNREFUSED')) {
      console.error("Connection refused. Is the lobby address play.minefort.com correct? Is port 25565 open?");
  } else if (err.message.includes('unsupported/unknown protocol version')) {
       console.error("Protocol version error during handshake. This might happen if connecting to the wrong address or a non-Minecraft service.");
  }
  process.exit(1); // Exit with error code on error
});

bot.on('end', (reason) => {
    console.log(`Bot disconnected from server. Reason: ${reason}`);
    if (!targetServerJoined) {
        // If the bot disconnected before joining the target server, it's a failure
        console.error("Bot disconnected before successfully joining the target server.");
        process.exit(1);
    }
    // If it disconnected *after* successfully joining and finishing its activity,
    // the process.exit(0) would have already run.
});


console.log('Mineflayer bot script started.');

// Set an overall timeout for the bot script in case something unexpected hangs
// Includes time for lobby join, command send, server start, transfer, and idling.
const overallTimeout = 7 * 60 * 1000; // e.g., 7 minutes total timeout
console.log(`Setting overall bot script timeout to ${overallTimeout / 1000} seconds.`);
setTimeout(overallTimeout)
  .then(() => {
      if (!targetServerJoined) {
          console.error(`Overall timeout reached: Bot script did not confirm joining target server within ${overallTimeout / 1000} seconds.`);
          bot.quit();
          process.exit(1);
      }
  })
  .catch(err => {
      console.error(`Error with overall timeout: ${err.message}`);
      bot.quit();
      process.exit(1);
  });
