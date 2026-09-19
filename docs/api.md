---
title: API reference
description: Properties and outputs, generated from the control manifest.
order: 5
---

# API reference

## Input properties

::props-table{kind=input}

## Dataset

::props-table{kind=dataset}

## Dataset columns

The two roles a maker binds. Found on the view by the role, read off each
record by the column it was bound to — both must be in the view.

::props-table{kind=dataset_column}

## Outputs

::props-table{kind=output}

## Reading the outputs

| Group by column | `selectedKey` | `selectedLabel` |
| --- | --- | --- |
| Choice | The option's number, as text: `"3"` | The option's label |
| Yes/No | `"1"` or `"0"` | The option's label |
| Lookup | The record's GUID, lower-case, no braces | The record's name |
| Text | The text | The text |
| Date | The bucket: `2026`, `2026-Q1`, `2026-03`, `2026-W12`, `2026-03-14` | *Mar 2026*, *Q1 2026*, *W12 2026*, the short date |
| The blank group | `""` — indistinguishable from *nothing selected* by key; read the label, *(blank)* | The blank label |

Both are the empty string when nothing is selected. *Other* — the bucket
**Top groups** folds the tail into — cannot be selected: it stands for
several groups, and a key for it would name none of them.
