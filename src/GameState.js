'use strict';

const CARD_NAMES = {
  1: 'Guard',
  2: 'Priest',
  3: 'Baron',
  4: 'Handmaid',
  5: 'Prince',
  6: 'King',
  7: 'Countess',
  8: 'Princess',
};

const TOKENS_TO_WIN = { 2: 7, 3: 5, 4: 4, 5: 3, 6: 3 };

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildDeck() {
  const counts = { 1: 5, 2: 2, 3: 2, 4: 2, 5: 2, 6: 1, 7: 1, 8: 1 };
  const cards = [];
  for (const [val, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) {
      cards.push({ value: parseInt(val), name: CARD_NAMES[val] });
    }
  }
  return shuffle(cards);
}

class GameState {
  constructor(players) {
    // players: [{ id, name }]
    this.players = players;
    this.round = 0;
    this.tokens = {};
    this.playerStates = {};
    this.gameLog = [];
    this.phase = 'waiting'; // waiting | playing | round_end | game_end
    this.gameWinner = null;
    this.roundWinner = null;
    this.lastRoundWinnerId = null;
    this.deck = [];
    this.setAside = null;
    this.revealedCards = [];
    this.currentPlayerIndex = 0;

    players.forEach(p => {
      this.tokens[p.id] = 0;
      this.playerStates[p.id] = { hand: [], discardPile: [], eliminated: false, protected: false };
    });

    this.startRound();
  }

  startRound() {
    this.round++;
    this.deck = buildDeck();
    this.setAside = this.deck.pop();
    this.revealedCards = [];
    this.roundWinner = null;
    this.phase = 'playing';

    // Reset per-player state
    this.players.forEach(p => {
      this.playerStates[p.id] = { hand: [], discardPile: [], eliminated: false, protected: false };
    });

    // 2-player: reveal 3 additional cards face-up
    if (this.players.length === 2) {
      for (let i = 0; i < 3; i++) this.revealedCards.push(this.deck.pop());
    }

    // Deal 1 card each
    this.players.forEach(p => {
      this.playerStates[p.id].hand = [this.deck.pop()];
    });

    // Determine first player (winner of last round goes first)
    if (this.lastRoundWinnerId) {
      const idx = this.players.findIndex(p => p.id === this.lastRoundWinnerId);
      this.currentPlayerIndex = idx >= 0 ? idx : 0;
    } else {
      this.currentPlayerIndex = 0;
    }

    this.log(`--- Round ${this.round} begins! ---`);

    // Start the first turn (draw a card for the first player)
    this._startTurn();
  }

  _startTurn() {
    const state = this.playerStates[this.currentPlayer.id];
    // Clear protection at the start of your turn
    state.protected = false;
    // Draw a card
    const drawn = this._draw();
    if (drawn) state.hand.push(drawn);
  }

  _draw() {
    if (this.deck.length > 0) return this.deck.pop();
    if (this.setAside) {
      const c = this.setAside;
      this.setAside = null;
      return c;
    }
    return null;
  }

  get currentPlayer() {
    return this.players[this.currentPlayerIndex];
  }

  activePlayers() {
    return this.players.filter(p => !this.playerStates[p.id].eliminated);
  }

  log(msg) {
    this.gameLog.push(msg);
    if (this.gameLog.length > 100) this.gameLog.shift();
  }

  // Main entry point called by the server
  playCard(playerId, cardValue, targetPlayerId, guessedValue) {
    if (this.phase !== 'playing') return { error: 'Game is not in the playing phase.' };
    if (playerId !== this.currentPlayer.id) return { error: 'It is not your turn.' };

    const playerState = this.playerStates[playerId];
    const hand = playerState.hand;

    const cardIndex = hand.findIndex(c => c.value === cardValue);
    if (cardIndex === -1) return { error: 'That card is not in your hand.' };

    // Enforce Countess rule
    const hasCountess = hand.some(c => c.value === 7);
    const hasKingOrPrince = hand.some(c => c.value === 5 || c.value === 6);
    if (hasCountess && hasKingOrPrince && cardValue !== 7) {
      return { error: 'You must play the Countess when holding the King or Prince.' };
    }

    const [card] = hand.splice(cardIndex, 1);
    playerState.discardPile.push(card);

    const result = this._applyEffect(playerId, card.value, targetPlayerId, guessedValue);

    if (result.error) {
      // Put card back — invalid input, don't consume it
      hand.push(card);
      playerState.discardPile.pop();
      return result;
    }

    const roundOver = this._checkRoundEnd();
    if (!roundOver) this._advanceTurn();

    return result;
  }

