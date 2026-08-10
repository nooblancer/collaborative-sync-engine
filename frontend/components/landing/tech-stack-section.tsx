import AnimateOnScroll from "@/components/landing/animate-on-scroll";
import { Badge } from "@/components/ui/badge";

const categories = [
  {
    label: "Runtime",
    technologies: ["Node.js", "TypeScript", "Next.js 14"],
  },
  {
    label: "Networking",
    technologies: ["WebSocket", "JWT Authentication", "Hybrid Logical Clocks"],
  },
  {
    label: "Data",
    technologies: ["CRDT (LWW-Register)", "SQLite", "Redis"],
  },
  {
    label: "Testing",
    technologies: ["Vitest", "fast-check", "React Testing Library"],
  },
];

export default function TechStackSection() {
  return (
    <section id="tech-stack" className="px-4 sm:px-6 lg:px-8 py-20">
      <div className="max-w-4xl mx-auto">
        <AnimateOnScroll>
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Tech Stack
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Built with modern, battle-tested technologies
            </p>
          </div>
        </AnimateOnScroll>

        <div className="grid gap-8 sm:grid-cols-2">
          {categories.map((category, index) => (
            <AnimateOnScroll key={category.label} delay={index * 0.1}>
              <div className="rounded-lg border border-border bg-card p-6">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
                  {category.label}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {category.technologies.map((tech) => (
                    <Badge key={tech} variant="secondary">
                      {tech}
                    </Badge>
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
