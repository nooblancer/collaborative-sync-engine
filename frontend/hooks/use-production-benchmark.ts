"use client";

import { useState, useCallback } from "react";
import { BACKEND_URL } from "@/lib/constants";
import type {
  BenchmarkMode,
  BenchmarkModeResponse,
  ModeSpecificParams,
} from "@/lib/stress-test-types";

export interface ProductionBenchmarkState {
  status: "idle" | "running" | "completed" | "error";
  results: BenchmarkModeResponse | null;
  error: string | null;
}

export interface UseProductionBenchmarkReturn {
  state: ProductionBenchmarkState;
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
 * Hook managing the production benchmark lifecycle.
 *
 * Identical to useServerBenchmark but adds `production: true` to the
 * request body, routing the backend to use createRoom → mergeOps → dropRoom
 * instead of the pure mergeBatchBenchmark path.
 */
export function useProductionBenchmark(): UseProductionBenchmarkReturn {
  const [state, setState] = useState<ProductionBenchmarkState>({
    status: "idle",
    results: null,
    error: null,
  });
  const [selectedOps, setSelectedOps] = useState<number>(10_000);
  const [selectedMode, setSelectedModeInternal] = useState<BenchmarkMode>("standard");
  const [modeParams, setModeParamsInternal] = useState<ModeSpecificParams>({ ...DEFAULT_MODE_PARAMS });

  const setSelectedMode = useCallback((mode: BenchmarkMode) => {
    setSelectedModeInternal(mode);
    setModeParamsInternal({ ...DEFAULT_MODE_PARAMS });
  }, []);

  const setModeParams = useCallback((params: Partial<ModeSpecificParams>) => {
    setModeParamsInternal((prev) => ({ ...prev, ...params }));
  }, []);

  const runBenchmark = useCallback(async () => {
    if (state.status === "running") return;

    setState({ status: "running", results: null, error: null });

    try {
      const requestBody: Record<string, unknown> = {
        ops: selectedOps,
        mode: selectedMode,
        production: true, // Key difference: routes to room-based production path
      };

      if (selectedMode === "rooms") {
        requestBody.rooms = modeParams.rooms;
      }

      const response = await fetch(`${BACKEND_URL}/benchmark`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
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
