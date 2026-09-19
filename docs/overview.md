---
title: Overview
description: What Chart View does, and when to reach for it.
order: 1
---

# Chart View

A Dataverse view as a chart: one bar, column, slice or point per distinct
value of a column you choose, counting the records in each group or adding
up a number column across them. Columns, bars, pie, donut or line, on a form,
a main grid or a canvas screen.

::image{src=media/screenshot-column.png alt="Active accounts counted by industry, as columns with the count on each" zoom}

::image{src=media/screenshot-pie.png alt="Annual revenue summed by industry, as a pie with a legend of values and shares" zoom}

## Why this one

A Dataverse chart lives on a dashboard or in a grid's chart pane; a form
section gets none, and a canvas screen gets none at all. This control puts
the chart where the view is — beside the record it belongs to, in the space
the subgrid would have taken — with two properties to configure: the column
to group by, and optionally the one to add up.

Three things it does that a chart pane does not:

- **Aggregates the whole view, not the page.** On a model-driven app the
  numbers come from one FetchXML aggregate over every record the view
  matches — the view's own filter, its linked tables, and whatever the user
  has narrowed it to — so a chart of ten thousand records loads six
  numbers. The caption under the title says which it is: *All 4,120
  records*, or *The 50 records loaded so far* where only the page is
  available.
- **Groups by what you have.** A Choice, a Yes/No, a Lookup (by owner, by
  account), a text column, or a date bucketed by day, week, month, quarter
  or year — with a Choice's own option colours on the chart when the
  environment has them.
- **Reports what was clicked.** Pressing a bar or a slice sets two outputs,
  the group's raw key and its label, which a canvas app filters a gallery
  on. Press it again to clear.

::image{src=media/screenshot-line.png alt="Records created per month, as a line" zoom}

## Where it runs

| Host | Numbers from | Option colours |
| --- | --- | --- |
| Model-driven form, main grid | The whole view, aggregated on the server | Yes |
| Canvas app, custom page | The records loaded into the dataset | No — the palette |

Everything is drawn as SVG inside the control: no chart library, no external
service, and the same 40 KB bundle on every host.
