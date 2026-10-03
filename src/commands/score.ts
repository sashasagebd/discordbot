import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { getNextMatch, getScoreboard, getTeamResults, getTeams, LEAGUES, type LeagueKey, type Match } from '../sports/espn.js';
import { describeMatch, matchTeams, resolveTeam } from '../sports/format.js';

const LEAGUE: LeagueKey = 'mls';
const TIMEOUT_MS = 8000; // The reply is deferred, so there's more time than in autocomplete.

export default {
  data: new SlashCommandBuilder()
    .setName('score')
    .setDescription("Show today's MLS scores, or a team's latest result and next match.")
    .addStringOption((option) =>
      option.setName('team').setDescription('Team name (leave out for all of today\'s matches)').setAutocomplete(true),
    ),

  async autocomplete(interaction) {
    const teams = matchTeams(await getTeams(LEAGUE), interaction.options.getFocused());
    await interaction.respond(teams.slice(0, 25).map((t) => ({ name: t.name, value: t.id })));
  },

  async execute(interaction) {
    await interaction.deferReply();
    const input = interaction.options.getString('team');
    const leagueName = LEAGUES[LEAGUE].name;

    try {
      if (!input) {
        const matches = await getScoreboard(LEAGUE, TIMEOUT_MS);
        await interaction.editReply(
          matches.length === 0
            ? `No ${leagueName} matches today. Try \`/score team:\` for a team's next match.`
            : `**${leagueName} today:**\n${matches.map(describeMatch).join('\n')}`,
        );
        return;
      }

      const team = resolveTeam(await getTeams(LEAGUE), input);
      if (!team) {
        await interaction.editReply(`Couldn't find an ${leagueName} team matching \`${input}\`. Pick one from the suggestions.`);
        return;
      }

      const [today, results, next] = await Promise.all([
        getScoreboard(LEAGUE, TIMEOUT_MS),
        getTeamResults(LEAGUE, team.id, TIMEOUT_MS),
        getNextMatch(LEAGUE, team.id, TIMEOUT_MS),
      ]);
      const involves = (m: Match) => m.home.id === team.id || m.away.id === team.id;
      const todays = today.find(involves);
      const last = results
        .filter((m) => m.completed && m.id !== todays?.id)
        .sort((a, b) => b.kickoff.getTime() - a.kickoff.getTime())[0];

      const lines = [`**${team.name}**`];
      if (todays) lines.push(`**Today:** ${describeMatch(todays)}`);
      if (last) lines.push(`**Last result:** ${describeMatch(last)}`);
      if (next && next.id !== todays?.id) lines.push(`**Next match:** ${describeMatch(next)}`);
      if (lines.length === 1) lines.push('No recent or upcoming matches found.');
      await interaction.editReply(lines.join('\n'));
    } catch (error) {
      console.error('Could not load scores from ESPN:', error);
      await interaction.editReply("Couldn't reach ESPN right now. Try again in a moment.");
    }
  },
} satisfies Command;
