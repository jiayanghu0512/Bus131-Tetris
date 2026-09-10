# Feature Roadmap & Workplan

Every feature is a checkbox task. Each task lists what it depends on, which files
it touches, and what "done" means. Work one task at a time: run it, look at what
changed, then pick the next. The plan is **resumable** — stopping after any
completed task leaves the project in a working state.

**Ordering rule:** a working single-player game must be live on the internet
before any multiplayer work begins. Phases 0 and 1 satisfy that rule.

Legend: `[x]` done · `[ ]` not started · `[~]` in progress

---

## Phase 0 — Foundations

### [x] T0.1 — Design the screens in Figma
- **Depends on:** nothing
- **Files:** none (Figma file)
- **Done when:** landing, room lobby, single-player and two-player screens exist
  in Figma in the agreed gem style.
- **Status:** done — https://www.figma.com/design/1opkWdtdWK3Y1DEbA65c5B

### [x] T0.2 — Create the GitHub repository and first commit
- **Depends on:** nothing
- **Files:** whole repo
- **Done when:** the repo exists on GitHub, is public, and contains the game files.
- **Status:** done — https://github.com/jiayanghu0512/Bus131-Tetris

### [x] T0.3 — Build the single-player game
- **Depends on:** T0.1
- **Files:** `index.html`, `style.css`, `script.js`
- **Done when:** pieces fall, rotate, hard-drop and hold; lines clear; score, level
  and lines update; pause and game over work; blocks render in the gem style.
- **Status:** done and verified in a browser.

### [x] T0.4 — Get the single-player game live on Cloudflare
- **Depends on:** T0.3
- **Files:** none (hosting configuration)
- **Done when:** a public Cloudflare URL loads the playable game.
- **Status:** done — https://bus131-tetris.pages.dev (Cloudflare Pages)

### [x] T0.5 — Write the three project documents
- **Depends on:** T0.1–T0.4
- **Files:** `README.md`, `ProductSpec.md`, `FEATUREROADMAP_workplan.md`
- **Done when:** all three exist, are readable by a non-programmer, and the
  workplan orders single-player deployment before multiplayer.
- **Status:** this document.

### [ ] T0.6 — Connect the Cloudflare and GitHub connectors in Claude
- **Depends on:** nothing
- **Files:** none (Claude settings — **must be done by Jiayang, not by Claude**)
- **Done when:** Settings → Connectors shows Figma, GitHub and Cloudflare added,
  authorised, **and switched on for the working chat**.
- **Note:** having a GitHub or Cloudflare account is not the same as having the
  connector switched on. This is the checklist item most people miss.

---

## Phase 1 — Move hosting to Cloudflare Workers

Cloudflare Pages serves static files only. Durable Objects — the thing that makes
multiplayer possible — need Cloudflare Workers. This phase changes where the game
is hosted without changing how it plays.

### [x] T1.1 — Move the browser files into `public/`
- **Depends on:** T0.5
- **Files:** move `index.html`, `style.css`, `script.js` → `public/`
- **Done when:** the folder structure matches ProductSpec §5.2 and the game still
  opens correctly from `public/index.html`.

