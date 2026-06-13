# Love Letter — Online Multiplayer Card Game

## What this is
A real-time online implementation of the Love Letter card game. Players connect via a shared 4-letter room code and play in their browsers. Computer opponents (bots) are available.

## Tech stack
- **Backend:** Node.js, Express, Socket.io
- **Frontend:** Vanilla HTML/CSS/JS (no framework), single-page app

## Running locally
```bash
npm install      # first time only
npm start        # starts server at http://localhost:3000
npm run dev      # same but auto-restarts on file changes (uses nodemon)
```

## File structure
```
server.js              — Express + Socket.io server; room management; bot scheduling
src/
  GameState.js         — All game logic: deck, card effects, round/game lifecycle
  BotAI.js             — Computer opponent decision engine
public/
  index.html           — Single-page app with three views: landing, lobby, game
  style.css            — Dark medieval/romantic theme (burgundy, gold, cream)
  client.js            — Socket.io client; full UI rendering and event handling
```

## Socket events

### Client → Server
| Event | Payload | Description |
|---|---|---|
| `create_room` | `{ playerName }` | Creates a room; returns `{ roomCode, playerId }` |
| `join_room` | `{ roomCode, playerName }` | Joins a room; returns `{ roomCode, playerId }` |
| `add_bot` | — | Host adds a computer opponent |
| `remove_bot` | — | Host removes the last bot |
| `start_game` | — | Host starts the game (min 2 players) |
| `play_card` | `{ cardValue, targetPlayerId?, guessedValue? }` | Plays a card on your turn |
| `next_round` | — | Host advances to the next round |
| `new_game` | — | Host resets with the same player list |

### Server → Client
| Event | Payload | Description |
|---|---|---|
| `room_update` | `{ roomCode, players, hostId, started }` | Player list changed |
| `game_state` | Full state object (hand hidden for other players) | After any game action |
| `priest_reveal` | `{ targetId, targetName, card }` | Sent privately to Priest caster |
| `player_disconnected` | `{ playerId, playerName }` | A player dropped |

## Game rules (standard 16-card deck)
| Value | Card | Count | Effect |
|---|---|---|---|
| 1 | Guard | 5 | Guess a non-Guard card; if correct, target eliminated |
| 2 | Priest | 2 | Look at another player's hand |
| 3 | Baron | 2 | Compare hands; lower card eliminated (tie = safe) |
| 4 | Handmaid | 2 | Protected from card effects until your next turn |
| 5 | Prince | 2 | Choose any player (including self) to discard and redraw |
| 6 | King | 1 | Trade hands with another player |
| 7 | Countess | 1 | Must play if holding King or Prince |
| 8 | Princess | 1 | If discarded for any reason, you're eliminated |

**Setup:** 1 card removed face-down; 2-player games also remove 3 cards face-up.  
**Round win:** Last player standing, or highest card when deck runs out (tiebreaker: highest discard sum).  
**Game win:** First to N tokens — 2 players: 7, 3 players: 5, 4+ players: 4.

## Bot AI (src/BotAI.js)
The bot tracks all publicly visible discarded cards, calculates remaining card probabilities, and scores each possible play:
- **Guard:** guesses the highest-count remaining card
- **Baron:** only plays offensively if its other card beats the average (~4)
- **Handmaid:** prioritises protection when holding high-value cards
- **Prince:** targets the token leader; self-targets if holding a weak card
- **King:** only trades when holding a card ≤ 3
- **Princess:** never voluntarily played

Bots play with a ~2 second delay so you can follow the action.

## Key implementation notes
- `GameState.getStateFor(playerId)` hides other players' hands — each client only sees their own cards
- Bot turns are scheduled server-side via `setTimeout` after each `postGameUpdate`
- The Countess rule (must discard if holding King or Prince) is enforced both client-side (disables the card) and server-side (returns an error)
- 2-player mode removes 3 additional cards face-up at round start per the rules
