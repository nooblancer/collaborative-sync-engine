"use client";

import { Monitor, Radio, Cpu, Merge, Send, ArrowRight } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import AnimateOnScroll from "@/components/landing/animate-on-scroll";
import { cn } from "@/lib/utils";

const steps = [
  {
    title: "Client",
    description:
      "Operations are created locally with optimistic updates for instant feedback",
    icon: Monitor,
  },
  {
    title: "WebSocket",
    description:
      "Changes propagate through persistent WebSocket connections with automatic reconnection",
    icon: Radio,
  },
  {
    title: "Sync Engine",
    description:
      "The central engine validates and orders operations using Hybrid Logical Clocks",
    icon: Cpu,
  },
  {
    title: "CRDT Merge",
    description:
      "Conflict-free merge using Last-Writer-Wins registers with deterministic resolution",
    icon: Merge,
  },
  {
    title: "Broadcast",
    description:
      "Minimal state deltas are broadcast to all connected clients in real-time",
    icon: Send,
  },
];

export default function ArchitectureSection() {
  return (
    <section id="architecture" className="px-4 sm:px-6 lg:px-8 py-20">
      <div className="max-w-6xl mx-auto">
        <AnimateOnScroll>
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-4">
            How It Works
          </h2>
          <p className="text-muted-foreground text-center max-w-2xl mx-auto mb-12">
            Data flows through five stages from client to broadcast, ensuring
            consistency and minimal latency.
          </p>
        </AnimateOnScroll>

        <div className="flex flex-col md:flex-row items-center md:items-stretch justify-center gap-4">
          {steps.map((step, index) => (
            <div
              key={step.title}
              className="flex flex-col md:flex-row items-center"
            >
              <AnimateOnScroll delay={index * 0.1}>
                <Card
                  className={cn(
                    "w-full md:w-48 lg:w-56 transition-all duration-200",
                    "hover:border-primary hover:shadow-lg hover:shadow-primary/10"
                  )}
                >
                  <CardHeader className="items-center text-center">
                    <step.icon className="h-8 w-8 text-primary mb-2" />
                    <CardTitle className="text-base">{step.title}</CardTitle>
                    <CardDescription className="text-xs">
                      {step.description}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </AnimateOnScroll>

              {index < steps.length - 1 && (
                <ArrowRight
                  className="hidden md:block h-5 w-5 text-muted-foreground mx-2 shrink-0"
                  aria-hidden="true"
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
