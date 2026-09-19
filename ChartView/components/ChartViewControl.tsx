import * as React from 'react';
import { FluentProvider, webDarkTheme, webLightTheme } from '@fluentui/react-components';
import { ChartData, Group, Reading, Roles, Settings } from '../chart/types';
import { finishGroups, groupReadings, NEUTRAL, OTHER_KEY, PALETTE, percentOf, BLANK_KEY } from '../chart/aggregate';
import { Arc, AxisLayout, barLayout, columnLayout, lineLayout, pieLayout, px, TextAt } from '../chart/geometry';
import { DateLabels, labelForKey } from '../chart/dates';
import { AggregateShape, effectiveAggregate, parentFilterXml } from '../query/fetchXml';
import { ParentReading, resolveParentLookup } from '../data/parent';
import { Row, toReadings } from '../query/rows';
import { loadAggregate, readViewFetchXml, Refusal, requestXml } from '../data/ChartData';
import { compactNumber, MetadataReading, primaryIdOf, WebApiReader } from '../platform';

/**
 * The server route, as the entry point hands it over: `null` when the host
 * has no Web API, when the category is unmapped, or when the dataset's
 * runtime filter could not be spelled in FetchXML. `key` names everything the
 * query depends on, so a change to any of it re-runs the aggregate and an
 * answer for an old key is dropped.
 */
export interface ServerRoute {
    api: WebApiReader;
    entity: string;
    viewId: string;
    filterXml: string;
    /** The subgrid's parent, to be resolved to a lookup column before the query; `null` on a main grid. */
    parent: ParentReading | null;
    key: string;
}

export interface IProps {
    roles: Roles;
    settings: Settings;
    /** The browser route: one reading per loaded record. */
    readings: Reading[];
    /** How many records the browser route stands for, and whether the view has more. */
    loaded: number;
    hasMore: boolean;
    loading: boolean;
    error: boolean;
    server: ServerRoute | null;
    /** Bumped when the platform finishes a fetch, so an edit on the form re-aggregates. */
    refreshToken: number;
    metadata: (() => Promise<MetadataReading>) | null;
    metadataKey: string;
    dateLabels: DateLabels;
    /** The view's own name, when `settings.title` is blank. */
    viewTitle: string;
    selectedKey: string;
    onSelect: (key: string, label: string) => void;
    getString: (id: string) => string;
    formatValue: (value: number) => string;
    theme: Record<string, string> | undefined;
    dark: boolean | undefined;
    isRTL: boolean;
    disabled: boolean;
    visible: boolean;
    /** `mode.allocatedWidth`: -1 until asked, the host's width after; a floor under the measured one. */
    allocatedWidth: number;
    /** The rows the grid holds after the host's own filtering, or `null` when uncounted. */
    gridCount: number | null;
    /** The probe's log, in a 0.0.x build; `undefined` in a release. */
    onProbe?: (label: string, payload: unknown) => void;
}

interface ServerState {
    key: string;
    rows: Row[] | null;
    /** The server said no — the caption says so. */
    refused: Refusal | null;
    /** Nothing to ask: the view's definition could not be read, so the browser route stands without a complaint. */
    unavailable: boolean;
    pending: boolean;
}

const fmt = (template: string, ...args: (string | number)[]): string =>
    args.reduce<string>((s, a, i) => s.split(`{${i}}`).join(String(a)), template);

/** The width the root is actually given, by a ResizeObserver — never a media query, never containment. */
function useWidth(ref: React.RefObject<HTMLDivElement>): number {
    const [width, setWidth] = React.useState(0);

    React.useEffect(() => {
        const node = ref.current;

        if (!node) {
            return undefined;
        }

        setWidth(node.getBoundingClientRect().width);

        if (typeof ResizeObserver === 'undefined') {
            return undefined;
        }

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setWidth(entry.contentRect.width);
            }
        });

        observer.observe(node);

        return (): void => observer.disconnect();
    }, [ref]);

    return width;
}

/** The category column's metadata, once per key, `null` until it lands or when nothing can read it. */
function useMetadata(loader: (() => Promise<MetadataReading>) | null, key: string): { meta: MetadataReading | null; settled: boolean } {
    const [state, setState] = React.useState<{ key: string; meta: MetadataReading | null }>({ key: '', meta: null });

    React.useEffect(() => {
        if (!loader) {
            return undefined;
        }

        let alive = true;

        loader().then((meta) => {
            if (alive) {
                setState({ key, meta });
            }
        });

        return (): void => {
            alive = false;
        };
    }, [loader === null, key]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!loader) {
        return { meta: null, settled: true };
    }

    return state.key === key ? { meta: state.meta, settled: true } : { meta: null, settled: false };
}

