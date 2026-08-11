/**
 * Persistence layer barrel exports.
 */

export {
  PostgresPersistenceLayer,
  InMemoryPersistenceLayer,
} from "./persistence-layer.js";

export type { PersistenceLayer } from "./persistence-layer.js";

export {
  PostgresPersistenceLayerV2,
  InMemoryPersistenceLayerV2,
} from "./persistence-layer-v2.js";

export type {
  PersistenceLayerV2,
  RoomSnapshot,
  RoomOperation,
  PersistedConflictEvent,
} from "./persistence-layer-v2.js";

export { SnapshotManager } from "./snapshot-manager.js";

export { SnapshotManagerV2 } from "./snapshot-manager-v2.js";
export type { ClientJoinData } from "./snapshot-manager-v2.js";

export { RedisCache, InMemoryRedisCache } from "./redis-cache.js";
export type { RedisCacheInterface, RedisCacheV2Interface } from "./redis-cache.js";
