import type { BodyDef } from '../data/types';
import type { BakedArrays } from './bake';

/**
 * Hands high-resolution surface bakes to one background Web Worker (one job at a time, in
 * order), so a sharp planet map can be computed without freezing the game.
 */
let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (r: (BakedArrays & { w: number; h: number }) | null) => void>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./bakeWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = e => { const cb = pending.get(e.data.id); pending.delete(e.data.id); cb?.(e.data); };
    worker.onerror = () => { for (const cb of pending.values()) cb(null); pending.clear(); };
  } catch { worker = null; }
  return worker;
}

/** bake a body's surface at w×h in the background; resolves null if workers are unavailable */
export function bakeInBackground(def: BodyDef, w: number, h: number): Promise<(BakedArrays & { w: number; h: number }) | null> {
  const wk = getWorker();
  if (!wk) return Promise.resolve(null);
  const id = nextId++;
  return new Promise(resolve => {
    pending.set(id, resolve);
    wk.postMessage({ id, def, w, h });
  });
}
