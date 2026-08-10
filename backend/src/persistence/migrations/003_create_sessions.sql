-- Migration 003: Create sessions table for session metadata
CREATE TABLE IF NOT EXISTS sessions (
    id VARCHAR(64) PRIMARY KEY,
    created_by VARCHAR(64) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    max_connections INTEGER DEFAULT 50,
    is_active BOOLEAN DEFAULT TRUE
);
