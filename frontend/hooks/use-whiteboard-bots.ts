import { useEffect, useRef, useState, useCallback } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { Collaborator, Participant } from "@/lib/excalidraw-sync-utils";
import { shouldBotsBeActive } from "@/components/demo/WhiteboardCanvas";

// --- Bot Configuration ---

interface BotConfig {
  name: string;
  color: string;
  clientId: string;
}

const BOT_CONFIGS: BotConfig[] = [
  { name: "BotAlice", color: "#ff00ff", clientId: "bot-alice-simulated" },
  { name: "BotBob", color: "#00ff88", clientId: "bot-bob-simulated" },
];

const BOT_ACTIVATION_DELAY_MS = 2500;
const BOT_MIN_INTERVAL_MS = 1000;
const BOT_MAX_INTERVAL_MS = 3000;
const CURSOR_LERP_SPEED = 0.05;

// --- Interfaces ---

export interface UseWhiteboardBotsOptions {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  participants: Participant[];
  enabled: boolean;
}

export interface UseWhiteboardBotsReturn {
  botCollaborators: Map<string, Collaborator>;
  botsActive: boolean;
}

// --- Helpers ---

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomInterval(): number {
  return randomInRange(BOT_MIN_INTERVAL_MS, BOT_MAX_INTERVAL_MS);
}

/**
 * Creates a random Excalidraw element (rectangle, ellipse, or freedraw).
 * All required Excalidraw element properties must be present to avoid
 * runtime errors in hit-testing (isTransparent checks backgroundColor).
 */
function createRandomElement(bot: BotConfig, x: number, y: number) {
  const shapeRoll = Math.random();
  const id = generateId();
  const baseProps = {
    id,
    x,
    y,
    strokeColor: bot.color,
    backgroundColor: bot.color,
    fillStyle: "hachure" as const,
    strokeWidth: 2,
    roughness: 1,
    opacity: 80,
    angle: 0,
    isDeleted: false,
    version: 1,
    versionNonce: (Math.random() * 1000000) | 0,
    updated: Date.now(),
    groupIds: [] as string[],
    boundElements: null,
    link: null,
    locked: false,
    seed: (Math.random() * 2000000000) | 0,
    frameId: null,
    roundness: null as { type: number; value?: number } | null,
  };

  if (shapeRoll < 0.33) {
    // Rectangle
    const width = randomInRange(40, 120);
    const height = randomInRange(30, 90);
    return {
      ...baseProps,
      type: "rectangle" as const,
      width,
      height,
      roundness: { type: 3, value: 8 },
    };
  } else if (shapeRoll < 0.66) {
    // Ellipse
    const width = randomInRange(40, 100);
    const height = randomInRange(40, 100);
    return {
      ...baseProps,
      type: "ellipse" as const,
      width,
      height,
      roundness: { type: 2 },
    };
  } else {
    // Freedraw path
    const numPoints = Math.floor(randomInRange(4, 8));
    const points: [number, number, number][] = [[0, 0, 0.5]];
    let px = 0;
    let py = 0;
    for (let i = 1; i < numPoints; i++) {
      px += randomInRange(-40, 40);
      py += randomInRange(-30, 30);
      points.push([px, py, 0.5]);
    }
    return {
      ...baseProps,
      type: "freedraw" as const,
      width: Math.abs(px) || 50,
      height: Math.abs(py) || 50,
      points,
      pressures: points.map(() => 0.5),
      simulatePressure: false,
      lastCommittedPoint: points[points.length - 1],
    };
  }
}

// --- Hook ---

