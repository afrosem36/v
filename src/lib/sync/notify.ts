/**
 * A tiny, dependency-free pub-sub so outbox.ts can announce "a local write just happened" without
 * importing engine.ts directly (which imports from outbox.ts already — a direct import back would
 * be circular). engine.ts subscribes to this to trigger a near-immediate push instead of waiting
 * for the next poll.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function notifyLocalWrite(): void {
  for (const l of listeners) l();
}

export function onLocalWrite(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
