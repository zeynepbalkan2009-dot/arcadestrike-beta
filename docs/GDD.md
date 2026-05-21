# ARCADESTRIKE — Game Design Document (GDD)
## Version 1.0 | Revision: Production

---

## 1. EXECUTIVE SUMMARY

**ArcadeStrike** is a browser-based 1v1 real-time PvP fighting game with an integrated
wager economy. Two players meet online, lock equal-stakes bets into a smart contract
escrow, and fight a 30–60 second match. The winner automatically receives the net pot;
the smart contract settles on-chain without any admin intervention.

**Core Loop:** Join → Wager → Fight → Win → Earn → Repeat

---

## 2. VISION & PILLARS

| Pillar | Expression |
|---|---|
| **Instant** | Match in <5s, fight starts in 3s, result in 60s |
| **Skill-based** | No RNG in combat. Outcome = pure player skill |
| **Fair** | Server-authoritative. No client cheating possible |
| **Low barrier** | No wallet required to try (promo credits + embedded wallet) |
| **Real stakes** | Wagers backed by on-chain escrow. Oracle-verified payouts |

---

## 3. TARGET AUDIENCE

- **Primary**: Competitive mobile/PC gamers aged 18–34 who already engage with
  crypto/NFTs and want skill-based wagering.
- **Secondary**: Casual gamers who discover the game via promo credits (from ad views)
  and gradually transition to real-money play.

---

## 4. GAMEPLAY

### 4.1 Match Format
- **Format**: Best-of-3 rounds, first to 2 rounds wins the match
- **Round timer**: 60 seconds per round
- **Countdown**: 3-second countdown before each round
- **Rematch**: Instant rematch button post-match (mutual vote required)

### 4.2 Controls (3-input design)
The control scheme is intentionally minimal — easy to learn in 10 seconds,
deep mastery curve from combo timing and positioning.

| Input | Key (PC) | Touch | Description |
|---|---|---|---|
| **Move** | ← → / A D | D-Pad | Walk left/right |
| **Jump** | ↑ / W | ↑ button | Leaves ground, avoids low attacks |
| **Attack** | Z | ATK button | Fast hit (12 dmg, 0.7s cooldown) |
| **Special** | X | SPL button | Powerful hit (22 dmg, 3s cooldown) |

### 4.3 Combat System

**Damage Values:**
- Normal Attack: 12 HP
- Special Attack: 22 HP
- Combo (2nd hit within 1s): ×1.4 multiplier

**Fighter Stats (per round):**
- HP: 100
- Stun on hit: 8 ticks (~0.4s)
- Knockback: 10 units + small airborne state

**Win Condition:**
- Reduce opponent HP to 0 (KO), OR
- Have more HP when round timer expires (time decision)

### 4.4 Combo System
- Max 2-hit combos (intentional — prevents un-fun infinite strings)
- Combo window: 1 second (20 ticks) between hits
- Combo damage: 1.4× multiplier on second hit
- Visual: yellow "2x COMBO!" floating text + particle burst

### 4.5 Arena
- **Dimensions**: 800 × 400 px logical units
- **Ground**: Single flat platform (no platforms/walls — focus on head-to-head)
- **Boundaries**: Screen edges are hard walls
- **Future**: Multiple arena variants (moving platforms, hazard zones) in v1.1

---

## 5. ECONOMY

### 5.1 Credit Types

| Type | Source | Withdrawable | Use |
|---|---|---|---|
| **Real Credit** | On-chain deposit (MATIC/USDC) | ✅ Yes | Real-money wagers |
| **Promo Credit** | Ad views, sign-up bonus | ❌ No | Practice wagers only |

### 5.2 Wager Tiers

| Tier | Wager | Min ELO | Notes |
|---|---|---|---|
| Bronze | $0.50 | Any | New player tier |
| Silver | $1.00 | Any | Default queue |
| Gold | $5.00 | 1100+ | Mid-level |
| Diamond | $10.00 | 1300+ | High stakes |
| Elite | $25.00 | 1500+ | Top players only |

### 5.3 Fee Structure
Every wager pool has a 5% fee:

```
Total Pot = wager × 2
Fee       = pot × 5%
  → Treasury:  2% (operating fund)
  → Burn:      3% (ARCD token buyback & burn)
Winner receives: pot - fee (95% of total pot)
```

**Example (both wager $10):**
- Total pot: $20
- Fee: $1 (50¢ treasury + 75¢ burned)
- Winner receives: $19

### 5.4 Daily Loss Limit
- **Hard limit**: $50 per calendar day (UTC midnight reset)
- **Soft warning**: At $30 loss — banner displayed in-game
- **Enforcement**: Server-side only — client display is for UX only
- **Scope**: Only Real Credits count toward limit. Promo Credits are excluded.

