# Changelog

All notable changes to Convergence are documented here.

## [2.5.0] — June 2026

### Collaborative Whiteboard Page

**Added:**
- `/whiteboard` dedicated page with full-viewport infinite canvas (Excalidraw, MIT)
- Real-time multi-user collaboration via full-scene broadcast over WebSocket V2 ops channel
- Local-first mode: draw offline immediately, click Share to start collaboration
- Room sharing: 6-character room IDs, `?room=abc123` URL format, one-click Share button
- Remote cursors via Excalidraw `collaborators` prop + awareness channel (60fps)
- Presence bar showing connected users with display names and colors
- Scene merge algorithm: version-based reconciliation (higher version wins, local priority on ties)
- User-active guard: blocks incoming remote scenes while user is actively editing (300ms window)
- Connection indicator (connected/reconnecting/disconnected states)
- Exponential backoff reconnection (1s → 30s max)
- State persistence within session: new joiners receive current scene snapshot from backend
- Clear board button, per-user undo/redo, all Excalidraw tools (shapes, text, arrows, freehand, eraser)
- Dark theme, touch/stylus support, pinch-to-zoom, infinite pan
- 45 tests (property + unit + integration)

**Architecture:**
- Excalidraw handles canvas UI; our engine handles collaboration (WebSocket sync, CRDT storage, presence)
- Full-scene broadcast (200ms debounce) instead of per-element CRDT (which had Excalidraw reconciliation issues)
- Backend stores room scene as single `__scene__` CRDT item; delivers snapshot on room join
- `createRoom()` made idempotent (returns existing room if ID matches)
- `handleCreateRoom` sends state snapshot to joining clients

**Changed:**
- Navbar Share button triggers room creation on `/whiteboard` (replaces separate Collaborate button)
- `useRoomId` hook pushes `?room=` into URL bar via `history.replaceState`
- Landing page "Learn More" on whiteboard section → `/whiteboard`

---

## [2.4.5] — August 2026

### Rust-Owned Room State + simd-json + Rayon

**What changed:**
- CRDT state now lives permanently in Rust memory per room — no more state serialization crossing the Node.js↔Rust boundary during normal operations
- JSON parsing upgraded to simd-json (SIMD-accelerated, 2-4x faster than serde_json)
- Batches >100K ops are deserialized in parallel via Rayon across all CPU cores
- SyncEngineV2 now uses native room functions (createRoom → mergeOps → dropRoom)
- Benchmark runners migrated to room-based path with full delta tracking

**Performance (v2.4.5 production path with delta tracking):**
- 1M conflict: 4.4s at 226K ops/sec (production-ready with broadcast deltas)
- 1M standard: 9.3s at 107K ops/sec (unique keys, large HashMap)
- 1M rooms (5): 11.8s at 85K ops/sec
- 1M snapshot: 10.2s at 98K ops/sec
- Pure merge speed (mergeBatchBenchmark, no deltas): 345K ops/sec peak

**Why production numbers are lower than v2.4.2 pure benchmarks:**
- `mergeOps` builds full Vec<ItemChange> for every state mutation (needed for real-time broadcast)
- simd-json requires .to_vec() per operation buffer (mutable input requirement)
- Room lifecycle (createRoom/dropRoom + Mutex) adds constant overhead
- This is the honest cost of production-readiness vs synthetic benchmarking

**Added:**
- `createRoom(roomId)` — allocates Rust-owned CRDTState, idempotent
- `mergeOps(roomId, ops)` — in-place merge returning broadcast-ready delta
- `getState(roomId)` — serializes Rust-held state for snapshots/client sync
- `dropRoom(roomId)` — releases all Rust memory for a room, idempotent
- simd-json for all deserialization paths (operations + state)
- Rayon parallel deserialization gated at 100K ops threshold
- Vec::with_capacity pre-allocation for delta change tracking
- SyncEngineV2 native integration with TypeScript fallback (Req 4.5)

**Fixed:**
- Engine benchmark (mergeBatchBenchmark) was serializing the full CRDTState in response — at 1M ops with unique keys, the state JSON was enormous and dominated timing. Removed state from BenchmarkMergeResult, now returns only metrics. Engine numbers correctly reflect pure merge speed.
- Benchmark runners (conflict, rooms, snapshot) were accidentally using production mergeOps path instead of mergeBatchBenchmark. Reverted to fast path for engine benchmarks.

