/**
 * Shared frontend constants.
 *
 * All backend connectivity is derived from a single source of truth:
 * NEXT_PUBLIC_SYNC_URL (WebSocket URL pointing to the Sync Engine backend).
 *
 * Requirements: 22.1-22.5
 */

const SYNC_URL = process.env.NEXT_PUBLIC_SYNC_URL || "ws://localhost:8080";

/**
 * Backend HTTP URL — derived from NEXT_PUBLIC_BACKEND_URL if set,
 * otherwise derived from NEXT_PUBLIC_SYNC_URL by replacing ws:// with http://
 */
export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  SYNC_URL.replace(/^ws(s?):\/\//, "http$1://");

/**
 * Backend WebSocket URL — derived from NEXT_PUBLIC_WS_URL if set,
 * otherwise uses NEXT_PUBLIC_SYNC_URL directly.
 */
export const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL || SYNC_URL;

export const MAX_QUEUE_SIZE = 10000;

export const MAX_QUANTITY = 10000;

export const MIN_QUANTITY = 0;

export const MAX_NAME_LENGTH = 100;

export const MAX_EVENT_LOG_ENTRIES = 50;

export const RECONNECT_DELAY_MS = 2000;

export const PRESENCE_REFRESH_INTERVAL_MS = 5000;

export const SESSION_ID = "default-session";