### 5.5 Ads → Promo Credits
- Watch a 30-second rewarded ad → receive $0.10 promo credit
- Max 5 ad views per day (anti-farming)
- Promo credits visible in wallet but marked non-withdrawable
- Can only enter promo-only queue matchmaking

---

## 6. MATCH LIFECYCLE

```
LOBBY
  │
  ▼ Player clicks "Find Match"
QUEUE (balance locked, ELO matching)
  │
  ▼ Opponent found (<5s target)
MATCH_FOUND (30s to accept)
  │
  ▼ Both players accept
ESCROW_LOCKING (60s window)
  ├── Real Credits: on-chain deposit from both players
  └── Promo Credits: off-chain lock (instant)
  │
  ▼ Both deposits confirmed
ESCROW_LOCKED
  │
  ▼ 3-second countdown
FIGHTING (up to 60s)
  │
  ▼ KO or timer expires
RESULT (winner determined server-side)
  │
  ▼ Server oracle signs result
ORACLE_VERIFYING (15s)
  │
  ▼ Settlement submitted on-chain
PAYOUT_COMPLETE
  └── Winner credited instantly (off-chain first, on-chain async)
```

**Cancellation paths:**
- Player doesn't accept match offer → CANCELLED after 30s (no penalty)
- Player 2 doesn't deposit → CANCELLED after 60s (Player 1 refunded)
- Oracle timeout → CANCELLED (both refunded from contract)
- Player disconnects mid-fight → Opponent wins by forfeit

---

## 7. MATCHMAKING

**Algorithm:** Wager-amount + ELO bracket matching

1. Players join queue specifying wager amount + currency
2. Queue matches exact wager amounts
3. ELO range starts at ±100, expands by ±50 per second of wait
4. Maximum ELO range: ±500 (after ~8s wait, you can match anyone)
5. Estimated wait target: <5 seconds

**ELO System:**
- Starting ELO: 1200
- K-factor: 32 (standard)
- Decay: None (no offline ELO decay in v1.0)

---

## 8. WEB3 INTEGRATION

### 8.1 Smart Contract (ArcadeStrikeEscrow)
- Network: Polygon (Matic) — low fees, fast finality
- Standard: Solidity 0.8.24, OpenZeppelin 5.x
- Pattern: Oracle-settled escrow (EIP-712 signed results)
- Replay protection: Used nonce map on-chain
- Timeout: 10min match acceptance, 5min oracle settlement

### 8.2 Oracle Design
- Off-chain oracle = the game server's private key (HSM-backed in prod)
- Signs match results using EIP-712 structured data
- Signature submitted to contract → funds distributed automatically
- No admin multi-sig needed for normal operations

### 8.3 Token (ARCD)
- ERC-20, max supply 1 billion
- 3% of all wager fees → token contract (burn via `burnHeld()`)
- Creates deflationary pressure with game activity
- Not required for gameplay in v1.0 (optional hold for future benefits)

### 8.4 Wallet UX
- **Embedded wallet first**: Generated browser key, no extension needed
- **MetaMask**: Auto-detected injected provider
- **WalletConnect**: For mobile wallets
- Auth: SIWE (Sign In With Ethereum) — EIP-4361 standard

---

## 9. ANTI-CHEAT & SECURITY

| Threat | Mitigation |
|---|---|
| Speed hacking | Server-authoritative: server ignores impossible position jumps |
| Input injection | Rate limit: max 25 inputs/sec validated server-side |
| Replay attacks | Monotonic input sequence numbers, nonce on oracle sig |
| Double spend | On-chain escrow: smart contract prevents double-spend atomically |
| Result manipulation | Oracle signature required: only server key can settle |
| Bot farming | Anti-cheat violation log + auto-ban at 10 violations |
| Client memory edit | Server owns all HP/position state. Client is render-only |

---

## 10. PROGRESSION (v1.1 roadmap)

- **Fighter skins** (cosmetic NFTs, no gameplay advantage)
- **Seasonal leaderboards** with prize pools
- **Tournament mode** (bracket, higher stake pools)
- **Additional arenas** (3 planned: Neon City, Desert, Space Station)
- **Character abilities** (unlock alternate special via token staking)

---

## 11. KPIs

| Metric | Target |
|---|---|
| Session length | 8–15 minutes |
| Matches per session | 3–6 |
| Daily active users (DAU) target | 500 (month 1), 10k (month 6) |
| Average wager | $3–5 |
| Daily wagered volume | $50k (at 10k DAU) |
| Matchmaking wait | <5 seconds (p50) |
| Match server latency | <100ms (p95) |

---

*Document maintained by: ArcadeStrike Core Team*
*Last updated: 2025*
