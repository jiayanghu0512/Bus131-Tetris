// Multiplayer client.
//
// One WebSocket connection per browser, held open to the Durable Object that
// owns this room code. We send what the player pressed; the server sends back
// the truth for every board in the room, and we draw it.

const Net = (() => {
  let socket = null;
  let myId = null;
  let roomCode = null;
  let myName = "PLAYER";
  let inMatch = false;
  let latestState = null;

  const opponentCanvases = new Map(); // player id -> { wrap, canvas, ctx, name, score }

  const el = (id) => document.getElementById(id);

  /* ---------- connecting ---------- */

  function randomCode() {
    // No I, O, 0 or 1 — they are too easy to mistype.
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    return code;
  }

  function connect(code, name) {
    roomCode = code.toUpperCase();
    myName = (name || "PLAYER").toUpperCase().slice(0, 12);

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocol}//${location.host}/api/room/${roomCode}`);

    socket.addEventListener("open", () => {
      send("join", { name: myName });
    });

    socket.addEventListener("message", (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      handle(message.type, message.payload || {});
    });

    socket.addEventListener("close", () => {
      if (inMatch || !el("screen-lobby").classList.contains("hidden")) {
        showError("Connection closed. Back to the main menu.");
        Screens.show("landing");
      }
    });

    socket.addEventListener("error", () => {
      showError("Could not connect to the room. Check the code and try again.");
    });
  }

  function send(type, payload = {}) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type, payload }));
    }
  }

  function disconnect() {
    inMatch = false;
    if (socket) {
      socket.close();
      socket = null;
    }
    myId = null;
    latestState = null;
    opponentCanvases.clear();
    const area = el("opponentArea");
    if (area) area.innerHTML = "";
  }

  function showError(text) {
    const box = el("joinError");
    if (box) box.textContent = text;
  }

  /* ---------- incoming messages ---------- */

  function handle(type, payload) {
    switch (type) {
      case "welcome":
        myId = payload.id;
        roomCode = payload.code || roomCode;
        el("lobbyCode").textContent = roomCode;
        el("matchCode").textContent = roomCode;
        Screens.show("lobby");
        break;

      case "roster":
        renderRoster(payload);
        break;

      case "start":
        inMatch = true;
        el("matchOverlay").classList.add("hidden");
        el("matchStatus").textContent = "";
        el("attackFeed").textContent = "";
        Screens.show("match");
        break;

      case "state":
        latestState = payload;
        renderMatch(payload);
        break;

      case "event":
        showAttack(payload.text);
        break;

      case "over":
        showResult(payload);
        break;

      case "error":
        showError(payload.message || "Something went wrong.");
        Screens.show("join");
        break;
    }
  }

  /* ---------- lobby ---------- */

  function renderRoster(payload) {
    const list = el("playerList");
    list.innerHTML = "";

    const players = payload.players || [];
    const accents = ["#33e6e6", "#a133f0", "#40d959", "#f29926"];

    players.forEach((player, index) => {
      const row = document.createElement("div");
      row.className = "player-row filled";
      row.style.setProperty("--accent", accents[index % accents.length]);
      row.innerHTML = `
        <span class="avatar">${player.name[0] || "?"}</span>
        <span class="player-name-text">${player.name}${player.id === myId ? " (YOU)" : ""}</span>
        <span class="player-tag">${index === 0 ? "HOST" : "READY"}</span>
      `;
      list.appendChild(row);
    });

    for (let i = players.length; i < 4; i++) {
      const row = document.createElement("div");
      row.className = "player-row empty";
      row.innerHTML = `<span class="avatar"></span><span class="player-name-text">WAITING FOR PLAYER…</span>`;
      list.appendChild(row);
    }

    const enough = players.length >= 2;
    el("btnStart").disabled = !enough;
    el("lobbyHint").textContent = enough
      ? "READY WHEN YOU ARE — ANYONE CAN START"
      : `SHARE THE CODE "${roomCode}" — WAITING FOR A SECOND PLAYER…`;
  }

  /* ---------- match rendering ---------- */

  function renderMatch(state) {
    const players = state.players || [];
    const me = players.find((p) => p.id === myId);
    const others = players.filter((p) => p.id !== myId);

    if (me) {
      const canvas = el("myCanvas");
      const ctx = canvas.getContext("2d");
      renderRows(ctx, canvas, me.rows, me.active, me.activeType, 26);
      el("myName").textContent = `${me.name} (YOU)${me.alive ? "" : " — OUT"}`;
      el("myScore").textContent = me.score.toLocaleString();
    }

    // Remove canvases for players who left.
    for (const id of [...opponentCanvases.keys()]) {
      if (!others.some((p) => p.id === id)) {
        opponentCanvases.get(id).wrap.remove();
        opponentCanvases.delete(id);
      }
    }

    const accents = ["#a133f0", "#40d959", "#f29926"];
    others.forEach((player, index) => {
      let entry = opponentCanvases.get(player.id);
      if (!entry) {
        const wrap = document.createElement("div");
        wrap.className = "opponent";
        wrap.style.setProperty("--accent", accents[index % accents.length]);
        wrap.innerHTML = `
          <div class="player-name opp"></div>
          <div class="board-panel small"><canvas width="150" height="300"></canvas></div>
          <div class="match-score opp-score"></div>
        `;
        el("opponentArea").appendChild(wrap);
        const canvas = wrap.querySelector("canvas");
        entry = {
          wrap,
          canvas,
          ctx: canvas.getContext("2d"),
          name: wrap.querySelector(".player-name"),
          score: wrap.querySelector(".match-score"),
        };
        opponentCanvases.set(player.id, entry);
      }
      entry.name.textContent = player.name + (player.alive ? "" : " — OUT");
      entry.score.textContent = "SCORE " + player.score.toLocaleString();
      renderRows(entry.ctx, entry.canvas, player.rows, player.active, player.activeType, 15);
    });
  }

  let attackTimer = null;
  function showAttack(text) {
    const feed = el("attackFeed");
    feed.textContent = "⚠  " + text;
    if (attackTimer) clearTimeout(attackTimer);
    attackTimer = setTimeout(() => { feed.textContent = ""; }, 2500);
  }

  function showResult(payload) {
    inMatch = false;
    const won = payload.winner && payload.winner === myId;
    el("matchResult").textContent = won ? "YOU WIN" : "MATCH OVER";
    el("matchResultSub").textContent = payload.winnerName
      ? `${payload.winnerName} WINS`
      : "NO WINNER";
    el("matchOverlay").classList.remove("hidden");
  }

  /* ---------- input ---------- */

  const KEY_ACTIONS = {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "rotate",
    ArrowDown: "soft",
    " ": "hard",
    c: "hold",
    C: "hold",
  };

  window.addEventListener("keydown", (event) => {
    if (!inMatch) return;
    const action = KEY_ACTIONS[event.key];
    if (!action) return;
    event.preventDefault();
    send("input", { action });
  });

  /* ---------- wiring ---------- */

  document.addEventListener("DOMContentLoaded", () => {
    el("btnMulti").addEventListener("click", () => {
      showError("");
      Screens.show("join");
    });

    el("btnCreate").addEventListener("click", () => {
      showError("");
      connect(randomCode(), el("inputName").value || "PLAYER");
    });

    el("btnJoin").addEventListener("click", () => {
      const code = (el("inputCode").value || "").trim().toUpperCase();
      if (code.length < 4) {
        showError("Enter the 6-character room code.");
        return;
      }
      showError("");
      connect(code, el("inputName").value || "PLAYER");
    });

    el("inputCode").addEventListener("keydown", (e) => {
      if (e.key === "Enter") el("btnJoin").click();
    });

    el("btnCopy").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(roomCode);
        el("btnCopy").textContent = "COPIED ✓";
        setTimeout(() => { el("btnCopy").textContent = "TAP TO COPY ⧉"; }, 1500);
      } catch {
        /* clipboard blocked — the code is on screen anyway */
      }
    });

    el("btnStart").addEventListener("click", () => send("start"));

    el("btnBackToLobby").addEventListener("click", () => {
      el("matchOverlay").classList.add("hidden");
      send("restart");
      Screens.show("lobby");
    });

    el("btnLeave").addEventListener("click", disconnect);
    el("btnLeaveMatch").addEventListener("click", disconnect);
  });

  return {
    setInMatch(value) { inMatch = value; },
    disconnect,
  };
})();

window.Net = Net;
