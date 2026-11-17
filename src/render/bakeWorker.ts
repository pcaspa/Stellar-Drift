/// <reference lib="webworker" />
import { Surface } from '../sim/surface';
import type { BodyDef } from '../data/types';
import { bakeArrays } from './bake';

/** background surface baking: {id, def, w, h} -> {id, w, h, map, bump?, emissive?, rough?} */
self.onmessage = (e: MessageEvent<{ id: number; def: BodyDef; w: number; h: number }>) => {
  const { id, def, w, h } = e.data;
  const out = bakeArrays(new Surface(def), w, h);
  const transfer = [out.map, out.bump, out.emissive, out.rough].filter(Boolean).map(a => (a as Uint8ClampedArray).buffer);
  (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, w, h, ...out }, transfer);
};
