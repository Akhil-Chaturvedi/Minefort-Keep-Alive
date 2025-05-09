const mineflayer = require('mineflayer');
const { setTimeout } = require('timers/promises');

const serverName = process.env.MINEFORT_SERVER_NAME; // e.g., 'ForAboniii'
const targetServerHost = `${serverName}.minefort.com`;
const targetServerPort = 25565;
const lobbyHost = 'play.minefort.com';
const botUsername = "AutomationBot";

if (!serverName) {
    console.error('Error: MINEFORT_SERVER_NAME environment variable must be set.');
    process.exit(1);
}

console.log(`Attempting to connect to Minefort lobby (${lobbyHost}:${targetServerPort}) as offline player "${botUsername}"...`);

const bot = mineflayer.createBot({
  host: lobbyHost,
  port: targetServerPort,
  username: botUsername,
  offline: true,
  version: false
});

let inLobby = false;
let startCommandSent = false;
let targetServerJoined = false;


bot.on('login', () => {
  console.log(`Bot logged into ${bot.options.host}:${bot.options.port} as ${bot.username}.`);
});

bot.on('spawn', async () => {
    console.log('Bot spawned. Introducing small delay before checking server info...');
    // *** ADDED DELAY HERE ***
    await setTimeout(1000); // Wait 1 second - adjust if needed

    console.log(`Checking bot.currentServer after delay: ${bot.currentServer}`); // *** ADDED LOGGING ***

    const currentServer = bot.currentServer;

    // *** ADDED CHECK FOR currentServer BEING UNDEFINED AFTER DELAY ***
    if (!currentServer) {
        console.error("Error: bot.currentServer is still undefined after spawn delay. Cannot determine current server.");
        // Decide how to handle this - maybe it's a fatal error for this flow?
        // For now, let's log and rely on the overall timeout to prevent hanging.
        return; // Exit the spawn handler for this time
    }


    const currentHost = currentServer.host; // This is line 32 - should be safe now if currentServer is not undefined
    const currentPort = currentServer.port;
    console.log(`Bot reports current server: ${currentHost}:${currentPort}`);


    if (!inLobby && currentHost === lobbyHost) {
        // Initial spawn in the lobby
        inLobby = true;
        console.log(`Bot confirmed in the lobby (${lobbyHost}).`);

        if (!startCommandSent) {
            startCommandSent = true;
            await setTimeout(5000); // Wait 5 seconds before sending command
            console.log(`Sending start command: /start ${serverName}`);
            bot.chat(`/start ${serverName}`);
            console.log(`Command sent. Waiting to be transferred to ${targetServerHost}:${targetServerPort}...`);
        }


    } else if (inLobby && currentHost === targetServerHost && currentPort === targetServerPort) {
        // Subsequent spawn event, indicates successful transfer to the target server
        if (!targetServerJoined) {
            targetServerJoined = true;
            console.log(`Successfully joined target server: ${targetServerHost}:${targetServerPort}`);

            const activityDuration = 5 * 60 * 1000;
            console.log(`Keeping bot connected for ${activityDuration / 1000} seconds on the target server...`);

            await setTimeout(activityDuration);
            console.log('Activity time finished on target server. Disconnecting bot.');
            bot.quit();
            console.log('Bot disconnected.');
            process.exit(0); // Exit successfully ONLY after joining target server and idling
        }
    } else if (currentHost === targetServerHost && currentPort === targetServerPort) {
        // Edge case: Bot might connect directly to target server if it was already online?
         if (!targetServerJoined) {
            targetServerJoined = true;
            console.log(`Bot connected directly to target server: ${targetServerHost}:${targetServerPort}`);
            const activityDuration = 5 * 60 * 1000;
            console.log(`Keeping bot connected for ${activityDuration / 1000} seconds on the target server...`);
            await setTimeout(activityDuration);
            console.log('Activity time finished. Disconnecting bot.');
            bot.quit();
            process.exit(0);
         }
    }
    // If spawn happens in other unexpected scenarios
    console.log("Bot spawned in an unexpected state or server. Waiting for timeout or kick.");
});


bot.on('kicked', (reason, loggedIn) => {
  console.error(`Bot kicked. Reason: ${reason} LoggedIn: ${loggedIn}`);
  process.exit(1);
});

bot.on('error', (err) => {
  console.error(`Bot error: ${err.message}`);
  if (err.message.includes('Invalid credentials')) {
      console.error("Authentication failed. Ensure server is in offline mode and bot username is valid ('AutomationBot').");
  } else if (err.message.includes('connect ECONNREFUSED')) {
      console.error("Connection refused. Is the lobby address play.minefort.com correct? Is port 25565 open?");
  } else if (err.message.includes('unsupported/unknown protocol version')) {
       console.error("Protocol version error during handshake. This might happen if connecting to the wrong address or a non-Minecraft service.");
  }
  process.exit(1);
});

bot.on('end', (reason) => {
    console.log(`Bot disconnected from server. Reason: ${reason}`);
    if (!targetServerJoined) {
        console.error("Bot disconnected before successfully joining the target server.");
        process.exit(1);
    }
});


console.log('Mineflayer bot script started.');

const overallTimeout = 7 * 60 * 1000;
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
