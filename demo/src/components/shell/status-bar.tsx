// The sticky footer status bar (R8.1): connection + cycle status, always visible.
export type ConnectionState = "connected" | "connecting" | "disconnected";

export interface StatusBarProps {
  readonly connection: ConnectionState;
  readonly network: string;
  readonly cycleStatus: string;
}

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  connected: "Connected",
  connecting: "Connecting…",
  disconnected: "Disconnected",
};

const CONNECTION_DOT: Record<ConnectionState, string> = {
  connected: "bg-accent-live",
  connecting: "bg-accent-propose",
  disconnected: "bg-accent-alert",
};

export function StatusBar({ connection, network, cycleStatus }: StatusBarProps) {
  return (
    <footer className="sticky bottom-0 flex h-8 items-center gap-4 border-t border-border bg-surface px-4 font-mono text-[11px] text-muted">
      <span className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${CONNECTION_DOT[connection]}`} />
        {CONNECTION_LABEL[connection]}
      </span>
      <span className="text-border">·</span>
      <span>{network}</span>
      <span className="text-border">·</span>
      <span>{cycleStatus}</span>
    </footer>
  );
}
