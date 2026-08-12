//! CRDT merge logic implementing LWW-Element-Set semantics.
//!
//! Merge rules:
//! - Add: Creates or merges fields into an LWWElement using field-level LWW
//! - Remove: Sets removedAt on existing item (remove-wins semantics)
//! - Update: Field-level LWW using timestamp comparison
//!
//! All merge operations are commutative, associative, and idempotent.

use std::collections::HashMap;

use crate::hlc::{compare_hlc_timestamps, max_timestamp};
use crate::types::{
    BatchMergeResultData, BenchmarkMergeResult, CRDTOperation, CRDTState, HLCTimestamp, ItemChange, LWWElement,
    LWWRegister, MergeResultData, OperationError, OperationType, StateDelta,
};

/// Apply a single CRDT operation to state, returning the new state and a delta.
pub fn apply_merge_operation(mut state: CRDTState, operation: CRDTOperation) -> MergeResultData {
    match operation.op_type {
        OperationType::Add => handle_add(&mut state, &operation),
        OperationType::Remove => handle_remove(&mut state, &operation),
        OperationType::Update => handle_update(&mut state, &operation),
    }
}

/// Apply a batch of operations sequentially to state.
pub fn apply_merge_batch(mut state: CRDTState, operations: Vec<CRDTOperation>) -> BatchMergeResultData {
    let total_received = operations.len();
    let mut merged = 0usize;
    let mut failed: Vec<OperationError> = Vec::new();
    let mut all_changes: Vec<ItemChange> = Vec::new();
    let mut last_timestamp = state.last_updated.clone();

    for op in operations {
        let op_timestamp = op.timestamp.clone();
        let result = apply_merge_operation(state, op);
        state = result.state;

        if result.success {
            merged += 1;
            if let Some(delta) = &result.delta {
                all_changes.extend(delta.changes.clone());
                last_timestamp = max_timestamp(&last_timestamp, &delta.timestamp);
            }
        } else if let Some(err) = result.error {
            failed.push(err);
        }

        last_timestamp = max_timestamp(&last_timestamp, &op_timestamp);
    }

    BatchMergeResultData {
        total_received,
        merged,
        failed,
        final_delta: StateDelta {
            session_id: state.session_id.clone(),
            changes: all_changes,
            timestamp: last_timestamp,
        },
        state,
    }
}

