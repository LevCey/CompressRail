// Search (R8.10): a client-side substring match over the page titles, descriptions,
// and keywords in `lib/pages.ts`. No external search service and no analytics call
// — the whole index is the small, native page list.
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DOC_PAGES } from "@/lib/pages";

export function DocsSearch() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return DOC_PAGES.filter((page) =>
      [page.title, page.description, ...page.keywords].some((field) => field.toLowerCase().includes(q)),
    );
  }, [query]);

  return (
    <div className="relative w-64">
      <input
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search docs…"
        className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:border-accent-action focus:outline-none"
      />
      {open && query.trim() && (
        <div className="absolute z-10 mt-1 w-full rounded border border-border bg-surface-raised shadow-lg">
          {results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted">No matches.</p>
          ) : (
            results.map((page) => (
              <Link
                key={page.slug}
                href={page.slug ? `/${page.slug}` : "/"}
                className="block px-3 py-2 text-sm text-foreground hover:bg-surface"
                onClick={() => setOpen(false)}
              >
                {page.title}
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
