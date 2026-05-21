# ArcadeStrike — Technical Architecture Document
## Version 1.0

---

## 1. SYSTEM OVERVIEW

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         ARCADESTRIKE PLATFORM                           │
│                                                                         │
│  ┌──────────────┐     WebSocket      ┌──────────────────────────────┐  │
│  │              │ ◄─────────────────► │        GAME SERVER           │  │
│  │   BROWSER    │                     │   Node.js + Colyseus 0.15    │  │
│  │  (Phaser 3)  │     REST/HTTPS      │   Express + TypeScript       │  │
│  │  TypeScript  │ ◄─────────────────► │   20-tick authoritative sim  │  │
│  │              │                     └──────────────┬───────────────┘  │
│  └──────┬───────┘                                    │                  │
│         │                                            │                  │
│         │ ethers.js                      ┌───────────▼──────────┐      │
│         │ (wallet ops)                   │       REDIS           │      │
│         │                                │  Session + Queue +   │      │
│         ▼                                │  Pub/Sub (optional)  │      │
│  ┌──────────────┐                        └──────────────────────┘      │
│  │  BLOCKCHAIN  │ ◄────── Oracle Sig ─── Game Server                   │
│  │  (Polygon)   │                                                       │
│  │              │                        ┌──────────────────────┐      │
│  │  Escrow.sol  │                        │     POSTGRES (prod)  │      │
│  │  ARCD Token  │                        │  Player stats, ELO   │      │
│  └──────────────┘                        │  Match history       │      │
│                                          └──────────────────────┘      │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. REPOSITORY STRUCTURE

```
arcadestrike/                    ← Monorepo root (npm workspaces)
│
├── apps/
│   ├── client/                  ← Phaser 3 + Vite frontend
│   │   ├── src/
│   │   │   ├── scenes/          ← Phaser Scenes (Boot→Lobby→Queue→Fight→Result)
│   │   │   ├── game/            ← InputManager, ClientPredictor, FighterSprite, FXManager
│   │   │   ├── network/         ← NetworkManager (Colyseus WS client)
│   │   │   ├── ui/              ← HUD, mobile controls
│   │   │   └── web3/            ← WalletManager, EscrowClient (ethers.js)
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   └── .env                 ← VITE_ vars
│   │
│   └── server/                  ← Colyseus + Express backend
│       └── src/
│           ├── game/            ← ArcadeRoom, CombatEngine, GameState, AntiCheat, MatchStateMachine
│           ├── matchmaking/     ← MatchmakingQueue
│           ├── economy/         ← EconomyService (credits, daily limits)
│           ├── web3/            ← OracleService, EscrowWatcher
│           ├── middleware/      ← auth (JWT/SIWE), rateLimit
│           ├── routes/          ← auth, wallet, matchmaking, escrow, stats
│           └── utils/           ← logger (pino)
│
└── packages/
    ├── shared/                  ← Shared TypeScript types (server + client)
    │   └── src/index.ts         ← All types, constants, message contracts
    └── contracts/               ← Solidity smart contracts (Hardhat)
        ├── src/
        │   ├── ArcadeStrikeEscrow.sol
        │   └── ArcadeToken.sol
        └── scripts/deploy.ts
```

---

## 3. BACKEND ARCHITECTURE

### 3.1 Technology Stack

| Layer | Technology | Why |
|---|---|---|
| Runtime | Node.js 20 LTS | Async I/O, huge ecosystem |
| Language | TypeScript 5.3 | Full type safety with shared types |
| WebSocket framework | Colyseus 0.15 | Built-in delta serialization, room lifecycle |
| HTTP framework | Express 4 | Lightweight REST layer |
| Schema serialization | @colyseus/schema | Automatic binary delta-sync to clients |
| Logging | Pino | Structured JSON logs, low overhead |
| Auth | JWT (jsonwebtoken) + SIWE | Stateless, wallet-native |
| Blockchain | ethers.js 6 | Industry standard, ESM-ready |

### 3.2 Game Server (Colyseus ArcadeRoom)

