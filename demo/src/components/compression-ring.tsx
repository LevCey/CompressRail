// The compression ring visual (demo-density Item 3): a native before/after diagram
// of the fixture ring. The 3-node shape (A, B, C) is fixed — the fixture is
// deterministic, and shape is not data. Every number is live: the before edge count
// and the after replacement count come from the real CycleResult, never constants.
// Before a cycle runs it shows the outlined ring shape with no numbers.
"use client";

import type { CycleResult } from "@compressrail/app/scenario/cycle";

const NODES: Record<string, { readonly x: number; readonly y: number }> = {
  A: { x: 120, y: 34 },
  B: { x: 34, y: 170 },
  C: { x: 206, y: 170 },
};

const RING_EDGES: ReadonlyArray<readonly [string, string]> = [
  ["A", "B"],
  ["B", "C"],
  ["C", "A"],
];

function Ring({ edgeCount, toneClass }: { readonly edgeCount: number; readonly toneClass: string }) {
  const edges = RING_EDGES.slice(0, Math.max(0, edgeCount));
  return (
    <svg viewBox="0 0 240 204" className="h-44 w-full" role="img" aria-label="compression ring">
      {edges.map(([a, b]) => (
        <line
          key={`${a}-${b}`}
          x1={NODES[a]!.x}
          y1={NODES[a]!.y}
          x2={NODES[b]!.x}
          y2={NODES[b]!.y}
          strokeWidth={2}
          className={toneClass}
          stroke="currentColor"
        />
      ))}
      {Object.entries(NODES).map(([label, p]) => (
        <g key={label}>
          <circle cx={p.x} cy={p.y} r={18} strokeWidth={1.5} className="fill-surface-raised stroke-border" />
          <text x={p.x} y={p.y + 4} textAnchor="middle" className="fill-foreground font-mono text-xs">
            {label}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function CompressionRing({ result }: { readonly result?: CycleResult }) {
  const fullyCompressed = result != null && result.tradesTornUp > 0 && result.replacementLegCount === 0;
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <h2 className="text-sm font-medium text-foreground">Compression ring</h2>
      <p className="text-xs text-muted">
        The gross offsetting ring before the cycle, and the replacement topology after —{" "}
        {result ? "drawn from the real matching result." : "run a cycle to compute the after state."}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-4">
        <div className="flex flex-col items-center gap-2">
          <div className="text-accent-action">
            <Ring edgeCount={3} toneClass="text-accent-action" />
          </div>
          <span className="font-mono text-xs text-muted">
            {result ? `Before: ${result.tradesTornUp} bilateral trades` : "Before: gross ring"}
          </span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className="text-accent-live">
            <Ring edgeCount={result ? result.replacementLegCount : 0} toneClass="text-accent-live" />
          </div>
          <span className="font-mono text-xs text-muted">
            {result
              ? `After: ${result.replacementLegCount} replacement legs${fullyCompressed ? " — fully compressed" : ""}`
              : "After: —"}
          </span>
        </div>
      </div>
    </div>
  );
}
