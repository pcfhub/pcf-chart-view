/**
 * The aggregate query, as a string. Pure: nothing here touches `context`, so
 * the smoke suite drives every function directly and asserts the exact text
 * a server would receive.
 *
 * The shape of the idea: **the view already knows which records it means**
 * — its `<filter>`s, its `<link-entity>`s — and the dataset knows what the
 * user has narrowed it to since. The chart wants those same records, grouped.
 * So the query is the view's own FetchXML with every `<attribute>` and
 * `<order>` taken out, the two aggregate attributes put in, the dataset's
 * runtime filter appended, and `aggregate='true'` on the root. Rewriting the
 * view's XML rather than composing a fresh query is what keeps a link-entity
 * filter ("accounts whose primary contact is in London") honoured without
 * this control understanding it.
 *
 * FetchXML's aggregate rules, from Microsoft Learn (*Aggregate data using
 * FetchXml*): every attribute must carry `aggregate` or `groupby`, each with
 * an `alias`; `count` counts rows and `countcolumn` non-null values; a
 * `dategrouping` goes on a `groupby` attribute; `<order>` refers to aliases;
 * at most **50,000** records are aggregated per query (`AggregateQueryRecordLimit`),
 * refused with error `0x8004E023`. The shape of that refusal is unmeasured —
 * SPEC.md P7 — and any refusal sends the control to the browser route.
 */

import { Aggregate, CategoryKind, DateGrouping } from '../chart/types';

/** The aliases the result rows carry. Short, and never a column name. */
export const ALIAS = {
    /** The group's own value: the choice integer, the lookup GUID, the text, or the date bucket. */
    group: 'g',
    /** The year, on a date category — so March 2025 and March 2026 are two groups. */
    year: 'y',
    /** The month, on a `day` grouping only — the day of the month needs it. */
    month: 'mo',
    /** The measure — absent when the chart counts, because `count` is the measure then. */
    value: 'v',
    /** The group's record count, always asked for: the caption and the tooltips need it whatever the measure. */
    count: 'n',
} as const;

export interface AggregateShape {
    /** The bound table's logical name. */
    entity: string;
    /** The category column's logical name. */
    category: string;
    categoryKind: CategoryKind;
    dateGrouping: DateGrouping;
    /** The value column, or `null` to count. */
    value: string | null;
    aggregate: Aggregate;
    /** The primary key, which `count` is taken over. */
    primaryId: string;
}

/** A Dataverse logical name: lower-case, starts with a letter, `[a-z0-9_]`. */
export const isLogicalName = (value: string): boolean => /^[a-z][a-z0-9_]*$/.test(value);

/** The five characters XML cares about, in attribute values. */
export const escapeXml = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** The `aggregate` a shape asks for: `count` whenever there is no value column. */
export const effectiveAggregate = (shape: { value: string | null; aggregate: Aggregate }): Aggregate =>
    shape.value === null ? 'count' : shape.aggregate;

/**
 * The attributes of the aggregate: the group column(s) and the measure.
 *
 * A date category gets `dategrouping` plus a `year` group, because the
 * server returns the bucket number alone (`3` for March) and two Marches
 * would merge without it; `day` adds the month too. A `year` grouping needs
 * only itself.
 */
export function aggregateAttributes(shape: AggregateShape): string {
    const parts: string[] = [];

    if (shape.categoryKind === 'date') {
        parts.push(`<attribute name='${shape.category}' groupby='true' dategrouping='${shape.dateGrouping}' alias='${ALIAS.group}'/>`);

        if (shape.dateGrouping !== 'year') {
            parts.push(`<attribute name='${shape.category}' groupby='true' dategrouping='year' alias='${ALIAS.year}'/>`);
        }

        if (shape.dateGrouping === 'day') {
            parts.push(`<attribute name='${shape.category}' groupby='true' dategrouping='month' alias='${ALIAS.month}'/>`);
        }
    } else {
        parts.push(`<attribute name='${shape.category}' groupby='true' alias='${ALIAS.group}'/>`);
    }

    const aggregate = effectiveAggregate(shape);

    // `count` on the primary key counts rows (`countcolumn` would count
    // non-null values, which for the key is the same thing but says less).
    parts.push(`<attribute name='${shape.primaryId}' aggregate='count' alias='${ALIAS.count}'/>`);

    if (aggregate !== 'count') {
        parts.push(`<attribute name='${shape.value}' aggregate='${aggregate}' alias='${ALIAS.value}'/>`);
    }

    return parts.join('');
}

