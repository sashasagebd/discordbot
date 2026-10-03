import { joinVoiceChannel } from '@discordjs/voice';
import type { VoiceBasedChannel } from 'discord.js';
import { GuildQueue } from './GuildQueue.js';

const queues = new Map<string, GuildQueue>();

export function getQueue(guildId: string): GuildQueue | undefined {
  return queues.get(guildId);
}

// Returns the guild's existing queue, or joins `channel` and creates one.
// The queue is registered synchronously so that two /play commands arriving
// together share one connection instead of racing to create two.
export function getOrCreateQueue(channel: VoiceBasedChannel): GuildQueue {
  const guildId = channel.guild.id;
  const existing = queues.get(guildId);
  if (existing) return existing;

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId,
    adapterCreator: channel.guild.voiceAdapterCreator,
  });
  const queue = new GuildQueue(connection, () => {
    // Only remove this queue; a newer one may already have replaced it.
    if (queues.get(guildId) === queue) queues.delete(guildId);
  });
  queues.set(guildId, queue);
  return queue;
}

export function destroyAllQueues(): void {
  for (const queue of [...queues.values()]) {
    queue.destroy();
  }
}
