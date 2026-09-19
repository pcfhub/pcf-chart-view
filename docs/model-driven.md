---
title: Model-driven apps
description: Adding Chart View to a form or a main grid.
order: 4
---

# Model-driven apps

This is the host the control was built for: the whole view is aggregated on
the server, a Choice's option colours are read, and a date is bucketed the
way the platform's own grouping buckets it.

:::steps
1. Open the form in the form designer and add a **subgrid** for the table
   you want to chart, choosing the view whose records it should count — or
   open the table's **Controls** to put the chart on its main grid.
2. With the subgrid selected, open **Components** → **Get more components**
   and add **Chart View**, then switch the control to it for Web, Tablet and
   Phone.
3. Bind **Group by** to the column whose values become the bars or slices.
   Bind **Value** to a numeric column if the chart should add it up; leave it
   empty to count records.
4. Choose the **Chart type** and, for a number column, the **Aggregate**.
   Save and publish.
:::

## Binding the column roles

| Role | Bind it to | Required |
| --- | --- | --- |
| Group by | A Choice, Yes/No, Lookup, text or date column. One bar, slice or point per distinct value. | Yes |
| Value | A whole number, decimal, float or currency column. What *Sum*, *Average*, *Minimum* and *Maximum* work on. | No |

:::callout{type=warning}
**Both columns must be in the view.** The roles are read through the
dataset, so a role bound to a column the view does not select arrives empty
— the browser route then charts one blank group, and the server route
aggregates the column it was told, which is the number you wanted but only
on one of the two routes. Add the column to the view.
:::

## Where the numbers come from

On a form or a main grid the control sends **one aggregate query** for the
whole view, and the caption under the title reads *All N records*:

1. The view's own FetchXML is read from the saved query the subgrid is bound
   to, with its filters and linked tables kept and its columns and sort
   removed.
2. The group-by column is added as a `groupby` attribute — with a
   `dategrouping` for a date — and the value column as a `sum`, `avg`,
   `min` or `max`, beside a `count` of the records in each group.
3. Whatever the user has narrowed the view to since it loaded — a column
   filter, the quick-find box — is appended as a filter, so the chart agrees
   with the rows under it.

The query runs as the signed-in user through the Web API, subject to their
privileges, and the server's own ceiling of **50,000 records per aggregate**.
Where the server declines — the ceiling, a column that cannot be grouped, a
view whose definition cannot be read — the control falls back to grouping
the records the dataset has loaded, and the caption says *The N records
loaded so far* or *The server could not aggregate this view*, so a number
is never shown as the whole when it is not.

## A chart by month

Bind **Group by** to a date column and choose the **Date grouping**: day,
week, month, quarter or year. The server buckets by its `dategrouping`,
which follows the **user's** time zone — the same calendar the grid's own
dates are shown in — and the groups are drawn in date order whatever
**Sort by** says, with a *Top groups* setting ignored, because a chart by
month with an *Other* bucket is not a chart by month.

A month label reads *Mar 2026* in the user's language; a week is *W12 2026*,
a quarter *Q1 2026*, a day the user's short date.

## Colours

For a **Choice** column the chart uses each option's own colour, as set on
the option set in the table designer — so *Active* is the green the rest of
the app shows it in. Options with no colour, and every other column type,
take a ten-colour palette in the order the groups are drawn; the blank group
and *Other* are neutral grey.

## Clicking a group

A bar, slice, point or legend row is a button. Pressing one sets the two
outputs — **Selected key** (the raw value: a Choice's number, a Lookup's
GUID, the text, or a date bucket such as `2026-03`) and **Selected label**
— and mutes the other groups. Pressing it again clears both. On a form the
outputs are there for a form script; nothing else on the form reacts to a
selection.

## Sizing

The chart fills the width it is given, measured as the section resizes, and
takes its **Height** from the property (280 px unset). A form section
allocates no height to a control, which is why the number has to come from
somewhere. Under about 420 px wide — a two-column section — the legend moves
from beside the chart to below it.
