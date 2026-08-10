-- Migration 001: Create operations table for CRDT operation log
CREATE TABLE IF NOT EXISTS operations (
    id UUID PRIMARY KEY,
    session_id VARCHAR(64) NOT NULL,
    replica_id VARCHAR(64) NOT NULL,
    type VARCHAR(10) NOT NULL CHECK (type IN ('add', 'remove', 'update')),
    item_id VARCHAR(128) NOT NULL,
    payload JSONB NOT NULL,
    wall_time BIGINT NOT NULL,
    logical_counter INTEGER NOT NULL,
    node_id VARCHAR(64) NOT NULL,
    version INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operations_session ON operations (session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_operations_version ON operations (session_id, version);
