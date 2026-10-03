import { InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types.js';
import { getQueue } from '../../music/queueManager.js';
import { formatDuration } from '../../music/types.js';

export default {
  data: new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Show the song that is playing right now.')
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const queue = interaction.guildId ? getQueue(interaction.guildId) : undefined;
    const track = queue?.current;
    if (!queue || !track) {
      await interaction.reply({ content: 'Nothing is playing.', flags: MessageFlags.Ephemeral });
      return;
    }

    const elapsed = formatDuration(queue.elapsedMs / 1000);
    const total = formatDuration(track.durationSec);
    await interaction.reply(
      `${queue.isPaused ? '⏸️' : '▶️'} **${track.title}**\n${elapsed} / ${total} · requested by ${track.requestedBy}\n<${track.url}>`,
    );
  },
} satisfies Command;
