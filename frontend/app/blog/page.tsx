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
    slug: "v2-2-polish",
    title: "V2.2: Frontend Polish, Bug Fixes & Deployment",
    description: "Fixing 10 landing page bugs, rewriting the architecture diagram in pure CSS, dual-bot whiteboard, and deploying to Vercel + Render.",
    content: "This release was born from actually using the landing page and realizing... nothing worked.\n\nThe WebSocket demos showed 'disconnected' or 'reconnecting' because the frontend sent commands before the server acknowledged the connection. The architecture diagram was an SVG/CSS coordinate nightmare where nodes and arrows existed in different coordinate spaces. The stress test sent operations typed 'create' but the backend expected 'add'.\n\nKey fixes:\n• Rebuilt the architecture diagram as pure HTML/CSS flexbox — no more SVG coordinate math\n• Fixed V2 protocol handshake: wait for 'connected' ack before sending room commands\n• Fixed operation type mapping: 'create'→'add', 'delete'→'remove'\n• Fixed backend handleCreateRoom: it created rooms but never added the client as a participant\n• Added dual-bot whiteboard system (BotAlice + BotBob) with start/stop toggles\n• Added batch card operations (add 1-100 at once) in split-screen\n• Replaced real metrics/conflict panels with simulated data for the landing page\n• Removed sustained mode from stress test (it was just a slower burst with no demo value)\n• Added /blog page with full build log\n• Added GitHub Source Code button, tech stack icons\n\nDeployment:\n• Frontend deployed to Vercel (auto-deploys on push)\n• Backend deployed to Render (free tier, WebSocket-compatible)\n• Environment variables wire the frontend to the production backend via wss://\n\nThe lesson: integration testing between frontend protocol assumptions and backend responses is where bugs hide. And always rebuild your dist/ before testing.",
    date: "May 2026",
    readTime: "7 min",
    tag: "Release",
    status: "current",
  },
  {
    slug: "v2-platform",
    title: "V2: From Sync Engine to Portfolio Platform",
    description: "The complete rewrite: native Rust merge addon, channel-multiplexed WebSocket, batch processor, and 5 interactive demos that connect to a live backend.",
    content: "V1 was a backend library. V2 turned it into something you can show people.\n\nThe headline number — 50,000 ops/sec — comes from the native Rust addon (napi-rs). The TypeScript merge path topped out around 5K ops/sec for complex operations. By moving the hot path to Rust, we kept Node.js for what it's good at (I/O, WebSocket routing) and let Rust handle the CPU-bound CRDT math.\n\nThe V2 protocol consolidates everything into a single WebSocket per room with four logical channels:\n• Operations — reliable, persisted, ACK'd\n• Awareness — fire-and-forget at 60fps (cursor positions)\n• Metrics — server-push at 1s intervals\n• Control — room management, simulation commands\n\nThe batch processor buffers operations for 1-5ms windows, then processes them as a single merge-persist-broadcast cycle. Above 50 ops in a batch, it offloads to worker_threads for parallel merge.\n\nThe frontend showcases all of this through live demos: a stress tester that floods the engine, a whiteboard with simulated collaborators, split-screen bidirectional sync, and live metrics/conflict panels.",
    date: "April 2026",
    readTime: "8 min",
    tag: "Release",
    status: "published",
  },
  {
    slug: "property-testing",
    title: "43 Properties: Testing CRDTs with fast-check",
    description: "Property-based testing isn't just for academics. Here's how we used it to find real bugs in merge logic, queue ordering, and protocol sequencing.",
    content: "CRDTs have mathematical properties that must hold universally. Property-based testing generates thousands of random inputs and checks these invariants:\n\n• Commutativity: merge(state, A, B) = merge(state, B, A)\n• Associativity: merge(merge(state, A, B), C) = merge(state, A, merge(state, B, C))\n• Idempotence: merge(merge(state, A), A) = merge(state, A)\n• Remove-wins: concurrent remove + update → item stays deleted\n• Queue ordering: persist → restore produces identical ordering\n• Serialization round-trip: serialize → deserialize = identity\n• Reconnection cap: only most recent 1000 ops transmitted\n\nWe use fast-check (TypeScript) for the Node.js codebase. Each property generates arbitrary operations, timestamps, and state configurations. In the first week, PBT found 3 bugs that unit tests missed:\n1. An off-by-one in HLC comparison when wallTime was equal\n2. A queue capacity edge case at exactly 10,000 operations\n3. A delta computation that included unchanged fields\n\nThe bug-condition methodology in our bugfix spec also uses PBT: write a test that encodes expected behavior, run it against unfixed code (should fail), fix the code, re-run (should pass).",
    date: "March 2026",
    readTime: "7 min",
    tag: "Engineering",
    status: "published",
  },
  {
    slug: "v2-protocol",
    title: "Designing the Channel-Multiplexed WebSocket Protocol",
    description: "Why one connection per room, four logical channels, and a strict handshake sequence — plus the bugs that taught us why protocol sequencing matters.",
    content: "The V1 protocol was simple: open WebSocket, send JSON, get JSON back. V2 needed to support four distinct communication patterns over a single connection:\n\n1. Operations need reliability (ACKs, ordering, persistence)\n2. Awareness needs speed (cursor positions at 60fps, no persistence)\n3. Metrics need server-push (1-second intervals, no client request)\n4. Control needs request/response (room create/join, simulation commands)\n\nThe protocol handshake:\n• Client connects with ?token=JWT\n• Server validates JWT, sends { type: 'control-response', payload: { type: 'connected', clientId } }\n• Client sends create-room or join-room\n• Server confirms with room state\n• Client can now send ops/awareness on that room\n\nThe sequencing bug that bit us: demo components sent create-room immediately in ws.onopen, before the server's 'connected' acknowledgment arrived. The server rejected these because it hadn't associated the client yet. The fix was straightforward (wait for ack), but finding it required tracing the full message flow from frontend → backend → response.\n\nAnother bug: the frontend checked for 'room-created' in responses but the backend sent 'create-room' with status 'created'. Type naming mismatches across the protocol boundary are invisible until you trace actual messages.",
    date: "February 2026",
    readTime: "6 min",
    tag: "Protocol",
    status: "published",
  },
  {
    slug: "v1-release",
    title: "V1: A CRDT Sync Engine in TypeScript",
    description: "The initial build: LWW-Element-Set merge, Hybrid Logical Clocks, WebSocket connection management, offline queues, and 21 formal correctness properties.",
    content: "The goal was clear: build a distributed sync engine from scratch that guarantees convergence without coordination.\n\nCore components:\n• Sync Engine — LWW-Element-Set merge with field-level last-writer-wins. Remove-wins semantics for deletions. Delta computation for minimal broadcasting.\n• Hybrid Logical Clock — Combines wall-clock time with logical counters for causal ordering. Deterministic tiebreaker via lexicographic nodeId when timestamps are equal.\n• Connection Manager — WebSocket gateway with JWT auth, 30s heartbeat + 10s timeout, presence tracking, missed-update queuing (max 1000 ops / 24h).\n• Client SDK — Local replica, 10K-operation offline queue with file-based persistence, exponential backoff reconnection, ACK-based dequeue.\n• Persistence — PostgreSQL for durable operation log + snapshots (every 10min / 1000 ops), Redis for state cache (<50ms reads) + presence hashes.\n\n21 properties tested:\n• Merge: commutativity, associativity, idempotence, remove-wins\n• Clock: total ordering, deterministic tiebreak\n• Queue: FIFO ordering, persistence round-trip, capacity limits, ACK removal, reconnection cap\n• SDK: API translation correctness, serialization round-trip, incoming operation application, item validation\n• Connection: presence data integrity, auth error classification, missed update queue integrity\n• Persistence: state recovery via replay\n• Engine: partial batch merge correctness\n\nAll implemented with vitest + fast-check. The entire backend has zero runtime dependencies beyond ws, ioredis, pg, uuid, and jsonwebtoken.",
    date: "February 2026",
    readTime: "9 min",
    tag: "Release",
    status: "published",
  },
  {
    slug: "architecture-decisions",
    title: "Why CRDTs? Architecture Decisions for Real-Time Collaboration",
    description: "OT vs CRDT, centralized vs decoupled, LWW vs vector clocks — the design decisions behind Convergence.",
    content: "The first decision: Operational Transformation (OT) or CRDTs?\n\nOT (used by Google Docs) transforms operations against concurrent edits. It requires a central server to establish operation order. CRDTs guarantee convergence mathematically — any replica can merge operations in any order and reach the same state.\n\nWe chose CRDTs because:\n• No central coordination required (operations can merge in any order)\n• Natural fit for offline-first (queue locally, merge on reconnect)\n• Mathematical correctness guarantees (provable convergence)\n• Educational value (implementing LWW from scratch teaches distributed systems deeply)\n\nWithin CRDTs, we chose LWW-Element-Set because:\n• Simple mental model (last edit wins, period)\n• Efficient (single timestamp comparison per field)\n• Deterministic (HLC + nodeId tiebreaker means no ambiguity ever)\n• Good enough for most collaborative apps (documents, inventory, dashboards)\n\nThe tradeoff: LWW can 'lose' concurrent edits (the earlier write disappears). For text editing you'd want a sequence CRDT (Yjs, Automerge). For our inventory/state sync use case, LWW is perfect.\n\nLocal-first architecture:\n• Client applies operations immediately (sub-100ms local feedback)\n• Operations queued and sent asynchronously\n• Server merges, persists, broadcasts deltas\n• On reconnect: replay queued ops, receive missed deltas, converge\n\nThis gives users instant responsiveness while guaranteeing eventual consistency across all replicas.",
    date: "January 2026",
    readTime: "7 min",
    tag: "Architecture",
    status: "published",
  },
  {
    slug: "kickoff",
    title: "Project Kickoff: Building Convergence",
    description: "Starting from zero — defining goals, choosing the stack, and planning a spec-driven development approach.",
    content: "Convergence started as a portfolio project with a specific thesis: demonstrate deep distributed systems knowledge through a working product, not just a README.\n\nGoals:\n• Sub-200ms operation broadcast under normal conditions\n• 5+ concurrent participants editing shared state\n• Seamless offline-to-online reconciliation without data loss\n• Deterministic conflict resolution requiring no user intervention\n• Full property-based test coverage of mathematical invariants\n\nTech stack decisions:\n• Node.js + TypeScript — WebSocket concurrency via event loop, shared language with frontend SDK, strong typing\n• ws — Lightweight, spec-compliant WebSocket implementation\n• PostgreSQL — Durable append-only operation log, snapshot storage\n• Redis — Sub-50ms state cache, presence tracking, pub/sub\n• vitest + fast-check — Property-based testing for CRDT correctness\n• Next.js 14 — App Router for the frontend showcase\n\nDevelopment approach: spec-driven with formal requirements → design → implementation plan → property-based tests → implementation. Every feature starts with correctness properties before writing code.\n\nThe project would evolve through: V1 (backend engine) → V2 (platform with frontend + Rust performance) → V3 (individual app experiences).",
    date: "December 2025",
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
          The journey of building a production-grade CRDT sync engine — from architecture decisions to 50K ops/sec.
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
