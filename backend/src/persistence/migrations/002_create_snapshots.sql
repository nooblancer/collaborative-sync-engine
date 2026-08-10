-- Migration 002: Create snapshots table for point-in-time state captures
CREATE TABLE IF NOT EXISTS snapshots (
    id UUID PRIMARY KEY,
    session_id VARCHAR(64) NOT NULL,
    state JSONB NOT NULL,
    operation_count INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snapshots_session ON snapshots (session_id, created_at DESC);
