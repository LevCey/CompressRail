import type { ReactNode } from "react";
import Link from "next/link";
import { DocsSidebar } from "./docs-sidebar";
import { DocsSearch } from "./docs-search";

export function DocsShell({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex h-14 items-center justify-between border-b border-border bg-surface px-6">
        <Link href="/" className="font-mono text-sm font-semibold tracking-tight text-foreground">
          CompressRail docs
        </Link>
        <div className="flex items-center gap-4">
          <DocsSearch />
          <a
            href="https://github.com/LevCey/CompressRail"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-muted hover:text-foreground"
          >
            GitHub
          </a>
        </div>
      </header>
      <div className="flex flex-1">
        <DocsSidebar />
        <main className="docs-prose flex-1 px-8 py-10">
          <div className="mx-auto max-w-3xl">{children}</div>
        </main>
      </div>
      <footer className="border-t border-border px-6 py-4 text-center text-xs text-muted">
        CompressRail — Apache-2.0 — native public documentation, not a mirror of any
        private specification.
      </footer>
    </div>
  );
}