  _applyEffect(playerId, cardValue, targetPlayerId, guessedValue) {
    const pName = this._name(playerId);

    switch (cardValue) {
      case 1: { // Guard
        if (!targetPlayerId) return { error: 'Choose a target.' };
        if (targetPlayerId === playerId) return { error: 'You cannot target yourself with the Guard.' };
        const t = this.playerStates[targetPlayerId];
        if (!t || t.eliminated) return { error: 'Invalid target.' };
        const gv = parseInt(guessedValue);
        if (!gv || gv < 2 || gv > 8) return { error: 'Guess a card value between 2 and 8 (not Guard).' };
        if (t.protected) {
          this.log(`${pName} played Guard targeting ${this._name(targetPlayerId)}, but they are protected by the Handmaid.`);
          return { success: true };
        }
        if (t.hand[0].value === gv) {
          this.log(`${pName} played Guard and correctly guessed ${this._name(targetPlayerId)} holds the ${CARD_NAMES[gv]}! They are eliminated!`);
          this._eliminate(targetPlayerId);
        } else {
          this.log(`${pName} played Guard, guessing ${this._name(targetPlayerId)} holds the ${CARD_NAMES[gv]}. Wrong!`);
        }
        return { success: true };
      }

      case 2: { // Priest
        if (!targetPlayerId) return { error: 'Choose a target.' };
        if (targetPlayerId === playerId) return { error: 'You cannot target yourself with the Priest.' };
        const t = this.playerStates[targetPlayerId];
        if (!t || t.eliminated) return { error: 'Invalid target.' };
        if (t.protected) {
          this.log(`${pName} played Priest targeting ${this._name(targetPlayerId)}, but they are protected.`);
          return { success: true };
        }
        this.log(`${pName} played Priest and secretly looked at ${this._name(targetPlayerId)}'s hand.`);
        return { success: true, priestReveal: { viewerId: playerId, targetId: targetPlayerId, card: t.hand[0] } };
      }

      case 3: { // Baron
        if (!targetPlayerId) return { error: 'Choose a target.' };
        if (targetPlayerId === playerId) return { error: 'You cannot target yourself with the Baron.' };
        const t = this.playerStates[targetPlayerId];
        if (!t || t.eliminated) return { error: 'Invalid target.' };
        if (t.protected) {
          this.log(`${pName} played Baron targeting ${this._name(targetPlayerId)}, but they are protected.`);
          return { success: true };
        }
        const myCard = this.playerStates[playerId].hand[0];
        const theirCard = t.hand[0];
        this.log(`${pName} played Baron against ${this._name(targetPlayerId)}: ${myCard.name} (${myCard.value}) vs ${theirCard.name} (${theirCard.value}).`);
        if (myCard.value > theirCard.value) {
          this.log(`${this._name(targetPlayerId)} is eliminated!`);
          this._eliminate(targetPlayerId);
        } else if (theirCard.value > myCard.value) {
          this.log(`${pName} is eliminated!`);
          this._eliminate(playerId);
        } else {
          this.log(`Tie! Both players are safe.`);
        }
        return { success: true };
      }

      case 4: { // Handmaid
        this.playerStates[playerId].protected = true;
        this.log(`${pName} played Handmaid and is protected until their next turn.`);
        return { success: true };
      }

      case 5: { // Prince
        if (!targetPlayerId) return { error: 'Choose a target (can be yourself).' };
        const t = this.playerStates[targetPlayerId];
        if (!t || t.eliminated) return { error: 'Invalid target.' };
        if (t.protected && targetPlayerId !== playerId) {
          this.log(`${pName} played Prince targeting ${this._name(targetPlayerId)}, but they are protected.`);
          return { success: true };
        }
        const discarded = t.hand[0];
        t.hand = [];
        t.discardPile.push(discarded);
        if (discarded.value === 8) {
          this.log(`${this._name(targetPlayerId)} was forced to discard the Princess and is eliminated!`);
          this._eliminate(targetPlayerId);
        } else {
          const newCard = this._draw();
          if (newCard) t.hand = [newCard];
          this.log(`${pName} played Prince on ${this._name(targetPlayerId)}. They discarded ${discarded.name} and drew a new card.`);
        }
        return { success: true };
      }

      case 6: { // King
        if (!targetPlayerId) return { error: 'Choose a target.' };
        if (targetPlayerId === playerId) return { error: 'You cannot target yourself with the King.' };
        const t = this.playerStates[targetPlayerId];
        if (!t || t.eliminated) return { error: 'Invalid target.' };
        if (t.protected) {
          this.log(`${pName} played King targeting ${this._name(targetPlayerId)}, but they are protected.`);
          return { success: true };
        }
        const myHand = [...this.playerStates[playerId].hand];
        const theirHand = [...t.hand];
        this.playerStates[playerId].hand = theirHand;
        t.hand = myHand;
        this.log(`${pName} played King and traded hands with ${this._name(targetPlayerId)}.`);
        return { success: true };
      }

      case 7: { // Countess
        this.log(`${pName} played the Countess.`);
        return { success: true };
      }

      case 8: { // Princess
        this.log(`${pName} played the Princess and is immediately eliminated!`);
        this._eliminate(playerId);
        return { success: true };
      }

      default:
        return { error: 'Unknown card.' };
    }
  }

