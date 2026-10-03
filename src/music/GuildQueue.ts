import type { ChildProcess } from 'node:child_process';
import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  type AudioPlayer,
  type VoiceConnection,
} from '@discordjs/voice';
import { createAudioStream } from './ytdlp.js';
import type { Track } from './types.js';

// Leave the voice channel after this long with nothing left to play.
const IDLE_TIMEOUT_MS = 5 * 60_000;
const CONNECT_TIMEOUT_MS = 20_000;

// Playback state for one guild: the voice connection, the audio player, and the track list.
export class GuildQueue {
  readonly tracks: Track[] = [];
  current: Track | null = null;

  private readonly player: AudioPlayer;
  private ytdlp: ChildProcess | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private destroyed = false;

  constructor(
    private readonly connection: VoiceConnection,
    private readonly onDestroy: () => void,
  ) {
    this.player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    connection.subscribe(this.player);

    this.player.on(AudioPlayerStatus.Idle, () => {
      this.stopYtdlp();
      this.current = null;
      this.playNext();
    });
    // The player goes Idle right after an error, which moves on to the next track.
    this.player.on('error', (error) => {
      const track = error.resource.metadata as Track | undefined;
      console.error(`Audio player error while playing ${track?.url ?? 'unknown track'}:`, error);
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        // Moved to another channel or a brief network drop: Discord reconnects on its own.
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        // Kicked from the channel, or the channel was deleted.
        this.destroy();
      }
    });
    connection.on(VoiceConnectionStatus.Destroyed, () => this.destroy());
  }

  get channelId(): string | null {
    return this.connection.joinConfig.channelId;
  }

  get isPaused(): boolean {
    const status = this.player.state.status;
    return status === AudioPlayerStatus.Paused || status === AudioPlayerStatus.AutoPaused;
  }

  get elapsedMs(): number {
    const state = this.player.state;
    return state.status === AudioPlayerStatus.Idle ? 0 : state.resource.playbackDuration;
  }

  async waitUntilReady(): Promise<void> {
    await entersState(this.connection, VoiceConnectionStatus.Ready, CONNECT_TIMEOUT_MS);
  }

  // Returns true if the track started playing immediately, false if it was queued.
  enqueue(track: Track): boolean {
    this.tracks.push(track);
    if (this.player.state.status !== AudioPlayerStatus.Idle) return false;
    this.playNext();
    return true;
  }

  // Returns the skipped track, or null if nothing was playing.
  skip(): Track | null {
    const skipped = this.current;
    if (!skipped) return null;
    // Moving to Idle triggers playNext().
    this.player.stop(true);
    return skipped;
  }

  pause(): boolean {
    return this.player.pause();
  }

  resume(): boolean {
    return this.player.unpause();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearIdleTimer();
    this.tracks.length = 0;
    this.current = null;
    this.player.stop(true);
    this.stopYtdlp();
    if (this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      this.connection.destroy();
    }
    this.onDestroy();
  }

  private playNext(): void {
    if (this.destroyed || this.player.state.status !== AudioPlayerStatus.Idle) return;

    const next = this.tracks.shift();
    if (!next) {
      this.startIdleTimer();
      return;
    }

    this.clearIdleTimer();
    const { stream, process } = createAudioStream(next.url);
    this.ytdlp = process;
    this.current = next;
    // Arbitrary input goes through FFmpeg, which transcodes whatever yt-dlp returns to Opus.
    this.player.play(createAudioResource(stream, { inputType: StreamType.Arbitrary, metadata: next }));
  }

  private stopYtdlp(): void {
    if (this.ytdlp && this.ytdlp.exitCode === null) {
      this.ytdlp.kill();
    }
    this.ytdlp = null;
  }

  private startIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => this.destroy(), IDLE_TIMEOUT_MS);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}
