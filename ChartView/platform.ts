/**
 * Everything read off `context`, in one file, each read guarded — because
 * every member here is one a host can withhold: `webAPI` and `utils` behind
 * optional features, `filtering.getFilter` and `getViewId` absent or
 * answering `null` on the hub's harness, `dateFormattingInfo` unpublished,
 * `attributes` missing on canvas. The rest of the control is written against
 * what this file returns, never against `context`.
 */

import { IInputs } from './generated/ManifestTypes';
import { Aggregate, CategoryKind, ChartType, DateGrouping, LabelMode, LegendMode, MeasureKind, Reading, Roles, Settings, SortBy } from './chart/types';
import { bucketOf, DateLabels, EN_MONTHS, labelForKey, readDate, wallOf } from './chart/dates';
import { Filter, isLogicalName } from './query/fetchXml';
import { FormRecord } from './data/parent';
import { bareId, numberOf } from './query/rows';

/* eslint-disable @typescript-eslint/no-explicit-any */

type DataSet = ComponentFramework.PropertyTypes.DataSet;
type Column = ComponentFramework.PropertyHelper.DataSetApi.Column;

/** The two Web API reads this control makes. */
export interface WebApiReader {
    retrieveRecord(entity: string, id: string, options?: string): Promise<Record<string, unknown>>;
    retrieveMultipleRecords(entity: string, options?: string): Promise<{ entities: Record<string, unknown>[] }>;
}

/** `context.webAPI` when it has both reads; `null` on canvas or a declined feature. */
export function webApiOf(context: ComponentFramework.Context<IInputs>): WebApiReader | null {
    const api = (context as any).webAPI;

    if (api && typeof api.retrieveRecord === 'function' && typeof api.retrieveMultipleRecords === 'function') {
        return api as WebApiReader;
    }

    return null;
}

/** A `property-set` column, found by **alias**; read off the record by `name`. */
export const roleColumn = (dataset: DataSet, alias: string): Column | undefined =>
    (dataset.columns ?? []).find((column) => column.alias === alias);

/**
 * What kind of column the category is, from `dataType` — the one thing the
 * harness, canvas and a form all publish. Compared exactly, never by
 * substring, so a type-group string names nothing and falls to `unknown`.
 */
export function categoryKindOf(dataType: string | undefined): CategoryKind {
    switch (dataType) {
        case 'OptionSet':
            return 'choice';
        case 'TwoOptions':
            return 'twooptions';
        case 'Lookup.Simple':
        case 'Lookup.Owner':
        case 'Lookup.Customer':
        case 'Lookup.Regarding':
            return 'lookup';
        case 'SingleLine.Text':
        case 'SingleLine.Email':
        case 'SingleLine.Phone':
        case 'SingleLine.URL':
        case 'SingleLine.Ticker':
        case 'SingleLine.TextArea':
            return 'text';
        case 'DateAndTime.DateOnly':
        case 'DateAndTime.DateAndTime':
            return 'date';
        default:
            return 'unknown';
    }
}

export function measureKindOf(dataType: string | undefined): MeasureKind {
    switch (dataType) {
        case 'Currency':
            return 'currency';
        case 'Whole.None':
            return 'whole';
        case 'Decimal':
        case 'FP':
            return 'decimal';
        default:
            return 'none';
    }
}

export function resolveRoles(dataset: DataSet): Roles {
    const category = roleColumn(dataset, 'categoryField');
    const value = roleColumn(dataset, 'valueField');

    return {
        category: category?.name ?? '',
        categoryKind: categoryKindOf(category?.dataType),
        categoryLabel: category?.displayName ?? '',
        value: value?.name ?? null,
        valueKind: measureKindOf(value?.dataType),
        valueLabel: value?.displayName ?? '',
    };
}

const oneOf = <T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T =>
    (allowed as readonly string[]).indexOf(String(raw ?? '')) !== -1 ? (raw as T) : fallback;

/** The default height when the maker left the property blank. */
export const DEFAULT_HEIGHT = 280;