  _eliminate(playerId) {
    const s = this.playerStates[playerId];
    if (s.eliminated) return;
    s.eliminated = true;
    s.discardPile.push(...s.hand);
    s.hand = [];
  }

  _advanceTurn() {
    const n = this.players.length;
    let next = (this.currentPlayerIndex + 1) % n;
    for (let i = 0; i < n; i++) {
      if (!this.playerStates[this.players[next].id].eliminated) break;
      next = (next + 1) % n;
    }
    this.currentPlayerIndex = next;
    this._startTurn();
  }

  _checkRoundEnd() {
    const active = this.activePlayers();

    if (active.length === 1) {
      this._endRound([active[0]]);
      return true;
    }

    // Round ends when deck is empty AND the set-aside card has also been used
    if (this.deck.length === 0 && this.setAside === null) {
      // Showdown: highest hand card wins
      let maxVal = -1;
      active.forEach(p => {
        const c = this.playerStates[p.id].hand[0];
        if (c && c.value > maxVal) maxVal = c.value;
      });
      let winners = active.filter(p => {
        const c = this.playerStates[p.id].hand[0];
        return c && c.value === maxVal;
      });
      if (winners.length > 1) {
        // Tiebreaker: highest sum of discarded cards
        let maxSum = -1;
        winners.forEach(p => {
          const sum = this.playerStates[p.id].discardPile.reduce((acc, c) => acc + c.value, 0);
          if (sum > maxSum) maxSum = sum;
        });
        winners = winners.filter(p => {
          const sum = this.playerStates[p.id].discardPile.reduce((acc, c) => acc + c.value, 0);
          return sum === maxSum;
        });
      }
      active.forEach(p => {
        const c = this.playerStates[p.id].hand[0];
        this.log(`${p.name} reveals ${c ? c.name + ' (' + c.value + ')' : 'no card'}.`);
      });
      this._endRound(winners);
      return true;
    }

    return false;
  }

  _endRound(winners) {
    winners.forEach(w => {
      this.tokens[w.id]++;
      this.log(`${w.name} wins the round and earns a Token of Affection! (${this.tokens[w.id]} total)`);
    });
    this.roundWinner = winners.map(w => w.id);
    this.lastRoundWinnerId = winners[0].id;

    const needed = TOKENS_TO_WIN[this.players.length] || 4;
    const gameWinner = this.players.find(p => this.tokens[p.id] >= needed);
    if (gameWinner) {
      this.phase = 'game_end';
      this.gameWinner = gameWinner.id;
      this.log(`*** ${gameWinner.name} wins the game! ***`);
    } else {
      this.phase = 'round_end';
    }
  }

  startNextRound() {
    if (this.phase !== 'round_end') return { error: 'Not in round_end phase.' };
    this.startRound();
    return { success: true };
  }

  _name(id) {
    return this.players.find(p => p.id === id)?.name || 'Unknown';
  }

  // Returns a view of game state tailored for a specific player
  getStateFor(playerId) {
    return {
      phase: this.phase,
      round: this.round,
      currentPlayerId: this.phase === 'playing' ? this.currentPlayer.id : null,
      players: this.players.map(p => {
        const s = this.playerStates[p.id];
        return {
          id: p.id,
          name: p.name,
          tokens: this.tokens[p.id],
          eliminated: s.eliminated,
          protected: s.protected,
          handSize: s.hand.length,
          discardPile: s.discardPile,
          // Only reveal own hand; eliminated players show their hand (it's in discardPile anyway)
          hand: p.id === playerId ? s.hand : null,
        };
      }),
      deckSize: this.deck.length,
      setAsideExists: this.setAside !== null,
      revealedCards: this.revealedCards,
      gameLog: this.gameLog.slice(-30),
      roundWinner: this.roundWinner,
      gameWinner: this.gameWinner,
      tokensNeeded: TOKENS_TO_WIN[this.players.length] || 4,
    };
  }
}

module.exports = { GameState, CARD_NAMES };
