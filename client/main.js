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

// Detect if this client wants to spectate instead of play.
// A ?spectate=1 query param triggers spectator mode. The server will also
// auto-spectate any user who joins a game that is already in progress.
const wantsSpectate = urlParams.get('spectate') === '1';

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

// ─── Reconnect banner ──────────────────────────────────────────────────────

let _reconnectBanner = null;

function showReconnectBanner() {
  if (_reconnectBanner) return;
  _reconnectBanner = document.createElement('div');
  _reconnectBanner.className = 'reconnect-banner';
  _reconnectBanner.textContent = '⚡ Reconnecting…';
  document.body.appendChild(_reconnectBanner);
  setTimeout(() => _reconnectBanner?.classList.add('visible'), 10);
}

function hideReconnectBanner() {
  if (!_reconnectBanner) return;
  _reconnectBanner.classList.remove('visible');
  setTimeout(() => { _reconnectBanner?.remove(); _reconnectBanner = null; }, 300);
}

// ─── State-driven rendering ─────────────────────────────────────────────────

// Track whether the local user was auto-spectated on first join so we can
// show a one-time interstitial explaining they are watching, not playing.
let _spectatorGreetShown = false;

onStateChange((state) => {
  if (!localUser) return;

  if (state.status === 'lobby') {
    _spectatorGreetShown = false;
    renderLobby(appEl, state, localUser);
  } else if (state.status === 'playing') {
    if (state.isSpectating && !_spectatorGreetShown) {
      _spectatorGreetShown = true;
      appEl.innerHTML = `
        <div class="loading-screen" style="text-align:center;padding:32px">
          <h2 style="font-size:22px;margin-bottom:12px">👁 Game in progress</h2>
          <p style="color:var(--text-muted)">A game is already underway. You're joining as a spectator.</p>
          <p style="color:var(--text-muted);margin-top:8px;font-size:12px">Sit back and enjoy the show!</p>
        </div>
      `;
      setTimeout(() => renderGameBoard(appEl, state, localUser.id), 2000);
      return;
    }
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

  const tokenResponse = await fetch("/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok) {
    throw new Error(`Token exchange failed: ${tokenData.error_description ?? tokenData.error ?? tokenResponse.status}`);
  }
  const { access_token } = tokenData;

  const auth = await discordSdk.commands.authenticate({ access_token });
  if (!auth) throw new Error("Authentication failed");

  return auth;
}

// ─── Socket.io setup ────────────────────────────────────────────────────────

function setupSocket(instanceId) {
  connectSocket();

  let _wasConnected = false;

  socket.on("connect", () => {
    console.log("[Socket] Connected:", socket.id);
    if (_wasConnected) {
      showToast("Reconnected!");
      hideReconnectBanner();
    }
    _wasConnected = true;

    // (Re-)join on connect/reconnect — also re-subscribes socket to correct rooms
    if (localUser) {
      socket.emit("join-game", {
        instanceId,
        userId: localUser.id,
        username: localUser.username,
        avatarUrl: localUser.avatarUrl,
        spectate: wantsSpectate,
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

  socket.on("kicked", ({ reason }) => {
    console.warn("[Socket] Kicked:", reason);
    appEl.innerHTML = `
      <div class="loading-screen" style="text-align:center;padding:32px">
        <h2 style="font-size:20px;margin-bottom:12px">Removed from game</h2>
        <p style="color:var(--text-muted)">${reason ?? 'You were removed by the host.'}</p>
      </div>
    `;
  });

  socket.on("disconnect", (reason) => {
    console.warn("[Socket] Disconnected:", reason);
    // Don't show banner for intentional disconnects (e.g. kicked)
    if (reason !== "io client disconnect") {
      showReconnectBanner();
    }
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
    const msg = err?.message ?? String(err);
    showError(`Failed to connect to Discord: ${msg}<br><br>Please close and reopen the activity.`);
  });
