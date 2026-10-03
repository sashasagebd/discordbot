import { DiscordAPIError, RESTJSONErrorCodes, type Guild, type GuildMember, type Role } from 'discord.js';
import type { LeagueKey, Team } from './espn.js';
import { addTeamMember, getGuildSettings, removeTeam, removeTeamMember, setTeamRole, type FollowedTeam } from './store.js';

// Changes run one at a time per server, so two people following a new team at
// the same moment don't create two roles.
const locks = new Map<string, Promise<unknown>>();
function withGuildLock<T>(guildId: string, task: () => Promise<T>): Promise<T> {
  const result = (locks.get(guildId) ?? Promise.resolve()).catch(() => {}).then(task);
  locks.set(guildId, result);
  return result;
}

export interface JoinResult {
  role: Role;
  newTeam: boolean; // Nobody in the server followed this team before.
  alreadyFollowing: boolean;
  channelAccess: boolean; // false if the role couldn't be given access to the channel.
}

export function joinTeam(member: GuildMember, team: Team): Promise<JoinResult> {
  const { guild } = member;
  const { league } = team;
  return withGuildLock(guild.id, async () => {
    const settings = await getGuildSettings(guild.id);
    const existing = settings.teams.find((t) => t.league === league && t.id === team.id);
    let role = existing && guild.roles.cache.get(existing.roleId);
    let channelAccess = true;

    // First follower, or the role was deleted by hand: make a fresh one.
    if (!role) {
      role = await guild.roles.create({
        name: team.name,
        colors: team.color ? { primaryColor: `#${team.color}` } : undefined,
        mentionable: true,
        reason: `Sports: ${member.user.tag} followed ${team.name}`,
      });
      await setTeamRole(guild.id, { league, id: team.id, name: team.name, roleId: role.id });
      if (settings.channelId) channelAccess = await allowChannel(guild, settings.channelId, role);
    }

    const alreadyFollowing = member.roles.cache.has(role.id) && (existing?.memberIds.includes(member.id) ?? false);
    if (!member.roles.cache.has(role.id)) await member.roles.add(role);
    await addTeamMember(guild.id, league, team.id, member.id);
    return { role, newTeam: !existing, alreadyFollowing, channelAccess };
  });
}

// Returns undefined if the server doesn't follow this team. `teamRemoved` means
// this was the last follower, so the role was deleted and announcements stop.
export function leaveTeam(
  member: GuildMember,
  league: LeagueKey,
  teamId: string,
): Promise<{ team: FollowedTeam; teamRemoved: boolean } | undefined> {
  const { guild } = member;
  return withGuildLock(guild.id, async () => {
    const team = (await getGuildSettings(guild.id)).teams.find((t) => t.league === league && t.id === teamId);
    if (!team) return undefined;

    if (member.roles.cache.has(team.roleId)) await member.roles.remove(team.roleId);
    const remaining = await removeTeamMember(guild.id, league, teamId, member.id);
    if (remaining > 0) return { team, teamRemoved: false };

    await deleteTeam(guild, team);
    return { team, teamRemoved: true };
  });
}

// For admins: drop a team no matter who follows it.
export function removeTeamForEveryone(guild: Guild, team: FollowedTeam): Promise<void> {
  return withGuildLock(guild.id, () => deleteTeam(guild, team));
}

async function deleteTeam(guild: Guild, team: FollowedTeam): Promise<void> {
  try {
    await guild.roles.delete(team.roleId, `Sports: nobody follows ${team.name} anymore`);
  } catch (error) {
    if (!(error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownRole)) throw error;
  }
  await removeTeam(guild.id, team.league, team.id);
}

// Lets a role see the announcement channel. Returns false if that wasn't allowed.
export async function allowChannel(guild: Guild, channelId: string, role: Role | string): Promise<boolean> {
  const channel = guild.channels.cache.get(channelId);
  if (!channel || !('permissionOverwrites' in channel)) return false;
  try {
    await channel.permissionOverwrites.edit(role, { ViewChannel: true }, { reason: 'Sports: let followers see the channel' });
    return true;
  } catch (error) {
    console.error(`Could not give role access to channel ${channelId}:`, error);
    return false;
  }
}

// A friendly explanation for errors caused by the bot's role setup.
export function permissionHelp(error: unknown): string | undefined {
  if (error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.MissingPermissions) {
    return "I'm missing permissions to manage roles. An admin needs to give me **Manage Roles** and keep my role above the team roles.";
  }
  return undefined;
}
