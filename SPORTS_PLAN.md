# Sports score announcements — plan

Status: planned, not built yet.

## Decided

**Data source**
- ESPN's public scoreboard endpoint. No API key needed.
- League: MLS → `https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/scoreboard`
- Unofficial/undocumented, so it could change. Keep the fetching code in one place so it's easy to swap out.

**Polling**
- Check every ~30s only while a followed match is live.
- Otherwise check every 15–30 min, waking up shortly before kickoff (the scoreboard gives kickoff times).
- Cost is negligible: ~12 KB per request, well under 2 MB/day on match days.
- Never poll faster than ~30s, to avoid getting blocked.

**Discord channel setup (combined approach)**
- `#sports` is opt-in: only members with a `@Sports` role can see it.
- People give themselves the role (bot command and/or Discord's Channels & Roles picker).
- Server-wide notification settings stay unchanged.
- Routine updates (live scoreboard, half time) are sent as **silent** messages and never notify anyone.
- Goals and full time are sent as **normal** messages and ping `@Sports`.

**Storage**
- Followed teams and channel config go in a JSON file on a Docker volume (`compose.yaml`) so they survive restarts.

## Still to decide
- Which MLS team(s) to follow, or the whole league.
- Kickoff message: silent or ping?
- Extras: daily matchday post, 30-min pre-kickoff reminder, `/score` and `/schedule` lookup commands.

## Server setup needed (manual, in Discord)
- Create the `@Sports` role.
- `#sports` permissions: deny View Channel for @everyone; allow it for `@Sports` and the bot's role.
- Let the bot ping the role: either give it "Mention @everyone, @here, and All Roles", or turn on "Allow anyone to @mention this role" for `@Sports`.
- If the bot will hand out the role itself: give it Manage Roles, with its role placed above `@Sports`.
