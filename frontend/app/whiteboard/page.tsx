"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";
import Navbar from "@/components/landing/navbar";

const WhiteboardContent = dynamic(
  () => import("@/components/whiteboard/WhiteboardContent"),
  {
    ssr: false,
    loading: () => (
      <div className="h-full flex items-center justify-center">
        <div className="animate-pulse text-white/40 text-sm">
          Loading whiteboard…
        </div>
      </div>
    ),
  }
);

function WhiteboardPageInner(): JSX.Element {
  return (
    <div className="h-screen overflow-hidden flex flex-col bg-[#0a0a1a]">
      <Navbar />
      {/* Canvas area: full viewport minus navbar (64px) */}
      <div className="flex-1 min-h-0 mt-16">
        <WhiteboardContent />
      </div>
    </div>
  );
}

export default function WhiteboardPage(): JSX.Element {
  return (
    <Suspense
      fallback={
        <div className="h-screen flex items-center justify-center bg-[#0a0a1a]">
          <div className="animate-pulse text-white/40 text-sm">
            Loading whiteboard…
          </div>
        </div>
      }
    >
      <WhiteboardPageInner />
    </Suspense>
  );
}
