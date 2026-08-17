import Link from "next/link";
import { ArrowLeft, Github, Calendar, Tag, Clock, ArrowRight } from "lucide-react";

// ---------------------------------------------------------------------------
// Blog Post Data
// ---------------------------------------------------------------------------

interface BlogPost {
  slug: string;
  title: string;
  description: string;
  content: string;
  date: string;
  readTime: string;
  tag: string;
  status: "published" | "current" | "planned";
}

const posts: BlogPost[] = [
  {
    slug: "v2-5-collaborative-whiteboard",
    title: "V2.5: Collaborative Whiteboard — Excalidraw + Our CRDT Engine",
    description: "A full-page infinite canvas with real-time multi-user collaboration. Local-first drawing, one-click room sharing, remote cursors, and presence — all powered by our WebSocket V2 protocol and Rust CRDT backend.",
    content: "The whiteboard page brings everything together: Excalidraw provides the canvas UI (infinite pan/zoom, professional drawing tools, per-user undo/redo, touch support) while our engine handles the hard part — real-time collaboration across browsers.\n\nThe sync architecture went through 3 iterations:\n\n1. Per-element CRDT sync (FAILED) — Tried diffing individual elements and syncing via field-level LWW merge. Excalidraw's internal element reconciliation rejected externally-modified elements regardless of version bumps.\n\n2. Full-scene replace (PARTIALLY WORKED) — Broadcasting the entire scene on every change. Problem: last-writer-wins meant one user's drawings erased the other's.\n\n3. Full-scene broadcast with merge (FINAL) — Send full scene, but MERGE on receive instead of replace. New elements get added, existing elements update only if remote version is strictly higher. Local priority on ties prevents overwrite during active editing.\n\nKey implementation details:\n• 200ms debounce before broadcasting (reduces chatter)\n• 300ms user-active guard (blocks incoming scenes while you're editing)\n• Remote cursors via Excalidraw's collaborators prop + WebSocket awareness channel\n• Presence derived from awareness data (updates in real-time, no stale entries)\n• Room IDs are 6-char random strings, no prefix\n• Local-first: canvas works offline, Share button enables collaboration\n• Backend stores scene as single __scene__ CRDT item, delivers snapshot on room join\n• createRoom() made idempotent (second joiner gets existing room, not fresh empty one)\n\nThe 'Collaborate' UX: visit /whiteboard → draw locally → click navbar Share → room created + URL copied → paste in another browser → both users see each other's cursors and drawings sync in real-time.\n\nWhat we learned: Excalidraw's npm package explicitly does NOT include collaboration. You must build the sync layer yourself. The per-element approach that works for custom canvases does NOT work with Excalidraw due to its internal immutable element management. Full-scene sync with intelligent merge is the correct approach — and it's how excalidraw.com itself works.",
    date: "June 2026",
    readTime: "5 min",
    tag: "Release",
    status: "current",
  },
  {
    slug: "v2-4-5-production-engine",
    title: "V2.4.5: Production-Grade Rust Engine — Room State, simd-json, Rayon",
    description: "The production-ready Rust engine with Rust-owned room state, simd-json, Rayon parallelism — plus fixing a measurement error that made engine benchmarks appear slower than production.",
    content: "The v2.4.2 benchmark numbers (345K ops/sec) were impressive but synthetic. They used a benchmark-only function that skipped delta tracking. V2.4.5 builds the production engine AND fixes a critical measurement error: the engine benchmark was serializing the entire final state (1M items = huge JSON) in its response, making it appear slower than production. Fixed by returning only metrics.\n\nThree optimizations shipped:\n\n1. Rust-Owned Room State \u2014 CRDT state lives permanently in Rust memory per room. Node.js passes room_id + operation Buffers; state never crosses the FFI boundary during normal batch processing. New napi functions: createRoom, mergeOps, getState, dropRoom.\n\n2. simd-json \u2014 All JSON deserialization uses SIMD CPU instructions (SSE4.2/AVX2). 2-4x faster than serde_json for parsing operation buffers.\n\n3. Rayon \u2014 Batches above 100K operations are deserialized across all CPU cores in parallel. Below threshold, sequential (thread pool overhead isn\u2019t worth it).\n\nActual benchmark results (averaged over 5 runs per config):\n\nENGINE BENCHMARK (pure merge, no deltas):\n\u2022 standard 1K: 204K ops/s | 10K: 153K ops/s | 100K: 137K ops/s\n\u2022 conflict 1K: 250K ops/s | 10K: 277K ops/s | 100K: 237K ops/s\n\u2022 rooms(5) 1K: 249K ops/s | 10K: 268K ops/s | 100K: 267K ops/s\n\u2022 snapshot 1K: 167K ops/s | 10K: 248K ops/s | 100K: 199K ops/s\n\nPRODUCTION BENCHMARK (full delta tracking for broadcast):\n\u2022 standard 1K: 156K ops/s | 10K: 133K ops/s | 100K: 115K ops/s\n\u2022 conflict 1K: 245K ops/s | 10K: 243K ops/s | 100K: 206K ops/s\n\u2022 rooms(5) 1K: 245K ops/s | 10K: 237K ops/s | 100K: 210K ops/s\n\u2022 snapshot 1K: 158K ops/s | 10K: 285K ops/s | 100K: 173K ops/s\n\nEngine is consistently 13-24% faster than production \u2014 the difference is the cost of tracking what changed (needed for real-time broadcast to connected clients).\n\nBROWSER BENCHMARK (per-client WebSocket round-trip): ~500-1000 ops/sec. This is what a single user experiences. The 200K+ server throughput represents capacity to handle hundreds of concurrent users.\n\nThe stress test page now shows all three perspectives with consistent UI: log-scale slider (1K\u21921M), 5 benchmark modes, running state indicators with elapsed timer, and unified results display with mode-specific details.\n\nKey measurement fix: mergeBatchBenchmark was serializing the full CRDTState (1M items) in its return value \u2014 at high op counts this dominated timing and made engine appear slower than production. Fixed by removing state from the response (only return metrics). Engine numbers now correctly reflect pure merge speed.",
    date: "June 2026",
    readTime: "5 min",
    tag: "Release",
    status: "published",
  },
  {
    slug: "performance-optimization-research",
    title: "Profiling to Production: The Performance Optimization Journey",
    description: "A systematic approach to performance engineering: 6 optimization paths profiled, ROI-ranked, and decisioned. Implementing the top 3 while consciously deferring the rest — and why production throughput is 35% lower than benchmarks by design.",
    content: "After v2.4.2 achieved 345K ops/sec on synthetic benchmarks, we profiled where time was actually spent at 1M operations:\n\n• Operation JSON deserialization (serde_json::from_slice × 1M): ~2.0s (69%)\n• In-memory merge (HashMap get_mut + insert): ~0.3s (10%)\n• Result JSON serialization (serde_json::to_vec): ~0.4s (14%)\n• Node.js overhead (Buffer transfer, result parse): ~0.2s (7%)\n\nThe merge itself was fast. JSON serialization was 83% of total time.\n\n6 optimization paths were researched and ranked by ROI:\n\n1. Rust-owned room state (IMPLEMENTED) — keep CRDTState in Rust memory per room. Node.js passes room_id + ops, state never crosses the boundary. 5x improvement for production batch processing.\n\n2. simd-json (IMPLEMENTED) — SIMD-accelerated JSON parsing. Drop-in replacement for serde_json deserialization. 2-4x faster per operation.\n\n3. Binary protocol / MessagePack (DEFERRED) — would replace JSON on the WebSocket path. 2-3x faster deser + 50-70% smaller payloads. Deferred because it breaks debuggability and requires simultaneous client+server migration.\n\n4. Rayon parallel deserialization (IMPLEMENTED) — par_iter for batches >100K ops. 2-4x on multi-core machines for the deserialization phase.\n\n5. Arena allocator (DEFERRED) — 10-20% allocation reduction but hostile to long-lived production state. Deferred: complexity outweighs marginal gain.\n\n6. WebSocket compression (NOT PLANNED) — adds latency for high-frequency messages, only helps large batch transfers.\n\nThe key discovery: the production path (mergeOps with delta tracking) is 35% slower than pure merge (mergeBatchBenchmark) — but that cost buys real-time broadcast capability. You can't have collaboration without knowing what changed.\n\nFinal architecture: Node.js holds room_id → Rust holds state → operations arrive as JSON Buffers → simd-json parses them → in-place HashMap merge → delta returned for broadcast → state never leaves Rust between batches.",
    date: "June 2026",
    readTime: "6 min",
    tag: "Engineering",
    status: "published",
  },
  {
    slug: "v2-4-2-rust-optimization",
    title: "V2.4.2: From 40 Seconds to 233ms — O(n) Rust CRDT Optimization",
    description: "Eliminating O(n²) state cloning in the Rust merge engine, adding workload caches, and achieving 345K ops/sec for 1M operations.",
    content: "The benchmark page was timing out at 50K operations. The root cause: every single operation in the Rust merge engine called state.clone(), copying the entire HashMap. With 50K operations on a growing state, that's O(n²) — each clone copies more data than the last.\n\nThe fix was surgical:\n\n1. New Rust function `mergeBatchBenchmark` — processes all operations in a single call. Instead of cloning state per-op, it uses `get_mut()` to mutate the HashMap in place. Conflict counting uses a simple integer increment instead of building a changes vector.\n\n2. Workload cache — operations are pre-generated once at server startup and reused across all runs. First request is instant (no generation overhead).\n\n3. Zero intermediate serialization — the old approach serialized state to JSON between every batch (Node.js parsed it, re-stringified it, passed it back to Rust). Now: one Rust call, state stays in Rust memory the entire time.\n\nResults at 1M operations:\n• Conflict: 2.9s at 345K ops/sec\n• Standard: 6.5s at 155K ops/sec\n• Rooms (5): 5.4s at 185K ops/sec\n• Snapshot: 5.9s at 169K ops/sec\n• Breakdown: 4.7s at 211K ops/sec\n\nWhy is Standard slower? It creates one unique key per add operation — the HashMap grows to N entries. Conflict mode reuses 10 hot keys, keeping the HashMap small and cache-friendly. Both are O(n); the per-operation constant differs due to HashMap size. Standard reflects real-world high-cardinality scenarios where every write creates a new entity.\n\nWhy not O(log n)? Each operation must be processed at least once — that's a fundamental Ω(n) lower bound. Per-operation cost is O(1) amortized (HashMap insert/lookup), giving O(n) total. This is provably optimal.",
    date: "May 2026",
    readTime: "5 min",
    tag: "Engineering",
    status: "published",
  },
  {
    slug: "v2-4-stress-test-page",
    title: "V2.4: Dedicated Stress Test Page & 5 Benchmark Modes",
    description: "A full-page benchmark dashboard with mode selection, log-scale slider, per-mode result displays, and the Rust merge engine exposed via POST /benchmark.",
    content: "The stress test outgrew its landing page section. V2.4 gives it a dedicated page at /stress-test with two full-width sections:\n\n• Browser Benchmark — measures WebSocket round-trip throughput (client → server → merge → broadcast → client)\n• Server Benchmark — measures raw Rust merge engine speed via POST /benchmark (no WebSocket overhead)\n\nThe server benchmark now supports 5 modes:\n\n1. Standard — raw throughput with unique keys per operation (realistic write-heavy scenario)\n2. Conflict Resolution — high-contention workload with 80% ops targeting 10 hot keys\n3. Concurrent Rooms — distributes ops across N isolated CRDT states (measures scaling)\n4. Operation Breakdown — times add/update/remove individually for per-type analysis\n5. Snapshot Cost — accumulates state then measures compaction overhead\n\nThe UI features a log-scale slider (1K → 10K → 100K → 500K → 1M), unified result display (same layout for all modes), server connection indicator, and mode-specific extras (conflict count, room timing, type breakdown, snapshot metrics).\n\nEach mode validates its inputs, returns HTTP 400 for invalid requests, and includes memory measurement (peak heap + delta). 14 property-based tests verify correctness invariants across all modes.",
    date: "May 2026",
    readTime: "4 min",
    tag: "Release",
    status: "published",
  },
  {
    slug: "v2-4-2-benchmark-modes",
    title: "V2.4.2: 5 Benchmark Modes & 170x Rust Performance Optimization",
    description: "From 40-second timeouts to 345K ops/sec — how eliminating state.clone() and intermediate JSON serialization unlocked O(n) CRDT merge performance.",
    content: "This release transforms the server benchmark from a single-mode throughput test into a comprehensive 5-mode analysis suite — and solves the O(n²) performance cliff that made large benchmarks timeout.\n\nThe five modes:\n• Standard — Measures raw merge throughput with independent batches (no state accumulation). Best for pure Rust merge speed.\n• Conflict Resolution — High-contention workload with ≥80% operations targeting ≤10 hot keys across 4+ replicas. Tracks conflict resolution count and final CRDT state size.\n• Concurrent Rooms — Distributes operations across N isolated rooms (default 5), each with independent CRDT state. Reports per-room metrics, fastest/slowest/average.\n• Operation Breakdown — Per-operation timing with nanosecond precision via process.hrtime.bigint(). Reports separate metrics for add, update, and remove operations.\n• Snapshot/Compaction — Runs a tombstone-heavy workload (≥20% removes), then measures computeSnapshot cost. Reports items before/after compaction and tombstones removed.\n\nThe performance problem: at 100K+ operations, the original benchmark timed out at 40 seconds. Root cause — the Rust mergeBatch function called state.clone() on every operation, making each subsequent merge process a larger state copy. Combined with full JSON.parse/JSON.stringify on every Node.js ↔ Rust boundary crossing, this produced O(n²) behavior.\n\nThe fix: a new mergeBatchBenchmark Rust function that processes all operations in a single call with zero cloning. It uses HashMap::get_mut() for in-place mutation — each operation does one hash lookup and one field write. No intermediate state copies, no JSON round-trips between batches.\n\nAdditionally, a WorkloadCache pre-generates all operation buffers at startup so the timing loop measures pure merge throughput without operation generation overhead.\n\nResults across all modes up to 1M operations:\n• Standard: 155K ops/sec sustained at 1M ops (6.5s)\n• Conflict: 345K ops/sec peak at 1M ops (2.9s) — fastest due to small final state\n• Rooms (5): 185K ops/sec at 1M ops (5.4s)\n• Snapshot: 169K ops/sec at 1M ops (5.9s)\n• Breakdown: 211K ops/sec at 1M ops (4.7s)\n\nThe conflict mode's higher throughput comes from the concentrated key space — fewer unique items means the HashMap stays small and cache-friendly. Standard mode's lower throughput reflects the broader key distribution creating a larger working set.\n\n14 property-based tests validate the new modes: workload distribution correctness, CRDT convergence under contention, room isolation, per-type metric consistency, snapshot arithmetic invariants, and input validation rejection.",
    date: "May 2026",
    readTime: "6 min",
    tag: "Release",
    status: "published",
  },
  {
    slug: "v2-4-stress-test-page",
    title: "V2.4: Dedicated Stress Test Page with Server Benchmark",
    description: "Moving the stress test from a landing page section to a full-page experience with server-side Rust merge engine benchmarking and mode-aware presets.",
    content: "V2.4 promotes the stress test from a compact landing page section to a dedicated /stress-test page with room to breathe. The page uses a full-width stacked layout with two primary sections: a browser-side benchmark (testing WebSocket round-trip performance) and a server-side benchmark (testing raw Rust merge throughput).\n\nThe server benchmark section sends POST requests to the /benchmark endpoint, which exercises the native Rust merge addon in a tight loop. It measures:\n• Throughput (ops/sec) — total operations divided by elapsed time\n• Latency percentiles (P50, P99) — computed from per-batch durations\n• Batch processing — configurable batch sizes with preset selectors\n• Memory measurement — MemorySampler tracks heap usage baseline, peak, and delta\n\nThe OpsPresetSelector component provides quick-select buttons for common operation counts (10K, 50K, 100K, 500K) adapted per benchmark mode. An ExplanationPanel gives context about what each benchmark measures and how to interpret results.\n\nThe page architecture separates concerns cleanly: useServerBenchmark hook manages state and API calls, ServerBenchmarkSection handles layout and UI, and the backend handles validation, dispatch, and Rust execution.\n\nProperty-based tests (fast-check) validate:\n• Response field correctness across all preset sizes\n• Percentile ordering invariants (P50 ≤ P99)\n• Input rejection for invalid parameters\n• UI state consistency during benchmark lifecycle\n\nThe /stress-test route is linked from the landing page navbar, providing a clean separation between the showcase demos and the deep-dive performance tooling.",
    date: "May 2026",
    readTime: "4 min",
    tag: "Release",
    status: "published",
  },
  {
    slug: "v3-roadmap",
    title: "V3 Roadmap: Individual App Pages for Each Demo",
    description: "Planning dedicated pages for Stress Test, Split-Screen, Whiteboard, Metrics, and Conflict Resolution — each with deeper controls, history, and shareable URLs.",
    content: "V3 is our biggest architectural shift yet. Each demo currently lives as a section on the landing page, but they deserve their own space. The plan:\n\n• /stress-test — Full-page stress testing dashboard with configurable concurrency, custom operation generators, and exportable benchmark reports\n• /whiteboard — Standalone collaborative canvas with shareable room URLs, persistent state, and unlimited canvas size\n• /split-screen — Multi-panel sync demo supporting 3+ clients with network condition simulation\n• /metrics — Production-grade observability dashboard with Grafana-style time series\n• /conflicts — Interactive conflict exploration with step-through replay\n\nEach page will maintain its own WebSocket connection and room, with URL-based room sharing so visitors can collaborate across browser tabs or devices.",
    date: "July 2026",
    readTime: "3 min",
    tag: "Roadmap",
    status: "planned",
  },
  {
    slug: "v2-3-benchmark",
    title: "V2.3: Server Benchmark Endpoint & Collaboration Utilities",
    description: "Proving 80K+ ops/sec with a dedicated benchmark endpoint, shared room URL hooks, bot auto-disable when real users join, and 8 property-based correctness tests.",
    content: "The headline: POST /benchmark now exercises the Rust native merge addon in a tight loop and returns hard numbers. On our dev machine: 80,000+ ops/sec with p50 latency of 0.5ms per batch.\n\nFour capabilities shipped in this release:\n\n1. POST /benchmark endpoint — Generates synthetic CRDT operations (50% add, 30% update, 20% remove), feeds them through mergeBatch in pre-generated batches, and returns throughput + percentile stats. No WebSocket overhead, no persistence — pure merge throughput measurement.\n\n2. useRoomId hook — A shared React hook that extracts ?room= from the URL or generates {prefix}-{random6} IDs. Stable across re-renders via useRef, SSR-safe via useSearchParams, with getShareUrl() and copyShareUrl() built in.\n\n3. Bot auto-disable — When 2+ real users connect to a room, BotAlice and BotBob automatically pause. The shouldBotsBeActive() pure function reads the awareness channel participant list and counts non-bot clients. A status indicator appears when bots are paused.\n\n4. Health endpoint verification — 5 integration tests confirming /health returns HTTP 200, application/json, status:'ok', no auth required, within 5000ms. UptimeRobot-ready.\n\nThe property tests (fast-check, 100+ iterations each):\n• Benchmark response field correctness\n• Percentile ordering invariant (p50 ≤ p99)\n• Invalid input rejection\n• Operation mix distribution\n• Room ID share URL round-trip\n• Generated room ID format\n• Room ID stability across renders\n• Bot activation iff single real user\n\n53 tests total, 0 failures.",
    date: "April 2026",
    readTime: "5 min",
    tag: "Release",
    status: "published",
  },
  {
    slug: "v2-3-1-perf-patch",
    title: "V2.3.1: Benchmark Performance Patch — From 3K to 80K ops/sec",
    description: "Fixing three performance bugs that made the benchmark endpoint timeout: O(n²) state accumulation, timed operation generation, and oversized batch defaults.",
    content: "The benchmark endpoint was timing out. Sending POST /benchmark with defaults produced ~3,000 ops/sec — well below the 50K claim. Three bugs stacked together:\n\n1. O(n²) state accumulation — Each batch fed its output state into the next. State grew with every batch, so later mergeBatch calls processed an ever-larger JSON object. At 50 batches deep, each call took 500ms+.\n\nFix: Use fresh empty state per batch. We're measuring merge throughput, not state growth. The Rust engine processes each batch from a clean slate.\n\n2. Operation generation inside the timing loop — generateOperationBatch() was called during the timed section, inflating elapsedMs with JavaScript object creation and JSON.stringify overhead.\n\nFix: Pre-generate all operation batches before the timing loop starts. Now elapsed measures only the Rust merge calls.\n\n3. Default batchSize=1000 was too large — Each mergeBatch call with 1000 operations took ~130ms due to per-operation JSON deserialization inside the Rust boundary. With 50 ops per call (~1ms each), the overhead amortizes much better.\n\nFix: Changed default batchSize from 1000 to 50. This matches real-world usage where operations arrive in small bursts.\n\nBefore: 3,000 ops/sec (50K ops took 5+ minutes)\nAfter: 80,000+ ops/sec (50K ops in 600ms)\n\nThe Rust merge engine was always fast — we were just measuring the wrong thing.",
    date: "April 2026",
    readTime: "4 min",
    tag: "Engineering",
    status: "published",
  },
  {
    slug: "v2-2-polish",
    title: "V2.2: Frontend Polish, Bug Fixes & Deployment",
    description: "Fixing 10 landing page bugs, rewriting the architecture diagram in pure CSS, dual-bot whiteboard, and deploying to Vercel + Render.",
    content: "This release was born from actually using the landing page and realizing... nothing worked.\n\nThe WebSocket demos showed 'disconnected' or 'reconnecting' because the frontend sent commands before the server acknowledged the connection. The architecture diagram was an SVG/CSS coordinate nightmare where nodes and arrows existed in different coordinate spaces. The stress test sent operations typed 'create' but the backend expected 'add'.\n\nKey fixes:\n• Rebuilt the architecture diagram as pure HTML/CSS flexbox — no more SVG coordinate math\n• Fixed V2 protocol handshake: wait for 'connected' ack before sending room commands\n• Fixed operation type mapping: 'create'→'add', 'delete'→'remove'\n• Fixed backend handleCreateRoom: it created rooms but never added the client as a participant\n• Added dual-bot whiteboard system (BotAlice + BotBob) with start/stop toggles\n• Added batch card operations (add 1-100 at once) in split-screen\n• Replaced real metrics/conflict panels with simulated data for the landing page\n• Removed sustained mode from stress test (it was just a slower burst with no demo value)\n• Added /blog page with full build log\n• Added GitHub Source Code button, tech stack icons\n\nDeployment:\n• Frontend deployed to Vercel (auto-deploys on push)\n• Backend deployed to Render (free tier, WebSocket-compatible)\n• Environment variables wire the frontend to the production backend via wss://\n\nThe lesson: integration testing between frontend protocol assumptions and backend responses is where bugs hide. And always rebuild your dist/ before testing.",
    date: "March 2026",
    readTime: "7 min",
    tag: "Release",
    status: "published",
  },
  {
    slug: "v2-platform",
    title: "V2: From Sync Engine to Portfolio Platform",
    description: "The complete rewrite: native Rust merge addon, channel-multiplexed WebSocket, batch processor, and 5 interactive demos that connect to a live backend.",
    content: "V1 was a backend library. V2 turned it into something you can show people.\n\nThe headline number — 50,000 ops/sec — comes from the native Rust addon (napi-rs). The TypeScript merge path topped out around 5K ops/sec for complex operations. By moving the hot path to Rust, we kept Node.js for what it's good at (I/O, WebSocket routing) and let Rust handle the CPU-bound CRDT math.\n\nThe V2 protocol consolidates everything into a single WebSocket per room with four logical channels:\n• Operations — reliable, persisted, ACK'd\n• Awareness — fire-and-forget at 60fps (cursor positions)\n• Metrics — server-push at 1s intervals\n• Control — room management, simulation commands\n\nThe batch processor buffers operations for 1-5ms windows, then processes them as a single merge-persist-broadcast cycle. Above 50 ops in a batch, it offloads to worker_threads for parallel merge.\n\nThe frontend showcases all of this through live demos: a stress tester that floods the engine, a whiteboard with simulated collaborators, split-screen bidirectional sync, and live metrics/conflict panels.",
    date: "February 2026",
    readTime: "8 min",
    tag: "Release",
    status: "published",
  },
  {
    slug: "property-testing",
    title: "43 Properties: Testing CRDTs with fast-check",
    description: "Property-based testing isn't just for academics. Here's how we used it to find real bugs in merge logic, queue ordering, and protocol sequencing.",
    content: "CRDTs have mathematical properties that must hold universally. Property-based testing generates thousands of random inputs and checks these invariants:\n\n• Commutativity: merge(state, A, B) = merge(state, B, A)\n• Associativity: merge(merge(state, A, B), C) = merge(state, A, merge(state, B, C))\n• Idempotence: merge(merge(state, A), A) = merge(state, A)\n• Remove-wins: concurrent remove + update → item stays deleted\n• Queue ordering: persist → restore produces identical ordering\n• Serialization round-trip: serialize → deserialize = identity\n• Reconnection cap: only most recent 1000 ops transmitted\n\nWe use fast-check (TypeScript) for the Node.js codebase. Each property generates arbitrary operations, timestamps, and state configurations. In the first week, PBT found 3 bugs that unit tests missed:\n1. An off-by-one in HLC comparison when wallTime was equal\n2. A queue capacity edge case at exactly 10,000 operations\n3. A delta computation that included unchanged fields\n\nThe bug-condition methodology in our bugfix spec also uses PBT: write a test that encodes expected behavior, run it against unfixed code (should fail), fix the code, re-run (should pass).",
    date: "February 2026",
    readTime: "7 min",
    tag: "Engineering",
    status: "published",
  },
  {
    slug: "v2-protocol",
    title: "Designing the Channel-Multiplexed WebSocket Protocol",
    description: "Why one connection per room, four logical channels, and a strict handshake sequence — plus the bugs that taught us why protocol sequencing matters.",
    content: "The V1 protocol was simple: open WebSocket, send JSON, get JSON back. V2 needed to support four distinct communication patterns over a single connection:\n\n1. Operations need reliability (ACKs, ordering, persistence)\n2. Awareness needs speed (cursor positions at 60fps, no persistence)\n3. Metrics need server-push (1-second intervals, no client request)\n4. Control needs request/response (room create/join, simulation commands)\n\nThe protocol handshake:\n• Client connects with ?token=JWT\n• Server validates JWT, sends { type: 'control-response', payload: { type: 'connected', clientId } }\n• Client sends create-room or join-room\n• Server confirms with room state\n• Client can now send ops/awareness on that room\n\nThe sequencing bug that bit us: demo components sent create-room immediately in ws.onopen, before the server's 'connected' acknowledgment arrived. The server rejected these because it hadn't associated the client yet. The fix was straightforward (wait for ack), but finding it required tracing the full message flow from frontend → backend → response.\n\nAnother bug: the frontend checked for 'room-created' in responses but the backend sent 'create-room' with status 'created'. Type naming mismatches across the protocol boundary are invisible until you trace actual messages.",
    date: "January 2026",
    readTime: "6 min",
    tag: "Protocol",
    status: "published",
  },
  {
    slug: "v1-release",
    title: "V1: A CRDT Sync Engine in TypeScript",
    description: "The initial build: LWW-Element-Set merge, Hybrid Logical Clocks, WebSocket connection management, offline queues, and 21 formal correctness properties.",
    content: "The goal was clear: build a distributed sync engine from scratch that guarantees convergence without coordination.\n\nCore components:\n• Sync Engine — LWW-Element-Set merge with field-level last-writer-wins. Remove-wins semantics for deletions. Delta computation for minimal broadcasting.\n• Hybrid Logical Clock — Combines wall-clock time with logical counters for causal ordering. Deterministic tiebreaker via lexicographic nodeId when timestamps are equal.\n• Connection Manager — WebSocket gateway with JWT auth, 30s heartbeat + 10s timeout, presence tracking, missed-update queuing (max 1000 ops / 24h).\n• Client SDK — Local replica, 10K-operation offline queue with file-based persistence, exponential backoff reconnection, ACK-based dequeue.\n• Persistence — PostgreSQL for durable operation log + snapshots (every 10min / 1000 ops), Redis for state cache (<50ms reads) + presence hashes.\n\n21 properties tested:\n• Merge: commutativity, associativity, idempotence, remove-wins\n• Clock: total ordering, deterministic tiebreak\n• Queue: FIFO ordering, persistence round-trip, capacity limits, ACK removal, reconnection cap\n• SDK: API translation correctness, serialization round-trip, incoming operation application, item validation\n• Connection: presence data integrity, auth error classification, missed update queue integrity\n• Persistence: state recovery via replay\n• Engine: partial batch merge correctness\n\nAll implemented with vitest + fast-check. The entire backend has zero runtime dependencies beyond ws, ioredis, pg, uuid, and jsonwebtoken.",
    date: "January 2026",
    readTime: "9 min",
    tag: "Release",
    status: "published",
  },
  {
    slug: "architecture-decisions",
    title: "Why CRDTs? Architecture Decisions for Real-Time Collaboration",
    description: "OT vs CRDT, centralized vs decoupled, LWW vs vector clocks — the design decisions behind Convergence.",
    content: "The first decision: Operational Transformation (OT) or CRDTs?\n\nOT (used by Google Docs) transforms operations against concurrent edits. It requires a central server to establish operation order. CRDTs guarantee convergence mathematically — any replica can merge operations in any order and reach the same state.\n\nWe chose CRDTs because:\n• No central coordination required (operations can merge in any order)\n• Natural fit for offline-first (queue locally, merge on reconnect)\n• Mathematical correctness guarantees (provable convergence)\n• Educational value (implementing LWW from scratch teaches distributed systems deeply)\n\nWithin CRDTs, we chose LWW-Element-Set because:\n• Simple mental model (last edit wins, period)\n• Efficient (single timestamp comparison per field)\n• Deterministic (HLC + nodeId tiebreaker means no ambiguity ever)\n• Good enough for most collaborative apps (documents, inventory, dashboards)\n\nThe tradeoff: LWW can 'lose' concurrent edits (the earlier write disappears). For text editing you'd want a sequence CRDT (Yjs, Automerge). For our inventory/state sync use case, LWW is perfect.\n\nLocal-first architecture:\n• Client applies operations immediately (sub-100ms local feedback)\n• Operations queued and sent asynchronously\n• Server merges, persists, broadcasts deltas\n• On reconnect: replay queued ops, receive missed deltas, converge\n\nThis gives users instant responsiveness while guaranteeing eventual consistency across all replicas.",
    date: "December 2025",
    readTime: "7 min",
    tag: "Architecture",
    status: "published",
  },
  {
    slug: "kickoff",
    title: "Project Kickoff: Building Convergence",
    description: "Starting from zero — defining goals, choosing the stack, and planning a spec-driven development approach.",
    content: "Convergence started as a portfolio project with a specific thesis: demonstrate deep distributed systems knowledge through a working product, not just a README.\n\nGoals:\n• Sub-200ms operation broadcast under normal conditions\n• 5+ concurrent participants editing shared state\n• Seamless offline-to-online reconciliation without data loss\n• Deterministic conflict resolution requiring no user intervention\n• Full property-based test coverage of mathematical invariants\n\nTech stack decisions:\n• Node.js + TypeScript — WebSocket concurrency via event loop, shared language with frontend SDK, strong typing\n• ws — Lightweight, spec-compliant WebSocket implementation\n• PostgreSQL — Durable append-only operation log, snapshot storage\n• Redis — Sub-50ms state cache, presence tracking, pub/sub\n• vitest + fast-check — Property-based testing for CRDT correctness\n• Next.js 14 — App Router for the frontend showcase\n\nDevelopment approach: spec-driven with formal requirements → design → implementation plan → property-based tests → implementation. Every feature starts with correctness properties before writing code.\n\nThe project would evolve through: V1 (backend engine) → V2 (platform with frontend + Rust performance) → V3 (individual app experiences).",
    date: "November 2025",
    readTime: "5 min",
    tag: "Meta",
    status: "published",
  },
];

