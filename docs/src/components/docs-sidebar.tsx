"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOC_PAGES } from "@/lib/pages";

export function DocsSidebar() {
  const pathname = usePathname();

  return (
    <nav className="flex w-56 flex-shrink-0 flex-col gap-0.5 border-r border-border bg-surface p-3">
      {DOC_PAGES.map((page) => {
        const href = page.slug ? `/${page.slug}` : "/";
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={`rounded px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-surface-raised text-foreground"
                : "text-muted hover:bg-surface-raised hover:text-foreground"
            }`}
          >
            {page.title}
          </Link>
        );
      })}
    </nav>
  );
}
