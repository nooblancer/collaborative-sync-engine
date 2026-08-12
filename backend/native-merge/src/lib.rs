//! Native CRDT Merge Addon for the Collaborative Sync Engine.
//!
//! Implements CPU-bound CRDT merge computations at near-native speed via napi-rs.
//! Handles LWW (Last Writer Wins) conflict resolution, remove-wins semantics,
//! append-only merge for freehand paths, and HLC timestamp comparison.

mod types;
mod merge;
mod hlc;
mod snapshot;

use napi::bindgen_prelude::*;
use napi_derive::napi;

use crate::types::{CRDTState, CRDTOperation, HLCTimestamp};
use crate::merge::{apply_merge_operation, apply_merge_batch, apply_merge_batch_benchmark};
use crate::hlc::compare_hlc_timestamps;
use crate::snapshot::compute_state_snapshot;

/// Merge a single operation into state.
/// Returns a Buffer containing the serialized MergeResult (new state + delta).
#[napi]
pub fn merge_operation(state: Buffer, operation: Buffer) -> Result<Buffer> {
    let state: CRDTState = serde_json::from_slice(&state)
        .map_err(|e| Error::new(Status::InvalidArg, format!("Failed to deserialize state: {}", e)))?;
    let op: CRDTOperation = serde_json::from_slice(&operation)
        .map_err(|e| Error::new(Status::InvalidArg, format!("Failed to deserialize operation: {}", e)))?;

    let result = apply_merge_operation(state, op);

    let serialized = serde_json::to_vec(&result)
        .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to serialize result: {}", e)))?;

    Ok(Buffer::from(serialized))
}

/// Merge a batch of operations sequentially into state.
/// Returns a Buffer containing the serialized BatchMergeResult.
#[napi]
pub fn merge_batch(state: Buffer, operations: Vec<Buffer>) -> Result<Buffer> {
    let state: CRDTState = serde_json::from_slice(&state)
        .map_err(|e| Error::new(Status::InvalidArg, format!("Failed to deserialize state: {}", e)))?;

    let ops: Vec<CRDTOperation> = operations
        .iter()
        .map(|buf| {
            serde_json::from_slice(buf)
                .map_err(|e| Error::new(Status::InvalidArg, format!("Failed to deserialize operation: {}", e)))
        })
        .collect::<Result<Vec<_>>>()?;

    let result = apply_merge_batch(state, ops);

    let serialized = serde_json::to_vec(&result)
        .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to serialize result: {}", e)))?;

    Ok(Buffer::from(serialized))
}

/// Compare two HLC timestamps.
/// Returns -1 if a < b, 0 if a == b, 1 if a > b.
#[napi]
pub fn compare_hlc(a: Buffer, b: Buffer) -> Result<i32> {
    let ts_a: HLCTimestamp = serde_json::from_slice(&a)
        .map_err(|e| Error::new(Status::InvalidArg, format!("Failed to deserialize timestamp a: {}", e)))?;
    let ts_b: HLCTimestamp = serde_json::from_slice(&b)
        .map_err(|e| Error::new(Status::InvalidArg, format!("Failed to deserialize timestamp b: {}", e)))?;

    Ok(compare_hlc_timestamps(&ts_a, &ts_b))
}

/// Compute a state snapshot: consolidate state and remove tombstones.
/// Returns a Buffer containing the cleaned-up state.
#[napi]
pub fn compute_snapshot(state: Buffer) -> Result<Buffer> {
    let state: CRDTState = serde_json::from_slice(&state)
        .map_err(|e| Error::new(Status::InvalidArg, format!("Failed to deserialize state: {}", e)))?;

    let snapshot = compute_state_snapshot(state);

    let serialized = serde_json::to_vec(&snapshot)
        .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to serialize snapshot: {}", e)))?;

    Ok(Buffer::from(serialized))
}

/// Optimized benchmark merge: processes all operations in one Rust call.
/// No intermediate serialization, no state cloning per operation.
/// Returns a lightweight BenchmarkMergeResult with just the metrics + final state.
///
/// This is O(n) per operation (HashMap lookup + insert) instead of O(n²)
/// from the clone-per-op approach in the standard merge_batch.
#[napi]
pub fn merge_batch_benchmark(state: Buffer, operations: Vec<Buffer>) -> Result<Buffer> {
    let state: CRDTState = serde_json::from_slice(&state)
        .map_err(|e| Error::new(Status::InvalidArg, format!("Failed to deserialize state: {}", e)))?;

    let ops: Vec<CRDTOperation> = operations
        .iter()
        .map(|buf| {
            serde_json::from_slice(buf)
                .map_err(|e| Error::new(Status::InvalidArg, format!("Failed to deserialize operation: {}", e)))
        })
        .collect::<Result<Vec<_>>>()?;

    let result = apply_merge_batch_benchmark(state, ops);

    let serialized = serde_json::to_vec(&result)
        .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to serialize result: {}", e)))?;

    Ok(Buffer::from(serialized))
}
