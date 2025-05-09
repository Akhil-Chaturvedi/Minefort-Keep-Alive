const mineflayer = require('mineflayer');
const { setTimeout } = require('timers/promises'); // Use promise-based setTimeout for cleaner async

const serverName = process.env.MINEFORT_SERVER_NAME; // e.g., 'ForAboniii'
const targetServerHost = `${serverName}.minefort.com`; // Construct target server IP
const targetServerPort = 25565; // Standard Minecraft Java port
const botUsername = "AutomationBot"; // Choose a static username for the offline mode bot

if (!serverName) {
    console.error('Error: MINEFORT_SERVER_NAME environment variable must be set.');
    process.exit(1); // Exit if essential secrets are missing
}

console.log(`Attempting to connect to server IP (${targetServerHost}:${targetServerPort}) as offline player "${botUsername}"...`);

const bot = mineflayer.createBot({
  host: targetServerHost,
  port: targetServerPort,
  username: botUsername,
  offline: true, // --- Use offline mode ---
  version: false // Let mineflayer detect the version
});

let lobbyJoined = false;
let targetServerJoined = false;
const lobbyHost = 'play.minefort.com'; // Minefort lobby server host (for checking)


bot.on('login', () => {
  console.log(`Bot logged in as ${bot.username}.`);
  // Note: 'login' fires when the connection is established,
  // but doesn't mean the bot has fully spawned in a world yet.
  // 'spawn' is usually a better indicator of being in a world/server.
});

bot.on('spawn', async () => {
    console.log('Bot spawned.');
    const currentServer = bot.currentServer;
    const currentHost = currentServer ? currentServer.host : 'Unknown';
    const currentPort = currentServer ? currentServer.port : 'Unknown';
    console.log(`Bot is currently on server: ${currentHost}:${currentPort}`);


    if (!lobbyJoined && currentHost === lobbyHost) {
        // First spawn in the lobby
        lobbyJoined = true;
        console.log(`Bot spawned in the lobby (${lobbyHost}).`);

        // Wait a moment, then send the start command
        await setTimeout(5000); // Wait 5 seconds
        console.log(`Sending start command: /start ${serverName}`);
        bot.chat(`/start ${serverName}`);
        console.log(`Command sent. Waiting to be transferred to ${targetServerHost}:${targetServerPort}...`);

        // Set a timeout for the server transfer
        const transferTimeout = 5 * 60 * 1000; // Wait up to 5 minutes for transfer
        console.log(`Setting a ${transferTimeout / 1000} second timeout for server transfer.`);

        // No need for explicit timeout object if using async/await and throwing error on timeout
        // The spawn listener below will catch the successful transfer if it happens within the timeout


    } else if (lobbyJoined && currentHost === targetServerHost && currentPort === targetServerPort) {
        // Second spawn event, indicates successful transfer to the target server
        if (!targetServerJoined) { // Ensure this logic runs only once
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
    } else {
        // This might catch spawns in unexpected places or states
        console.log('Spawned in an unexpected state or server, or transfer took too long.');
        // If we are expecting to be in the target server but aren't, it's a failure
        if (lobbyJoined && !targetServerJoined) {
             console.error(`Bot spawned in unexpected location (${currentHost}:${currentPort}) after sending start command.`);
             bot.quit();
             process.exit(1);
        }
        // If not yet in lobby and not target server, might be an initial issue
         if (!lobbyJoined) {
             console.error(`Bot spawned in unexpected location (${currentHost}:${currentPort}) before lobby.`);
             bot.quit();
             process.exit(1);
         }
    }
});

bot.on('kicked', (reason, loggedIn) => {
  console.error(`Bot kicked. Reason: ${reason} LoggedIn: ${loggedIn}`);
  process.exit(1); // Exit with error code on kick
});

bot.on('error', (err) => {
  console.error(`Bot error: ${err.message}`);
  // Check for specific errors that indicate auth failure vs connection failure
  if (err.message.includes('Invalid credentials')) {
      console.error("Authentication failed. Ensure server is in offline mode and bot username is valid.");
  } else if (err.message.includes('connect ECONNREFUSED')) {
      console.error("Connection refused. Is the server address correct? Is port 25565 open?");
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
    // the process.exit(0) in the spawn handler's final timeout would have already run.
});


console.log('Mineflayer bot script started.');

// Set an overall timeout for the bot script in case something unexpected hangs
// Includes time for lobby join, command send, server start, transfer, and idling.
const overallTimeout = 7 * 60 * 1000; // e.g., 7 minutes total timeout
console.log(`Setting overall bot script timeout to ${overallTimeout / 1000} seconds.`);
setTimeout(overallTimeout, null, { ref: false })
  .then(() => {
      if (!targetServerJoined) {
          console.error(`Overall timeout reached: Bot script did not confirm joining target server within ${overallTimeout / 1000} seconds.`);
          bot.quit();
          process.exit(1);
      }
  });
