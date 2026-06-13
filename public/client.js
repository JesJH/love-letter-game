'use strict';

/* ============================================================
   Card metadata
   ============================================================ */
const CARDS = {
  1: { name: 'Guard',    symbol: '⚔',  count: 5, desc: 'Name a non-Guard card. If the target holds it, they are eliminated.' },
  2: { name: 'Priest',   symbol: '📜', count: 2, desc: 'Look at another player\'s hand.' },
  3: { name: 'Baron',    symbol: '⚖',  count: 2, desc: 'Compare hands with another player. The lower card is eliminated. Ties are safe.' },
  4: { name: 'Handmaid', symbol: '🛡', count: 2, desc: 'You are protected from all card effects until your next turn.' },
  5: { name: 'Prince',   symbol: '♞',  count: 2, desc: 'Choose any player (including yourself) to discard their hand and draw a new card.' },
  6: { name: 'King',     symbol: '♛',  count: 1, desc: 'Trade hands with another player.' },
  7: { name: 'Countess', symbol: '💎', count: 1, desc: 'Must be played if you also hold the King or Prince.' },
  8: { name: 'Princess', symbol: '❤', count: 1, desc: 'If you discard this card for any reason, you are immediately eliminated.' },
};

const NEEDS_TARGET   = new Set([1, 2, 3, 6]);      // requires another player
const PRINCE_TARGETS = new Set([5]);                 // can target self or others
const NEEDS_GUESS    = new Set([1]);                 // guard guess

/* ============================================================
   State
   ============================================================ */
const socket = io();

let myPlayerId       = null;
let myRoomCode       = null;
let isHost           = false;
let gameState        = null;
let selectedCardValue = null;
let lastLogEntry     = '';
let toastTimer       = null;

/* ============================================================
   View management
   ============================================================ */
function showView(name) {
  document.querySelectorAll('.view').forEach(v => {
    v.classList.remove('active');
    v.classList.add('hidden');
  });
  const el = document.getElementById(`view-${name}`);
  el.classList.remove('hidden');
  el.classList.add('active');
}

/* ============================================================
   Landing
   ============================================================ */
document.getElementById('btn-create').addEventListener('click', () => {
  const name = document.getElementById('inp-name').value.trim();
  if (!name) return showLandingError('Please enter your name.');
  socket.emit('create_room', { playerName: name }, (res) => {
    if (res.error) return showLandingError(res.error);
    myPlayerId = res.playerId;
    myRoomCode = res.roomCode;
    isHost = true;
    showView('lobby');
    document.getElementById('lbl-room-code').textContent = res.roomCode;
  });
});

document.getElementById('btn-join').addEventListener('click', doJoin);
document.getElementById('inp-code').addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });
document.getElementById('inp-name').addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });

function doJoin() {
  const name = document.getElementById('inp-name').value.trim();
  const code = document.getElementById('inp-code').value.trim().toUpperCase();
  if (!name) return showLandingError('Please enter your name.');
  if (!code) return showLandingError('Please enter a room code.');
  socket.emit('join_room', { playerName: name, roomCode: code }, (res) => {
    if (res.error) return showLandingError(res.error);
    myPlayerId = res.playerId;
    myRoomCode = res.roomCode;
    isHost = false;
    showView('lobby');
    document.getElementById('lbl-room-code').textContent = res.roomCode;
  });
}

