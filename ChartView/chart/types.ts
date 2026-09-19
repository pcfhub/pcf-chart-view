/**
 * The shapes every module shares. Nothing here touches `context`.
 */

export type ChartType = 'column' | 'bar' | 'pie' | 'donut' | 'line';
export type Aggregate = 'count' | 'sum' | 'avg' | 'min' | 'max';
export type DateGrouping = 'day' | 'week' | 'month' | 'quarter' | 'year';
export type SortBy = 'value' | 'label';
export type LabelMode = 'auto' | 'value' | 'percent' | 'none';
export type LegendMode = 'auto' | 'show' | 'hide';

/**
 * What kind of column the chart is grouped by, decided from the column's
 * `dataType` — the one thing both routes can read. Each kind reads its key
 * and label differently and sorts differently.
 */
export type CategoryKind = 'choice' | 'twooptions' | 'lookup' | 'text' | 'date' | 'unknown';

/** The value column's kind, for formatting the number. */
export type MeasureKind = 'whole' | 'decimal' | 'currency' | 'none';

/**
 * One reading of one record — or, on the server route, one aggregated row.
 * `key` is the raw group identity (`'3'` for a Choice, a bare GUID for a
 * Lookup, the text, `'2026-03'` for a month) and `null` for a blank; `label`
 * is what the user sees; `value` is the measure, `null` where the record has
 * none; `count` is how many records the reading stands for (1 on the client,
 * the group's count on the server); `sortKey` orders the category's own
 * order — an option's position, a date bucket's key, a label.
 */
export interface Reading {
    key: string | null;
    label: string;
    value: number | null;
    count: number;
    sortKey: string | number;
}

/** One bar, slice or point. */
export interface Group {
    key: string;
    label: string;
    value: number;
    /** Records in the group — the count even when the measure is a sum. */
    count: number;
    sortKey: string | number;
    /** The *Other* bucket `topN` folded the tail into. */
    other: boolean;
    /** The blank group, whose key is `''`. */
    blank: boolean;
    color: string;
}

/** Where the numbers came from, which the caption says out loud. */
export type Source =
    /** One aggregate query over the whole view. */
    | 'server'
    /** The loaded rows, grouped in the browser — canvas, or no Web API. */
    | 'client'
    /** The server refused the aggregate and the loaded rows stand in. */
    | 'client-refused';

/** The chart's data, ready to draw. */
export interface ChartData {
    groups: Group[];
    /** Sum of every group's value — the denominator of a percentage. */
    total: number;
    /** Records the chart stands for, or `null` when the source cannot say. */
    recordCount: number | null;
    source: Source;
}

/** The two roles, resolved to real columns. */
export interface Roles {
    /** The category column's logical name, or `''` when unmapped. */
    category: string;
    categoryKind: CategoryKind;
    /** The category column's display name, for the legend heading. */
    categoryLabel: string;
    /** The value column's logical name, or `null` when unmapped. */
    value: string | null;
    valueKind: MeasureKind;
    valueLabel: string;
}

/** The inputs, read on every pass and never copied in `init`. */
export interface Settings {
    chartType: ChartType;
    aggregate: Aggregate;
    dateGrouping: DateGrouping;
    topN: number | null;
    sortBy: SortBy;
    valueLabels: LabelMode;
    legend: LegendMode;
    title: string;
    height: number;
}
