const mineflayer = require('mineflayer');
const { setTimeout } = require('timers/promises'); // Use promise-based setTimeout for cleaner async

const email = process.env.MINEFORT_EMAIL;
const password = process.env.MINEFORT_PASSWORD;
const serverName = process.env.MINEFORT_SERVER_NAME; // e.g., 'ForAboniii'
const minefortLobbyHost = 'play.minefort.com'; // Confirmed lobby IP
const targetServerHost = `${serverName}.minefort.com`; // Construct target server IP
const targetServerPort = 25565; // Standard Minecraft Java port
const bedRockPort = 19132; // Bedrock port (not used for Java bot login)

if (!email || !password || !serverName) {
    console.error('Error: MINEFORT_EMAIL, MINEFORT_PASSWORD, and MINEFORT_SERVER_NAME environment variables must be set.');
    process.exit(1); // Exit if essential secrets are missing
}

console.log(`Attempting to connect to Minefort lobby (${minefortLobbyHost}) as ${email}...`);

const bot = mineflayer.createBot({
  host: minefortLobbyHost,
  auth: 'microsoft', // Assuming your Minefort account uses Microsoft login
  username: email,
  password: password,
  // If Minefort supports cracked/offline mode, you might not need password and can use offline: true
  // offline: true, // Uncomment if using cracked/offline mode support
  version: false // Let mineflayer detect the version
});

let lobbyJoined = false;
let targetServerJoined = false;

bot.on('login', () => {
  console.log(`Logged into Minefort lobby as ${bot.username}`);
  lobbyJoined = true;

  // Wait a moment for the bot to fully spawn in the lobby
  setTimeout(5000) // Wait 5 seconds
    .then(() => {
      console.log(`Sending start command: /start ${serverName}`);
      bot.chat(`/start ${serverName}`);
      console.log(`Command sent. Waiting to be transferred to ${targetServerHost}...`);

      // Set a timeout to handle cases where the server might not start or transfer fails
      const transferTimeout = 5 * 60 * 1000; // Wait up to 5 minutes for transfer
      console.log(`Setting a ${transferTimeout / 1000} second timeout for server transfer.`);

      const timeoutId = setTimeout(transferTimeout, null, { ref: false }) // Use a reference-less timer
        .then(() => {
          if (!targetServerJoined) {
            console.error(`Timeout reached: Bot did not join ${targetServerHost} within ${transferTimeout / 1000} seconds.`);
            bot.quit();
            process.exit(1); // Exit with error code if transfer times out
          }
        });

      // We will rely on the 'spawn' event occurring *after* the server change
      // Or check bot.currentServer periodically if spawn is unreliable for server changes

    })
    .catch(err => {
        console.error(`Error during initial lobby actions: ${err.message}`);
        bot.quit();
        process.exit(1);
    });
});

// The 'spawn' event is emitted when the bot spawns in a world.
// It happens after joining the lobby and again after being transferred to the target server.
bot.on('spawn', () => {
    console.log('Bot spawned.');
    // Check the bot's current server information
    const currentServer = bot.currentServer;
    console.log(`Bot is currently on server: ${currentServer ? currentServer.host + ':' + currentServer.port : 'Unknown'}`);

    if (lobbyJoined && currentServer && currentServer.host === targetServerHost && currentServer.port === targetServerPort) {
        // This is the second spawn event, indicating we've joined the target server
        if (!targetServerJoined) { // Ensure this logic runs only once
            targetServerJoined = true;
            console.log(`Successfully joined target server: ${targetServerHost}`);

            // Keep the bot connected for 5 minutes to simulate activity *on the target server*
            const activityDuration = 5 * 60 * 1000; // 5 minutes in milliseconds
            console.log(`Keeping bot connected for ${activityDuration / 1000} seconds on the target server...`);

            setTimeout(activityDuration)
              .then(() => {
                console.log('Activity time finished on target server. Disconnecting bot.');
                bot.quit();
                console.log('Bot disconnected.');
                process.exit(0); // Exit successfully ONLY after joining target server and idling
              })
              .catch(err => {
                  console.error(`Error during final activity timeout: ${err.message}`);
                  bot.quit();
                  process.exit(1);
              });
        }
    } else if (lobbyJoined && currentServer && currentServer.host === minefortLobbyHost) {
         console.log('Bot spawned in the lobby. Waiting for transfer...');
         // This is the initial spawn in the lobby. Do nothing specific here,
         // the command sending is handled in the login event's timeout.
    } else {
        // Handle unexpected spawn events if necessary
        console.log('Spawned in an unexpected state or server.');
    }
});

bot.on('kicked', (reason, loggedIn) => {
  console.error(`Bot kicked. Reason: ${reason} LoggedIn: ${loggedIn}`);
  process.exit(1); // Exit with error code on kick
});

bot.on('error', (err) => {
  console.error(`Bot error: ${err.message}`);
  process.exit(1); // Exit with error code on error
});

// Add handlers for unexpected disconnections or end events
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
const overallTimeout = 10 * 60 * 1000; // 10 minutes total timeout for the bot script
setTimeout(overallTimeout, null, { ref: false })
  .then(() => {
      if (!targetServerJoined) {
          console.error(`Overall timeout reached: Bot script did not complete within ${overallTimeout / 1000} seconds.`);
          bot.quit();
          process.exit(1);
      }
  });
