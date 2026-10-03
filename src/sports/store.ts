import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LeagueKey } from './espn.js';

// In Docker this folder is a named volume (see compose.yaml), so settings survive rebuilds.
const dataFile = path.resolve(process.env.DATA_DIR ?? 'data', 'sports.json');

export interface FollowedTeam {
  league: LeagueKey;
  id: string;
  name: string;
  roleId: string; // Created by the bot. Unlocks the channel and is pinged for goals and full time.
  memberIds: string[]; // Who followed it. The team is dropped when this is empty.
}

export interface GuildSettings {
  teams: FollowedTeam[];
  channelId?: string; // Where announcements go. Nothing is posted until this is set.
  watchRoleId?: string; // Lets people see the channel without getting pinged.
  rolePicker?: { channelId: string; messageId: string };
}

type SportsData = Record<string, GuildSettings>;

let loaded: Promise<SportsData> | undefined;
let lastWrite: Promise<void> = Promise.resolve();

function load(): Promise<SportsData> {
  loaded ??= readFile(dataFile, 'utf8').then(
    (text) => {
      const data = JSON.parse(text) as SportsData;
      // Teams saved by the first version (admin-followed, no role) have no
      // followers to keep them alive, so drop them.
      for (const settings of Object.values(data)) {
        settings.teams = settings.teams.filter((t) => t.roleId && Array.isArray(t.memberIds));
      }
      return data;
    },
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

async function update<T>(guildId: string, change: (settings: GuildSettings) => T): Promise<T> {
  const data = await load();
  const result = change((data[guildId] ??= { teams: [] }));
  await save(data);
  return result;
}

const sameTeam = (league: LeagueKey, teamId: string) => (t: FollowedTeam) => t.league === league && t.id === teamId;

export async function getGuildSettings(guildId: string): Promise<GuildSettings> {
  const data = await load();
  return data[guildId] ?? { teams: [] };
}

export async function getAllGuildSettings(): Promise<[guildId: string, settings: GuildSettings][]> {
  return Object.entries(await load());
}

// Adds the team, or points it at a new role (e.g. after the old one was deleted
// by hand, in which case nobody has the new role yet).
export function setTeamRole(guildId: string, team: Omit<FollowedTeam, 'memberIds'>): Promise<void> {
  return update(guildId, (s) => {
    const existing = s.teams.find(sameTeam(team.league, team.id));
    if (existing) Object.assign(existing, { roleId: team.roleId, memberIds: [] });
    else s.teams.push({ ...team, memberIds: [] });
  });
}

export function addTeamMember(guildId: string, league: LeagueKey, teamId: string, userId: string): Promise<void> {
  return update(guildId, (s) => {
    const team = s.teams.find(sameTeam(league, teamId));
    if (team && !team.memberIds.includes(userId)) team.memberIds.push(userId);
  });
}

// Returns how many followers are left.
export function removeTeamMember(guildId: string, league: LeagueKey, teamId: string, userId: string): Promise<number> {
  return update(guildId, (s) => {
    const team = s.teams.find(sameTeam(league, teamId));
    if (!team) return 0;
    team.memberIds = team.memberIds.filter((id) => id !== userId);
    return team.memberIds.length;
  });
}

export function removeTeam(guildId: string, league: LeagueKey, teamId: string): Promise<void> {
  return update(guildId, (s) => {
    s.teams = s.teams.filter((t) => !sameTeam(league, teamId)(t));
  });
}

export function setAnnouncementChannel(guildId: string, channelId: string, watchRoleId: string | undefined): Promise<void> {
  return update(guildId, (s) => {
    s.channelId = channelId;
    s.watchRoleId = watchRoleId;
  });
}

export function setRolePicker(guildId: string, rolePicker: GuildSettings['rolePicker']): Promise<void> {
  return update(guildId, (s) => {
    s.rolePicker = rolePicker;
  });
}
