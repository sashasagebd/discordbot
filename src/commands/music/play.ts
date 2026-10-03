import { InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types.js';
import { checkCanPlay } from '../../music/guards.js';
import { getOrCreateQueue } from '../../music/queueManager.js';
import { resolveTrack } from '../../music/ytdlp.js';
import { formatTrack } from '../../music/types.js';

export default {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song from YouTube, or add it to the queue.')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option.setName('query').setDescription('A YouTube URL or search words').setRequired(true),
    ),

  async execute(interaction) {
    const check = checkCanPlay(interaction);
    if ('error' in check) {
      await interaction.reply({ content: check.error, flags: MessageFlags.Ephemeral });
      return;
    }

    // yt-dlp usually takes longer than Discord's 3-second reply window.
    await interaction.deferReply();

    const query = interaction.options.getString('query', true);
    const requestedBy = interaction.inCachedGuild() ? interaction.member.displayName : interaction.user.username;

    let track;
    try {
      track = await resolveTrack(query, requestedBy);
    } catch (error) {
      console.error(`Could not resolve "${query}":`, error);
      await interaction.editReply(`Couldn't find anything for \`${query}\`.`);
      return;
    }

    const queue = getOrCreateQueue(check.channel);
    try {
      await queue.waitUntilReady();
    } catch {
      queue.destroy();
      await interaction.editReply(`Couldn't connect to ${check.channel}. Try again in a moment.`);
      return;
    }

    const startedNow = queue.enqueue(track);
    await interaction.editReply(
      startedNow ? `▶️ Now playing ${formatTrack(track)}` : `➕ Queued at #${queue.tracks.length}: ${formatTrack(track)}`,
    );
  },
} satisfies Command;
