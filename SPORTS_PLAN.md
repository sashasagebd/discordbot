# Sports score announcements — plan

Status: built. The code is in `src/sports/` (ESPN data, storage, membership, role picker, announcer, formatting), `src/commands/sports.ts` and `src/commands/score.ts`.

## Commands
**Anyone**
- `/sports follow team:` follows any MLS team. The first follower makes the bot create that team's role (in the club's colour) and give it access to the announcement channel. Later followers get the same role.
- `/sports unfollow team:` stops following. When a team's last follower leaves, the bot deletes its role and stops announcing it.
- `/sports list` shows the teams people follow and how many fans each has.
- `/score` shows today's MLS matches. `/score team:` shows that team's match today, its last result and its next match (with TV channel).

**Admins (Manage Server)**
- `/sports setup channel: watch_role:` sets where announcements go and the optional watch-only role. Nothing is posted until a channel is set.
- `/sports rolepicker channel:` posts buttons for the teams people already follow, plus watch-only. It updates itself as teams are added or dropped.
- `/sports remove team:` stops covering a team for everyone and deletes its role.

## Decided

**Data source**
- ESPN's public site API. No API key needed.
- League: MLS → `https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/scoreboard`
- Unofficial/undocumented, so it could change. All the ESPN code is in `src/sports/espn.ts`, so it's easy to swap out.

**Polling**
- Check every 30s while a followed match is live, and from 5 min before kickoff.
- Otherwise check every 15 min. A newly followed team or running setup triggers an immediate check.
- Cost is negligible: ~12 KB per request, well under 2 MB/day on match days.
- Never poll faster than ~30s, to avoid getting blocked.

**What gets announced**
| Event | Message |
|---|---|
| Kickoff | silent |
| Goal (with scorer and minute when ESPN has them) | pings both teams' roles |
| Half time | silent |
| Goal disallowed (score goes down) | silent |
| Full time (all goals listed, penalty shootout winner noted) | pings both teams' roles |
| Postponed / abandoned | silent |

- Silent messages appear in the channel but never notify anyone.
- If only one of the two teams is followed, only its role is pinged (including when the other team scores).
- After a restart the bot doesn't repeat announcements. It does miss anything that happened while it was down.

**Discord channel setup (self-service, one shared channel)**
- Everything is announced in one channel (`#sports`).
- Each followed team has a bot-created role (e.g. `@Seattle Sounders FC`). It unlocks `#sports` and is pinged for that team's goals and full time.
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

## Server setup needed (manual, in Discord)
- Give the bot **Manage Roles**, and keep its role near the top of the role list. It can only hand out roles below its own; the roles it creates start at the bottom.
- Make `#sports` followers-only: deny View Channel for @everyone and allow it for the bot. The bot adds each team role to the channel itself.
- Optionally create a watch-only role.
- Run `/sports setup channel:#sports watch_role:@...`, then `/sports rolepicker` wherever people should see the buttons.
- `/sports setup` warns about anything from this list that's missing.
