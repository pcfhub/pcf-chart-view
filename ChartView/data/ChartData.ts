/**
 * The server route: the view's definition read once per view id, the
 * aggregate sent once per shape, and every rejection turned into a named
 * refusal the component shows as a caption rather than a blank chart.
 *
 * Both reads go through `context.webAPI` — a saved query is an ordinary
 * table (`savedquery` for a system view, `userquery` for a personal one), and
 * an aggregate is an ordinary `retrieveMultipleRecords` with `?fetchXml=`.
 * No same-origin `fetch` is needed here, which is what keeps this control
 * inside the WebAPI feature and out of the metadata-fetch pattern.
 */

import { WebApiReader } from '../platform';
import { aggregateFetchXml, AggregateShape, queryString } from '../query/fetchXml';
import { Row } from '../query/rows';

/** A refusal, as one readable sentence and the platform's own object. */
export interface Refusal {
    message: string;
    raw: unknown;
}

const messageOf = (error: unknown): string => {
    const e = error as { message?: unknown; title?: unknown } | null;

    if (e && typeof e.message === 'string' && e.message !== '') {
        // A payload fault buries the sentence after the second `InnerException :`.
        const inner = e.message.split('InnerException :').pop() ?? e.message;
        return inner.split(/\r?\n/)[0].trim();
    }

    return e && typeof e.title === 'string' ? e.title : String(error);
};

/** One view definition per id for the life of the page. A miss is cached too: a view that is not there stays not there. */
const viewCache = new Map<string, Promise<string | null>>();

/**
 * The view's FetchXML, from `savedquery` then `userquery`, or `null` when
 * neither answers — an unknown id, a personal view the user cannot read, a
 * `getViewId()` that lied. `null` is a degraded query, not an error: the
 * caller decides whether the runtime filter is enough to stand in.
 */
export function readViewFetchXml(api: WebApiReader, viewId: string): Promise<string | null> {
    if (viewId === '') {
        return Promise.resolve(null);
    }

    const cached = viewCache.get(viewId);

    if (cached) {
        return cached;
    }

    const read = (table: string): Promise<string | null> =>
        api.retrieveRecord(table, viewId, '?$select=fetchxml').then((row) => {
            const xml = row?.fetchxml;
            return typeof xml === 'string' && xml.indexOf('<fetch') !== -1 ? xml : null;
        });

    const promise = read('savedquery')
        .catch(() => read('userquery'))
        .catch((error: unknown) => {
            console.warn(`ChartView: view ${viewId} could not be read from savedquery or userquery.`, error);
            return null;
        });

    viewCache.set(viewId, promise);

    return promise;
}

/** For the suite: forget every cached view. */
export const resetViewCache = (): void => viewCache.clear();

export interface AggregateRequest {
    shape: AggregateShape;
    viewXml: string | null;
    filterXml: string;
}

/** The query text a request sends — exported so the probe can log it and the suite assert it. */
export const requestXml = (request: AggregateRequest): string =>
    aggregateFetchXml(request.shape, request.viewXml, request.filterXml);

/**
 * The aggregate, as the raw rows. Rejections are wrapped as a `Refusal` and
 * re-thrown; the component catches and falls back to the browser route.
 */
export function loadAggregate(api: WebApiReader, request: AggregateRequest): Promise<Row[]> {
    const xml = requestXml(request);

    return api.retrieveMultipleRecords(request.shape.entity, queryString(xml)).then(
        (result) => (Array.isArray(result?.entities) ? (result.entities as Row[]) : []),
        (error: unknown) => {
            const refusal: Refusal = { message: messageOf(error), raw: error };
            throw refusal;
        },
    );
}
