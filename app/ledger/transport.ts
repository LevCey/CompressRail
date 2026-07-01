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
