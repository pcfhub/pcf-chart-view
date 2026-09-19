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

The 0.0.x builds are probes: `PROBE = true` in `index.ts` logs the answers
to the questions below under `[ChartView probe]`, once per distinct payload,
and the component logs the query it sent and the first five rows it got
back. **Tag 0.1.0 only after the answers**; each row names what it decides.

**Environment:** the Accounts form on `cll365`, the Contacts subgrid on
*City Power & Light (sample)* bound to *Group by* = a Choice on contact
(e.g. `preferredcontactmethodcode`), and the Accounts **main grid** on
*Active Accounts* bound to *Group by* = `industrycode`, *Value* = `revenue`.

| # | Question | Decides | Answer |
| --- | --- | --- | --- |
| P1 | `Object.keys(dataset)`, `paging`, `filtering`, `linking` on a **subgrid** and on a **main grid**; `getViewId()` on each; `mode.contextInfo` on the subgrid | whether the surface differs between the two hosts; `linking` as a source of the relationship | |
| P2 | `filtering.getFilter()` on the **subgrid** before the user does anything: does it carry the relationship to the parent record (a condition on `parentcustomerid` / `_value`)? And on the main grid after typing into the quick-find box: what `conditionOperator` and `value`? | **the whole subgrid case.** If the relationship is in `getFilter()`, the server route already appends it. If not, the server route on a subgrid aggregates the *view* — every contact, not this account's — and 0.1.0 must withhold it when `contextInfo.entityId` is set and no condition names the parent. `linking.getLinkedEntities()` is the other place to look | |
| P3 | The aggregate over a Choice on the main grid: status, elapsed, and the first rows' exact keys — is `g` the integer, is `g@OData.Community.Display.V1.FormattedValue` the label, is `n` a number, is the blank group a row with no `g` (as FetchXML omits nulls) or with `g: null`? | `query/rows.ts` reads all four leniently; the rig omits `g` | |
| P4 | `retrieveRecord('savedquery', <viewId>, '?$select=fetchxml')`: status, and the `fetchxml` text — does a system view's definition carry `<order>`, `<link-entity>` with attributes, and `<filter>` the way the fixture's does? For a **personal** view: does `getViewId()` give its id, and does `userquery` answer it? | `stripView()`; whether the two-table fallback is needed | |
| P5 | The aggregate with `dategrouping='month'` and `'year'` on `createdon`: is `g` the month number (1–12) or a string, is there a formatted value, and is `y` the year — and for `'week'`, which week does 4 January 2026 (a Sunday) fall in? | `keyFromBucket()`; `weekOfYear()`'s Sunday-start rule; whether a date label can be taken from the annotation | |
| P6 | The aggregate with `aggregate='sum'` on `revenue` (Money): is `v` a number, is there a `v@…FormattedValue` with the currency symbol, and does a group whose only value is blank carry `v` at all? Also `avg` on the same column: its precision | `numberFormatter()` vs the annotation; the rig omits `v` for an all-blank group | |
| P7 | The refusal shape for an aggregate that cannot run — `groupby` on a multi-select choice column, or `sum` on a text column: `errorCode`, `message`, `title` | `messageOf()`; the rig's `webApiFault(2147164195, …)` stand-in for the record-limit refusal, which the test environment cannot reach | |
| P8 | `getValue()` for the bound Choice on a dataset record: integer or string; for a Lookup: the `EntityReference` shape; for a date: ISO string. `columns[].dataType` for each | `readingOf()` — measured before on `pcf-data-table` (integer, `{ id: { guid }, etn, name }`); confirmed here on a property-set column | |
| P9 | On the subgrid, after editing a contact's Choice in its own form and returning: does the dataset fire `updateView` with `loading` true→false, so `refreshToken` bumps and the aggregate re-runs? | the re-aggregate trigger | |

## Platform behaviour worth knowing

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

- Everything under *The 0.0.1 probe*, until the answers are in. The biggest
  single unknown is **P2**: whether a subgrid's relationship to its parent is
  visible to the control at all. If it is not, 0.1.0 withholds the server
  route on a subgrid, and the chart on a form is the loaded page.
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
