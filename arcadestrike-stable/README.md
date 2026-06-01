# ArcadeStrike

A real-time 1v1 competitive fighting game built with Phaser 3, Colyseus, Fastify, and PostgreSQL.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Game Client | Phaser 3 + TypeScript |
| Real-time Server | Colyseus (WebSocket) |
| HTTP API | Fastify |
| Database | PostgreSQL + Prisma |
| Cache | Redis (optional) |
| Monorepo | npm workspaces |

## Local Development

### Prerequisites
- Node.js 20+
- PostgreSQL 14+ running on port 5432
- (Optional) Redis on port 6379
- (Optional) Docker

### Quick Start with Docker
```bash
# Start PostgreSQL + Redis
docker-compose up -d

# Install dependencies
npm install

# Generate Prisma client + run migrations
npm run prisma:generate
npm run prisma:migrate:dev

# Start server + client
npm run dev
```

### Manual Setup
```bash
# 1. Create PostgreSQL database
psql -U postgres -c "CREATE DATABASE arcadestrike;"

# 2. Copy environment file
cp .env.example .env
# Edit .env with your DATABASE_URL

# 3. Install + generate
npm install
npm run prisma:generate
npm run prisma:migrate:dev

# 4. Run
npm run dev:server   # http://localhost:2567
npm run dev:client   # http://localhost:5173
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `REDIS_URL` | ❌ | — | Redis URL (graceful fallback if missing) |
| `PORT` | ❌ | 2567 | Server port |
| `JWT_SECRET` | ❌ | dev-secret | JWT signing key |
| `CLIENT_ORIGIN` | ❌ | http://localhost:5173 | CORS origin |
| `RPC_URL` | ❌ | — | Web3 RPC endpoint |
| `ESCROW_ADDRESS` | ❌ | — | Smart contract address |

## Game Controls

| Key | Action |
|-----|--------|
| ← → | Move |
| ↑ | Jump |
| Z | Attack |
| X | Block |

## Architecture

```
apps/
  server/          ← Fastify + Colyseus backend
    src/
      game/        ← ArcadeRoom, CombatEngine, AntiCheat
      matchmaking/ ← MMR-based queue
      economy/     ← Wallet + ledger
      withdrawals/ ← Async withdrawal processor
      replay/      ← Match replay storage
      infra/       ← Redis, health, metrics
      routes/      ← REST API
  client/          ← Phaser 3 game
    src/
      scenes/      ← Boot, Lobby, Queue, Fight, Result
      network/     ← Colyseus client wrapper
      game/        ← Sprites, input, prediction, FX

packages/
  shared/          ← Types + combat constants (shared)
  contracts/       ← Solidity smart contracts
```

## Deployment

See [Railway deployment](#railway) below.
