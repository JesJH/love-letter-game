# Love Letter — Online Multiplayer Card Game

## What this is
A real-time online implementation of the Love Letter card game. Players connect via a shared 4-letter room code and play in their browsers. Computer opponents (bots) are available. Installable as a PWA on iOS and Android.

## Tech stack
- **Backend:** Node.js, Express, Socket.io
- **Frontend:** Vanilla HTML/CSS/JS (no framework), single-page app
- **PWA:** manifest.json + service worker for home screen install

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
  manifest.json        — PWA manifest (name, colors, icons)
  sw.js                — Service worker: precaches static assets, skips socket.io
  icon.svg             — SVG app icon (gold heart on dark background)
  icons/
    icon-192.png       — PNG icon for Android install prompt + iOS apple-touch-icon
    icon-512.png       — PNG icon for splash screens and maskable use
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
| `priest_ack` | — | Player dismissed the Priest reveal modal; resumes bot scheduling |
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

Bots play with a ~2 second delay. If all human players are eliminated mid-round, bots switch to 400ms turns to resolve the round quickly.

## Key implementation notes
- `GameState.getStateFor(playerId)` hides other players' hands — each client only sees their own cards
- Bot turns are scheduled server-side via `setTimeout` inside `postGameUpdate`
- `room.waitingForPriestAck` pauses bot scheduling while a human reads a Priest reveal; cleared by the `priest_ack` event
- The Countess rule (must discard if holding King or Prince) is enforced client-side (card disabled) and server-side (returns error)
- 2-player mode removes 3 additional cards face-up at round start per the rules
- Game log shown in UI is filtered to the current round only (sliced at the last `---` separator)
- Host sees a **↺ Restart** button in the game header; all players see a **Leave** button
- PWA icons generated with pure Python stdlib (no Pillow) using the algebraic heart curve `(x²+y²−1)³ − x²y³ ≤ 0`

## Deploying publicly (required for mobile PWA off local network)
Service workers require HTTPS. Easiest host: **Render** (free tier).
1. Go to render.com → New Web Service → connect `JesJH/love-letter-game`
2. Build command: `npm install` · Start command: `npm start`
3. Render provides a `https://your-app.onrender.com` URL automatically

Once hosted, users open the URL in Safari (iOS) or Chrome (Android) and use "Add to Home Screen" to install.
