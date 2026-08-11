import Link from "next/link";
import { Github } from "lucide-react";
import { Button } from "@/components/ui/button";

const sectionLinks = [
  { href: "#architecture", label: "Architecture" },
  { href: "#features", label: "Features" },
  { href: "#demos", label: "Demos" },
  { href: "#tech-stack", label: "Tech Stack" },
  { href: "/blog", label: "Blog" },
];

export default function Navbar() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <Link href="/" className="text-lg font-semibold text-foreground">
          Convergence
        </Link>

        <div className="hidden md:flex items-center gap-6">
          {sectionLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <a
            href="https://github.com/nooblancer/collaborative-sync-engine"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub repository"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <Github className="h-5 w-5" />
          </a>
          <Link href="#demos">
            <Button size="sm">Launch Demo</Button>
          </Link>
        </div>
      </div>
    </nav>
  );
}
