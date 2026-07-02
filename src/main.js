import './style.css';
import { saveScore, getTopScores, createRoom, joinRoom, listenToRoom, updateRoomState, sendPunishment } from './firebase.js';

// --- AUDIO SYSTEM (Web Audio API Synthesizer) ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playMoveSound() {
  if (audioCtx.state === 'suspended') return;
  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(300, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(150, audioCtx.currentTime + 0.05);
  gainNode.gain.setValueAtTime(0.05, audioCtx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.05);
  osc.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.05);
}

function playRotateSound() {
  if (audioCtx.state === 'suspended') return;
  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(400, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(600, audioCtx.currentTime + 0.08);
  gainNode.gain.setValueAtTime(0.06, audioCtx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08);
  osc.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.08);
}

function playHardDropSound() {
  if (audioCtx.state === 'suspended') return;
  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(120, audioCtx.currentTime);
  osc.frequency.linearRampToValueAtTime(40, audioCtx.currentTime + 0.15);
  gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
  osc.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.15);
}

function playLineClearSound(linesCleared) {
  if (audioCtx.state === 'suspended') return;
  const baseFreqs = [261.63, 329.63, 392.00, 523.25]; // C4, E4, G4, C5
  const duration = 0.12;

  linesCleared = Math.min(linesCleared, 4);

  // Play a quick arpeggio
  for (let i = 0; i < linesCleared; i++) {
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.type = 'sine';
    
    // Higher pitch if more lines cleared
    const freq = baseFreqs[i] * (1 + (linesCleared - 1) * 0.1);
    const time = audioCtx.currentTime + i * 0.06;
    
    osc.frequency.setValueAtTime(freq, time);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.5, time + duration);
    
    gainNode.gain.setValueAtTime(0.08, time);
    gainNode.gain.exponentialRampToValueAtTime(0.001, time + duration);
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    osc.start(time);
    osc.stop(time + duration);
  }
}

// BGM Synth loop
let bgmGain = null;
let bgmInterval = null;
function startBGM() {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  if (bgmInterval) return;

  bgmGain = audioCtx.createGain();
  bgmGain.gain.value = 0.03; // soft bgm
  bgmGain.connect(audioCtx.destination);

  // Cute retro melody notes in C Major / A Minor pentatonic
  const notes = [
    261.63, 293.66, 329.63, 392.00, 440.00, // C4, D4, E4, G4, A4
    523.25, 587.33, 659.25, 783.99, 880.00  // C5, D5, E5, G5, A5
  ];
  
  // Melody pattern (indexes of notes)
  const pattern = [
    0, 2, 4, 3, 5, 4, 7, 6,
    4, 2, 3, 1, 2, 0, 1, 0,
    5, 7, 9, 8, 7, 5, 6, 4,
    3, 1, 2, 0, 4, 3, 2, 0
  ];
  let step = 0;

  bgmInterval = setInterval(() => {
    if (isGameOver) return;
    
    // Play notes in rhythm (some steps are empty)
    if (step % 2 === 0 || Math.random() > 0.4) {
      const osc = audioCtx.createOscillator();
      const noteGain = audioCtx.createGain();
      
      osc.type = 'triangle';
      osc.frequency.value = notes[pattern[step]];
      
      // Sustain note
      noteGain.gain.setValueAtTime(0.04, audioCtx.currentTime);
      noteGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.8);
      
      osc.connect(noteGain);
      noteGain.connect(bgmGain);
      
      osc.start();
      osc.stop(audioCtx.currentTime + 0.8);
    }
    
    step = (step + 1) % pattern.length;
  }, 350);
}

// --- GAME DEFINITIONS ---
const COLS = 10;
const ROWS = 20;

// Fruit representations for tetrominoes
const FRUITS = {
  1: { name: "Arándano", emoji: "🫐", color: "#5c8aff" }, // I
  2: { name: "Limón", emoji: "🍋", color: "#ffd700" },    // O
  3: { name: "Uva", emoji: "🍇", color: "#a855f7" },      // T
  4: { name: "Melón", emoji: "🍈", color: "#4ade80" },    // S
  5: { name: "Cereza", emoji: "🍒", color: "#f87171" },   // Z
  6: { name: "Fresa", emoji: "🍓", color: "#ec4899" },    // J
  7: { name: "Mandarina", emoji: "🍊", color: "#f97316" }, // L
  8: { name: "Roca", emoji: "🪨", color: "#78716c" }       // Garbage / Angry Rock
};