/** Every input, read on this pass. Enums are read defensively — a canvas formula can supply anything. */
export function readSettings(context: ComponentFramework.Context<IInputs>): Settings {
    const p = context.parameters;
    const topN = numberOf(p.topN?.raw);
    const height = numberOf(p.height?.raw);

    return {
        chartType: oneOf<ChartType>(p.chartType?.raw, ['column', 'bar', 'pie', 'donut', 'line'], 'column'),
        aggregate: oneOf<Aggregate>(p.aggregate?.raw, ['count', 'sum', 'avg', 'min', 'max'], 'count'),
        dateGrouping: oneOf<DateGrouping>(p.dateGrouping?.raw, ['day', 'week', 'month', 'quarter', 'year'], 'month'),
        topN: topN !== null && topN >= 1 ? Math.trunc(topN) : null,
        sortBy: oneOf<SortBy>(p.sortBy?.raw, ['value', 'label'], 'value'),
        valueLabels: oneOf<LabelMode>(p.valueLabels?.raw, ['auto', 'value', 'percent', 'none'], 'auto'),
        legend: oneOf<LegendMode>(p.legend?.raw, ['auto', 'show', 'hide'], 'auto'),
        title: typeof p.title?.raw === 'string' ? p.title.raw.trim() : '',
        height: height !== null && height >= 80 ? Math.min(Math.trunc(height), 2000) : DEFAULT_HEIGHT,
        parentLookup: typeof p.parentLookup?.raw === 'string' && isLogicalName(p.parentLookup.raw.trim().toLowerCase()) ? p.parentLookup.raw.trim().toLowerCase() : null,
    };
}

/**
 * The user's zone offset for an instant, or the browser's when the host has
 * no `userSettings` method for it — the hub's harness. The dated overload,
 * always: the bare call answers the *current* offset, an hour off across a
 * DST boundary.
 */
export function offsetReader(context: ComponentFramework.Context<IInputs>): (date: Date) => number {
    const settings: any = context.userSettings;

    if (settings && typeof settings.getTimeZoneOffsetMinutes === 'function') {
        return (date: Date): number => {
            try {
                const n = settings.getTimeZoneOffsetMinutes(date);
                return typeof n === 'number' && Number.isFinite(n) ? n : -date.getTimezoneOffset();
            } catch {
                return -date.getTimezoneOffset();
            }
        };
    }

    return (date: Date): number => -date.getTimezoneOffset();
}

/**
 * Month names in the user's language, off `dateFormattingInfo` — an en-US
 * tenant publishes thirteen `abbreviatedMonthNames`, the last empty — and the
 * user's short date for a day, through `formatting`.
 */
export function dateLabelsOf(context: ComponentFramework.Context<IInputs>, getString: (id: string) => string): DateLabels {
    const info: any = (context.userSettings as any)?.dateFormattingInfo;
    const names: unknown = info?.abbreviatedMonthNames;
    const monthNames = Array.isArray(names) && names.length >= 12 && names.slice(0, 12).every((n) => typeof n === 'string' && n !== '')
        ? (names.slice(0, 12) as string[])
        : EN_MONTHS;
    const formatting: any = context.formatting;

    return {
        monthNames,
        week: getString('ChartView_Week'),
        quarter: getString('ChartView_Quarter'),
        formatDay: (year, month, day): string => {
            // Midday, local: whichever zone formats it, it is the same day.
            const at = new Date(year, month - 1, day, 12);

            if (formatting && typeof formatting.formatDateShort === 'function') {
                try {
                    const s = formatting.formatDateShort(at);
                    if (typeof s === 'string' && s !== '') {
                        return s;
                    }
                } catch {
                    // Fall through.
                }
            }

            return `${year}-${month < 10 ? '0' : ''}${month}-${day < 10 ? '0' : ''}${day}`;
        },
    };
}

/** A number the way the user's settings write one, by the measure's kind. */
export function numberFormatter(context: ComponentFramework.Context<IInputs>, kind: MeasureKind, aggregate: Aggregate): (value: number) => string {
    const formatting: any = context.formatting;
    const whole = kind === 'whole' || kind === 'none' || aggregate === 'count';
    const safe = (fn: () => string, fallback: string): string => {
        try {
            const s = fn();
            return typeof s === 'string' && s !== '' ? s : fallback;
        } catch {
            return fallback;
        }
    };

    return (value: number): string => {
        const fallback = plainNumber(value, whole);

        if (!formatting) {
            return fallback;
        }

        if (kind === 'currency' && aggregate !== 'count' && typeof formatting.formatCurrency === 'function') {
            return safe(() => formatting.formatCurrency(value), fallback);
        }

        if (whole && Number.isInteger(value) && typeof formatting.formatInteger === 'function') {
            return safe(() => formatting.formatInteger(value), fallback);
        }

        if (typeof formatting.formatDecimal === 'function') {
            return safe(() => formatting.formatDecimal(value, Number.isInteger(value) ? 0 : 2), fallback);
        }

        return fallback;
    };
}

