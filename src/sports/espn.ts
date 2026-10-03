// ESPN's public site API. It's unofficial and undocumented, so all of its URLs
// and response parsing live in this file in case it ever needs replacing.
const BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports';

// `sport` decides how matches are announced and formatted (see announcer.ts and format.ts).
export const LEAGUES = {
  mls: { name: 'MLS', path: 'soccer/usa.1', sport: 'soccer' },
  nba: { name: 'NBA', path: 'basketball/nba', sport: 'basketball' },
} as const;

export type LeagueKey = keyof typeof LEAGUES;
export const LEAGUE_KEYS = Object.keys(LEAGUES) as LeagueKey[];

export function isLeagueKey(value: string): value is LeagueKey {
  return value in LEAGUES;
}

export interface Team {
  league: LeagueKey;
  id: string;
  name: string;
  shortName: string;
  abbreviation: string;
  color?: string; // Hex without the #, e.g. "5d9741"
}

export interface MatchSide {
  id: string;
  name: string;
  abbreviation: string;
  score: number;
  winner: boolean;
  topScorer?: { name: string; points: string }; // Basketball only.
}

export interface Goal {
  teamId: string;
  minute: string;
  scorer: string | undefined;
  penalty: boolean;
  ownGoal: boolean;
}

export interface Match {
  league: LeagueKey;
  id: string;
  kickoff: Date;
  state: 'pre' | 'in' | 'post';
  // e.g. STATUS_FIRST_HALF, STATUS_HALFTIME, STATUS_FULL_TIME (soccer),
  // STATUS_IN_PROGRESS, STATUS_END_PERIOD, STATUS_FINAL (basketball), STATUS_POSTPONED
  statusName: string;
  statusDetail: string; // e.g. "45'+2'", "HT", "FT", "5:32 - 3rd", "Final"
  completed: boolean;
  period: number; // Half or quarter; above 4 means overtime in basketball.
  home: MatchSide;
  away: MatchSide;
  goals: Goal[]; // Soccer only. In order; penalty shootout kicks aren't included.
  broadcasts: string[];
}

interface RawTeam {
  id: string;
  displayName: string;
  shortDisplayName: string;
  abbreviation: string;
  color?: string;
}

interface RawEvent {
  id: string;
  date: string;
  competitions: {
    status: {
      period?: number;
      type: { name: string; state: Match['state']; completed: boolean; shortDetail: string };
    };
    competitors: {
      id: string;
      homeAway: 'home' | 'away';
      winner?: boolean;
      // A string on the scoreboard, an object on team schedules, missing before kickoff.
      score?: string | { displayValue: string };
      team: RawTeam;
      leaders?: { name: string; leaders: { displayValue: string; athlete: { displayName: string } }[] }[];
    }[];
    details?: {
      scoringPlay: boolean;
      shootout: boolean;
      penaltyKick: boolean;
      ownGoal: boolean;
      clock?: { displayValue: string };
      team?: { id: string };
      athletesInvolved?: { displayName: string }[];
    }[];
    // The scoreboard uses { names }, team endpoints use { media: { shortName } }.
    broadcasts?: { names?: string[]; media?: { shortName?: string } }[];
  }[];
}

async function getJson<T>(url: string, timeoutMs: number): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`ESPN request failed with HTTP ${response.status}: ${url}`);
  return (await response.json()) as T;
}

function parseMatch(league: LeagueKey, event: RawEvent): Match {
  const competition = event.competitions[0]!;
  const side = (homeAway: 'home' | 'away'): MatchSide => {
    const c = competition.competitors.find((c) => c.homeAway === homeAway)!;
    const score = typeof c.score === 'object' ? c.score.displayValue : c.score;
    const points = c.leaders?.find((l) => l.name === 'points')?.leaders[0];
    return {
      id: c.id,
      name: c.team.displayName,
      abbreviation: c.team.abbreviation,
      score: Number(score) || 0,
      winner: c.winner ?? false,
      topScorer: points && { name: points.athlete.displayName, points: points.displayValue },
    };
  };

  return {
    league,
    id: event.id,
    kickoff: new Date(event.date),
    state: competition.status.type.state,
    statusName: competition.status.type.name,
    statusDetail: competition.status.type.shortDetail,
    completed: competition.status.type.completed,
    period: competition.status.period ?? 0,
    home: side('home'),
    away: side('away'),
    goals: (competition.details ?? [])
      .filter((d) => d.scoringPlay && !d.shootout)
      .map((d) => ({
        teamId: d.team?.id ?? '',
        minute: d.clock?.displayValue ?? '',
        scorer: d.athletesInvolved?.[0]?.displayName,
        penalty: d.penaltyKick,
        ownGoal: d.ownGoal,
      })),
    broadcasts: [...new Set((competition.broadcasts ?? []).flatMap((b) => b.names ?? [b.media?.shortName ?? '']))].filter(Boolean),
  };
}

// Team lists barely change, so one fetch a day is plenty.
const TEAMS_TTL_MS = 24 * 60 * 60 * 1000;
const teamsCache = new Map<LeagueKey, { teams: Team[]; fetchedAt: number }>();

// The default timeouts are short because autocomplete and command replies
// must answer within 3 seconds.
export async function getTeams(league: LeagueKey): Promise<Team[]> {
  const cached = teamsCache.get(league);
  if (cached && Date.now() - cached.fetchedAt < TEAMS_TTL_MS) return cached.teams;

  const body = await getJson<{ sports: { leagues: { teams: { team: RawTeam }[] }[] }[] }>(
    `${BASE_URL}/${LEAGUES[league].path}/teams`,
    2500,
  );
  const teams = (body.sports[0]?.leagues[0]?.teams ?? []).map(({ team }) => ({
    league,
    id: team.id,
    name: team.displayName,
    shortName: team.shortDisplayName,
    abbreviation: team.abbreviation,
    color: team.color,
  }));
  teamsCache.set(league, { teams, fetchedAt: Date.now() });
  return teams;
}

// Teams from every league. A league that fails to load is left out rather than failing the lot.
export async function getAllTeams(): Promise<Team[]> {
  const results = await Promise.allSettled(LEAGUE_KEYS.map(getTeams));
  const teams = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  if (teams.length === 0) throw new Error('Could not load teams for any league');
  return teams;
}

// Today's matches (ESPN's "today" follows US Eastern time).
export async function getScoreboard(league: LeagueKey, timeoutMs = 2500): Promise<Match[]> {
  const body = await getJson<{ events: RawEvent[] }>(`${BASE_URL}/${LEAGUES[league].path}/scoreboard`, timeoutMs);
  return body.events.map((e) => parseMatch(league, e));
}

// This season's matches that have already been played.
export async function getTeamResults(league: LeagueKey, teamId: string, timeoutMs = 2500): Promise<Match[]> {
  const body = await getJson<{ events?: RawEvent[] }>(
    `${BASE_URL}/${LEAGUES[league].path}/teams/${teamId}/schedule`,
    timeoutMs,
  );
  return (body.events ?? []).map((e) => parseMatch(league, e)).filter((m) => m.state === 'post');
}

export async function getNextMatch(league: LeagueKey, teamId: string, timeoutMs = 2500): Promise<Match | undefined> {
  const body = await getJson<{ team: { nextEvent?: RawEvent[] } }>(
    `${BASE_URL}/${LEAGUES[league].path}/teams/${teamId}`,
    timeoutMs,
  );
  const next = body.team.nextEvent?.[0];
  return next && parseMatch(league, next);
}