```
ArcadeRoom lifecycle:
                                                     
  onCreate()                                         
    │ Register message handlers                      
    │ Create ArcadeGameState schema                  
    ▼                                                
  onJoin() × 2  (both players)                      
    │ Create FighterSchema for each player          
    │ On 2nd join: startGameLoop()                  
    ▼                                                
  [GAME LOOP] setInterval(tick, 50ms) = 20 ticks/s  
    │                                                
    │  tickCountdown() ──► phase = "fighting"        
    │                                                
    │  tickFighting()                                
    │    ├─ Drain inputBuffers                       
    │    ├─ CombatEngine.tick(fighters, inputs)      
    │    │    ├─ applyInput() per fighter            
    │    │    ├─ applyPhysics() per fighter          
    │    │    ├─ resolveAttack() bidirectional       
    │    │    └─ tickCooldowns()                     
    │    ├─ Check KO / timer expiry                  
    │    └─ Colyseus auto-broadcasts state delta     
    │                                                
  onLeave()                                          
    └─ Award forfeit win to remaining player         
    └─ endMatch() → OracleService.sign() → settle   
                                                     
  onDispose()                                        
    └─ clearInterval, cleanup                        
```

### 3.3 Simulation Loop

```
Server tick at T=0 (50ms interval):

  ┌─────────────────────────────────────────────┐
  │  1. DRAIN INPUT BUFFERS                      │
  │     For each player: pop 1 input from queue  │
  │                                              │
  │  2. ANTI-CHEAT VALIDATION                    │
  │     AntiCheat.validateInput()                │
  │     - Sequence number monotonic check        │
  │     - Rate: max 25 inputs/sec per player     │
  │     - Timestamp drift < 5000ms              │
  │                                              │
  │  3. COMBAT ENGINE TICK                       │
  │     CombatEngine.tick(fighters, inputs)      │
  │     - applyInput() → vel/intent              │
  │     - applyPhysics() → pos + collisions      │
  │     - resolveAttack() → damage + events      │
  │     - tickCooldowns() → reduce timers        │
  │                                              │
  │  4. STATE UPDATE                             │
  │     ArcadeGameState mutated in place         │
  │     Colyseus schema auto-diffs + broadcasts  │
  │     Binary delta serialized to each client  │
  │                                              │
  │  5. ROUND CHECK                              │
  │     KO detected? → handleRoundEnd()          │
  │     Timer = 0?  → HP comparison → winner     │
  └─────────────────────────────────────────────┘
```

### 3.4 Match State Machine

```
States and valid transitions:

  LOBBY ──────────────────────────────────────────────────────►  CANCELLED
    │                                                               ▲
    ▼                                                               │
  QUEUE ──────────────────────────────────────────────────────────►│
    │ both players matched                                          │
    ▼                                                               │
  MATCH_FOUND ─ (timeout 30s) ───────────────────────────────────►│
    │ both accept                                                   │
    ▼                                                               │
  ESCROW_LOCKING ─ (timeout 60s) ────────────────────────────────►│
    │ both deposits confirmed                                       │
    ▼                                                               │
  ESCROW_LOCKED                                                     │
    │ countdown complete                                            │
    ▼                                                               │
  FIGHTING ─ (timeout 60s max) ──────────────────────────────────►│
    │ KO or timer expiry                                            │
    ▼                                                               │
  RESULT                                                            │
    │ winner determined                                             │
    ▼                                                               │
  ORACLE_VERIFYING ─ (timeout 15s) ──────────────────────────────►│
    │ signature obtained                                            │
    ▼
  PAYOUT_COMPLETE
```

---

## 4. CLIENT ARCHITECTURE

### 4.1 Phaser 3 Scene Graph

```
Scenes (linear flow, one active at a time):

  BootScene
    │  Loads logo, initializes scale manager
    ▼
  PreloadScene
    │  Loads ALL assets: spritesheets, audio, UI
    │  Creates ALL animations (idle/walk/jump/attack/special/hit/dead)
    ▼
  LobbyScene
    │  Main menu: wallet connect, wager selection, currency toggle
    │  Draws: neon background, wager buttons, FIND MATCH button
    ▼
  QueueScene
    │  Joins queue via REST API (POST /api/matchmaking/queue)
    │  Listens for MATCH_FOUND via WebSocket
    │  Shows: animated spinner, position, cancel button
    ▼
  FightScene                          ← Primary gameplay scene
    │  FighterSprite ×2               ← Visual + animation layer
    │  InputManager                   ← Keyboard/touch capture
    │  ClientPredictor                ← Prediction + reconciliation
    │  HUD                            ← HP bars, timer, cooldowns
    │  FXManager                      ← Hit sparks, KO effects, BGM
    │  NetworkManager (singleton)     ← WS message routing
    ▼
  ResultScene
    │  Victory/defeat, score, payout info
    │  Rematch vote / back to lobby
    ▼
  (back to LobbyScene or FightScene for rematch)
```

