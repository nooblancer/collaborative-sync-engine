# Collaborative Sync Engine

A distributed real-time collaboration engine using **CRDTs** (Conflict-free Replicated Data Types) for multiplayer state synchronization. Built with Node.js and TypeScript.

## What It Does

Multiple users can simultaneously edit shared state (like an inventory list) without conflicts. The engine guarantees **strong eventual consistency** — all replicas converge to the same state regardless of operation order or network delays.

Key capabilities:
- **Real-time sync** — Operations propagate to all clients within 200ms
- **Offline support** — Clients queue operations locally and reconcile on reconnect (up to 10,000 ops)
- **Automatic conflict resolution** — LWW-Element-Set with Hybrid Logical Clock timestamps
- **Remove-wins semantics** — Concurrent remove + update always results in removal
- **Presence tracking** — See who's online in real-time
- **JWT authentication** — Secure WebSocket connections with token refresh

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Client A   │     │  Client B   │     │  Client N   │
│ Local State │     │ Local State │     │ Local State │
│   + Queue   │     │   + Queue   │     │   + Queue   │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │ WebSocket         │ WebSocket         │ WebSocket
       └───────────────────┼───────────────────┘
                           │
              ┌────────────┴────────────┐
              │   Connection Manager    │
              │  (Auth, Heartbeat,      │
              │   Presence, Routing)    │
              └────────────┬────────────┘
                           │
              ┌────────────┴────────────┐
              │      Sync Engine        │
              │  (Validate → Merge →    │
              │   Persist → Broadcast)  │
              └────────────┬────────────┘
                           │
              ┌────────────┴────────────┐
              │   Persistence Layer     │
              │  PostgreSQL + Redis     │
              └─────────────────────────┘
```

## Quick Start

```bash
# Install dependencies
npm install

# Run tests (268 tests, all passing)
npm test

# Run the interactive demo (opens in browser)
npx tsx demo-frontend.ts
# Then open http://localhost:4567 in multiple tabs

# Run the CLI demo
npx tsx demo.ts

# Build for production
npm run build

# Start the server
npm start
```

## Demo

The interactive demo shows real-time collaboration:

```bash
npx tsx demo-frontend.ts
```

Open `http://localhost:4567` in **multiple browser tabs**. Each tab gets a random user identity. Add, update, and remove inventory items — changes appear instantly across all tabs.

## Configuration

Environment variables (all optional):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 8080 | Server port |
| `JWT_SECRET` | development-secret | JWT signing secret |
| `MAX_CONNECTIONS_PER_SESSION` | 50 | Max concurrent WebSocket connections |
| `HEARTBEAT_INTERVAL_MS` | 30000 | Ping interval (≤30s) |
| `HEARTBEAT_TIMEOUT_MS` | 10000 | Pong timeout before disconnect |
| `SNAPSHOT_INTERVAL_MS` | 600000 | State snapshot interval (≤10min) |
| `DATABASE_URL` | — | PostgreSQL connection string (in-memory if not set) |
| `REDIS_URL` | — | Redis connection string (in-memory if not set) |

## Project Structure

```
src/
├── types/          # TypeScript interfaces (CRDTState, operations, etc.)
├── engine/         # CRDT merge logic, HLC, validation, delta, sync coordinator
├── connection/     # WebSocket server, auth, heartbeat, presence, routing
├── persistence/    # PostgreSQL ops log, Redis cache, snapshots
├── client/         # Client SDK (local replica, queue, serialization)
└── index.ts        # Server entry point
```

## CRDT Properties (Verified by Property-Based Tests)

The engine's correctness is validated by 21 property-based tests using [fast-check](https://github.com/dubzzz/fast-check):

| # | Property | What it proves |
|---|----------|---------------|
| 1 | Merge Commutativity | Order of operations doesn't matter |
| 2 | Merge Associativity | Grouping of operations doesn't matter |
| 3 | Merge Idempotence | Duplicate operations have no effect |
| 4 | Deterministic Conflict Resolution | Same inputs always produce same winner |
| 5 | Invalid Operation Rejection | Bad ops never corrupt state |
| 6 | Queue Order Preservation | Offline ops maintain generation order |
| 7 | Queue Persistence Round-Trip | Persisted queue restores identically |
| 8 | Offline Queue Capacity | Holds 10,000 ops without loss |
| 9 | ACK-Based Queue Removal | Only acknowledged ops are removed |
| 10 | Reconnection Transmission Cap | Max 1000 ops sent on reconnect |
| 11 | Partial Batch Merge | Valid ops merge, invalid skip |
| 12 | Delta Broadcast Minimality | Only changed fields are broadcast |
| 13 | Missed Update Queue Integrity | Queued deltas preserve order |
| 14 | State Recovery via Replay | Snapshot + replay = full replay |
| 15 | Remove Wins Over Concurrent Update | Remove always wins |
| 16 | Inventory Item Validation | Name/quantity constraints enforced |
| 17 | Serialization Round-Trip | Serialize→deserialize is lossless |
| 18 | Incoming Operation Application | Remote ops update state correctly |
| 19 | API Translation Correctness | SDK produces valid operations |
| 20 | Presence Data Integrity | Presence list is accurate |
| 21 | Authentication Error Classification | Token errors are typed correctly |

## Tech Stack

- **Runtime**: Node.js + TypeScript (ES2022, Node16 modules)
- **WebSocket**: `ws`
- **Auth**: `jsonwebtoken` (JWT)
- **Database**: PostgreSQL via `pg` (with in-memory fallback)
- **Cache**: Redis via `ioredis` (with in-memory fallback)
- **Testing**: Vitest + fast-check (property-based testing)
- **UUID**: `uuid` (v4)

## License

MIT
