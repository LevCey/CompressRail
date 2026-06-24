// Deterministic JSON serialization, so the two counterparties to a leg derive an
// identical commitment from identical terms regardless of object key order. Object
// keys are sorted; arrays keep their order; only JSON-safe values are accepted
// (no undefined, no non-finite numbers).
import type { JsonValue } from "./types";

export function canonicalize(value: JsonValue): string {
  return serialize(value);
}

function serialize(value: JsonValue): string {
  if (value === null) return "null";

  if (Array.isArray(value)) {
    return "[" + value.map(serialize).join(",") + "]";
  }

  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error("cannot canonicalize a non-finite number");
      }
      return JSON.stringify(value);
    case "object": {
      const entries = Object.keys(value)
        .sort()
        .map((key) => {
          const member = value[key];
          if (member === undefined) {
            throw new Error(`cannot canonicalize undefined at key: ${key}`);
          }
          return JSON.stringify(key) + ":" + serialize(member);
        });
      return "{" + entries.join(",") + "}";
    }
    default:
      throw new Error(`cannot canonicalize value of type ${typeof value}`);
  }
}
