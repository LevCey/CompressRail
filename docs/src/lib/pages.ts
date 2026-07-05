// The docs navigation (R8.10): role-based ordering of the native public pages.
// Each entry's `keywords` back the client-side search — no external search
// service, no analytics call, just a substring match over this list.
export interface DocPage {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly keywords: readonly string[];
}

export const DOC_PAGES: readonly DocPage[] = [
  {
    slug: "",
    title: "Overview",
    description: "What CompressRail is and the one claim it proves.",
    keywords: ["overview", "compressrail", "operator-blind", "claim", "introduction"],
  },
  {
    slug: "privacy-model",
    title: "Privacy model and boundary",
    description: "What operator-blind means, precisely, and what it does not.",
    keywords: ["privacy", "boundary", "operator-blind", "matrix", "encryption", "canton", "topology"],
  },
  {
    slug: "architecture",
    title: "Architecture",
    description: "The Daml model, the off-ledger client, the demo, and scope.",
    keywords: ["architecture", "daml", "ledger", "crypto", "verify", "solver", "model", "scope"],
  },
  {
    slug: "run-guide",
    title: "Run guide",
    description: "Build the model, start a sandbox, run the tests and the demo.",
    keywords: ["run", "build", "sandbox", "dpm", "install", "test", "e2e"],
  },
  {
    slug: "demo-guide",
    title: "Demo guide",
    description: "Party selection, the Compression Console, the X-ray, the matrix.",
    keywords: ["demo", "console", "x-ray", "cheat", "counter", "matrix", "party"],
  },
];
