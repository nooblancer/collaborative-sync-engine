//! HLC timestamp comparison logic.
//!
//! Comparison order:
//! 1. wallTime (numeric)
//! 2. logical counter (numeric)
//! 3. nodeId (lexicographic, deterministic tiebreaker)

use crate::types::HLCTimestamp;

/// Compare two HLC timestamps.
/// Returns -1 if a < b, 0 if a == b, 1 if a > b.
pub fn compare_hlc_timestamps(a: &HLCTimestamp, b: &HLCTimestamp) -> i32 {
    if a.wall_time != b.wall_time {
        if a.wall_time < b.wall_time {
            return -1;
        } else {
            return 1;
        }
    }
    if a.logical != b.logical {
        if a.logical < b.logical {
            return -1;
        } else {
            return 1;
        }
    }
    match a.node_id.cmp(&b.node_id) {
        std::cmp::Ordering::Less => -1,
        std::cmp::Ordering::Equal => 0,
        std::cmp::Ordering::Greater => 1,
    }
}

/// Returns the greater of two HLC timestamps.
pub fn max_timestamp(a: &HLCTimestamp, b: &HLCTimestamp) -> HLCTimestamp {
    if compare_hlc_timestamps(a, b) >= 0 {
        a.clone()
    } else {
        b.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compare_wall_time() {
        let a = HLCTimestamp { wall_time: 100, logical: 0, node_id: "a".to_string() };
        let b = HLCTimestamp { wall_time: 200, logical: 0, node_id: "a".to_string() };
        assert_eq!(compare_hlc_timestamps(&a, &b), -1);
        assert_eq!(compare_hlc_timestamps(&b, &a), 1);
    }

    #[test]
    fn test_compare_logical() {
        let a = HLCTimestamp { wall_time: 100, logical: 1, node_id: "a".to_string() };
        let b = HLCTimestamp { wall_time: 100, logical: 2, node_id: "a".to_string() };
        assert_eq!(compare_hlc_timestamps(&a, &b), -1);
        assert_eq!(compare_hlc_timestamps(&b, &a), 1);
    }

    #[test]
    fn test_compare_node_id_tiebreaker() {
        let a = HLCTimestamp { wall_time: 100, logical: 1, node_id: "alpha".to_string() };
        let b = HLCTimestamp { wall_time: 100, logical: 1, node_id: "beta".to_string() };
        assert_eq!(compare_hlc_timestamps(&a, &b), -1);
        assert_eq!(compare_hlc_timestamps(&b, &a), 1);
    }

    #[test]
    fn test_compare_equal() {
        let a = HLCTimestamp { wall_time: 100, logical: 1, node_id: "node1".to_string() };
        let b = HLCTimestamp { wall_time: 100, logical: 1, node_id: "node1".to_string() };
        assert_eq!(compare_hlc_timestamps(&a, &b), 0);
    }

    #[test]
    fn test_max_timestamp() {
        let a = HLCTimestamp { wall_time: 100, logical: 0, node_id: "a".to_string() };
        let b = HLCTimestamp { wall_time: 200, logical: 0, node_id: "a".to_string() };
        let max = max_timestamp(&a, &b);
        assert_eq!(max.wall_time, 200);
    }
}
