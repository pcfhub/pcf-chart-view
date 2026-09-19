/**
 * Readings → groups. Pure, and the same code for both routes: the server
 * hands over one reading per group with its count already summed, the
 * browser hands over one reading per record, and `groupReadings` cannot tell
 * — which is what makes a fixture-driven suite a fair test of the server
 * path's arithmetic.
 */

import { Aggregate, CategoryKind, ChartData, Group, Reading, SortBy, Source } from './types';

/** The key the blank group is kept under. `null` readings land here. */
export const BLANK_KEY = '';

/** The key the *Other* bucket is kept under — a spelling no real key takes. */
export const OTHER_KEY = '\u0000other';

interface Accumulator {
    key: string;
    label: string;
    sortKey: string | number;
    count: number;
    /** Running sum, min and max of the measure; `n` is how many readings carried one. */
    sum: number;
    min: number;
    max: number;
    n: number;
    /**
     * On the server route a reading's `value` is already the group's
     * aggregate, so an `avg` cannot be re-averaged as a sum of counts — the
     * server's readings are passed through when there is exactly one per key.
     */
    readings: number;
}

/**
 * Group the readings by key and compute the aggregate. A reading with no
 * value counts for the group and contributes nothing to sum/min/max — the
 * server's `sum` ignores nulls the same way.
 */
export function groupReadings(readings: Reading[]): Map<string, Accumulator> {
    const groups = new Map<string, Accumulator>();

    for (const reading of readings) {
        const key = reading.key ?? BLANK_KEY;
        let acc = groups.get(key);

        if (!acc) {
            acc = { key, label: reading.label, sortKey: reading.sortKey, count: 0, sum: 0, min: Infinity, max: -Infinity, n: 0, readings: 0 };
            groups.set(key, acc);
        }

        acc.count += reading.count;
        acc.readings += 1;

        if (reading.value !== null && Number.isFinite(reading.value)) {
            acc.n += 1;
            acc.sum += reading.value;
            acc.min = Math.min(acc.min, reading.value);
            acc.max = Math.max(acc.max, reading.value);
        }
    }

    return groups;
}

/**
 * The number a group shows, for the aggregate asked. A server reading's
 * `count` is the group's record count and its `value` the group's aggregate,
 * so summing counts and summing values both come out right for a count and
 * a sum; an average is the one that cannot be re-averaged from a server
 * reading, and is passed through when the readings came from there.
 */
export function measureOf(acc: Accumulator, aggregate: Aggregate, fromServer: boolean): number {
    switch (aggregate) {
        case 'sum':
            return acc.n > 0 ? acc.sum : 0;
        case 'avg':
            return acc.n === 0 ? 0 : fromServer ? acc.sum / acc.readings : acc.sum / acc.n;
        case 'min':
            return acc.n > 0 ? acc.min : 0;
        case 'max':
            return acc.n > 0 ? acc.max : 0;
        case 'count':
        default:
            return acc.count;
    }
}

export interface FinishOptions {
    aggregate: Aggregate;
    categoryKind: CategoryKind;
    sortBy: SortBy;
    /** `null` keeps every group. */
    topN: number | null;
    source: Source;
    otherLabel: string;
    blankLabel: string;
    /** A colour per key — a Choice's option colours — consulted before the palette. */
    colorFor: (key: string, index: number) => string;
    /** A Choice's option position by key, from metadata, for the `label` sort; `undefined` falls back to the reading's own sort key. */
    orderFor?: (key: string) => number | undefined;
    /** Records the readings stand for, or `null`. */
    recordCount: number | null;
}

/**
 * Sort, fold and colour. A date category is always chronological by its
 * key, whatever `sortBy` says, and never folded — a chart by month with an
 * *Other* bucket is not a chart by month. The blank group sorts last under
 * a `label` sort and takes its place by size under a `value` sort.
 */
