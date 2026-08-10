# Changelog

All notable changes to the Collaborative Sync Engine project.

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
  - Operation serialization (≤1KB per single-field op) with retry logic
  - WebSocket connection management with auto-reconnect

- **Connection Manager** — WebSocket server with full lifecycle management
  - JWT authentication (malformed/expired/unauthorized classification)
  - Token refresh on active connections with 30-second grace period
  - Heartbeat ping/pong with stale connection detection
  - Presence tracking (join/leave events within 2 seconds)
  - Display name validation (1-100 characters)
  - Maximum concurrent connection enforcement per session
  - Message routing (operations, presence requests, token refresh)
  - Missed update queuing (1,000 deltas, 24-hour TTL) with resync trigger

- **Persistence Layer** — Durable storage with fast caching
  - PostgreSQL operation log with indexed queries
  - Redis state caching (1-hour TTL, refreshed on write)
  - Presence hash storage and atomic connection counting
  - State snapshots at configurable intervals (≤10 minutes)
  - State recovery via snapshot + operation replay (≤1,000 ops)

- **Sync Engine Coordinator** — Full operation processing pipeline
  - Validate → merge → persist → ACK → broadcast delta
  - Batch processing (1,000 ops in <5 seconds)
  - Stale version detection with resync-required response
  - State caching and retrieval

- **Integration Wiring** — Complete server application
  - Environment-based configuration
  - HTTP health check endpoint
  - Graceful shutdown (SIGINT/SIGTERM)
  - `createServer()` for programmatic use

- **Testing** — 268 tests across 22 test files
  - 21 property-based tests (fast-check) validating CRDT mathematical properties
  - Unit tests for all modules
  - Integration tests with 5 concurrent WebSocket clients
  - Propagation latency verification (<200ms)

- **Demo** — Interactive web frontend
  - Real-time collaborative inventory management
  - Multiple browser tabs as separate users
  - Presence indicators
  - Event log visualization
