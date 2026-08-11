# Changelog

## [2.0.0] — 2025-01-XX

### Added

**Backend — Sync Engine V2**
- Multi-room architecture with dynamic room creation/deletion and state isolation
- Native Rust merge addon (napi-rs) for CPU-bound CRDT merge at 50K ops/sec
- Batch processor with configurable 1-5ms windows and worker_threads parallelism (≥50 ops)
- Connection Manager V2 with channel multiplexing (ops, awareness, metrics, control)
- Network simulator: per-client latency injection, disconnect/reconnect, partition/heal
- Performance collector: P50/P95/P99 latency, rolling throughput, metrics streaming
- Snapshot Manager V2: auto-snapshot every 1,000 ops, garbage collection, tombstone cleanup
- Time-Travel API: reconstruct state at any HLC timestamp, operation range queries
- Client SDK V2: 100K offline queue, exponential backoff reconnection, ordered replay
- Redis cache layer: room state, participants, op counts, metrics keys
- PostgreSQL persistence: room operations (append-only), snapshots, conflict events
- Full server entry point wiring all V2 components into operation pipeline
- 43 property-based tests validating CRDT correctness properties
- Integration tests for full WebSocket pipeline and frontend connectivity

**Frontend — Convergence Landing Page**
- Dark-themed landing page (navy/black, cyan accent, glassmorphism)
- Hero section with live WebSocket visualization (auto-escalating ops)
- Stress Test demo: configurable burst/sustained modes, live throughput graph
- Split-Screen Sync: two independent panels syncing through backend
- Collaborative Whiteboard: freehand, rectangle, circle, select, move, resize, delete
- Live Metrics Dashboard: ops/sec, P50/P99, connections, rooms, throughput chart
- Conflict Visualizer: side-by-side operations, HLC timestamps, winner highlighting
- Operation Flow Visualizer: animated architecture diagram with color-coded ops
- Architecture Section: interactive node-and-edge diagram with hover tooltips
- Performance Statistics: scroll-triggered count-up animations with ease-out
- Network Simulation Controls: latency slider, disconnect toggle, partition toggle
- Reusable UI components: GlassCard, MetricCounter, ConnectionIndicator, GlowButton
- useSyncEngine hook: V2 WebSocket with channel multiplexing and auto-reconnect

### Changed
- Server entry point rewritten for V2 architecture (backwards-compatible V1 exports retained)
- Redis cache extended with room-based caching and metrics keys
- Persistence layer extended with V2 room operations, snapshots, and conflict events
- Types expanded with V2 interfaces (room, batch, wire-protocol, canvas, metrics, etc.)

### Known Issues
- 6 pre-existing V1 integration tests fail (use old wire protocol, replaced by V2 tests)
- Frontend demo WebSocket connections have protocol sequencing bugs (tracked in bugfix spec)

## [1.0.0] — 2024-XX-XX

### Added
- Initial collaborative sync engine with CRDT-based inventory management
- WebSocket server with JWT authentication and heartbeat
- LWW-Element-Set with Hybrid Logical Clock timestamps
- Offline operation queue with reconnection replay
- Presence tracking
- PostgreSQL persistence with Redis caching
- Next.js 14 frontend with demo app
- 21 property-based tests (backend) + 12 (frontend)
