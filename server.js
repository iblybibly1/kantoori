import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { Game, Phase } from './src/game.js';
import {
  calcRoundResult,
  calcForfeitResult,
  calcInvalidWinResult,
  isDoubleGame,
} from './src/scoring.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const app    = express();
const http   = createServer(app);
const io     = new Server(http);
const PORT   = process.env.PORT || 3000;

app.use(express.static(join(__dirname, 'public')));

// ── Room store ────────────────────────────────────────────────────────────────

// rooms: Map<code, Room>
// Room = {
//   code, phase, hostId, bankId,
//   players: [{id, nickname, color, chips, stats, connected, seatIndex}],
//   game: Game | null,
//   actionLock: bool   ← prevents concurrent game actions
// }

const rooms = new Map();

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function makeStats() {
  return { wins: 0, thankYous: 0, packs: 0, forfeits: 0, invalidWins: 0, rounds: 0 };
}

// ── Broadcast helpers ─────────────────────────────────────────────────────────

function roomInfo(room) {
  return {
    code:    room.code,
    phase:   room.phase,
    hostId:  room.hostId,
    bankId:  room.bankId,
    players: room.players.map(p => ({
      id:         p.id,
      nickname:   p.nickname,
      color:      p.color,
      chips:      p.chips,
      stats:      { ...p.stats },
      connected:  p.connected,
      seatIndex:  p.seatIndex,
    })),
  };
}

function broadcastRoomUpdate(room) {
  const info = roomInfo(room);
  for (const player of room.players) {
    const sock = io.sockets.sockets.get(player.id);
    if (!sock) continue;

    let myState = null;
    if (room.game && room.phase !== 'lobby') {
      myState = room.game.getState(player.seatIndex);
    }

    sock.emit('room-update', {
      roomInfo: info,
      myState,
      mySeat:   player.seatIndex,
    });
  }
}

// ── Socket event handlers ─────────────────────────────────────────────────────