export function useWhiteboardBots(
  options: UseWhiteboardBotsOptions
): UseWhiteboardBotsReturn {
  const { excalidrawAPI, participants, enabled } = options;

  const [botCollaborators, setBotCollaborators] = useState<
    Map<string, Collaborator>
  >(new Map());
  const [botsActive, setBotsActive] = useState(false);

  // Refs for animation state (avoid stale closures)
  const cursorPositions = useRef<
    Map<string, { x: number; y: number; targetX: number; targetY: number }>
  >(new Map());
  const animFrameRef = useRef<number | null>(null);
  const drawTimeouts = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  const activationTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Determine if bots should be active based on participants
  const participantIds = participants.map((p) => p.clientId);
  const shouldBeActive =
    enabled && shouldBotsBeActive(participantIds, "bot-");

  // Cleanup function
  const stopBots = useCallback(() => {
    // Clear all draw timeouts
    drawTimeouts.current.forEach((timeout) => clearTimeout(timeout));
    drawTimeouts.current.clear();

    // Stop cursor animation
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    // Clear activation timeout
    if (activationTimeout.current !== null) {
      clearTimeout(activationTimeout.current);
      activationTimeout.current = null;
    }

    // Clear bot cursors from the collaborators map
    setBotCollaborators(new Map());
    cursorPositions.current.clear();
    setBotsActive(false);
  }, []);

  // Start drawing loop for a single bot
  const startBotDrawing = useCallback(
    (bot: BotConfig) => {
      function scheduleDraw() {
        if (!mountedRef.current) return;

        const timeout = setTimeout(() => {
          if (!mountedRef.current || !excalidrawAPI) return;

          // Pick a random position on the canvas area
          const x = randomInRange(50, 800);
          const y = randomInRange(50, 600);

          // Update cursor target position
          const pos = cursorPositions.current.get(bot.clientId);
          if (pos) {
            pos.targetX = x;
            pos.targetY = y;
          }

          // Wait a bit for cursor to move, then create the element
          setTimeout(() => {
            if (!mountedRef.current || !excalidrawAPI) return;

            const newElement = createRandomElement(bot, x, y);
            const currentElements =
              excalidrawAPI.getSceneElementsIncludingDeleted();
            excalidrawAPI.updateScene({
              elements: [...currentElements, newElement as any],
            });
          }, 500);

          // Schedule next draw
          scheduleDraw();
        }, randomInterval());

        drawTimeouts.current.set(bot.clientId, timeout);
      }

      scheduleDraw();
    },
    [excalidrawAPI]
  );

  // Cursor animation loop
  const startCursorAnimation = useCallback(() => {
    function animate() {
      if (!mountedRef.current) return;

      const nextCollaborators = new Map<string, Collaborator>();

      cursorPositions.current.forEach((pos, clientId) => {
        // Lerp toward target
        pos.x += (pos.targetX - pos.x) * CURSOR_LERP_SPEED;
        pos.y += (pos.targetY - pos.y) * CURSOR_LERP_SPEED;

        const bot = BOT_CONFIGS.find((b) => b.clientId === clientId);
        if (bot) {
          nextCollaborators.set(clientId, {
            username: bot.name,
            color: { background: bot.color, stroke: bot.color },
            pointer: { x: pos.x, y: pos.y, tool: "pointer" },
          });
        }
      });

      setBotCollaborators(nextCollaborators);
      animFrameRef.current = requestAnimationFrame(animate);
    }

    animFrameRef.current = requestAnimationFrame(animate);
  }, []);

  // Main effect: activate or deactivate bots
  useEffect(() => {
    if (!excalidrawAPI) return;

    if (shouldBeActive) {
      // Activate bots with a delay
      activationTimeout.current = setTimeout(() => {
        if (!mountedRef.current) return;

        setBotsActive(true);

        // Initialize cursor positions for each bot
        BOT_CONFIGS.forEach((bot, index) => {
          const startX = 200 + index * 300;
          const startY = 200 + index * 100;
          cursorPositions.current.set(bot.clientId, {
            x: startX,
            y: startY,
            targetX: startX,
            targetY: startY,
          });
        });

        // Start cursor animation
        startCursorAnimation();

        // Start drawing for each bot
        BOT_CONFIGS.forEach((bot) => {
          startBotDrawing(bot);
        });
      }, BOT_ACTIVATION_DELAY_MS);
    } else {
      stopBots();
    }

    return () => {
      stopBots();
    };
  }, [excalidrawAPI, shouldBeActive, startCursorAnimation, startBotDrawing, stopBots]);

  // Track mounted state
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return { botCollaborators, botsActive };
}