/**
 * A number with the browser's grouping and at most two decimals — what a
 * host with no `formatting` gets (the hub's harness, the dev rig). Never
 * `toFixed(2)` on a whole number: an axis reading `200000.00` is the one
 * thing worse than an unformatted one.
 */
export function plainNumber(value: number, whole: boolean): string {
    try {
        return value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: whole ? 0 : 2 });
    } catch {
        return whole ? String(Math.round(value)) : String(value);
    }
}

/**
 * An axis tick, compact: `1.5M`, `200K`, and the full number under ten
 * thousand. An axis is read for proportion, not for the last digit, and a
 * currency symbol on five ticks is noise the values and the legend already
 * carry. Locale-neutral on purpose: the suffixes are the ones every chart
 * library uses.
 */
export function compactNumber(value: number, whole: boolean): string {
    const abs = Math.abs(value);

    if (abs >= 1_000_000) {
        return `${plainNumber(value / 1_000_000, false)}M`;
    }

    if (abs >= 10_000) {
        return `${plainNumber(value / 1_000, false)}K`;
    }

    return plainNumber(value, whole);
}

/** `getViewId()` — typed `string`, measured `null` on a bound lookup's dataset; `''` when it says nothing. */
export function viewIdOf(dataset: DataSet): string {
    try {
        const id = typeof (dataset as any).getViewId === 'function' ? (dataset as any).getViewId() : null;
        return typeof id === 'string' ? bareId(id) : '';
    } catch {
        return '';
    }
}

/** `filtering.getFilter()`, or `null` when the host has none or it throws. */
export function filterOf(dataset: DataSet): Filter | null {
    try {
        const filtering: any = dataset.filtering;
        const filter = filtering && typeof filtering.getFilter === 'function' ? filtering.getFilter() : null;

        return filter && Array.isArray(filter.conditions) ? (filter as Filter) : null;
    } catch {
        return null;
    }
}

/**
 * The out-of-the-box activity tables, whose primary key is `activityid`.
 * Every other table's is `<name>id`; a custom activity's is not, and only
 * metadata can say so — `PrimaryIdAttribute` overrides this when Utility
 * is available.
 */
const ACTIVITIES = new Set([
    'task', 'email', 'appointment', 'phonecall', 'letter', 'fax', 'serviceappointment', 'recurringappointmentmaster',
    'socialactivity', 'campaignactivity', 'campaignresponse', 'bulkoperation', 'incidentresolution', 'opportunityclose',
    'quoteclose', 'orderclose', 'activitypointer',
]);

export const primaryIdOf = (entity: string): string => (ACTIVITIES.has(entity) ? 'activityid' : `${entity}id`);

/**
 * One record → one reading, the browser route. A Choice arrives as its
 * integer (or its string, on some hosts), a Lookup as an `EntityReference`,
 * a date as an ISO string, a Yes/No as a boolean; `getFormattedValue` is
 * the label for all of them. The measure is `getValue` on the value column,
 * `null` where blank.
 */
export function readRecords(
    dataset: DataSet,
    roles: Roles,
    dateGrouping: DateGrouping,
    offset: (date: Date) => number,
    dateLabels: DateLabels,
): Reading[] {
    const ids = dataset.sortedRecordIds ?? [];
    const readings: Reading[] = [];

    for (const id of ids) {
        const record = dataset.records?.[id];

        if (!record) {
            continue;
        }

        let raw: unknown;
        let label = '';

        try {
            raw = record.getValue(roles.category);
            label = record.getFormattedValue(roles.category) ?? '';
        } catch {
            raw = null;
        }

        let value: number | null = null;

        if (roles.value !== null) {
            try {
                value = numberOf(record.getValue(roles.value));
            } catch {
                value = null;
            }
        }

        readings.push(readingOf(raw, label, value, roles.categoryKind, dateGrouping, offset, dateLabels));
    }

    return readings;
}