io.on('connection', (socket) => {

  // ── create-room ──────────────────────────────────────────────────────────────
  socket.on('create-room', ({ nickname, color }) => {
    if (!nickname || !color) return socket.emit('error', { msg: 'nickname and color required' });

    const code = genCode();
    const player = {
      id:        socket.id,
      nickname:  nickname.trim().slice(0, 20),
      color,
      chips:     0,
      stats:     makeStats(),
      connected: true,
      seatIndex: 0,
    };
    const room = {
      code,
      phase:      'lobby',
      hostId:     socket.id,
      bankId:     null,
      players:    [player],
      game:       null,
      actionLock: false,
    };
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    broadcastRoomUpdate(room);
  });

  // ── join-room ─────────────────────────────────────────────────────────────────
  socket.on('join-room', ({ code, nickname, color }) => {
    const room = rooms.get(code?.toUpperCase());
    if (!room) return socket.emit('error', { msg: 'Room not found' });

    const trimmedNick = nickname?.trim().slice(0, 20);
    if (!trimmedNick) return socket.emit('error', { msg: 'nickname required' });
    if (!color)       return socket.emit('error', { msg: 'color required' });

    // Reconnection: same code + same nickname, already in room
    const existing = room.players.find(p => p.nickname === trimmedNick);
    if (existing) {
      const oldId = existing.id;
      existing.id        = socket.id;
      existing.connected = true;
      // Keep host/bank roles pointing to the new socket id
      if (room.hostId === oldId) room.hostId = socket.id;
      if (room.bankId === oldId) room.bankId = socket.id;
      socket.join(code);
      socket.data.roomCode = code;
      broadcastRoomUpdate(room);
      return;
    }

    if (room.phase !== 'lobby') return socket.emit('error', { msg: 'Game already in progress' });
    if (room.players.length >= 6) return socket.emit('error', { msg: 'Room is full' });

    const colorTaken = room.players.some(p => p.color === color);
    if (colorTaken) return socket.emit('error', { msg: 'Color already taken' });

    const seatIndex = room.players.length;
    room.players.push({
      id:        socket.id,
      nickname:  trimmedNick,
      color,
      chips:     0,
      stats:     makeStats(),
      connected: true,
      seatIndex,
    });
    socket.join(code);
    socket.data.roomCode = code;
    broadcastRoomUpdate(room);
  });

  // ── assign-bank ───────────────────────────────────────────────────────────────
  socket.on('assign-bank', ({ targetId }) => {
    const room = getPlayerRoom(socket);
    if (!room) return socket.emit('error', { msg: 'Not in a room' });
    if (socket.id !== room.hostId) return socket.emit('error', { msg: 'Only host can assign bank' });
    const target = room.players.find(p => p.id === targetId);
    if (!target) return socket.emit('error', { msg: 'Player not found' });
    room.bankId = (room.bankId === targetId) ? null : targetId; // toggle
    broadcastRoomUpdate(room);
  });

  // ── set-chips ─────────────────────────────────────────────────────────────────
  socket.on('set-chips', ({ playerId, amount }) => {
    const room = getPlayerRoom(socket);
    if (!room) return socket.emit('error', { msg: 'Not in a room' });
    const isHost = socket.id === room.hostId;
    const isBank = socket.id === room.bankId;
    if (!isHost && !isBank) return socket.emit('error', { msg: 'Only host or bank can set chips' });
    if (room.phase !== 'lobby' && room.phase !== 'between-rounds')
      return socket.emit('error', { msg: 'Can only set chips in lobby or between rounds' });
    const target = room.players.find(p => p.id === playerId);
    if (!target) return socket.emit('error', { msg: 'Player not found' });
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0) return socket.emit('error', { msg: 'Invalid amount' });
    target.chips = amt;
    broadcastRoomUpdate(room);
  });

  // ── distribute-chips ──────────────────────────────────────────────────────────
  socket.on('distribute-chips', ({ fromId, toId, amount }) => {
    const room = getPlayerRoom(socket);
    if (!room) return socket.emit('error', { msg: 'Not in a room' });
    if (socket.id !== room.hostId && socket.id !== room.bankId)
      return socket.emit('error', { msg: 'Only host or bank can distribute chips' });
    if (room.phase === 'playing') return socket.emit('error', { msg: 'Cannot transfer during active turn' });

    const from = room.players.find(p => p.id === fromId);
    const to   = room.players.find(p => p.id === toId);
    if (!from || !to) return socket.emit('error', { msg: 'Player not found' });
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return socket.emit('error', { msg: 'Invalid amount' });

    from.chips -= amt;
    to.chips   += amt;
    broadcastRoomUpdate(room);
  });

  // ── start-game ────────────────────────────────────────────────────────────────
  socket.on('start-game', () => {
    const room = getPlayerRoom(socket);
    if (!room) return socket.emit('error', { msg: 'Not in a room' });
    if (socket.id !== room.hostId) return socket.emit('error', { msg: 'Only host can start game' });
    if (room.phase !== 'lobby') return socket.emit('error', { msg: 'Game already started' });
    if (room.players.length < 2) return socket.emit('error', { msg: 'Need at least 2 players' });

    room.game  = new Game(room.players.length);
    room.phase = 'playing';
    broadcastRoomUpdate(room);
  });

  // ── game-action ───────────────────────────────────────────────────────────────
  socket.on('game-action', ({ type, data = {} }) => {
    const room = getPlayerRoom(socket);
    if (!room) return socket.emit('error', { msg: 'Not in a room' });
    if (room.phase !== 'playing') return socket.emit('error', { msg: 'Game is not active' });
    if (room.actionLock) return socket.emit('error', { msg: 'Wait for previous action to complete' });

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return socket.emit('error', { msg: 'Not in this room' });

    const game = room.game;
    if (player.seatIndex !== game.currentPlayer)
      return socket.emit('error', { msg: "It's not your turn" });

    room.actionLock = true;
    try {
      let result;

      switch (type) {
        case 'draw-stock':
          result = game.drawFromStock();
          break;

        case 'draw-discard':
          result = game.drawFromDiscard();
          break;

        case 'pack':
          result = game.pack();
          break;

        case 'thank-you':
          result = game.thankYou();
          player.stats.thankYous++;
          break;

        case 'discard':
          result = game.discard(data.cardIndex);
          break;

        case 'declare': {
          const ci2 = data.cardIndex2 !== undefined ? data.cardIndex2 : null;
          result = game.declare(data.cardIndex, ci2);
          break;
        }

        default:
          room.actionLock = false;
          return socket.emit('error', { msg: `Unknown action type: ${type}` });
      }

      // Check if round ended after this action
      if (game.phase === Phase.ENDED) {
        room.actionLock = false;
        handleRoundEnd(room);
        return;
      }

      room.actionLock = false;
      broadcastRoomUpdate(room);
    } catch (err) {
      room.actionLock = false;
      socket.emit('error', { msg: err.message });
    }
  });

  // ── next-round ────────────────────────────────────────────────────────────────
  socket.on('next-round', () => {
    const room = getPlayerRoom(socket);
    if (!room) return socket.emit('error', { msg: 'Not in a room' });
    if (socket.id !== room.hostId) return socket.emit('error', { msg: 'Only host can start next round' });
    if (room.phase !== 'between-rounds') return socket.emit('error', { msg: 'Not between rounds' });

    room.game.newRound();
    room.phase = 'playing';
    broadcastRoomUpdate(room);
  });

  // ── end-session ───────────────────────────────────────────────────────────────
  socket.on('end-session', () => {
    const room = getPlayerRoom(socket);
    if (!room) return socket.emit('error', { msg: 'Not in a room' });
    if (socket.id !== room.hostId) return socket.emit('error', { msg: 'Only host can end session' });

    room.phase = 'ended';
    io.to(room.code).emit('session-ended', { players: room.players });
    rooms.delete(room.code);
  });

  // ── announce-thankas ──────────────────────────────────────────────────────────
  socket.on('announce-thankas', () => {
    const room = getPlayerRoom(socket);
    if (!room || room.phase !== 'playing') return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    // Validate: player must actually have a thankas in their current hand
    const game = room.game;
    const hand = game.hands[player.seatIndex];
    if (!_hasThankas(hand, game.jokerCard)) {
      socket.emit('lora-mera');
      return;
    }

    io.to(room.code).emit('thankas-announce', {
      nickname: player.nickname,
      color:    player.color,
    });
  });

  // ── chat-message ─────────────────────────────────────────────────────────────
  socket.on('chat-message', ({ text }) => {
    const room = getPlayerRoom(socket);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    const clean = String(text || '').trim().slice(0, 200);
    if (!clean) return;
    io.to(room.code).emit('chat-msg', {
      nickname: player.nickname,
      color:    player.color,
      text:     clean,
    });
  });

  // ── disconnect ────────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.connected = false;
      broadcastRoomUpdate(room);
    }
  });
});