export const ChartViewControl: React.FC<IProps> = (props) => {
    const rootRef = React.useRef<HTMLDivElement>(null);
    const measured = useWidth(rootRef);
    // A shrink-to-fit host measures the caption, not the grid — see init().
    const width = Math.max(measured, props.allocatedWidth > 0 ? props.allocatedWidth : 0);
    const { meta, settled: metaSettled } = useMetadata(props.metadata, props.metadataKey);
    const [server, setServer] = React.useState<ServerState>({ key: '', rows: null, refused: null, unavailable: false, pending: false });
    const [hover, setHover] = React.useState<string | null>(null);
    const { roles, settings, getString } = props;
    const aggregate = effectiveAggregate({ value: roles.value, aggregate: settings.aggregate });
    const isCount = aggregate === 'count';

    /*
     * The aggregate, once per key and once per platform fetch. It waits for
     * metadata when there is any to wait for, because the primary key it
     * counts on may come from there — one query rather than one now and one
     * corrected. `alive` drops a slow answer for a key that has moved on:
     * the hub's demo switches presets faster than a query resolves.
     */
    const route = props.server;
    const routeKey = route ? route.key : '';
    const primaryId = meta?.primaryId ?? (route ? primaryIdOf(route.entity) : '');

    React.useEffect(() => {
        if (!route || !metaSettled) {
            return undefined;
        }

        let alive = true;
        const shape: AggregateShape = {
            entity: route.entity,
            category: roles.category,
            categoryKind: roles.categoryKind,
            dateGrouping: settings.dateGrouping,
            value: roles.value,
            aggregate: settings.aggregate,
            primaryId,
        };

        setServer((s) => ({ ...s, pending: true }));

        /*
         * The subgrid's relationship first, because it decides whether there
         * is a query to send at all: a chart under a record that cannot say
         * which lookup relates the rows would count the whole table.
         */
        const parent = route.parent;
        const parentStep: Promise<string | null> = parent
            ? resolveParentLookup(parent).then((resolution) => {
                props.onProbe?.('P2 parent lookup', resolution);

                if (resolution.by === 'unrelated') {
                    // The rows deny every lookup to the parent: the subgrid shows the whole view, and so does the chart.
                    return '';
                }

                if (resolution.column === null) {
                    console.warn(
                        `ChartView: on a subgrid of ${route.entity} under ${parent.record.entityType}, the lookup relating the rows to the record could not be settled`
                        + (resolution.candidates.length > 0 ? ` (candidates: ${resolution.candidates.join(', ')})` : ' (no lookup to the parent table was found)')
                        + '; the loaded rows are shown. Set the Parent lookup property to the column.',
                    );

                    return null;
                }

                return parentFilterXml(resolution.column, parent.record.id);
            })
            : Promise.resolve('');

        parentStep
            .then((parentXml) => {
                if (!alive) {
                    return null;
                }

                if (parentXml === null) {
                    setServer({ key: route.key, rows: null, refused: null, unavailable: true, pending: false });

                    return null;
                }

                return readViewFetchXml(route.api, route.viewId).then((viewXml) => ({ viewXml, parentXml }));
            })
            .then((step) => {
                if (!alive || step === null) {
                    return null;
                }

                const { viewXml, parentXml } = step;

                props.onProbe?.('P4 view fetchxml', { viewId: route.viewId, viewXml });

                if (viewXml === null) {
                    /*
                     * No definition means no way to know which records the
                     * view meant, and an aggregate over the bare table would
                     * be a confident wrong number. The loaded rows are an
                     * honest smaller one — and not a refusal: nothing was
                     * asked, so the caption says "loaded so far", not "the
                     * server could not".
                     */
                    console.warn(`ChartView: the definition of view ${route.viewId || '(no id)'} could not be read; the loaded rows are shown.`);
                    setServer({ key: route.key, rows: null, refused: null, unavailable: true, pending: false });

                    return null;
                }

                const request = { shape, viewXml, filterXml: route.filterXml + parentXml };

                props.onProbe?.('P3 aggregate fetchxml', requestXml(request));

                return loadAggregate(route.api, request);
            })
            .then((rows) => {
                if (alive && rows !== null) {
                    props.onProbe?.('P3 aggregate rows', rows.slice(0, 5));
                    setServer({ key: route.key, rows, refused: null, unavailable: false, pending: false });
                }
            })
            .catch((refusal: Refusal) => {
                if (alive) {
                    props.onProbe?.('P3/P7 aggregate refused', refusal);
                    console.warn(`ChartView: the server did not aggregate ${route.entity}; showing the loaded rows.`, refusal.raw ?? refusal.message);
                    setServer({ key: route.key, rows: null, refused: refusal, unavailable: false, pending: false });
                }
            });

        return (): void => {
            alive = false;
        };
    }, [routeKey, props.refreshToken, metaSettled, primaryId]); // eslint-disable-line react-hooks/exhaustive-deps

    const serverCurrent = route !== null && server.key === route.key;

    /*
     * A server answer of no groups under a page that has rows is a wrong
     * query, not an empty view — the page is always a subset of the view.
     * The one way to get there is a Parent lookup naming a column the
     * rows do not relate through. The loaded rows are the honest number.
     */
    const contradicted = serverCurrent && server.rows !== null && server.rows.length === 0 && props.readings.length > 0;
    const useServerRows = serverCurrent && server.rows !== null && !contradicted;

    React.useEffect(() => {
        if (contradicted) {
            console.warn(`ChartView: the server found no records for the chart's query while the dataset holds ${props.readings.length}; the loaded rows are shown. On a subgrid, check the Parent lookup property.`);
        }
    }, [contradicted]); // eslint-disable-line react-hooks/exhaustive-deps

    const data: ChartData = React.useMemo(() => {
        const readings = useServerRows
            ? toReadings(server.rows ?? [], {
                categoryKind: roles.categoryKind,
                dateGrouping: settings.dateGrouping,
                dateLabels: props.dateLabels,
                twoOptions: { yes: '1', no: '0' },
            }, isCount)
            : props.readings;
        const source = useServerRows ? 'server' : serverCurrent && server.refused ? 'client-refused' : 'client';
        const colors = meta?.colors ?? new Map<number, string>();
        const order = meta?.order ?? new Map<number, number>();

        return finishGroups(groupReadings(readings), {
            aggregate,
            categoryKind: roles.categoryKind,
            sortBy: settings.sortBy,
            topN: settings.topN,
            source,
            otherLabel: getString('ChartView_Other'),
            blankLabel: getString('ChartView_Blank'),
            recordCount: useServerRows ? readings.reduce((n, r) => n + r.count, 0) : props.loaded,
            colorFor: (key, index): string => {
                if (key === OTHER_KEY || key === BLANK_KEY) {
                    return NEUTRAL;
                }

                const option = roles.categoryKind === 'choice' && /^-?\d+$/.test(key) ? colors.get(Number(key)) : undefined;

                return option ?? PALETTE[index % PALETTE.length];
            },
            orderFor: roles.categoryKind === 'choice' ? (key): number | undefined => (/^-?\d+$/.test(key) ? order.get(Number(key)) : undefined) : undefined,
        });
    }, [useServerRows, server.rows, serverCurrent, server.refused, props.readings, props.loaded, meta, roles, settings, aggregate, isCount, props.dateLabels, getString]);

    if (!props.visible) {
        return null;
    }

    const theme = props.theme ?? (props.dark ? webDarkTheme : webLightTheme);
    const title = settings.title || props.viewTitle;
    const measure = isCount
        ? getString('ChartView_Measure_Count')
        : fmt(getString(`ChartView_Measure_${aggregate.charAt(0).toUpperCase()}${aggregate.slice(1)}`), roles.valueLabel);
    const caption = captionOf(data, props, getString);
    const narrow = width > 0 && width < 420;
    const showLegend = settings.legend === 'show' || (settings.legend === 'auto' && (settings.chartType === 'pie' || settings.chartType === 'donut'));
    const stale = props.loading || (route !== null && server.pending);
    const noCategory = roles.category === '';
    const empty = !noCategory && data.groups.length === 0;

    const select = (group: Group): void => {
        if (props.disabled || group.other) {
            return;
        }

        props.onSelect(group.key, group.label);
    };

    const legendW = showLegend && !narrow ? Math.min(220, Math.max(120, Math.floor(width * 0.3))) : 0;
    const svgW = Math.max(0, width - legendW - (legendW > 0 ? 12 : 0));
    const svgH = settings.height;

    return (
        <FluentProvider theme={theme} dir={props.isRTL ? 'rtl' : 'ltr'}>
            <div
                className={['ChartView', props.dark ? 'ChartView--dark' : '', narrow ? 'is-narrow' : '', stale ? 'is-stale' : '', props.disabled ? 'is-disabled' : ''].join(' ').trim()}
                ref={rootRef}
            >
                <div className="ChartView-head">
                    {title ? <h3 className="ChartView-title">{title}</h3> : null}
                    <p className="ChartView-caption">
                        <span>{measure}</span>
                        {caption ? <span className="ChartView-source"> · {caption}</span> : null}
                    </p>
                </div>

                {props.error ? (
                    <p className="ChartView-message ChartView-error" role="alert">
                        {getString('ChartView_Error')}
                    </p>
                ) : noCategory ? (
                    <p className="ChartView-message">{getString('ChartView_NoCategory')}</p>
                ) : props.loading && data.groups.length === 0 ? (
                    <p className="ChartView-message" aria-live="polite">
                        {getString('ChartView_Loading')}
                    </p>
                ) : empty ? (
                    <p className="ChartView-message">{getString('ChartView_Empty')}</p>
                ) : (
                    <div className="ChartView-body" style={{ height: `${svgH}px` }}>
                        {width > 0 ? (
                            <Chart
                                data={data}
                                settings={settings}
                                shortLabel={roles.categoryKind === 'date' ? (key): string => labelForKey(key, props.dateLabels, true) : undefined}
                                width={svgW}
                                height={svgH}
                                formatValue={props.formatValue}
                                getString={getString}
                                selectedKey={props.selectedKey}
                                hover={hover}
                                onHover={setHover}
                                onSelect={select}
                                title={fmt(getString('ChartView_Chart'), title || measure)}
                                disabled={props.disabled}
                            />
                        ) : null}
                        {showLegend ? (
                            <Legend data={data} width={legendW} formatValue={props.formatValue} selectedKey={props.selectedKey} hover={hover} onHover={setHover} onSelect={select} getString={getString} />
                        ) : null}
                    </div>
                )}

                {data.groups.length > 0 ? <DataTable data={data} roles={roles} measure={measure} formatValue={props.formatValue} getString={getString} /> : null}
            </div>
        </FluentProvider>
    );
};