### 4.2 Client Prediction & Reconciliation

```
Timeline (one player's perspective):

Client tick T:
  ┌─────────────────────────────────────────────────┐
  │  1. InputManager.sample()  → RawInput            │
  │  2. ClientPredictor.applyInput(myFighter, input) │
  │     → Immediately moves local fighter (0 lag)    │
  │  3. NetworkManager.sendInput({ seq: N, ...input })│
  │  4. Buffer input in pendingInputs[N]             │
  └─────────────────────────────────────────────────┘
                    │
          ~50-100ms later (network RTT)
                    │
Server processes T: ▼
  ┌─────────────────────────────────────────────────┐
  │  Server authoritative tick runs                  │
  │  Server state includes lastProcessedInput = N    │
  │  Colyseus broadcasts STATE delta                 │
  └─────────────────────────────────────────────────┘
                    │
          ~50-100ms later (return trip)
                    │
Client receives:    ▼
  ┌─────────────────────────────────────────────────┐
  │  onSnapshot(serverState)                         │
  │  ClientPredictor.reconcile(serverState):         │
  │    1. Copy server pos into predicted[myId]       │
  │    2. Re-apply pendingInputs where seq > N       │
  │    3. Result: position corrected + ahead by      │
  │       the inputs the server hasn't seen yet      │
  └─────────────────────────────────────────────────┘

Visual result: fighter moves immediately (no input lag),
mispredictions are corrected within 1 server RTT.
```

---

## 5. WEBSOCKET MESSAGE FLOW

### 5.1 Full Match Message Sequence

```
CLIENT                          SERVER                         BLOCKCHAIN
  │                               │                               │
  │─── POST /api/matchmaking/queue ──►                           │
  │◄── {status:"queued"} ─────────│                              │
  │                               │  [queue processing ~1-5s]    │
  │◄── MATCH_FOUND ───────────────│                              │
  │    {matchId, opponent,         │                              │
  │     escrowAddress, wagerAmt}  │                              │
  │                               │                              │
  │─── [user deposits wager] ─────────────────────────────────►  │
  │    sendPreparedTx(createMatch)│                createMatch() │
  │◄── {txHash} ──────────────────────────────────────────────── │
  │─── POST /api/escrow/confirm ──►                              │
  │◄── {status:"confirmed"} ──────│                              │
  │─── ESCROW_CONFIRMED ──────────►                              │
  │                               │ [both players confirmed]     │
  │◄── MATCH_START ───────────────│                              │
  │    {matchId, config}          │                              │
  │                               │ [3s countdown]              │
  │◄── STATE_SNAPSHOT ────────────│                              │
  │                               │                              │
  │   [FIGHT LOOP - 20 ticks/s]   │                              │
  │─── INPUT {seq, left/right...}─►                              │
  │◄── INPUT_ACK {seq, tick} ─────│                              │
  │◄── STATE_DELTA {fighters...} ─│                              │
  │─── INPUT ─────────────────────►                              │
  │◄── STATE_DELTA ───────────────│                              │
  │        [... repeats ~20/s ...]│                              │
  │                               │                              │
  │◄── MATCH_END ─────────────────│                              │
  │    {winnerId, payout,         │                              │
  │     oracleRequest, signature} │                              │
  │                               │─── settleMatch(sig) ──────► │
  │                               │                   distribute │
  │◄── ORACLE_RESULT ─────────────│◄─── MatchSettled event ───── │
  │    {txHash}                   │                              │
```

### 5.2 State Delta Format

Colyseus serializes schema changes as binary deltas automatically.
Only changed fields are sent each tick. Typical delta size per tick:

```
Full snapshot (first join):  ~800 bytes
Typical fight delta:          ~80 bytes  (pos × 2, vel × 2, hp × 2)
Idle delta (no movement):     ~20 bytes  (tick counter only)
```

