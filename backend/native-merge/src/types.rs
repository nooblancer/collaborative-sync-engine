//! Data structures mirroring the TypeScript CRDT types.
//! These are serialized/deserialized via JSON through napi-rs Buffer interface.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// HLC (Hybrid Logical Clock) timestamp.
/// Provides causal ordering without centralized coordination.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HLCTimestamp {
    /// Milliseconds since epoch
    pub wall_time: i64,
    /// Logical counter for same-wallTime events
    pub logical: i64,
    /// Originating node identifier (used for deterministic tiebreaking)
    pub node_id: String,
}

/// LWW (Last Writer Wins) Register holding a single field value with its timestamp.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LWWRegister {
    pub value: serde_json::Value,
    pub timestamp: HLCTimestamp,
    pub replica_id: String,
}

/// An append-only sequence segment for freehand path points.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct AppendOnlySegment {
    pub replica_id: String,
    pub start_index: usize,
    pub data: Vec<serde_json::Value>,
    pub timestamp: HLCTimestamp,
}

/// LWW Element representing a single item in the LWW-Element-Set.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LWWElement {
    pub item_id: String,
    pub fields: HashMap<String, LWWRegister>,
    pub added_at: HLCTimestamp,
    /// null means item is active; set means tombstoned
    pub removed_at: Option<HLCTimestamp>,
}

/// Full CRDT state for a session/room.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CRDTState {
    pub session_id: String,
    pub items: HashMap<String, LWWElement>,
    pub version: u64,
    pub last_updated: HLCTimestamp,
}

/// Operation type enum.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum OperationType {
    Add,
    Remove,
    Update,
}

/// A single CRDT operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CRDTOperation {
    pub id: String,
    pub session_id: String,
    pub replica_id: String,
    #[serde(rename = "type")]
    pub op_type: OperationType,
    pub item_id: String,
    pub payload: HashMap<String, serde_json::Value>,
    pub timestamp: HLCTimestamp,
    pub version: u64,
}

/// A single item change within a delta.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemChange {
    pub item_id: String,
    #[serde(rename = "type")]
    pub change_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fields: Option<HashMap<String, serde_json::Value>>,
}

/// State delta representing the changed portion of state after a merge.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StateDelta {
    pub session_id: String,
    pub changes: Vec<ItemChange>,
    pub timestamp: HLCTimestamp,
}

/// Error describing why an operation failed.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationError {
    pub operation_id: String,
    pub code: String,
    pub message: String,
}

/// Result of merging a single operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeResultData {
    pub success: bool,
    pub operation_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delta: Option<StateDelta>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<OperationError>,
    pub state: CRDTState,
}

/// Result of merging a batch of operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchMergeResultData {
    pub total_received: usize,
    pub merged: usize,
    pub failed: Vec<OperationError>,
    pub final_delta: StateDelta,
    pub state: CRDTState,
}

/// Lightweight result for benchmark-optimized batch merge.
/// Only tracks metrics needed for benchmarking — no delta, no per-op results.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkMergeResult {
    pub total_received: usize,
    pub merged: usize,
    pub conflicts: usize,
    pub failed: usize,
    pub item_count: usize,
    pub state: CRDTState,
}