export function finishGroups(groups: Map<string, Accumulator>, o: FinishOptions): ChartData {
    const fromServer = o.source === 'server';
    const isDate = o.categoryKind === 'date';
    let list: Group[] = [];

    groups.forEach((acc) => {
        list.push({
            key: acc.key,
            label: acc.key === BLANK_KEY ? o.blankLabel : acc.label,
            value: measureOf(acc, o.aggregate, fromServer),
            count: acc.count,
            sortKey: acc.sortKey,
            other: false,
            blank: acc.key === BLANK_KEY,
            color: '',
        });
    });

    const orderOf = (g: Group): string | number => (o.orderFor ? o.orderFor(g.key) : undefined) ?? g.sortKey;
    const byLabel = (a: Group, b: Group): number => {
        if (a.blank !== b.blank) {
            return a.blank ? 1 : -1;
        }

        const x = orderOf(a);
        const y = orderOf(b);

        if (typeof x === 'number' && typeof y === 'number') {
            return x - y;
        }

        return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
    };
    const byValue = (a: Group, b: Group): number => b.value - a.value || byLabel(a, b);

    if (isDate) {
        list.sort((a, b) => (a.blank !== b.blank ? (a.blank ? 1 : -1) : a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    } else {
        list.sort(o.sortBy === 'label' ? byLabel : byValue);

        if (o.topN !== null && o.topN > 0 && list.length > o.topN + 1) {
            // Fold by size whatever the display order, then put Other last.
            const bySize = list.slice().sort(byValue);
            const keep = new Set(bySize.slice(0, o.topN).map((g) => g.key));
            const tail = list.filter((g) => !keep.has(g.key));
            const other: Group = {
                key: OTHER_KEY,
                label: o.otherLabel,
                value: foldValue(tail, o.aggregate),
                count: tail.reduce((n, g) => n + g.count, 0),
                sortKey: '\uffff',
                other: true,
                blank: false,
                color: '',
            };

            list = list.filter((g) => keep.has(g.key)).concat(other);
        }
    }

    list.forEach((group, index) => {
        group.color = group.other ? o.colorFor(OTHER_KEY, index) : o.colorFor(group.key, index);
    });

    return {
        groups: list,
        // What a percentage is taken over. For a count or a sum it is the
        // whole; for an average, min or max it is the sum of what is drawn,
        // which is what a pie of averages shows whether or not it should.
        total: list.reduce((sum, g) => sum + g.value, 0),
        recordCount: o.recordCount,
        source: o.source,
    };
}

/** What the *Other* bucket shows: the tail's sum for count/sum, and the tail's own aggregate otherwise. */
export function foldValue(tail: Group[], aggregate: Aggregate): number {
    if (tail.length === 0) {
        return 0;
    }

    switch (aggregate) {
        case 'min':
            return Math.min(...tail.map((g) => g.value));
        case 'max':
            return Math.max(...tail.map((g) => g.value));
        case 'avg': {
            // Weighted by record count, which is the average of the underlying records.
            const n = tail.reduce((s, g) => s + g.count, 0);
            return n === 0 ? 0 : tail.reduce((s, g) => s + g.value * g.count, 0) / n;
        }
        default:
            return tail.reduce((s, g) => s + g.value, 0);
    }
}

/** A percentage of the total, rounded to a whole number; `0` for an empty chart. */
export const percentOf = (value: number, total: number): number => (total > 0 ? Math.round((value / total) * 100) : 0);

/**
 * The categorical palette. Ten colours that hold apart on a white and a dark
 * surface, brand blue first so a single-series bar chart is the form's own
 * accent. A Choice's option colour wins over these when metadata supplies
 * one.
 */
export const PALETTE = ['#0f6cbd', '#e3008c', '#00b294', '#ffaa44', '#8764b8', '#da3b01', '#4f6bed', '#c19c00', '#038387', '#8e562e'];

/** Where *Other* and *blank* are drawn: a neutral, so they read as remainder. */
export const NEUTRAL = '#8a8886';
