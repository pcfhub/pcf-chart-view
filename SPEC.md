Not yet measured (0.0.3 walkthrough W4). |
**Measured, with a surprise.** A Choice's `getValue()` came back as the **string** `"1"` on the subgrid (`getFormattedValue` "Default Value"), `null` where blank on the main grid; a Currency as a number (100000). And **the role column need not be in the view**: `customersizecode` was not among *All Contacts*' attributes, arrived on the dataset with `order: -1, visualSizeFactor: -1`, and `getValue` answered it — the platform adds a property-set column to the query. The docs said the opposite and were corrected. |
Not measured. |
Not yet measured — needs *Aggregate* = sum on the form (0.0.3 walkthrough W1). |
Not yet measured — needs a date category on the form (0.0.3 walkthrough W2). |
**Measured.** `savedquery` answered the system view; the FetchXML carries `savedqueryid` on `<fetch>`, attributes interleaved with a `<link-entity … visible="false">` holding an attribute, and — for *All Accounts* and *All Contacts* — **no `<filter>` at all**. `stripView()` handled all of it. A personal view: not tried. |
**Measured.** 200, the link-entity kept without its attribute accepted. Rows exactly as the rig models: `n` a number with `n@…FormattedValue` "59" and `n@…AttributeName` "accountid" beside it; `g` the **integer** with `g@…FormattedValue` "Accounting"; **the blank group a row with no `g` at all** (59 accounts with no industry). Elapsed not logged. |
**Measured, and the wrong way: the relationship is invisible.** `getFilter()` answered `null` on both hosts; `getLinkedEntities()` answered `[]` on the subgrid and, on the main grid, the *view's* own link-entity (the primary-contact outer join). The aggregate under the contacts subgrid counted **31 — every contact in the organisation** — while the subgrid showed one account's. `filtering.canDisableRelationshipFilter` sitting beside `getFilter` names the filter the platform keeps to itself. 0.0.3 resolves the lookup column itself (`data/parent.ts`): the `parentLookup` input, else the table's `ManyToOneRelationships` to the form's table when there is one, else the one the loaded rows all point at the record through, else withheld with the candidates named. Quick-find on the main grid: not yet typed, still unmeasured. |
**Measured 2026-09-19, both hosts the same surface.** The bag carries `linking`, `getViewId`, `entityDisplayCollectionName`, `_capabilities`, `retrieveRecordCommand`, `getCellImageInfo`, `setSearchSessionId`; `paging` adds `loadPageRange` and `getQueryCancellationToken`; `filtering` adds **`aliasMap`** and **`canDisableRelationshipFilter`**. `getViewId()` answered on both (`65ffaf9a…` All Accounts, `0d5d377b…` All Contacts). `contextInfo`: on the subgrid `{ entityTypeName: "account", entityId: "7de84297-…", entityRecordName: "Adventure Works (sample)" }`; on the main grid `{ entityTypeName: "account", entityRecordName: null }` and **no `entityId`** — so `entityId` is the test for "under a record". |
# Chart View

A Dataverse view as a bar, column, pie, donut or line chart — grouped by a
column, aggregated on the server.

Two `property-set` roles — the column to group by (a type group of seven:
Choice, Yes/No, two Lookups, text, two date formats) and an optional number
to add up (four numeric types) — and two routes to the numbers, chosen per
host and hidden behind one `ChartData`: **the server route**, one FetchXML
`aggregate='true'` query over the whole view through
`context.webAPI.retrieveMultipleRecords`, and **the browser route**, the
loaded rows grouped in `chart/aggregate.ts`. The caption under the title
always says which the numbers came from.

## The design, and why the view's own FetchXML

The chart wants the records *the view means*: its filter, its linked-table
conditions, and whatever the user has narrowed it to since. A query composed
from scratch would have to understand all of that; a query built by
**rewriting the view's own FetchXML** — read from `savedquery` / `userquery`
by the id `getViewId()` gives, every `<attribute>` and `<order>` removed at
every depth, the two aggregate attributes put in, `aggregate='true'` on the
root, the dataset's runtime filter appended — carries a link-entity filter
this control never has to parse. `query/fetchXml.ts` is that rewrite, pure,
and the rig answers the result over its fixture (`dev/host.js`,
`answerFetchXml`).

