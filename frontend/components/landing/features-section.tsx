"use client";

import { Zap, WifiOff, GitMerge, Users } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import AnimateOnScroll from "@/components/landing/animate-on-scroll";

const features = [
  {
    title: "Real-Time Sync",
    description: "Sub-200ms propagation across all connected clients",
    icon: Zap,
    href: "#stress-test",
  },
  {
    title: "Offline Support",
    description: "Queue up to 10,000 operations while disconnected",
    icon: WifiOff,
    href: "#split-screen",
  },
  {
    title: "Conflict Resolution",
    description: "LWW with HLC timestamps for deterministic merges",
    icon: GitMerge,
    href: "#conflict-visualizer",
  },
  {
    title: "Presence Tracking",
    description: "See who's online and collaborating in real-time",
    icon: Users,
    href: "#whiteboard",
  },
];

export default function FeaturesSection() {
  return (
    <section id="features" className="px-4 sm:px-6 lg:px-8 py-20">
      <div className="max-w-6xl mx-auto">
        <AnimateOnScroll>
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-4">
            Key Features
          </h2>
          <p className="text-muted-foreground text-center max-w-2xl mx-auto mb-12">
            Built for demanding real-time applications with strong consistency
            guarantees.
          </p>
        </AnimateOnScroll>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((feature, index) => (
            <AnimateOnScroll key={feature.title} delay={index * 0.1}>
              <a
                href={feature.href}
                className="block h-full"
              >
                <Card className="h-full transition-all duration-200 hover:border-primary/50 hover:shadow-md">
                  <CardHeader>
                    <feature.icon className="h-8 w-8 text-primary mb-2" />
                    <CardTitle className="text-lg">{feature.title}</CardTitle>
                    <CardDescription>{feature.description}</CardDescription>
                  </CardHeader>
                </Card>
              </a>
            </AnimateOnScroll>
          ))}
        </div>
      </div>
    </section>
  );
}
