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
| P1 | `Object.keys(dataset)`, `paging`, `filtering`, `linking` on a **subgrid** and on a **main grid**; `getViewId()` on each; `mode.contextInfo` on the subgrid | whether the surface differs between the two hosts; `linking` as a source of the relationship | **Measured 2026-09-19, both hosts the same surface.** The bag carries `linking`, `getViewId`, `entityDisplayCollectionName`, `_capabilities`, `retrieveRecordCommand`, `getCellImageInfo`, `setSearchSessionId`; `paging` adds `loadPageRange` and `getQueryCancellationToken`; `filtering` adds **`aliasMap`** and **`canDisableRelationshipFilter`**. `getViewId()` answered on both (`65ffaf9a…` All Accounts, `0d5d377b…` All Contacts). `contextInfo`: on the subgrid `{ entityTypeName: "account", entityId: "7de84297-…", entityRecordName: "Adventure Works (sample)" }`; on the main grid `{ entityTypeName: "account", entityRecordName: null }` and **no `entityId`** — so `entityId` is the test for "under a record". |
| P2 | `filtering.getFilter()` on the **subgrid** before the user does anything: does it carry the relationship to the parent record (a condition on `parentcustomerid` / `_value`)? And on the main grid after typing into the quick-find box: what `conditionOperator` and `value`? | **the whole subgrid case.** If the relationship is in `getFilter()`, the server route already appends it. If not, the server route on a subgrid aggregates the *view* — every contact, not this account's — and 0.1.0 must withhold it when `contextInfo.entityId` is set and no condition names the parent. `linking.getLinkedEntities()` is the other place to look | **Measured, and the wrong way: the relationship is invisible.** `getFilter()` answered `null` on both hosts; `getLinkedEntities()` answered `[]` on the subgrid and, on the main grid, the *view's* own link-entity (the primary-contact outer join). The aggregate under the contacts subgrid counted **31 — every contact in the organisation** — while the subgrid showed one account's. `filtering.canDisableRelationshipFilter` sitting beside `getFilter` names the filter the platform keeps to itself. 0.0.3 resolves the lookup column itself (`data/parent.ts`): the `parentLookup` input, else the table's `ManyToOneRelationships` to the form's table when there is one, else the one the loaded rows all point at the record through, else withheld with the candidates named. Quick-find on the main grid: not yet typed, still unmeasured. |
| P3 | The aggregate over a Choice on the main grid: status, elapsed, and the first rows' exact keys — is `g` the integer, is `g@OData.Community.Display.V1.FormattedValue` the label, is `n` a number, is the blank group a row with no `g` (as FetchXML omits nulls) or with `g: null`? | `query/rows.ts` reads all four leniently; the rig omits `g` | **Measured.** 200, the link-entity kept without its attribute accepted. Rows exactly as the rig models: `n` a number with `n@…FormattedValue` "59" and `n@…AttributeName` "accountid" beside it; `g` the **integer** with `g@…FormattedValue` "Accounting"; **the blank group a row with no `g` at all** (59 accounts with no industry). Elapsed not logged. |
| P4 | `retrieveRecord('savedquery', <viewId>, '?$select=fetchxml')`: status, and the `fetchxml` text — does a system view's definition carry `<order>`, `<link-entity>` with attributes, and `<filter>` the way the fixture's does? For a **personal** view: does `getViewId()` give its id, and does `userquery` answer it? | `stripView()`; whether the two-table fallback is needed | **Measured.** `savedquery` answered the system view; the FetchXML carries `savedqueryid` on `<fetch>`, attributes interleaved with a `<link-entity … visible="false">` holding an attribute, and — for *All Accounts* and *All Contacts* — **no `<filter>` at all**. `stripView()` handled all of it. A personal view: not tried. |
| P5 | The aggregate with `dategrouping='month'` and `'year'` on `createdon`: is `g` the month number (1–12) or a string, is there a formatted value, and is `y` the year — and for `'week'`, which week does 4 January 2026 (a Sunday) fall in? | `keyFromBucket()`; `weekOfYear()`'s Sunday-start rule; whether a date label can be taken from the annotation | Not yet measured — needs a date category on the form (0.0.3 walkthrough W2). |
| P6 | The aggregate with `aggregate='sum'` on `revenue` (Money): is `v` a number, is there a `v@…FormattedValue` with the currency symbol, and does a group whose only value is blank carry `v` at all? Also `avg` on the same column: its precision | `numberFormatter()` vs the annotation; the rig omits `v` for an all-blank group | Not yet measured — needs *Aggregate* = sum on the form (0.0.3 walkthrough W1). |
| P7 | The refusal shape for an aggregate that cannot run — `groupby` on a multi-select choice column, or `sum` on a text column: `errorCode`, `message`, `title` | `messageOf()`; the rig's `webApiFault(2147164195, …)` stand-in for the record-limit refusal, which the test environment cannot reach | Not measured. |
| P8 | `getValue()` for the bound Choice on a dataset record: integer or string; for a Lookup: the `EntityReference` shape; for a date: ISO string. `columns[].dataType` for each | `readingOf()` — measured before on `pcf-data-table` (integer, `{ id: { guid }, etn, name }`); confirmed here on a property-set column | **Measured, with a surprise.** A Choice's `getValue()` came back as the **string** `"1"` on the subgrid (`getFormattedValue` "Default Value"), `null` where blank on the main grid; a Currency as a number (100000). And **the role column need not be in the view**: `customersizecode` was not among *All Contacts*' attributes, arrived on the dataset with `order: -1, visualSizeFactor: -1`, and `getValue` answered it — the platform adds a property-set column to the query. The docs said the opposite and were corrected. |
| P9 | On the subgrid, after editing a contact's Choice in its own form and returning: does the dataset fire `updateView` with `loading` true→false, so `refreshToken` bumps and the aggregate re-runs? | the re-aggregate trigger | Not yet measured (0.0.3 walkthrough W4). |

