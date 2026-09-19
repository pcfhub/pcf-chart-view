/**
 * A date column as buckets. Pure, and shared by both routes so that the
 * server's `dategrouping` rows and the browser's own bucketing agree on the
 * key and the label of "March 2026".
 *
 * **The day is the Dataverse user's, never the browser's.** A dataset date
 * arrives as an ISO instant, and the calendar day it falls on depends on
 * whose zone is asked. The platform's own grid, and the server's
 * `dategrouping`, both use the user's — so a chart bucketing by the
 * browser's `getMonth()` disagrees with the grid under it for every user
 * whose machine is not where their Dataverse settings say. See *A date read
 * through a dataset* in the skill; pcf-calendar-view learned it on the form.
 * `offsetMinutes` is `userSettings.getTimeZoneOffsetMinutes(date)`, and the
 * rig's `userTimeZoneOffset` switch is what can catch a caller passing the
 * browser's instead.
 */

import { DateGrouping } from './types';

/** The user's wall-clock components of an instant. */
export interface Wall {
    year: number;
    /** 1–12 */
    month: number;
    /** 1–31 */
    day: number;
}

export function wallOf(instant: Date, offsetMinutes: number): Wall {
    const shifted = new Date(instant.getTime() + offsetMinutes * 60_000);

    return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/**
 * A `Date` from what a record hands over: an ISO string, a `Date`, or the
 * `null`/`undefined`/`''` of a blank. Anything unreadable is a blank rather
 * than an *Invalid Date* group.
 */
export function readDate(raw: unknown): Date | null {
    if (raw instanceof Date) {
        return Number.isNaN(raw.getTime()) ? null : raw;
    }

    if (typeof raw !== 'string' || raw.trim() === '') {
        return null;
    }

    const parsed = new Date(raw);

    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * The week of the year as Dataverse's `dategrouping='week'` counts it, which
 * follows SQL Server's `DATEPART(week)`: weeks start on Sunday and week 1 is
 * whichever week holds 1 January — not ISO 8601. Measured? **No** — see
 * SPEC.md *Not verified*; the probe asks (P6). The browser route follows the
 * same rule so the two agree if the guess is right, and are wrong together
 * in a way the probe answer corrects in one place.
 */
export function weekOfYear(wall: Wall): number {
    const jan1 = Date.UTC(wall.year, 0, 1);
    const day = Date.UTC(wall.year, wall.month - 1, wall.day);
    const jan1Dow = new Date(jan1).getUTCDay(); // 0 = Sunday
    const dayOfYear = Math.floor((day - jan1) / 86_400_000); // 0-based

    return Math.floor((dayOfYear + jan1Dow) / 7) + 1;
}

export const quarterOf = (month: number): number => Math.floor((month - 1) / 3) + 1;

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

/**
 * The bucket a wall date falls in, as the sortable key the two outputs and
 * the sort share: `2026`, `2026-Q1`, `2026-03`, `2026-W11`, `2026-03-14`.
 * `bucket` is the number the server's `dategrouping` returns for the same
 * date, so the server route can build the same key from `(year, bucket)`.
 */
export function bucketOf(wall: Wall, grouping: DateGrouping): { key: string; bucket: number } {
    switch (grouping) {
        case 'year':
            return { key: String(wall.year), bucket: wall.year };
        case 'quarter': {
            const q = quarterOf(wall.month);
            return { key: `${wall.year}-Q${q}`, bucket: q };
        }
        case 'week': {
            const w = weekOfYear(wall);
            return { key: `${wall.year}-W${pad2(w)}`, bucket: w };
        }
        case 'day':
            return { key: `${wall.year}-${pad2(wall.month)}-${pad2(wall.day)}`, bucket: wall.day };
        case 'month':
        default:
            return { key: `${wall.year}-${pad2(wall.month)}`, bucket: wall.month };
    }
}

/**
 * The server's `(year, bucket)` pair → the same key the browser route makes.
 * For `day` the server's bucket is the day of the *month*, which needs the
 * month too — so a day grouping on the server asks for three group columns
 * and passes the month here.
 */
export function keyFromBucket(grouping: DateGrouping, year: number, bucket: number, month?: number): string {
    switch (grouping) {
        case 'year':
            return String(year);
        case 'quarter':
            return `${year}-Q${bucket}`;
        case 'week':
            return `${year}-W${pad2(bucket)}`;
        case 'day':
            return `${year}-${pad2(month ?? 1)}-${pad2(bucket)}`;
        case 'month':
        default:
            return `${year}-${pad2(bucket)}`;
    }
}

/** What labels need: month names in the user's language, and two templates. */
export interface DateLabels {
    /** Twelve short names, January first. */
    monthNames: string[];
    /** `W{0} {1}` — week, year. */
    week: string;
    /** `Q{0} {1}` — quarter, year. */
    quarter: string;
    /** A whole day as the user's short date. */
    formatDay: (year: number, month: number, day: number) => string;
}

/** The text a bucket key renders as. A key this cannot read is shown as itself. */
export function labelForKey(key: string, labels: DateLabels): string {
    let m = /^(\d{4})$/.exec(key);

    if (m) {
        return m[1];
    }

    m = /^(\d{4})-Q([1-4])$/.exec(key);

    if (m) {
        return labels.quarter.replace('{0}', m[2]).replace('{1}', m[1]);
    }

    m = /^(\d{4})-W(\d{2})$/.exec(key);

    if (m) {
        return labels.week.replace('{0}', String(Number(m[2]))).replace('{1}', m[1]);
    }

    m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);

    if (m) {
        return labels.formatDay(Number(m[1]), Number(m[2]), Number(m[3]));
    }

    m = /^(\d{4})-(\d{2})$/.exec(key);

    if (m) {
        const name = labels.monthNames[Number(m[2]) - 1] ?? m[2];
        return `${name} ${m[1]}`;
    }

    return key;
}

/** English short month names — the fallback when the host publishes none. */
export const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
