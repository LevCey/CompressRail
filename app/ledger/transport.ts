// HTTP transport for the JSON Ledger API. The client depends on this interface, so
// it can be driven by a real fetch against a participant node or by a stub in tests.
// The access token (a per-party JWT) is supplied per request and never stored here.

export interface LedgerResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface Transport {
  post(path: string, body: unknown, token: string): Promise<LedgerResponse>;
  get(path: string, token: string): Promise<LedgerResponse>;
}

// A fetch-based transport against a participant's JSON Ledger API base URL. The base
// URL and token come from configuration; nothing is hard-coded.
export function fetchTransport(baseUrl: string): Transport {
  const base = baseUrl.replace(/\/+$/, "");
  const authHeader = (token: string): Record<string, string> =>
    token.length > 0 ? { Authorization: `Bearer ${token}` } : {};
  const parse = async (res: Response): Promise<LedgerResponse> => {
    const text = await res.text();
    let body: unknown = null;
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return { status: res.status, body };
  };
  return {
    async post(path, body, token) {
      const res = await fetch(base + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...authHeader(token),
        },
        body: JSON.stringify(body),
      });
      return parse(res);
    },
    async get(path, token) {
      const res = await fetch(base + path, {
        method: "GET",
        headers: { Accept: "application/json", ...authHeader(token) },
      });
      return parse(res);
    },
  };
}

// Wraps a transport with a bounded retry on transient upstream failures (502/503/
// 504). The DevNet participant intermittently returns 503 (backpressure), notably on
// party allocation. Retrying these is safe: a 503 means the request was rejected
// before processing, GETs are idempotent, and submit-and-wait carries a commandId in
// its body so the ledger deduplicates a retried command. Backoff and sleep are
// injectable so tests run without real delays.
export function retryingTransport(
  inner: Transport,
  opts: {
    readonly attempts?: number;
    readonly backoffMs?: readonly number[];
    readonly sleep?: (ms: number) => Promise<void>;
    readonly onRetry?: (status: number, attempt: number) => void;
  } = {},
): Transport {
  const attempts = opts.attempts ?? 3;
  const backoffMs = opts.backoffMs ?? [1000, 3000];
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const retryable = new Set([502, 503, 504]);
  const run = async (call: () => Promise<LedgerResponse>): Promise<LedgerResponse> => {
    let res = await call();
    for (let attempt = 1; attempt < attempts && retryable.has(res.status); attempt += 1) {
      opts.onRetry?.(res.status, attempt);
      await sleep(backoffMs[attempt - 1] ?? backoffMs[backoffMs.length - 1] ?? 3000);
      res = await call();
    }
    return res;
  };
  return {
    post: (path, body, token) => run(() => inner.post(path, body, token)),
    get: (path, token) => run(() => inner.get(path, token)),
  };
}
