# TETRIS — Gem Edition

A browser-based multiplayer Tetris game. Two or more players enter the same room
code and play at the same time, each seeing the other player's board update live.

Built for **BUS 131, Week 2 (Brandeis University)** by **Jiayang Hu**.

- **Live game:** https://bus131-tetris.jiayanghu.workers.dev
- **Repository:** https://github.com/jiayanghu0512/Bus131-Tetris
- **Design source:** [Figma mockups](https://www.figma.com/design/1opkWdtdWK3Y1DEbA65c5B)

---

## What this is

A Tetris game that runs entirely in a web browser. Coloured blocks fall, you
rotate and slide them, and filling a full horizontal row clears it and scores
points. The visual style is "gem" — every block is a glowing jewel with a facet
highlight and a sparkle, on a near-black background.

The multiplayer part works like this: one player creates a room and gets a short
**room code** (for example `X7K9Q2`). Anyone who types that same code joins the
same game and both boards appear on screen side by side, updating in real time.

---

## Terms defined once

Because this project is built by a business student, every technical term used in
these documents is defined the first time it appears.

| Term | Plain-English meaning |
|---|---|
| **Static assets** | Files the browser downloads and runs by itself — the HTML page, the stylesheet, the JavaScript. No server logic involved. |
| **Cloudflare Workers** | Cloudflare's service for running small pieces of code on their servers, close to the user. It replaces a traditional always-on server. |
| **Cloudflare Pages** | Cloudflare's service for hosting static assets only. Good enough for the single-player game; not enough for multiplayer. |
| **Durable Object** | A Cloudflare feature: a single small object that lives on one server and remembers state between requests. We use **one per game room**, and it is the only authority on what the game state actually is. |
| **WebSocket** | A connection between browser and server that stays open, so either side can send a message at any moment. Normal web requests can't do this — they end as soon as the answer arrives. |
| **Alarms API** | Cloudflare's way of saying "wake this Durable Object up again in N milliseconds". We use it for the falling-piece timer instead of `setInterval`, because a pending JavaScript timer stops the room from sleeping and burns through the free plan. |
| **wrangler** | Cloudflare's command-line tool for configuring and deploying Workers. Its settings live in `wrangler.jsonc`. |
| **Tetromino** | The name for a Tetris piece — four squares joined together. There are seven shapes: I, O, T, S, Z, J, L. |
| **Ghost piece** | The faint outline showing where the current piece will land if you drop it. |
| **7-bag randomiser** | The standard Tetris rule for choosing the next piece: shuffle all seven shapes, deal them out, then shuffle again. Stops long unlucky runs. |

---

## How to run it locally

You need only a web browser. There is no build step, no npm install, no framework.

**Option A — open the file directly**

Double-click `public/index.html`. This works for the single-player game.

**Option B — run a local web server** (needed once multiplayer exists)

```bash
npx wrangler dev
```

This starts the Cloudflare Worker on your own machine, usually at
`http://localhost:8787`, including the Durable Object that powers multiplayer.

---

## How to deploy it

```bash
npx wrangler deploy
```

This uploads the static assets and the Worker code to Cloudflare and prints the
live URL. Configuration lives in `wrangler.jsonc`.

---

## Controls

| Key | Action |
|---|---|
| `←` `→` | Move left / right |
| `↓` | Soft drop (fall faster) |
| `↑` | Rotate |
| `Space` | Hard drop (drop instantly and lock) |
| `C` | Hold the current piece for later |
| `P` | Pause |

---

## Scoring

| Lines cleared at once | Points (× current level) |
|---|---|
| 1 | 100 |
| 2 | 300 |
| 3 | 500 |
| 4 (a "Tetris") | 800 |

Soft drop adds 1 point per row, hard drop adds 2 points per row. The level goes
up every 10 cleared lines, and each level makes the pieces fall faster.

---

## Project status

See `FEATUREROADMAP_workplan.md` for the task-by-task plan and what is done.

- ✅ Figma designs for all four screens
- ✅ Single-player game, playable and deployed
- ✅ Deployment moved to Cloudflare Workers
- ✅ Room codes and lobby
- ✅ Live multiplayer via Durable Object + WebSocket

Verified in production: two browser windows opened at the live URL, both typing
the same room code, each showing the other player's blocks moving and their
score updating live.
