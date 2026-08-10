"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

export default function HeroSection() {
  return (
    <section className="relative min-h-[80vh] flex items-center justify-center px-4 sm:px-6 lg:px-8 pt-24 pb-16">
      <motion.div
        className="max-w-4xl mx-auto text-center"
        variants={container}
        initial="hidden"
        animate="show"
      >
        <motion.div variants={item}>
          <Badge variant="outline" className="mb-6">
            Engine v1.0 • Operational
          </Badge>
        </motion.div>

        <motion.h1
          variants={item}
          className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-6"
        >
          <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
            Real-Time Multiplayer
          </span>{" "}
          <br className="hidden sm:block" />
          Collaboration Engine
        </motion.h1>

        <motion.p
          variants={item}
          className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-10"
        >
          Real-time collaborative state synchronization powered by CRDTs.
          Automatic conflict resolution, offline support, and sub-200ms
          propagation across distributed clients.
        </motion.p>

        <motion.div
          variants={item}
          className="flex flex-wrap items-center justify-center gap-4"
        >
          <Link href="/demo">
            <Button size="lg">Launch Demo</Button>
          </Link>
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="outline" size="lg">
              <Github className="mr-2 h-4 w-4" />
              GitHub
            </Button>
          </a>
          <a href="#architecture">
            <Button variant="ghost" size="lg">
              View Docs
            </Button>
          </a>
        </motion.div>
      </motion.div>
    </section>
  );
}
