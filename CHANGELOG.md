# Changelog

All notable changes to the Collaborative Sync Engine project.

## [1.1.0] - 2025-08-11

### Added

- **Next.js 14 Frontend** — Full-featured web application replacing the embedded HTML demo
  - Landing page with hero, architecture diagram, features, CRDT properties table, and tech stack sections
  - Interactive demo page with real-time collaborative inventory management
  - WebSocket hook with auto-reconnect, ping/pong, and pub/sub message routing
  - Presence tracking hook with join/leave events and 5-second refresh
  - Inventory hook with optimistic updates, quantity clamping, and delta merge
  - Event log component with capacity cap (50 entries) and color-coded types
  - Dark-first theme with muted teal/cyan accent colors
  - Responsive layout (mobile single-column, desktop multi-column)
  - 92 frontend tests (unit, property-based, integration)
  - 12 property-based tests validating frontend correctness invariants

- **Token Endpoint** — Backend now serves `/token` for JWT issuance
  - Accepts userId, displayName, and sessionId as query parameters
  - Returns a signed JWT valid for 1 hour
  - CORS headers for cross-origin frontend access

### Changed

- **Monorepo structure** — Project reorganized into `backend/` and `frontend/` directories
  - Root `package.json` with monorepo scripts (`dev`, `build`, `test`, `install:all`)
  - Each package has its own `package.json`, `tsconfig.json`, and test configuration
  - Shared `.gitignore` covers both packages

### Removed

- `demo.ts` — CLI demo (superseded by the frontend demo page)
- `demo-frontend.ts` — Embedded HTML demo (superseded by the Next.js frontend)
- `data/` directory — Local queue replica files (development artifact)
- `.nvmrc`, `.editorconfig` — Unnecessary config files

---

## [1.0.0] - 2025-01-27

### Added

- **CRDT Engine** — LWW-Element-Set implementation with Hybrid Logical Clock timestamps
  - Commutative, associative, and idempotent merge operations
  - Field-level Last-Write-Wins conflict resolution
  - Remove-wins semantics for concurrent remove + update
  - Deterministic tiebreaker via lexicographic replica ID comparison
  - Delta computation for minimal broadcast payloads

- **Client SDK** — Local-first architecture with offline support
  - Local replica management with sub-100ms operation application
  - Operation queue (10,000 capacity) with file-based persistence
  - Reconnection transmission cap (1,000 most recent operations)
  - ACK-based queue removal
  - High-level API: `add()`, `remove()`, `update()` with inventory validation
  - Operation serialization with retry logic
  - WebSocket connection management with auto-reconnect

- **Connection Manager** — WebSocket server with full lifecycle management
  - JWT authentication (malformed/expired/unauthorized classification)
  - Token refresh on active connections with 30-second grace period
  - Heartbeat ping/pong with stale connection detection
  - Presence tracking (join/leave events within 2 seconds)
  - Maximum concurrent connection enforcement per session
  - Missed update queuing (1,000 deltas, 24-hour TTL) with resync trigger

- **Persistence Layer** — Durable storage with fast caching
  - PostgreSQL operation log with indexed queries
  - Redis state caching (1-hour TTL, refreshed on write)
  - State snapshots at configurable intervals
  - State recovery via snapshot + operation replay

- **Sync Engine Coordinator** — Full operation processing pipeline
  - Validate → merge → persist → ACK → broadcast delta
  - Batch processing (1,000 ops in <5 seconds)

- **Testing** — 268 tests across 22 test files
  - 21 property-based tests validating CRDT mathematical properties
  - Unit tests for all modules
  - Integration tests with 5 concurrent WebSocket clients
