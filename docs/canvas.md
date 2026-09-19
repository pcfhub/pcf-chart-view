---
title: Canvas apps
description: Adding Chart View to a canvas app or custom page.
order: 3
---

# Canvas apps

The chart runs in a canvas app and a custom page with one difference from a
form: **the numbers are the records the dataset has loaded**, not the whole
view. A canvas app has no Web API for a code component to send an aggregate
through, so the control groups what `Items` handed it and its caption says
*The N records loaded so far* whenever the source has more.

:::steps
1. Turn on **Code components** for the app (*Settings* → *Updates* → *Code
   components*), then **Insert** → **Get more components** → *Code* →
   **Chart View**.
2. Set **Items** to the table or a filtered collection —
   `Filter(Accounts, 'Status Reason' = 'Active')`.
3. In the **Fields** flyout, map **Group by** and, optionally, **Value** to
   columns.
4. Read `ChartView1.SelectedKey` and `SelectedLabel` where you want to react
   to a click.
:::

## Getting all the records

`Items` delegates the filter to Dataverse and loads the first page — the
app's data row limit, 500 by default and 2,000 at most. For a table larger
than that, either pre-aggregate in a collection the chart can count
completely, or accept the caption's *loaded so far* as the honest number.

## Filtering a gallery from the chart

Pressing a bar or a slice sets **SelectedKey** to the group's raw value and
**SelectedLabel** to what the chart showed; pressing it again clears both to
`""`. A gallery beside the chart filters on it:

```powerfx
Filter(
    Accounts,
    IsBlank(ChartView1.SelectedKey) || Text(Industry) = ChartView1.SelectedLabel
)
```

For a Choice column the key is the option's **number** as text (`"3"`) and
the label its name, so compare the label for a readable formula and the key
where two options share a name.

## What differs from a form

- **No option colours.** A canvas app publishes no column metadata, so a
  Choice's option colours are not read; the chart uses its palette.
- **A date is bucketed by the user's zone** where the app reports one, and
  by the device's otherwise.
- **Height** is the control's own; set it in the property pane like any
  other control's.