## The 0.0.3 walkthrough — questions for the form

0.0.3 is 0.0.2 with the subgrid route (P2) and `PROBE` still on. Mount it
on the contacts subgrid and the accounts main grid again, and:

| # | Do | Expect | Answer |
| --- | --- | --- | --- |
| W1 | Main grid, *Group by* = Industry, *Value* = Annual Revenue, *Aggregate* = Sum | The console's `P3 aggregate rows` carry `v` as a number; is there a `v@…FormattedValue` with the currency symbol; does the blank-revenue group carry `v`? (P6) | **Measured.** `v` a number with `v@…FormattedValue` "$480,000.00" — the currency symbol is on the annotation, so the server route could take its number formatting from there; 0.1.0 still formats through `formatting` for both routes to agree. The blank-industry group carried revenue (480,000 across 59 accounts), so a group with *no* revenue is still unmeasured. |
| W2 | Main grid, *Group by* = Created On, *Date grouping* = Month, then Week | `g` is the month number and `y` the year; for week, which week 4 Jan 2026 falls in (P5). The chart draws *Jan 2026*… in order | **Measured — the chart was right and two defects showed.** The months were chronological across years (Feb 2022, Jun 2023, Feb 2024, Mar 2024, Feb 2025, Mar 2025, Apr 2025, Sep 2025) and weeks the same (W6, W24, W7, W12…), so `g` is the bucket number and `y` the year. But **the labels cut to `Feb…` three times over** — the full form has no room at ~40 px a slot — and **the control was a third of the grid's width**: the main grid is a shrink-to-fit host, the root measured its own caption before the SVG existed (~380 px), and the SVG locked it. 0.0.4: `mode.trackContainerResize(true)` and `allocatedWidth` as the floor of the measured width; a short label form (`Feb '22`) for a narrow slot. Which week 4 Jan falls in: not read off the picture. |
| W3 | Contacts subgrid, *Parent lookup* blank | `P2 parent lookup` logs `by: "rows"` with candidates `parentcustomerid, accountid` (or `only-candidate`); the caption reads *All N records* with N the subgrid's own count, not 31 | **The subgrid was not related** (*Show related records* off), so the 31 was the subgrid's own count and P2's "wrong number" was the right number for that subgrid. Which leaves P2 proper — a *related* subgrid — still unmeasured, and shows the resolver needed a rule: rows that deny every candidate mean an unrelated subgrid and the whole view (0.0.4). The `P2 parent lookup` console line for this subgrid was not pasted. |
| W4 | Open a contact from the subgrid, change its Choice, save, go back | The chart re-aggregates (the caption's N or a bar changes) without a refresh (P9) | **Measured: works** — an edit in the contact's form re-aggregated the chart on return. |
| W5 | Contacts subgrid, *Parent lookup* = `accountid` (the read-only one) | The count may match W3 or not; either way no empty chart | "Nothing changed" with `parentcustomerid` set on the *unrelated* subgrid. Not explained yet: the explicit route should have narrowed the aggregate to the record's contacts. The `P2 parent lookup` and `P3 server route` console lines are what decides whether the input reached the control; asked for again on 0.0.4. |
| W6 | Main grid, type into the quick-find box | `P2 filtering.getFilter()` now shows the condition — which `conditionOperator` and `value`; the aggregate's `filterXml` carries it and the caption's N drops with it | **Measured: the quick-find is invisible too.** No new `getFilter()` payload, the chart unchanged. The grid narrows, the aggregate does not; 0.0.4's caption says both counts when `paging.totalResultCount` differs from the aggregate's. |
| W7 | A two-column section on the form (the chart in one column) | The legend below the chart, nothing cut | Asked what to bind. Nothing: the section's layout is the form designer's (two columns, the subgrid in one). Not yet done. |

## The 0.0.4 walkthrough

0.0.4 is 0.0.3 with the width floor, the short date labels, the unrelated-
subgrid rule and the two-count caption; `PROBE` still on.

| # | Do | Expect | Answer |
| --- | --- | --- | --- |
| X1 | Main grid, *Group by* = Created On, Month | The chart fills the grid's width; labels read *Feb '22* or *Feb 2022*, never *Feb…* | **Measured: fixed.** The chart fills the main grid and the labels read *Feb 2022*, *Jun 2022*… whole. |
| X2 | Contacts subgrid **with *Show related records* on**, *Parent lookup* blank | Console `P2 parent lookup`: `by: "rows"` or `"only-candidate"`, `candidates` listing `parentcustomerid` (and `accountid`); caption *All N records* with N the subgrid's count. **Paste the P2 and P3 lines** | **Measured — P2 proper, and the relationship is invisible on a related subgrid too:** `getFilter()` `null`, `getLinkedEntities()` `[]`. The resolver: `{ column: "parentcustomerid", by: "rows", candidates: ["msa_managingpartnerid", "parentcustomerid"] }` — `accountid` is not among the `ManyToOneRelationships` to account, `msa_managingpartnerid` is — and the query carried `<condition attribute='parentcustomerid' operator='eq' value='8be84297-…'/>` beside the view's `statecode eq 0`; two groups back, one contact each. Also read: `filtering.aliasMap` maps the roles to their columns (`categoryField: cll_pricecondition`, `valueField: creditlimit`) beside every view column, and `_capabilities` is `{ hasRecordNavigation: true }`. |
| X3 | The same subgrid, *Parent lookup* = `parentcustomerid` | `by: "explicit"`, the same N | **Measured:** `by: "explicit"`, the same query and rows. |
| X4 | The unrelated subgrid again (*Show related records* off), *Parent lookup* blank | `by: "unrelated"`, caption *All 31 records* | **Measured: `by: "unresolved"`, not `"unrelated"`** — `parentcustomerid` denied by the rows, `msa_managingpartnerid` not in the view so the rows could not speak for it. Withheld; the caption read *All 21 records* because the page held all 21 of *Active Contacts*. Honest, but a maker with an unrelated subgrid had no way to say so — 0.0.5 adds `none` as the *Parent lookup*. |
| X5 | Main grid, type in the quick-find, Enter | Caption *All 60 records in the view · the grid shows N* | **Measured:** *All 60 records in the view · the grid shows 0* with "yu" typed (no match). |
| X6 | Main grid, *Group by* = Created On, Week | Which week 4 Jan 2026 (a Sunday) falls in, from the label of a record created that week — or any record whose day you know (P5) | **Measured:** weeks chronological across years (W6 2022, W24 2022, W7 2023, W12 2023, W13 2023, W6 2025, W14 2026 …). Which week 4 Jan falls in: still not read. |
| X7 | A section set to two columns in the form designer, the subgrid in one | The legend under the chart, nothing cut | **Measured: the legend under the chart, nothing cut — and a defect: the chart grew with the window and never shrank.** The SVG in the flow with a `width` attribute propped the root open at its widest. 0.0.5 takes the SVG out of the flow (absolute, inside a plot box); the root then follows the host down (868 → 468 in the preview). Whether the platform lowers `allocatedWidth` on a shrink is Y1. |

## The 0.0.5 walkthrough

0.0.5 is 0.0.4 with the SVG out of the flow, `none` as a *Parent lookup*,
and `P10 allocatedWidth` logged; `PROBE` still on. **The last probe before
0.1.0.**

| # | Do | Expect | Answer |
| --- | --- | --- | --- |
| Y1 | The form with the chart in a two-column section, and the main grid: widen the window, then narrow it | The chart follows both ways. Console `P10 allocatedWidth`: whether the number goes **down** when the window narrows | |
| Y2 | The unrelated subgrid (*Show related records* off), *Parent lookup* = `none` | `by: "unrelated"`, caption *All 21 records* (the view's count) | |

## Platform behaviour worth knowing

- **The main grid is a shrink-to-fit host.** Measured (W2): the control was
  ~380 px of a ~1050 px grid because the root measured its own caption
  before the SVG existed and the SVG locked it. `mode.allocatedWidth`
  (after `trackContainerResize(true)`) is the floor. A form section is a
  block parent and measures true.
- **The grid's quick-find is invisible** to the control (W6): `getFilter()`
  unchanged, the rows narrowed. `paging.totalResultCount` is the grid's
  count and the caption compares it with the aggregate's.
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
