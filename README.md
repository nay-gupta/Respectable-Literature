# Literature — Discord Activity

A real-time multiplayer implementation of **Literature** (also known as Canadian Fish / Russian Fish) playable directly inside a Discord voice channel as an [Embedded App](https://discord.com/developers/docs/activities/overview).

6–8 players split into two teams and take turns asking opponents for specific cards, with the goal of claiming complete half-suits (sets of 6 related cards). The team that claims more of the 8 half-suits wins.

## Tech Stack

| Layer | Technology |
|---|---|
| Client | Vite + vanilla JavaScript |
| Server | Node.js + Express |
| Realtime | Socket.io |
| Discord integration | [@discord/embedded-app-sdk](https://github.com/discord/embedded-app-sdk) |

---

## Running Locally

### Prerequisites

- Node.js 18+
- A Discord application with the **Activities** feature enabled ([Discord Developer Portal](https://discord.com/developers/applications))
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/) (or any HTTPS tunnel) to expose your local server to Discord

### 1. Clone and install dependencies

```bash
# Install server dependencies
cd server && npm install

# Install client dependencies
cd ../client && npm install
```

### 2. Configure environment variables

Copy the example env file and fill in your Discord application credentials:

```bash
cp example.env .env
```

Edit `.env`:

```
VITE_DISCORD_CLIENT_ID=your_discord_application_client_id
DISCORD_CLIENT_SECRET=your_discord_application_client_secret
```

You can find both values on your application's **OAuth2** page in the [Discord Developer Portal](https://discord.com/developers/applications).

### 3. Start the dev servers

In one terminal, start the backend:

```bash
cd server
node server.js
# Listening on http://localhost:3001
```

In another terminal, start the frontend:

```bash
cd client
npm run dev
# Listening on http://localhost:5173
```

### 4. Expose your server with a tunnel

Discord requires HTTPS. Use `cloudflared` to create a public tunnel:

```bash
cloudflared tunnel --url http://localhost:5173
# Outputs something like: https://xxxx-xxxx.trycloudflare.com
```

### 5. Configure the URL mapping in the Discord Developer Portal

1. Go to your application in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Navigate to **Activities → URL Mappings**.
3. Set the root mapping `/` to point to your tunnel URL (e.g. `xxxx-xxxx.trycloudflare.com`).

### 6. Launch the Activity in Discord

1. Join a voice channel in a server where your application is installed.
2. Click the **Activities** (rocket 🚀) button.
3. Select your application from the list.
4. Share the activity so other players can join — you need 6 or 8 players to start.

---

## How to Play

1. **Lobby** — Players join and are randomly split into Team A and Team B. The first player to join is the host and can start the game once exactly 6 or 8 players are present.

2. **Asking** — On your turn, pick an opponent and ask them for a specific card. You must already hold at least one other card in the same half-suit. If they have it, you get the card and keep your turn. If not, the turn passes to them.

3. **Claiming** — On your turn you may claim a full half-suit instead of asking. Declare which teammate holds each of the 6 cards. A correct claim scores the half-suit for your team; wrong card locations cancel it; if an opponent holds any card, they score it.

4. **Winning** — The game ends when all 8 half-suits are claimed. The team with more half-suits wins (ties at 4–4 are possible).

### Half-suits

| Half-Suit | Cards |
|---|---|
| Low ♠ | 2 3 4 5 6 7 of Spades |
| High ♠ | 9 10 J Q K A of Spades |
| Low ♥ | 2 3 4 5 6 7 of Hearts |
| High ♥ | 9 10 J Q K A of Hearts |
| Low ♦ | 2 3 4 5 6 7 of Diamonds |
| High ♦ | 9 10 J Q K A of Diamonds |
| Low ♣ | 2 3 4 5 6 7 of Clubs |
| High ♣ | 9 10 J Q K A of Clubs |

> The standard 52-card deck is used with all 8s removed, leaving 48 cards.

---

## Project Structure

```
├── client/               # Vite frontend
│   ├── main.js           # Entry point: Discord auth + Socket.io setup
│   ├── style.css         # All styles
│   ├── index.html
│   └── src/
│       ├── socket.js     # Socket.io singleton
│       ├── gameState.js  # Reactive state store
│       ├── constants.js  # Shared card/half-suit constants
│       └── ui/
│           ├── lobby.js        # Lobby screen
│           ├── gameBoard.js    # Main game screen
│           ├── handDisplay.js  # Your cards grouped by half-suit
│           ├── playerList.js   # All players + scores bar
│           ├── eventLog.js     # Live event feed
│           ├── askModal.js     # 3-step ask flow
│           ├── claimModal.js   # 2-step claim flow
│           └── resultsScreen.js
│
└── server/               # Express + Socket.io backend
    ├── server.js         # HTTP server + all Socket.io handlers
    └── game/
        ├── deck.js       # Card constants, shuffle, deal
        ├── gameEngine.js # All game rules and state mutations
        └── gameManager.js# In-memory game session store
```

