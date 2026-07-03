// A KPI card (R8.1, R8.4): a labeled monospace figure with optional signed accent
// coloring (green for a positive/within-tolerance movement, red for negative).
export type KpiTone = "neutral" | "positive" | "negative";

export interface KpiCardProps {
  readonly label: string;
  readonly value: string;
  readonly caption?: string;
  readonly tone?: KpiTone;
}

const TONE_CLASS: Record<KpiTone, string> = {
  neutral: "text-foreground",
  positive: "text-accent-live",
  negative: "text-accent-alert",
};

export function KpiCard({ label, value, caption, tone = "neutral" }: KpiCardProps) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-surface p-4">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <span className={`font-mono text-2xl font-semibold ${TONE_CLASS[tone]}`}>{value}</span>
      {caption && <span className="text-xs text-muted">{caption}</span>}
    </div>
  );
}
