//! Native CRDT Merge Addon for the Collaborative Sync Engine.
//!
//! Implements CPU-bound CRDT merge computations at near-native speed via napi-rs.
//! Handles LWW (Last Writer Wins) conflict resolution, remove-wins semantics,
//! append-only merge for freehand paths, and HLC timestamp comparison.

mod types;
mod merge;
mod hlc;
mod snapshot;

use std::collections::HashMap;
use std::sync::Mutex;

use lazy_static::lazy_static;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use rayon::prelude::*;

use crate::types::{CRDTState, CRDTOperation, HLCTimestamp};
use crate::merge::{apply_merge_operation, apply_merge_batch, apply_merge_batch_benchmark, apply_merge_in_place};
use crate::hlc::compare_hlc_timestamps;
use crate::snapshot::compute_state_snapshot;

// ─── Room State Store ────────────────────────────────────────────────────────

lazy_static! {
    static ref ROOM_STATE_STORE: Mutex<HashMap<String, CRDTState>> =
        Mutex::new(HashMap::new());
}

/// Creates an empty CRDTState for the given room_id.
fn empty_state(room_id: &str) -> CRDTState {
    CRDTState {
        session_id: room_id.to_string(),
        items: HashMap::new(),
        version: 0,
        last_updated: HLCTimestamp {
            wall_time: 0,
            logical: 0,
            node_id: room_id.to_string(),
        },
    }
}

// ─── simd-json Deserialization Helpers ───────────────────────────────────────

/// Deserialize a CRDTOperation from a byte slice using simd-json.
fn deser_operation(buf: &[u8]) -> Result<CRDTOperation> {
    let mut bytes = buf.to_vec();
    simd_json::from_slice(&mut bytes)
        .map_err(|e| Error::new(Status::InvalidArg, format!("Failed to deserialize operation: {}", e)))
}

/// Deserialize a CRDTState from a byte slice using simd-json.
fn deser_state(buf: &[u8]) -> Result<CRDTState> {
    let mut bytes = buf.to_vec();
    simd_json::from_slice(&mut bytes)
        .map_err(|e| Error::new(Status::InvalidArg, format!("Failed to deserialize state: {}", e)))
}

// ─── Rayon Gated Parallel Deserialization ────────────────────────────────────

const PARALLEL_THRESHOLD: usize = 100_000;

/// Deserialize a slice of Buffers into CRDTOperations.
/// Uses Rayon par_iter if above PARALLEL_THRESHOLD, sequential iter otherwise.
fn deserialize_ops(buffers: &[Buffer]) -> Result<Vec<CRDTOperation>> {
    if buffers.len() > PARALLEL_THRESHOLD {
        // Collect byte slices first so Rayon can work with Send-able data
        let slices: Vec<&[u8]> = buffers.iter().map(|b| b.as_ref()).collect();
        slices.par_iter()
            .map(|buf| deser_operation(buf))
            .collect::<Result<Vec<_>>>()
    } else {
        buffers.iter()
            .map(|buf| deser_operation(buf))
            .collect::<Result<Vec<_>>>()
    }
}

// ─── Room-Based napi Functions ───────────────────────────────────────────────

/// Create a room in the state store. Idempotent — no-op if room already exists.
#[napi]
pub fn create_room(room_id: String) -> Result<()> {
    let mut store = ROOM_STATE_STORE.lock()
        .map_err(|_| Error::new(Status::GenericFailure, "State lock poisoned"))?;
    store.entry(room_id.clone()).or_insert_with(|| empty_state(&room_id));
    Ok(())
}

/// Drop a room from the state store. Idempotent — no error if room doesn't exist.
#[napi]
pub fn drop_room(room_id: String) -> Result<()> {
    let mut store = ROOM_STATE_STORE.lock()
        .map_err(|_| Error::new(Status::GenericFailure, "State lock poisoned"))?;
    store.remove(&room_id);
    Ok(())
}

