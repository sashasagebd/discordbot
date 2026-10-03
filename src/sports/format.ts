import { LEAGUES, type Goal, type LeagueKey, type Match } from './espn.js';

interface TeamLike {
  league: LeagueKey;
  id: string;
  name: string;
  shortName?: string;
  abbreviation?: string;
}

// Team IDs are only unique within a league, so autocomplete values carry both.
export function teamValue(team: TeamLike): string {
  return `${team.league}:${team.id}`;
}

export function teamLabel(team: TeamLike): string {
  return `${team.name} (${LEAGUES[team.league].name})`;
}

const searchable = (t: TeamLike) => [t.name, t.shortName, t.abbreviation].filter((s): s is string => !!s);

export function matchTeams<T extends TeamLike>(teams: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return teams;
  return teams.filter((t) => searchable(t).some((s) => s.toLowerCase().includes(q)));
}

// Autocomplete sends "league:id", but people can also type a name and press enter
// without picking a suggestion, so fall back to matching the text. Names that
// fit more than one team (e.g. "MIN" is in both leagues) don't resolve.
export function resolveTeam<T extends TeamLike>(teams: T[], input: string): T | undefined {
  const byValue = teams.find((t) => teamValue(t) === input);
  if (byValue) return byValue;

  const q = input.trim().toLowerCase();
  const exact = teams.filter((t) => searchable(t).some((s) => s.toLowerCase() === q));
  if (exact.length > 0) return exact.length === 1 ? exact[0] : undefined;

  const partial = matchTeams(teams, input);
  return partial.length === 1 ? partial[0] : undefined;
}

const isBasketball = (match: Match) => LEAGUES[match.league].sport === 'basketball';

// What followers of a team in this league get pinged for (see announcer.ts).
export function pingSummary(league: LeagueKey): string {
  return LEAGUES[league].sport === 'basketball' ? 'its final scores' : 'its goals and full time';
}

// Soccer lists the home team first: "Seattle Sounders FC **2–1** Sporting Kansas City".
// US sports list the away team first: "Minnesota Timberwolves **98** @ **112** Oklahoma City Thunder".
export function scoreline(match: Match): string {
  const { home, away } = match;
  return isBasketball(match)
    ? `${away.name} **${away.score}** @ **${home.score}** ${home.name}`
    : `${home.name} **${home.score}–${away.score}** ${away.name}`;
}

export function matchup(match: Match): string {
  return isBasketball(match) ? `${match.away.name} @ ${match.home.name}` : `${match.home.name} vs ${match.away.name}`;
}

// Basketball periods: 1–4 are quarters, then OT, 2OT, ...
export function periodLabel(period: number): string {
  if (period <= 4) return `Q${period}`;
  return period === 5 ? 'OT' : `${period - 4}OT`;
}

// "Chet Holmgren 21 (OKC) · Anthony Edwards 30 (MIN)"
export function topScorers(match: Match): string {
  return [match.away, match.home]
    .filter((side) => side.topScorer)
    .map((side) => `${side.topScorer!.name} ${side.topScorer!.points} (${side.abbreviation})`)
    .join(' · ');
}

export function formatGoal(match: Match, goal: Goal): string {
  const team = goal.teamId === match.home.id ? match.home : goal.teamId === match.away.id ? match.away : undefined;
  const notes = [goal.penalty && 'pen', goal.ownGoal && 'OG', team?.abbreviation].filter(Boolean).join(', ');
  return `${goal.minute} ${goal.scorer ?? 'Unknown'}${notes ? ` (${notes})` : ''}`;
}

export function formatGoals(match: Match): string {
  return match.goals.map((g) => formatGoal(match, g)).join(' · ');
}

// Knockout matches level after extra time go to a shootout, which isn't part of the score.
export function shootoutNote(match: Match): string {
  if (!match.completed || match.home.score !== match.away.score) return '';
  const winner = match.home.winner ? match.home : match.away.winner ? match.away : undefined;
  return winner ? ` — ${winner.name} win on penalties` : '';
}

// The small grey line under a result: goalscorers or top scorers.
export function matchExtras(match: Match): string {
  if (isBasketball(match)) {
    const scorers = match.state === 'post' ? topScorers(match) : '';
    return scorers ? `\n-# 🏀 Top scorers: ${scorers}` : '';
  }
  return match.goals.length ? `\n-# ⚽ ${formatGoals(match)}` : '';
}

// One line for /score. Discord's <t:...> timestamps show in each viewer's own time zone.
export function describeMatch(match: Match): string {
  if (match.state === 'pre') {
    const tv = match.broadcasts.length ? ` · 📺 ${match.broadcasts.join(', ')}` : '';
    return `${matchup(match)} — <t:${Math.floor(match.kickoff.getTime() / 1000)}:f>${tv}`;
  }
  const live = match.state === 'in' ? '🔴 ' : '';
  return `${live}${scoreline(match)} (${match.statusDetail})${shootoutNote(match)}${matchExtras(match)}`;
}

// Discord rejects messages over 2000 characters.
export function fitMessage(text: string, limit = 2000): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 2)}\n…`;
}
