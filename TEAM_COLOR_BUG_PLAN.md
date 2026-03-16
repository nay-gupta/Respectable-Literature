# Team Color Mismatch Bug — Analysis Plan

## Bug Report
Player joins Team A in the lobby, but is shown with Team B colors during the game.

---

## Root Cause

**`startGame` always reshuffles teams when `teamsLocked` is `false` (the default).**

### Trace

1. Player clicks **Join Team A** in the lobby → `switch-team` emitted → server sets `player.teamIndex = 0`.
2. Host clicks **▶ Start Game** → server calls `startGame(gameState)`.
3. Inside `startGame` (`gameEngine.js` line 123):
   ```js
   if (!gameState.settings?.teamsLocked) {
     assignTeams(gameState);   // ← always fires with default settings
   }
   ```
4. `assignTeams` (`gameEngine.js` line 100–112):
   ```js
   const shuffled = [...gameState.players].sort(() => Math.random() - 0.5);
   gameState.teams = [[], []];
   shuffled.forEach((player, i) => {
     player.teamIndex = i % 2;   // ← overwrites lobby choice
     gameState.teams[i % 2].push(player.id);
   });
   gameState.players = shuffled;
   ```
   Every lobby `teamIndex` is discarded and randomly reassigned.

5. `getPublicState` sends the reshuffled `teamIndex` values to clients.
6. `cameraTile.js` renders border color from `player.teamIndex`:
   - `0` → `tile-team-a` (blue border)
   - `1` → `tile-team-b` (red border)

Because `teamsLocked` defaults to `false`, the shuffle fires **every game start** regardless of what players chose.

---

## Files Involved

| File | Relevant Location | Role |
|------|------------------|------|
| `server/game/gameEngine.js` | `createGame` (line 28), `assignTeams` (line 100), `startGame` (line 123) | Bug origin |
| `client/src/ui/lobby.js` | `canStart`, settings toggle | UI for teamsLocked |
| `client/src/ui/cameraTile.js` | `teamClass` conditional (line ~20) | Renders team color |

---

## Fix Options

### Option A — Change the default: `teamsLocked: true` ✅ (recommended)

**What changes:**
- `createGame` in `gameEngine.js`: change `teamsLocked: false` → `teamsLocked: true`.
- Update the lobby's settings checkbox default to match.

**Behaviour after fix:**
- Players join a team in the lobby; those choices are respected at game start.
- Validation still enforces equal team sizes before start (already implemented).
- **Shuffle Teams** button still works for random assignment any time before start.
- Host can still toggle `teamsLocked` off to auto-shuffle on start if desired.

**Risk:** Low. The lobby already has Join A / Join B buttons and a Shuffle button; "locked by default" is the intuitive interpretation of those controls.

---

### Option B — Auto-detect: skip `assignTeams` when all players are already assigned

**What changes:**
- Inside `startGame`, before calling `assignTeams`, check if every player already has a valid `teamIndex`.
  ```js
  const allAssigned = gameState.players.every(p => p.teamIndex === 0 || p.teamIndex === 1);
  if (!gameState.settings?.teamsLocked && !allAssigned) {
    assignTeams(gameState);
  }
  ```

**Behaviour after fix:**
- If players manually joined teams, those are respected.
- If nobody picked teams (all `null`), `assignTeams` still fires as before.

**Risk:** Medium. Introduces implicit branching; could lead to unequal teams going undetected if only some players picked sides. Also requires adding the equal-size validation for the non-locked path.

---

### Option C — Remove `teamsLocked` entirely; always respect lobby choices (breaking)

Not recommended — the shuffle-on-start behaviour may be intentional for quick games where nobody wants to manually assign.

---

## Recommended Fix (Option A)

### `server/game/gameEngine.js`
Change line 28:
```js
// Before
teamsLocked: false,

// After
teamsLocked: true,
```

### `client/src/ui/lobby.js`
Locate the settings panel checkbox for `teamsLocked` and flip its default checked state from `false` to `true`, or update wherever the initial state is initialised.

That is the entirety of the change. Both files are minor one-line edits.

---

## Verification Steps

1. Start a lobby, have players join Team A and Team B manually.
2. Start the game without using Shuffle Teams.
3. Confirm each player's camera tile border matches the team they chose.
4. Optionally: toggle `teamsLocked` off in settings, start again — confirm random assignment still works.
5. Confirm `canStart` validation still blocks start when teams are unequal.