/**
 * The view's FetchXML with everything that is not "which records" removed:
 * `<attribute>` (self-closing or not, at every depth — a link-entity's
 * attributes would make the aggregate refuse), `<all-attributes>`, and
 * `<order>` (which in an aggregate may only name aliases). Comments go too.
 */
export function stripView(viewXml: string): string {
    return viewXml
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<attribute\b[^>]*\/>/g, '')
        .replace(/<attribute\b[^>]*>[\s\S]*?<\/attribute>/g, '')
        .replace(/<all-attributes\s*\/>/g, '')
        .replace(/<order\b[^>]*\/>/g, '')
        .replace(/<order\b[^>]*>[\s\S]*?<\/order>/g, '');
}

/** The `name` of the root `<entity>` in a FetchXML document, or `null`. */
export function rootEntityOf(xml: string): string | null {
    const m = /<entity\b[^>]*\bname=['"]([^'"]+)['"]/.exec(xml);

    return m ? m[1].toLowerCase() : null;
}

/**
 * The whole query. `viewXml` is the saved query's FetchXML, or `null` when
 * it could not be read — then the query is the bare table, which is the
 * right answer for a view whose definition is unknown only if the runtime
 * filter carries what the view meant; the caller decides that. `filterXml`
 * is the dataset's runtime filter as a `<filter>` element, or `''`.
 *
 * A view whose root entity is not the shape's table (it happens: a dataset
 * bound through a relationship whose view id resolves elsewhere) is ignored
 * the same way, rather than aggregating the wrong table.
 */
export function aggregateFetchXml(shape: AggregateShape, viewXml: string | null, filterXml: string): string {
    const attributes = aggregateAttributes(shape);
    const stripped = viewXml !== null ? stripView(viewXml) : null;

    if (stripped !== null && rootEntityOf(stripped) === shape.entity) {
        const open = /<entity\b[^>]*>/.exec(stripped);
        const close = stripped.lastIndexOf('</entity>');

        if (open && close > open.index) {
            const head = stripped.slice(open.index + open[0].length, close);
            const inner = `<entity name='${shape.entity}'>${attributes}${head}${filterXml}</entity>`;

            return `<fetch aggregate='true'>${inner}</fetch>`;
        }
    }

    return `<fetch aggregate='true'><entity name='${shape.entity}'>${attributes}${filterXml}</entity></fetch>`;
}

/**
 * The subgrid's relationship as a condition: the lookup on this table equal
 * to the form's record. Appended inside the root entity beside the runtime
 * filter. A GUID goes in bare; the server takes either spelling.
 */
export const parentFilterXml = (column: string, id: string): string =>
    `<filter type='and'><condition attribute='${column}' operator='eq' value='${escapeXml(id)}'/></filter>`;

/**
 * Whether the FetchXML is URL-encoded inside `?fetchXml=`. Measured on the
 * Accounts form 2026-09-17 (pcf-hierarchy-view P1): the platform accepts
 * both. Raw, as documented, and in one place.
 */
export const FETCHXML_ENCODED = false;

export const queryString = (xml: string): string =>
    `?fetchXml=${FETCHXML_ENCODED ? encodeURIComponent(xml) : xml}`;

/* ------------------------------------------------------------------------- */
/* The dataset's runtime filter, as FetchXML                                  */
/* ------------------------------------------------------------------------- */

/**
 * `dataset.filtering.getFilter()` speaks in the SDK's `ConditionOperator`
 * numbers — the PCF typings list the subset a dataset can carry and point at
 * `Microsoft.Xrm.Sdk.Query.ConditionOperator` for the names. These are that
 * enum's values, spelled as FetchXML's operator names. An operator not here
 * makes the whole filter **untranslatable**, and an untranslatable filter
 * sends the control to the browser route rather than to a query that means
 * something else.
 */