const TETROMINOES = {
  1: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  2: [[2,2],[2,2]],                             // O
  3: [[0,3,0],[3,3,3],[0,0,0]],                 // T
  4: [[0,4,4],[4,4,0],[0,0,0]],                 // S
  5: [[5,5,0],[0,5,5],[0,0,0]],                 // Z
  6: [[6,0,0],[6,6,6],[0,0,0]],                 // J
  7: [[0,0,7],[7,7,7],[0,0,0]]                  // L
};

// --- STATE VARIABLES ---
let grid = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
let currentPiece = null;
let nextPieceId = 1;
let heldPieceId = null;
let canHold = true;
let score = 0;
let level = 1;
let lines = 0;
let isGameOver = false;

// Time tracking for gravity
let lastDropTime = 0;
let dropInterval = 1000; // ms

// Multiplayer variables
let isMultiplayer = false;
let isPlayer1 = true;
let roomCode = "";
let unsubscribeRoom = null;
let localPunishmentCount = 0;
let pendingPunishments = 0;
let opponentGrid = Array.from({ length: ROWS }, () => Array(COLS).fill(0));

// Randomizer bag (Tetris 7-bag randomizer)
let bag = [];
function getNextPieceFromBag() {
  if (bag.length === 0) {
    bag = [1, 2, 3, 4, 5, 6, 7];
    // Shuffle bag
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
  }
  return bag.pop();
}

