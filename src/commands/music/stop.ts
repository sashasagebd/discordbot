import { InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types.js';
import { checkCanControl } from '../../music/guards.js';

export default {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop playback, clear the queue, and leave the voice channel.')
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const check = checkCanControl(interaction);
    if ('error' in check) {
      await interaction.reply({ content: check.error, flags: MessageFlags.Ephemeral });
      return;
    }

    check.queue.destroy();
    await interaction.reply('⏹️ Stopped and cleared the queue.');
  },
} satisfies Command;
