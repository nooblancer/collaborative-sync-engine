import Link from "next/link";
import { Github } from "lucide-react";

export default function Footer() {
  return (
    <footer className="border-t border-border px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row items-center gap-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            Collaborative Sync Engine
          </span>
          <span className="hidden sm:inline">•</span>
          <span>MIT License</span>
        </div>

        <div className="flex items-center gap-4">
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="GitHub repository"
          >
            <Github className="h-5 w-5" />
          </a>
          <Link
            href="/demo"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Demo
          </Link>
        </div>
      </div>
    </footer>
  );
}