// --- DOM ELEMENTS ---
const startScreen = document.getElementById('start-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const playArea = document.getElementById('play-area');
const uiHeader = document.getElementById('ui-header');
const mobileControls = document.getElementById('mobile-controls');

const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const linesEl = document.getElementById('lines');
const opponentScoreEl = document.getElementById('opponent-score');
const opponentScoreContainer = document.getElementById('opponent-score-container');

const gameCanvas = document.getElementById('game-canvas');
let holdCanvas = null;
let nextCanvas = null;
const rivalCanvas = document.getElementById('rival-canvas');
const rivalBoardBox = document.getElementById('rival-board-box');

const playerNameInput = document.getElementById('player-name');
const submitScoreBtn = document.getElementById('submit-score-btn');
const leaderboardList = document.getElementById('leaderboard-list');

// Canvas Contexts
const ctx = gameCanvas.getContext('2d');
let holdCtx = null;
let nextCtx = null;
const rivalCtx = rivalCanvas.getContext('2d');

// --- CELL DRAWER (Kawaii style) ---
function drawCell(ctx, r, c, val, cellSize, offset = { x: 0, y: 0 }, ghost = false, isActive = false, isHead = false) {
  if (val === 0) return;
  const fruit = FRUITS[val];
  if (!fruit) return;

  const x = offset.x + c * cellSize;
  const y = offset.y + r * cellSize;
  const cx = x + cellSize / 2;
  const cy = y + cellSize / 2;
  const radius = cellSize * 0.52; // Un poco más grandes para que se toquen y formen figuras de burbujas unificadas

  ctx.save();
  
  if (ghost) {
    // Ghost piece: translucent, dashed circular border, no face
    ctx.strokeStyle = fruit.color;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(cx, cy, (cellSize * 0.5) - 1, 0, Math.PI * 2);
    ctx.stroke();
    
    // Draw emoji very faintly in the center
    ctx.globalAlpha = 0.25;
    ctx.font = `${cellSize * 0.6}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fruit.emoji, cx, cy);
    ctx.restore();
    return;
  }

  // Draw circular fruit body
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = fruit.color;
  ctx.fill();

  // Draw emoji texture in the center (vibrant and clear)
  ctx.globalAlpha = 0.95;
  ctx.font = `${cellSize * 0.64}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(fruit.emoji, cx, cy);
  ctx.globalAlpha = 1.0;

  // Draw face only for head cell of active piece or for garbage rock (val === 8)
  const shouldDrawFace = (isActive && isHead) || val === 8;

  if (shouldDrawFace) {
    ctx.fillStyle = '#4a2511'; // Warm brown color for face details
    const faceR = radius;
    const eyeOffset = faceR * 0.32;
    const eyeSize = Math.max(1.8, faceR * 0.08);

    // Eyes
    ctx.beginPath();
    ctx.arc(cx - eyeOffset, cy - eyeOffset * 0.1, eyeSize, 0, Math.PI * 2);
    ctx.arc(cx + eyeOffset, cy - eyeOffset * 0.1, eyeSize, 0, Math.PI * 2);
    ctx.fill();

    // Blushing cheeks
    ctx.fillStyle = 'rgba(255, 120, 150, 0.45)';
    ctx.beginPath();
    ctx.arc(cx - eyeOffset * 1.3, cy + eyeOffset * 0.35, eyeSize * 1.8, 0, Math.PI * 2);
    ctx.arc(cx + eyeOffset * 1.3, cy + eyeOffset * 0.35, eyeSize * 1.8, 0, Math.PI * 2);
    ctx.fill();

    // Mouth/Smile
    ctx.strokeStyle = '#4a2511';
    ctx.lineWidth = Math.max(1.5, faceR * 0.06);
    ctx.lineCap = 'round';
    ctx.beginPath();
    
    if (val === 8) {
      // Angry rock has flat or frowning mouth, and angry eyebrows!
      // Frown mouth
      ctx.arc(cx, cy + eyeOffset * 0.5, eyeOffset * 0.4, Math.PI, 0);
      ctx.stroke();

      // Angry eyebrows
      ctx.strokeStyle = '#4a2511';
      ctx.lineWidth = faceR * 0.08;
      ctx.beginPath();
      ctx.moveTo(cx - eyeOffset * 1.3, cy - eyeOffset * 0.5);
      ctx.lineTo(cx - eyeOffset * 0.2, cy - eyeOffset * 0.25);
      ctx.moveTo(cx + eyeOffset * 1.3, cy - eyeOffset * 0.5);
      ctx.lineTo(cx + eyeOffset * 0.2, cy - eyeOffset * 0.25);
      ctx.stroke();
    } else {
      // Normal happy smile
      ctx.arc(cx, cy + eyeOffset * 0.1, eyeOffset * 0.55, 0.1, Math.PI - 0.1);
      ctx.stroke();
    }
  }

  // Specular Highlight (glossy bubble glare on top-left)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.beginPath();
  ctx.arc(cx - radius * 0.38, cy - radius * 0.38, radius * 0.12, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// --- TETRIS GAME PIECE CLASS ---
class Piece {
  constructor(id, r = 0, c = 3) {
    this.id = id;
    this.matrix = JSON.parse(JSON.stringify(TETROMINOES[id]));
    this.r = r;
    this.c = c;
  }

  // Rotate clockwise
  rotate() {
    const size = this.matrix.length;
    const rotated = Array.from({ length: size }, () => Array(size).fill(0));
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        rotated[c][size - 1 - r] = this.matrix[r][c];
      }
    }
    const previousMatrix = this.matrix;
    this.matrix = rotated;

    // Simple wall kick: if rotation causes collision, try moving left/right
    if (this.collides(0, 0)) {
      if (!this.collides(0, -1)) { this.c -= 1; }
      else if (!this.collides(0, 1)) { this.c += 1; }
      else if (!this.collides(0, -2)) { this.c -= 2; }
      else if (!this.collides(0, 2)) { this.c += 2; }
      else if (!this.collides(-1, 0)) { this.r -= 1; } // floor kick
      else {
        // rotation failed, revert
        this.matrix = previousMatrix;
        return false;
      }
    }
    playRotateSound();
    return true;
  }

  collides(dr, dc, matrix = this.matrix) {
    for (let r = 0; r < matrix.length; r++) {
      for (let c = 0; c < matrix[r].length; c++) {
        if (matrix[r][c] !== 0) {
          const nr = this.r + r + dr;
          const nc = this.c + c + dc;
          
          if (nc < 0 || nc >= COLS || nr >= ROWS) {
            return true;
          }
          if (nr >= 0 && grid[nr][nc] !== 0) {
            return true;
          }
        }
      }
    }
    return false;
  }

  move(dr, dc) {
    if (!this.collides(dr, dc)) {
      this.r += dr;
      this.c += dc;
      if (dc !== 0 || dr > 0) playMoveSound();
      return true;
    }
    return false;
  }

  // Project piece downwards to find ghost position
  getGhostRow() {
    let dr = 0;
    while (!this.collides(dr + 1, 0)) {
      dr++;
    }
    return this.r + dr;
  }

  lock() {
    for (let r = 0; r < this.matrix.length; r++) {
      for (let c = 0; c < this.matrix[r].length; c++) {
        if (this.matrix[r][c] !== 0) {
          const nr = this.r + r;
          const nc = this.c + c;
          if (nr >= 0) {
            grid[nr][nc] = this.id;
          } else {
            // Block topped out!
            triggerGameOver();
            return;
          }
        }
      }
    }
    
    checkLineClears();
    canHold = true;
    spawnPiece();
    
    // Sync grid with Firestore
    if (isMultiplayer) {
      sendGridSync();
    }
  }
}

// --- GAME LOGIC FUNCTIONS ---
function spawnPiece() {
  currentPiece = new Piece(nextPieceId);
  nextPieceId = getNextPieceFromBag();
  drawNextPreview();
  
  // Check collision at spawn
  if (currentPiece.collides(0, 0)) {
    triggerGameOver();
  }
}

function holdPiece() {
  if (!canHold || isGameOver) return;
  
  playRotateSound();
  const currentId = currentPiece.id;
  
  if (heldPieceId === null) {
    heldPieceId = currentId;
    spawnPiece();
  } else {
    const temp = heldPieceId;
    heldPieceId = currentId;
    currentPiece = new Piece(temp);
  }
  
  canHold = false;
  drawHoldPreview();
}

function checkLineClears() {
  let clearedLines = 0;
  
  for (let r = ROWS - 1; r >= 0; r--) {
    if (grid[r].every(val => val !== 0)) {
      grid.splice(r, 1);
      grid.unshift(Array(COLS).fill(0));
      clearedLines++;
      r++; // re-check the same row index which now has the row from above
    }
  }
  
  if (clearedLines > 0) {
    playLineClearSound(clearedLines);
    
    // Standard Tetris scoring
    const linePoints = [0, 100, 300, 500, 800];
    score += linePoints[clearedLines] * level;
    lines += clearedLines;
    
    // Level up every 10 lines
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(80, 1000 - (level - 1) * 90);
    
    updateScoreUI();

    // Versus Multi-player attack
    if (isMultiplayer && clearedLines >= 2) {
      // 2 lines -> 1 trash line, 3 lines -> 2 trash, 4 lines -> 4 trash
      const attackCount = clearedLines === 4 ? 4 : clearedLines - 1;
      sendPunishment(roomCode, isPlayer1, attackCount);
    }
  }
}

// Add garbage lines (punishments)
function addGarbageLines(count) {
  // Play a shake effect on the game container
  const container = document.getElementById('game-container');
  container.classList.add('shake');
  setTimeout(() => container.classList.remove('shake'), 400);

  playHardDropSound();

  // Shift grid rows up
  for (let i = 0; i < count; i++) {
    // Check if topping out
    if (grid[0].some(val => val !== 0)) {
      triggerGameOver();
      return;
    }
    
    grid.shift();
    
    // Create new garbage row (angry rocks, with one single hole)
    const newRow = Array(COLS).fill(8); // 8 is Roca
    const holeIndex = Math.floor(Math.random() * COLS);
    newRow[holeIndex] = 0;
    grid.push(newRow);
  }

  // If piece is now colliding, kick it up or trigger gameover
  if (currentPiece && currentPiece.collides(0, 0)) {
    let kicked = false;
    for (let kick = -1; kick >= -4; kick--) {
      if (!currentPiece.collides(kick, 0)) {
        currentPiece.r += kick;
        kicked = true;
        break;
      }
    }
    if (!kicked) {
      triggerGameOver();
    }
  }

  if (isMultiplayer) {
    sendGridSync();
  }
}

// Sync grid to string (e.g. "000304...")
function sendGridSync() {
  const gridStr = grid.map(row => row.join('')).join('');
  updateRoomState(roomCode, isPlayer1, {
    score: score,
    lines: lines,
    level: level,
    grid: gridStr
  });
}

function updateScoreUI() {
  scoreEl.innerText = score;
  levelEl.innerText = level;
  linesEl.innerText = lines;
}

// --- RENDER FUNCTIONS ---
function resizeCanvas() {
  const wrapper = gameCanvas.parentElement;
  const rect = wrapper.getBoundingClientRect();
  
  // Enforce 1:2 aspect ratio for Tetris (10x20)
  let canvasW = rect.width;
  let canvasH = rect.width * 2;
  
  if (canvasH > rect.height) {
    canvasH = rect.height;
    canvasW = rect.height / 2;
  }
  
  gameCanvas.width = canvasW;
  gameCanvas.height = canvasH;
}

function drawGridBackground(canvasWidth, canvasHeight, cellSize) {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Draw grid lines
  ctx.strokeStyle = 'rgba(255, 182, 193, 0.25)';
  ctx.lineWidth = 1;
  
  // Vertical lines
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * cellSize, 0);
    ctx.lineTo(c * cellSize, canvasHeight);
    ctx.stroke();
  }
  // Horizontal lines
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * cellSize);
    ctx.lineTo(canvasWidth, r * cellSize);
    ctx.stroke();
  }
}

