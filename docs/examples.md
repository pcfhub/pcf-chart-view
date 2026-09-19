---
title: Examples
description: Worked configurations of Chart View.
order: 6
---

# Examples

## Open cases by priority, on the account form

The account's cases as a donut, so the priorities' shares are visible at a
glance.

| Property | Value |
| --- | --- |
| Subgrid | Cases, view *Active Cases* |
| Group by | Priority (Choice) |
| Value | *(empty — count)* |
| Chart type | Donut |
| Labels | Auto (percentages) |
| Legend | Auto (shown) |

The slices take the priority options' own colours. The caption reads *Number
of records · All 14 records* — the server counted every case the view
matches for this account, not the page.

## Pipeline by owner

Open opportunities' estimated revenue, summed per owner, as horizontal bars
with the value written beside each.

| Property | Value |
| --- | --- |
| Subgrid / grid | Opportunities, view *Open Opportunities* |
| Group by | Owner (Lookup) |
| Value | Est. Revenue (Currency) |
| Aggregate | Sum |
| Chart type | Bar |
| Sort by | Value |
| Top groups | 8 |

Bars are the shape for names: a label reads better beside a bar than under a
column. The ninth owner onwards are folded into *Other*. Values are written
in the user's currency format; the axis ticks are compact (`1.5M`).

## New accounts per month

A line over the last year, bucketed by the month each account was created.

| Property | Value |
| --- | --- |
| Grid | Accounts, view *Accounts created this year* |
| Group by | Created On (Date and Time) |
| Date grouping | Month |
| Chart type | Line |

Months are drawn in date order, labelled *Jan 2026*, *Feb 2026*… in the
user's language. Two years in the view give two Januaries, not one.

::image{src=media/screenshot-line.png alt="Records created per month, as a line" zoom}

## A canvas dashboard tile

On a canvas screen, with a gallery beside it filtered by what was clicked.

| Property | Value |
| --- | --- |
| Items | `Filter(Accounts, 'Status' = 'Active')` |
| Group by | Industry |
| Chart type | Column |
| Title | `"Accounts by industry"` |
| Height | `240` |

```powerfx
// Gallery1.Items
Filter(Accounts, IsBlank(ChartView1.SelectedKey) || Text(Industry) = ChartView1.SelectedLabel)
```

The caption reads *All 214 records* while the whole table fits in the app's
data row limit, and *The 500 records loaded so far* once it does not.
