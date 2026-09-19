/**
 * A Web API aggregate row → a `Reading`. Pure, and written against the row
 * shape FetchXML aggregates produce: each alias as a property, a formatted
 * value under `<alias>@OData.Community.Display.V1.FormattedValue` where the
 * server sent one, and **a null group with its alias omitted** — a FetchXML
 * result carries no null-valued properties.
 *
 * What is measured and what is assumed is in SPEC.md. The shapes this reads
 * leniently, because the probe decides them (P3–P6): whether a Choice group's
 * `g` is a number or a string, whether a Lookup group's `g` is the GUID with
 * the name in the annotation, what `dategrouping` puts under the alias, and
 * whether a Money `sum` is a number with a formatted twin.
 */

import { CategoryKind, DateGrouping, Reading } from '../chart/types';
import { keyFromBucket, labelForKey, DateLabels } from '../chart/dates';
import { ALIAS } from './fetchXml';

export const FORMATTED = '@OData.Community.Display.V1.FormattedValue';

export type Row = Record<string, unknown>;

/** A value as text, or `''` for the nulls a row does not even carry. */
const text = (value: unknown): string => (value === null || value === undefined ? '' : String(value));

/** A value as a finite number, or `null`. */
export function numberOf(value: unknown): number | null {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }

    if (typeof value === 'string' && value.trim() !== '') {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }

    return null;
}

/** An id as the chart spells it — braces off, case folded. */
export const bareId = (value: unknown): string => text(value).replace(/[{}]/g, '').trim().toLowerCase();

export interface RowShape {
    categoryKind: CategoryKind;
    dateGrouping: DateGrouping;
    dateLabels: DateLabels;
    /** Yes/No labels for a TwoOptions category, `true` first. */
    twoOptions: { yes: string; no: string };
}

/**
 * One aggregate row → one reading. The group's record count is always on
 * the row (`n`); the measure is `v`, or the count itself when the chart
 * counts. A row whose count cannot be read stands for one record.
 */
export function toReading(row: Row, shape: RowShape, aggregateIsCount: boolean): Reading {
    const count = numberOf(row[ALIAS.count]) ?? 1;
    const value = aggregateIsCount ? count : numberOf(row[ALIAS.value]);
    const rawGroup = row[ALIAS.group];
    const formatted = text(row[`${ALIAS.group}${FORMATTED}`]);

    if (rawGroup === null || rawGroup === undefined || rawGroup === '') {
        return { key: null, label: '', value, count, sortKey: '' };
    }

    switch (shape.categoryKind) {
        case 'date': {
            const year = shape.dateGrouping === 'year' ? numberOf(rawGroup) : numberOf(row[ALIAS.year]);
            const bucket = numberOf(rawGroup);

            if (year === null || bucket === null) {
                return { key: null, label: '', value, count, sortKey: '' };
            }

            const key = keyFromBucket(shape.dateGrouping, year, bucket, numberOf(row[ALIAS.month]) ?? undefined);

            return { key, label: labelForKey(key, shape.dateLabels), value, count, sortKey: key };
        }
        case 'choice': {
            const option = numberOf(rawGroup);
            const key = option === null ? text(rawGroup) : String(option);
            return { key, label: formatted || key, value, count, sortKey: option ?? key };
        }
        case 'twooptions': {
            const yes = rawGroup === true || rawGroup === 1 || rawGroup === '1' || rawGroup === 'true';
            const key = yes ? '1' : '0';

            return { key, label: formatted || (yes ? shape.twoOptions.yes : shape.twoOptions.no), value, count, sortKey: yes ? 1 : 0 };
        }
        case 'lookup': {
            const key = bareId(rawGroup);
            const label = formatted || key;

            return { key, label, value, count, sortKey: label.toLowerCase() };
        }
        case 'text':
        default: {
            const key = text(rawGroup);

            return { key, label: formatted || key, value, count, sortKey: key.toLowerCase() };
        }
    }
}

/** Every row → readings, in the order the server sent them. */
export const toReadings = (rows: Row[] | undefined, shape: RowShape, aggregateIsCount: boolean): Reading[] =>
    (rows ?? []).map((row) => toReading(row, shape, aggregateIsCount));