// ── Round-end handling ────────────────────────────────────────────────────────

function handleRoundEnd(room) {
  const game = room.game;
  let scoring, outcome;

  if (game.forfeiter !== null) {
    outcome = 'forfeit';
    scoring = calcForfeitResult(game);
    room.players[game.forfeiter].stats.forfeits++;
  } else if (game.invalidWinClaimer !== null) {
    outcome = 'invalid';
    scoring = calcInvalidWinResult(game);
    room.players[game.invalidWinClaimer].stats.invalidWins++;
  } else {
    outcome = 'win';
    scoring = calcRoundResult(game);
    room.players[game.winner].stats.wins++;
  }

  // Update round stats and thank-you stats (collected during actions)
  for (const player of room.players) {
    if (!game.packed[player.seatIndex]) {
      player.stats.rounds++;
    } else {
      player.stats.packs++;
    }
  }

  // Apply net payments to chip balances
  for (const payment of scoring.netPayments) {
    room.players[payment.from].chips -= payment.amount;
    room.players[payment.to].chips   += payment.amount;
  }

  room.phase = 'between-rounds';

  const info = roomInfo(room);
  scoring.isDoubleGame = isDoubleGame(game.jokerCard);
  io.to(room.code).emit('round-ended', { roomInfo: info, scoring, outcome });
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function getPlayerRoom(socket) {
  const code = socket.data.roomCode;
  return code ? rooms.get(code) : null;
}

// True if the hand contains any thankas group (3+ of a matching type)
function _hasThankas(hand, jokerCard) {
  // Silver thankas (3+ Silver cards — same rank+suit as jokerCard, excluding it)
  if (hand.filter(c => c.isJoker(jokerCard) && c !== jokerCard).length >= 3) return true;
  // Poker thankas (3+ Poker cards)
  if (hand.filter(c => c.isSilver(jokerCard)).length >= 3) return true;
  // Joker wildcard thankas (3+ Joker wildcards)
  if (hand.filter(c => c.isPoker(jokerCard)).length >= 3) return true;
  // Normal thankas (3+ same rank + same suit)
  const grp = new Map();
  for (const c of hand) {
    if (c.isJoker(jokerCard) || c.isSilver(jokerCard) || c.isPoker(jokerCard)) continue;
    const k = c.rank + '|' + c.suit;
    grp.set(k, (grp.get(k) || 0) + 1);
    if (grp.get(k) >= 3) return true;
  }
  return false;
}

// ── Start server ──────────────────────────────────────────────────────────────

http.listen(PORT, () => {
  console.log(`Kantoori server running at http://localhost:${PORT}`);
});
