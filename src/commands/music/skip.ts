import { InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types.js';
import { checkCanControl } from '../../music/guards.js';

export default {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip the current song.')
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const check = checkCanControl(interaction);
    if ('error' in check) {
      await interaction.reply({ content: check.error, flags: MessageFlags.Ephemeral });
      return;
    }

    const skipped = check.queue.skip();
    if (!skipped) {
      await interaction.reply({ content: 'Nothing is playing.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply(`⏭️ Skipped **${skipped.title}**.`);
  },
} satisfies Command;
