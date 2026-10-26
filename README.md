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
- **Live scoreboard, feed, and notifications** for every claim
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

If you already set up Supabase before this change, re-run [`sql/setup.sql`](sql/setup.sql) once to add the per-team submission index and `lockout` field.

## Local server (no Supabase)

The local server stores game records in `data/local/db.json`, video clips in `data/local/clips/`, and sends live updates to connected browsers. That folder is ignored by Git and stays on the computer running the server.

```
npm install
npm run serve      # builds the app, then starts the local server on port 8787
```

Open `http://localhost:8787/`; the local server selects the local backend by default. To play from another browser or device on the same trusted network, open `http://<computer-LAN-IP>:8787/`; keep the server running on the computer. Add `?supabase` to explicitly use the configured Supabase backend. The server binds to the local network so clients can connect. Do not expose this development server to the public internet. Browsers generally require HTTPS to access a phone camera from a LAN address; video uploads still work over local HTTP.

The local backend implements the app's game tables, conflict checks, live updates, and clip storage using only Node's built-in modules. It does not call Supabase. `?mock` remains available for a quick single-browser demo. The server has no user authentication, so use it only on a trusted network.

## Development

```
npm install
npm run build      # → docs/
npm test           # game-rule unit tests
npm run serve      # builds and runs the local app at http://localhost:8787/
```

`?mock` runs the whole game in the browser with a fake backend — open several tabs with `?mock&profile=alice`, `?mock&profile=bob`, … to play against yourself. The local server uses its shared backend by default, so separate browsers and LAN devices see the same game. `test/e2e.py` drives a 4-player game end to end with Playwright.

### Code map

| File | What it does |
| --- | --- |
| `src/logic.js` | Pure game rules: board, bingo lines, win detection, contests, the review-window referee |
| `src/core.js` | Backend selection, live data hook, all game actions |
| `src/backend-supabase.js` | Supabase tables, realtime, storage uploads |
| `src/backend-local.js`, `server.mjs` | Local HTTP API, persistent JSON database, live events, and clip files |
| `src/backend-mock.js` | In-browser fake backend for `?mock` |
| `src/uploads.js` | Durable background upload queue (IndexedDB) |
| `src/recorder.js` | In-app camera recorder + video picker |
| `src/home.js`, `lobby.js`, `game.js`, `recap.js` | Screens |
| `sql/setup.sql` | Database schema, access rules, realtime, storage bucket |
