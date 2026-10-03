# Sports score announcements — plan

Status: MLS built and running (2026-10-02). NBA added the same day (not yet deployed or tested in Discord). Live announcements haven't been seen yet for either league; only simulated games were tested.

The code is in `src/sports/` (ESPN data, storage, membership, role picker, announcer, formatting), `src/commands/sports.ts` and `src/commands/score.ts`.

## Next steps
- Watch the first live match of a followed team. The Sounders play at New England on Sat Oct 10, 7:30 PM ET. Check that kickoff is silent, goals ping the right role, and full time lists the scorers. If anything's off, run `docker compose logs -f` on the server.
- NBA regular season starts around Oct 20. Check the first followed game: silent tip-off and quarter breaks, one ping at the final.
- Possible NBA extra (not built): a "close game" ping, e.g. within 5 points in the last 2 minutes.
- Other leagues: add a line to `LEAGUES` (`src/sports/espn.ts`) with its `sport`. Team search, `/score` and following pick it up automatically. Other soccer and basketball leagues (e.g. Premier League, WNBA) work as-is; a new sport (NFL, NHL) needs its own `describe...` function in `announcer.ts`.

## Commands
**Anyone**
- `/sports follow team:` follows any MLS or NBA team. One search covers both leagues; suggestions show "(MLS)" or "(NBA)", and ambiguous names like "MIN" must be picked from the list. The first follower makes the bot create that team's role (in the club's colour) and give it access to the announcement channel. Later followers get the same role.
- `/sports unfollow team:` stops following. When a team's last follower leaves, the bot deletes its role and stops announcing it.
- `/sports list` shows the teams people follow and how many fans each has.
- `/score` shows today's MLS and NBA games (`league:` narrows it to one). `/score team:` shows that team's match today, its last result and its next match (with TV channel).

**Admins (Manage Server)**
- `/sports setup channel: watch_role:` sets where announcements go and the optional watch-only role. Nothing is posted until a channel is set.
- `/sports rolepicker channel:` posts buttons for the teams people already follow, plus watch-only. It updates itself as teams are added or dropped.
- `/sports remove team:` stops covering a team for everyone and deletes its role.

## Decided

**Data source**
- ESPN's public site API. No API key needed.
- Leagues: MLS → `soccer/usa.1`, NBA → `basketball/nba` (`https://site.api.espn.com/apis/site/v2/sports/<path>/scoreboard`).
- Unofficial/undocumented, so it could change. All the ESPN code is in `src/sports/espn.ts`, so it's easy to swap out.

**Polling**
- Check every 30s while a followed match is live, and from 5 min before kickoff.
- Otherwise check every 15 min. A newly followed team or running setup triggers an immediate check.
- Cost is negligible: MLS ~12 KB per request. A busy NBA night is ~100 KB (~10 KB compressed), about 3 MB per followed game.
- If one league's scoreboard fails, the other league keeps working and the failed one retries in 60s.
- Never poll faster than ~30s, to avoid getting blocked.

**What gets announced: MLS**
| Event | Message |
|---|---|
| Kickoff | silent |
| Goal (with scorer and minute when ESPN has them) | pings both teams' roles |
| Half time | silent |
| Goal disallowed (score goes down) | silent |
| Full time (all goals listed, penalty shootout winner noted) | pings both teams' roles |
| Postponed / abandoned | silent |

**What gets announced: NBA** (scores change too often to ping, so only the final pings)
| Event | Message |
|---|---|
| Tip-off | silent |
| End of each quarter (Q2 says "Half time"; a tie after Q4 says "heading to overtime") | silent |
| Final (with OT/2OT noted, and each team's top scorer) | pings both teams' roles |
| Postponed | silent |

NBA scorelines are written away @ home ("Celtics **109** @ **112** Lakers"); MLS is home first.

- Silent messages appear in the channel but never notify anyone.
- If only one of the two teams is followed, only its role is pinged (including when the other team scores).
- After a restart the bot doesn't repeat announcements. It does miss anything that happened while it was down.

**Discord channel setup (self-service, one shared channel)**
- Everything is announced in one channel (`#sports`).
- Each followed team has a bot-created role (e.g. `@Seattle Sounders FC`). It unlocks `#sports` and is pinged for that team's goals and full time (MLS) or final score (NBA).
- An optional watch-only role unlocks `#sports` with no pings.
- Everyone in `#sports` sees every followed team's updates, but only gets pinged for their own teams. Discord can't show messages to only some people in a channel.
- Server-wide notification settings stay unchanged.

**Storage**
- Followed teams (with their role and who follows them), the channel, the watch-only role and the role picker location are saved in `data/sports.json` (the `botdata` Docker volume in `compose.yaml`), so they survive restarts. `data/` is gitignored.

## Decided against (for now)
- Pre-kickoff reminder.
- Self-editing live scoreboard message.
- Daily matchday post (not asked for; easy to add).
- One channel per team, or DMs instead of a channel. Both are possible later; DMs would need no roles at all.
- Removing followers who leave the server (needs the privileged Server Members intent). An admin can use `/sports remove` if a team lingers.

## Server setup (chosen: open channel)
- `#sports` is visible to everyone. Following a team only adds pings for that team. So `/sports setup channel:#sports` was run **without** `watch_role`.
- The bot has **Manage Roles**, with its role near the top of the role list. It can only hand out roles below its own; the roles it creates start at the bottom.
- To switch to followers-only later: deny View Channel for @everyone in `#sports` (allow the bot), and optionally create a watch-only role and pass it to `/sports setup`. The bot already gives each team role access to the channel. Running setup without `watch_role` clears any watch role set before.
- `/sports setup` warns about missing permissions.

## Usage notes
- Unfollow with `/sports unfollow` or the role picker button, not by removing the role by hand. Otherwise the bot still counts you as a fan and won't clean up the role.
- With no teams followed, nothing is posted and the bot doesn't contact ESPN at all. Following a team restarts checks immediately.
- People can follow any number of teams. A match between two followed teams pings both roles in one message.
- `/sports follow` works from any channel, which matters if `#sports` is ever made followers-only.
- After command options change, run `npm run deploy` (registers slash commands with Discord, from any machine with `.env`). Then on the server: `git pull` and `docker compose up -d --build`.
