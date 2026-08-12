"use client";

import { Suspense, useState } from "react";
import { useRoomId } from "@/hooks/use-room-id";
import { PageHeader } from "@/components/stress-test/PageHeader";
import { ServerBenchmarkSection } from "@/components/stress-test/ServerBenchmarkSection";
import { BrowserBenchmarkSection } from "@/components/stress-test/BrowserBenchmarkSection";
import { ExplanationPanel } from "@/components/stress-test/ExplanationPanel";

function LoadingSkeleton(): JSX.Element {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-foreground-muted text-sm">
        Loading stress test…
      </div>
    </div>
  );
}

function StressTestContent(): JSX.Element {
  const { roomId, copyShareUrl } = useRoomId({ prefix: "stress-test" });
  const [shareStatus, setShareStatus] = useState<"idle" | "copied">("idle");

  const handleShare = async () => {
    const success = await copyShareUrl();
    if (success) {
      setShareStatus("copied");
      setTimeout(() => setShareStatus("idle"), 2000);
    }
  };

  return (
    <main
      className="min-h-screen px-4 py-8 sm:px-6 lg:px-8"
      style={{
        background: "linear-gradient(to bottom, #050510, #0a0a1a)",
      }}
    >
      <div className="mx-auto max-w-7xl">
        <PageHeader onShare={handleShare} shareStatus={shareStatus} />

        <div className="flex flex-col gap-8">
          <BrowserBenchmarkSection roomId={roomId} />
          <ServerBenchmarkSection />
          <ExplanationPanel />
        </div>
      </div>
    </main>
  );
}

export default function StressTestPage(): JSX.Element {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <StressTestContent />
    </Suspense>
  );
}
