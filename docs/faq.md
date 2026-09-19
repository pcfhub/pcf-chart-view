---
title: FAQ
description: Questions that come up more than once.
order: 8
---

# FAQ

## The caption says "loaded so far" on a form. Why not the whole view?

The server route needs three things: the **Web API** feature accepted at
install, a view whose definition can be read (`savedquery` for a system
view, `userquery` for a personal one the user owns), and a runtime filter the
control can spell in FetchXML. Missing any of them, the control groups the
loaded page rather than guess. Open the browser console: the control logs one
warning naming which.

## On a subgrid the caption says "loaded so far" and the console names candidates.

The table has more than one lookup to the form's table and none of them is
in the view for the loaded rows to confirm. Set **Parent lookup** to the
column the subgrid relates by — for contacts under an account,
`parentcustomerid`.

## The caption says the server could not aggregate this view.

The aggregate was sent and refused. The usual reasons: the view matches more
than **50,000 records**, the server's ceiling on an aggregate; the group-by
column is one FetchXML cannot group (a multi-select choice, a file); or a
linked table in the view's definition the user cannot read. The console
warning carries the server's own message.

## Can I group by two columns, or show two values?

No — one group-by and one measure, by design. See *Limitations*.

## The numbers do not match the grid under the chart.

Three things to check. The **view**: the chart aggregates the view the
subgrid is bound to, so a quick-find typed into the grid is applied, but a
filter set in a *different* view is not. The **blank group**: records with
no value in the group-by column are a group of their own, *(blank)*, which
the grid shows as empty cells. The **page**: if the caption says *loaded so
far*, the chart is the page and the grid's total is the view.

## How do I filter the subgrid by clicking a slice?

You cannot, from this control — see *Limitations*. On a canvas screen, put
a gallery beside the chart and filter it on `SelectedKey` / `SelectedLabel`.

## My Choice colours are not showing.

The colours come from the option set's metadata, read through the
**Utility** feature. Check that the prompt was accepted at import, that the
options actually have colours set in the table designer, and that the
chart is on a model-driven app — a canvas app publishes no metadata.

## Why is a month labelled a day early / late for some users?

It is not the month of the *instant*; it is the month in the **user's** time
zone, as set in their personal options — the same calendar the grid's own
dates are shown in. A User Local column stamped at 02:00 UTC on 1 March is
February for a user at UTC−5, on the chart and in the grid alike.

## Does it work on the phone?

Yes. Under about 420 px the legend moves below the chart, and every bar,
slice and legend row is a button. Not yet verified on the phone client
itself — see the repository's `SPEC.md`.
