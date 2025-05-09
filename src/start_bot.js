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

let startCommandSent = false;

bot.on('login', () => {
  console.log('--- LOGIN Event Fired ---');
  console.log(`Bot logged in as ${bot.username}.`);
  console.log(`Bot options: ${JSON.stringify(bot.options)}`); // Log options
  console.log(`Bot currentServer: ${JSON.stringify(bot.currentServer)}`); // currentServer is often null on login
  console.log('-------------------------');

  // The previous error was pointing near here, let's see what these logs show.
  // No complex logic in login, just logging.
});

bot.on('spawn', async () => {
    console.log('--- SPAWN Event Fired ---');
    console.log(`Bot spawned.`);
    console.log(`Bot options: ${JSON.stringify(bot.options)}`); // Log options again
    console.log(`Bot currentServer: ${JSON.stringify(bot.currentServer)}`); // This should contain server info if successful
    console.log('-------------------------');


    // *** ADDED TRY...CATCH BLOCK ***
    try {
        // The logic within spawn was simplified significantly.
        // The error was pointing near the start of this handler.
        // Let's see if the logs above reveal anything before a potential error here.

        // The only core logic remaining here is sending the command and setting the fixed timeout
        if (!startCommandSent) {
            startCommandSent = true;
            await setTimeout(5000); // Wait 5 seconds after spawn before sending command
            console.log(`Sending start command: /start ${serverName}`);
            bot.chat(`/start ${serverName}`);
            console.log(`Start command sent. Waiting 3 minutes for server to start before exiting...`);

            const fixedWaitAfterCommand = 3 * 60 * 1000; // 3 minutes
            await setTimeout(fixedWaitAfterCommand);
            console.log('Fixed wait time finished. Assuming server has had time to start. Disconnecting bot.');
            bot.quit();
            console.log('Bot disconnected.');
            process.exit(0); // Exit successfully
        } else {
             console.log("Spawn event fired again after command sent. Fixed timeout is active.");
        }
    } catch (e) {
        console.error(`Error inside SPAWN event handler: ${e.message}`);
        // This might help capture errors happening within the async part
        bot.quit();
        process.exit(1);
    }
    // --- END TRY...CATCH BLOCK ---
});


// Basic error handlers
bot.on('kicked', (reason, loggedIn) => {
  console.error(`--- KICKED Event Fired ---`);
  console.error(`Bot kicked. Reason: ${reason} LoggedIn: ${loggedIn}`);
  console.error('--------------------------');
  process.exit(1);
});

bot.on('error', (err) => {
  console.error(`--- ERROR Event Fired ---`);
  console.error(`Bot error: ${err.message}`);
   if (err.message.includes('Invalid credentials')) {
      console.error("Authentication failed. Ensure server is in offline mode and bot username is valid ('AutomationBot').");
  } else if (err.message.includes('connect ECONNREFUSED')) {
      console.error("Connection refused. Is the lobby address play.minefort.com correct? Is port 25565 open?");
  } else if (err.message.includes('unsupported/unknown protocol version')) {
       console.error("Protocol version error during handshake.");
  } else if (err.message.includes('ETIMEDOUT')) {
       console.error("Connection timed out.");
  } else {
       console.error("An unhandled bot error occurred.");
  }
  console.error('-------------------------');
  process.exit(1);
});

bot.on('end', (reason) => {
    console.error(`--- END Event Fired ---`);
    console.log(`Bot disconnected from server. Reason: ${reason}`);
    console.error('-----------------------');
    // If the script hasn't exited successfully already, assume this end is a failure.
    // The overall timeout or a preceding error handler should catch failures,
    // but this is a fallback.
    if (!process.exitCode || process.exitCode === 0) {
         console.error("Bot ended before successful completion.");
         process.exit(1);
    }
});


console.log('Mineflayer bot script started.');

// Overall timeout
const overallTimeout = 7 * 60 * 1000; // 7 minutes
console.log(`Setting overall bot script timeout to ${overallTimeout / 1000} seconds.`);
setTimeout(overallTimeout)
  .then(() => {
      // If process hasn't exited by now, it's a timeout failure
      if (!process.exitCode || process.exitCode === 0) {
          console.error(`Overall timeout reached: Bot script did not complete within ${overallTimeout / 1000} seconds.`);
          bot.quit();
          process.exit(1);
      }
  })
  .catch(err => {
      console.error(`Error with overall timeout mechanism: ${err.message}`);
      bot.quit();
      process.exit(1);
  });
