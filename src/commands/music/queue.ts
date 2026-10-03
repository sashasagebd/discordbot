import { InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types.js';
import { getQueue } from '../../music/queueManager.js';
import { formatTrack } from '../../music/types.js';

const MAX_LISTED = 10;

export default {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show the current song and what is coming up.')
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const queue = interaction.guildId ? getQueue(interaction.guildId) : undefined;
    if (!queue?.current) {
      await interaction.reply({ content: 'The queue is empty.', flags: MessageFlags.Ephemeral });
      return;
    }

    const lines = [`${queue.isPaused ? '⏸️' : '▶️'} ${formatTrack(queue.current)}`];
    if (queue.tracks.length === 0) {
      lines.push('', 'Nothing else queued.');
    } else {
      lines.push('', '**Up next:**');
      queue.tracks.slice(0, MAX_LISTED).forEach((track, i) => lines.push(`${i + 1}. ${formatTrack(track)}`));
      if (queue.tracks.length > MAX_LISTED) {
        lines.push(`…and ${queue.tracks.length - MAX_LISTED} more.`);
      }
    }

    await interaction.reply(lines.join('\n'));
  },
} satisfies Command;
