# Convergence — Real-Time Collaborative Sync Engine

A portfolio-grade distributed real-time collaboration engine using **CRDTs** (Conflict-free Replicated Data Types) with a native **Rust merge addon** (napi-rs) targeting **50,000 ops/sec**. Full-stack monorepo with a Node.js/TypeScript backend and a Next.js 14 frontend showcasing interactive demos.

## What It Does

Multiple users can simultaneously edit shared state with perfect consistency. The engine guarantees **strong eventual consistency** — all replicas converge to the same state regardless of operation order or network delays.

### Core Capabilities

- **50K ops/sec throughput** — Native Rust addon (napi-rs) for CPU-bound CRDT merge
- **Sub-5ms P50 latency** — Batch processing pipeline with 1-5ms windows
- **Multi-room architecture** — Isolated collaborative sessions with dynamic creation
- **100K offline queue** — Client SDK queues operations with local storage persistence
- **Automatic conflict resolution** — LWW with HLC timestamps, remove-wins semantics, append-only paths
- **Real-time presence** — 60fps cursor tracking via awareness channel
- **Network simulation** — Latency injection, disconnect/reconnect, partition/heal
- **Time-travel API** — Query historical state at any HLC timestamp
- **State snapshots & GC** — Every 1,000 ops; bounded memory for long-running rooms
- **Channel multiplexing** — Single WebSocket per room with ops, awareness, metrics, control channels

### Interactive Demos (Landing Page)

- **Stress Test** — Flood the engine with 100-5000 operations, watch live throughput/latency
- **Split-Screen Sync** — Two independent panels syncing through the backend
- **Collaborative Whiteboard** — Draw shapes with remote cursors and CRDT sync
- **Conflict Visualizer** — See competing operations, HLC timestamps, and resolution logic
- **Live Metrics Dashboard** — Real-time ops/sec, P50/P99, connection counts
- **Architecture Diagram** — Interactive node-and-edge diagram with hover tooltips

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                   Frontend (Next.js 14 + Tailwind)               │
│  Landing Page │ Hero Viz │ Stress Test │ Whiteboard │ Metrics   │
│               │ (live)   │ (1K+ ops)  │ (multi-user)│ (live)   │
└───────────────────────────────┬─────────────────────────────────┘
                                │ WebSocket (JSON v1.0, multiplexed)
┌───────────────────────────────┴─────────────────────────────────┐
│                      Backend (Node.js + Rust)                    │
│                                                                  │
│  Connection Manager V2    Batch Processor    Network Simulator   │
│  (WS gateway, CORS,      (1-5ms window,     (latency, disconnect│
│   channel mux, rooms)     worker_threads)     partition/heal)    │
│                                                                  │
│  Sync Engine V2           Native Merge       Performance         │
│  (room mgmt, CRDT        Addon (Rust/       Collector            │
│   merge, conflicts)       napi-rs)           (P50/P95/P99)       │
│                                                                  │
│  Snapshot Manager         Time-Travel API    Client SDK V2       │
│  (GC, 1K-op threshold)   (state replay)     (offline queue)     │
│                                                                  │
│                     Persistence Layer                             │
│                 PostgreSQL + Redis (or in-memory)                 │
└─────────────────────────────────────────────────────────────────┘
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

Open **http://localhost:3000** to see the Convergence landing page with live demos.

## Project Structure

```
convergence/
├── backend/
│   ├── native-merge/          # Rust napi-rs addon (CRDT merge)
│   │   ├── Cargo.toml
│   │   └── src/               # lib.rs, merge.rs, hlc.rs, snapshot.rs
│   ├── src/
│   │   ├── types/             # V2 interfaces (room, batch, wire-protocol, canvas...)
│   │   ├── engine/            # SyncEngineV2, BatchProcessor, NetworkSimulator, merge
│   │   ├── connection/        # ConnectionManagerV2 (channel mux, rooms, awareness)
│   │   ├── metrics/           # PerformanceCollector (P50/P95/P99, throughput)
│   │   ├── persistence/       # PostgreSQL, Redis, SnapshotManagerV2
│   │   ├── client/            # ClientSDKV2 (offline queue, reconnect, replay)
│   │   └── index.ts           # Server entry point (wires all V2 components)
│   └── package.json
├── frontend/
│   ├── app/
│   │   ├── page.tsx           # Landing page with all demo sections
│   │   └── layout.tsx         # Dark theme, fonts
│   ├── components/
│   │   ├── ui/                # GlassCard, MetricCounter, GlowButton, ConnectionIndicator
│   │   ├── landing/           # Navbar, Hero, Architecture, Features, PerformanceStats
│   │   ├── demo/              # WhiteboardCanvas
│   │   ├── StressTestDemo.tsx
│   │   ├── SplitScreenDemo.tsx
│   │   ├── MetricsDashboard.tsx
│   │   ├── ConflictVisualizer.tsx
│   │   ├── OperationFlowVisualizer.tsx
│   │   └── NetworkSimulationControls.tsx
│   ├── hooks/
│   │   └── use-sync-engine.ts # V2 WebSocket hook (channel mux, reconnect)
│   ├── lib/
│   │   ├── constants.ts       # Backend URL config
│   │   ├── easing.ts          # Ease-out animation utility
│   │   └── stress-test-operations.ts
│   └── package.json
└── README.md
```

## Testing

```bash
# Backend tests (643 tests — unit + property + integration)
cd backend && npx vitest run

# Frontend tests (283 tests — unit + property + component)
cd frontend && npx vitest run
```

**43 property-based tests** validate correctness properties using [fast-check](https://github.com/dubzzz/fast-check):
- CRDT convergence, LWW resolution, remove-wins semantics
- Batch causal ordering, room isolation, snapshot thresholds
- Offline queue capacity, exponential backoff, JSON round-trips
- Operation flow color coding, ease-out deceleration, conflict history bounds

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 8080 | Backend server port |
| `JWT_SECRET` | development-secret | JWT signing secret |
| `CORS_ORIGINS` | * | Allowed frontend origins |
| `BATCH_WINDOW_MS` | 2 | Operation batch window (1-5ms) |
| `SNAPSHOT_THRESHOLD` | 1000 | Ops before auto-snapshot |
| `MAX_CONNECTIONS_TOTAL` | 200 | Max concurrent WebSocket connections |
| `DATABASE_URL` | — | PostgreSQL (in-memory if not set) |
| `REDIS_URL` | — | Redis (in-memory if not set) |
| `NEXT_PUBLIC_SYNC_URL` | ws://localhost:8080 | Frontend WebSocket URL |

## Tech Stack

**Backend:** Node.js, TypeScript, Rust (napi-rs), WebSocket (ws), JWT, PostgreSQL, Redis, Vitest, fast-check

**Frontend:** Next.js 14, React 18, TypeScript, Tailwind CSS, Framer Motion, Lucide Icons, Vitest, fast-check

## License

MIT