function showLandingError(msg) {
  const el = document.getElementById('landing-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

document.getElementById('btn-copy').addEventListener('click', () => {
  navigator.clipboard.writeText(document.getElementById('lbl-room-code').textContent).catch(() => {});
  document.getElementById('btn-copy').textContent = 'Copied!';
  setTimeout(() => { document.getElementById('btn-copy').textContent = 'Copy'; }, 1500);
});

/* ============================================================
   Lobby
   ============================================================ */
socket.on('room_update', (data) => {
  if (document.getElementById('view-lobby').classList.contains('active')) {
    renderLobbyPlayers(data.players, data.hostId);
    isHost = data.hostId === myPlayerId;

    const hostControls = document.getElementById('host-controls');
    const waitLbl      = document.getElementById('lbl-wait');
    const startBtn     = document.getElementById('btn-start');
    const addBotBtn    = document.getElementById('btn-add-bot');
    const rmBotBtn     = document.getElementById('btn-remove-bot');

    if (isHost) {
      hostControls.classList.remove('hidden');
      waitLbl.classList.add('hidden');
      startBtn.disabled = data.players.length < 2;
      startBtn.title    = data.players.length < 2 ? 'Need at least 2 players' : '';
      addBotBtn.disabled = data.players.length >= 6;
      rmBotBtn.disabled  = !data.players.some(p => p.isBot);
    } else {
      hostControls.classList.add('hidden');
      waitLbl.classList.remove('hidden');
    }
  }
});

function renderLobbyPlayers(players, hostId) {
  const list = document.getElementById('lobby-player-list');
  list.innerHTML = players.map(p => `
    <div class="lobby-player-item">
      ${p.id === hostId ? '<span class="crown" title="Host">♛</span>' : '<span style="width:1rem;display:inline-block"></span>'}
      ${p.isBot ? '<span class="bot-icon" title="Computer">🤖</span>' : ''}
      ${escHtml(p.name)}
      ${p.id === myPlayerId ? '<span style="color:var(--muted);font-size:0.75rem">(you)</span>' : ''}
    </div>
  `).join('');
}

document.getElementById('btn-add-bot').addEventListener('click', () => {
  socket.emit('add_bot', {}, (res) => {
    if (res?.error) {
      document.getElementById('lobby-error').textContent = res.error;
      document.getElementById('lobby-error').classList.remove('hidden');
    }
  });
});

document.getElementById('btn-remove-bot').addEventListener('click', () => {
  socket.emit('remove_bot', {}, (res) => {
    if (res?.error) {
      document.getElementById('lobby-error').textContent = res.error;
      document.getElementById('lobby-error').classList.remove('hidden');
    }
  });
});

document.getElementById('btn-start').addEventListener('click', () => {
  socket.emit('start_game', {}, (res) => {
    if (res?.error) {
      document.getElementById('lobby-error').textContent = res.error;
      document.getElementById('lobby-error').classList.remove('hidden');
    }
  });
});

/* ============================================================
   Game state updates
   ============================================================ */
socket.on('game_state', (state) => {
  gameState = state;

  if (!document.getElementById('view-game').classList.contains('active')) {
    showView('game');
    renderRefPanel();
    document.getElementById('ref-toggle').classList.remove('hidden');
  }

  renderGame(state);
});

function renderGame(state) {
  // Header
  document.getElementById('hdr-round').textContent = `Round ${state.round}`;
  document.getElementById('hdr-deck').textContent = `Deck: ${state.deckSize}${state.setAsideExists ? '+1' : ''}`;

  const me = state.players.find(p => p.id === myPlayerId);
  const isMyTurn = state.currentPlayerId === myPlayerId && state.phase === 'playing';
  const iEliminated = me?.eliminated ?? false;

  if (state.phase === 'playing') {
    const curr = state.players.find(p => p.id === state.currentPlayerId);
    document.getElementById('hdr-status').textContent = isMyTurn ? 'YOUR TURN' : `${curr?.name ?? ''}'s turn`;
  } else {
    document.getElementById('hdr-status').textContent = '';
  }

  // Restart button: host only, once game is underway
  const gameActive = ['playing', 'round_end', 'game_end'].includes(state.phase);
  document.getElementById('btn-restart').classList.toggle('hidden', !isHost || !gameActive);

  // Opponents
  const opponents = state.players.filter(p => p.id !== myPlayerId);
  document.getElementById('opponents-area').innerHTML = opponents.map(p => renderOpponentPanel(p, state)).join('');

  // Revealed cards (2-player)
  const revealedArea = document.getElementById('revealed-area');
  if (state.revealedCards && state.revealedCards.length > 0) {
    revealedArea.classList.remove('hidden');
    document.getElementById('revealed-cards').innerHTML = state.revealedCards.map(c => renderCardSm(c)).join('');
  } else {
    revealedArea.classList.add('hidden');
  }

  // My info
  if (me) {
    const parts = [];
    if (me.protected) parts.push('<span class="badge-protected">🛡 Protected</span>');
    if (me.eliminated) parts.push('<span class="badge-eliminated">Eliminated</span>');
    parts.push(`<span style="color:var(--gold)">♥ ${me.tokens} / ${state.tokensNeeded}</span>`);
    document.getElementById('my-info').innerHTML = parts.join(' ');
  }

  // My hand
  renderMyHand(state, me, isMyTurn);

  // Status banner
  const banner = document.getElementById('status-banner');
  if (iEliminated && state.phase === 'playing') {
    banner.innerHTML = '<span style="color:#e06060">You have been eliminated — resolving round…</span>';
  } else if (state.phase === 'playing' && !isMyTurn) {
    const curr = state.players.find(p => p.id === state.currentPlayerId);
    banner.textContent = `Waiting for ${curr?.name ?? ''}…`;
  } else if (state.phase === 'playing' && isMyTurn) {
    banner.textContent = 'Choose a card to play.';
  } else {
    banner.textContent = '';
  }

  // Game log + action toast for new entries
  renderLog(state.gameLog);
  const latestEntry = state.gameLog[state.gameLog.length - 1] || '';
  if (latestEntry.startsWith('---')) {
    // New round started — reset toast tracker
    lastLogEntry = latestEntry;
  } else if (latestEntry && latestEntry !== lastLogEntry) {
    lastLogEntry = latestEntry;
    showActionToast(latestEntry);
  }

  // Overlay
  renderOverlay(state);

  // Hide action panel if it's not my turn
  if (!isMyTurn || state.phase !== 'playing') {
    closeActionPanel();
    selectedCardValue = null;
  }
}

function renderOpponentPanel(p, state) {
  const isCurrent = p.id === state.currentPlayerId;
  let classes = 'opponent-panel';
  if (isCurrent) classes += ' is-current';
  if (p.eliminated) classes += ' is-eliminated';

  const badges = [];
  if (isCurrent && state.phase === 'playing') badges.push('<span class="badge-current">▶ Turn</span>');
  if (p.protected) badges.push('<span class="badge-protected">🛡 Protected</span>');
  if (p.eliminated) badges.push('<span class="badge-eliminated">Out</span>');

  const botBadge = p.isBot ? ' 🤖' : '';

  const handDisplay = p.eliminated
    ? ''
    : Array.from({ length: p.handSize }, () => `<div class="card-back-sm">❤</div>`).join('');

  const discardDisplay = p.discardPile.map(c => renderCardSm(c)).join('');

  return `
    <div class="${classes}">
      <div class="op-name">${escHtml(p.name)}${botBadge} ${badges.join(' ')}</div>
      <div class="op-tokens">♥ ${p.tokens} token${p.tokens !== 1 ? 's' : ''}</div>
      <div style="display:flex;gap:4px;align-items:center;margin-bottom:4px">${handDisplay}</div>
      <div class="op-discard">${discardDisplay}</div>
    </div>
  `;
}

function renderMyHand(state, me, isMyTurn) {
  const handEl = document.getElementById('my-hand');
  if (!me || me.eliminated || !me.hand) {
    handEl.innerHTML = '<span style="color:var(--muted);font-size:0.85rem">You have been eliminated this round.</span>';
    return;
  }

  const hand = me.hand;
  const mustPlayCountess = hand.some(c => c.value === 7) && hand.some(c => c.value === 5 || c.value === 6);

  handEl.innerHTML = hand.map(card => {
    const info = CARDS[card.value];
    let classes = 'card';
    const isDisabled = !isMyTurn || (mustPlayCountess && card.value !== 7);
    if (isMyTurn && !isDisabled) classes += ' playable';
    if (isDisabled && isMyTurn) classes += ' disabled-card';
    if (selectedCardValue === card.value) classes += ' selected';

    return `
      <div class="${classes}" data-value="${card.value}" title="${info.desc}" ${isDisabled ? '' : `onclick="selectCard(${card.value})"`}>
        <span class="card-value cv${card.value}">${card.value}</span>
        <span class="card-symbol">${info.symbol}</span>
        <span class="card-name">${info.name}</span>
      </div>
    `;
  }).join('');
}

/* ============================================================
   Card selection & action panel
   ============================================================ */
function selectCard(value) {
  if (!gameState || gameState.phase !== 'playing' || gameState.currentPlayerId !== myPlayerId) return;
  selectedCardValue = value;

  // Re-render hand to show selection
  const me = gameState.players.find(p => p.id === myPlayerId);
  renderMyHand(gameState, me, true);

  openActionPanel(value);
}
window.selectCard = selectCard; // expose to inline onclick

function openActionPanel(value) {
  const info = CARDS[value];
  const panel = document.getElementById('action-panel');

  // Preview
  document.getElementById('ap-card-preview').innerHTML = `
    <div class="card" style="flex-shrink:0;cursor:default">
      <span class="card-value cv${value}">${value}</span>
      <span class="card-symbol" style="font-size:2rem">${info.symbol}</span>
      <span class="card-name">${info.name}</span>
    </div>
    <div>
      <div class="ap-card-name">${value} — ${info.name}</div>
      <div class="ap-card-desc">${info.desc}</div>
    </div>
  `;

  // Controls
  const controls = document.getElementById('ap-controls');
  controls.innerHTML = '';

  // Target selector
  if (NEEDS_TARGET.has(value) || PRINCE_TARGETS.has(value)) {
    const others = gameState.players.filter(p => p.id !== myPlayerId && !p.eliminated);
    const includeSelf = PRINCE_TARGETS.has(value);
    const me = gameState.players.find(p => p.id === myPlayerId);

    let options = '';
    if (includeSelf) {
      options += `<option value="${myPlayerId}">Yourself (${escHtml(me.name)})</option>`;
    }
    others.forEach(p => {
      const note = p.protected ? ' 🛡 protected' : '';
      options += `<option value="${p.id}">${escHtml(p.name)}${note}</option>`;
    });

    if (!options) {
      options = '<option value="">No valid targets</option>';
    }

    controls.innerHTML += `
      <div>
        <label>Choose target:</label>
        <select id="sel-target">${options}</select>
      </div>
    `;
  }

  // Guard guess
  if (NEEDS_GUESS.has(value)) {
    const opts = [2,3,4,5,6,7,8].map(v => `<option value="${v}">${v} — ${CARDS[v].name}</option>`).join('');
    controls.innerHTML += `
      <div>
        <label>Guess their card (not Guard):</label>
        <select id="sel-guess">${opts}</select>
      </div>
    `;
  }

  // Special note for Countess/Handmaid/Princess/King — no target needed for some
  if (value === 7 || value === 4) {
    controls.innerHTML += `<p style="font-size:0.8rem;color:var(--muted)">No target needed.</p>`;
  }
  if (value === 8) {
    controls.innerHTML += `<p style="font-size:0.8rem;color:#e06060">Warning: playing the Princess eliminates you!</p>`;
  }

  panel.classList.remove('hidden');
  document.getElementById('status-banner').textContent = '';
}

function closeActionPanel() {
  document.getElementById('action-panel').classList.add('hidden');
}

document.getElementById('btn-cancel').addEventListener('click', () => {
  selectedCardValue = null;
  closeActionPanel();
  // Re-render hand without selection
  if (gameState) {
    const me = gameState.players.find(p => p.id === myPlayerId);
    renderMyHand(gameState, me, gameState.currentPlayerId === myPlayerId);
    document.getElementById('status-banner').textContent = 'Choose a card to play.';
  }
});

document.getElementById('btn-play-card').addEventListener('click', () => {
  if (selectedCardValue === null) return;

  const cardValue = selectedCardValue;
  const targetEl  = document.getElementById('sel-target');
  const guessEl   = document.getElementById('sel-guess');

  const targetPlayerId = targetEl ? targetEl.value || null : null;
  const guessedValue   = guessEl  ? parseInt(guessEl.value) : null;

  // Client-side validation
  if ((NEEDS_TARGET.has(cardValue) || PRINCE_TARGETS.has(cardValue)) && !targetPlayerId) {
    alert('Please choose a target.');
    return;
  }

  socket.emit('play_card', { cardValue, targetPlayerId, guessedValue }, (res) => {
    if (res?.error) {
      showPlayError(res.error);
    } else {
      selectedCardValue = null;
      closeActionPanel();
    }
  });
});

function showPlayError(msg) {
  const banner = document.getElementById('status-banner');
  banner.innerHTML = `<span style="color:#e74c3c">${escHtml(msg)}</span>`;
}

/* ============================================================
   Priest reveal modal
   ============================================================ */
socket.on('priest_reveal', ({ targetName, card }) => {
  const info = CARDS[card.value];
  document.getElementById('priest-text').textContent = `${targetName} is holding:`;
  document.getElementById('priest-card-display').innerHTML = `
    <div class="card" style="cursor:default">
      <span class="card-value cv${card.value}">${card.value}</span>
      <span class="card-symbol" style="font-size:2rem">${info.symbol}</span>
      <span class="card-name">${info.name}</span>
    </div>
  `;
  document.getElementById('priest-modal').classList.remove('hidden');
});

document.getElementById('btn-priest-ok').addEventListener('click', () => {
  document.getElementById('priest-modal').classList.add('hidden');
  socket.emit('priest_ack'); // let server resume bot turns
});

/* ============================================================
   Overlay (round / game end)
   ============================================================ */
function renderOverlay(state) {
  const overlay = document.getElementById('overlay');

  if (state.phase !== 'round_end' && state.phase !== 'game_end') {
    overlay.classList.add('hidden');
    return;
  }

  overlay.classList.remove('hidden');

  const title   = document.getElementById('ov-title');
  const body    = document.getElementById('ov-body');
  const scores  = document.getElementById('ov-scores');
  const nextBtn = document.getElementById('btn-next-round');
  const newBtn  = document.getElementById('btn-new-game');
  const waitLbl = document.getElementById('lbl-ov-wait');

  if (state.phase === 'game_end') {
    const winner = state.players.find(p => p.id === state.gameWinner);
    title.textContent = `${winner?.name ?? 'Someone'} wins the game!`;
    body.textContent  = 'Their letters of love have reached the Princess!';
    nextBtn.classList.add('hidden');
    if (isHost) {
      newBtn.classList.remove('hidden');
      waitLbl.classList.add('hidden');
    } else {
      newBtn.classList.add('hidden');
      waitLbl.classList.remove('hidden');
    }
  } else {
    const winners = (state.roundWinner || []).map(id => state.players.find(p => p.id === id)?.name).join(' & ');
    title.textContent = `Round ${state.round} over!`;
    body.textContent  = `${winners} wins the round.`;
    newBtn.classList.add('hidden');
    if (isHost) {
      nextBtn.classList.remove('hidden');
      waitLbl.classList.add('hidden');
    } else {
      nextBtn.classList.add('hidden');
      waitLbl.classList.remove('hidden');
    }
  }

  // Scores table
  const sorted = [...state.players].sort((a, b) => b.tokens - a.tokens);
  scores.innerHTML = sorted.map(p => `
    <div class="ov-score-row">
      <span class="${p.tokens >= state.tokensNeeded ? 'score-winner' : ''}">${escHtml(p.name)}</span>
      <span class="${p.tokens >= state.tokensNeeded ? 'score-winner' : ''}">♥ ${p.tokens} / ${state.tokensNeeded}</span>
    </div>
  `).join('');
}

document.getElementById('btn-restart').addEventListener('click', () => {
  if (!confirm('Restart the game? All tokens will be reset.')) return;
  socket.emit('new_game', {}, (res) => {
    if (res?.error) alert(res.error);
  });
});

document.getElementById('btn-leave').addEventListener('click', () => {
  location.reload();
});

document.getElementById('btn-next-round').addEventListener('click', () => {
  socket.emit('next_round', {}, (res) => {
    if (res?.error) alert(res.error);
  });
});

document.getElementById('btn-new-game').addEventListener('click', () => {
  socket.emit('new_game', {}, (res) => {
    if (res?.error) alert(res.error);
  });
});

/* ============================================================
   Card hover tooltip
   ============================================================ */
function showCardTooltip(value, cardEl) {
  const info = CARDS[value];
  if (!info) return;
  const tip = document.getElementById('card-tooltip');
  tip.innerHTML = `
    <div class="ct-header">
      <span class="ct-symbol">${info.symbol}</span>
      <span class="ct-name">${info.name}</span>
      <span class="ct-count">×${info.count} in deck</span>
    </div>
    <div class="ct-desc">${escHtml(info.desc)}</div>
  `;
  const rect = cardEl.getBoundingClientRect();
  tip.style.left = `${rect.left + rect.width / 2}px`;
  tip.style.top  = `${rect.top}px`;
  tip.classList.remove('hidden');
}

function hideCardTooltip() {
  document.getElementById('card-tooltip').classList.add('hidden');
}

// Wire up tooltip via event delegation once DOM is ready
document.getElementById('my-hand').addEventListener('mouseover', e => {
  const card = e.target.closest('.card[data-value]');
  if (card) showCardTooltip(parseInt(card.dataset.value), card);
});
document.getElementById('my-hand').addEventListener('mouseleave', hideCardTooltip);

/* ============================================================
   Card reference panel
   ============================================================ */
function renderRefPanel() {
  const rows = Object.entries(CARDS).map(([val, info]) => `
    <div class="ref-row">
      <span class="ref-val cv${val}">${val}</span>
      <div class="ref-info">
        <div class="ref-name">${info.symbol} ${info.name}</div>
        <div class="ref-desc">${escHtml(info.desc)}</div>
      </div>
      <span class="ref-count">×${info.count}</span>
    </div>
  `).join('');
  document.getElementById('ref-panel').innerHTML =
    `<div class="ref-title">Card Reference</div>${rows}`;
}

document.getElementById('ref-toggle').addEventListener('click', () => {
  const panel = document.getElementById('ref-panel');
  panel.classList.toggle('hidden');
});

/* ============================================================
   Action toast
   ============================================================ */
function showActionToast(text) {
  const el = document.getElementById('action-toast');

  // Try to identify which card was played so we can show the symbol
  let cardInfo = null;
  for (const [val, info] of Object.entries(CARDS)) {
    if (text.toLowerCase().includes(`played ${info.name.toLowerCase()}`)) {
      cardInfo = info;
      break;
    }
  }

  el.innerHTML = cardInfo
    ? `<span class="toast-card-symbol">${cardInfo.symbol}</span>
       <div class="toast-card-name">${cardInfo.name}</div>
       <div class="toast-message">${escHtml(text)}</div>`
    : `<div class="toast-message">${escHtml(text)}</div>`;

  el.classList.remove('fade-out');
  el.classList.add('visible');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => el.classList.remove('visible', 'fade-out'), 450);
  }, 2800);
}

