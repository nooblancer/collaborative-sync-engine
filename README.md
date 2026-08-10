# Collaborative Sync Engine

A distributed real-time collaboration engine using **CRDTs** (Conflict-free Replicated Data Types) for multiplayer state synchronization. Full-stack monorepo with a Node.js/TypeScript backend and a Next.js 14 frontend.

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
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (Next.js 14)                     │
│  Landing Page (RSC) │ Demo App (Client Component)            │
│                     │  useWebSocket → usePresence            │
│                     │  useInventory → EventLog               │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP /token + WebSocket
┌──────────────────────────────┴──────────────────────────────┐
│                    Backend (Node.js)                          │
│  Token Endpoint → Connection Manager → Sync Engine           │
│                   (Auth, Heartbeat,    (Validate, Merge,     │
│                    Presence, Routing)   Persist, Broadcast)   │
│                                              │               │
│                              Persistence Layer               │
│                          PostgreSQL + Redis                   │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# Install all dependencies
npm run install:all

# Run both backend and frontend in development
npm run dev

# Or run them separately:
npm run dev:backend    # Backend on http://localhost:8080
npm run dev:frontend   # Frontend on http://localhost:3000
```

Then open **http://localhost:3000** in your browser. The landing page describes the engine; click "Launch Demo" to open the interactive collaborative inventory app.

Open the demo in **multiple browser tabs** to see real-time collaboration — each tab gets a random user identity.

## Project Structure

```
collaborative-sync-engine/
├── backend/                    # Node.js + TypeScript CRDT engine
│   ├── src/
│   │   ├── types/             # TypeScript interfaces
│   │   ├── engine/            # CRDT merge, HLC, validation, delta
│   │   ├── connection/        # WebSocket server, auth, heartbeat, presence
│   │   ├── persistence/       # PostgreSQL, Redis cache, snapshots
│   │   ├── client/            # Client SDK (local replica, queue)
│   │   └── index.ts           # Server entry point (/token + WebSocket)
│   ├── package.json
│   └── tsconfig.json
├── frontend/                   # Next.js 14 App Router
│   ├── app/
│   │   ├── page.tsx           # Landing page (Server Component)
│   │   ├── demo/page.tsx      # Interactive demo (Client Component)
│   │   ├── layout.tsx         # Root layout (fonts, theme)
│   │   └── globals.css        # Tailwind + CSS variables
│   ├── components/
│   │   ├── ui/                # Button, Badge, Card, Input, Table
│   │   ├── landing/           # Navbar, Hero, Architecture, Features...
│   │   └── demo/              # ConnectionStatus, Presence, Inventory, EventLog
│   ├── hooks/
│   │   ├── use-websocket.ts   # WebSocket lifecycle + auto-reconnect
│   │   ├── use-presence.ts    # Presence tracking
│   │   └── use-inventory.ts   # Inventory CRUD + optimistic updates
│   ├── lib/
│   │   ├── constants.ts       # Config (backend URL, limits)
│   │   ├── types.ts           # Frontend message types
│   │   └── utils.ts           # cn() utility
│   ├── package.json
│   └── tailwind.config.ts
├── package.json                # Monorepo scripts
└── README.md
```

## Testing

```bash
# Run all tests (backend + frontend)
npm test

# Backend only (268 tests — unit + property-based)
npm run test:backend

# Frontend only (92 tests — unit + property + integration)
npm run test:frontend
```

The engine's correctness is validated by **21 property-based tests** (backend) and **12 property-based tests** (frontend) using [fast-check](https://github.com/dubzzz/fast-check).

## Configuration

Environment variables (all optional):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 8080 | Backend server port |
| `JWT_SECRET` | development-secret | JWT signing secret |
| `MAX_CONNECTIONS_PER_SESSION` | 50 | Max concurrent WebSocket connections |
| `HEARTBEAT_INTERVAL_MS` | 30000 | Ping interval |
| `HEARTBEAT_TIMEOUT_MS` | 10000 | Pong timeout before disconnect |
| `DATABASE_URL` | — | PostgreSQL connection string (in-memory if not set) |
| `REDIS_URL` | — | Redis connection string (in-memory if not set) |
| `NEXT_PUBLIC_BACKEND_URL` | http://localhost:8080 | Frontend → backend HTTP URL |
| `NEXT_PUBLIC_WS_URL` | ws://localhost:8080 | Frontend → backend WebSocket URL |

## Tech Stack

**Backend:**
- Node.js + TypeScript
- WebSocket (`ws`)
- JWT authentication (`jsonwebtoken`)
- PostgreSQL (`pg`) with in-memory fallback
- Redis (`ioredis`) with in-memory fallback
- Vitest + fast-check

**Frontend:**
- Next.js 14 (App Router)
- React 18 + TypeScript
- Tailwind CSS (dark-first theme)
- Framer Motion (animations)
- Lucide React (icons)
- Vitest + React Testing Library + fast-check

## License

MIT
