import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import type { Readable } from 'node:stream';
import type { Track } from './types.js';

const execFileAsync = promisify(execFile);

// Expects the yt-dlp binary on PATH. Keep it current with `yt-dlp -U`;
// YouTube regularly breaks older versions.
const YT_DLP = 'yt-dlp';

// Looks up a single video by URL, or runs a YouTube search and takes the top result.
// Only metadata is fetched here; the audio stream URL is resolved at play time
// because YouTube stream URLs expire after a few hours.
export async function resolveTrack(query: string, requestedBy: string): Promise<Track> {
  const target = /^https?:\/\//i.test(query) ? query : `ytsearch1:${query}`;
  const { stdout } = await execFileAsync(
    YT_DLP,
    ['--dump-json', '--no-playlist', '--no-warnings', target],
    { maxBuffer: 64 * 1024 * 1024, timeout: 30_000, windowsHide: true },
  );

  const firstLine = stdout.split('\n').find((line) => line.trim());
  if (!firstLine) {
    throw new Error(`No results for "${query}"`);
  }

  const info = JSON.parse(firstLine) as { title?: string; webpage_url?: string; duration?: number | null };
  if (!info.webpage_url) {
    throw new Error(`yt-dlp returned no URL for "${query}"`);
  }

  return {
    title: info.title ?? info.webpage_url,
    url: info.webpage_url,
    durationSec: info.duration ?? null,
    requestedBy,
  };
}

// Streams the best available audio to stdout. The caller must kill the process
// when playback stops early (skip/stop), or it keeps downloading.
export function createAudioStream(url: string): { stream: Readable; process: ChildProcess } {
  const child = spawn(
    YT_DLP,
    ['--format', 'bestaudio/best', '--output', '-', '--no-playlist', '--quiet', '--no-warnings', url],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );

  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  child.on('error', (error) => console.error(`Failed to start yt-dlp for ${url}:`, error));
  child.on('close', (code, signal) => {
    // A non-zero exit after we killed it (signal set) is expected; anything else is worth logging.
    if (code && !signal) {
      console.error(`yt-dlp exited with code ${code} for ${url}:\n${stderr.trim()}`);
    }
  });

  return { stream: child.stdout, process: child };
}
