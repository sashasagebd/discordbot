import { MessageFlags, type Client } from 'discord.js';
import { getScoreboard, LEAGUES, type LeagueKey, type Match } from './espn.js';
import { formatGoal, matchExtras, matchup, periodLabel, scoreline, shootoutNote } from './format.js';
import { getAllGuildSettings } from './store.js';

// Check often while a followed match is live, and rarely otherwise.
const LIVE_INTERVAL_MS = 30_000;
const IDLE_INTERVAL_MS = 15 * 60_000;
const RETRY_INTERVAL_MS = 60_000;
// Start checking often this long before kickoff, so the kickoff message is on time.
const KICKOFF_LEAD_MS = 5 * 60_000;

interface Snapshot {
  state: Match['state'];
  statusName: string;
  period: number;
  home: number;
  away: number;
  goalCount: number;
}

interface Update {
  text: string;
  ping: boolean; // false = silent message that never notifies anyone
}

// The last state seen for each match on today's scoreboard. Kept in memory only:
// after a restart the first check just records the current state, so goals that
// were already announced aren't announced again.
const snapshots = new Map<LeagueKey, Map<string, Snapshot>>();

let client: Client<true> | undefined;
let timer: NodeJS.Timeout | undefined;
let running = false;
let stopped = false;

export function startAnnouncer(readyClient: Client<true>): void {
  client = readyClient;
  void run();
}

export function stopAnnouncer(): void {
  stopped = true;
  clearTimeout(timer);
}

// Check right away instead of waiting out a long idle sleep, e.g. after a team
// is followed shortly before kickoff.
export function wakeAnnouncer(): void {
  if (!client || running || stopped) return;
  clearTimeout(timer);
  void run();
}

async function run(): Promise<void> {
  running = true;
  let delay: number;
  try {
    delay = await check(client!);
  } catch (error) {
    console.error('Sports announcer check failed:', error);
    delay = RETRY_INTERVAL_MS;
  } finally {
    running = false;
  }
  if (!stopped) timer = setTimeout(() => void run(), delay);
}

// Returns how long to wait before the next check.
async function check(client: Client<true>): Promise<number> {
  const guilds = (await getAllGuildSettings()).filter(([, s]) => s.channelId && s.teams.length > 0);
  const leagues = new Set(guilds.flatMap(([, s]) => s.teams.map((t) => t.league)));
  let delay = IDLE_INTERVAL_MS;

  for (const league of leagues) {
    let matches: Match[];
    try {
      matches = await getScoreboard(league, 10_000);
    } catch (error) {
      // One league failing shouldn't hold up the others. Keep its old snapshots and retry soon.
      console.error(`Could not load the ${LEAGUES[league].name} scoreboard:`, error);
      delay = Math.min(delay, RETRY_INTERVAL_MS);
      continue;
    }
    const previous = snapshots.get(league);
    const current = new Map<string, Snapshot>();

    for (const match of matches) {
      current.set(match.id, snapshot(match));

      const followers = guilds.filter(([, s]) =>
        s.teams.some((t) => t.league === league && (t.id === match.home.id || t.id === match.away.id)),
      );
      if (followers.length === 0) continue;
      delay = Math.min(delay, delayFor(match));

      const before = previous?.get(match.id);
      if (!before) continue;
      for (const update of describeChanges(before, match)) {
        for (const [, settings] of followers) {
          // Ping the roles of whichever followed teams are playing (both, if they play each other).
          const roleIds = settings.teams
            .filter((t) => t.league === league && (t.id === match.home.id || t.id === match.away.id) && t.roleId)
            .map((t) => t.roleId!);
          await post(client, settings.channelId!, update, roleIds);
        }
      }
    }

    // Replacing the map drops matches that have left the scoreboard.
    snapshots.set(league, current);
  }

  return delay;
}

function snapshot(match: Match): Snapshot {
  return {
    state: match.state,
    statusName: match.statusName,
    period: match.period,
    home: match.home.score,
    away: match.away.score,
    goalCount: match.goals.length,
  };
}

function delayFor(match: Match): number {
  if (match.state === 'in') return LIVE_INTERVAL_MS;
  if (match.state === 'pre') {
    // Goes negative once kickoff is near or the match is running late, so this
    // settles on the live interval until the match actually starts.
    return Math.max(LIVE_INTERVAL_MS, match.kickoff.getTime() - Date.now() - KICKOFF_LEAD_MS);
  }
  return IDLE_INTERVAL_MS;
}