/// Optimized batch merge for benchmarking — O(n) instead of O(n²).
///
/// Key differences from `apply_merge_batch`:
/// 1. Mutates state in-place — NO state.clone() per operation
/// 2. Does not build change deltas — only counts conflicts
/// 3. Returns lightweight BenchmarkMergeResult
///
/// This processes 500k operations in seconds instead of minutes.
pub fn apply_merge_batch_benchmark(mut state: CRDTState, operations: Vec<CRDTOperation>) -> BenchmarkMergeResult {
    use crate::types::BenchmarkMergeResult;

    let total_received = operations.len();
    let mut merged = 0usize;
    let mut conflicts = 0usize;
    let mut failed_count = 0usize;

    for op in operations {
        let op_timestamp = op.timestamp.clone();
        let item_id = op.item_id.clone();

        match op.op_type {
            OperationType::Add => {
                if let Some(existing) = state.items.get_mut(&item_id) {
                    // Item exists — merge field-by-field in place (conflict)
                    let mut has_changes = false;
                    for (key, value) in &op.payload {
                        if merge_field(&mut existing.fields, key, value.clone(), &op.timestamp, &op.replica_id) {
                            has_changes = true;
                        }
                    }
                    // Update addedAt to max
                    let new_added_at = max_timestamp(&existing.added_at, &op.timestamp);
                    if compare_hlc_timestamps(&new_added_at, &existing.added_at) != 0 {
                        existing.added_at = new_added_at;
                        has_changes = true;
                    }
                    if has_changes {
                        conflicts += 1;
                    }
                    merged += 1;
                } else {
                    // New item — insert directly
                    let mut fields: HashMap<String, LWWRegister> = HashMap::new();
                    for (key, value) in &op.payload {
                        fields.insert(key.clone(), LWWRegister {
                            value: value.clone(),
                            timestamp: op.timestamp.clone(),
                            replica_id: op.replica_id.clone(),
                        });
                    }
                    state.items.insert(item_id, LWWElement {
                        item_id: op.item_id.clone(),
                        fields,
                        added_at: op.timestamp.clone(),
                        removed_at: None,
                    });
                    merged += 1;
                }
            }
            OperationType::Remove => {
                if let Some(existing) = state.items.get_mut(&item_id) {
                    let new_removed_at = match &existing.removed_at {
                        Some(existing_removed) => max_timestamp(existing_removed, &op.timestamp),
                        None => op.timestamp.clone(),
                    };
                    // Only update if timestamp actually changed
                    let changed = match &existing.removed_at {
                        Some(existing_removed) => compare_hlc_timestamps(&new_removed_at, existing_removed) != 0,
                        None => true,
                    };
                    if changed {
                        existing.removed_at = Some(new_removed_at);
                    }
                    merged += 1;
                } else {
                    // Item doesn't exist — no-op but still counts as merged
                    merged += 1;
                }
            }
            OperationType::Update => {
                if let Some(existing) = state.items.get_mut(&item_id) {
                    let mut has_changes = false;
                    for (key, value) in &op.payload {
                        if merge_field(&mut existing.fields, key, value.clone(), &op.timestamp, &op.replica_id) {
                            has_changes = true;
                        }
                    }
                    if has_changes {
                        conflicts += 1;
                    }
                    merged += 1;
                } else {
                    // Item doesn't exist — failed
                    failed_count += 1;
                }
            }
        }

        // Update state metadata
        state.version += 1;
        state.last_updated = max_timestamp(&state.last_updated, &op_timestamp);
    }

    let item_count = state.items.len();
    BenchmarkMergeResult {
        total_received,
        merged,
        conflicts,
        failed: failed_count,
        item_count,
        state,
    }
}

/// Merge a field from an operation payload into the existing fields map
/// using LWW semantics with deterministic tiebreaking.
/// Returns true if the field was updated.
fn merge_field(
    fields: &mut HashMap<String, LWWRegister>,
    key: &str,
    value: serde_json::Value,
    timestamp: &HLCTimestamp,
    replica_id: &str,
) -> bool {
    if let Some(existing) = fields.get(key) {
        let cmp = compare_hlc_timestamps(timestamp, &existing.timestamp);
        if cmp > 0 {
            // New timestamp is strictly greater — update
            fields.insert(
                key.to_string(),
                LWWRegister {
                    value,
                    timestamp: timestamp.clone(),
                    replica_id: replica_id.to_string(),
                },
            );
            return true;
        }
        if cmp == 0 {
            // Same timestamp — deterministic tiebreaker: higher replicaId wins
            if replica_id > existing.replica_id.as_str() {
                fields.insert(
                    key.to_string(),
                    LWWRegister {
                        value,
                        timestamp: timestamp.clone(),
                        replica_id: replica_id.to_string(),
                    },
                );
                return true;
            }
            if replica_id == existing.replica_id.as_str() {
                // Same replicaId — higher serialized value wins
                let new_str = serde_json::to_string(&value).unwrap_or_default();
                let existing_str = serde_json::to_string(&existing.value).unwrap_or_default();
                if new_str > existing_str {
                    fields.insert(
                        key.to_string(),
                        LWWRegister {
                            value,
                            timestamp: timestamp.clone(),
                            replica_id: replica_id.to_string(),
                        },
                    );
                    return true;
                }
            }
        }
        false
    } else {
        // New field — insert
        fields.insert(
            key.to_string(),
            LWWRegister {
                value,
                timestamp: timestamp.clone(),
                replica_id: replica_id.to_string(),
            },
        );
        true
    }
}

