'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { GameState } = require('./src/GameState');
const { decide } = require('./src/BotAI');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// rooms: { [roomCode]: { players: [{id, name, socketId, isBot}], game, hostPlayerId, started } }
const rooms = {};

const BOT_NAMES = ['Alice', 'Bob', 'Charlie', 'Diana', 'Erik', 'Fiona'];

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms[code]);
  return code;
}

function genId() {
  return Math.random().toString(36).slice(2, 11);
}

function broadcastRoom(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  io.to(roomCode).emit('room_update', {
    roomCode,
    players: room.players.map(p => ({ id: p.id, name: p.name, isBot: !!p.isBot })),
    hostId: room.hostPlayerId,
    started: room.started,
  });
}

function broadcastGame(roomCode) {
  const room = rooms[roomCode];
  if (!room || !room.game) return;
  room.players.forEach(p => {
    if (!p.socketId) return; // skip bots
    const state = room.game.getStateFor(p.id);
    // Tag which players are bots so the client can show the icon
    state.players = state.players.map(sp => ({
      ...sp,
      isBot: !!(room.players.find(rp => rp.id === sp.id)?.isBot),
    }));
    io.to(p.socketId).emit('game_state', state);
  });
}

// After every game update: broadcast then schedule a bot move if needed
function postGameUpdate(roomCode) {
  broadcastGame(roomCode);
  scheduleBotTurn(roomCode);
}

function scheduleBotTurn(roomCode) {
  const room = rooms[roomCode];
  if (!room?.game) return;
  if (room.waitingForPriestAck) return; // human is reading a priest reveal

  const game = room.game;
  if (game.phase !== 'playing') return;

  const current = game.players[game.currentPlayerIndex];
  const entry   = room.players.find(p => p.id === current.id);
  if (!entry?.isBot) return;

  // If all human players are eliminated, resolve the round quickly
  const humansOut = room.players
    .filter(p => !p.isBot)
    .every(p => game.playerStates[p.id]?.eliminated);
  const delay = humansOut ? 400 : (2000 + Math.random() * 1000);
  setTimeout(() => executeBotTurn(roomCode, current.id), delay);
}

function executeBotTurn(roomCode, botId) {
  const room = rooms[roomCode];
  if (!room?.game) return;
  const game = room.game;
  if (game.phase !== 'playing') return;

  // Make sure it's still this bot's turn (state may have changed)
  if (game.players[game.currentPlayerIndex].id !== botId) return;

  let move;
  try {
    move = decide(botId, game);
  } catch (e) {
    console.error(`Bot decision error: ${e.message}`);
    // Fallback: play first card with no target
    const hand = game.playerStates[botId].hand;
    move = { cardValue: hand[0]?.value ?? 7 };
  }

  const result = game.playCard(botId, move.cardValue, move.targetPlayerId, move.guessedValue);

  if (result.error) {
    // Bot made an invalid move — try to play the other card, or any card
    console.error(`Bot play error: ${result.error} — falling back`);
    const hand = game.playerStates[botId].hand;
    if (hand.length > 0) {
      const fallback = hand[0];
      const others = game.players.filter(p => p.id !== botId && !game.playerStates[p.id].eliminated);
      const t = others[0]?.id;
      game.playCard(botId, fallback.value, t, fallback.value === 1 ? 2 : undefined);
    }
  }

  // Priest reveal goes to a bot — just log it (bots don't use the info yet)
  postGameUpdate(roomCode);
}

