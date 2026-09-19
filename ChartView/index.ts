import * as React from 'react';
import { IInputs, IOutputs } from './generated/ManifestTypes';
import { ChartViewControl, IProps, ServerRoute } from './components/ChartViewControl';
import {
    dateLabelsOf,
    filterOf,
    hasMoreRows,
    metadataLoader,
    MetadataReading,
    numberFormatter,
    offsetReader,
    readRecords,
    readSettings,
    resolveRoles,
    viewIdOf,
    webApiOf,
} from './platform';
import { filterToFetchXml } from './query/fetchXml';
import { formRecordOf, lookupClientUrl, parentCandidates } from './platform';
import { ParentReading, rowsConfirm } from './data/parent';

type DataSet = ComponentFramework.PropertyTypes.DataSet;

/**
 * A 0.0.x build logs what the form answers to the questions in SPEC.md, under
 * one prefix, once per distinct payload. Off in a release: the constant is
 * flipped in the same commit as the version.
 */
const PROBE = false;

/**
 * A Dataverse view as a chart.
 *
 * Everything that talks to the platform lives in this file and `platform.ts`.
 * The component never sees `context` or the dataset — every reading reaches it
 * as a prop and every platform call as a function it may invoke. Two routes
 * are prepared here on every pass and the component picks between them:
 *
 *   - **the server route** — `context.webAPI` present, the category mapped,
 *     the dataset's runtime filter spellable in FetchXML — one aggregate
 *     query over the whole view, so the numbers are the view's;
 *   - **the browser route** — always — the loaded rows read into one reading
 *     per record, which is what canvas gets and what stands in when the
 *     server refuses.
 *
 * `updateView` runs on every change to any bound value. Nothing here mutates
 * the dataset — no `refresh`, no `setFilter`, no paging — so there is no
 * loop to guard against; the one thing this class remembers between passes
 * is the fetch counter the component re-aggregates on.
 */
export class ChartView implements ComponentFramework.ReactControl<IInputs, IOutputs> {
    private notifyOutputChanged!: () => void;
    private selectedKey = '';
    private selectedLabel = '';

    /** Bumped when the platform finishes a fetch — `loading` going from true to false. */
    private refreshToken = 0;
    private wasLoading = false;

    /** The metadata loader, kept per key so the component's effect sees one function per key. */
    private metadataKey = '';
    private metadata: (() => Promise<MetadataReading>) | null = null;

    private probed = new Set<string>();

    public init(context: ComponentFramework.Context<IInputs>, notifyOutputChanged: () => void): void {
        // No container: a virtual control never receives one.
        this.notifyOutputChanged = notifyOutputChanged;

        /*
         * Ask for the width, because the measured one is not always the
         * given one. Measured on the Accounts main grid 2026-09-19 (W2): the
         * host there is shrink-to-fit, so the root — rendered without its
         * SVG on the first pass — measured the width of its own caption,
         * ~380 px of a ~1050 px grid, and the SVG then locked it. A form
         * section is a block parent and measures true. `allocatedWidth` is
         * -1 until this call and the grid's real width after it; the
         * component takes the larger of the two. Measured on both hosts
         * (Y1): the chart follows the window both ways.
         */
        context.mode.trackContainerResize(true);
    }

    public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
        const dataset = context.parameters.records;
        const getString = (id: string): string => context.resources.getString(id);
        const roles = resolveRoles(dataset);
        const settings = readSettings(context);
        const entity = safeEntity(dataset);

        if (this.wasLoading && !dataset.loading) {
            this.refreshToken += 1;
        }

        this.wasLoading = Boolean(dataset.loading);

        const dateLabels = dateLabelsOf(context, getString);
        const readings = roles.category ? readRecords(dataset, roles, settings.dateGrouping, offsetReader(context), dateLabels) : [];
        const loaded = readings.length;
        const server = this.serverRoute(context, dataset, entity, roles, settings);
        const metaKey = `${entity}|${roles.category}`;

        if (metaKey !== this.metadataKey) {
            this.metadataKey = metaKey;
            this.metadata = metadataLoader(context, entity, roles.category);
        }

        this.probe(context, dataset, entity, roles, server);

