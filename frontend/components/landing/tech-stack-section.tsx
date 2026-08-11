import AnimateOnScroll from "@/components/landing/animate-on-scroll";
import { cn } from "@/lib/utils";

interface TechItem {
  name: string;
  icon: string; // emoji or short symbol as fallback
}

const categories = [
  {
    label: "Runtime",
    technologies: [
      { name: "Node.js", icon: "⬢" },
      { name: "TypeScript", icon: "TS" },
      { name: "Next.js 14", icon: "▲" },
      { name: "Rust (napi-rs)", icon: "🦀" },
    ],
  },
  {
    label: "Networking",
    technologies: [
      { name: "WebSocket", icon: "⚡" },
      { name: "JWT Auth", icon: "🔐" },
      { name: "HLC Timestamps", icon: "🕐" },
    ],
  },
  {
    label: "Data",
    technologies: [
      { name: "CRDT (LWW)", icon: "🔀" },
      { name: "PostgreSQL", icon: "🐘" },
      { name: "Redis", icon: "🔴" },
    ],
  },
  {
    label: "Testing",
    technologies: [
      { name: "Vitest", icon: "⚡" },
      { name: "fast-check", icon: "✓" },
      { name: "RTL", icon: "🧪" },
    ],
  },
];

export default function TechStackSection() {
  return (
    <section id="tech-stack" className="px-4 sm:px-6 lg:px-8 py-20">
      <div className="max-w-4xl mx-auto">
        <AnimateOnScroll>
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold">
              Tech Stack
            </h2>
          </div>
        </AnimateOnScroll>

        <div className="grid gap-6 sm:grid-cols-2">
          {categories.map((category, index) => (
            <AnimateOnScroll key={category.label} delay={index * 0.1}>
              <div className="rounded-lg border border-border bg-card p-6">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
                  {category.label}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {category.technologies.map((tech) => (
                    <span
                      key={tech.name}
                      className={cn(
                        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm",
                        "bg-background-surface border border-border text-foreground"
                      )}
                    >
                      <span className="text-base leading-none">{tech.icon}</span>
                      {tech.name}
                    </span>
                  ))}
                </div>
              </div>
            </AnimateOnScroll>
          ))}
        </div>
      </div>
    </section>
  );
}
