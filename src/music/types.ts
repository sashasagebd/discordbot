export interface Track {
  title: string;
  url: string;
  // null for livestreams or when yt-dlp can't tell.
  durationSec: number | null;
  requestedBy: string;
}

export function formatDuration(totalSec: number | null): string {
  if (totalSec === null) return 'live';
  const sec = Math.floor(totalSec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function formatTrack(track: Track): string {
  return `**${track.title}** (${formatDuration(track.durationSec)}) · requested by ${track.requestedBy}`;
}