export const CONDITION_OPERATORS: Record<number, string> = {
    0: 'eq',
    1: 'ne',
    2: 'gt',
    3: 'lt',
    4: 'ge',
    5: 'le',
    6: 'like',
    7: 'not-like',
    8: 'in',
    9: 'not-in',
    10: 'between',
    11: 'not-between',
    12: 'null',
    13: 'not-null',
    14: 'yesterday',
    15: 'today',
    16: 'tomorrow',
    17: 'last-seven-days',
    18: 'next-seven-days',
    19: 'last-week',
    20: 'this-week',
    21: 'next-week',
    22: 'last-month',
    23: 'this-month',
    24: 'next-month',
    25: 'on',
    26: 'on-or-before',
    27: 'on-or-after',
    28: 'last-year',
    29: 'this-year',
    30: 'next-year',
    31: 'last-x-hours',
    32: 'next-x-hours',
    33: 'last-x-days',
    34: 'next-x-days',
    35: 'last-x-weeks',
    36: 'next-x-weeks',
    37: 'last-x-months',
    38: 'next-x-months',
    39: 'last-x-years',
    40: 'next-x-years',
    41: 'eq-userid',
    42: 'ne-userid',
    43: 'eq-businessid',
    44: 'ne-businessid',
    49: 'like',
    52: 'not-on',
    54: 'begins-with',
    55: 'not-begin-with',
    56: 'ends-with',
    57: 'not-end-with',
    70: 'in-fiscal-period-and-year',
    73: 'eq-userteams',
    74: 'eq-useroruserteams',
    75: 'under',
    76: 'not-under',
    77: 'eq-or-under',
    78: 'above',
    79: 'eq-or-above',
    87: 'contain-values',
    88: 'not-contain-values',
};

/** `Contains` (49) is a `like` over `%value%`; the others send the value as given. */
const WRAPS_VALUE: Record<number, boolean> = { 49: true };

/** The operators that take no `value` at all. */
const NO_VALUE = new Set([
    'null', 'not-null', 'yesterday', 'today', 'tomorrow', 'last-seven-days', 'next-seven-days', 'last-week', 'this-week',
    'next-week', 'last-month', 'this-month', 'next-month', 'last-year', 'this-year', 'next-year', 'eq-userid', 'ne-userid',
    'eq-businessid', 'ne-businessid', 'eq-userteams', 'eq-useroruserteams',
]);

/** The operators whose value is a list of `<value>` children. */
const LIST_VALUE = new Set(['in', 'not-in', 'between', 'not-between', 'contain-values', 'not-contain-values']);

/** The dataset filter shapes, as the typings declare them (no import: the file stays pure). */
export interface Condition {
    attributeName: string;
    conditionOperator: number;
    value: string | string[];
    entityAliasName?: string;
}

export interface Filter {
    conditions: Condition[];
    /** 0 = And, 1 = Or */
    filterOperator: number;
    filters?: Filter[];
}

export interface FilterXml {
    xml: string;
    /** Whether every condition could be spelled. `false` means "do not send this". */
    translatable: boolean;
}

/**
 * A dataset `FilterExpression` → one `<filter>` element, nested filters
 * included. An empty expression is `''`. Any condition whose operator is
 * unknown, or whose attribute is not a logical name, makes the result
 * untranslatable — better no server route than a query with a condition
 * quietly dropped.
 */
export function filterToFetchXml(filter: Filter | null | undefined): FilterXml {
    if (!filter) {
        return { xml: '', translatable: true };
    }

    let translatable = true;
    const conditions = (filter.conditions ?? []).map((c) => {
        const operator = CONDITION_OPERATORS[c.conditionOperator];
        const attribute = String(c.attributeName ?? '').toLowerCase();

        if (!operator || !isLogicalName(attribute)) {
            translatable = false;
            return '';
        }

        const entity = c.entityAliasName ? ` entityname='${escapeXml(String(c.entityAliasName))}'` : '';
        const open = `<condition attribute='${attribute}' operator='${operator}'${entity}`;

        if (NO_VALUE.has(operator)) {
            return `${open}/>`;
        }

        const values = Array.isArray(c.value) ? c.value : [c.value];

        if (LIST_VALUE.has(operator)) {
            return `${open}>${values.map((v) => `<value>${escapeXml(String(v ?? ''))}</value>`).join('')}</condition>`;
        }

        let value = String(values[0] ?? '');

        if (WRAPS_VALUE[c.conditionOperator] && value.indexOf('%') === -1) {
            value = `%${value}%`;
        }

        return `${open} value='${escapeXml(value)}'/>`;
    });

    const nested = (filter.filters ?? []).map((f) => {
        const child = filterToFetchXml(f);

        if (!child.translatable) {
            translatable = false;
        }

        return child.xml;
    });

    const body = conditions.join('') + nested.join('');

    if (body === '') {
        return { xml: '', translatable };
    }

    return { xml: `<filter type='${filter.filterOperator === 1 ? 'or' : 'and'}'>${body}</filter>`, translatable };
}
