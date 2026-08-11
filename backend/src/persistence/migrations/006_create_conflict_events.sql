-- Migration 006: Create conflict_events table for V2 conflict resolution tracking
CREATE TABLE IF NOT EXISTS conflict_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id VARCHAR(64) NOT NULL,
    field_name VARCHAR(128) NOT NULL,
    operation_a JSONB NOT NULL,
    operation_b JSONB NOT NULL,
    winner CHAR(1) NOT NULL,
    reason TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conflicts_room ON conflict_events (room_id, created_at DESC);