/* ============================================================
   Game log
   ============================================================ */
function renderLog(entries) {
  // Only show the current round — find the last round-start marker
  let start = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].startsWith('---')) { start = i; break; }
  }
  const current = entries.slice(start);

  const el = document.getElementById('game-log');
  el.innerHTML = [...current].reverse().map(line => {
    let cls = 'log-entry';
    if (line.startsWith('---')) cls += ' log-round';
    else if (line.includes('eliminated')) cls += ' log-elim';
    else if (line.includes('wins')) cls += ' log-win';
    return `<div class="${cls}">${escHtml(line)}</div>`;
  }).join('');
}

/* ============================================================
   Disconnect
   ============================================================ */
socket.on('player_disconnected', ({ playerName }) => {
  // Show a subtle notice in the log rather than a blocking modal
  if (gameState) {
    gameState.gameLog.push(`[!] ${playerName} disconnected.`);
    renderLog(gameState.gameLog);
  }
});

socket.on('disconnect', () => {
  document.getElementById('disconnect-notice').classList.remove('hidden');
});

/* ============================================================
   Helpers
   ============================================================ */
function renderCardSm(c) {
  const info = CARDS[c.value] || {};
  return `<div class="card-sm" title="${info.name ?? ''}">
    <span class="csm-val cv${c.value}">${c.value}</span>
    <span class="csm-name">${escHtml(info.name ?? '')}</span>
  </div>`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
