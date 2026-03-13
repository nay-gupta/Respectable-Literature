import { DiscordSDK } from "@discord/embedded-app-sdk";
import "./style.css";
import socket, { connectSocket } from "./src/socket.js";
import { updateState, onStateChange } from "./src/gameState.js";
import { renderLobby } from "./src/ui/lobby.js";
import { renderGameBoard } from "./src/ui/gameBoard.js";
import { renderResultsScreen } from "./src/ui/resultsScreen.js";

// Guard: DiscordSDK throws if frame_id is not in the URL, which happens
// when the page is opened directly in a browser instead of inside Discord.
const urlParams = new URLSearchParams(window.location.search);
if (!urlParams.get('frame_id')) {
  document.querySelector('#app').innerHTML = `
    <div class="loading-screen" style="text-align:center;padding:32px">
      <h2 style="font-size:22px;margin-bottom:12px">Literature</h2>
      <p style="color:var(--text-muted)">This app must be opened as a Discord Activity inside a voice channel.</p>
      <p style="color:var(--text-muted);margin-top:8px;font-size:12px">See the README for setup instructions.</p>
    </div>
  `;
  throw new Error('Not running inside Discord — frame_id query param is missing.');
}

const discordSdk = new DiscordSDK(import.meta.env.VITE_DISCORD_CLIENT_ID);

let localUser = null;

// ─── App container ──────────────────────────────────────────────────────────

const appEl = document.querySelector('#app');

function showLoading(message = 'Connecting…') {
  appEl.innerHTML = `<div class="loading-screen"><div class="spinner"></div><p>${message}</p></div>`;
}

function showError(message) {
  appEl.innerHTML = `<div class="error-screen"><h2>⚠️ Error</h2><p>${message}</p></div>`;
}

// ─── State-driven rendering ─────────────────────────────────────────────────

onStateChange((state) => {
  if (!localUser) return;

  if (state.status === 'lobby') {
    renderLobby(appEl, state, localUser.id);
  } else if (state.status === 'playing') {
    renderGameBoard(appEl, state, localUser.id);
  } else if (state.status === 'finished') {
    renderResultsScreen(appEl, state, localUser.id);
  }
});

// ─── Discord SDK setup ──────────────────────────────────────────────────────

async function setupDiscordSdk() {
  await discordSdk.ready();

  const { code } = await discordSdk.commands.authorize({
    client_id: import.meta.env.VITE_DISCORD_CLIENT_ID,
    response_type: "code",
    state: "",
    prompt: "none",
    scope: ["identify", "guilds", "applications.commands"],
  });

  const response = await fetch("/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const { access_token } = await response.json();

  const auth = await discordSdk.commands.authenticate({ access_token });
  if (!auth) throw new Error("Authentication failed");

  return auth;
}

// ─── Socket.io setup ────────────────────────────────────────────────────────

function setupSocket(instanceId) {
  connectSocket();

  socket.on("connect", () => {
    console.log("[Socket] Connected:", socket.id);
    // (Re-)join on connect/reconnect
    if (localUser) {
      socket.emit("join-game", {
        instanceId,
        userId: localUser.id,
        username: localUser.username,
        avatarUrl: localUser.avatarUrl,
      });
    }
  });

  socket.on("game-state", (state) => {
    updateState(state);
  });

  socket.on("ask-result", (result) => {
    // UI feedback is driven by the subsequent game-state event;
    // this event can be used for animations in future.
    console.log("[Game] Ask result:", result);
  });

  socket.on("claim-result", (result) => {
    console.log("[Game] Claim result:", result);
  });

  socket.on("game-over", ({ scores, winner }) => {
    console.log("[Game] Game over. Scores:", scores, "Winner:", winner);
  });

  socket.on("error", ({ message, code }) => {
    console.error(`[Socket Error] ${code}: ${message}`);
    showToast(`⚠️ ${message}`);
  });

  socket.on("disconnect", (reason) => {
    console.warn("[Socket] Disconnected:", reason);
    showToast("Connection lost. Reconnecting…");
  });

  socket.on("reconnect", () => {
    showToast("Reconnected!");
    socket.emit("request-state", { instanceId });
  });
}

// ─── Toast notifications ────────────────────────────────────────────────────

function showToast(message, duration = 3000) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add('toast-visible'), 10);
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ─── Bootstrap ──────────────────────────────────────────────────────────────

showLoading('Authenticating with Discord…');

setupDiscordSdk()
  .then((auth) => {
    const user = auth.user;
    const avatarUrl = user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.webp?size=64`
      : `https://cdn.discordapp.com/embed/avatars/${parseInt(user.id) % 5}.png`;

    localUser = {
      id: user.id,
      username: user.global_name ?? user.username,
      avatarUrl,
    };

    const instanceId = discordSdk.instanceId;
    showLoading('Joining game…');
    setupSocket(instanceId);
  })
  .catch((err) => {
    console.error("Setup failed:", err);
    showError("Failed to connect to Discord. Please close and reopen the activity.");
  });
