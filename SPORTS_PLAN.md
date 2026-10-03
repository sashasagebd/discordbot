# Sports score announcements — plan

Status: built. The code is in `src/sports/` (ESPN data, storage, announcer, formatting), `src/commands/sports.ts` and `src/commands/score.ts`.

## Commands
- `/sports follow team:` / `/sports unfollow team:` add or remove a followed team (needs Manage Server).
- `/sports setup channel: role:` sets where announcements go and which role is pinged (needs Manage Server). Nothing is posted until this is set.
- `/sports list` shows the followed teams and the announcement channel.
- `/score` shows today's MLS matches. `/score team:` shows that team's match today, its last result and its next match (with TV channel).

## Decided

**Data source**
- ESPN's public site API. No API key needed.
- League: MLS → `https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/scoreboard`
- Unofficial/undocumented, so it could change. All the ESPN code is in `src/sports/espn.ts`, so it's easy to swap out.

**Polling**
- Check every 30s while a followed match is live, and from 5 min before kickoff.
- Otherwise check every 15 min. Following a team or running setup triggers an immediate check.
- Cost is negligible: ~12 KB per request, well under 2 MB/day on match days.
- Never poll faster than ~30s, to avoid getting blocked.

**What gets announced**
| Event | Message |
|---|---|
| Kickoff | silent |
| Goal (with scorer and minute when ESPN has them) | pings the role |
| Half time | silent |
| Goal disallowed (score goes down) | silent |
| Full time (all goals listed, penalty shootout winner noted) | pings the role |
| Postponed / abandoned | silent |

- Silent messages appear in the channel but never notify anyone.
- After a restart the bot doesn't repeat announcements. It does miss anything that happened while it was down.

**Discord channel setup (combined approach)**
- `#sports` is opt-in: only members with a `@Sports` role can see it.
- People give themselves the role through Discord's Channels & Roles picker.
- Server-wide notification settings stay unchanged.

**Storage**
- Followed teams, channel and role are saved in `data/sports.json` (the `botdata` Docker volume in `compose.yaml`), so they survive restarts. `data/` is gitignored.

## Decided against (for now)
- Pre-kickoff reminder.
- Self-editing live scoreboard message.
- Daily matchday post (not asked for; easy to add).
- Bot command to give people the role (the Discord picker does this).

## Server setup needed (manual, in Discord)
- Create the `@Sports` role.
- `#sports` permissions: deny View Channel for @everyone; allow it for `@Sports` and the bot's role.
- Let the bot ping the role: either give it "Mention @everyone, @here, and All Roles", or turn on "Allow anyone to @mention this role" for `@Sports`. `/sports setup` warns if neither is done.
- Add `@Sports` to Server Settings → Onboarding / Channels & Roles so people can pick it themselves.
- Then run `/sports setup channel:#sports role:@Sports` and `/sports follow`.