/// Handle an "add" operation.
fn handle_add(state: &mut CRDTState, operation: &CRDTOperation) -> MergeResultData {
    let item_id = &operation.item_id;
    let timestamp = &operation.timestamp;
    let replica_id = &operation.replica_id;

    if let Some(existing) = state.items.get(item_id) {
        // Item exists — merge field-by-field using LWW
        let mut merged_fields = existing.fields.clone();
        let mut changed_fields: HashMap<String, serde_json::Value> = HashMap::new();
        let mut has_changes = false;

        for (key, value) in &operation.payload {
            if merge_field(&mut merged_fields, key, value.clone(), timestamp, replica_id) {
                changed_fields.insert(key.clone(), value.clone());
                has_changes = true;
            }
        }

        // addedAt converges to max
        let new_added_at = max_timestamp(&existing.added_at, timestamp);
        let added_at_changed = compare_hlc_timestamps(&new_added_at, &existing.added_at) != 0;

        // Do NOT clear removedAt — both converge independently
        let new_removed_at = existing.removed_at.clone();

        if !has_changes && !added_at_changed {
            return MergeResultData {
                success: true,
                operation_id: operation.id.clone(),
                delta: Some(StateDelta {
                    session_id: state.session_id.clone(),
                    changes: vec![],
                    timestamp: timestamp.clone(),
                }),
                error: None,
                state: state.clone(),
            };
        }

        let updated_element = LWWElement {
            item_id: item_id.clone(),
            fields: merged_fields,
            added_at: new_added_at,
            removed_at: new_removed_at,
        };

        state.items.insert(item_id.clone(), updated_element);
        state.version += 1;
        state.last_updated = max_timestamp(&state.last_updated, timestamp);

        let change_type = if added_at_changed { "added" } else { "updated" };
        let fields_opt = if has_changes { Some(changed_fields) } else { None };

        MergeResultData {
            success: true,
            operation_id: operation.id.clone(),
            delta: Some(StateDelta {
                session_id: state.session_id.clone(),
                changes: vec![ItemChange {
                    item_id: item_id.clone(),
                    change_type: change_type.to_string(),
                    fields: fields_opt,
                }],
                timestamp: timestamp.clone(),
            }),
            error: None,
            state: state.clone(),
        }
    } else {
        // Item doesn't exist — create fresh
        let mut fields: HashMap<String, LWWRegister> = HashMap::new();
        let mut payload_fields: HashMap<String, serde_json::Value> = HashMap::new();

        for (key, value) in &operation.payload {
            fields.insert(
                key.clone(),
                LWWRegister {
                    value: value.clone(),
                    timestamp: timestamp.clone(),
                    replica_id: replica_id.clone(),
                },
            );
            payload_fields.insert(key.clone(), value.clone());
        }

        let new_element = LWWElement {
            item_id: item_id.clone(),
            fields,
            added_at: timestamp.clone(),
            removed_at: None,
        };

        state.items.insert(item_id.clone(), new_element);
        state.version += 1;
        state.last_updated = max_timestamp(&state.last_updated, timestamp);

        MergeResultData {
            success: true,
            operation_id: operation.id.clone(),
            delta: Some(StateDelta {
                session_id: state.session_id.clone(),
                changes: vec![ItemChange {
                    item_id: item_id.clone(),
                    change_type: "added".to_string(),
                    fields: Some(payload_fields),
                }],
                timestamp: timestamp.clone(),
            }),
            error: None,
            state: state.clone(),
        }
    }
}

