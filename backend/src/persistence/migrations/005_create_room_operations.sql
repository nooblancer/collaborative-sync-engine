-- Migration 005: Create room_operations table for V2 append-only operation log with HLC fields
CREATE TABLE IF NOT EXISTS room_operations (
    id UUID PRIMARY KEY,
    room_id VARCHAR(64) NOT NULL,
    replica_id VARCHAR(64) NOT NULL,
    operation_type VARCHAR(16) NOT NULL,
    item_id VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL,
    hlc_wall_time BIGINT NOT NULL,
    hlc_logical INTEGER NOT NULL,
    hlc_node_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_room_ops_room_hlc ON room_operations (room_id, hlc_wall_time, hlc_logical);
CREATE INDEX IF NOT EXISTS idx_room_ops_room_created ON room_operations (room_id, created_at);