function describeChanges(before: Snapshot, match: Match): Update[] {
  return LEAGUES[match.league].sport === 'basketball' ? describeBasketball(before, match) : describeSoccer(before, match);
}

// Soccer: silent kickoff and half time; goals and full time ping.
function describeSoccer(before: Snapshot, match: Match): Update[] {
  const updates: Update[] = [];

  if (before.state === 'pre' && match.state === 'in') {
    updates.push({ text: `🟢 **Kickoff:** ${matchup(match)}`, ping: false });
  }

  const homeScored = match.home.score > before.home;
  const awayScored = match.away.score > before.away;
  if (homeScored || awayScored) {
    const scorers = [homeScored && match.home.name, awayScored && match.away.name].filter(Boolean).join(' & ');
    // ESPN sometimes adds the scorer a little after the score changes. If it's
    // missing here, the full-time message still lists every goal.
    const newGoals = match.goals.slice(before.goalCount).map((g) => `\n${formatGoal(match, g)}`).join('');
    updates.push({ text: `⚽ **GOAL — ${scorers}!**\n${scoreline(match)}${newGoals}`, ping: true });
  } else if (match.home.score < before.home || match.away.score < before.away) {
    updates.push({ text: `↩️ **Goal disallowed.** ${scoreline(match)}`, ping: false });
  }

  if (match.statusName === 'STATUS_HALFTIME' && before.statusName !== 'STATUS_HALFTIME') {
    updates.push({ text: `⏸️ **Half time:** ${scoreline(match)}`, ping: false });
  }

  if (before.state !== 'post' && match.state === 'post') {
    updates.push(
      match.completed
        ? { text: `🏁 **Full time:** ${scoreline(match)}${shootoutNote(match)}${matchExtras(match)}`, ping: true }
        : notPlayed(match),
    );
  }

  return updates;
}

// Basketball scores change every few seconds, so only the final score pings.
// Tip-off and the end of each quarter are silent.
function describeBasketball(before: Snapshot, match: Match): Update[] {
  const updates: Update[] = [];

  if (before.state === 'pre' && match.state === 'in') {
    updates.push({ text: `🏀 **Tip-off:** ${matchup(match)}`, ping: false });
  }

  // ESPN shows STATUS_END_PERIOD (or STATUS_HALFTIME) for the break after each quarter.
  const isBreak = (statusName: string) => statusName === 'STATUS_END_PERIOD' || statusName === 'STATUS_HALFTIME';
  if (match.state === 'in' && isBreak(match.statusName) && !(isBreak(before.statusName) && before.period === match.period)) {
    const label = match.period === 2 ? 'Half time' : `End of ${periodLabel(match.period)}`;
    const tied = match.period >= 4 && match.home.score === match.away.score ? ' — tied, heading to overtime!' : '';
    updates.push({ text: `⏱️ **${label}:** ${scoreline(match)}${tied}`, ping: false });
  }

  if (before.state !== 'post' && match.state === 'post') {
    const overtime = match.period > 4 ? ` (${periodLabel(match.period)})` : '';
    updates.push(
      match.completed
        ? { text: `🏁 **Final${overtime}:** ${scoreline(match)}${matchExtras(match)}`, ping: true }
        : notPlayed(match),
    );
  }

  return updates;
}

// Postponed, abandoned, etc.
function notPlayed(match: Match): Update {
  return { text: `⚠️ **${matchup(match)}:** ${match.statusDetail}`, ping: false };
}

async function post(client: Client<true>, channelId: string, update: Update, roleIds: string[]): Promise<void> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isSendable()) return;

    const pinged = update.ping ? roleIds : [];
    const mentions = pinged.map((id) => `<@&${id}> `).join('');
    await channel.send({
      content: `${mentions}${update.text}`,
      allowedMentions: { roles: pinged },
      flags: update.ping ? undefined : MessageFlags.SuppressNotifications,
    });
  } catch (error) {
    // Deleted channel, missing permissions, etc. Don't let one server block the others.
    console.error(`Couldn't post sports update to channel ${channelId}:`, error);
  }
}
