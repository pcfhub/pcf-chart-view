/**
 * The subgrid case: which lookup column relates this table's rows to the
 * record the form is on.
 *
 * **Measured 2026-09-19 (SPEC.md P2): a subgrid's relationship to its parent
 * is invisible to the control.** `filtering.getFilter()` answers `null`,
 * `linking.getLinkedEntities()` answers `[]`, and `filtering` carries a
 * `canDisableRelationshipFilter` the platform keeps to itself — so an
 * aggregate built from the view alone counts the whole table (31 contacts
 * under a subgrid showing one account's). The parent record itself *is*
 * visible: `mode.contextInfo` carries `entityId` and `entityTypeName` on a
 * form, and neither on a main grid.
 *
 * So the column is found three ways, in order, and the fourth is honesty:
 *
 *   1. the maker said — `parentLookup`, a logical name, or `none` for a
 *      subgrid that is not related to the record at all;
 *   2. the table's `ManyToOneRelationships` name exactly one lookup whose
 *      target is the form's table;
 *   3. several do, and exactly one of them is in the loaded rows with the
 *      form's record as its value on every row — a subgrid's rows all point
 *      at the parent, so the column that does is the relationship;
 *   4. otherwise the server route is withheld, the caption says *loaded so
 *      far*, and the console names the candidates and the input that settles
 *      it.
 *
 * And the rows may say **no**. A subgrid configured without *Show related
 * records* lists the whole table under a record (measured 2026-09-19, W3),
 * so a form is not proof of a relationship: a candidate the loaded rows
 * deny — a row pointing elsewhere, or nowhere — is dropped, and when every
 * candidate is denied the subgrid is unrelated and the view is the answer,
 * with no condition at all. Only a candidate the rows cannot speak for
 * (not in the dataset) is trusted on the relationships' word alone.
 *
 * Why the third step matters on the first table anyone tries: a contact has
 * two lookups to account, `parentcustomerid` (the one a subgrid uses) and the
 * read-only `accountid`, and a view usually carries the first.
 */

import { isLogicalName } from '../query/fetchXml';
import { bareId } from '../query/rows';

/** The record a form subgrid sits on. */
export interface FormRecord {
    entityType: string;
    id: string;
}

/** What the entry point hands the component to resolve the column with. */
export interface ParentReading {
    record: FormRecord;
    /** `parentLookup` as the maker typed it, lower-cased, or `null`. */
    explicit: string | null;
    /** The lookups on the chart's table whose target is the form's table, or a rejection. */
    candidates: () => Promise<string[]>;
    /**
     * Whether every loaded row has this column pointing at the form's record:
     * `true`, `false`, or `null` when the column is not in the dataset or
     * there are no rows to ask.
     */
    confirmed: (column: string) => boolean | null;
}

export interface ParentResolution {
    /** The column, or `null` when nothing settles it — or when the subgrid is unrelated (`by: 'unrelated'`). */
    column: string | null;
    /** How it was settled — for the probe and the console. */
    by: 'explicit' | 'only-candidate' | 'rows' | 'unrelated' | 'unresolved' | 'no-candidates';
    candidates: string[];
}

/** The four steps, as one promise that never rejects. */
export async function resolveParentLookup(parent: ParentReading): Promise<ParentResolution> {
    if (parent.explicit === 'none') {
        // The maker says so: a subgrid that is not related to the record (X4 — the rows could not).
        return { column: null, by: 'unrelated', candidates: [] };
    }

    if (parent.explicit !== null) {
        return { column: parent.explicit, by: 'explicit', candidates: [] };
    }

    let candidates: string[] = [];

    try {
        candidates = (await parent.candidates()).filter((c, i, all) => isLogicalName(c) && all.indexOf(c) === i);
    } catch {
        candidates = [];
    }

    if (candidates.length === 0) {
        return { column: null, by: 'no-candidates', candidates };
    }

    const verdicts = candidates.map((c) => ({ column: c, rows: parent.confirmed(c) }));
    const confirmed = verdicts.filter((v) => v.rows === true);
    const open = verdicts.filter((v) => v.rows !== false);

    if (confirmed.length === 1) {
        return { column: confirmed[0].column, by: 'rows', candidates };
    }

    if (open.length === 0) {
        // Every lookup to the parent table is in the rows and none points at the record: not a related subgrid.
        return { column: null, by: 'unrelated', candidates };
    }

    if (open.length === 1 && candidates.length === 1) {
        return { column: open[0].column, by: 'only-candidate', candidates };
    }

    return { column: null, by: 'unresolved', candidates };
}

/**
 * The rows' answer for one column: every loaded record's lookup is the
 * form's record. `getValue` on a lookup is an `EntityReference` —
 * `{ id: { guid }, etn, name }` measured — read leniently.
 *
 * **A column the dataset does not carry must answer `null` rather than `false`,
 * and this function cannot tell.** `getValue` returns `null` for an unfetched
 * column, a non-existent one and a genuinely empty one alike — measured on a
 * real form, 2026-09-21 — so a column the view never selected would deny every
 * candidate and the resolver would conclude "unrelated" about a subgrid that is
 * related. The guard is therefore the **caller's**: `index.ts` checks
 * `dataset.columns` before asking, and the comment beside it says so.
 *
 * This comment used to claim the guarantee as if it were made here, which read
 * as a defect on a later pass and cost a round of investigation.
 * `pcf-data-table` takes the fetched-column list as a parameter instead, so the
 * guard cannot be forgotten by a future caller; that is the better shape, and
 * the only reason it is not adopted here is that this call site is correct and
 * a shipped control is not worth churning for symmetry.
 */
export function rowsConfirm(records: { getValue(name: string): unknown }[], column: string, id: string): boolean | null {
    if (records.length === 0) {
        return null;
    }

    const wanted = bareId(id);
    let seen = 0;

    for (const record of records) {
        let raw: unknown;

        try {
            raw = record.getValue(column);
        } catch {
            return null;
        }

        if (raw === null || raw === undefined) {
            return false;
        }

        const ref = raw as { id?: { guid?: string } | string };
        const candidate = typeof ref === 'object' && ref !== null ? (typeof ref.id === 'object' && ref.id !== null ? ref.id.guid : ref.id) : raw;

        if (bareId(candidate) !== wanted) {
            return false;
        }

        seen += 1;
    }

    return seen > 0 ? true : null;
}
