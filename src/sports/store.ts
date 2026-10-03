import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LeagueKey } from './espn.js';

// In Docker this folder is a named volume (see compose.yaml), so follows survive rebuilds.
const dataFile = path.resolve(process.env.DATA_DIR ?? 'data', 'sports.json');

export interface FollowedTeam {
  league: LeagueKey;
  id: string;
  name: string;
}

export interface GuildSettings {
  teams: FollowedTeam[];
  channelId?: string; // Where announcements go. Nothing is posted until this is set.
  roleId?: string; // Pinged for goals and full time.
}

type SportsData = Record<string, GuildSettings>;

let loaded: Promise<SportsData> | undefined;
let lastWrite: Promise<void> = Promise.resolve();

function load(): Promise<SportsData> {
  loaded ??= readFile(dataFile, 'utf8').then(
    (text) => JSON.parse(text) as SportsData,
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return {};
      loaded = undefined; // Let the next call retry instead of caching the failure.
      throw error;
    },
  );
  return loaded;
}

// Writes run one at a time, each to a temp file renamed over the real one,
// so a crash mid-write can't leave a half-written file behind.
function save(data: SportsData): Promise<void> {
  const snapshot = JSON.stringify(data, null, 2);
  lastWrite = lastWrite
    .catch(() => {})
    .then(async () => {
      await mkdir(path.dirname(dataFile), { recursive: true });
      await writeFile(`${dataFile}.tmp`, snapshot);
      await rename(`${dataFile}.tmp`, dataFile);
    });
  return lastWrite;
}

export async function getGuildSettings(guildId: string): Promise<GuildSettings> {
  const data = await load();
  return data[guildId] ?? { teams: [] };
}

export async function getAllGuildSettings(): Promise<[guildId: string, settings: GuildSettings][]> {
  return Object.entries(await load());
}

export async function getFollowedTeams(guildId: string): Promise<FollowedTeam[]> {
  return (await getGuildSettings(guildId)).teams;
}

export async function setAnnouncementChannel(guildId: string, channelId: string, roleId: string | undefined): Promise<void> {
  const data = await load();
  const settings = (data[guildId] ??= { teams: [] });
  settings.channelId = channelId;
  settings.roleId = roleId;
  await save(data);
}

// Returns false if the team was already followed.
export async function followTeam(guildId: string, team: FollowedTeam): Promise<boolean> {
  const data = await load();
  const settings = (data[guildId] ??= { teams: [] });
  if (settings.teams.some((t) => t.league === team.league && t.id === team.id)) return false;

  settings.teams.push(team);
  await save(data);
  return true;
}

// Returns the removed team, or undefined if it wasn't followed.
export async function unfollowTeam(guildId: string, league: LeagueKey, teamId: string): Promise<FollowedTeam | undefined> {
  const data = await load();
  const teams = data[guildId]?.teams ?? [];
  const index = teams.findIndex((t) => t.league === league && t.id === teamId);
  if (index === -1) return undefined;

  const [removed] = teams.splice(index, 1);
  await save(data);
  return removed;
}