/// Handle a "remove" operation with remove-wins semantics.
fn handle_remove(state: &mut CRDTState, operation: &CRDTOperation) -> MergeResultData {
    let item_id = &operation.item_id;
    let timestamp = &operation.timestamp;

    if !state.items.contains_key(item_id) {
        // Item doesn't exist — no-op
        return MergeResultData {
            success: true,
            operation_id: operation.id.clone(),
            delta: Some(StateDelta {
                session_id: state.session_id.clone(),
                changes: vec![],
                timestamp: timestamp.clone(),
            }),
            error: None,
            state: state.clone(),
        };
    }

    let existing = state.items.get(item_id).unwrap();

    // removedAt converges to max of all remove timestamps
    let new_removed_at = match &existing.removed_at {
        Some(existing_removed) => max_timestamp(existing_removed, timestamp),
        None => timestamp.clone(),
    };

    // Check if removedAt actually changed (idempotency)
    if let Some(existing_removed) = &existing.removed_at {
        if compare_hlc_timestamps(&new_removed_at, existing_removed) == 0 {
            return MergeResultData {
                success: true,
                operation_id: operation.id.clone(),
                delta: Some(StateDelta {
                    session_id: state.session_id.clone(),
                    changes: vec![],
                    timestamp: timestamp.clone(),
                }),
                error: None,
                state: state.clone(),
            };
        }
    }

    let mut updated = existing.clone();
    updated.removed_at = Some(new_removed_at);
    state.items.insert(item_id.clone(), updated);
    state.version += 1;
    state.last_updated = max_timestamp(&state.last_updated, timestamp);

    MergeResultData {
        success: true,
        operation_id: operation.id.clone(),
        delta: Some(StateDelta {
            session_id: state.session_id.clone(),
            changes: vec![ItemChange {
                item_id: item_id.clone(),
                change_type: "removed".to_string(),
                fields: None,
            }],
            timestamp: timestamp.clone(),
        }),
        error: None,
        state: state.clone(),
    }
}

