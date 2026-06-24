// libsodium initialization. The WASM backend must finish loading before any
// primitive is called, so every entry point awaits `ready()` and uses the object it
// returns — the same instance the library populates once initialization completes.
import _sodium from "libsodium-wrappers";

export type Sodium = typeof _sodium;

let readyPromise: Promise<void> | undefined;

export async function ready(): Promise<Sodium> {
  readyPromise ??= _sodium.ready;
  await readyPromise;
  return _sodium;
}
