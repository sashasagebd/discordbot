import { REST, Routes } from 'discord.js';
import { requireEnv } from './config.js';
import { loadCommands } from './loadCommands.js';

// Registers all commands to a single test guild. Guild commands update
// instantly, unlike global commands which can take up to an hour.
const token = requireEnv('DISCORD_TOKEN');
const clientId = requireEnv('CLIENT_ID');
const guildId = requireEnv('GUILD_ID');

const commands = await loadCommands();
const body = commands.map((command) => command.data.toJSON());

const rest = new REST().setToken(token);
const result = (await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body })) as unknown[];

console.log(`Registered ${result.length} command(s) to guild ${guildId}.`);
