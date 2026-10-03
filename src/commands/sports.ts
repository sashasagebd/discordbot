import {
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type InteractionReplyOptions,
} from 'discord.js';
import type { Command } from '../types.js';
import { getAllTeams } from '../sports/espn.js';
import { matchTeams, pingSummary, resolveTeam, teamLabel, teamValue } from '../sports/format.js';
import { wakeAnnouncer } from '../sports/announcer.js';
import { allowChannel, joinTeam, leaveTeam, permissionHelp, removeTeamForEveryone } from '../sports/membership.js';
import { buildRolePicker, handlePickerButton, isPickerButton, refreshRolePicker } from '../sports/rolePicker.js';
import { getGuildSettings, setAnnouncementChannel, setRolePicker } from '../sports/store.js';

const textChannelTypes = [ChannelType.GuildText, ChannelType.GuildAnnouncement] as const;
const ADMIN_SUBCOMMANDS = new Set(['setup', 'rolepicker', 'remove']);

const ephemeral = (content: string): InteractionReplyOptions => ({
  content,
  flags: MessageFlags.Ephemeral,
  allowedMentions: { parse: [] },
});

export default {
  data: new SlashCommandBuilder()
    .setName('sports')
    .setDescription('Follow MLS and NBA teams to get pinged for their games.')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) =>
      sub
        .setName('follow')
        .setDescription('Follow an MLS or NBA team: see the sports channel and get pinged for its games.')
        .addStringOption((option) =>
          option.setName('team').setDescription('Team name').setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('unfollow')
        .setDescription('Stop following a team.')
        .addStringOption((option) =>
          option.setName('team').setDescription('Team name').setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Show which teams people here follow.'))
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('Choose where announcements go (needs Manage Server).')
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('Channel for match announcements')
            .addChannelTypes(...textChannelTypes)
            .setRequired(true),
        )
        .addRoleOption((option) =>
          option.setName('watch_role').setDescription('Role that can see the channel without getting pinged'),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('rolepicker')
        .setDescription('Post buttons for following the teams people here already follow (needs Manage Server).')
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('Where to post it (defaults to this channel)')
            .addChannelTypes(...textChannelTypes),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Stop covering a team for everyone and delete its role (needs Manage Server).')
        .addStringOption((option) =>
          option.setName('team').setDescription('Team name').setRequired(true).setAutocomplete(true),
        ),
    ),

  async autocomplete(interaction) {
    if (!interaction.inGuild()) return;
    const query = interaction.options.getFocused();
    const subcommand = interaction.options.getSubcommand();

    let choices;
    if (subcommand === 'follow') {
      choices = matchTeams(await getAllTeams(), query);
    } else {
      // unfollow: only your teams. remove: every team the server follows.
      const { teams } = await getGuildSettings(interaction.guildId);
      choices = matchTeams(
        teams.filter((t) => subcommand === 'remove' || t.memberIds.includes(interaction.user.id)),
        query,
      );
    }

    // Discord allows at most 25 suggestions.
    await interaction.respond(choices.slice(0, 25).map((t) => ({ name: teamLabel(t), value: teamValue(t) })));
  },

  async handleComponent(interaction) {
    if (interaction.isButton() && interaction.inCachedGuild() && isPickerButton(interaction.customId)) {
      await handlePickerButton(interaction);
    }
  },

  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const subcommand = interaction.options.getSubcommand();
    const { guild, guildId, member } = interaction;

    if (ADMIN_SUBCOMMANDS.has(subcommand) && !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply(ephemeral('You need the **Manage Server** permission for that.'));
      return;
    }

    try {
      if (subcommand === 'follow') {
        let teams;
        try {
          teams = await getAllTeams();
        } catch (error) {
          console.error('Could not load teams from ESPN:', error);
          await interaction.reply(ephemeral("Couldn't reach ESPN right now. Try again in a moment."));
          return;
        }

        const input = interaction.options.getString('team', true);
        const team = resolveTeam(teams, input);
        if (!team) {
          await interaction.reply(
            ephemeral(`Couldn't find a single team matching \`${input}\`. Pick one from the suggestions.`),
          );
          return;
        }

        // Creating a role and editing channel permissions can take a moment.
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const result = await joinTeam(member, team);
        if (result.newTeam) {
          wakeAnnouncer();
          await refreshRolePicker(guild);
        }

        const { channelId } = await getGuildSettings(guildId);
        const lines = [
          result.alreadyFollowing
            ? `You already follow **${team.name}**.`
            : `✅ You're following **${teamLabel(team)}**. You'll be pinged for ${pingSummary(team.league)}${channelId ? ` in <#${channelId}>` : ''}.`,
        ];
        if (!channelId) lines.push('-# Announcements start once an admin picks a channel with `/sports setup`.');
        if (!result.channelAccess) {
          lines.push(`⚠️ I couldn't give ${result.role} access to <#${channelId}>. An admin needs to allow **View Channel** for it there.`);
        }
        await interaction.editReply({ content: lines.join('\n'), allowedMentions: { parse: [] } });
        return;
      }

      if (subcommand === 'unfollow') {
        const input = interaction.options.getString('team', true);
        const mine = (await getGuildSettings(guildId)).teams.filter((t) => t.memberIds.includes(member.id));
        const team = resolveTeam(mine, input);
        if (!team) {
          await interaction.reply(ephemeral(`You don't follow \`${input}\`. See \`/sports list\`.`));
          return;
        }

        const result = await leaveTeam(member, team.league, team.id);
        if (result?.teamRemoved) await refreshRolePicker(guild);
        await interaction.reply(ephemeral(`Unfollowed **${team.name}**.`));
        return;
      }

      if (subcommand === 'list') {
        const { teams, channelId, watchRoleId } = await getGuildSettings(guildId);
        const lines = [
          teams.length
            ? `**Teams followed here:**\n${teams
                .map((t) => {
                  const fans = `${t.memberIds.length} ${t.memberIds.length === 1 ? 'fan' : 'fans'}`;
                  return `• ${teamLabel(t)} — ${fans}${t.memberIds.includes(member.id) ? ' (including you)' : ''}`;
                })
                .join('\n')}`
            : 'Nobody here follows a team yet. Use `/sports follow` to be the first.',
          channelId ? `Announcements go to <#${channelId}>.` : '⚠️ No announcement channel yet (an admin can set one with `/sports setup`).',
        ];
        if (watchRoleId) lines.push(`Watch-only role: <@&${watchRoleId}>`);
        await interaction.reply(ephemeral(lines.join('\n')));
        return;
      }

      if (subcommand === 'setup') {
        const channel = interaction.options.getChannel('channel', true, [...textChannelTypes]);
        const watchRole = interaction.options.getRole('watch_role');
        const me = guild.members.me!;

        if (!channel.permissionsFor(me).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
          await interaction.reply(ephemeral(`I can't post in ${channel}. Give my role **View Channel** and **Send Messages** there, then try again.`));
          return;
        }
        if (watchRole && (watchRole.id === guildId || watchRole.managed)) {
          await interaction.reply(ephemeral("Pick a normal role for watch-only, not @everyone or a bot's role."));
          return;
        }

        await interaction.deferReply();
        await setAnnouncementChannel(guildId, channel.id, watchRole?.id);

        // Let every existing team role (and the watch-only role) see the new channel.
        const { teams } = await getGuildSettings(guildId);
        const roleIds = [...teams.map((t) => t.roleId), ...(watchRole ? [watchRole.id] : [])];
        const results = await Promise.all(roleIds.map((id) => allowChannel(guild, channel.id, id)));
        wakeAnnouncer();
        await refreshRolePicker(guild);

        const lines = [`✅ Match announcements will go to ${channel}.${watchRole ? ` Watch-only role: ${watchRole}.` : ''}`];
        if (results.includes(false)) {
          lines.push("⚠️ I couldn't give every team role access to the channel. Make sure I have **Manage Roles** and can see the channel.");
        }
        if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
          lines.push("⚠️ I don't have **Manage Roles**, so people can't follow teams yet.");
        } else if (watchRole && me.roles.highest.comparePositionTo(watchRole) <= 0) {
          lines.push(`⚠️ My role is below ${watchRole}, so I can't hand it out. Drag my role above it in Server Settings → Roles.`);
        }
        if (channel.permissionsFor(guild.roles.everyone).has(PermissionFlagsBits.ViewChannel)) {
          lines.push(`-# Everyone can see ${channel} right now. To make it followers-only, deny **View Channel** for @everyone there.`);
        }
        await interaction.editReply({ content: lines.join('\n'), allowedMentions: { parse: [] } });
        return;
      }

      if (subcommand === 'rolepicker') {
        const channel = interaction.options.getChannel('channel', false, [...textChannelTypes]) ?? interaction.channel;
        if (!channel?.permissionsFor(guild.members.me!).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
          await interaction.reply(ephemeral("I can't post in that channel."));
          return;
        }

        const message = await channel.send(buildRolePicker(await getGuildSettings(guildId)));
        // Only the newest picker is kept up to date. Buttons on older ones still work.
        await setRolePicker(guildId, { channelId: channel.id, messageId: message.id });
        await interaction.reply(ephemeral(`✅ Posted the role picker in ${channel}. It updates itself as teams are added or dropped.`));
        return;
      }

      if (subcommand === 'remove') {
        const input = interaction.options.getString('team', true);
        const team = resolveTeam((await getGuildSettings(guildId)).teams, input);
        if (!team) {
          await interaction.reply(ephemeral(`Nobody here follows \`${input}\`. See \`/sports list\`.`));
          return;
        }

        await removeTeamForEveryone(guild, team);
        await refreshRolePicker(guild);
        await interaction.reply(ephemeral(`Removed **${team.name}** and its role. Anyone can follow it again later.`));
      }
    } catch (error) {
      const help = permissionHelp(error);
      if (!help) throw error;
      if (interaction.deferred) await interaction.editReply(help);
      else await interaction.reply(ephemeral(help));
    }
  },
} satisfies Command;