function drawGame() {
  ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
  
  const cellSize = gameCanvas.width / COLS;
  
  // Background grid lines
  drawGridBackground(gameCanvas.width, gameCanvas.height, cellSize);
  
  // Draw static locked blocks on the grid
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c] !== 0) {
        drawCell(ctx, r, c, grid[r][c], cellSize);
      }
    }
  }

  // Draw current falling piece
  if (currentPiece && !isGameOver) {
    // 1. Draw ghost piece first
    const ghostRow = currentPiece.getGhostRow();
    for (let r = 0; r < currentPiece.matrix.length; r++) {
      for (let c = 0; c < currentPiece.matrix[r].length; c++) {
        if (currentPiece.matrix[r][c] !== 0) {
          drawCell(ctx, ghostRow + r, currentPiece.c + c, currentPiece.id, cellSize, { x: 0, y: 0 }, true);
        }
      }
    }

    // 2. Draw actual piece
    let headFound = false;
    for (let r = 0; r < currentPiece.matrix.length; r++) {
      for (let c = 0; c < currentPiece.matrix[r].length; c++) {
        if (currentPiece.matrix[r][c] !== 0) {
          const isHead = !headFound;
          headFound = true;
          drawCell(ctx, currentPiece.r + r, currentPiece.c + c, currentPiece.id, cellSize, { x: 0, y: 0 }, false, true, isHead);
        }
      }
    }
  }
}