/** What the caption says about where the numbers came from. */
function captionOf(data: ChartData, props: IProps, getString: (id: string) => string): string {
    if (data.groups.length === 0) {
        return '';
    }

    const n = data.recordCount ?? props.loaded;

    switch (data.source) {
        case 'server':
            /*
             * The grid may hold fewer rows than the view has — a quick-find
             * the host applied and the control cannot see (measured 2026-09-19
             * W6), a subgrid related in a way the control did not find. Say
             * both numbers rather than let "All 60" stand over a grid of 12.
             */
            return props.gridCount !== null && props.gridCount !== n
                ? fmt(getString('ChartView_CaptionViewGrid'), n, props.gridCount)
                : fmt(getString('ChartView_CaptionAll'), n);
        case 'client-refused':
            return fmt(getString('ChartView_CaptionRefused'), n);
        case 'client':
        default:
            // "Loaded so far" only when the view has rows it did not hand over;
            // a single-page view grouped in the browser is still all of it.
            return props.hasMore ? fmt(getString('ChartView_CaptionLoaded'), n) : fmt(getString('ChartView_CaptionAll'), n);
    }
}

interface ChartProps {
    data: ChartData;
    settings: Settings;
    /** A shorter label for a narrow slot — a date's `Feb '22` — or `undefined` when there is none. */
    shortLabel?: (key: string) => string;
    width: number;
    height: number;
    formatValue: (v: number) => string;
    getString: (id: string) => string;
    selectedKey: string;
    hover: string | null;
    onHover: (key: string | null) => void;
    onSelect: (group: Group) => void;
    title: string;
    disabled: boolean;
}

