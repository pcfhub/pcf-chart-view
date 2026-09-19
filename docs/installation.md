---
title: Installation
description: Import the solution and make the control available.
order: 2
---

# Installation

:::steps
1. Download the **managed** solution for your environment.
2. In the Power Platform admin centre, import the solution.
3. Publish all customizations.
4. Enable **Code components for canvas apps** if this control is used there.
:::

:::callout{type=warning}
Import the managed solution into production. The unmanaged one is for a
development environment where you intend to change the control itself — it
cannot be cleanly uninstalled.
:::

## Requirements

- A Dataverse environment. The chart binds a view, so there is nothing to
  show without one.
- A column to group by — a Choice, Yes/No, Lookup, text or date column on
  the table. A numeric column to add up is optional; without one the chart
  counts records.
- For canvas apps and custom pages, the environment feature **Power Apps
  component framework for canvas apps** must be on: *Admin centre* →
  *Environments* → *Settings* → *Product* → *Features*. It is already on for
  model-driven apps.

## The permission prompts

Importing the solution asks the maker to consent to two things, and the
control works without either:

- **Web API.** The server route: the view's definition is read from
  `savedquery` (or `userquery`, for a personal view) and one aggregate
  FetchXML query is sent for the whole view. It runs as the signed-in user and
  reads only what that user can read. Declined, the chart groups the records
  the dataset has loaded and its caption says so.
- **Utility.** Reading the group-by column's metadata through
  `getEntityMetadata`: a Choice's option colours and option order, and the
  table's primary key. Declined, the chart uses its own palette and the
  option values' own order.

Nothing else is requested — no device access and no external services. The
control makes no request that leaves the organisation.
