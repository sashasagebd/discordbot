import { PermissionFlagsBits, type ChatInputCommandInteraction, type VoiceBasedChannel } from 'discord.js';
import { getQueue } from './queueManager.js';
import type { GuildQueue } from './GuildQueue.js';

type GuardResult<T> = T | { error: string };

// For /play: the user must be in a voice channel the bot can join, and if the bot
// is already playing in this server, it must be the same channel.
export function checkCanPlay(interaction: ChatInputCommandInteraction): GuardResult<{ channel: VoiceBasedChannel }> {
  if (!interaction.inCachedGuild()) return { error: 'This command only works in a server.' };

  const channel = interaction.member.voice.channel;
  if (!channel) return { error: 'Join a voice channel first.' };

  const queue = getQueue(interaction.guildId);
  if (queue) {
    if (queue.channelId !== channel.id) return { error: `I'm already playing in <#${queue.channelId}>.` };
    return { channel };
  }

  if (!channel.joinable) return { error: `I can't join ${channel} (missing permission or the channel is full).` };
  if (!channel.permissionsFor(interaction.client.user)?.has(PermissionFlagsBits.Speak)) {
    return { error: `I don't have permission to speak in ${channel}.` };
  }
  return { channel };
}

// For the playback controls: something must be playing, and the user must be
// in the same voice channel as the bot.
export function checkCanControl(interaction: ChatInputCommandInteraction): GuardResult<{ queue: GuildQueue }> {
  if (!interaction.inCachedGuild()) return { error: 'This command only works in a server.' };

  const queue = getQueue(interaction.guildId);
  if (!queue) return { error: "I'm not playing anything." };
  if (interaction.member.voice.channelId !== queue.channelId) {
    return { error: `Join <#${queue.channelId}> to control playback.` };
  }
  return { queue };
}
