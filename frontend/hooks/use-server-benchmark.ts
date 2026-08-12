"use client";

import { useState, useCallback } from "react";
import { BACKEND_URL } from "@/lib/constants";
import type {
  BenchmarkMode,
  BenchmarkModeResponse,
  ModeSpecificParams,
} from "@/lib/stress-test-types";

export interface ServerBenchmarkState {
  status: "idle" | "running" | "completed" | "error";
  results: BenchmarkModeResponse | null;
  error: string | null;
}

export interface UseServerBenchmarkReturn {
  state: ServerBenchmarkState;
  selectedOps: number;
  setSelectedOps: (ops: number) => void;
  selectedMode: BenchmarkMode;
  setSelectedMode: (mode: BenchmarkMode) => void;
  modeParams: ModeSpecificParams;
  setModeParams: (params: Partial<ModeSpecificParams>) => void;
  runBenchmark: () => Promise<void>;
}

/** Default mode-specific parameters */
const DEFAULT_MODE_PARAMS: ModeSpecificParams = { rooms: 5 };

/**
 * Hook managing the server-side benchmark lifecycle.
 *
 * Sends a POST request to the `/benchmark` endpoint with the selected
 * operation count, mode, and mode-specific params, handling loading,
 * success, HTTP 400, and network failure states.
 *
 * Requirements: 6.1, 6.4, 6.5, 7.1
 */
export function useServerBenchmark(): UseServerBenchmarkReturn {
  const [state, setState] = useState<ServerBenchmarkState>({
    status: "idle",
    results: null,
    error: null,
  });
  const [selectedOps, setSelectedOps] = useState<number>(10_000);
  const [selectedMode, setSelectedModeInternal] = useState<BenchmarkMode>("standard");
  const [modeParams, setModeParamsInternal] = useState<ModeSpecificParams>({ ...DEFAULT_MODE_PARAMS });

  /**
   * Switch modes: resets mode-specific params to defaults.
   * Requirement 6.5
   */
  const setSelectedMode = useCallback((mode: BenchmarkMode) => {
    setSelectedModeInternal(mode);
    // Reset mode-specific params to defaults on mode switch
    setModeParamsInternal({ ...DEFAULT_MODE_PARAMS });
  }, []);

  /**
   * Partially update mode-specific params (e.g., room count).
   */
  const setModeParams = useCallback((params: Partial<ModeSpecificParams>) => {
    setModeParamsInternal((prev) => ({ ...prev, ...params }));
  }, []);

  const runBenchmark = useCallback(async () => {
    // Prevent concurrent runs (Requirement 6.4 — mode selector disabled during run)
    if (state.status === "running") return;

    setState({ status: "running", results: null, error: null });

    try {
      // Build request body with mode and mode-specific params
      const requestBody: Record<string, unknown> = {
        ops: selectedOps,
        mode: selectedMode,
      };

      // Include mode-specific params when relevant
      if (selectedMode === "rooms") {
        requestBody.rooms = modeParams.rooms;
      }

      const response = await fetch(`${BACKEND_URL}/benchmark`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        // Handle HTTP 400 and other error responses
        let errorMessage = `Server returned ${response.status}`;
        try {
          const body = await response.json();
          if (body.error) {
            errorMessage = body.error;
          }
        } catch {
          // If response body isn't JSON, use the status-based message
        }
        setState({ status: "error", results: null, error: errorMessage });
        return;
      }

      const data: BenchmarkModeResponse = await response.json();
      setState({ status: "completed", results: data, error: null });
    } catch {
      // Network failure (fetch throws on network errors)
      setState({
        status: "error",
        results: null,
        error: "Server unreachable — check that the backend is running",
      });
    }
  }, [state.status, selectedOps, selectedMode, modeParams]);

  return {
    state,
    selectedOps,
    setSelectedOps,
    selectedMode,
    setSelectedMode,
    modeParams,
    setModeParams,
    runBenchmark,
  };
}
