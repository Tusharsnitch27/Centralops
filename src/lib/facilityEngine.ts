// Facility capacity engine (from the S&OP "MP+Technical" sheet). Pure; runs in the browser.
// Pools run in parallel; the longest of inward / outward sets the facility's window. Priority restickering must fit inside
// that window — if it doesn't, the extra stickering capacity per day needed to fit is the answer. Technical (non-priority)
// restickering is scheduled separately on the same sticker line.
export type Facility = "North WH" | "South WH";
export interface FacilityCaps { facility: Facility; inward: number; outward: number; sticker: number }
export interface Workload { facility: Facility; channel: string; inwards: number; picking: number; restick: number; outward: number; priority: boolean }
export interface EngineInput { caps: FacilityCaps[]; loads: Workload[] }

export const DEFAULT_ENGINE: EngineInput = {
  caps: [
    { facility: "North WH", inward: 20000, outward: 20000, sticker: 3000 },
    { facility: "South WH", inward: 30000, outward: 20000, sticker: 3000 },
  ],
  loads: [
    { facility: "North WH", channel: "Flipkart", inwards: 104000, picking: 0, restick: 15000, outward: 104000, priority: true },
    { facility: "North WH", channel: "Technical", inwards: 100000, picking: 0, restick: 100000, outward: 0, priority: false },
    { facility: "North WH", channel: "Myntra", inwards: 0, picking: 25000, restick: 25000, outward: 55000, priority: true },
    { facility: "North WH", channel: "Retail", inwards: 0, picking: 0, restick: 0, outward: 14000, priority: false },
    { facility: "South WH", channel: "Flipkart", inwards: 172600, picking: 0, restick: 20000, outward: 172600, priority: true },
    { facility: "South WH", channel: "Myntra", inwards: 0, picking: 25000, restick: 25000, outward: 55000, priority: true },
    { facility: "South WH", channel: "Retail", inwards: 0, picking: 0, restick: 0, outward: 12000, priority: false },
  ],
};

const div = (a: number, b: number) => (b > 0 ? a / b : a > 0 ? Infinity : 0);
export interface FacilityResult {
  facility: Facility; inward: number; outwardPool: number; priorityRestick: number; technicalRestick: number;
  inwardDays: number; outwardDays: number; stickerDays: number; window: number; bottleneck: "Inward" | "Outward" | "Stickering";
  requiredSticker: number; additionalSticker: number; stickerAfter: number; daysAfter: number; technicalDays: number;
}
export function runEngine(x: EngineInput) {
  const facilities = x.caps.map((c): FacilityResult => {
    const ls = x.loads.filter((l) => l.facility === c.facility);
    const inward = ls.reduce((a, l) => a + l.inwards, 0);
    const outwardPool = ls.reduce((a, l) => a + l.outward + l.picking, 0);
    const priorityRestick = ls.filter((l) => l.priority).reduce((a, l) => a + l.restick, 0);
    const technicalRestick = ls.filter((l) => !l.priority).reduce((a, l) => a + l.restick, 0);
    const inwardDays = div(inward, c.inward), outwardDays = div(outwardPool, c.outward), stickerDays = Math.ceil(div(priorityRestick, c.sticker));
    const window = Math.ceil(Math.max(inwardDays, outwardDays));
    const requiredSticker = window > 0 ? Math.ceil(priorityRestick / window) : priorityRestick;
    const additionalSticker = Math.max(0, requiredSticker - c.sticker);
    const stickerAfter = c.sticker + additionalSticker;
    const daysAfter = Math.max(window, Math.ceil(div(priorityRestick, stickerAfter)));
    const bottleneck = stickerDays > window ? "Stickering" : inwardDays >= outwardDays ? "Inward" : "Outward";
    return { facility: c.facility, inward, outwardPool, priorityRestick, technicalRestick, inwardDays, outwardDays, stickerDays, window, bottleneck,
      requiredSticker, additionalSticker, stickerAfter, daysAfter, technicalDays: Math.ceil(div(technicalRestick, stickerAfter)) };
  });
  const channels = x.loads.map((l) => {
    const c = x.caps.find((k) => k.facility === l.facility)!;
    const f = facilities.find((k) => k.facility === l.facility)!;
    const days = (sticker: number) => Math.ceil(Math.max(div(l.inwards, c.inward), div(l.outward + l.picking, c.outward), div(l.restick, sticker)));
    return { ...l, daysNow: days(c.sticker), daysAfter: l.priority ? days(f.stickerAfter) : days(c.sticker) };
  });
  return { facilities, channels };
}
