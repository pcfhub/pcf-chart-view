---
title: Limitations
description: What Chart View does not do, and why each is a decision.
order: 7
---

# Limitations

Each of these was chosen, not left.

- **One series.** The chart groups by one column and shows one number per
  group. There is no second group-by for stacked or clustered bars, and no
  second value for two lines on one axis. A chart with two dimensions is a
  different control, and this one's two roles are the reason it takes a
  minute to configure.

- **The server aggregates at most 50,000 records.** Dataverse's own ceiling
  on an aggregate query (`AggregateQueryRecordLimit`). A view above it makes
  the server decline, and the control falls back to the records the dataset
  has loaded with the caption saying so. Narrow the view, or accept the
  loaded page as the number.

- **Canvas apps chart the loaded records.** A canvas app offers a code
  component no Web API, so there is no route to the server's aggregate. The
  caption reads *loaded so far* whenever the source has more rows than the
  dataset holds.

- **On a subgrid the relationship is inferred, not read.** The platform does
  not expose a subgrid's relationship to a code component (measured:
  `getFilter()` is null, `getLinkedEntities()` is empty), so the control
  finds the lookup column itself — from the table's relationships, the
  loaded rows, or the **Parent lookup** property — and withholds the server
  route when it cannot. See *Model-driven apps → On a subgrid*.

- **A blank *Value* counts, whatever *Aggregate* says.** *Sum* of nothing is
  not a chart. Rather than draw nothing, the control counts records and the
  caption says *Number of records*.

- **A date category is always chronological, and never folded.** *Sort by*
  and *Top groups* are ignored for a date. A chart by month drawn
  largest-first, or with an *Other* bucket of the quiet months, is not a
  chart by month.

- **A week is the server's week.** Dataverse's `dategrouping='week'`
  numbers weeks from the first of January with Sunday as the first day —
  not ISO 8601, whose week 1 holds the first Thursday. The browser route
  follows the same rule so both agree; a week number here will not match a
  spreadsheet's `ISOWEEKNUM`.

- **Percentages are of the drawn total.** For a count or a sum that is the
  whole; for an average, minimum or maximum it is the sum of the groups'
  values, which is what a pie of averages shows and is not a share of
  anything. Prefer bars for those three.

- **Clicking a group changes nothing but the outputs.** The subgrid under the
  chart is not filtered by a click — a dataset control can filter its own
  dataset, but this control *is* the dataset's only reader, and filtering
  the view would change the chart itself. The outputs are for a canvas
  formula or a form script.

- **A Choice's option colours need Utility.** They come from
  `getEntityMetadata`, so a host without it — canvas, or an environment that
  declined the prompt — gets the palette. The palette has ten colours; an
  eleventh group repeats the first.

- **Long category labels are cut.** A column label wider than its slot is
  shortened with an ellipsis and the full text is in the bar's tooltip and
  accessible name. Switch to *Bar* for long labels: they run beside the bar
  with a third of the width to themselves.

- **The hub's demo runs the browser route.** The harness has no Web API and
  no metadata, so the demo groups its fixture in the browser and colours it
  from the palette — the canvas experience. The server route is on the
  form.
