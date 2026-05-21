<div align="center">

```
 █████╗ ██████╗  ██████╗ █████╗ ██████╗ ███████╗
██╔══██╗██╔══██╗██╔════╝██╔══██╗██╔══██╗██╔════╝
███████║██████╔╝██║     ███████║██║  ██║█████╗  
██╔══██║██╔══██╗██║     ██╔══██║██║  ██║██╔══╝  
██║  ██║██║  ██║╚██████╗██║  ██║██████╔╝███████╗
╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚═════╝ ╚══════╝
███████╗████████╗██████╗ ██╗██╗  ██╗███████╗
██╔════╝╚══██╔══╝██╔══██╗██║██║ ██╔╝██╔════╝
███████╗   ██║   ██████╔╝██║█████╔╝ █████╗  
╚════██║   ██║   ██╔══██╗██║██╔═██╗ ██╔══╝  
███████║   ██║   ██║  ██║██║██║  ██╗███████╗
╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝╚═╝  ╚═╝╚══════╝
```

**Real-time 1v1 PvP fighting game with on-chain wager economy**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20_LTS-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://typescriptlang.org)
[![Phaser](https://img.shields.io/badge/Phaser-3.70-orange)](https://phaser.io)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.24-lightgrey)](https://soliditylang.org)
[![Network: Polygon](https://img.shields.io/badge/Polygon-Mainnet-purple)](https://polygon.technology)

</div>

---

## ✨ Overview

ArcadeStrike is a production-ready browser-based 1v1 fighting game where players wager
real value on skill-based matches. Two players deposit equal stakes into a Solidity escrow
contract, fight a 30–60 second round, and the winner automatically receives the net pot —
no admin, no delay.

**Key properties:**
- **Server-authoritative** — no client cheating possible
- **Deterministic combat** — same inputs always produce same outputs  
- **On-chain settlement** — oracle-signed EIP-712 signature releases funds
- **Sub-5s matchmaking** — ELO-based queue with expanding range
- **Zero wallet friction** — embedded wallet for new users, MetaMask/WalletConnect for power users

---

## 🎮 Features

### Gameplay
- Real-time 1v1 PvP at 20 server ticks/second
- 3-input design (move · attack · special) — easy to learn, hard to master
- 2-hit combo system with 1.4× damage multiplier
- Best-of-3 rounds, 60 seconds per round
- Instant rematch system (mutual vote)
- Client-side prediction + server reconciliation for lag-free feel

### Economy
- **Real Credits** — USD-backed, deposited on-chain, fully withdrawable
- **Promo Credits** — awarded for watching ads, non-withdrawable, entry-level play
- 5% match fee (2% treasury + 3% ARCD token burn)
- $50/day loss limit enforced server-side
- $30 soft warning with in-game banner

### Web3
- Polygon network (low gas, fast finality)
- EIP-712 oracle-signed match results
- ReentrancyGuard + nonce replay protection on escrow
- SIWE (Sign In With Ethereum) authentication
- ERC-20 ARCD token with buyback-and-burn model

### Technical
- Colyseus binary delta state sync
- Anti-cheat: rate limiting, input validation, position sanity
- Pino structured logging
- JWT authentication
- Rate limiting (token bucket per IP and per user)
- Modular monorepo (npm workspaces)

---

## 🗂 Project Structure

```
arcadestrike/
├── apps/
│   ├── client/              Phaser 3 + Vite browser game
│   └── server/              Colyseus + Express game server
└── packages/
    ├── shared/              Shared TypeScript types & constants
    └── contracts/           Solidity smart contracts (Hardhat)
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full system design.  
See [`docs/GDD.md`](docs/GDD.md) for game design specification.

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Phaser 3.70, TypeScript, Vite |
| Game Server | Node.js 20, Colyseus 0.15, Express 4 |
| Shared Types | TypeScript (monorepo package) |
| Smart Contracts | Solidity 0.8.24, Hardhat, OpenZeppelin 5 |
| Web3 Client | ethers.js 6 |
| Auth | JWT + SIWE (Sign In With Ethereum) |
| Blockchain | Polygon (chain ID 137) |
| Logging | Pino |
| Package Manager | npm workspaces |

---

## ⚡ Prerequisites

- **Node.js** ≥ 20.0.0
- **npm** ≥ 10.0.0
- A **Polygon RPC endpoint** (free tier: [Alchemy](https://alchemy.com) or [Infura](https://infura.io))
- A funded deployer wallet (for contract deployment)
- Optional: [MetaMask](https://metamask.io) browser extension for testing

---

## 🚀 Local Setup

### 1. Clone & Install

```bash
git clone https://github.com/YOUR_ORG/arcadestrike.git
cd arcadestrike
npm install
```

### 2. Configure Server Environment

```bash
cp apps/server/.env.example apps/server/.env
```

Edit `apps/server/.env`:

```env
NODE_ENV=development
PORT=2567
CLIENT_ORIGIN=http://localhost:5173

# Generate a random 64-char hex string:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=your_64_char_secret_here

# Polygon RPC (get free key from alchemy.com)
RPC_URL=https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY

# Oracle: generate a fresh wallet for local dev
# node -e "const {ethers}=require('ethers'); const w=ethers.Wallet.createRandom(); console.log(w.privateKey, w.address)"
ORACLE_PRIVATE_KEY=0x_your_oracle_key
ORACLE_ADDRESS=0x_your_oracle_address

# After contract deployment (Step 5):
ESCROW_ADDRESS=0x_deployed_escrow
TOKEN_ADDRESS=0x_deployed_token

LOG_LEVEL=info
```

### 3. Configure Client Environment

```bash
cp apps/client/.env.example apps/client/.env
```

Edit `apps/client/.env`:

```env
VITE_WS_URL=ws://localhost:2567
VITE_API_URL=http://localhost:2567
VITE_CHAIN_ID=137
# Fill in after contract deployment:
VITE_ESCROW_CONTRACT=0x_deployed_escrow
VITE_TOKEN_CONTRACT=0x_deployed_token
```

### 4. Configure Contracts Environment

```bash
cp packages/contracts/.env.example packages/contracts/.env
```

Edit `packages/contracts/.env`:

```env
RPC_URL=https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY
DEPLOYER_PRIVATE_KEY=0x_your_deployer_key
ORACLE_ADDRESS=0x_your_oracle_address
TREASURY_ADDRESS=0x_your_treasury_address
POLYGONSCAN_API_KEY=your_key  # Optional, for contract verification
```

### 5. Build Shared Types

```bash
npm run build --workspace=packages/shared
```

### 6. Run Locally (Development)

```bash
# Run both server and client simultaneously
npm run dev

# Or individually:
npm run dev --workspace=apps/server   # http://localhost:2567
npm run dev --workspace=apps/client   # http://localhost:5173
```

Open **http://localhost:5173** in two browser tabs to test a full match.

The **Colyseus Monitor** (dev only) is available at: http://localhost:2567/colyseus

---

## 🔗 Smart Contract Deployment

### Compile Contracts

```bash
npm run compile:contracts
```

### Deploy to Mumbai Testnet (test first)

```bash
# Set RPC_URL to Mumbai in packages/contracts/.env
# RPC_URL=https://rpc-mumbai.maticvigil.com
# Chain ID: 80001 — get test MATIC from https://faucet.polygon.technology

cd packages/contracts
npx hardhat run scripts/deploy.ts --network mumbai
```

**Output example:**
```
Deploying with: 0xYourAddress...
ArcadeToken: 0xTokenAddress...
Escrow:       0xEscrowAddress...

Set these in your .env:
ESCROW_ADDRESS=0xEscrowAddress
TOKEN_ADDRESS=0xTokenAddress
```

### Deploy to Polygon Mainnet

```bash
cd packages/contracts
npx hardhat run scripts/deploy.ts --network polygon
```

### Verify Contracts (optional, for Polygonscan)

```bash
npx hardhat verify --network polygon 0xEscrowAddress \
  <ORACLE_ADDRESS> <TREASURY_ADDRESS> <TOKEN_ADDRESS>
```

### Update Environment Files

Copy the deployed addresses into:
- `apps/server/.env` → `ESCROW_ADDRESS`, `TOKEN_ADDRESS`
- `apps/client/.env` → `VITE_ESCROW_CONTRACT`, `VITE_TOKEN_CONTRACT`

---

## 🏗 Production Deployment

### Server → Railway

1. Create a new Railway project
2. Connect your GitHub repository
3. Set the root directory to `apps/server`
4. Add all environment variables from `apps/server/.env.example`
5. Add a Redis plugin to the Railway project (enables multi-instance)
6. Set `NODE_ENV=production`

**Railway build command:**
```
npm run build --workspace=apps/server
```

**Railway start command:**
```
node apps/server/dist/index.js
```

### Client → Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# From project root
vercel --cwd apps/client
```

Set environment variables in the Vercel dashboard (all `VITE_*` vars).

**Build settings:**
- Framework: Vite
- Build command: `npm run build`
- Output directory: `dist`

### Alternative: Docker (self-hosted)

A `Dockerfile` for the server:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
COPY packages/shared ./packages/shared
COPY apps/server ./apps/server
RUN npm install --workspace=packages/shared --workspace=apps/server
RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=apps/server
EXPOSE 2567
CMD ["node", "apps/server/dist/index.js"]
```

---

## 🧪 Testing

### Server Tests

```bash
npm run test --workspace=apps/server
```

### Contract Tests

```bash
cd packages/contracts
npx hardhat test
```

### Local Match Test (manual)

1. `npm run dev`
2. Open **two browser tabs** at `http://localhost:5173`
3. In each tab: click "Find Match" with the same wager amount
4. Both tabs should match, countdown, and fight

---

## 📡 API Reference

### Auth

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/auth/nonce?address=0x...` | Get SIWE nonce |
| `POST` | `/api/auth/verify` | Verify wallet signature → JWT |
| `POST` | `/api/auth/embedded` | Dev: embedded wallet auth |

### Wallet

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/wallet` | ✅ | Get balances + daily limits |
| `POST` | `/api/wallet/deposit/confirm` | ✅ | Confirm on-chain deposit |
| `POST` | `/api/wallet/withdraw` | ✅ | Request withdrawal |
| `POST` | `/api/wallet/ads/complete` | ✅ | Award promo credit (ad view) |

### Matchmaking

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/matchmaking/queue` | ✅ | Join queue |
| `DELETE` | `/api/matchmaking/queue` | ✅ | Leave queue |
| `GET` | `/api/matchmaking/status` | ✅ | Queue position |
| `POST` | `/api/matchmaking/accept` | ✅ | Accept match offer |

### Escrow

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/escrow/prepare` | ✅ | Get unsigned deposit tx |
| `POST` | `/api/escrow/confirm` | ✅ | Confirm tx on-chain |
| `GET` | `/api/escrow/match/:id` | ✅ | On-chain match status |
| `POST` | `/api/escrow/settle` | ✅ | Trigger settlement (server) |
| `GET` | `/api/escrow/history` | ✅ | Player escrow history |

### Stats

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/stats/player/:id` | - | Player profile + stats |
| `GET` | `/api/stats/leaderboard` | - | Top 100 by ELO |
| `GET` | `/api/stats/match/:id` | ✅ | Match record |
| `GET` | `/api/stats/economy` | - | Platform metrics |
| `PATCH` | `/api/stats/player/username` | ✅ | Set display name |

### WebSocket Messages

**Client → Server:**
```typescript
{ type: "INPUT",            payload: PlayerInput      }
{ type: "REMATCH_VOTE",     payload: { vote: boolean } }
{ type: "ESCROW_CONFIRMED", payload: { txHash: string }}
```

**Server → Client:**
```typescript
{ type: "STATE_SNAPSHOT" }   // Full state on join
{ type: "STATE_DELTA"    }   // Binary diff each tick
{ type: "MATCH_FOUND"    }   // Opponent located
{ type: "MATCH_START"    }   // Escrow locked, fight begins
{ type: "ROUND_END"      }   // Round result
{ type: "MATCH_END"      }   // Match result + oracle sig
{ type: "INPUT_ACK"      }   // Acknowledgment for reconciliation
{ type: "ORACLE_RESULT"  }   // On-chain settlement tx hash
{ type: "ERROR"          }   // Error codes
```

---

## ⚙️ Environment Variables Reference

### Server (`apps/server/.env`)

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | ✅ | `development` or `production` |
| `PORT` | ✅ | WebSocket + HTTP port (default: 2567) |
| `CLIENT_ORIGIN` | ✅ | CORS origin of frontend |
| `JWT_SECRET` | ✅ | 64+ char secret for JWT signing |
| `RPC_URL` | ✅ | Polygon JSON-RPC endpoint |
| `ORACLE_PRIVATE_KEY` | ✅ | Server oracle wallet private key |
| `ESCROW_ADDRESS` | ✅ | Deployed ArcadeStrikeEscrow address |
| `TOKEN_ADDRESS` | - | Deployed ArcadeToken address |
| `REDIS_URL` | - | Redis (required for multi-instance) |
| `LOG_LEVEL` | - | Pino log level (default: `info`) |

### Client (`apps/client/.env`)

| Variable | Required | Description |
|---|---|---|
| `VITE_WS_URL` | ✅ | Colyseus WebSocket URL |
| `VITE_API_URL` | ✅ | REST API base URL |
| `VITE_CHAIN_ID` | ✅ | Blockchain chain ID (137 = Polygon) |
| `VITE_ESCROW_CONTRACT` | ✅ | Deployed escrow address |
| `VITE_TOKEN_CONTRACT` | - | Deployed token address |
| `VITE_WALLETCONNECT_PROJECT_ID` | - | WalletConnect v2 project ID |

---

## 🔒 Security Notes

- **Never commit `.env` files** — add them to `.gitignore`
- **Oracle private key** — use AWS KMS or HashiCorp Vault in production; never store on disk
- **JWT secret** — rotate via env var without code changes
- **Contracts** — get an independent audit before handling real user funds at scale
- **Daily loss limits** — server-enforced only; client display is for UX only
- **Embedded wallets** — the current localStorage implementation is for development only; integrate [Privy](https://privy.io) or [Dynamic](https://dynamic.xyz) for production

---

## 🗺 Roadmap

### v1.0 (current)
- [x] 1v1 real-time combat, 20 tick server
- [x] Escrow smart contract with oracle settlement
- [x] Matchmaking queue with ELO
- [x] Off-chain economy (real + promo credits)
- [x] Daily loss limits
- [x] Anti-cheat layer
- [x] Embedded + MetaMask wallet support

### v1.1
- [ ] 3 additional arenas
- [ ] Fighter skin NFTs (cosmetic only)
- [ ] Seasonal leaderboards with prize pools
- [ ] WalletConnect v2 full integration
- [ ] Mobile-optimised touch controls

### v2.0
- [ ] Tournament brackets (4/8/16 player)
- [ ] ARCD token staking for match bonuses
- [ ] Spectator mode
- [ ] Replay system
- [ ] Additional character classes

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Commit with conventional commits: `git commit -m "feat: add tournament mode"`
4. Push and open a Pull Request

---

<div align="center">
Built with ⚡ by the ArcadeStrike team
</div>