/** The reading for one record's category value. Exported for the suite. */
export function readingOf(
    raw: unknown,
    label: string,
    value: number | null,
    kind: CategoryKind,
    dateGrouping: DateGrouping,
    offset: (date: Date) => number,
    dateLabels: DateLabels,
): Reading {
    const blank: Reading = { key: null, label: '', value, count: 1, sortKey: '' };

    if (raw === null || raw === undefined || raw === '') {
        return blank;
    }

    switch (kind) {
        case 'date': {
            const date = readDate(raw);

            if (!date) {
                return blank;
            }

            const { key } = bucketOf(wallOf(date, offset(date)), dateGrouping);

            return { key, label: labelForKey(key, dateLabels), value, count: 1, sortKey: key };
        }
        case 'choice': {
            const option = numberOf(raw);
            const key = option === null ? String(raw) : String(option);
            return { key, label: label || key, value, count: 1, sortKey: option ?? key };
        }
        case 'twooptions': {
            const yes = raw === true || raw === 1 || raw === '1' || raw === 'true';

            return { key: yes ? '1' : '0', label: label || (yes ? '1' : '0'), value, count: 1, sortKey: yes ? 1 : 0 };
        }
        case 'lookup': {
            const ref = raw as { id?: { guid?: string } | string; name?: string };
            const id = typeof ref === 'object' && ref !== null ? (typeof ref.id === 'object' && ref.id !== null ? ref.id.guid : ref.id) : raw;
            const key = bareId(id);
            const name = label || (typeof ref === 'object' && ref !== null && typeof ref.name === 'string' ? ref.name : '') || key;

            return key === '' ? blank : { key, label: name, value, count: 1, sortKey: name.toLowerCase() };
        }
        case 'text':
        default: {
            const key = String(raw);

            return { key, label: label || key, value, count: 1, sortKey: key.toLowerCase() };
        }
    }
}

/** Whether the dataset has rows it has not handed over — the caption's "loaded so far". */
export function hasMoreRows(dataset: DataSet, loaded: number): boolean {
    try {
        const paging: any = dataset.paging;

        if (paging?.hasNextPage === true) {
            return true;
        }

        const total = numberOf(paging?.totalResultCount);

        return total !== null && total >= 0 && total > loaded;
    } catch {
        return false;
    }
}

export interface MetadataReading {
    /** A Choice's option colours by value. */
    colors: Map<number, string>;
    /** A Choice's option order by value. */
    order: Map<number, number>;
    /** The table's primary key, when metadata said. */
    primaryId: string | null;
}

/**
 * `getEntityMetadata` for the category column, or `null` without Utility.
 * Handed over as a function the component calls from an effect, because
 * `updateView` is synchronous and the answer is not. The colour is on the
 * descriptor array only — `attributeDescriptor.OptionSet[].Color`, measured
 * on pcf-kanban-board's lane column — never on the value-keyed map.
 */
export function metadataLoader(context: ComponentFramework.Context<IInputs>, entity: string, column: string): (() => Promise<MetadataReading>) | null {
    const utils: any = context.utils;

    if (!entity || !column || !utils || typeof utils.getEntityMetadata !== 'function') {
        return null;
    }

    return (): Promise<MetadataReading> =>
        Promise.resolve(utils.getEntityMetadata(entity, [column]))
            .then((metadata: any) => {
                const attributes = metadata?.Attributes;
                const node = attributes && typeof attributes.get === 'function' ? attributes.get(column) : undefined;
                const descriptor = node?.attributeDescriptor?.OptionSet;
                const colors = new Map<number, string>();
                const order = new Map<number, number>();

                if (Array.isArray(descriptor)) {
                    descriptor.forEach((option: any, index: number) => {
                        if (typeof option?.Value === 'number') {
                            order.set(option.Value, index);

                            if (typeof option.Color === 'string' && /^#[0-9a-f]{3,8}$/i.test(option.Color)) {
                                colors.set(option.Value, option.Color);
                            }
                        }
                    });
                }

                const primaryId = typeof metadata?.PrimaryIdAttribute === 'string' && metadata.PrimaryIdAttribute !== '' ? metadata.PrimaryIdAttribute : null;

                return { colors, order, primaryId };
            })
            .catch((error: unknown) => {
                console.warn(`ChartView: could not read metadata for ${entity}.${column}; using the palette.`, error);

                return { colors: new Map<number, string>(), order: new Map<number, number>(), primaryId: null };
            });
}