Three consequences the caption is there to make honest:

- a view whose definition cannot be read (no id, a personal view another
  user owns) sends **nothing** — the bare table would be a confident wrong
  number — and the browser route stands with *loaded so far*;
- a runtime filter with an operator the control cannot spell in FetchXML
  withholds the server route rather than sending a different question;
- a refusal (the 50,000-record `AggregateQueryRecordLimit`, an ungroupable
  column) is *the server could not aggregate this view*, in the caption and
  once in the console.

## The 0.0.1 probe — questions for the form

The 0.0.x builds are probes (0.0.2 is 0.0.1 with the `labels` property renamed — see P0; Dataverse ignores a re-import at the same number): `PROBE = true` in `index.ts` logs the answers
to the questions below under `[ChartView probe]`, once per distinct payload,
and the component logs the query it sent and the first five rows it got
back. **Tag 0.1.0 only after the answers**; each row names what it decides.

**Environment:** the Accounts form on `cll365`, the Contacts subgrid on
*City Power & Light (sample)* bound to *Group by* = a Choice on contact
(e.g. `preferredcontactmethodcode`), and the Accounts **main grid** on
*Active Accounts* bound to *Group by* = `industrycode`, *Value* = `revenue`.

| # | Question | Decides | Answer |
| --- | --- | --- | --- |
| P0 | Does the control configure and publish on a classic-designer subgrid at all? | the manifest | **Measured 2026-09-19, and it did not**: publishing the Accounts form after mounting 0.0.1 on a subgrid in the classic designer failed with *XML node parameters is one that has an id of 7f5ecd1d-… but is one that we don't recognize as having a valid LabelTypeCode*, while the same control published on the entity view. The property named `labels` was the cause: the classic designer writes each configured property under the cell's `<parameters>` as an element of that name, and the publish step treats every `<labels>` in FormXML as a label owner — the GUID is the cell's. Renamed `valueLabels` in 0.0.2; `npm run check` now refuses the name and warns on the other FormXML element names. |
| P1 | `Object.keys(dataset)`, `paging`, `filtering`, `linking` on a **subgrid** and on a **main grid**; `getViewId()` on each; `mode.contextInfo` on the subgrid | whether the surface differs between the two hosts; `linking` as a source of the relationship | |
| P2 | `filtering.getFilter()` on the **subgrid** before the user does anything: does it carry the relationship to the parent record (a condition on `parentcustomerid` / `_value`)? And on the main grid after typing into the quick-find box: what `conditionOperator` and `value`? | **the whole subgrid case.** If the relationship is in `getFilter()`, the server route already appends it. If not, the server route on a subgrid aggregates the *view* — every contact, not this account's — and 0.1.0 must withhold it when `contextInfo.entityId` is set and no condition names the parent. `linking.getLinkedEntities()` is the other place to look | |
| P3 | The aggregate over a Choice on the main grid: status, elapsed, and the first rows' exact keys — is `g` the integer, is `g@OData.Community.Display.V1.FormattedValue` the label, is `n` a number, is the blank group a row with no `g` (as FetchXML omits nulls) or with `g: null`? | `query/rows.ts` reads all four leniently; the rig omits `g` | |
| P4 | `retrieveRecord('savedquery', <viewId>, '?$select=fetchxml')`: status, and the `fetchxml` text — does a system view's definition carry `<order>`, `<link-entity>` with attributes, and `<filter>` the way the fixture's does? For a **personal** view: does `getViewId()` give its id, and does `userquery` answer it? | `stripView()`; whether the two-table fallback is needed | |
| P5 | The aggregate with `dategrouping='month'` and `'year'` on `createdon`: is `g` the month number (1–12) or a string, is there a formatted value, and is `y` the year — and for `'week'`, which week does 4 January 2026 (a Sunday) fall in? | `keyFromBucket()`; `weekOfYear()`'s Sunday-start rule; whether a date label can be taken from the annotation | |
| P6 | The aggregate with `aggregate='sum'` on `revenue` (Money): is `v` a number, is there a `v@…FormattedValue` with the currency symbol, and does a group whose only value is blank carry `v` at all? Also `avg` on the same column: its precision | `numberFormatter()` vs the annotation; the rig omits `v` for an all-blank group | |
| P7 | The refusal shape for an aggregate that cannot run — `groupby` on a multi-select choice column, or `sum` on a text column: `errorCode`, `message`, `title` | `messageOf()`; the rig's `webApiFault(2147164195, …)` stand-in for the record-limit refusal, which the test environment cannot reach | |
| P8 | `getValue()` for the bound Choice on a dataset record: integer or string; for a Lookup: the `EntityReference` shape; for a date: ISO string. `columns[].dataType` for each | `readingOf()` — measured before on `pcf-data-table` (integer, `{ id: { guid }, etn, name }`); confirmed here on a property-set column | |
| P9 | On the subgrid, after editing a contact's Choice in its own form and returning: does the dataset fire `updateView` with `loading` true→false, so `refreshToken` bumps and the aggregate re-runs? | the re-aggregate trigger | |

