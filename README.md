# Lockout

Real-life lockout bingo for you and your friends. Everyone joins a lobby on their phone, splits into teams, and races to claim squares on a shared board — every claim needs a video, and once a team locks a square nobody else can take it.

It's an installable web app (Add to Home Screen on iPhone or Android). Use Supabase for hosted games, or run the complete app and a small local data server on your own machine for development.

## Features

- **Lobbies** with 4-letter codes and share links; rejoin from any device with "That's me"
- **Teams:** 2–8 teams, pick your own or randomize, rename teams, late joiners can hop in mid-game
- **Custom challenges:** paste any list (one per line), save packs, or use the built-in campus pack; more challenges than squares → random board every game
- **Board sizes** 3×3, 4×4, 5×5
- **Win conditions:** N bingos, N squares, or majority of the board — plus optional time limit (most squares wins)
- **Video proof** for every square: in-app camera (auto-compressed 720p, max 60s) or upload from the camera roll
- **Lockout toggle:** when on, the first team owns the square; when off, every team may submit once and challenge other teams' clips
- **Live scoreboard, activity feed, in-game text chat, and notifications** for every claim
- **Push alerts in local server mode** for task completions and when five minutes remain (after enabling notifications on each device)
- **Contests:** challenge any clip; players on other teams vote, majority wins, ties go to the claimer, auto-decides after 2 minutes; host can override
- **Review window:** when a team hits the goal, the game pauses so others can check their clips before the win counts
- **Spotty-wifi safe:** clips are saved on the phone and upload in the background with automatic retries
- **Recap:** winner, standings, final board, and every clip in a timeline or by team, with save buttons
- **Rematch** with the same rules and teams in one tap

## Setup (one time)

1. Create a free project at [supabase.com](https://supabase.com).
2. In the project's **SQL Editor**, run [`sql/setup.sql`](sql/setup.sql).
3. Put the project URL and publishable (anon) key in [`public/config.js`](public/config.js).
4. `npm install && npm run build` → static site in `docs/`.
5. GitHub repo → Settings → Pages → Deploy from a branch → `main` / `/docs`.

Free-tier notes: 1 GB of storage and 5 GB/month of bandwidth is plenty for a few games a month (clips are ~2–6 MB each). Supabase pauses projects after a week with no activity — hit **Restore** in the dashboard before game day if it's been a while.

If you already set up Supabase before these changes, re-run [`sql/setup.sql`](sql/setup.sql) to add the per-team submission index, task coordinates, location history and visibility fields, in-game chat table, and `lockout` field.

## Run the app

`npm run serve` builds the app and starts one selected mode on port 8787. With no mode argument, it defaults to **Supabase** and uses the credentials in [`public/config.js`](public/config.js).

```
npm install
npm run serve                  # Supabase (default)
npm run serve -- supabase      # explicitly select Supabase
npm run serve -- local         # local JSON database and clip files
npm run serve -- mock          # in-browser mock backend
```

Open `http://localhost:8787/`. Stop the running server before starting another mode; each server process runs only the selected backend. For local mode, game records are stored in `data/local/db.json` and clips in `data/local/clips/`. This folder is ignored by Git and stays on the computer running the server. For mock mode, game data is kept in the browser and is useful for quick demos; it does not sync across different devices.

Local mode binds to the local network so other browsers and devices can connect at `http://<computer-LAN-IP>:8787/`; keep the server running on the computer. It implements the game tables, conflict checks, live updates, and clip storage locally and does not call Supabase. The development server has no user authentication, so use it only on a trusted network and do not expose it to the public internet. iPhone location and camera access over a LAN address generally require HTTPS; local video uploads still work over HTTP.

In local mode, open an active game, choose **Enable push notifications** in the game menu, and allow notifications. The server sends task-completion alerts and one five-minute warning for games with a time limit. Push requires a secure context: `localhost` works over HTTP, while phones connecting over your LAN need HTTPS. The VAPID keys are generated once and saved in `data/local/vapid-keys.json`; set `VAPID_SUBJECT` to a contact email or URL for deployments. Push delivery requires the local server to remain running. Supabase mode currently keeps its existing in-app alerts and does not send background push notifications.

## Development

```
npm install
npm run build      # → docs/
npm test           # game-rule unit tests
npm run serve      # builds and runs Supabase mode by default
npm run serve -- local
npm run serve -- mock
```

Mock mode uses browser storage. Start it with `npm run serve -- mock`, then open multiple tabs with different profiles (for example `?profile=alice` and `?profile=bob`). The `serve` command runs only one backend mode and defaults to Supabase. `test/e2e.py` drives a 4-player game end to end with Playwright.

### Code map

| File | What it does |
| --- | --- |
| `src/logic.js` | Pure game rules: board, bingo lines, win detection, contests, the review-window referee |
| `src/core.js` | Backend selection, live data hook, all game actions |
| `src/backend-supabase.js` | Supabase tables, realtime, storage uploads |
| `src/backend-local.js`, `server.mjs` | Local HTTP API, persistent JSON database, live events, and clip files |
| `src/backend-mock.js` | In-browser fake backend for mock serve mode |
| `src/uploads.js` | Durable background upload queue (IndexedDB) |
| `src/recorder.js` | In-app camera recorder + video picker |
| `src/home.js`, `lobby.js`, `game.js`, `recap.js` | Screens |
| `sql/setup.sql` | Database schema, access rules, realtime, storage bucket |
