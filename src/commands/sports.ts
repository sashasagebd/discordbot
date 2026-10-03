import { ChannelType, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { getTeams, LEAGUES, type LeagueKey, type Team } from '../sports/espn.js';
import { matchTeams, resolveTeam } from '../sports/format.js';
import { wakeAnnouncer } from '../sports/announcer.js';
import { followTeam, getFollowedTeams, getGuildSettings, setAnnouncementChannel, unfollowTeam } from '../sports/store.js';

// Only MLS for now. Adding a league means adding it to LEAGUES and a `league` option here.
const LEAGUE: LeagueKey = 'mls';

export default {
  data: new SlashCommandBuilder()
    .setName('sports')
    .setDescription('Follow sports teams for score announcements.')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) =>
      sub
        .setName('follow')
        .setDescription('Follow an MLS team (needs Manage Server).')
        .addStringOption((option) =>
          option.setName('team').setDescription('Team name').setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('unfollow')
        .setDescription('Stop following a team (needs Manage Server).')
        .addStringOption((option) =>
          option.setName('team').setDescription('Team name').setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('Choose where announcements go and who gets pinged (needs Manage Server).')
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('Channel for match announcements')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        )
        .addRoleOption((option) =>
          option.setName('role').setDescription('Role to ping for goals and full time (leave out for no pings)'),
        ),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Show the teams this server follows.')),

  async autocomplete(interaction) {
    if (!interaction.inGuild()) return;
    const query = interaction.options.getFocused();

    let teams: Team[] | { id: string; name: string }[];
    if (interaction.options.getSubcommand() === 'follow') {
      teams = matchTeams(await getTeams(LEAGUE), query);
    } else {
      const q = query.trim().toLowerCase();
      teams = (await getFollowedTeams(interaction.guildId)).filter((t) => t.name.toLowerCase().includes(q));
    }

    // Discord allows at most 25 suggestions.
    await interaction.respond(teams.slice(0, 25).map((t) => ({ name: t.name, value: t.id })));
  },

  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'list') {
      const { teams, channelId, roleId } = await getGuildSettings(interaction.guildId);
      const where = channelId
        ? `Announcements go to <#${channelId}>${roleId ? ` and ping <@&${roleId}>` : ''}.`
        : '⚠️ No announcement channel yet. Use `/sports setup` to choose one.';
      await interaction.reply({
        content:
          teams.length === 0
            ? `This server isn't following any teams yet. Use \`/sports follow\` to add one.\n${where}`
            : `**Followed teams:**\n${teams.map((t) => `• ${t.name} (${LEAGUES[t.league].name})`).join('\n')}\n${where}`,
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        content: 'You need the **Manage Server** permission to change sports settings.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (subcommand === 'setup') {
      const channel = interaction.options.getChannel('channel', true, [ChannelType.GuildText, ChannelType.GuildAnnouncement]);
      const role = interaction.options.getRole('role');
      const permissions = channel.permissionsFor(interaction.guild.members.me!);

      if (!permissions.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
        await interaction.reply({
          content: `I can't post in ${channel}. Give my role **View Channel** and **Send Messages** there, then try again.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await setAnnouncementChannel(interaction.guildId, channel.id, role?.id);
      wakeAnnouncer();

      const cantPing =
        role && !role.mentionable && !permissions.has(PermissionFlagsBits.MentionEveryone)
          ? `\n⚠️ I can't ping ${role} yet. Either turn on **Allow anyone to @mention this role**, or give me **Mention @everyone, @here, and All Roles**.`
          : '';
      await interaction.reply({
        content: `✅ Match announcements will go to ${channel}${role ? `, pinging ${role} for goals and full time` : ''}.${cantPing}`,
        allowedMentions: { parse: [] },
      });
      return;
    }

    const input = interaction.options.getString('team', true);

    if (subcommand === 'follow') {
      let teams;
      try {
        teams = await getTeams(LEAGUE);
      } catch (error) {
        console.error('Could not load teams from ESPN:', error);
        await interaction.reply({ content: "Couldn't reach ESPN right now. Try again in a moment.", flags: MessageFlags.Ephemeral });
        return;
      }

      const team = resolveTeam(teams, input);
      if (!team) {
        await interaction.reply({
          content: `Couldn't find an ${LEAGUES[LEAGUE].name} team matching \`${input}\`. Pick one from the suggestions.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const added = await followTeam(interaction.guildId, { league: LEAGUE, id: team.id, name: team.name });
      if (added) wakeAnnouncer();
      const { channelId } = await getGuildSettings(interaction.guildId);
      await interaction.reply(
        added
          ? `✅ Now following **${team.name}**.${channelId ? '' : '\nUse `/sports setup` to choose where announcements go.'}`
          : { content: `Already following **${team.name}**.`, flags: MessageFlags.Ephemeral },
      );
      return;
    }

    if (subcommand === 'unfollow') {
      const followed = await getFollowedTeams(interaction.guildId);
      const q = input.trim().toLowerCase();
      const team = followed.find((t) => t.id === input) ?? followed.find((t) => t.name.toLowerCase() === q);
      const removed = team && (await unfollowTeam(interaction.guildId, team.league, team.id));
      await interaction.reply(
        removed
          ? `Stopped following **${removed.name}**.`
          : { content: `This server isn't following \`${input}\`. See \`/sports list\`.`, flags: MessageFlags.Ephemeral },
      );
    }
  },
} satisfies Command;