function drawNextPreview() {
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const matrix = TETROMINOES[nextPieceId];
  if (!matrix) return;
  
  const size = matrix.length;
  // Center alignment offset
  const cellS = 12;
  const offsetX = (nextCanvas.width - size * cellS) / 2;
  const offsetY = (nextCanvas.height - size * cellS) / 2;
  
  let headFound = false;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c] !== 0) {
        const isHead = !headFound;
        headFound = true;
        drawCell(nextCtx, r, c, nextPieceId, cellS, { x: offsetX, y: offsetY }, false, true, isHead);
      }
    }
  }
}

function drawHoldPreview() {
  holdCtx.clearRect(0, 0, holdCanvas.width, holdCanvas.height);
  if (heldPieceId === null) return;
  
  const matrix = TETROMINOES[heldPieceId];
  const size = matrix.length;
  const cellS = 12;
  const offsetX = (holdCanvas.width - size * cellS) / 2;
  const offsetY = (holdCanvas.height - size * cellS) / 2;
  
  let headFound = false;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c] !== 0) {
        const isHead = !headFound;
        headFound = true;
        drawCell(holdCtx, r, c, heldPieceId, cellS, { x: offsetX, y: offsetY }, false, true, isHead);
      }
    }
  }
}

function drawRivalGrid() {
  rivalCtx.clearRect(0, 0, rivalCanvas.width, rivalCanvas.height);
  
  // Background grid
  rivalCtx.fillStyle = 'rgba(255,255,255,0.3)';
  rivalCtx.fillRect(0, 0, rivalCanvas.width, rivalCanvas.height);
  
  const cellS = rivalCanvas.width / COLS;
  
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const val = opponentGrid[r][c];
      if (val !== 0) {
        // Draw simplified cell for performance/space (small circle with color)
        const cx = c * cellS + cellS / 2;
        const cy = r * cellS + cellS / 2;
        const radius = cellS * 0.4;
        
        rivalCtx.beginPath();
        rivalCtx.arc(cx, cy, radius, 0, Math.PI * 2);
        rivalCtx.fillStyle = FRUITS[val]?.color || '#ccc';
        rivalCtx.fill();

        // Draw small emoticon dots
        rivalCtx.fillStyle = '#4a2511';
        rivalCtx.fillRect(cx - radius * 0.4, cy - radius * 0.2, 1, 1);
        rivalCtx.fillRect(cx + radius * 0.4, cy - radius * 0.2, 1, 1);
      }
    }
  }
}

