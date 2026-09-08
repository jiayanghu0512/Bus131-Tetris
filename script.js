(() => {
  const COLS = 10;
  const ROWS = 20;
  const CELL = 26;

  const COLORS = {
    I: "#33e6e6",
    O: "#f2e633",
    T: "#a133f0",
    S: "#40d959",
    Z: "#eb4047",
    J: "#3359f2",
    L: "#f29926",
  };

  // Rotation states: array of 4 rotations, each a list of [x,y] cells in a 4x4 box.
  const SHAPES = {
    I: [
      [[0,1],[1,1],[2,1],[3,1]],
      [[2,0],[2,1],[2,2],[2,3]],
      [[0,2],[1,2],[2,2],[3,2]],
      [[1,0],[1,1],[1,2],[1,3]],
    ],
    O: [
      [[1,0],[2,0],[1,1],[2,1]],
      [[1,0],[2,0],[1,1],[2,1]],
      [[1,0],[2,0],[1,1],[2,1]],
      [[1,0],[2,0],[1,1],[2,1]],
    ],
    T: [
      [[1,0],[0,1],[1,1],[2,1]],
      [[1,0],[1,1],[2,1],[1,2]],
      [[0,1],[1,1],[2,1],[1,2]],
      [[1,0],[0,1],[1,1],[1,2]],
    ],
    S: [
      [[1,0],[2,0],[0,1],[1,1]],
      [[1,0],[1,1],[2,1],[2,2]],
      [[1,1],[2,1],[0,2],[1,2]],
      [[0,0],[0,1],[1,1],[1,2]],
    ],
    Z: [
      [[0,0],[1,0],[1,1],[2,1]],
      [[2,0],[1,1],[2,1],[1,2]],
      [[0,1],[1,1],[1,2],[2,2]],
      [[1,0],[0,1],[1,1],[0,2]],
    ],
    J: [
      [[0,0],[0,1],[1,1],[2,1]],
      [[1,0],[2,0],[1,1],[1,2]],
      [[0,1],[1,1],[2,1],[2,2]],
      [[1,0],[1,1],[0,2],[1,2]],
    ],
    L: [
      [[2,0],[0,1],[1,1],[2,1]],
      [[1,0],[1,1],[1,2],[2,2]],
      [[0,1],[1,1],[2,1],[0,2]],
      [[0,0],[1,0],[1,1],[1,2]],
    ],
  };

  const TYPES = Object.keys(SHAPES);
  const SCORE_TABLE = [0, 100, 300, 500, 800];

  // ---------- DOM ----------
  const boardCanvas = document.getElementById("boardCanvas");
  const boardCtx = boardCanvas.getContext("2d");
  const nextCanvas = document.getElementById("nextCanvas");
  const nextCtx = nextCanvas.getContext("2d");
  const holdCanvas = document.getElementById("holdCanvas");
  const holdCtx = holdCanvas.getContext("2d");

  const scoreEl = document.getElementById("scoreValue");
  const levelEl = document.getElementById("levelValue");
  const linesEl = document.getElementById("linesValue");
  const pauseOverlay = document.getElementById("pauseOverlay");
  const gameOverOverlay = document.getElementById("gameOverOverlay");
  const finalScoreEl = document.getElementById("finalScore");
  const restartBtn = document.getElementById("restartBtn");

  // ---------- state ----------
  let board, bag, queue, piece, held, canHold;
  let score, level, lines;
  let dropInterval, dropCounter, lastTime;
  let paused, gameOver;

  function newBoard() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  }

  function refillBag() {
    const shuffled = [...TYPES];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  function nextFromQueue() {
    if (queue.length === 0) queue = refillBag();
    return queue.shift();
  }

  function makePiece(type) {
    return { type, rotation: 0, x: 3, y: -1, color: COLORS[type] };
  }

  function cellsFor(p) {
    return SHAPES[p.type][p.rotation].map(([cx, cy]) => [p.x + cx, p.y + cy]);
  }

  function collides(p) {
    for (const [x, y] of cellsFor(p)) {
      if (x < 0 || x >= COLS || y >= ROWS) return true;
      if (y >= 0 && board[y][x]) return true;
    }
    return false;
  }

  function spawnPiece() {
    const type = nextFromQueue();
    piece = makePiece(type);
    if (collides(piece)) {
      endGame();
    }
  }

  function resetGame() {
    board = newBoard();
    queue = refillBag();
    held = null;
    canHold = true;
    score = 0;
    level = 1;
    lines = 0;
    dropInterval = 1000;
    dropCounter = 0;
    paused = false;
    gameOver = false;
    pauseOverlay.classList.add("hidden");
    gameOverOverlay.classList.add("hidden");
    updateStatsUI();
    spawnPiece();
  }

  function updateStatsUI() {
    scoreEl.textContent = score.toLocaleString();
    levelEl.textContent = level;
    linesEl.textContent = lines;
  }

  function lockPiece() {
    for (const [x, y] of cellsFor(piece)) {
      if (y < 0) continue;
      board[y][x] = piece.color;
    }
  }

  function clearLines() {
    let cleared = 0;
    for (let y = ROWS - 1; y >= 0; y--) {
      if (board[y].every((cell) => cell)) {
        board.splice(y, 1);
        board.unshift(Array(COLS).fill(null));
        cleared++;
        y++;
      }
    }
    if (cleared > 0) {
      lines += cleared;
      score += (SCORE_TABLE[cleared] || 800) * level;
      level = Math.floor(lines / 10) + 1;
      dropInterval = Math.max(100, 1000 - (level - 1) * 75);
      updateStatsUI();
    }
  }

  function lockAndAdvance() {
    lockPiece();
    clearLines();
    spawnPiece();
    canHold = true;
  }

  function tryMove(dx, dy) {
    const moved = { ...piece, x: piece.x + dx, y: piece.y + dy };
    if (collides(moved)) return false;
    piece = moved;
    return true;
  }

  function gravityDrop() {
    if (!tryMove(0, 1)) lockAndAdvance();
  }

  function manualSoftDrop() {
    if (tryMove(0, 1)) {
      score += 1;
      updateStatsUI();
    } else {
      lockAndAdvance();
    }
  }

  function hardDrop() {
    let dist = 0;
    while (tryMove(0, 1)) dist++;
    score += dist * 2;
    updateStatsUI();
    lockAndAdvance();
  }

  function rotate() {
    const nextRotation = (piece.rotation + 1) % 4;
    const kicks = [0, -1, 1, -2, 2];
    for (const dx of kicks) {
      const candidate = { ...piece, rotation: nextRotation, x: piece.x + dx };
      if (!collides(candidate)) {
        piece = candidate;
        return;
      }
    }
  }

  function holdPiece() {
    if (!canHold) return;
    const current = piece.type;
    if (held === null) {
      held = current;
      spawnPiece();
    } else {
      const swap = held;
      held = current;
      piece = makePiece(swap);
    }
    canHold = false;
  }

  function ghostY() {
    let gy = piece.y;
    const test = { ...piece };
    while (true) {
      const next = { ...test, y: test.y + 1 };
      if (collides(next)) break;
      test.y = next.y;
    }
    return test.y;
  }

  function togglePause() {
    if (gameOver) return;
    paused = !paused;
    pauseOverlay.classList.toggle("hidden", !paused);
  }

  function endGame() {
    gameOver = true;
    finalScoreEl.textContent = score.toLocaleString();
    gameOverOverlay.classList.remove("hidden");
  }

  // ---------- rendering ----------
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function shade(hex, percent) {
    const num = parseInt(hex.slice(1), 16);
    let r = (num >> 16) + percent;
    let g = ((num >> 8) & 0x00ff) + percent;
    let b = (num & 0x0000ff) + percent;
    r = Math.max(0, Math.min(255, r));
    g = Math.max(0, Math.min(255, g));
    b = Math.max(0, Math.min(255, b));
    return `rgb(${r}, ${g}, ${b})`;
  }

  function drawGem(ctx, x, y, size, color, glow = true) {
    const r = size * 0.22;
    ctx.save();
    if (glow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = size * 0.55;
    }
    const grad = ctx.createLinearGradient(x, y, x + size, y + size);
    grad.addColorStop(0, shade(color, 45));
    grad.addColorStop(1, shade(color, -35));
    roundRect(ctx, x + 1, y + 1, size - 2, size - 2, r);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.shadowBlur = 0;

    // facet highlight
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    roundRect(ctx, x + size * 0.14, y + size * 0.12, size * 0.5, size * 0.2, size * 0.08);
    ctx.fill();

    // sparkle
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    const sx = x + size * 0.76, sy = y + size * 0.24, sr = size * 0.09;
    ctx.beginPath();
    ctx.moveTo(sx, sy - sr);
    ctx.lineTo(sx + sr * 0.3, sy - sr * 0.3);
    ctx.lineTo(sx + sr, sy);
    ctx.lineTo(sx + sr * 0.3, sy + sr * 0.3);
    ctx.lineTo(sx, sy + sr);
    ctx.lineTo(sx - sr * 0.3, sy + sr * 0.3);
    ctx.lineTo(sx - sr, sy);
    ctx.lineTo(sx - sr * 0.3, sy - sr * 0.3);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 1;
    roundRect(ctx, x + 1, y + 1, size - 2, size - 2, r);
    ctx.stroke();
    ctx.restore();
  }

  function drawGhostCell(ctx, x, y, size, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 2;
    roundRect(ctx, x + 2, y + 2, size - 4, size - 4, size * 0.2);
    ctx.stroke();
    ctx.restore();
  }

  function drawBoard() {
    boardCtx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);

    // grid lines
    boardCtx.strokeStyle = "rgba(255,255,255,0.05)";
    boardCtx.lineWidth = 1;
    for (let x = 0; x <= COLS; x++) {
      boardCtx.beginPath();
      boardCtx.moveTo(x * CELL, 0);
      boardCtx.lineTo(x * CELL, ROWS * CELL);
      boardCtx.stroke();
    }
    for (let y = 0; y <= ROWS; y++) {
      boardCtx.beginPath();
      boardCtx.moveTo(0, y * CELL);
      boardCtx.lineTo(COLS * CELL, y * CELL);
      boardCtx.stroke();
    }

    // locked cells
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (board[y][x]) drawGem(boardCtx, x * CELL, y * CELL, CELL, board[y][x]);
      }
    }

    if (piece) {
      // ghost
      const gy = ghostY();
      if (gy !== piece.y) {
        for (const [cx, cy] of SHAPES[piece.type][piece.rotation]) {
          const x = piece.x + cx, y = gy + cy;
          if (y >= 0) drawGhostCell(boardCtx, x * CELL, y * CELL, CELL, piece.color);
        }
      }
      // active piece
      for (const [x, y] of cellsFor(piece)) {
        if (y >= 0) drawGem(boardCtx, x * CELL, y * CELL, CELL, piece.color);
      }
    }
  }

  function drawPreview(ctx, canvas, type) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!type) return;
    const cells = SHAPES[type][0];
    const xs = cells.map((c) => c[0]);
    const ys = cells.map((c) => c[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = (maxX - minX + 1) * CELL;
    const h = (maxY - minY + 1) * CELL;
    const offsetX = (canvas.width - w) / 2;
    const offsetY = (canvas.height - h) / 2;
    for (const [cx, cy] of cells) {
      const x = offsetX + (cx - minX) * CELL;
      const y = offsetY + (cy - minY) * CELL;
      drawGem(ctx, x, y, CELL, COLORS[type]);
    }
  }

  function draw() {
    drawBoard();
    drawPreview(nextCtx, nextCanvas, queue[0]);
    drawPreview(holdCtx, holdCanvas, held);
  }

  // ---------- loop ----------
  function update(time = 0) {
    const delta = time - lastTime;
    lastTime = time;
    if (!paused && !gameOver) {
      dropCounter += delta;
      if (dropCounter > dropInterval) {
        gravityDrop();
        dropCounter = 0;
      }
    }
    draw();
    requestAnimationFrame(update);
  }

  // ---------- input ----------
  window.addEventListener("keydown", (e) => {
    if (e.key === "p" || e.key === "P") {
      togglePause();
      return;
    }
    if (gameOver || paused) return;
    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        tryMove(-1, 0);
        break;
      case "ArrowRight":
        e.preventDefault();
        tryMove(1, 0);
        break;
      case "ArrowDown":
        e.preventDefault();
        manualSoftDrop();
        break;
      case "ArrowUp":
        e.preventDefault();
        rotate();
        break;
      case " ":
        e.preventDefault();
        hardDrop();
        break;
      case "c":
      case "C":
        holdPiece();
        break;
    }
  });

  restartBtn.addEventListener("click", resetGame);

  resetGame();
  requestAnimationFrame(update);
})();