/// Get the full serialized state for a room. Errors if room not found.
#[napi]
pub fn get_state(room_id: String) -> Result<Buffer> {
    let store = ROOM_STATE_STORE.lock()
        .map_err(|_| Error::new(Status::GenericFailure, "State lock poisoned"))?;

    let state = store.get(&room_id)
        .ok_or_else(|| Error::new(Status::InvalidArg,
            format!("Room \"{}\" is not initialized.", room_id)))?;

    let serialized = serde_json::to_vec(state)
        .map_err(|e| Error::new(Status::GenericFailure, format!("Serialize state: {}", e)))?;

    Ok(Buffer::from(serialized))
}

/// Merge operations into a room's state in-place. Returns a delta Buffer.
/// Errors if room not found.
#[napi]
pub fn merge_ops(room_id: String, operations: Vec<Buffer>) -> Result<Buffer> {
    // 1. Deserialize ops (simd-json + Rayon if > threshold)
    let ops = deserialize_ops(&operations)?;

    // 2. Acquire lock, apply merge in-place
    let mut store = ROOM_STATE_STORE.lock()
        .map_err(|_| Error::new(Status::GenericFailure, "State lock poisoned"))?;

    let state = store.get_mut(&room_id)
        .ok_or_else(|| Error::new(Status::InvalidArg,
            format!("Room \"{}\" is not initialized. Call create_room first.", room_id)))?;

    let delta = apply_merge_in_place(state, ops, &room_id);

    // 3. Serialize the delta (small)
    let serialized = serde_json::to_vec(&delta)
        .map_err(|e| Error::new(Status::GenericFailure, format!("Serialize delta: {}", e)))?;

    Ok(Buffer::from(serialized))
}

// ─── Existing napi Functions (with simd-json + Rayon optimizations) ──────────

/// Merge a single operation into state.
/// Returns a Buffer containing the serialized MergeResult (new state + delta).
#[napi]
pub fn merge_operation(state: Buffer, operation: Buffer) -> Result<Buffer> {
    let state: CRDTState = deser_state(&state)?;
    let op: CRDTOperation = deser_operation(&operation)?;

    let result = apply_merge_operation(state, op);

    let serialized = serde_json::to_vec(&result)
        .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to serialize result: {}", e)))?;

    Ok(Buffer::from(serialized))
}

/// Merge a batch of operations sequentially into state.
/// Returns a Buffer containing the serialized BatchMergeResult.
#[napi]
pub fn merge_batch(state: Buffer, operations: Vec<Buffer>) -> Result<Buffer> {
    let state: CRDTState = deser_state(&state)?;
    let ops = deserialize_ops(&operations)?;

    let result = apply_merge_batch(state, ops);

    let serialized = serde_json::to_vec(&result)
        .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to serialize result: {}", e)))?;

    Ok(Buffer::from(serialized))
}

/// Compare two HLC timestamps.
/// Returns -1 if a < b, 0 if a == b, 1 if a > b.
#[napi]
pub fn compare_hlc(a: Buffer, b: Buffer) -> Result<i32> {
    let ts_a: HLCTimestamp = deser_state_as_hlc(&a)?;
    let ts_b: HLCTimestamp = deser_state_as_hlc(&b)?;

    Ok(compare_hlc_timestamps(&ts_a, &ts_b))
}

/// Helper to deserialize HLCTimestamp via simd-json.
fn deser_state_as_hlc(buf: &[u8]) -> Result<HLCTimestamp> {
    let mut bytes = buf.to_vec();
    simd_json::from_slice(&mut bytes)
        .map_err(|e| Error::new(Status::InvalidArg, format!("Failed to deserialize timestamp: {}", e)))
}

/// Compute a state snapshot: consolidate state and remove tombstones.
/// Returns a Buffer containing the cleaned-up state.
#[napi]
pub fn compute_snapshot(state: Buffer) -> Result<Buffer> {
    let state: CRDTState = deser_state(&state)?;

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
    let state: CRDTState = deser_state(&state)?;
    let ops = deserialize_ops(&operations)?;

    let result = apply_merge_batch_benchmark(state, ops);

    let serialized = serde_json::to_vec(&result)
        .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to serialize result: {}", e)))?;

    Ok(Buffer::from(serialized))
}
