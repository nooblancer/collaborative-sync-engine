-- Migration 004: Create room_snapshots table for V2 room state snapshots
CREATE TABLE IF NOT EXISTS room_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id VARCHAR(64) NOT NULL,
    snapshot_data JSONB NOT NULL,
    operation_count INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_room_snapshots_room ON room_snapshots (room_id, created_at DESC);
