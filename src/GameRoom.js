// GameRoom — one Durable Object per room code.
//
// This object is the ONLY authority on what is true in a match. Browsers do not
// decide anything: they send "I pressed left", this object applies it to the real
// board, and then broadcasts the new state to everybody in the room. That is why
// two players see the same thing — there is only one copy of the truth.
//
// The falling-piece clock is driven by the Alarms API (ctx.storage.setAlarm).
// We must NOT use setInterval/setTimeout: a pending JavaScript timer keeps the
// room awake forever and burns through the free plan.

const COLS = 10;
const ROWS = 20;
const TICK_MS = 250; // how often the room wakes up
const MAX_PLAYERS = 4;

const TYPES = ["I", "O", "T", "S", "Z", "J", "L"];
const SCORE_TABLE = [0, 100, 300, 500, 800];
// Clearing 2/3/4 rows at once sends this many junk rows to every opponent.
const GARBAGE_TABLE = [0, 0, 1, 2, 4];

// Each piece has four rotation states; a state is the four filled squares
// inside a 4x4 box, written as [column, row].
const SHAPES = {
  I: [
    [[0, 1], [1, 1], [2, 1], [3, 1]],
    [[2, 0], [2, 1], [2, 2], [2, 3]],
    [[0, 2], [1, 2], [2, 2], [3, 2]],
    [[1, 0], [1, 1], [1, 2], [1, 3]],
  ],
  O: [
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
  ],
  T: [
    [[1, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [1, 1], [2, 1], [1, 2]],
    [[0, 1], [1, 1], [2, 1], [1, 2]],
    [[1, 0], [0, 1], [1, 1], [1, 2]],
  ],
  S: [
    [[1, 0], [2, 0], [0, 1], [1, 1]],
    [[1, 0], [1, 1], [2, 1], [2, 2]],
    [[1, 1], [2, 1], [0, 2], [1, 2]],
    [[0, 0], [0, 1], [1, 1], [1, 2]],
  ],
  Z: [
    [[0, 0], [1, 0], [1, 1], [2, 1]],
    [[2, 0], [1, 1], [2, 1], [1, 2]],
    [[0, 1], [1, 1], [1, 2], [2, 2]],
    [[1, 0], [0, 1], [1, 1], [0, 2]],
  ],
  J: [
    [[0, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [1, 2]],
    [[0, 1], [1, 1], [2, 1], [2, 2]],
    [[1, 0], [1, 1], [0, 2], [1, 2]],
  ],
  L: [
    [[2, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [1, 1], [1, 2], [2, 2]],
    [[0, 1], [1, 1], [2, 1], [0, 2]],
    [[0, 0], [1, 0], [1, 1], [1, 2]],
  ],
};

// ---------- small pure helpers ----------

function emptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

// The 7-bag rule: shuffle all seven shapes, deal them out, shuffle again.
function shuffledBag() {
  const bag = [...TYPES];
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

function cellsOf(piece) {
  return SHAPES[piece.type][piece.rotation].map(([cx, cy]) => [piece.x + cx, piece.y + cy]);
}

function collides(board, piece) {
  for (const [x, y] of cellsOf(piece)) {
    if (x < 0 || x >= COLS || y >= ROWS) return true;
    if (y >= 0 && board[y][x]) return true;
  }
  return false;
}

function newPlayer(id, name) {
  return {
    id,
    name,
    ready: false,
    connected: true,
    board: emptyBoard(),
    active: null,
    queue: shuffledBag(),
    hold: null,
    canHold: true,
    score: 0,
    lines: 0,
    level: 1,
    dropCounter: 0,
    alive: true,
    pendingGarbage: 0,
  };
}

// ---------- the Durable Object ----------

export class GameRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;

    // Because we use WebSocket hibernation, this object can be removed from
    // memory while the connections stay open, then rebuilt later. So the room
    // state is always reloaded from storage before anything else runs.
    this.ctx.blockConcurrencyWhile(async () => {
      this.room = (await this.ctx.storage.get("room")) || {
        code: null,
        status: "lobby", // lobby | playing | over
        players: {},
        order: [],
        winner: null,
      };
    });
  }

  async save() {
    await this.ctx.storage.put("room", this.room);
  }

  // --- connection handling ---

  async fetch(request) {
    const url = new URL(request.url);
    const code = url.pathname.split("/").pop().toUpperCase();
    this.room.code = code;

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // acceptWebSocket (not server.accept) is what enables hibernation.
    this.ctx.acceptWebSocket(server);

    const id = crypto.randomUUID().slice(0, 8);
    // serializeAttachment stores a small piece of data ON the socket itself, so
    // we still know who this connection belongs to after hibernation.
    server.serializeAttachment({ id });

    await this.save();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    const { type, payload = {} } = message;
    const attachment = ws.deserializeAttachment() || {};
    const id = attachment.id;
    if (!id) return;

    switch (type) {
      case "join":
        await this.handleJoin(ws, id, payload);
        break;
      case "ready":
        await this.handleReady(id, payload);
        break;
      case "start":
        await this.handleStart();
        break;
      case "input":
        await this.handleInput(id, payload);
        break;
      case "restart":
        await this.handleRestart();
        break;
      default:
        break;
    }
  }

  async webSocketClose(ws) {
    await this.removeSocket(ws);
  }

  async webSocketError(ws) {
    await this.removeSocket(ws);
  }

  async removeSocket(ws) {
    const attachment = ws.deserializeAttachment() || {};
    const id = attachment.id;
    if (id && this.room.players[id]) {
      delete this.room.players[id];
      this.room.order = this.room.order.filter((pid) => pid !== id);
    }

    const remaining = this.ctx.getWebSockets().filter((s) => s !== ws);

    if (remaining.length === 0) {
      // Last player left: cancel the alarm so this room can go to sleep.
      await this.ctx.storage.deleteAlarm();
      this.room.status = "lobby";
      this.room.players = {};
      this.room.order = [];
      await this.save();
      return;
    }

    // If the match was running and only one player is left standing, end it.
    if (this.room.status === "playing") {
      const alive = this.room.order.filter((pid) => this.room.players[pid]?.alive);
      if (alive.length <= 1) {
        await this.endMatch(alive[0] || null);
        return;
      }
    }

    await this.save();
    this.broadcastRoster();
    if (this.room.status === "playing") this.broadcastState();
  }

  // --- message handlers ---

  async handleJoin(ws, id, payload) {
    if (this.room.players[id]) return;

    if (this.room.order.length >= MAX_PLAYERS) {
      this.send(ws, "error", { message: "This room is full (4 players maximum)." });
      return;
    }
    if (this.room.status === "playing") {
      this.send(ws, "error", { message: "That match has already started." });
      return;
    }

    const name = String(payload.name || "PLAYER").slice(0, 12).toUpperCase();
    this.room.players[id] = newPlayer(id, name);
    this.room.order.push(id);

    await this.save();

    this.send(ws, "welcome", { id, code: this.room.code });
    this.broadcastRoster();
  }

  async handleReady(id, payload) {
    const player = this.room.players[id];
    if (!player) return;
    player.ready = payload.ready !== false;
    await this.save();
    this.broadcastRoster();
  }

  async handleStart() {
    if (this.room.status === "playing") return;
    if (this.room.order.length < 2) return; // need at least two players

    this.room.status = "playing";
    this.room.winner = null;

    for (const id of this.room.order) {
      const player = this.room.players[id];
      player.board = emptyBoard();
      player.queue = shuffledBag();
      player.hold = null;
      player.canHold = true;
      player.score = 0;
      player.lines = 0;
      player.level = 1;
      player.dropCounter = 0;
      player.alive = true;
      player.pendingGarbage = 0;
      player.active = null;
      this.spawn(player);
    }

    await this.save();
    this.broadcast("start", {});
    this.broadcastState();

    // Start the falling-piece clock.
    await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
  }

  async handleRestart() {
    if (this.room.status !== "over") return;
    this.room.status = "lobby";
    this.room.winner = null;
    for (const id of this.room.order) {
      const player = this.room.players[id];
      if (player) player.ready = false;
    }
    await this.save();
    this.broadcastRoster();
  }

  async handleInput(id, payload) {
    if (this.room.status !== "playing") return;
    const player = this.room.players[id];
    if (!player || !player.alive || !player.active) return;

    switch (payload.action) {
      case "left":
        this.tryMove(player, -1, 0);
        break;
      case "right":
        this.tryMove(player, 1, 0);
        break;
      case "rotate":
        this.rotate(player);
        break;
      case "soft":
        if (this.tryMove(player, 0, 1)) player.score += 1;
        else this.lockAndAdvance(player);
        break;
      case "hard": {
        let distance = 0;
        while (this.tryMove(player, 0, 1)) distance++;
        player.score += distance * 2;
        this.lockAndAdvance(player);
        break;
      }
      case "hold":
        this.holdPiece(player);
        break;
      default:
        return;
    }

    await this.checkForEnd();
    if (this.room.status === "playing") {
      await this.save();
      this.broadcastState();
    }
  }

  // --- the clock ---

  async alarm() {
    if (this.room.status !== "playing") return; // do not reschedule

    for (const id of this.room.order) {
      const player = this.room.players[id];
      if (!player || !player.alive) continue;

      const interval = Math.max(100, 1000 - (player.level - 1) * 75);
      player.dropCounter += TICK_MS;
      while (player.dropCounter >= interval && player.alive) {
        player.dropCounter -= interval;
        if (!this.tryMove(player, 0, 1)) this.lockAndAdvance(player);
      }
    }

    await this.checkForEnd();

    // Board state is saved on every tick, as required.
    await this.save();

    if (this.room.status === "playing") {
      this.broadcastState();
      // Schedule the next tick at the END of this one — never setInterval.
      await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
    }
  }

  // --- game rules (server-side) ---

  spawn(player) {
    if (player.queue.length <= 1) player.queue.push(...shuffledBag());
    const type = player.queue.shift();
    player.active = { type, rotation: 0, x: 3, y: -1 };
    if (collides(player.board, player.active)) {
      player.alive = false;
      player.active = null;
    }
  }

  tryMove(player, dx, dy) {
    const moved = { ...player.active, x: player.active.x + dx, y: player.active.y + dy };
    if (collides(player.board, moved)) return false;
    player.active = moved;
    return true;
  }

  rotate(player) {
    const nextRotation = (player.active.rotation + 1) % 4;
    // Wall kicks: if the rotation does not fit, try nudging sideways.
    for (const dx of [0, -1, 1, -2, 2]) {
      const candidate = { ...player.active, rotation: nextRotation, x: player.active.x + dx };
      if (!collides(player.board, candidate)) {
        player.active = candidate;
        return;
      }
    }
  }

  holdPiece(player) {
    if (!player.canHold) return;
    const current = player.active.type;
    if (player.hold === null) {
      player.hold = current;
      this.spawn(player);
    } else {
      const swap = player.hold;
      player.hold = current;
      player.active = { type: swap, rotation: 0, x: 3, y: -1 };
      if (collides(player.board, player.active)) {
        player.alive = false;
        player.active = null;
      }
    }
    player.canHold = false;
  }

  lockAndAdvance(player) {
    for (const [x, y] of cellsOf(player.active)) {
      if (y >= 0) player.board[y][x] = player.active.type;
    }

    const cleared = this.clearLines(player);
    if (cleared > 0) {
      player.lines += cleared;
      player.score += SCORE_TABLE[cleared] * player.level;
      player.level = Math.floor(player.lines / 10) + 1;

      const garbage = GARBAGE_TABLE[cleared];
      if (garbage > 0) {
        for (const otherId of this.room.order) {
          const other = this.room.players[otherId];
          if (other && other.id !== player.id && other.alive) {
            other.pendingGarbage += garbage;
          }
        }
        this.broadcast("event", {
          text: `${player.name} SENT ${garbage} LINE${garbage > 1 ? "S" : ""}`,
          from: player.id,
        });
      }
    }

    this.applyGarbage(player);
    player.canHold = true;
    this.spawn(player);
  }

  clearLines(player) {
    let cleared = 0;
    for (let y = ROWS - 1; y >= 0; y--) {
      if (player.board[y].every((cell) => cell)) {
        player.board.splice(y, 1);
        player.board.unshift(Array(COLS).fill(null));
        cleared++;
        y++;
      }
    }
    return cleared;
  }

  applyGarbage(player) {
    if (player.pendingGarbage <= 0) return;
    const count = Math.min(player.pendingGarbage, ROWS);
    player.pendingGarbage = 0;

    const hole = Math.floor(Math.random() * COLS);
    for (let i = 0; i < count; i++) {
      player.board.shift();
      const row = Array(COLS).fill("G");
      row[hole] = null;
      player.board.push(row);
    }

    // Anything pushed off the top ends the player's game.
    if (player.active && collides(player.board, player.active)) {
      if (!this.tryMove(player, 0, -1)) {
        player.alive = false;
        player.active = null;
      }
    }
  }

  async checkForEnd() {
    if (this.room.status !== "playing") return;
    const alive = this.room.order.filter((id) => this.room.players[id]?.alive);
    if (alive.length <= 1 && this.room.order.length >= 2) {
      await this.endMatch(alive[0] || null);
    }
  }

  async endMatch(winnerId) {
    this.room.status = "over";
    this.room.winner = winnerId;
    await this.ctx.storage.deleteAlarm();
    await this.save();
    this.broadcast("over", {
      winner: winnerId,
      winnerName: winnerId ? this.room.players[winnerId]?.name || null : null,
    });
    this.broadcastState();
  }

  // --- sending ---

  send(ws, type, payload) {
    try {
      ws.send(JSON.stringify({ type, payload }));
    } catch {
      // socket already gone — nothing to do
    }
  }

  broadcast(type, payload) {
    const data = JSON.stringify({ type, payload });
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(data);
      } catch {
        // ignore closed sockets
      }
    }
  }

  broadcastRoster() {
    this.broadcast("roster", {
      code: this.room.code,
      status: this.room.status,
      players: this.room.order
        .filter((id) => this.room.players[id])
        .map((id) => {
          const p = this.room.players[id];
          return { id: p.id, name: p.name, ready: p.ready };
        }),
    });
  }

  broadcastState() {
    this.broadcast("state", {
      status: this.room.status,
      winner: this.room.winner,
      players: this.room.order
        .filter((id) => this.room.players[id])
        .map((id) => {
          const p = this.room.players[id];
          return {
            id: p.id,
            name: p.name,
            // Each row becomes a 10-character string: a letter per filled cell,
            // a dot for empty. Small to send, easy to draw.
            rows: p.board.map((row) => row.map((cell) => cell || ".").join("")),
            active: p.active ? cellsOf(p.active) : [],
            activeType: p.active ? p.active.type : null,
            next: p.queue[0] || null,
            hold: p.hold,
            score: p.score,
            lines: p.lines,
            level: p.level,
            alive: p.alive,
          };
        }),
    });
  }
}
