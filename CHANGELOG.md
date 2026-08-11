# Changelog

All notable changes to Convergence are documented here.

## [2.2.0] — May 2026

### Frontend Polish, Bug Fixes & Deployment

**Deployed:**
- Frontend: https://frontend-one-sable-24.vercel.app (Vercel, auto-deploys on push)
- Backend: https://collaborative-sync-engine-caj8.onrender.com (Render, free tier)
- WebSocket: wss://collaborative-sync-engine-caj8.onrender.com

**Fixed:**
- WebSocket V2 protocol handshake — all demo components now wait for `connected` ack before sending room commands
- Backend `handleCreateRoom` now adds the creating client as a room participant (ops were silently rejected)
- Operation type mapping: frontend sends `add`/`remove` (not `create`/`delete`) matching backend expectations
- Split-screen sync: delta handler now correctly parses V2 `changes[]` format and LWW register values
- Split-screen room join: accepts both `join-room` and `room-joined` response types from backend
- `useSyncEngine` room confirmation: accepts `create-room` response type (not just `room-created`)
- Backend rebuilt from source (stale V1 `dist/` was being served instead of V2)

**Added:**
- Dual bot collaborators on whiteboard (BotAlice + BotBob) with start/stop toggles
- Clear board button for whiteboard
- Batch card operations in split-screen (add 1-100 cards at once, remove all)
- Adaptive card grid layout (1-col → 2-col → 3-col based on count)
- Simulated metrics panel with live-updating fake data (ops/sec, latency, connections)
- Simulated conflict resolution panel with generated LWW conflict events
- Blog page (`/blog`) with 8 build log entries from Dec 2025 to Jul 2026
- Architecture diagram rewritten as pure HTML/CSS flexbox (no SVG coordinate issues)
- Edge hover tooltips restored on architecture diagram
- "Source Code" GitHub button in hero section linking to repo
- Description + "Learn More" placed below each demo component's title
- Tech stack section with emoji icons per technology

**Changed:**
- Removed sustained mode from stress test (burst-only, simpler)
- Removed inline blog section from landing page (moved to `/blog`)
- Navbar links updated: added Demos, Blog; removed Properties
- "Launch Demo" button scrolls to `#demos` instead of routing to broken `/demo`
- GitHub button routes to actual repo (`github.com/nooblancer/collaborative-sync-engine`)
- Reduced ACK wait timeout from 30s to 15s
- Metrics panel labels shortened (Connections → Conns, Total Ops → Total)

**Removed:**
- SVG-based architecture diagram (replaced with CSS layout)
- Mode selector (Burst/Sustained) from stress test
- Duplicate titles in demo section wrappers

---

## [2.0.0] — April 2026

### Platform Evolution

**Added:**
- Native Rust merge addon (napi-rs) — 50K ops/sec CRDT merge throughput
- V2 channel-multiplexed WebSocket protocol (ops, awareness, metrics, control)
- Batch processor with 1-5ms window and worker_threads for ≥50 ops
- Multi-room architecture with isolated state per room
- Next.js 14 frontend with dark theme landing page
- 5 interactive demos: Stress Test, Split-Screen, Whiteboard, Metrics, Conflict Visualizer
- Performance collector (P50/P95/P99, throughput history)
- Time-travel API for historical state reconstruction
- Snapshot manager with GC (every 1000 ops)
- Network simulation (latency injection, disconnect, partition)
- Client SDK V2: 100K offline queue, exponential backoff, 5K ops/sec replay
- 43 property-based tests with fast-check

---

## [1.0.0] — February 2026

### Initial Release

**Added:**
- CRDT Sync Engine with LWW-Element-Set merge
- Hybrid Logical Clock (HLC) for causal ordering
- WebSocket Connection Manager with JWT auth, heartbeat, presence
- Client SDK with 10K-op offline queue, ACK-based dequeue
- PostgreSQL persistence (operation log + snapshots)
- Redis cache (state, presence, missed-update queue)
- 21 property-based correctness tests
- Full integration tests for multi-client collaboration
