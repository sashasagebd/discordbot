import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { requireEnv } from './config.js';
import { loadCommands } from './loadCommands.js';
import { destroyAllQueues } from './music/queueManager.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    // Needed to see who is in which voice channel (for the music commands).
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const commands = await loadCommands();

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag} with ${commands.size} command(s).`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);
  if (!command) {
    console.warn(`No handler for /${interaction.commandName}`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`Error running /${interaction.commandName}:`, error);
    const message = { content: 'Something went wrong running that command.', flags: MessageFlags.Ephemeral } as const;
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(message).catch(() => {});
    } else {
      await interaction.reply(message).catch(() => {});
    }
  }
});

// Leave voice channels and kill any running yt-dlp processes before exiting.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    destroyAllQueues();
    void client.destroy().finally(() => process.exit(0));
  });
}

await client.login(requireEnv('DISCORD_TOKEN'));
