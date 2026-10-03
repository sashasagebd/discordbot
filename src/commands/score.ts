import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import {
  getAllTeams,
  getNextMatch,
  getScoreboard,
  getTeamResults,
  LEAGUE_KEYS,
  LEAGUES,
  type LeagueKey,
  type Match,
} from '../sports/espn.js';
import { describeMatch, fitMessage, matchTeams, resolveTeam, teamLabel, teamValue } from '../sports/format.js';

const TIMEOUT_MS = 8000; // The reply is deferred, so there's more time than in autocomplete.

export default {
  data: new SlashCommandBuilder()
    .setName('score')
    .setDescription("Show today's scores, or a team's latest result and next game.")
    .addStringOption((option) =>
      option.setName('team').setDescription("Team name (leave out for all of today's games)").setAutocomplete(true),
    )
    .addStringOption((option) =>
      option
        .setName('league')
        .setDescription('Only show this league (when no team is given)')
        .addChoices(LEAGUE_KEYS.map((key) => ({ name: LEAGUES[key].name, value: key }))),
    ),

  async autocomplete(interaction) {
    const teams = matchTeams(await getAllTeams(), interaction.options.getFocused());
    await interaction.respond(teams.slice(0, 25).map((t) => ({ name: teamLabel(t), value: teamValue(t) })));
  },

  async execute(interaction) {
    await interaction.deferReply();
    const input = interaction.options.getString('team');

    try {
      if (!input) {
        const leagues = (interaction.options.getString('league') as LeagueKey | null) ?? undefined;
        const sections = await Promise.all(
          (leagues ? [leagues] : LEAGUE_KEYS).map(async (league) => {
            const matches = await getScoreboard(league, TIMEOUT_MS);
            const name = LEAGUES[league].name;
            return matches.length ? `**${name} today:**\n${matches.map(describeMatch).join('\n')}` : `No ${name} games today.`;
          }),
        );
        await interaction.editReply(fitMessage(sections.join('\n\n')));
        return;
      }

      const team = resolveTeam(await getAllTeams(), input);
      if (!team) {
        await interaction.editReply(`Couldn't find a single team matching \`${input}\`. Pick one from the suggestions.`);
        return;
      }

      const [today, results, next] = await Promise.all([
        getScoreboard(team.league, TIMEOUT_MS),
        getTeamResults(team.league, team.id, TIMEOUT_MS),
        getNextMatch(team.league, team.id, TIMEOUT_MS),
      ]);
      const involves = (m: Match) => m.home.id === team.id || m.away.id === team.id;
      const todays = today.find(involves);
      const last = results
        .filter((m) => m.completed && m.id !== todays?.id)
        .sort((a, b) => b.kickoff.getTime() - a.kickoff.getTime())[0];

      const lines = [`**${teamLabel(team)}**`];
      if (todays) lines.push(`**Today:** ${describeMatch(todays)}`);
      if (last) lines.push(`**Last result:** ${describeMatch(last)}`);
      if (next && next.id !== todays?.id) lines.push(`**Next game:** ${describeMatch(next)}`);
      if (lines.length === 1) lines.push('No recent or upcoming games found.');
      await interaction.editReply(fitMessage(lines.join('\n')));
    } catch (error) {
      console.error('Could not load scores from ESPN:', error);
      await interaction.editReply("Couldn't reach ESPN right now. Try again in a moment.");
    }
  },
} satisfies Command;