// --- GAME LOOP ---
function update(time = 0) {
  if (isGameOver) return;
  
  const deltaTime = time - lastDropTime;
  if (deltaTime > dropInterval) {
    if (!currentPiece.move(1, 0)) {
      currentPiece.lock();
    }
    lastDropTime = time;
  }
  
  drawGame();
  requestAnimationFrame(update);
}

// --- CORE CONTROL ACTIONS ---
function handleLeft() {
  if (!isGameOver && currentPiece) currentPiece.move(0, -1);
}

function handleRight() {
  if (!isGameOver && currentPiece) currentPiece.move(0, 1);
}

function handleRotate() {
  if (!isGameOver && currentPiece) currentPiece.rotate();
}

function handleSoftDrop() {
  if (!isGameOver && currentPiece) currentPiece.move(1, 0);
}

function handleHardDrop() {
  if (isGameOver || !currentPiece) return;
  
  const ghostRow = currentPiece.getGhostRow();
  const droppedLines = ghostRow - currentPiece.r;
  currentPiece.r = ghostRow;
  
  // Extra score for hard drop
  score += droppedLines * 2;
  updateScoreUI();
  
  playHardDropSound();
  currentPiece.lock();
}

// --- PLAYER INPUT SYSTEM ---
function setupInput() {
  // Keyboard
  window.addEventListener('keydown', (e) => {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    if (isGameOver) return;
    
    switch (e.key) {
      case 'ArrowLeft':
      case 'a':
      case 'A':
        handleLeft();
        break;
      case 'ArrowRight':
      case 'd':
      case 'D':
        handleRight();
        break;
      case 'ArrowUp':
      case 'w':
      case 'W':
        handleRotate();
        break;
      case 'ArrowDown':
      case 's':
      case 'S':
        handleSoftDrop();
        break;
      case ' ':
        e.preventDefault();
        handleHardDrop();
        break;
      case 'c':
      case 'C':
      case 'Shift':
        holdPiece();
        break;
    }
  });

  // Touch controls
  document.getElementById('ctrl-left').addEventListener('click', handleLeft);
  document.getElementById('ctrl-right').addEventListener('click', handleRight);
  document.getElementById('ctrl-rotate').addEventListener('click', handleRotate);
  document.getElementById('ctrl-down').addEventListener('click', handleSoftDrop);
  document.getElementById('ctrl-drop').addEventListener('click', handleHardDrop);
  document.getElementById('ctrl-hold').addEventListener('click', holdPiece);

  // Restart buttons
  document.getElementById('restart-button').addEventListener('click', () => {
    window.location.reload();
  });
  
  // Leaderboard save
  submitScoreBtn.addEventListener('click', async () => {
    const name = playerNameInput.value.trim();
    if (!name) return alert('Por favor, ingresa tu nombre.');
    
    submitScoreBtn.disabled = true;
    submitScoreBtn.innerText = 'Guardando...';
    
    const success = await saveScore(name, score);
    if (success) {
      document.getElementById('submit-score-section').classList.add('hidden');
      await loadLeaderboard();
    } else {
      alert('Error al guardar record.');
      submitScoreBtn.disabled = false;
      submitScoreBtn.innerText = 'Guardar Récord';
    }
  });
}

