import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Replies with Pong and the bot latency.'),

  async execute(interaction) {
    await interaction.reply('Pinging...');
    const reply = await interaction.fetchReply();
    const roundTrip = reply.createdTimestamp - interaction.createdTimestamp;
    await interaction.editReply(
      `Pong! Round trip: ${roundTrip}ms · WebSocket: ${interaction.client.ws.ping}ms`,
    );
  },
} satisfies Command;
