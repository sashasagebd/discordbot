import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  DiscordAPIError,
  MessageFlags,
  RESTJSONErrorCodes,
  type ButtonInteraction,
  type Guild,
  type MessageCreateOptions,
} from 'discord.js';
import { getTeams, isLeagueKey, type LeagueKey } from './espn.js';
import { joinTeam, leaveTeam, permissionHelp } from './membership.js';
import { getGuildSettings, setRolePicker, type GuildSettings } from './store.js';

// Button custom IDs start with "sports:" so clicks are routed to the /sports
// command (see index.ts): "sports:team:<league>:<teamId>" or "sports:watch".
const TEAM_PREFIX = 'sports:team:';
const WATCH_ID = 'sports:watch';

export function buildRolePicker(settings: GuildSettings): MessageCreateOptions {
  const channel = settings.channelId ? `<#${settings.channelId}>` : 'the sports channel';
  // Discord allows 5 rows of 5 buttons; keep one slot for "watch only".
  const buttons = settings.teams.slice(0, settings.watchRoleId ? 24 : 25).map((t) =>
    new ButtonBuilder().setCustomId(`${TEAM_PREFIX}${t.league}:${t.id}`).setLabel(t.name).setStyle(ButtonStyle.Secondary),
  );
  if (settings.watchRoleId) {
    buttons.push(new ButtonBuilder().setCustomId(WATCH_ID).setLabel('👀 Watch only (no pings)').setStyle(ButtonStyle.Secondary));
  }

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(i, i + 5)));
  }

  const content =
    `**Pick your teams**\nClick a team to see ${channel} and get pinged for its games. Click it again to unfollow.\n` +
    `-# Team not listed? Use \`/sports follow\` to add it.`;
  return { content, components: rows, allowedMentions: { parse: [] } };
}

// Edits the posted picker after teams are added or removed. Forgets it if it was deleted.
export async function refreshRolePicker(guild: Guild): Promise<void> {
  const settings = await getGuildSettings(guild.id);
  if (!settings.rolePicker) return;

  try {
    const channel = await guild.channels.fetch(settings.rolePicker.channelId);
    if (!channel?.isTextBased()) throw new Error('Role picker channel is gone');
    const message = await channel.messages.fetch(settings.rolePicker.messageId);
    const { content, components } = buildRolePicker(settings);
    await message.edit({ content, components });
  } catch (error) {
    const gone =
      error instanceof DiscordAPIError &&
      (error.code === RESTJSONErrorCodes.UnknownMessage || error.code === RESTJSONErrorCodes.UnknownChannel);
    if (gone) await setRolePicker(guild.id, undefined);
    else console.error('Could not update the sports role picker:', error);
  }
}

export function isPickerButton(customId: string): boolean {
  return customId === WATCH_ID || customId.startsWith(TEAM_PREFIX);
}

export async function handlePickerButton(interaction: ButtonInteraction<'cached'>): Promise<void> {
  const reply = (content: string) =>
    interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

  try {
    if (interaction.customId === WATCH_ID) await toggleWatch(interaction, reply);
    else await toggleTeam(interaction, reply);
  } catch (error) {
    const help = permissionHelp(error);
    if (!help) throw error;
    await reply(help);
  }
}

type Reply = (content: string) => Promise<unknown>;

async function toggleTeam(interaction: ButtonInteraction<'cached'>, reply: Reply): Promise<void> {
  const [league, teamId] = interaction.customId.slice(TEAM_PREFIX.length).split(':') as [LeagueKey, string];
  const settings = await getGuildSettings(interaction.guildId);
  const followed = settings.teams.find((t) => t.league === league && t.id === teamId);
  const member = interaction.member;

  if (followed && member.roles.cache.has(followed.roleId)) {
    const result = await leaveTeam(member, league, teamId);
    await reply(`Unfollowed **${followed.name}**.`);
    if (result?.teamRemoved) await refreshRolePicker(interaction.guild);
    return;
  }

  // The button can outlive the team (if everyone unfollowed it), so look it up
  // again rather than trusting the label.
  const team = isLeagueKey(league) ? (await getTeams(league)).find((t) => t.id === teamId) : undefined;
  if (!team) {
    await reply('That team is no longer available.');
    return;
  }
  const result = await joinTeam(member, team);
  await reply(`✅ You're following **${team.name}**.${settings.channelId ? ` Updates are in <#${settings.channelId}>.` : ''}`);
  if (result.newTeam) await refreshRolePicker(interaction.guild);
}

async function toggleWatch(interaction: ButtonInteraction<'cached'>, reply: Reply): Promise<void> {
  const settings = await getGuildSettings(interaction.guildId);
  const role = settings.watchRoleId ? interaction.guild.roles.cache.get(settings.watchRoleId) : undefined;
  if (!role) {
    await reply('Watch-only mode is no longer available.');
    return;
  }

  if (interaction.member.roles.cache.has(role.id)) {
    await interaction.member.roles.remove(role);
    await reply(`Removed ${role}.`);
  } else {
    await interaction.member.roles.add(role);
    await reply(`Added ${role}.${settings.channelId ? ` You can now see <#${settings.channelId}> without pings.` : ''}`);
  }
}