/** The text on a mark, by the labels mode and the chart's shape. */
function markLabel(group: Group, data: ChartData, settings: Settings, formatValue: (v: number) => string, getString: (id: string) => string): string {
    const round = settings.chartType === 'pie' || settings.chartType === 'donut';
    const mode = settings.valueLabels === 'auto' ? (round ? 'percent' : settings.chartType === 'line' ? 'none' : 'value') : settings.valueLabels;

    switch (mode) {
        case 'value':
            return formatValue(group.value);
        case 'percent':
            return fmt(getString('ChartView_Percent'), percentOf(group.value, data.total));
        default:
            return '';
    }
}

export const Chart: React.FC<ChartProps> = (p) => {
    const { data, settings, width, height } = p;
    const round = settings.chartType === 'pie' || settings.chartType === 'donut';
    const tickFormat = (v: number): string => compactNumber(v, true);
    const label = (g: Group): string => markLabel(g, data, settings, p.formatValue, p.getString);
    const aria = (g: Group): string => fmt(p.getString('ChartView_ItemLabel'), g.label, p.formatValue(g.value), percentOf(g.value, data.total));

    const markProps = (g: Group): React.SVGProps<SVGGElement> => ({
        className: ['ChartView-mark', p.selectedKey !== '' && p.selectedKey === g.key ? 'is-selected' : '', p.hover === g.key ? 'is-hover' : '', p.selectedKey !== '' && p.selectedKey !== g.key ? 'is-muted' : ''].join(' ').trim(),
        role: 'button',
        tabIndex: p.disabled || g.other ? -1 : 0,
        'aria-label': aria(g),
        'aria-pressed': p.selectedKey !== '' && p.selectedKey === g.key,
        'aria-disabled': p.disabled || g.other ? true : undefined,
        onMouseEnter: (): void => p.onHover(g.key),
        onMouseLeave: (): void => p.onHover(null),
        onFocus: (): void => p.onHover(g.key),
        onBlur: (): void => p.onHover(null),
        onClick: (): void => p.onSelect(g),
        onKeyDown: (event: React.KeyboardEvent): void => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                p.onSelect(g);
            }
        },
    });

    if (round) {
        const size = Math.min(width, height);
        const r = Math.max(10, size / 2 - 16);
        const inner = settings.chartType === 'donut' ? r * 0.58 : 0;
        const arcs = pieLayout(data.groups, width / 2, height / 2, r, inner);

        return (
            <svg className="ChartView-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-label={p.title}>
                {arcs.map((arc: Arc, i) => {
                    const g = data.groups[i];

                    if (arc.d === '') {
                        return null;
                    }

                    const text = label(g);

                    return (
                        <g key={g.key} {...markProps(g)}>
                            <path d={arc.d} fill={g.color} />
                            {text && arc.share >= 0.06 ? (
                                <text className="ChartView-onMark" x={px(arc.labelX)} y={px(arc.labelY)} textAnchor="middle" dominantBaseline="middle">
                                    {text}
                                </text>
                            ) : null}
                            <title>{aria(g)}</title>
                        </g>
                    );
                })}
            </svg>
        );
    }

    const layout: AxisLayout = settings.chartType === 'bar'
        ? barLayout(data.groups, width, height, tickFormat, p.shortLabel)
        : settings.chartType === 'line'
            ? lineLayout(data.groups, width, height, tickFormat, p.shortLabel)
            : columnLayout(data.groups, width, height, tickFormat, p.shortLabel);
    const vertical = settings.chartType !== 'bar';

    return (
        <svg className="ChartView-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-label={p.title}>
            <g className="ChartView-grid" aria-hidden="true">
                {layout.ticks.map((tick) =>
                    vertical ? (
                        <g key={tick.value}>
                            <line x1={px(layout.plot.x)} x2={px(layout.plot.x + layout.plot.w)} y1={px(tick.at)} y2={px(tick.at)} className={tick.value === 0 ? 'is-zero' : ''} />
                            <text x={px(layout.plot.x - 6)} y={px(tick.at + 4)} textAnchor="end">
                                {tickFormat(tick.value)}
                            </text>
                        </g>
                    ) : (
                        <g key={tick.value}>
                            <line y1={px(layout.plot.y)} y2={px(layout.plot.y + layout.plot.h)} x1={px(tick.at)} x2={px(tick.at)} className={tick.value === 0 ? 'is-zero' : ''} />
                            <text x={px(tick.at)} y={px(layout.plot.y + layout.plot.h + 14)} textAnchor="middle">
                                {tickFormat(tick.value)}
                            </text>
                        </g>
                    ),
                )}
            </g>

            {settings.chartType === 'line' ? <path className="ChartView-line" d={(layout as ReturnType<typeof lineLayout>).d} fill="none" /> : null}

            {data.groups.map((g, i) => {
                const rect = layout.rects[i];
                const valueAt: TextAt = layout.values[i];
                const text = label(g);

                if (settings.chartType === 'line') {
                    const point = (layout as ReturnType<typeof lineLayout>).points[i];

                    return (
                        <g key={g.key} {...markProps(g)}>
                            <circle className="ChartView-point" cx={px(point.x)} cy={px(point.y)} r={p.hover === g.key || p.selectedKey === g.key ? 6 : 4} />
                            <rect x={px(rect.x)} y={px(layout.plot.y)} width={px(rect.w)} height={px(layout.plot.h)} fill="transparent" />
                            {text ? (
                                <text className="ChartView-value" x={px(point.x)} y={px(point.y - 8)} textAnchor="middle">
                                    {text}
                                </text>
                            ) : null}
                            <title>{aria(g)}</title>
                        </g>
                    );
                }

                return (
                    <g key={g.key} {...markProps(g)}>
                        <rect x={px(rect.x)} y={px(rect.y)} width={px(rect.w)} height={px(rect.h)} fill={g.color} rx={2} />
                        {text && (vertical ? rect.w >= text.length * 5 : true) ? (
                            <text className="ChartView-value" x={px(valueAt.x)} y={px(valueAt.y)} textAnchor={valueAt.anchor}>
                                {text}
                            </text>
                        ) : null}
                        <title>{aria(g)}</title>
                    </g>
                );
            })}

            <g className="ChartView-axis" aria-hidden="true">
                {layout.categories.map((c) =>
                    c.text ? (
                        <text key={c.key} x={px(c.x)} y={px(c.y)} textAnchor={c.anchor}>
                            {c.text}
                        </text>
                    ) : null,
                )}
            </g>
        </svg>
    );
};