/* ------------------------------------------------------------------------- */
/* The subgrid's parent                                                       */
/* ------------------------------------------------------------------------- */

/**
 * `mode.contextInfo` — undocumented, read through a cast, never required.
 * Measured 2026-09-19: on a form subgrid `{ entityTypeName: 'account',
 * entityId: '7de8…', entityRecordName: 'Adventure Works (sample)' }`; on a
 * main grid `{ entityTypeName: 'account', entityRecordName: null }` with no
 * `entityId` at all. So `entityId` is the test for "under a record".
 */
export function formRecordOf(context: ComponentFramework.Context<IInputs>): FormRecord | null {
    const info = (context.mode as any)?.contextInfo;
    const id = bareId(info?.entityId);
    const entityType = typeof info?.entityTypeName === 'string' ? info.entityTypeName.toLowerCase() : '';

    return id !== '' && entityType !== '' ? { entityType, id } : null;
}

/**
 * `page.getClientUrl()` first — not in the typings, present on a model-driven
 * form, and the only honest answer on an on-premises organisation whose URL
 * carries the organisation in the path — then the `Xrm` global, then `null`.
 * Same order as `pcf-data-table` and `pcf-hierarchy-view`.
 */
export function lookupClientUrl(context: ComponentFramework.Context<IInputs>): string | null {
    const page = (context as any).page;

    try {
        const fromPage = typeof page?.getClientUrl === 'function' ? page.getClientUrl() : undefined;

        if (typeof fromPage === 'string' && fromPage !== '') {
            return fromPage.replace(/\/$/, '');
        }
    } catch {
        // Fall through to the global.
    }

    try {
        const xrm = (globalThis as any).Xrm;
        const fromGlobal = xrm?.Utility?.getGlobalContext?.()?.getClientUrl?.();

        if (typeof fromGlobal === 'string' && fromGlobal !== '') {
            return fromGlobal.replace(/\/$/, '');
        }
    } catch {
        // No global either.
    }

    return null;
}

/** One relationships read per table and target, for the life of the page. */
const candidateCache = new Map<string, Promise<string[]>>();

/** For the suite: forget every cached read. */
export const resetCandidateCache = (): void => candidateCache.clear();

/**
 * The lookups on `entity` whose target is `target`, from a same-origin fetch
 * of `EntityDefinitions(…)/ManyToOneRelationships` — the route
 * `pcf-data-table` measured for a lookup's bind key, because
 * `context.webAPI` cannot address `EntityDefinitions`. A failure of any kind
 * rejects, and the resolver reads a rejection as "no candidates".
 */
export function parentCandidates(clientUrl: string | null, entity: string, target: string): Promise<string[]> {
    if (clientUrl === null || !isLogicalName(entity) || !isLogicalName(target)) {
        return Promise.reject(new Error('no organisation URL to read the relationships from'));
    }

    const key = `${clientUrl}|${entity}|${target}`;
    const cached = candidateCache.get(key);

    if (cached) {
        return cached;
    }

    const url =
        `${clientUrl}/api/data/v9.2/EntityDefinitions(LogicalName='${entity}')/ManyToOneRelationships`
        + `?$select=ReferencingAttribute,ReferencedEntity&$filter=ReferencedEntity eq '${target}'`;

    const read = fetch(url, {
        headers: { Accept: 'application/json', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' },
        credentials: 'same-origin',
    }).then((response) => {
        if (!response.ok) {
            throw new Error(`Relationships for ${entity} could not be read (${response.status}).`);
        }

        return response.json().then((body: { value?: { ReferencingAttribute?: unknown; ReferencedEntity?: unknown }[] }) =>
            (Array.isArray(body?.value) ? body.value : [])
                .filter((row) => typeof row?.ReferencingAttribute === 'string' && String(row.ReferencedEntity ?? target).toLowerCase() === target)
                .map((row) => String(row.ReferencingAttribute).toLowerCase()),
        );
    });

    candidateCache.set(key, read);
    read.catch(() => candidateCache.delete(key));

    return read;
}
