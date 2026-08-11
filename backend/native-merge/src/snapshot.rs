//! Snapshot computation: consolidates CRDT state and removes tombstones.
//!
//! A snapshot represents a clean point-in-time state suitable for serving
//! to new clients. Tombstoned items (those with removedAt set) are removed
//! entirely since their deletion has been fully propagated.

use crate::types::CRDTState;

/// Compute a state snapshot by removing all tombstoned items.
/// This consolidates the state for efficient delivery to new clients
/// and enables garbage collection of pre-snapshot operations.
pub fn compute_state_snapshot(mut state: CRDTState) -> CRDTState {
    // Remove all items that have been tombstoned (removedAt is set)
    state.items.retain(|_id, element| element.removed_at.is_none());

    state
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{HLCTimestamp, LWWElement, LWWRegister};
    use std::collections::HashMap;

    fn make_timestamp(wall_time: i64) -> HLCTimestamp {
        HLCTimestamp {
            wall_time,
            logical: 0,
            node_id: "test".to_string(),
        }
    }

    #[test]
    fn test_snapshot_removes_tombstones() {
        let mut items = HashMap::new();

        // Active item
        let mut fields = HashMap::new();
        fields.insert(
            "x".to_string(),
            LWWRegister {
                value: serde_json::json!(10),
                timestamp: make_timestamp(100),
                replica_id: "node-a".to_string(),
            },
        );
        items.insert(
            "active-item".to_string(),
            LWWElement {
                item_id: "active-item".to_string(),
                fields,
                added_at: make_timestamp(100),
                removed_at: None,
            },
        );

        // Tombstoned item
        let mut fields2 = HashMap::new();
        fields2.insert(
            "y".to_string(),
            LWWRegister {
                value: serde_json::json!(20),
                timestamp: make_timestamp(50),
                replica_id: "node-b".to_string(),
            },
        );
        items.insert(
            "removed-item".to_string(),
            LWWElement {
                item_id: "removed-item".to_string(),
                fields: fields2,
                added_at: make_timestamp(50),
                removed_at: Some(make_timestamp(150)),
            },
        );

        let state = CRDTState {
            session_id: "test-session".to_string(),
            items,
            version: 5,
            last_updated: make_timestamp(150),
        };

        let snapshot = compute_state_snapshot(state);

        assert_eq!(snapshot.items.len(), 1);
        assert!(snapshot.items.contains_key("active-item"));
        assert!(!snapshot.items.contains_key("removed-item"));
    }

    #[test]
    fn test_snapshot_empty_state() {
        let state = CRDTState {
            session_id: "empty".to_string(),
            items: HashMap::new(),
            version: 0,
            last_updated: make_timestamp(0),
        };

        let snapshot = compute_state_snapshot(state);
        assert_eq!(snapshot.items.len(), 0);
    }

    #[test]
    fn test_snapshot_all_active() {
        let mut items = HashMap::new();
        for i in 0..5 {
            let mut fields = HashMap::new();
            fields.insert(
                "val".to_string(),
                LWWRegister {
                    value: serde_json::json!(i),
                    timestamp: make_timestamp(i as i64 * 100),
                    replica_id: "node".to_string(),
                },
            );
            items.insert(
                format!("item-{}", i),
                LWWElement {
                    item_id: format!("item-{}", i),
                    fields,
                    added_at: make_timestamp(i as i64 * 100),
                    removed_at: None,
                },
            );
        }

        let state = CRDTState {
            session_id: "test".to_string(),
            items,
            version: 5,
            last_updated: make_timestamp(400),
        };

        let snapshot = compute_state_snapshot(state);
        assert_eq!(snapshot.items.len(), 5);
    }
}
