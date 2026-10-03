import type { Goal, Match, Team } from './espn.js';

export function matchTeams(teams: Team[], query: string): Team[] {
  const q = query.trim().toLowerCase();
  if (!q) return teams;
  return teams.filter((t) => [t.name, t.shortName, t.abbreviation].some((s) => s.toLowerCase().includes(q)));
}

// Autocomplete sends the team ID, but people can also type a name and press enter
// without picking a suggestion, so fall back to matching the text.
export function resolveTeam(teams: Team[], input: string): Team | undefined {
  const byId = teams.find((t) => t.id === input);
  if (byId) return byId;

  const q = input.trim().toLowerCase();
  const exact = teams.find((t) => [t.name, t.shortName, t.abbreviation].some((s) => s.toLowerCase() === q));
  if (exact) return exact;

  const partial = matchTeams(teams, input);
  return partial.length === 1 ? partial[0] : undefined;
}

// "Seattle Sounders FC **2–1** Sporting Kansas City" (home team first, as in soccer).
export function scoreline(match: Match): string {
  return `${match.home.name} **${match.home.score}–${match.away.score}** ${match.away.name}`;
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

// One line for /score. Discord's <t:...> timestamps show in each viewer's own time zone.
export function describeMatch(match: Match): string {
  if (match.state === 'pre') {
    const tv = match.broadcasts.length ? ` · 📺 ${match.broadcasts.join(', ')}` : '';
    return `${match.home.name} vs ${match.away.name} — <t:${Math.floor(match.kickoff.getTime() / 1000)}:f>${tv}`;
  }
  const live = match.state === 'in' ? '🔴 ' : '';
  const goals = match.goals.length ? `\n-# ⚽ ${formatGoals(match)}` : '';
  return `${live}${scoreline(match)} (${match.statusDetail})${shootoutNote(match)}${goals}`;
}
