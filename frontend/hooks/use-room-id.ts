"use client";

import { useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";

export interface UseRoomIdOptions {
  prefix: string; // Page identifier (e.g., "whiteboard", "stress-test")
}

export interface UseRoomIdReturn {
  roomId: string;
  getShareUrl: () => string;
  copyShareUrl: () => Promise<boolean>;
}

/**
 * Sanitizes a prefix by stripping non-alphanumeric/hyphen characters.
 */
function sanitizePrefix(prefix: string): string {
  return prefix.replace(/[^a-z0-9-]/gi, "").toLowerCase();
}

/**
 * Generates a random 6-character alphanumeric string.
 */
function generateRandom6(): string {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * A reusable hook that extracts or generates room IDs from URL query parameters,
 * enabling shareable collaboration links across all demo pages.
 *
 * - Uses Next.js `useSearchParams` to read the `room` query parameter
 * - Generates a random room ID in format `{prefix}-{random6}` if no query param present
 * - Uses `useRef` to ensure the generated ID is stable across re-renders
 * - Handles SSR gracefully by deferring URL reading to client-side hydration
 */
export function useRoomId(options: UseRoomIdOptions): UseRoomIdReturn {
  const searchParams = useSearchParams();
  const sanitizedPrefix = sanitizePrefix(options.prefix);

  // Use ref to store the stable room ID across re-renders
  const roomIdRef = useRef<string | null>(null);

  // Read the room query parameter from the URL (client-side only via useSearchParams)
  const roomParam = searchParams.get("room");

  // Determine the room ID: use query param if present, otherwise generate one
  if (roomIdRef.current === null) {
    if (roomParam) {
      roomIdRef.current = roomParam;
    } else {
      roomIdRef.current = `${sanitizedPrefix}-${generateRandom6()}`;
    }
  }

  // Update the ref if the URL query param changes (e.g., user navigates to a shared link)
  useEffect(() => {
    if (roomParam && roomParam !== roomIdRef.current) {
      roomIdRef.current = roomParam;
    }
  }, [roomParam]);

  const roomId = roomIdRef.current;

  const getShareUrl = useCallback((): string => {
    if (typeof window === "undefined") {
      return "";
    }
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomId);
    return url.toString();
  }, [roomId]);

  const copyShareUrl = useCallback(async (): Promise<boolean> => {
    if (
      typeof navigator === "undefined" ||
      !navigator.clipboard ||
      !navigator.clipboard.writeText
    ) {
      return false;
    }
    try {
      const url = getShareUrl();
      await navigator.clipboard.writeText(url);
      return true;
    } catch {
      return false;
    }
  }, [getShareUrl]);

  return {
    roomId,
    getShareUrl,
    copyShareUrl,
  };
}
