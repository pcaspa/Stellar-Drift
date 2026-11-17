import { AU_KM, LY_M } from '../data/types';

const AU = AU_KM * 1000;

export function fmtDist(m: number): string {
  const a = Math.abs(m);
  if (!isFinite(m)) return '∞';
  if (a < 1000) return `${m.toFixed(a < 100 ? 1 : 0)} m`;
  if (a < 1e6) return `${(m / 1000).toFixed(a < 1e5 ? 2 : 1)} km`;
  if (a < 1e9) return `${Math.round(m / 1000).toLocaleString('en-US')} km`;
  if (a < 0.01 * AU) return `${(m / 1e9).toFixed(2)} M km`;
  if (a < 1000 * AU) return `${(m / AU).toFixed(a < 10 * AU ? 3 : 2)} AU`;
  return `${(m / LY_M).toFixed(2)} ly`;
}

export function fmtSpeed(v: number): string {
  const a = Math.abs(v);
  if (a < 1000) return `${v.toFixed(a < 100 ? 1 : 0)} m/s`;
  if (a < 1e6) return `${(v / 1000).toFixed(a < 1e5 ? 2 : 1)} km/s`;
  return `${Math.round(v / 1000).toLocaleString('en-US')} km/s`;
}

export function fmtTime(s: number): string {
  if (!isFinite(s)) return '—';
  const a = Math.abs(s);
  if (a < 90) return `${s.toFixed(0)} s`;
  if (a < 5400) return `${(s / 60).toFixed(1)} min`;
  if (a < 86400 * 2) return `${(s / 3600).toFixed(1)} h`;
  if (a < 86400 * 730) return `${(s / 86400).toFixed(1)} d`;
  return `${(s / 86400 / 365.25).toFixed(1)} yr`;
}

export function fmtWarp(w: number): string {
  if (w < 1.05) return '1×';
  if (w < 1000) return `${w.toFixed(w < 10 ? 1 : 0)}×`;
  if (w < 1e6) return `${(w / 1000).toFixed(w < 1e4 ? 1 : 0)}k×`;
  return `${(w / 1e6).toFixed(1)}M×`;
}

export function fmtNum(n: number, digits = 0): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