---

## 6. BLOCKCHAIN INTERACTION FLOW

### 6.1 Escrow Contract Design

```
ArcadeStrikeEscrow.sol

  State: matches[bytes32 matchId] → Match struct
  
  Match.status enum:
    NONE → PENDING → LOCKED → SETTLED
                           → CANCELLED

  Key functions:
  ┌─────────────────────────────────────────────────────┐
  │  createMatch(matchId, player2, token, amount)        │
  │    Caller: Player 1                                  │
  │    Deposits: amount in MATIC or ERC-20               │
  │    Effect: match.status = PENDING                    │
  │    Timeout: 10 minutes or player1 can cancel         │
  ├─────────────────────────────────────────────────────┤
  │  joinMatch(matchId)                                  │
  │    Caller: Player 2 (must match stored address)      │
  │    Deposits: same amount as player 1                 │
  │    Effect: match.status = LOCKED                     │
  ├─────────────────────────────────────────────────────┤
  │  settleMatch(matchId, winner, loser, nonce, sig)     │
  │    Caller: Anyone (signature is oracle-verified)     │
  │    Verifies: EIP-712 signature from oracle key       │
  │    Verifies: nonce not used before                   │
  │    Distributes:                                      │
  │      winner ← 95% of pot                            │
  │      treasury ← 2% of pot                           │
  │      burn ← 3% of pot                               │
  │    Effect: match.status = SETTLED                    │
  ├─────────────────────────────────────────────────────┤
  │  cancelMatch(matchId)                                │
  │    PENDING: player1 refunded                         │
  │    LOCKED + oracle timeout: both refunded            │
  └─────────────────────────────────────────────────────┘
```

### 6.2 Oracle Signature Flow

```
Game Server (OracleService)

  1. Match ends → winnerId, loserId determined
  
  2. Build EIP-712 struct:
     MatchResult {
       bytes32 matchId
       address winner
       address loser
       uint256 wagerAmount
       bytes32 nonce          ← random, single-use
     }
  
  3. Hash with domain separator (from contract):
     digest = keccak256("\x19\x01" || domainSep || structHash)
  
  4. Sign with oracle private key:
     signature = oracleSigner.signMessage(digest)
  
  5. Broadcast MATCH_END to both clients with:
     { signature, nonce, oracleRequest }
  
  6. Auto-submit settleMatch() from oracle wallet
     (server-initiated, not client)
  
  7. Emit ORACLE_RESULT with txHash once mined

Replay protection:
  - nonce is random bytes32, stored in usedNonces mapping
  - Second submission with same nonce reverts immediately
  - matchId is also checked: settled match cannot be re-settled
```

---

## 7. ANTI-CHEAT DESIGN

### 7.1 Threat Model

```
┌─────────────────┬──────────────────────────────────────────┐
│ Attack           │ Server Defense                           │
├─────────────────┼──────────────────────────────────────────┤
│ Speed hack       │ Physics runs server-side. Client sends   │
│ (move faster)    │ intent only (left/right/jump/atk/spc).  │
│                  │ Server computes position. Client cannot  │
│                  │ teleport.                                │
├─────────────────┼──────────────────────────────────────────┤
│ Input injection  │ Rate limit: max 25 inputs/sec tracked   │
│ (spam attacks)   │ per player. Exceeding = rejection + ban │
│                  │ accumulation counter.                    │
├─────────────────┼──────────────────────────────────────────┤
│ Replay attack    │ Input seq numbers are monotonically     │
│ (replay old seq) │ increasing per session. Old seq = drop. │
├─────────────────┼──────────────────────────────────────────┤
│ HP manipulation  │ HP lives only in ArcadeGameState on     │
│ (client memory)  │ server. Client receives HP via WS delta │
│                  │ read-only. Client HP state = display.   │
├─────────────────┼──────────────────────────────────────────┤
│ Double spend     │ Smart contract enforces escrow. Cannot  │
│                  │ claim winnings twice (nonce + status).  │
├─────────────────┼──────────────────────────────────────────┤
│ Result forging   │ EIP-712 oracle signature required.      │
│                  │ Only oracle private key can produce it. │
│                  │ Client has no access to oracle key.     │
├─────────────────┼──────────────────────────────────────────┤
│ Timestamp drift  │ Client timestamp in input validated:    │
│ (fake timing)    │ must be within ±5000ms of server time.  │
├─────────────────┼──────────────────────────────────────────┤
│ Bot (macro input)│ Rate limiter + violation accumulator.  │
│                  │ 10 violations = soft ban in session.    │
└─────────────────┴──────────────────────────────────────────┘
```