// --- GAME STATE TRIGGERS ---
function triggerGameOver() {
  if (isGameOver) return;
  isGameOver = true;
  
  playGameOverSound();
  
  document.getElementById('game-over-title').innerText = isMultiplayer ? "¡Has Perdido!" : "¡Juego Terminado!";
  document.getElementById('final-score').innerText = score;
  document.getElementById('final-lines').innerText = lines;
  
  document.getElementById('submit-score-section').classList.remove('hidden');
  playerNameInput.value = '';
  submitScoreBtn.disabled = false;
  submitScoreBtn.innerText = 'Guardar Récord';
  
  gameOverScreen.classList.remove('hidden');
  loadLeaderboard();
  
  if (isMultiplayer) {
    updateRoomState(roomCode, isPlayer1, {}, isPlayer1 ? 'player1_lost' : 'player2_lost');
    if (unsubscribeRoom) {
      unsubscribeRoom();
      unsubscribeRoom = null;
    }
  }
}

function triggerWin() {
  if (isGameOver) return;
  isGameOver = true;
  
  playLineClearSound(4); // Play epic chords
  
  document.getElementById('game-over-title').innerText = "¡Victoria! 🎉";
  document.getElementById('final-score').innerText = score;
  document.getElementById('final-lines').innerText = lines;
  
  document.getElementById('submit-score-section').classList.remove('hidden');
  playerNameInput.value = '';
  submitScoreBtn.disabled = false;
  submitScoreBtn.innerText = 'Guardar Récord';
  
  gameOverScreen.classList.remove('hidden');
  loadLeaderboard();
  
  if (isMultiplayer && unsubscribeRoom) {
    unsubscribeRoom();
    unsubscribeRoom = null;
  }
}

function playGameOverSound() {
  if (audioCtx.state === 'suspended') return;
  // Sad arpeggio: C, G, Eb, C (descending)
  const notes = [523.25, 392.00, 311.13, 261.63];
  notes.forEach((freq, idx) => {
    const time = audioCtx.currentTime + idx * 0.15;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);
    
    gain.gain.setValueAtTime(0.08, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.35);
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.start(time);
    osc.stop(time + 0.35);
  });
}

async function loadLeaderboard() {
  leaderboardList.innerHTML = '<li>Cargando...</li>';
  const topScores = await getTopScores(5);
  leaderboardList.innerHTML = '';
  
  if (topScores.length === 0) {
    leaderboardList.innerHTML = '<li>Aún no hay récords</li>';
    return;
  }
  
  topScores.forEach((s, idx) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>#${idx + 1} <b>${s.name}</b></span> <span>${s.score} pts</span>`;
    leaderboardList.appendChild(li);
  });
}

// --- MULTIPLAYER SETUP ---
function setupMultiplayer() {
  const playSoloBtn = document.getElementById('play-solo-btn');
  const playMultiBtn = document.getElementById('play-multi-btn');
  const multiplayerLobby = document.getElementById('multiplayer-lobby');
  const waitingRoom = document.getElementById('waiting-room');
  const roomCodeInput = document.getElementById('room-code-input');
  const createRoomBtn = document.getElementById('create-room-btn');
  const joinRoomBtn = document.getElementById('join-room-btn');
  const backToMenuBtn = document.getElementById('back-to-menu-btn');
  const roomCodeDisplay = document.getElementById('room-code-display');

  playSoloBtn.addEventListener('click', () => {
    isMultiplayer = false;
    startGame();
  });

  playMultiBtn.addEventListener('click', () => {
    document.getElementById('mode-selection').classList.add('hidden');
    multiplayerLobby.classList.remove('hidden');
  });

  backToMenuBtn.addEventListener('click', () => {
    multiplayerLobby.classList.add('hidden');
    document.getElementById('mode-selection').classList.remove('hidden');
  });

  createRoomBtn.addEventListener('click', async () => {
    roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
    isPlayer1 = true;
    isMultiplayer = true;
    
    createRoomBtn.disabled = true;
    createRoomBtn.innerText = 'Creando sala...';
    
    const success = await createRoom(roomCode);
    if (success) {
      multiplayerLobby.classList.add('hidden');
      waitingRoom.classList.remove('hidden');
      roomCodeDisplay.innerText = roomCode;
      
      // Listen for player 2 joining
      unsubscribeRoom = listenToRoom(roomCode, (data) => {
        if (data.status === 'playing') {
          startGame();
        }
      });
    } else {
      alert("Error al crear sala");
      createRoomBtn.disabled = false;
      createRoomBtn.innerText = 'Crear Sala';
    }
  });

  joinRoomBtn.addEventListener('click', async () => {
    const code = roomCodeInput.value.trim().toUpperCase();
    if (code.length !== 4) return alert("Ingresa un código de 4 letras.");
    
    joinRoomBtn.disabled = true;
    joinRoomBtn.innerText = 'Uniéndose...';
    roomCode = code;
    isPlayer1 = false;
    isMultiplayer = true;
    
    const success = await joinRoom(code);
    if (success) {
      startGame();
    } else {
      alert("No se pudo unir. ¿Código correcto o sala llena?");
      joinRoomBtn.disabled = false;
      joinRoomBtn.innerText = 'Unirse a Sala';
    }
  });
}