io.on('connection', (socket) => {
  console.log(`connect  ${socket.id}`);

  socket.on('create_room', ({ playerName }, cb) => {
    if (!playerName?.trim()) return cb({ error: 'Name required.' });
    const roomCode = genCode();
    const playerId = genId();
    rooms[roomCode] = {
      players: [{ id: playerId, name: playerName.trim(), socketId: socket.id }],
      game: null,
      hostPlayerId: playerId,
      started: false,
    };
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.playerId = playerId;
    console.log(`room ${roomCode} created by ${playerName}`);
    cb({ success: true, roomCode, playerId });
    broadcastRoom(roomCode);
  });

  socket.on('join_room', ({ roomCode, playerName }, cb) => {
    const code = roomCode?.trim().toUpperCase();
    const room = rooms[code];
    if (!room) return cb({ error: 'Room not found.' });
    if (room.started) return cb({ error: 'Game already in progress.' });
    if (room.players.length >= 6) return cb({ error: 'Room is full (max 6 players).' });
    if (!playerName?.trim()) return cb({ error: 'Name required.' });

    const playerId = genId();
    room.players.push({ id: playerId, name: playerName.trim(), socketId: socket.id });
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = playerId;
    console.log(`${playerName} joined room ${code}`);
    cb({ success: true, roomCode: code, playerId });
    broadcastRoom(code);
  });

  socket.on('add_bot', (_, cb) => {
    const { roomCode, playerId } = socket.data;
    const room = rooms[roomCode];
    if (!room) return cb?.({ error: 'Room not found.' });
    if (room.hostPlayerId !== playerId) return cb?.({ error: 'Only the host can add bots.' });
    if (room.started) return cb?.({ error: 'Cannot add bots after game has started.' });
    if (room.players.length >= 6) return cb?.({ error: 'Room is full.' });

    // Pick a bot name not already in use
    const usedNames = new Set(room.players.map(p => p.name));
    const botName = BOT_NAMES.find(n => !usedNames.has(`Bot ${n}`)) ?? `Bot ${room.players.length}`;
    const botId = genId();
    room.players.push({ id: botId, name: `Bot ${botName}`, socketId: null, isBot: true });

    console.log(`bot "Bot ${botName}" added to room ${roomCode}`);
    cb?.({ success: true });
    broadcastRoom(roomCode);
  });

  socket.on('remove_bot', (_, cb) => {
    const { roomCode, playerId } = socket.data;
    const room = rooms[roomCode];
    if (!room) return cb?.({ error: 'Room not found.' });
    if (room.hostPlayerId !== playerId) return cb?.({ error: 'Only the host can remove bots.' });
    if (room.started) return cb?.({ error: 'Cannot remove bots after game has started.' });

    const botIndex = room.players.slice().reverse().findIndex(p => p.isBot);
    if (botIndex === -1) return cb?.({ error: 'No bots to remove.' });
    // Remove the last bot (reversed index → real index)
    room.players.splice(room.players.length - 1 - botIndex, 1);

    cb?.({ success: true });
    broadcastRoom(roomCode);
  });

  socket.on('start_game', (_, cb) => {
    const { roomCode, playerId } = socket.data;
    const room = rooms[roomCode];
    if (!room) return cb?.({ error: 'Room not found.' });
    if (room.hostPlayerId !== playerId) return cb?.({ error: 'Only the host can start the game.' });
    if (room.players.length < 2) return cb?.({ error: 'Need at least 2 players to start.' });
    if (room.started) return cb?.({ error: 'Game already started.' });

    room.started = true;
    room.game = new GameState(room.players.map(p => ({ id: p.id, name: p.name })));
    console.log(`game started in room ${roomCode}`);
    cb?.({ success: true });
    postGameUpdate(roomCode);
  });

  socket.on('play_card', ({ cardValue, targetPlayerId, guessedValue }, cb) => {
    const { roomCode, playerId } = socket.data;
    const room = rooms[roomCode];
    if (!room?.game) return cb?.({ error: 'No game in progress.' });

    const result = room.game.playCard(playerId, cardValue, targetPlayerId, guessedValue);
    if (result.error) return cb?.({ error: result.error });

    cb?.({ success: true });

    if (result.priestReveal) {
      const { viewerId, targetId, card } = result.priestReveal;
      const viewer = room.players.find(p => p.id === viewerId);
      if (viewer?.socketId) {
        // Human is reading the reveal — pause bots until they acknowledge
        room.waitingForPriestAck = true;
        io.to(viewer.socketId).emit('priest_reveal', {
          targetId,
          targetName: room.players.find(p => p.id === targetId)?.name,
          card,
        });
      }
    }

    postGameUpdate(roomCode);
  });

  socket.on('next_round', (_, cb) => {
    const { roomCode, playerId } = socket.data;
    const room = rooms[roomCode];
    if (!room?.game) return cb?.({ error: 'No game in progress.' });
    if (room.hostPlayerId !== playerId) return cb?.({ error: 'Only the host can advance to the next round.' });

    const result = room.game.startNextRound();
    if (result.error) return cb?.({ error: result.error });

    cb?.({ success: true });
    postGameUpdate(roomCode);
  });

  socket.on('new_game', (_, cb) => {
    const { roomCode, playerId } = socket.data;
    const room = rooms[roomCode];
    if (!room) return cb?.({ error: 'Room not found.' });
    if (room.hostPlayerId !== playerId) return cb?.({ error: 'Only the host can start a new game.' });

    room.game = new GameState(room.players.map(p => ({ id: p.id, name: p.name })));
    cb?.({ success: true });
    postGameUpdate(roomCode);
  });

  socket.on('priest_ack', (_, cb) => {
    const { roomCode } = socket.data;
    const room = rooms[roomCode];
    if (!room) return;
    room.waitingForPriestAck = false;
    cb?.({ success: true });
    scheduleBotTurn(roomCode); // resume now that human has read the reveal
  });

  socket.on('disconnect', () => {
    console.log(`disconnect ${socket.id}`);
    const { roomCode } = socket.data;
    if (roomCode && rooms[roomCode]) {
      const room = rooms[roomCode];
      const player = room.players.find(p => p.socketId === socket.id);
      if (player) {
        io.to(roomCode).emit('player_disconnected', { playerId: player.id, playerName: player.name });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Love Letter server running at http://localhost:${PORT}`));