### 7.2 Violation Accumulation

```
AntiCheat per player:
  violations[]       — history of AntiCheatViolation records
  
  Severity thresholds:
    1-3  violations:  silent log
    4-9  violations:  rate-limited response to client
    10+  violations:  isBanned() = true → all inputs rejected
  
  Ban is session-scoped (room lifetime).
  Persistent bans require separate ban system (out of v1 scope).
```

---

## 8. ECONOMY SYSTEM DESIGN

### 8.1 Off-chain vs On-chain Credits

```
┌────────────────────────────────────────────────────────────┐
│  OFF-CHAIN LEDGER (EconomyService — Redis/PostgreSQL)       │
│                                                            │
│  PlayerWallet {                                            │
│    realCredits:   "19000000000000000000"  // $19 in wei   │
│    promoCredits:  "500000000000000000"    // $0.50        │
│    dailyLossUsed: "5000000000000000000"   // $5 today     │
│    dailyLossDate: "2025-01-15"                            │
│  }                                                         │
│                                                            │
│  Promo credits:                                            │
│    Source: ad views, sign-up bonus                        │
│    Use: matchmaking only (promo queue)                    │
│    Cannot: be withdrawn, combined with real credits       │
│                                                            │
│  Real credits:                                             │
│    Source: on-chain deposit (MATIC/USDC → server credits) │
│    Use: all queues + withdrawal                           │
│    Withdrawal: min $5, queued for treasury transfer       │
└────────────────────────────────────────────────────────────┘
                          │
                          │ lockWager() before match
                          │ settleMatch() after result
                          │ refundMatch() on cancel
                          ▼
┌────────────────────────────────────────────────────────────┐
│  ON-CHAIN ESCROW (ArcadeStrikeEscrow.sol — Polygon)        │
│                                                            │
│  Real-money matches: both players deposit on-chain         │
│  Promo matches: no on-chain interaction (server credits)  │
│  Settlement: oracle signature → automatic distribution    │
└────────────────────────────────────────────────────────────┘
```

### 8.2 Daily Loss Limit Enforcement

```
Every lockWager() call checks:

  today = UTC date string
  if wallet.dailyLossDate != today:
    reset wallet.dailyLossUsed = 0

  projectedLoss = dailyLossUsed + wagerAmount

  if projectedLoss > DAILY_LOSS_LIMIT ($50):
    throw EconomyError("DAILY_LOSS_LIMIT_REACHED")
    → REST returns 403, client shows modal

  if projectedLoss > DAILY_LOSS_WARNING ($30):
    log warning
    → Server sends ERROR{code:"DAILY_LOSS_WARNING"} via WS

  On match loss: dailyLossUsed += wagerAmount
  On match win:  dailyLossUsed unchanged (wins don't offset)

Enforcement: SERVER ONLY — client display is convenience UX.
Client cannot bypass this by modifying JavaScript.
```

---

## 9. SCALABILITY STRATEGY

### 9.1 Vertical Scaling (Single Instance)

A single Node.js Colyseus server can handle approximately:
- **~500 concurrent WebSocket connections**
- **~100 active game rooms** (50 concurrent matches)
- **~2000 ticks/sec** aggregate simulation load

Adequate for: 0–50k registered users, ~500 DAU playing simultaneously.

### 9.2 Horizontal Scaling (Multi-Instance)

For >500 concurrent players:

```
┌─────────────────────────────────────────────────────────────┐
│  LOAD BALANCER (sticky sessions by roomId)                  │
│  Nginx / AWS ALB / Cloudflare                               │
└────────────────┬────────────────────────────────────────────┘
                 │
        ┌────────┴────────┐
        ▼                 ▼
┌──────────────┐  ┌──────────────┐  ...N instances
│  Game Server │  │  Game Server │
│   Instance 1 │  │   Instance 2 │
└──────┬───────┘  └──────┬───────┘
       │                 │
       └────────┬────────┘
                ▼
       ┌─────────────────┐
       │  REDIS CLUSTER  │  ← Colyseus RedisDriver + RedisPresence
       │                 │  ← Matchmaking queue (atomic Lua scripts)
       │                 │  ← Session state
       └─────────────────┘
```

