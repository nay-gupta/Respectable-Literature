# Literature Card Game — Discord Activity Implementation Plan

## Table of Contents
1. [Project Overview](#1-project-overview)
2. [Literature Rules Summary](#2-literature-rules-summary)
3. [Current Codebase Analysis](#3-current-codebase-analysis)
4. [Architecture Overview](#4-architecture-overview)
5. [File Structure](#5-file-structure)
6. [Data Structures](#6-data-structures)
7. [Server-Side Implementation](#7-server-side-implementation)
8. [Client-Side Implementation](#8-client-side-implementation)
9. [Socket.io Event API](#9-socketio-event-api)
10. [UI/UX Plan](#10-uiux-plan)
11. [Implementation Steps (Ordered)](#11-implementation-steps-ordered)
12. [Edge Cases & Validation](#12-edge-cases--validation)
13. [Future Improvements](#13-future-improvements)

---

## 1. Project Overview

This Discord Activity lets 6–8 players inside a voice channel play **Literature**, a team-based card game (also known as Canadian Fish / Russian Fish). Players are split into two teams and take turns asking opponents for specific cards, with the goal of claiming complete half-suits (sets of 6 cards).

The Activity is built as a web app embedded in an iframe inside Discord using the **Embedded App SDK**. The client is a Vite/vanilla-JS frontend; the server is an Express + Node.js backend. Real-time multiplayer state is synced via **Socket.io**.

---

## 2. Literature Rules Summary

### Deck
- Start with a standard 52-card deck, **remove all 8s** → 48 cards remain.
- Cards are divided into **8 half-suits (books)**:
  | Half-Suit | Cards |
  |-----------|-------|
  | Low ♠ | 2 3 4 5 6 7 of Spades |
  | High ♠ | 9 10 J Q K A of Spades |
  | Low ♥ | 2 3 4 5 6 7 of Hearts |
  | High ♥ | 9 10 J Q K A of Hearts |
  | Low ♦ | 2 3 4 5 6 7 of Diamonds |
  | High ♦ | 9 10 J Q K A of Diamonds |
  | Low ♣ | 2 3 4 5 6 7 of Clubs |
  | High ♣ | 9 10 J Q K A of Clubs |

### Setup
- 6 players (teams of 3) or 8 players (teams of 4). Players alternate seats between teams.
- Cards are dealt evenly: 8 cards each for 6 players, 6 cards each for 8 players.
- Players may look at their own hand only.

### Turn Structure (Asking)
- The dealer takes the first turn.
- On your turn, you must ask **any one opponent** for **one specific card**.
- **Validity rules for a question:**
  - You must ask for a card by exact value and suit.
  - You must hold at least one other card in the same half-suit.
  - You must NOT ask for a card you already hold.
  - The target player must hold at least one card.
- If the target **has** the card → they give it to you, and you keep the turn.
- If the target **does not have** the card → the turn passes to the target.

### Claiming
- On your turn, you may **claim** a half-suit instead of (or after) asking.
- Declare exactly which player on your team holds each of the 6 cards in the half-suit.
- **Correct claim** → your team scores the half-suit; cards are removed from play.
- **Wrong claim (your team has all cards but mis-stated locations)** → half-suit is cancelled; neither team scores.
- **Wrong claim (opponent holds at least one card)** → the opposing team scores the half-suit.
- You may claim even if you hold none of the cards in the half-suit.

### Public Information
- Any player may ask what the most recent question was (asker, target, card, result).
- Any player may ask how many cards any player currently holds (must be answered truthfully).
- All card counts are visible at all times.

### Endgame
- When a player runs out of cards, they cannot be asked for cards (but can still claim).
- When a player loses their last card on their own turn (from a successful claim), they pass the turn to a teammate who still holds cards.
- When one entire team runs out of cards, the other team must claim all remaining half-suits without consulting each other.

### Scoring
- The team that claims more half-suits wins. (8 total → ties at 4–4 are possible.)

---

## 3. Current Codebase Analysis

### `client/main.js`
- Sets up the **DiscordSDK**, authorizes via OAuth2, authenticates, and fetches the access token from the server.
- Currently renders a static "Hello World" page with guild avatar and channel name.
- All Discord SDK plumbing is already done (auth flow, channel/guild info).

### `server/server.js`
- Minimal Express server on port 3001.
- One endpoint: `POST /api/token` — exchanges an OAuth2 code for an access token with Discord.
- No persistence, no WebSocket support yet.

### `client/vite.config.js`
- Proxies `/api` to `localhost:3001` (for dev).
- WebSocket proxy (`ws: true`) is already configured.

### `client/package.json`
- Dependencies: `@discord/embedded-app-sdk ^2.4.0`
- Dev: `vite ^5.0.8`

### `server/package.json`
- Dependencies: `dotenv`, `express`, `node-fetch`

---

## 4. Architecture Overview

```
Discord Client (iframe)
        │
        │  Embedded App SDK (RPC)
        ▼
  Vite Dev Server (port 5173)  ◄──── proxies /api & /socket.io ────►  Express + Socket.io (port 3001)
        │                                                                        │
        │ HTML/JS/CSS                                               ┌────────────┘
        ▼                                                           │
  Client-side Game UI                                     Game Manager
  (lobby, hand, ask, claim)                               (per-channel game sessions)
                                                                    │
                                                          ┌─────────┴──────────┐
                                                          │                    │
                                                     Game Engine           Deck Utils
                                                   (rules, state)       (cards, half-suits)
```

Key design decisions:
- **Server-authoritative state**: All game logic runs server-side. Clients only send intents (ask, claim, start). The server validates and broadcasts updated state.
- **One game per Discord channel instance**: Games are keyed by `discordSdk.instanceId` (the unique activity instance ID). Multiple instances in different channels are independent.
- **Socket.io rooms**: Each game instance is a Socket.io room. Clients join the room identified by `instanceId`.
- **Player identity**: Discord `userId` (from the `auth` object) is used as the player identifier.

---

## 5. File Structure

```
getting-started-activity/
├── example.env
├── README.md
├── renovate.json
├── PLAN.md                          ← this file
│
├── client/
│   ├── index.html                   (update: add game shell structure)
│   ├── main.js                      (rewrite: orchestrate SDK auth + Socket.io + UI)
│   ├── style.css                    (rewrite: card game styling)
│   ├── package.json                 (update: add socket.io-client)
│   ├── vite.config.js               (update: proxy /socket.io)
│   └── src/
│       ├── socket.js                (new: Socket.io client singleton)
│       ├── gameState.js             (new: local reactive game state store)
│       └── ui/
│           ├── lobby.js             (new: lobby screen – player list, team assignment, start)
│           ├── gameBoard.js         (new: main game screen root)
│           ├── handDisplay.js       (new: render your cards by half-suit)
│           ├── playerList.js        (new: show all players, card counts, teams, turn indicator)
│           ├── askModal.js          (new: multi-step UI: pick opponent → pick half-suit → pick card)
│           ├── claimModal.js        (new: pick half-suit → assign each card to a teammate)
│           ├── eventLog.js          (new: scrolling feed of last question + game events)
│           └── resultsScreen.js     (new: end-of-game scores + play again)
│
└── server/
    ├── server.js                    (update: add Socket.io, game socket handlers)
    ├── package.json                 (update: add socket.io)
    └── game/
        ├── deck.js                  (new: card definitions, half-suit mappings, shuffle/deal)
        ├── gameEngine.js            (new: game state creation, all rule logic)
        └── gameManager.js           (new: lifecycle manager for concurrent game instances)
```

---

## 6. Data Structures

### Card Representation
Cards are strings in the format `{value}{suit}`:
- Values: `2 3 4 5 6 7 9 10 J Q K A`
- Suits: `H` (Hearts) `D` (Diamonds) `C` (Clubs) `S` (Spades)
- Examples: `"2H"`, `"10S"`, `"KD"`, `"AC"`

### Half-Suit IDs
```js
const HALF_SUITS = {
  lowS:  ['2S','3S','4S','5S','6S','7S'],
  highS: ['9S','10S','JS','QS','KS','AS'],
  lowH:  ['2H','3H','4H','5H','6H','7H'],
  highH: ['9H','10H','JH','QH','KH','AH'],
  lowD:  ['2D','3D','4D','5D','6D','7D'],
  highD: ['9D','10D','JD','QD','KD','AD'],
  lowC:  ['2C','3C','4C','5C','6C','7C'],
  highC: ['9C','10C','JC','QC','KC','AC'],
};
```

### Game State Object (server-side, authoritative)
```js
{
  instanceId: String,          // Discord activity instance ID (= Socket.io room)
  status: 'lobby' | 'playing' | 'finished',

  players: [
    {
      id: String,              // Discord userId
      username: String,        // Display name
      avatarUrl: String,
      teamIndex: 0 | 1,        // 0 = Team A, 1 = Team B
      hand: [String],          // Array of card strings (only sent to that player)
      cardCount: Number,       // Public: how many cards they hold
    }
  ],

  teams: [
    [String],                  // Team 0: array of playerIds
    [String],                  // Team 1: array of playerIds
  ],

  currentTurnPlayerId: String,

  lastQuestion: {
    askerId: String,
    askerName: String,
    targetId: String,
    targetName: String,
    card: String,              // e.g. "QH"
    halfSuit: String,          // e.g. "highH"
    success: Boolean,
  } | null,

  claimedHalfSuits: [
    {
      halfSuit: String,        // e.g. "lowH"
      teamIndex: 0 | 1,
      claimedBy: String,       // playerId who made the claim
    }
  ],

  scores: [Number, Number],    // [teamA claims, teamB claims]

  // Endgame: when a team has no cards
  forcedClaimTeam: null | 0 | 1,   // team that must claim out remaining half-suits

  createdAt: Number,
  startedAt: Number | null,
  finishedAt: Number | null,
}
```

### Client-Side State (per player view)
Same as game state but:
- `hand` is **only** the current user's cards (server never sends another player's hand).
- `players[i].hand` is omitted; only `cardCount` is present for other players.

---

## 7. Server-Side Implementation

### `server/game/deck.js`
- Export `SUITS`, `VALUES`, `HALF_SUITS`, `HALF_SUIT_NAMES` constants.
- `getHalfSuit(card)` → returns the half-suit ID the card belongs to.
- `createDeck()` → returns shuffled 48-card array.
- `dealCards(playerCount)` → returns `playerCount` arrays of cards.

### `server/game/gameEngine.js`
Core pure functions — all take a `gameState` and return a new (mutated) `gameState` plus a result object:

| Function | Description |
|----------|-------------|
| `createGame(instanceId, players)` | Initialize game state in lobby status |
| `assignTeams(gameState)` | Randomly assign players to teams (alternating), shuffle player order |
| `startGame(gameState)` | Deal cards, set first turn to player 0, set status to 'playing' |
| `validateAsk(gameState, askerId, targetId, card)` | Returns `{valid, reason}` — checks all 4 ask rules |
| `processAsk(gameState, askerId, targetId, card)` | Executes ask; returns `{newState, success}` |
| `validateClaim(gameState, claimerId, halfSuit, cardMap)` | Returns `{valid, reason}` — checks it's claimer's turn, half-suit not yet claimed |
| `processClaim(gameState, claimerId, halfSuit, cardMap)` | Executes claim; returns `{newState, outcome}` where outcome is `'correct'`, `'wrong_location'`, or `'opponent_has_card'` |
| `advanceTurn(gameState, toPlayerId?)` | Move to next turn; handles empty-handed players |
| `checkEndgame(gameState)` | Check if game is over or a team is out of cards |
| `getPublicState(gameState, forPlayerId)` | Strip hand data; include only `forPlayerId`'s own hand |

### `server/game/gameManager.js`
- `Map<instanceId, gameState>` in memory.
- `getGame(instanceId)` / `createGame(instanceId)` / `deleteGame(instanceId)`
- Handles cleanup of stale games (idle > 2 hours).

### `server/server.js` (updated)
- Attach Socket.io to the HTTP server.
- **Socket events handled:**
  - `join-game` → `{ instanceId, userId, username, avatarUrl }` — add player to game room; broadcast updated lobby state.
  - `set-teams` → `{ instanceId, teams }` — host manually assigns teams (optional).
  - `start-game` → `{ instanceId }` — host starts; deal cards; broadcast per-player game states.
  - `ask-card` → `{ instanceId, targetId, card }` — validate and process; broadcast result.
  - `make-claim` → `{ instanceId, halfSuit, cardMap }` — validate and process; broadcast result.
  - `request-state` → resend current game state to the requesting client.
  - `disconnect` → handle mid-game disconnection gracefully.

---

## 8. Client-Side Implementation

### `client/main.js` (rewritten)
1. Init DiscordSDK and run existing `setupDiscordSdk()` flow.
2. After auth, extract `userId`, `username`, `avatar` from `auth.user`.
3. Connect to Socket.io.
4. Emit `join-game` with `{ instanceId: discordSdk.instanceId, userId, username, avatarUrl }`.
5. Listen for `game-state` events and delegate rendering to the appropriate screen.

### `client/src/socket.js`
- Singleton Socket.io client instance.
- Exports `socket` and helper `emit(event, data)`.

### `client/src/gameState.js`
- Module-level reactive state: `let state = {}`.
- `updateState(newState)` merges and triggers a re-render.
- `getState()` returns current state.

### `client/src/ui/lobby.js`
Renders the **Lobby Screen**:
- Player list with team color badges (Team A = blue, Team B = red).
- "Shuffle Teams" button (for host).
- Player count indicator (needs 6 or 8 to start).
- "Start Game" button (enabled only for host when 6 or 8 players are present).

### `client/src/ui/gameBoard.js`
Root game screen. Composes:
- `playerList` (top bar — all players with card counts, turn indicator)
- `eventLog` (middle — most recent question + history of last few events)
- `handDisplay` (bottom — current player's cards, grouped by half-suit)
- Action buttons: "Ask Card" and "Claim Half-Suit" (only enabled on your turn)

### `client/src/ui/handDisplay.js`
- Groups the local player's hand by half-suit.
- Renders cards as styled card elements with suit symbols and values.
- Highlights which half-suits the player can ask from.

### `client/src/ui/askModal.js`
Three-step modal:
1. **Pick opponent** — grid of opponent avatars + names (only players with ≥1 card).
2. **Pick half-suit** — show only half-suits the player holds at least one card in.
3. **Pick card** — show valid cards to ask for (cards in chosen half-suit NOT in player's hand).
- On confirm: emits `ask-card`.

### `client/src/ui/claimModal.js`
Two-step modal:
1. **Pick half-suit** — show all unclaimed half-suits (any can be claimed, even if player holds none).
2. **Assign cards to teammates** — for each of the 6 cards in the half-suit, a dropdown/button to assign it to a team member (including self). Pre-fills with known info where possible.
- On confirm: emits `make-claim`.

### `client/src/ui/eventLog.js`
- Displays last question (formatted as: *"Alex asked Sam for Q♥ — Sam did not have it"*).
- Displays claim results, score changes.
- Limited to last ~8 events with a scroll.

### `client/src/ui/resultsScreen.js`
- Shows final score: Team A: X half-suits vs Team B: Y half-suits.
- Lists which team claimed which half-suits.
- "Play Again" button (starts a new game in the same lobby).

---

## 9. Socket.io Event API

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `join-game` | `{ instanceId, userId, username, avatarUrl }` | Join or re-join the game for this activity instance |
| `start-game` | `{ instanceId }` | Host starts the game (must have 6 or 8 players) |
| `ask-card` | `{ instanceId, targetId, card }` | Ask target player for a specific card |
| `make-claim` | `{ instanceId, halfSuit, cardMap }` | Claim a half-suit; `cardMap` = `{ cardString: playerId, ... }` |
| `request-state` | `{ instanceId }` | Re-request current state (reconnection) |

### Server → Client (broadcast to room)

| Event | Payload | Description |
|-------|---------|-------------|
| `game-state` | `GameState (public view)` | Full current state update (sent to all; hand filtered per-player) |
| `ask-result` | `{ success, card, askerId, targetId, lastQuestion }` | Result of an ask |
| `claim-result` | `{ outcome, halfSuit, teamIndex, claimerId }` | Result of a claim |
| `game-over` | `{ scores, winner }` | Game has ended |
| `error` | `{ message, code }` | Validation error (sent only to requester) |

> Note: `game-state` is the primary event. `ask-result` and `claim-result` are supplemental for animations/UI feedback and can be inferred from successive `game-state` events too.

---

## 10. UI/UX Plan

### Screen Flow
```
Discord opens Activity
        │
        ▼
  Auth Screen (auto, ~1s)
        │
        ▼
  Lobby Screen
  ┌─────────────────────────────────┐
  │  Literature                      │
  │  Waiting for players (4/6)      │
  │                                  │
  │  Team A 🔵      Team B 🔴       │
  │  • Alice        • Dave           │
  │  • Bob          • Eve            │
  │                 • Frank          │
  │                                  │
  │  [Shuffle Teams]  [Start Game ▶] │
  └─────────────────────────────────┘
        │
        ▼
  Game Screen
  ┌─────────────────────────────────┐
  │ Team A: 2  |  Team B: 1         │
  │ [Alice 8🃏] [Bob 5🃏] [Carol 3🃏] │◄─ player list (top)
  │ [Dave 7🃏] [Eve* 6🃏] [Frank 4🃏] │   (*= current turn)
  ├─────────────────────────────────┤
  │ Eve asked Alice for Q♥ — ✗     │◄─ event log
  │ It's your turn!                 │
  ├─────────────────────────────────┤
  │ Your Hand:                      │
  │  Low ♠: [2][3][5]               │◄─ hand (bottom)
  │  High ♥: [9][J]                 │
  │                                 │
  │  [Ask Card]  [Claim Half-Suit]  │◄─ action buttons
  └─────────────────────────────────┘
        │
        ▼
  Results Screen
  ┌─────────────────────────────────┐
  │  🏆 Team A Wins! (5 – 3)        │
  │                                  │
  │  Low ♠ → Team A                 │
  │  High ♠ → Team A                │
  │  ...                            │
  │                                 │
  │  [Play Again]                   │
  └─────────────────────────────────┘
```

### Card Styling
- Cards rendered as small `<div>` elements with a white background, rounded corners, and red/black suit symbols.
- Suit symbols: ♠ ♣ (black) ♥ ♦ (red).
- Half-suits grouped with a subtle label (e.g., "Low ♠").
- Cards belonging to the same half-suit are highlighted when hovering the Ask modal.
- Responsive layout to fit within Discord's Activity iframe dimensions.

### Color Scheme
- Discord dark theme base (`#313338` background, `#ffffff` text).
- Team A: `#5865F2` (Discord Blurple).
- Team B: `#ED4245` (Discord Red).
- Current turn highlight: gold border.
- Card face: white with black/red text.

---

## 11. Implementation Steps (Ordered)

### Phase 1 — Infrastructure
1. **Add `socket.io` to `server/package.json`** and **`socket.io-client` to `client/package.json`**.
2. **Update `server/server.js`**: wrap Express in `http.createServer`, attach Socket.io, set up CORS for Vite dev port.
3. **Update `client/vite.config.js`**: ensure `/socket.io` path is proxied to the backend.

### Phase 2 — Game Logic (Server)
4. **Create `server/game/deck.js`**: card constants, `HALF_SUITS` map, `getHalfSuit(card)`, `createDeck()`, `dealCards()`.
5. **Create `server/game/gameEngine.js`**: all game state functions (see §7).
6. **Create `server/game/gameManager.js`**: in-memory game store, create/get/delete helpers.

### Phase 3 — Socket Handlers (Server)
7. **Add all Socket.io event handlers** to `server/server.js` (join, start, ask, claim, disconnect).
8. **Implement `getPublicState(gameState, forPlayerId)`** to safely strip other players' hands before broadcast.

### Phase 4 — Client Foundation
9. **Rewrite `client/main.js`**: Discord auth → Socket.io connect → `join-game` emit → listen for `game-state` → route to correct screen.
10. **Create `client/src/socket.js`**: singleton socket with reconnection logic.
11. **Create `client/src/gameState.js`**: state store + `onStateChange` subscription.

### Phase 5 — UI Screens
12. **Create `client/src/ui/lobby.js`**: lobby screen with player list and start button.
13. **Create `client/src/ui/handDisplay.js`**: card rendering grouped by half-suit.
14. **Create `client/src/ui/playerList.js`**: top bar with all players and card counts.
15. **Create `client/src/ui/eventLog.js`**: question/claim event feed.
16. **Create `client/src/ui/askModal.js`**: three-step ask flow.
17. **Create `client/src/ui/claimModal.js`**: two-step claim flow.
18. **Create `client/src/ui/gameBoard.js`**: compose all game-screen sub-components.
19. **Create `client/src/ui/resultsScreen.js`**: end-of-game screen.

### Phase 6 — Styling
20. **Rewrite `client/style.css`**: card styles, team colors, modal styles, responsive layout for Discord iframe.

### Phase 7 — Polish
21. **Update `client/index.html`**: semantic structure, font links.
22. **Endgame handling**: forced claim logic on server; special UI state on client.
23. **Disconnection handling**: if a player disconnects mid-game, pause the game or skip their turn.
24. **Reconnection**: on `request-state`, resend the full game state so reconnecting clients catch up.

---

## 12. Edge Cases & Validation

| Scenario | Handling |
|----------|----------|
| Player asks for a card they hold | Server returns `error` — invalid ask |
| Player asks for a card from a half-suit they hold nothing in | Server returns `error` |
| Player asks a teammate | Server returns `error` |
| Player asks someone with 0 cards | Server returns `error` |
| Claim on a half-suit already claimed | Server returns `error` |
| Player with 0 cards takes a turn | `advanceTurn` skips to next eligible player on same team |
| All cards on one team — forced claim | `forcedClaimTeam` flag set; server requires that team to claim without consulting |
| Tie (4–4) | Game ends; tie result shown |
| Fewer than 6 or not 6/8 players try to start | Server returns `error` |
| Player disconnects on their turn | Turn automatically passes after a configurable timeout (30s) |
| Player re-joins mid-game | `request-state` resends their private hand view |

---

## 13. Future Improvements

- **Team chat** (text only within your team via Discord's existing voice chat UI — no extra work needed).
- **Animated card transfers** for ask results.
- **Card history tracking** — optional per-player note sheet showing deduced card locations (within the rules: brain only, but the app can surface a helper grid).
- **8-player support** — already supported in game logic; just needs UI adjustments for larger player counts.
- **Spectator mode** — observers who can see all hands (for a "replay" or "learning" mode).
- **Variants** — optional scoring rules (high half-suits = 2 points), allow claims at any time (not just on your turn), Challenge rule.
- **Persistent stats** via a database (wins, half-suits claimed, etc.).
- **Sound effects** — card transfer sound, claim fanfare.
- **Mobile layout** — the Discord mobile app also supports Activities; optimize for small screens.
