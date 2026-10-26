# Lockout

Real-life lockout bingo for you and your friends. Everyone joins a lobby on their phone, splits into teams, and races to claim squares on a shared board — every claim needs a video, and once a team locks a square nobody else can take it.

It's an installable web app (Add to Home Screen on iPhone or Android), backed by a free Supabase project for live sync and video storage.

## Features

- **Lobbies** with 4-letter codes and share links; rejoin from any device with "That's me"
- **Teams:** 2–8 teams, pick your own or randomize, rename teams, late joiners can hop in mid-game
- **Custom challenges:** paste any list (one per line), save packs, or use the built-in campus pack; more challenges than squares → random board every game
- **Board sizes** 3×3 up to 7×7
- **Game modes:**
  - **Bingo** — classic lockout; win by N bingos, N squares, or majority
  - **Points** — lockout, but each challenge is worth 1–5 points (tap challenges in the lobby to set them); first to a target or most points
  - **Rush** — no lockout: every team can do every square once, and the first team to finish a square earns double
  - Optional **bingo bonus** (+N points per completed line) and **bounties** (every 10/15/20/30 min a random open square is worth double until claimed)
  - Points games end on their own once nobody can catch the leader
- **Time limit** (optional): most squares/points wins when it runs out
- **Video proof** for every square: in-app camera (auto-compressed 720p, max 60s) or upload from the camera roll
- **Lockout:** the database guarantees one owner per square — simultaneous claims can't both win
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

## Development

```
npm install
npm run build      # → docs/
npm test           # game-rule unit tests
npm run serve      # http://localhost:8787/?mock  (offline demo, no Supabase needed)
```

`?mock` runs the whole game in the browser with a fake backend — open several tabs with `?mock&profile=alice`, `?mock&profile=bob`, … to play against yourself. `test/e2e.py` drives a 4-player game end to end with Playwright.

### Code map

| File | What it does |
| --- | --- |
| `src/logic.js` | Pure game rules: board, bingo lines, win detection, contests, the review-window referee |
| `src/core.js` | Backend selection, live data hook, all game actions |
| `src/backend-supabase.js` | Supabase tables, realtime, storage uploads |
| `src/backend-mock.js` | In-browser fake backend for `?mock` |
| `src/uploads.js` | Durable background upload queue (IndexedDB) |
| `src/recorder.js` | In-app camera recorder + video picker |
| `src/home.js`, `lobby.js`, `game.js`, `recap.js` | Screens |
| `sql/setup.sql` | Database schema, access rules, realtime, storage bucket |
