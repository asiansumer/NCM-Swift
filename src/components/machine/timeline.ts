export const DURATION = 5.8;
export const HANDOFF_START = 4.38;
export const HANDOFF_STAGGER = .13;
export const HANDOFF_DURATION = .86;
export const STAGES = ['READY', 'ANALYZE', 'FEED', 'PROCESS', 'DELIVER'].map(english => ({ english }));
export function stageAt(time: number) { return time < .12 ? 0 : time < .75 ? 1 : time < 2.3 ? 2 : time < 3.65 ? 3 : 4; }
export function clamp(n: number) { return Math.max(0, Math.min(1, n)); }
export function smooth(n: number) { const t = clamp(n); return t * t * (3 - 2 * t); }
export function smoother(n: number) { const t = clamp(n); return t*t*t*(t*(t*6-15)+10); }
