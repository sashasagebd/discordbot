import { InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types.js';
import { checkCanControl } from '../../music/guards.js';

export default {
  data: new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Resume a paused song.')
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const check = checkCanControl(interaction);
    if ('error' in check) {
      await interaction.reply({ content: check.error, flags: MessageFlags.Ephemeral });
      return;
    }

    if (!check.queue.resume()) {
      await interaction.reply({ content: "Playback isn't paused.", flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply('▶️ Resumed.');
  },
} satisfies Command;
