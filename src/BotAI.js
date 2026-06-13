'use strict';

// Card counts in the full deck
const TOTAL = { 1: 5, 2: 2, 3: 2, 4: 2, 5: 2, 6: 1, 7: 1, 8: 1 };

// Returns { cardValue, targetPlayerId?, guessedValue? }
function decide(botId, game) {
  const state   = game.playerStates[botId];
  const hand    = state.hand;
  const players = game.players;
  const ps      = game.playerStates;

  // All other active players
  const others      = players.filter(p => p.id !== botId && !ps[p.id].eliminated);
  // Those not shielded by Handmaid
  const exposed     = others.filter(p => !ps[p.id].protected);
  // Player with most tokens (biggest threat)
  const topThreat   = exposed.length
    ? exposed.reduce((a, b) => game.tokens[a.id] >= game.tokens[b.id] ? a : b)
    : (others[0] || null);

  // Must play Countess if holding King or Prince
  if (hand.some(c => c.value === 7) && hand.some(c => c.value === 5 || c.value === 6)) {
    return { cardValue: 7 };
  }

  // Never voluntarily play Princess — always play the other card
  const playable = hand.some(c => c.value === 8) && hand.length === 2
    ? hand.filter(c => c.value !== 8)
    : [...hand];

  // What cards are still unknown (not in bot's hand, not in any discard pile, not in revealed)
  const seen = { ...TOTAL };
  hand.forEach(c => seen[c.value]--);
  players.forEach(p => ps[p.id].discardPile.forEach(c => seen[c.value]--));
  if (game.revealedCards) game.revealedCards.forEach(c => seen[c.value]--);
  // seen[v] now = count of card v still hidden from the bot

  // Best value to guess for a Guard: highest remaining count excluding bot's own cards
  function bestGuess() {
    const mine = new Set(hand.map(c => c.value));
    let best = 2, bestCnt = -1;
    for (let v = 2; v <= 8; v++) {
      if (mine.has(v)) continue;
      if (seen[v] > bestCnt) { bestCnt = seen[v]; best = v; }
    }
    return best;
  }

  // Pick best exposed target, fallback to any active player (Handmaid effect kicks in)
  function target(allowSelf = false) {
    if (exposed.length > 0) return topThreat?.id ?? exposed[0].id;
    if (allowSelf) return botId; // Prince can always self-target
    return others[0]?.id ?? null; // protected player — effect is nullified but move is legal
  }

  // Score each card in hand and pick the best play
  // Higher score = prefer to play this card
  let best = null, bestScore = -Infinity;

  for (const card of playable) {
    let score = 0;
    let move  = null;

    switch (card.value) {
      case 1: { // Guard — only worth playing if there's a reasonable guess
        const t = target();
        if (!t) break;
        const guess = bestGuess();
        // Score: how many of that card are left × 10 - penalty if no exposed target
        score = (seen[guess] * 10) + (exposed.length > 0 ? 5 : 0) - 2;
        move = { cardValue: 1, targetPlayerId: t, guessedValue: guess };
        break;
      }
      case 2: { // Priest — moderate info value
        const t = target();
        if (!t) break;
        score = 3;
        move = { cardValue: 2, targetPlayerId: t };
        break;
      }
      case 3: { // Baron — good if our remaining card is high
        const t = target();
        if (!t) break;
        const otherCard = hand.find(c => c.value !== 3);
        // Worth using if our non-Baron card beats average (~4)
        score = otherCard ? (otherCard.value - 4) * 3 : 0;
        move = { cardValue: 3, targetPlayerId: t };
        break;
      }
      case 4: { // Handmaid — great if holding Princess or high card
        const highCard = hand.find(c => c.value >= 6 && c.value !== 4);
        score = highCard ? highCard.value * 2 : 4;
        move = { cardValue: 4 };
        break;
      }
      case 5: { // Prince — force a redraw on biggest threat, or self if hand is weak
        const myOther = hand.find(c => c.value !== 5);
        if (exposed.length > 0) {
          score = 8; // good aggressive play
          move = { cardValue: 5, targetPlayerId: topThreat?.id ?? exposed[0].id };
        } else if (myOther && myOther.value <= 3) {
          score = 5; // self-target to get a better card
          move = { cardValue: 5, targetPlayerId: botId };
        } else {
          score = 2;
          move = { cardValue: 5, targetPlayerId: others[0]?.id ?? botId };
        }
        break;
      }
      case 6: { // King — only swap if our non-King card is bad
        const t = target();
        if (!t) break;
        const myOther = hand.find(c => c.value !== 6);
        score = myOther ? (4 - myOther.value) * 2 : 0; // positive only if card < 4
        move = { cardValue: 6, targetPlayerId: t };
        break;
      }
      case 7: { // Countess — filler, neutral
        score = 1;
        move = { cardValue: 7 };
        break;
      }
      case 8: // Princess — should not reach here
        break;
    }

    if (move && score > bestScore) {
      bestScore = score;
      best = move;
    }
  }

  // Absolute fallback — play first playable card with minimal targeting
  if (!best) {
    const card = playable[0];
    const needsTarget = [1, 2, 3, 5, 6].includes(card.value);
    best = {
      cardValue: card.value,
      ...(needsTarget ? { targetPlayerId: target(card.value === 5) ?? botId } : {}),
      ...(card.value === 1 ? { guessedValue: bestGuess() } : {}),
    };
  }

  return best;
}

module.exports = { decide };