/// Handle an "update" operation with field-level LWW.
fn handle_update(state: &mut CRDTState, operation: &CRDTOperation) -> MergeResultData {
    let item_id = &operation.item_id;
    let timestamp = &operation.timestamp;
    let replica_id = &operation.replica_id;

    if !state.items.contains_key(item_id) {
        // Item doesn't exist — error
        return MergeResultData {
            success: false,
            operation_id: operation.id.clone(),
            delta: None,
            error: Some(OperationError {
                operation_id: operation.id.clone(),
                code: "UNKNOWN_ITEM".to_string(),
                message: format!("Item \"{}\" does not exist", item_id),
            }),
            state: state.clone(),
        };
    }

    let existing = state.items.get(item_id).unwrap();

    // Apply field-level LWW regardless of removedAt status for commutativity
    let mut updated_fields = existing.fields.clone();
    let mut changed_fields: HashMap<String, serde_json::Value> = HashMap::new();
    let mut has_changes = false;

    for (key, value) in &operation.payload {
        if merge_field(&mut updated_fields, key, value.clone(), timestamp, replica_id) {
            changed_fields.insert(key.clone(), value.clone());
            has_changes = true;
        }
    }

    if !has_changes {
        return MergeResultData {
            success: true,
            operation_id: operation.id.clone(),
            delta: Some(StateDelta {
                session_id: state.session_id.clone(),
                changes: vec![],
                timestamp: timestamp.clone(),
            }),
            error: None,
            state: state.clone(),
        };
    }

    let mut updated = existing.clone();
    updated.fields = updated_fields;
    state.items.insert(item_id.clone(), updated);
    state.version += 1;
    state.last_updated = max_timestamp(&state.last_updated, timestamp);

    MergeResultData {
        success: true,
        operation_id: operation.id.clone(),
        delta: Some(StateDelta {
            session_id: state.session_id.clone(),
            changes: vec![ItemChange {
                item_id: item_id.clone(),
                change_type: "updated".to_string(),
                fields: Some(changed_fields),
            }],
            timestamp: timestamp.clone(),
        }),
        error: None,
        state: state.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_state() -> CRDTState {
        CRDTState {
            session_id: "test-session".to_string(),
            items: HashMap::new(),
            version: 0,
            last_updated: HLCTimestamp {
                wall_time: 0,
                logical: 0,
                node_id: "init".to_string(),
            },
        }
    }

    fn make_add_op(item_id: &str, wall_time: i64, node_id: &str) -> CRDTOperation {
        let mut payload = HashMap::new();
        payload.insert("x".to_string(), serde_json::json!(10));
        payload.insert("y".to_string(), serde_json::json!(20));

        CRDTOperation {
            id: format!("op-{}", wall_time),
            session_id: "test-session".to_string(),
            replica_id: node_id.to_string(),
            op_type: OperationType::Add,
            item_id: item_id.to_string(),
            payload,
            timestamp: HLCTimestamp {
                wall_time,
                logical: 0,
                node_id: node_id.to_string(),
            },
            version: 0,
        }
    }

    #[test]
    fn test_add_new_item() {
        let state = make_state();
        let op = make_add_op("item1", 100, "node-a");
        let result = apply_merge_operation(state, op);

        assert!(result.success);
        assert!(result.state.items.contains_key("item1"));
        assert_eq!(result.state.version, 1);
    }

    #[test]
    fn test_remove_item() {
        let mut state = make_state();
        let add_op = make_add_op("item1", 100, "node-a");
        let add_result = apply_merge_operation(state, add_op);
        state = add_result.state;

        let remove_op = CRDTOperation {
            id: "op-remove".to_string(),
            session_id: "test-session".to_string(),
            replica_id: "node-b".to_string(),
            op_type: OperationType::Remove,
            item_id: "item1".to_string(),
            payload: HashMap::new(),
            timestamp: HLCTimestamp {
                wall_time: 200,
                logical: 0,
                node_id: "node-b".to_string(),
            },
            version: 1,
        };

        let result = apply_merge_operation(state, remove_op);
        assert!(result.success);
        assert!(result.state.items["item1"].removed_at.is_some());
    }

    #[test]
    fn test_update_nonexistent_item_fails() {
        let state = make_state();
        let mut payload = HashMap::new();
        payload.insert("x".to_string(), serde_json::json!(50));

        let update_op = CRDTOperation {
            id: "op-update".to_string(),
            session_id: "test-session".to_string(),
            replica_id: "node-a".to_string(),
            op_type: OperationType::Update,
            item_id: "nonexistent".to_string(),
            payload,
            timestamp: HLCTimestamp {
                wall_time: 100,
                logical: 0,
                node_id: "node-a".to_string(),
            },
            version: 0,
        };

        let result = apply_merge_operation(state, update_op);
        assert!(!result.success);
        assert_eq!(result.error.unwrap().code, "UNKNOWN_ITEM");
    }

    #[test]
    fn test_lww_conflict_higher_timestamp_wins() {
        let state = make_state();
        // Add item with x=10 at t=100
        let add_op = make_add_op("item1", 100, "node-a");
        let result = apply_merge_operation(state, add_op);
        let state = result.state;

        // Update x=50 at t=200 (should win)
        let mut payload = HashMap::new();
        payload.insert("x".to_string(), serde_json::json!(50));
        let update_op = CRDTOperation {
            id: "op-update".to_string(),
            session_id: "test-session".to_string(),
            replica_id: "node-b".to_string(),
            op_type: OperationType::Update,
            item_id: "item1".to_string(),
            payload,
            timestamp: HLCTimestamp {
                wall_time: 200,
                logical: 0,
                node_id: "node-b".to_string(),
            },
            version: 1,
        };

        let result = apply_merge_operation(state, update_op);
        assert!(result.success);
        let field = &result.state.items["item1"].fields["x"];
        assert_eq!(field.value, serde_json::json!(50));
    }

    #[test]
    fn test_batch_merge() {
        let state = make_state();
        let ops = vec![
            make_add_op("item1", 100, "node-a"),
            make_add_op("item2", 101, "node-b"),
            make_add_op("item3", 102, "node-a"),
        ];

        let result = apply_merge_batch(state, ops);
        assert_eq!(result.total_received, 3);
        assert_eq!(result.merged, 3);
        assert_eq!(result.failed.len(), 0);
        assert_eq!(result.state.items.len(), 3);
    }
}
