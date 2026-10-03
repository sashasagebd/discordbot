import { InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types.js';
import { checkCanControl } from '../../music/guards.js';

export default {
  data: new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pause the current song.')
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const check = checkCanControl(interaction);
    if ('error' in check) {
      await interaction.reply({ content: check.error, flags: MessageFlags.Ephemeral });
      return;
    }

    if (!check.queue.pause()) {
      await interaction.reply({ content: 'Nothing is playing, or it is already paused.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply('⏸️ Paused.');
  },
} satisfies Command;