**Requirements for horizontal scale:**
1. Enable `RedisDriver` + `RedisPresence` in Colyseus (env: `REDIS_URL`)
2. Replace in-memory `Map<>` stores in `EconomyService` and `StatsService`
   with Redis + PostgreSQL
3. Use sticky sessions (nginx `ip_hash` or cookie-based) to route WS reconnects
   to the correct instance

### 9.3 Database Schema (Production PostgreSQL)

```sql
-- Players
CREATE TABLE players (
  id            TEXT PRIMARY KEY,
  address       TEXT UNIQUE,
  username      TEXT UNIQUE,
  elo           INTEGER DEFAULT 1200,
  wins          INTEGER DEFAULT 0,
  losses        INTEGER DEFAULT 0,
  win_streak    INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  last_active   TIMESTAMPTZ DEFAULT NOW()
);

-- Wallets (off-chain credits)
CREATE TABLE wallets (
  player_id       TEXT PRIMARY KEY REFERENCES players(id),
  real_credits    NUMERIC(78,0) DEFAULT 0,  -- stored as wei
  promo_credits   NUMERIC(78,0) DEFAULT 0,
  daily_loss_used NUMERIC(78,0) DEFAULT 0,
  daily_loss_date DATE DEFAULT CURRENT_DATE
);

-- Match records
CREATE TABLE matches (
  match_id     TEXT PRIMARY KEY,
  player1_id   TEXT REFERENCES players(id),
  player2_id   TEXT REFERENCES players(id),
  winner_id    TEXT REFERENCES players(id),
  wager_amount NUMERIC(78,0),
  currency     TEXT CHECK (currency IN ('REAL','PROMO')),
  scores       JSONB,
  duration_ms  INTEGER,
  tx_hash      TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Index for leaderboard queries
CREATE INDEX idx_players_elo ON players(elo DESC);
CREATE INDEX idx_matches_player ON matches(player1_id, player2_id);
```

### 9.4 Deployment Topology

```
PRODUCTION TOPOLOGY

  ┌──────────────────────────────────────┐
  │  Vercel (or Netlify)                 │
  │  Static: apps/client/dist/           │
  │  Edge CDN global                     │
  └────────────────┬─────────────────────┘
                   │ wss:// + https://
                   ▼
  ┌──────────────────────────────────────┐
  │  Railway (or Fly.io / AWS ECS)       │
  │  Docker: apps/server/                │
  │  NODE_ENV=production                 │
  │  Scale: 1 → N replicas              │
  └────────────┬─────────────────────────┘
               │
  ┌────────────▼────────────┐   ┌─────────────────────┐
  │  Redis (Railway plugin)  │   │  PostgreSQL          │
  │  Session + Queue         │   │  (Railway plugin)    │
  └──────────────────────────┘   └─────────────────────┘
```

---

## 10. SECURITY CHECKLIST

- [x] JWT secret rotatable via env var (never hardcoded)
- [x] SIWE nonces are single-use and expire in 5 minutes
- [x] Oracle private key read from env only (HSM in production)
- [x] Rate limiting on all REST endpoints (token bucket per IP)
- [x] Daily loss limit enforced server-side only
- [x] Input validation via Zod on all REST body params
- [x] HP, position, and combat state owned exclusively by server
- [x] EIP-712 replay protection via on-chain nonce map
- [x] Contract uses ReentrancyGuard on all state-changing functions
- [x] Safe ERC-20 transfer via OpenZeppelin SafeERC20
- [x] CORS restricted to configured CLIENT_ORIGIN
- [x] Security headers: X-Content-Type-Options, X-Frame-Options, HSTS
- [ ] TODO: Persistent ban list (Redis blacklist)
- [ ] TODO: WebSocket TLS certificate pinning
- [ ] TODO: KMS-backed oracle key (AWS KMS or HashiCorp Vault)
- [ ] TODO: Smart contract audit before mainnet launch

---

*Document maintained by: ArcadeStrike Engineering*
*Architecture version: 1.0.0*