        const props: IProps = {
            roles,
            settings,
            readings,
            loaded,
            hasMore: hasMoreRows(dataset, loaded),
            loading: Boolean(dataset.loading),
            error: Boolean(dataset.error),
            server,
            refreshToken: this.refreshToken,
            metadata: this.metadata,
            metadataKey: metaKey,
            dateLabels,
            viewTitle: safeTitle(dataset),
            selectedKey: this.selectedKey,
            onSelect: (key: string, label: string): void => this.select(key, label),
            getString,
            formatValue: numberFormatter(context, roles.valueKind, roles.value === null ? 'count' : settings.aggregate),
            // Typed as of @types/powerapps-component-framework 1.3.18; absent
            // in PCFHub's demo harness, which is why the component falls back
            // to Fluent's own themes by `dark`.
            theme: context.fluentDesignLanguage?.tokenTheme,
            dark: context.fluentDesignLanguage?.isDarkTheme,
            isRTL: context.userSettings.isRTL,
            disabled: context.mode.isControlDisabled,
            visible: context.mode.isVisible,
            allocatedWidth: context.mode.allocatedWidth,
            gridCount: gridCountOf(dataset),
            onProbe: PROBE ? (label, payload): void => this.log(label, payload) : undefined,
        };

        return React.createElement(ChartViewControl, props);
    }

    /**
     * The empty string is the observable clear: the generated `IOutputs`
     * types both as optional, and `undefined` means "no change".
     */
    public getOutputs(): IOutputs {
        return { selectedKey: this.selectedKey, selectedLabel: this.selectedLabel };
    }

    public destroy(): void {
        // The platform unmounts the React tree for a virtual control, and this
        // control holds no listeners, timers or observers of its own — the
        // component's ResizeObserver is released by its own effect.
    }

    /** Click a group to select it; click it again to clear. Notified before anything else happens. */
    private select(key: string, label: string): void {
        if (key === this.selectedKey) {
            this.selectedKey = '';
            this.selectedLabel = '';
        } else {
            this.selectedKey = key;
            this.selectedLabel = label;
        }

        this.notifyOutputChanged();
    }

    /**
     * The server route, or `null`. The runtime filter is what the user has
     * done to the view since it loaded — quick find, a column filter, and on
     * a subgrid possibly the relationship to the parent record (SPEC.md P2
     * asks). A filter with an operator this control cannot spell means the
     * server would answer a different question, so the route is withheld and
     * the caption says the numbers are the loaded rows'.
     */
    private serverRoute(
        context: ComponentFramework.Context<IInputs>,
        dataset: DataSet,
        entity: string,
        roles: ReturnType<typeof resolveRoles>,
        settings: ReturnType<typeof readSettings>,
    ): ServerRoute | null {
        const api = webApiOf(context);

        if (!api || !entity || !roles.category || roles.categoryKind === 'unknown') {
            return null;
        }

        const filter = filterToFetchXml(filterOf(dataset));

        if (!filter.translatable) {
            return null;
        }

        const viewId = viewIdOf(dataset);
        const parent = this.parentReading(context, dataset, entity, settings.parentLookup);
        const key = [
            entity, roles.category, roles.categoryKind, roles.value ?? '', settings.aggregate, settings.dateGrouping, viewId, filter.xml,
            parent ? `${parent.record.entityType}:${parent.record.id}:${parent.explicit ?? ''}` : '',
        ].join('|');

        return { api, entity, viewId, filterXml: filter.xml, parent, key };
    }

    /**
     * The subgrid's parent, or `null` on a main grid and in canvas. Measured
     * 2026-09-19: the relationship itself is invisible (`getFilter()` null,
     * `getLinkedEntities()` empty), the parent record is not — so the
     * component resolves the lookup column from the maker's input, the
     * table's relationships, or the loaded rows, in `data/parent.ts`.
     */
    private parentReading(context: ComponentFramework.Context<IInputs>, dataset: DataSet, entity: string, explicit: string | null): ParentReading | null {
        const record = formRecordOf(context);

        if (!record) {
            return null;
        }

        const clientUrl = lookupClientUrl(context);
        const columns = new Set((dataset.columns ?? []).map((column) => column.name));
        const records = (dataset.sortedRecordIds ?? []).map((id) => dataset.records[id]).filter((r): r is DataSet['records'][string] => Boolean(r));

        return {
            record,
            explicit,
            candidates: (): Promise<string[]> => parentCandidates(clientUrl, entity, record.entityType),
            // A column the dataset does not carry answers null, not false.
            confirmed: (column: string): boolean | null => (columns.has(column) ? rowsConfirm(records, column, record.id) : null),
        };
    }

    /* eslint-disable @typescript-eslint/no-explicit-any */
    private probe(context: ComponentFramework.Context<IInputs>, dataset: DataSet, entity: string, roles: ReturnType<typeof resolveRoles>, server: ServerRoute | null): void {
        if (!PROBE) {
            return;
        }

        const ds: any = dataset;

        this.log('P1 dataset surface', {
            keys: Object.keys(ds),
            paging: ds.paging ? Object.keys(ds.paging) : null,
            filtering: ds.filtering ? Object.keys(ds.filtering) : null,
            linking: ds.linking ? Object.keys(ds.linking) : null,
            entity,
            viewId: viewIdOf(dataset),
            title: safeTitle(dataset),
            contextInfo: (context.mode as any)?.contextInfo ?? null,
        });

        try {
            this.log('P2 filtering.getFilter()', ds.filtering && typeof ds.filtering.getFilter === 'function' ? ds.filtering.getFilter() : 'no getFilter');
        } catch (error) {
            this.log('P2 filtering.getFilter() threw', String(error));
        }

        try {
            this.log('P2 linking.getLinkedEntities()', ds.linking && typeof ds.linking.getLinkedEntities === 'function' ? ds.linking.getLinkedEntities() : 'no getLinkedEntities');
        } catch (error) {
            this.log('P2 linking threw', String(error));
        }

        const category = (dataset.columns ?? []).find((c) => c.alias === 'categoryField');
        const value = (dataset.columns ?? []).find((c) => c.alias === 'valueField');

        this.log('P8 role columns', { category, value, roles });

        if (!dataset.loading && roles.category) {
            const sample = (dataset.sortedRecordIds ?? []).slice(0, 3).map((id) => {
                const record: any = dataset.records[id];
                return {
                    category: record?.getValue?.(roles.category),
                    categoryFormatted: record?.getFormattedValue?.(roles.category),
                    value: roles.value ? record?.getValue?.(roles.value) : undefined,
                };
            });

            this.log('P8 first records', sample);
        }

        // Does the host lower allocatedWidth when the window narrows? (X7 / Y1)
        this.log('P10 allocatedWidth', { allocatedWidth: context.mode.allocatedWidth, allocatedHeight: context.mode.allocatedHeight });

        this.log('P3 server route', server ? { entity: server.entity, viewId: server.viewId, filterXml: server.filterXml, parent: server.parent?.record ?? null } : null);

        // What the platform keeps to itself about the relationship — read once, for the record.
        this.log('P2 filtering extras', {
            aliasMap: ds.filtering?.aliasMap ?? 'absent',
            canDisableRelationshipFilter: ds.filtering?.canDisableRelationshipFilter ?? 'absent',
            capabilities: ds._capabilities ?? 'absent',
            entityDisplayCollectionName: ds.entityDisplayCollectionName ?? 'absent',
        });
    }

    /** One line per distinct payload, so a repaint does not repeat the answers. */
    private log(label: string, payload: unknown): void {
        let text: string;

        try {
            text = JSON.stringify(payload, (_key, v) => (typeof v === 'function' ? '[function]' : v));
        } catch {
            text = String(payload);
        }

        const stamp = `${label}:${text}`;

        if (this.probed.has(stamp)) {
            return;
        }

        this.probed.add(stamp);
        console.info(`[ChartView probe] ${label}`, payload);
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * `paging.totalResultCount` — the rows the *grid* holds after whatever the
 * host filtered it to, which the control cannot see (a quick-find, measured
 * 2026-09-19 W6; an unrelated subgrid). `-1` is "uncounted" and answers
 * `null`; so does a host with no paging.
 */
function gridCountOf(dataset: DataSet): number | null {
    try {
        const total = dataset.paging?.totalResultCount;
        return typeof total === 'number' && total >= 0 ? total : null;
    } catch {
        return null;
    }
}

/** `getTargetEntityType()`, or `''` on a host that cannot answer. */
function safeEntity(dataset: DataSet): string {
    try {
        const entity = dataset.getTargetEntityType();
        return typeof entity === 'string' ? entity.toLowerCase() : '';
    } catch {
        return '';
    }
}

function safeTitle(dataset: DataSet): string {
    try {
        const title = dataset.getTitle();
        return typeof title === 'string' ? title : '';
    } catch {
        return '';
    }
}
