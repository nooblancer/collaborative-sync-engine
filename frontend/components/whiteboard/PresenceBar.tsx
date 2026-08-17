import type { Participant } from "@/lib/excalidraw-sync-utils";

export interface PresenceBarProps {
  participants: Participant[];
  botsActive: boolean;
}

export default function PresenceBar({
  participants,
  botsActive,
}: PresenceBarProps): JSX.Element {
  if (participants.length === 0 && !botsActive) {
    return <></>;
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-black/40 backdrop-blur rounded-full border border-white/10">
      {participants.map((p) => (
        <div key={p.clientId} className="flex items-center gap-1">
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: p.color }}
          />
          <span className="text-[11px] text-white/70">{p.displayName}</span>
        </div>
      ))}
      {botsActive && (
        <span className="text-[11px] text-white/40">🤖 Bots</span>
      )}
    </div>
  );
}