interface LegendProps {
    data: ChartData;
    width: number;
    formatValue: (v: number) => string;
    selectedKey: string;
    hover: string | null;
    onHover: (key: string | null) => void;
    onSelect: (group: Group) => void;
    getString: (id: string) => string;
}

export const Legend: React.FC<LegendProps> = (p) => (
    <ul className="ChartView-legend" style={p.width > 0 ? { width: `${p.width}px` } : undefined}>
        {p.data.groups.map((g) => (
            <li
                key={g.key}
                className={['ChartView-legendItem', p.selectedKey !== '' && p.selectedKey === g.key ? 'is-selected' : '', p.hover === g.key ? 'is-hover' : ''].join(' ').trim()}
            >
                <button
                    type="button"
                    className="ChartView-legendButton"
                    aria-pressed={p.selectedKey !== '' && p.selectedKey === g.key}
                    disabled={g.other}
                    onClick={(): void => p.onSelect(g)}
                    onMouseEnter={(): void => p.onHover(g.key)}
                    onMouseLeave={(): void => p.onHover(null)}
                    onFocus={(): void => p.onHover(g.key)}
                    onBlur={(): void => p.onHover(null)}
                >
                    <span className="ChartView-swatch" style={{ background: g.color }} aria-hidden="true" />
                    <span className="ChartView-legendLabel">{g.label}</span>
                    <span className="ChartView-legendValue">{p.formatValue(g.value)}</span>
                    <span className="ChartView-legendPercent">{fmt(p.getString('ChartView_Percent'), percentOf(g.value, p.data.total))}</span>
                </button>
            </li>
        ))}
    </ul>
);

interface TableProps {
    data: ChartData;
    roles: Roles;
    measure: string;
    formatValue: (v: number) => string;
    getString: (id: string) => string;
}

/** The chart as a table, for a screen reader; visually hidden. */
export const DataTable: React.FC<TableProps> = (p) => (
    <table className="ChartView-sr">
        <caption>{p.getString('ChartView_Table')}</caption>
        <thead>
            <tr>
                <th scope="col">{p.roles.categoryLabel}</th>
                <th scope="col">{p.measure}</th>
                <th scope="col">%</th>
            </tr>
        </thead>
        <tbody>
            {p.data.groups.map((g) => (
                <tr key={g.key}>
                    <th scope="row">{g.label}</th>
                    <td>{p.formatValue(g.value)}</td>
                    <td>{percentOf(g.value, p.data.total)}</td>
                </tr>
            ))}
        </tbody>
    </table>
);
