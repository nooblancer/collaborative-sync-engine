export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8080";

export const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8080";

export const MAX_QUEUE_SIZE = 10000;

export const MAX_QUANTITY = 10000;

export const MIN_QUANTITY = 0;

export const MAX_NAME_LENGTH = 100;

export const MAX_EVENT_LOG_ENTRIES = 50;

export const RECONNECT_DELAY_MS = 2000;

export const PRESENCE_REFRESH_INTERVAL_MS = 5000;

export const SESSION_ID = "default-session";