function startGame() {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  startScreen.classList.add('hidden');
  
  // Show UI elements
  uiHeader.classList.remove('hidden');
  playArea.classList.remove('hidden');
  
  // Show touch controls on touch devices
  if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
    mobileControls.classList.remove('hidden');
  }

  // Set up canvas references and display overlays / panels based on mode
  if (isMultiplayer) {
    document.getElementById('vs-panel').classList.remove('hidden');
    document.getElementById('hold-overlay').classList.add('hidden');
    document.getElementById('next-overlay').classList.add('hidden');
    
    holdCanvas = document.getElementById('vs-hold-canvas');
    nextCanvas = document.getElementById('vs-next-canvas');
  } else {
    document.getElementById('vs-panel').classList.add('hidden');
    document.getElementById('hold-overlay').classList.remove('hidden');
    document.getElementById('next-overlay').classList.remove('hidden');
    
    holdCanvas = document.getElementById('hold-canvas');
    nextCanvas = document.getElementById('next-canvas');
  }
  
  holdCtx = holdCanvas.getContext('2d');
  nextCtx = nextCanvas.getContext('2d');

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  
  if (isMultiplayer) {
    uiHeader.classList.add('has-rival');
    opponentScoreContainer.classList.remove('hidden');
    rivalBoardBox.classList.remove('hidden');
    
    if (unsubscribeRoom) unsubscribeRoom();
    
    // Listen to real-time opponent updates and punishments
    unsubscribeRoom = listenToRoom(roomCode, (data) => {
      // Check for victory/defeat status
      if (data.status === 'player1_lost' && !isPlayer1) {
        triggerWin();
        return;
      }
      if (data.status === 'player2_lost' && isPlayer1) {
        triggerWin();
        return;
      }
      
      const opponentData = isPlayer1 ? data.player2 : data.player1;
      const myData = isPlayer1 ? data.player1 : data.player2;
      
      if (opponentData) {
        opponentScoreEl.innerText = opponentData.score;
        
        // Parse opponent grid string back to 2D array
        if (opponentData.grid) {
          const gridStr = opponentData.grid;
          let idx = 0;
          for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
              opponentGrid[r][c] = parseInt(gridStr.charAt(idx++)) || 0;
            }
          }
          drawRivalGrid();
        }
      }
      
      if (myData && myData.punishments > localPunishmentCount) {
        const newAttack = myData.punishments - localPunishmentCount;
        pendingPunishments += newAttack;
        localPunishmentCount = myData.punishments;
      }
    });
  }

  resetGame();
}

function resetGame() {
  grid = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  opponentGrid = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  score = 0;
  lines = 0;
  level = 1;
  isGameOver = false;
  heldPieceId = null;
  canHold = true;
  localPunishmentCount = 0;
  pendingPunishments = 0;
  
  updateScoreUI();
  drawHoldPreview();
  
  bag = [];
  nextPieceId = getNextPieceFromBag();
  spawnPiece();
  
  lastDropTime = performance.now();
  startBGM();
  
  // Clear game loops
  requestAnimationFrame(update);
  
  // Local garbage listener loop
  const garbageCheckInterval = setInterval(() => {
    if (isGameOver) {
      clearInterval(garbageCheckInterval);
      return;
    }
    if (pendingPunishments > 0) {
      addGarbageLines(pendingPunishments);
      pendingPunishments = 0;
    }
  }, 100);

  if (isMultiplayer) {
    sendGridSync();
    drawRivalGrid();
  }
}

// --- INITIALIZATION ---
function init() {
  setupInput();
  setupMultiplayer();
}

window.onload = init;