**Frontend (v2.4.5):**
- Three-section benchmark page: Engine, Production, Browser — each with distinct purpose
- BenchmarkRunningIndicator — shared component with pulsing animation + elapsed timer
- OpsLogSlider — configurable stops/labels prop for different benchmark ranges
- Browser benchmark updated: uses OpsLogSlider (100→10K stops), consistent MetricCounter, same connection status style
- "Three Benchmarks, Three Perspectives" polished intro section with colored indicators
- Navbar Share button (cyan default, dark on hover), removed duplicate page share button
- Proper top padding (pt-28) to prevent navbar overlap

**Architecture:**
- Production: Node.js passes room_id + op Buffers → Rust holds state in memory → returns delta only
- State NEVER serialized during normal batch processing (only for snapshots/client sync)
- Offline replay: queued ops go through mergeOps directly against Rust-held state

**Future optimization scope (documented, not implemented):**
- Binary protocol (MessagePack) for WebSocket operations — 2-3x smaller payloads
- Pre-parsed operation cache for replay scenarios — would skip deserialization entirely
- Custom arena allocator for HashMap entries — 10-20% allocation reduction
- These were analyzed and deferred (see .kiro/performance-optimization-roadmap.md)

---

## [2.4.2] — August 2026

### 5 Benchmark Modes + Rust Performance Optimization

**Performance (before → after):**
- Conflict 50K ops: 40,000ms → 233ms (170x faster)
- Standard 500K ops: 78,000ms → 4,100ms (19x faster)
- All modes achieve O(n) linear scaling up to 1M operations
- 1M conflict ops: 2.9s at 345K ops/sec
- 1M standard ops: 6.5s at 155K ops/sec

**Added:**
- 5 benchmark modes: Standard, Conflict Resolution, Concurrent Rooms, Operation Breakdown, Snapshot/Compaction
- `mergeBatchBenchmark` Rust function — O(n) in-place merge via HashMap::get_mut(), zero state.clone()
- Workload pre-generation cache (operations generated once at startup, reused across runs)
- Fast state extraction (Buffer.indexOf + subarray instead of full JSON.parse)
- Log-scale ops slider (1K → 10K → 100K → 500K → 1M) replacing preset buttons
- Unified results display — same layout (hero ops/sec → core metrics → mode extras) for all modes
- Server connected/disconnected status button with clickable health check
- Info bubble on Standard mode explaining performance characteristics
- Mode selector with radio buttons, per-mode descriptions, room count input
- Mode-specific extras: conflict count, per-room timing, per-type breakdown, snapshot metrics
- Memory measurement via MemorySampler (peak heap, delta, graceful error handling)
- 14 property-based tests, 23 unit tests, 11 integration tests

**Optimized (Rust native-merge addon):**
- Eliminated `state.clone()` per operation — uses `get_mut()` for in-place HashMap mutation
- Removed delta/changes tracking in benchmark path — only counts conflicts (integer increment)
- Single Rust call per benchmark run — no intermediate Node.js ↔ Rust JSON serialization
- Operation deserialization once; state stays in Rust memory for entire run
- Complexity: O(n²) → O(n) for all accumulating modes

**Why Standard mode is slower (~155K ops/sec vs ~345K ops/sec for Conflict):**
- Standard creates one unique HashMap key per add operation (N items at N ops)
- Conflict reuses only 10 hot keys — HashMap stays small, lookups cache-friendly
- Standard reflects real-world high-cardinality write scenarios
- Both are O(n) linear; per-operation constant differs due to HashMap growth

**Changed:**
- Full-width stacked layout (browser bench first, server bench below)
- Replaced OpsPresetSelector with OpsLogSlider (log-scale discrete steps)
- Consistent result structure across all modes (unified display component)

---

## [2.4.0] — August 2026

### Dedicated Stress Test Page

**Added:**
- /stress-test dedicated page with full-width stacked layout
- ServerBenchmarkSection — POST /benchmark with configurable ops, latency percentiles, memory measurement
- BrowserBenchmarkSection — WebSocket round-trip performance testing
- OpsPresetSelector — Quick-select buttons for common operation counts
- ExplanationPanel — Context about benchmark methodology and interpretation
- Server benchmark property tests (response correctness, percentile ordering, input validation)
- Full-width card layout for benchmark sections

---

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