// ---------------------------------------------------------------------------
// Blog Page Component
// ---------------------------------------------------------------------------

export default function BlogPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" />
            Back to Convergence
          </Link>
          <a
            href="https://github.com/nooblancer/collaborative-sync-engine"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <Github className="h-5 w-5" />
          </a>
        </div>
      </header>

      {/* Blog Title */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-16 pb-12">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground">
          Build Log
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          The journey of building a production-grade CRDT sync engine — from architecture decisions to 267K ops/sec engine throughput.
        </p>
      </div>

      {/* Posts */}
      <main className="max-w-3xl mx-auto px-4 sm:px-6 pb-24">
        <div className="space-y-0">
          {posts.map((post, index) => (
            <article
              key={post.slug}
              className="group relative border-b border-border/50 py-8 first:pt-0"
            >
              {/* Meta */}
              <div className="flex items-center gap-3 mb-3 text-xs">
                <span className={
                  post.tag === "Release" ? "text-accent font-medium" :
                  post.tag === "Roadmap" ? "text-warning font-medium" :
                  "text-muted-foreground"
                }>
                  {post.tag}
                </span>
                <span className="text-border">·</span>
                <span className="text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {post.date}
                </span>
                <span className="text-border">·</span>
                <span className="text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {post.readTime}
                </span>
                {post.status === "current" && (
                  <>
                    <span className="text-border">·</span>
                    <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-success/10 text-success">Latest</span>
                  </>
                )}
                {post.status === "planned" && (
                  <>
                    <span className="text-border">·</span>
                    <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-warning/10 text-warning">Planned</span>
                  </>
                )}
              </div>

              {/* Title */}
              <h2 className="text-xl sm:text-2xl font-semibold text-foreground mb-2 leading-tight">
                {post.title}
              </h2>

              {/* Description */}
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                {post.description}
              </p>

              {/* Content (displayed as expanded excerpt) */}
              <div className="text-sm text-foreground/80 leading-relaxed whitespace-pre-line">
                {post.content}
              </div>

              {/* Divider decoration */}
              {index < posts.length - 1 && (
                <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
              )}
            </article>
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 flex items-center justify-between text-xs text-muted-foreground">
          <span>© 2026 Convergence</span>
          <a
            href="https://github.com/nooblancer/collaborative-sync-engine"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            View Source on GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
