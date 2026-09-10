# Product Specification — TETRIS Gem Edition

This document describes **what the app does** and **how it is organised**.
It is the reference the workplan builds against. Every technical term used here
is defined in the table in `README.md`.

---

## 1. The product in one sentence

A browser Tetris game where two or more people type the same room code and play
at the same time, each watching the other player's board update live.

---

## 2. What is fixed, what is ours, what is out of scope

**Fixed — required by the assignment**

- Falling blocks and cleared lines
- Two or more players at once
- A shared room code
- You can see the other player's board

**Ours — design decisions already made**

- **Mood:** dark, glowing, jewel-like. Blocks look like cut gems, not flat squares.
- **Palette:** near-black background (`#0f0f1c`), panels in dark navy (`#1a1a2e`),
  cyan accent (`#33e6e6`), and the seven classic tetromino colours rendered as
  glowing gems.
- **Type:** Inter, heavy weights, wide letter-spacing for headings.
- **Name:** *TETRIS — Gem Edition*.
- **Block feel:** each block has an outer glow, a diagonal gradient, a white facet
  highlight, and a small four-point sparkle.

**Out of scope — deliberately not built**

- Accounts, logins, passwords, user database (a display name and a room code is all)
- Leaderboards, saved scores, statistics
- Ranked play
- Phone / touch support

---

## 3. Screens

The four screens were designed in Figma first. The built product must match them.

### 3.1 Landing screen
Big glowing `TETRIS` logo, tagline, ambient floating gem blocks, and two actions:
**PLAY SOLO** and **MULTIPLAYER**. Choosing multiplayer asks for a display name.

### 3.2 Room lobby screen
Shows the **room code** in large type (tap to copy), a list of player slots — filled
slots show a coloured avatar, the display name, and `HOST` / `READY`; empty slots
show a dashed `WAITING FOR PLAYER…` placeholder — plus **START GAME** and
**LEAVE ROOM**.

### 3.3 Single-player game screen
The 10 × 20 playfield with the gem blocks and ghost piece, plus four side panels:
`NEXT`, `HOLD`, `STATS` (score / level / lines) and `CONTROLS`.

### 3.4 Two-player match screen
Two boards side by side, each with the player's name above it in their accent
colour (cyan for player 1, purple for player 2) and their score below. Between
them: a countdown timer, a large fiery `VS` badge, and an attack feed line
(for example `⚠ ALEX SENT 2 LINES`). A small segmented meter beside each board
shows incoming garbage lines.

---

## 4. Game rules

- Playfield is **10 columns × 20 rows**.
- Seven tetromino shapes (I, O, T, S, Z, J, L), each with four rotation states.
- Next piece chosen by a **7-bag randomiser**.
- **Hold** stores one piece for later; allowed once per piece.
- A **ghost piece** outline shows the landing position.
- A full row clears; scoring is 100 / 300 / 500 / 800 × level for 1 / 2 / 3 / 4 rows.
- Level increases every 10 lines; the falling interval shortens with each level
  (`max(100ms, 1000ms − (level − 1) × 75ms)`).
- Game over when a newly spawned piece has nowhere to go.

**Multiplayer additions**

- Clearing 2, 3 or 4 rows at once sends **garbage lines** to the opponent
  (1, 2 and 4 lines respectively).
- The match ends when one player tops out; the other player wins.

---

## 5. How it is organised

### 5.1 Architecture in plain English

The browser draws the game and captures key presses. It does **not** decide what
is true. For each game room there is one small object on Cloudflare's servers — a
**Durable Object** — and that object is the single authority on the state of the
match: where every block is, whose turn-clock is ticking, who has topped out.

Each browser holds one **WebSocket** connection open to that object. The browser
sends *intentions* ("I pressed left"), the Durable Object applies them to the real
game state, and then broadcasts the updated state back to everyone in the room.
This is why both players see the same thing: there is only ever one copy of the
truth, and it lives on the server.

The falling-piece clock also lives in the Durable Object, driven by the
**Alarms API** — at the end of each tick it schedules the next one. It must not use
`setInterval` or `setTimeout`, because a pending JavaScript timer keeps the room
awake and consumes the free plan's budget.

### 5.2 Planned file layout

```
/
├─ public/                  # static assets, served directly to the browser
│  ├─ index.html            # all screens (landing, lobby, game) in one page
│  ├─ style.css             # gem theme, panels, overlays
│  ├─ game.js               # Tetris rules and canvas rendering (shared)
│  └─ net.js                # WebSocket client: connect, send input, apply state
├─ src/
│  ├─ index.js              # Worker entry: serves assets, routes /api/room/:code
│  └─ GameRoom.js           # the Durable Object — one instance per room code
├─ wrangler.jsonc           # Cloudflare configuration
├─ README.md
├─ ProductSpec.md
└─ FEATUREROADMAP_workplan.md
```

### 5.3 Cloudflare configuration (non-negotiable constraints)

- Deploy to **Cloudflare Workers**, Workers Free plan.
- Serve the browser files as static assets via `"assets"` in `wrangler.jsonc`,
  with `not_found_handling` set to `"single-page-application"`.
- `compatibility_date` set to the date the project is built.
- `{"observability": {"enabled": true}}` so logs are visible in the dashboard.
- **No Socket.IO, no Express, no `ws`.** Cloudflare Workers cannot run a
  long-lived Node server — this is the single most common way this project fails.
- One Durable Object per room, reached with `env.ROOM.getByName(roomCode)`,
  declared SQLite-backed via `"new_sqlite_classes"` in the `migrations` array.
- Sockets accepted with `ctx.acceptWebSocket(server)` — never `server.accept()`.
- Per-player identity stored with `ws.serializeAttachment()` /
  `ws.deserializeAttachment()`.
- Falling-piece tick driven by the **Alarms API**; board state saved on every tick;
  the alarm cancelled when the last player leaves.

### 5.4 Message protocol

Every message across the WebSocket is JSON with a `type` and a `payload`.

**Browser → Durable Object**

| type | payload | meaning |
|---|---|---|
| `join` | `{ name }` | I am joining this room under this display name |
| `ready` | `{}` | I am ready to start |
| `input` | `{ action }` | `action` is one of `left`, `right`, `rotate`, `soft`, `hard`, `hold` |
| `leave` | `{}` | I am leaving the room |

**Durable Object → Browser**

| type | payload | meaning |
|---|---|---|
| `roster` | `{ players: [{ id, name, ready }] }` | who is in the room right now |
| `start` | `{ seed, startsAt }` | the match is starting |
| `state` | `{ players: [{ id, board, active, score, lines }] }` | the current truth, sent every tick |
| `garbage` | `{ from, lines }` | you are receiving attack lines |
| `over` | `{ winner }` | the match has ended |

---

## 6. Definition of done

Two browser windows, both open at the live Cloudflare URL, both typing the same
room code — and each window can see the other player's blocks moving.

Nothing else is graded. No partial credit.