### [x] T1.2 — Add `wrangler.jsonc`
- **Depends on:** T1.1
- **Files:** `wrangler.jsonc` (new)
- **Done when:** the file sets `name`, `main`, `compatibility_date` (today's date),
  `{"observability": {"enabled": true}}`, and an `"assets"` block pointing at
  `./public` with `not_found_handling: "single-page-application"`.

### [x] T1.3 — Add the Worker entry point
- **Depends on:** T1.2
- **Files:** `src/index.js` (new)
- **Done when:** the Worker serves the static assets for normal page loads and
  reserves the route `/api/room/:code` for the WebSocket upgrade used later.

### [ ] T1.4 — Deploy to Workers and verify
- **Depends on:** T1.3, T0.6
- **Files:** none
- **Done when:** `npx wrangler deploy` succeeds and the printed `*.workers.dev`
  URL loads the same playable single-player game. **The submitted Cloudflare link
  is updated to this URL.**

---

## Phase 2 — Room plumbing (screens and joining)

### [x] T2.1 — Build the landing screen
- **Depends on:** T1.4
- **Files:** `public/index.html`, `public/style.css`
- **Done when:** the landing screen matches the Figma design, and PLAY SOLO starts
  the existing single-player game while MULTIPLAYER asks for a display name.

### [x] T2.2 — Build the room lobby screen
- **Depends on:** T2.1
- **Files:** `public/index.html`, `public/style.css`
- **Done when:** a player can create a room (a 6-character code is generated and
  shown) or type an existing code to join; the player list renders filled and empty
  slots as designed. No networking yet — local UI only.

### [x] T2.3 — Write the WebSocket client module
- **Depends on:** T2.2, T1.3
- **Files:** `public/net.js` (new), `public/index.html`
- **Done when:** the browser opens a native WebSocket to `/api/room/:code`, sends
  `join`, and logs any message it receives. Uses the browser's built-in
  `WebSocket` — **no Socket.IO, no `ws` library**.

---

## Phase 3 — The Durable Object game room

### [x] T3.1 — Create the `GameRoom` Durable Object
- **Depends on:** T2.3
- **Files:** `src/GameRoom.js` (new), `wrangler.jsonc`, `src/index.js`
- **Done when:** `wrangler.jsonc` declares the binding `ROOM` and a `migrations`
  entry using `"new_sqlite_classes": ["GameRoom"]`; the Worker routes a room code
  to its object with `env.ROOM.getByName(roomCode)`.

### [x] T3.2 — Accept WebSocket connections inside the Durable Object
- **Depends on:** T3.1
- **Files:** `src/GameRoom.js`
- **Done when:** connections are accepted with `ctx.acceptWebSocket(server)`
  (never `server.accept()`), and each player's id and display name are stored with
  `ws.serializeAttachment()` and read back with `ws.deserializeAttachment()`.

### [x] T3.3 — Roster: join, leave, broadcast
- **Depends on:** T3.2
- **Files:** `src/GameRoom.js`, `public/net.js`
- **Done when:** when a second browser joins the same code, **both** lobbies show
  two players; closing one window removes that player from the other's list.
- **This is the first visible proof that multiplayer works.**

### [x] T3.4 — Server-authoritative game state and the alarm tick
- **Depends on:** T3.3
- **Files:** `src/GameRoom.js`
- **Done when:** the Durable Object holds each player's board, spawns pieces from a
  shared seed, and advances the falling piece on a repeating **alarm** — scheduling
  the next alarm at the end of each tick, saving board state on every tick, and
  cancelling the alarm when the last player leaves. **No `setInterval`, no
  `setTimeout`.**

### [x] T3.5 — Apply player input
- **Depends on:** T3.4
- **Files:** `src/GameRoom.js`, `public/net.js`, `public/game.js`
- **Done when:** pressing a key sends `{type:"input"}` to the room, the Durable
  Object applies it to that player's board, and the result comes back in the next
  `state` broadcast.

### [x] T3.6 — Broadcast state to every player
- **Depends on:** T3.5
- **Files:** `src/GameRoom.js`
- **Done when:** every tick sends a `state` message containing both players' boards
  to everyone connected to the room.

---

## Phase 4 — The two-player screen

### [x] T4.1 — Render both boards
- **Depends on:** T3.6
- **Files:** `public/index.html`, `public/style.css`, `public/game.js`
- **Done when:** the match screen matches the Figma two-player design — your board
  on the left, the opponent's on the right, names in their accent colours, scores
  below, VS badge and timer between. The opponent's board is drawn from the `state`
  messages, not from local guessing.
- **This is the assignment's definition of done.**

### [x] T4.2 — Garbage lines and the attack feed
- **Depends on:** T4.1
- **Files:** `src/GameRoom.js`, `public/game.js`
- **Done when:** clearing 2 / 3 / 4 rows pushes 1 / 2 / 4 garbage rows onto the
  opponent's board, the attack feed line shows who sent what, and the segmented
  meter beside the board fills accordingly.

### [x] T4.3 — End of match
- **Depends on:** T4.1
- **Files:** `src/GameRoom.js`, `public/index.html`
- **Done when:** when one player tops out, both browsers show the same result
  screen naming the winner, and the room's alarm is cancelled.

---

## Phase 5 — Ship

### [~] T5.1 — Two-window end-to-end test
- **Depends on:** T4.1
- **Files:** none
- **Done when:** two browser windows are opened at the live Cloudflare URL, the
  same room code is typed into both, and each window shows the other player's
  blocks moving. Ten seconds to check, no files opened.

### [ ] T5.2 — Final deploy and submission
- **Depends on:** T5.1
- **Files:** `README.md` (update the live URL)
- **Done when:** the final version is deployed and the two submission links are
  ready:
  1. Live Cloudflare URL of the playable game
  2. GitHub repository link

---

## Risk notes — the three ways this usually breaks

1. **Using Socket.IO, Express or `ws`.** Cloudflare Workers cannot run a
   long-lived Node server. Use the browser's native `WebSocket` and the Durable
   Object's `ctx.acceptWebSocket`.
2. **Deploy succeeds but the page is blank.** The `assets` folder in
   `wrangler.jsonc` is pointing at a folder that does not contain `index.html`.
3. **Using `setInterval` / `setTimeout` for the falling piece.** A pending timer
   stops the room sleeping and burns the free tier. Use the Alarms API.
