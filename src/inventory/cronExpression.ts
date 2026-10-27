// A five-field cron reader (minute hour day-of-month month day-of-week), in UTC, so Ellis can compute what the
// platform's missed-run check computes without a runtime package. The platform uses cron-parser in the
// container's clock, which is UTC (calculateExpectedIntervalMs, utils/cronNextRun.ts:21-31). Supported: *, n,
// a-b, lists, /step on any of those, and three-letter month and day names. When both day fields are
// restricted a day matches either one, as in cron-parser. Anything else is unsupported and returns null.

export interface CronFields { minute: Set<number>; hour: Set<number>; dom: Set<number>; month: Set<number>; dow: Set<number>; domStar: boolean; dowStar: boolean }

const NAMES: Record<string, string[]> = {
  month: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
  dow: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
};

function field(text: string, min: number, max: number, names?: string[]): Set<number> | null {
  const out = new Set<number>();
  const num = (s: string): number | null => {
    const i = names?.indexOf(s.toUpperCase()) ?? -1;
    if (i >= 0) return i + min;
    return /^\d+$/.test(s) ? Number(s) : null;
  };
  for (const part of text.split(',')) {
    const [range, stepText] = part.split('/');
    const step = stepText === undefined ? 1 : /^\d+$/.test(stepText) && Number(stepText) > 0 ? Number(stepText) : null;
    if (step === null || range === undefined) return null;
    let lo: number | null, hi: number | null;
    if (range === '*') { lo = min; hi = max; } else if (range.includes('-')) {
      const [a, b] = range.split('-');
      lo = num(a); hi = num(b);
    } else {
      lo = num(range); hi = stepText === undefined ? lo : max;
    }
    if (lo === null || hi === null || lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out.size ? out : null;
}

export function parseCron(expr: string): CronFields | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const minute = field(parts[0], 0, 59), hour = field(parts[1], 0, 23), dom = field(parts[2], 1, 31);
  const month = field(parts[3], 1, 12, NAMES.month);
  const dowRaw = field(parts[4], 0, 7, NAMES.dow);
  if (!minute || !hour || !dom || !month || !dowRaw) return null;
  const dow = new Set([...dowRaw].map((d) => d % 7));
  return { minute, hour, dom, month, dow, domStar: parts[2] === '*', dowStar: parts[4] === '*' };
}

function dayMatches(c: CronFields, d: Date): boolean {
  if (!c.month.has(d.getUTCMonth() + 1)) return false;
  const byDom = c.dom.has(d.getUTCDate()), byDow = c.dow.has(d.getUTCDay());
  if (c.domStar && c.dowStar) return true;
  if (c.domStar) return byDow;
  if (c.dowStar) return byDom;
  return byDom || byDow;
}

const MIN = 60_000, DAY = 24 * 60 * MIN;

// The first fire strictly after `after`, or null if none within five years.
export function nextFire(c: CronFields, after: Date): Date | null {
  let t = Math.floor(after.getTime() / MIN) * MIN + MIN;
  for (let i = 0; i < 366 * 5; i++) {
    const d = new Date(t);
    if (dayMatches(c, d)) {
      for (let h = d.getUTCHours(); h < 24; h++) {
        if (!c.hour.has(h)) continue;
        for (let m = h === d.getUTCHours() ? d.getUTCMinutes() : 0; m < 60; m++) {
          if (c.minute.has(m)) return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m));
        }
      }
    }
    t = Math.floor(t / DAY) * DAY + DAY;
  }
  return null;
}

// What the platform's missed-run check uses: the gap between the next two fires after `now`.
export function expectedIntervalMs(c: CronFields, now: Date): number | null {
  const first = nextFire(c, now);
  const second = first && nextFire(c, first);
  return first && second ? second.getTime() - first.getTime() : null;
}

// The shortest and longest gap between fires over the next `days` days. They differ for a schedule that
// skips nights or weekends, which the single gap above cannot see.
export function gapRange(c: CronFields, now: Date, days = 8): { shortest: number; longest: number } | null {
  const end = now.getTime() + days * DAY;
  let prev = nextFire(c, now), shortest = Infinity, longest = 0;
  while (prev && prev.getTime() < end) {
    const next = nextFire(c, prev);
    if (!next) break;
    const gap = next.getTime() - prev.getTime();
    shortest = Math.min(shortest, gap); longest = Math.max(longest, gap);
    prev = next;
  }
  return longest > 0 ? { shortest, longest } : null;
}