## The 0.0.3 walkthrough — questions for the form

0.0.3 is 0.0.2 with the subgrid route (P2) and `PROBE` still on. Mount it
on the contacts subgrid and the accounts main grid again, and:

| # | Do | Expect | Answer |
| --- | --- | --- | --- |
| W1 | Main grid, *Group by* = Industry, *Value* = Annual Revenue, *Aggregate* = Sum | The console's `P3 aggregate rows` carry `v` as a number; is there a `v@…FormattedValue` with the currency symbol; does the blank-revenue group carry `v`? (P6) | |
| W2 | Main grid, *Group by* = Created On, *Date grouping* = Month, then Week | `g` is the month number and `y` the year; for week, which week 4 Jan 2026 falls in (P5). The chart draws *Jan 2026*… in order | |
| W3 | Contacts subgrid, *Parent lookup* blank | `P2 parent lookup` logs `by: "rows"` with candidates `parentcustomerid, accountid` (or `only-candidate`); the caption reads *All N records* with N the subgrid's own count, not 31 | |
| W4 | Open a contact from the subgrid, change its Choice, save, go back | The chart re-aggregates (the caption's N or a bar changes) without a refresh (P9) | |
| W5 | Contacts subgrid, *Parent lookup* = `accountid` (the read-only one) | The count may match W3 or not; either way no empty chart | |
| W6 | Main grid, type into the quick-find box | `P2 filtering.getFilter()` now shows the condition — which `conditionOperator` and `value`; the aggregate's `filterXml` carries it and the caption's N drops with it | |
| W7 | A two-column section on the form (the chart in one column) | The legend below the chart, nothing cut | |

## Platform behaviour worth knowing

- **A subgrid's relationship is not on the dataset.** Measured: `getFilter()`
  `null`, `getLinkedEntities()` `[]`, `canDisableRelationshipFilter` on
  `filtering` naming what the platform applies itself; `mode.contextInfo`
  carries the parent's `entityId` and `entityTypeName` on a form and no
  `entityId` on a main grid. So a control that re-derives the view's rows
  under a record has to find the lookup column itself — `data/parent.ts`.
- **A property-set column is fetched whether or not the view selects it.**
  Measured: `customersizecode` absent from *All Contacts*, on the dataset
  with `order: -1`, `getValue` answering. A Choice's `getValue` there was the
  string `"1"`.
- **`filtering.getFilter()` speaks in `ConditionOperator` numbers**, and
  the PCF typings list the subset a dataset can carry (36 values) pointing at
  the SDK enum for the names. `query/fetchXml.ts` carries the map
  (`CONDITION_OPERATORS`); an operator outside it makes the filter
  untranslatable and withholds the server route. Read from the type
  definitions; which operators a real grid *sends* is P2.
- **A FetchXML aggregate needs every attribute aliased and either
  `groupby` or `aggregate`d**, and a `<link-entity>` copied from a view with
  its `<attribute>`s left in is refused — Microsoft Learn, *Aggregate data
  using FetchXml*, and the reason `stripView()` removes attributes at every
  depth. Not yet measured (P4/P7).
- **`count` on the primary key counts rows; `countcolumn` counts non-null
  values.** The control always asks for `count` under `n` so the caption and
  the tooltips have a record count whatever the measure. Learn; not yet
  measured.
- **A `dategrouping` group comes back as the bucket number alone**, so
  March 2025 and March 2026 merge unless the year is asked as a second
  `groupby` — which is why a date query carries `y`, and a `day` grouping
  `mo` as well. Learn's example; P5 measures the shape.
- **The primary key is not always `<table>id`.** Activities share
  `activityid`; a custom activity cannot be told from its name. `platform.ts`
  hard-codes the out-of-the-box activity tables and takes
  `PrimaryIdAttribute` from `getEntityMetadata` when Utility answers.
- **The dataset rig has no `context.formatting`**, and neither, probably,
  does the hub's harness — so `numberFormatter()`'s fallback is
  `toLocaleString` with grouping and at most two decimals, and the axis
  ticks are compact (`1.5M`) on every host. The first fallback was
  `toFixed(2)`, and the first screenshot read `200000.00`.

## Demo

`limited`, and the limitations block says why: the harness has no Web API,
so the demo is the browser route over the fixture, and no metadata, so the
palette stands in for the option colours. The fixture's Industry column holds
labels rather than option values because a fixture record cannot carry both.

## Not verified

- P5, P6, P7, P9 and the quick-find half of P2 — the 0.0.3 walkthrough.
- **That `ManyToOneRelationships` for contact → account lists
  `parentcustomerid` and `accountid`, and that the rows pick the first.**
  The resolver is measured on the rig; W3 measures it on the form.
- **The week rule.** `weekOfYear()` follows SQL Server's `DATEPART(week)`
  (Sunday start, week 1 holds 1 January) on the belief that
  `dategrouping='week'` does; both routes agree with each other whichever is
  right, and P5 decides.
- **The 50,000-record refusal's shape.** The test environment has hundreds
  of rows, not fifty thousand; the rig's `aggregateLimit` refusal uses the
  documented code `0x8004E023` (2147164195) and the fault shape every other
  refusal has. P7 measures a different refusal and the control treats every
  rejection the same way.
- **The phone client.** The narrow layout is measured, not queried
  (`ResizeObserver`, class `is-narrow` under 420 px), and screenshotted at
  300 px; not yet opened on the phone app.
- **Whether a Choice's `Color` is on the option descriptor for a
  property-set column** the way it was on pcf-kanban-board's lane column —
  the same read, a different binding.
- **RTL.** The SVG is drawn left-to-right; `dir="rtl"` flips the header and
  the legend and leaves the axes as they are, which is what a chart should
  do, and has been looked at in the harness only.

## Promoting a finding

*Aggregating through FetchXML* — the rewrite of a view's own definition, the
two routes and the caption, the alias rules, the date-year pairing — is in
the skill's `references/control-patterns.md` from 0.45.0. What stays here is
this control's own: the probe table, the week rule, and the roles.

## Screenshots

`dev/preview.html` served by `npm run harness`, shot through headless Chrome
over the DevTools protocol (`Emulation.setDeviceMetricsOverride` for the
width, then `Page.captureScreenshot` at scale 2). The flag route the skill
describes (`--window-size=300,…` with `--force-device-scale-factor=2`) laid
the page out wider than 300 on this machine — the legend beside the chart
and the caption cut — while the 256 px logo shot came out right; the cause
was not chased, and the override lays out at the width asked. `?fixture=demo&type=…` for the
published ones; `?type=…` alone for the rig's fixture, which shows the
server route's caption.
