# Chart View

A Dataverse view as a bar, column, pie, donut or line chart — grouped by a column, aggregated on the server.

[![Build](https://github.com/pcfhub/pcf-chart-view/actions/workflows/build.yml/badge.svg)](https://github.com/pcfhub/pcf-chart-view/actions/workflows/build.yml)
[![Release](https://github.com/pcfhub/pcf-chart-view/actions/workflows/release.yml/badge.svg)](https://github.com/pcfhub/pcf-chart-view/actions/workflows/release.yml)

Documentation lives on [PCFHub](https://pcfhub.dev/components/pcf-chart-view), built
from the `docs/` directory in this repository. Edit the Markdown here; the hub
recompiles it.

## What it does

A view's records, grouped by one column and drawn as columns, bars, a pie,
a donut or a line — one mark per distinct value, counting the records in
each group or summing, averaging or ranging a number column across them.
Dataverse's own charts live on dashboards and in a grid's chart pane; this
one sits where the view is, on a form beside its record or on a canvas
screen, and takes two bindings to configure.

**The numbers are the view's, not the page's.** On a model-driven app the
control reads the view's own FetchXML from the saved query it is bound to,
strips the columns and the sort, adds a `groupby` and an aggregate, appends
whatever the user has filtered the grid to, and sends one `aggregate='true'`
query through the Web API — so a chart of ten thousand records loads six
numbers. Where that route is not available (a canvas app, a declined Web
API prompt, a view whose definition cannot be read, a server refusal) the
control groups the records the dataset has loaded instead, and **the caption
under the title always says which**: *All 4,120 records* or *The 50 records
loaded so far*. A number is never shown as the whole when it is not.

**Grouped by what you have.** A Choice — with its option colours, read from
metadata — a Yes/No, a Lookup, a text column, or a date bucketed by day,
week, month, quarter or year in the user's own time zone, on the server and
in the browser alike. Everything is SVG drawn by the control: no chart
library, no external service, a 40 KB bundle.

Clicking a bar, slice or legend row sets two outputs — the group's raw key
and its label — for a canvas gallery to filter on; nothing on a form reacts,
by design. See `docs/limitations.md` for the rest of what it does not do.

## Properties

| Role | Bind it to | Required |
| --- | --- | --- |
| `categoryField` — Group by | Choice, Yes/No, Lookup (Simple or Owner), text, Date Only or Date and Time | **Yes** |
| `valueField` — Value | Whole number, Decimal, Float or Currency | No — empty counts records |

| Property | Type | Default | What it controls |
| --- | --- | --- | --- |
| `chartType` | Enum `column` \| `bar` \| `pie` \| `donut` \| `line` | `column` | The shape |
| `aggregate` | Enum `count` \| `sum` \| `avg` \| `min` \| `max` | `count` | What each group shows; the four measures need a Value column, otherwise the chart counts |
| `dateGrouping` | Enum `day` \| `week` \| `month` \| `quarter` \| `year` | `month` | The bucket, when Group by is a date |
| `topN` | Whole.None | — | Keep this many largest groups; fold the rest into *Other*. Ignored for a date |
| `sortBy` | Enum `value` \| `label` | `value` | Largest first, or the category's own order. A date is always chronological |
| `labels` | Enum `auto` \| `value` \| `percent` \| `none` | `auto` | What is written on each mark: values on bars, percentages on a pie |
| `legend` | Enum `auto` \| `show` \| `hide` | `auto` | A legend on a pie or donut only, or always, or never |
| `title` | SingleLine.Text | — | The heading; empty uses the view's name |
| `height` | Whole.None | — (280) | The chart's height in px; the width is the container's |
| `selectedKey` | SingleLine.Text, output | | The clicked group's raw value — a Choice's number, a Lookup's GUID, the text, a date bucket such as `2026-03`; `""` when none |
| `selectedLabel` | SingleLine.Text, output | | The clicked group's label; `""` when none |

React (virtual) on the platform's React and Fluent — nothing bundled. Five
languages ship (en, de, fr, ja, es). Two `uses-feature` prompts at install,
both `required="false"`: **WebAPI** for the server route and **Utility** for a
Choice's option colours; declined, the control degrades to the browser route
and the palette rather than refusing to load.

## On the hub

`demo.fidelity` is **limited**: the hub's harness has no Web API, so the demo
is the browser route over the fixture — the canvas experience — and no
metadata, so the palette stands in for a Choice's option colours. The
limitations block says both. Four presets: a count by industry as columns,
revenue summed as a pie with a legend, the top three as a donut with *Other*,
and horizontal bars in the category's own order.

## Install

Download the managed solution from the
[latest release](https://github.com/pcfhub/pcf-chart-view/releases/latest), or from
the component's page on the hub, and import it into your environment.

## Develop

```bash
npm install
npm start          # the PCF test harness
npm run build
npm run lint
npm run check      # what CI runs first: placeholders, pcfhub.json, control shape
npm run smoke      # assertions against the built bundle — see dev/
npm run harness    # serves dev/harness.html and opens it
```

`npm start` renders the control; `dev/` is for the states it cannot reach. Build
first, then `npm run smoke` for the assertions, or `npm run harness` for the
switches — field-level security, a failed business rule, a host that publishes
no theme or no column metadata, and for a dataset control, more than one page.
Both read the bundle `npm run build` wrote, and both are described in the header
of `dev/smoke.js`.

`npm run harness` serves the repository over `http://` rather than leaving you to
open the file: over `file://` a dataset fixture cannot be fetched and a module
script is refused, and both arrive as an empty control with a CORS error. It
takes `--port` and `--no-open`, and needs no dependency — `dev/serve.js` is
`node:http`. A React (virtual) control gets one too: `dev/fluent-stub.js` stands
in for the Fluent the platform would supply, and its header says exactly where
the stand-in is less capable than the real thing.

Run `npm run refreshTypes` after every manifest edit — until you do,
`context.parameters` is typed from the old manifest and `tsc` will accept code that
cannot work.

To pack the solution locally you need msbuild — either Visual Studio or the
Visual Studio Build Tools:

```bash
cd Solution
msbuild /t:build /restore /p:configuration=Release
```

Both zips land in `Solution/bin/Release`. This is the only local step that compiles
in **production** mode, so a green `npm run build` is not evidence the shipping
bundle compiles — and the pack is incremental, so delete `obj/`, `out/`,
`Solution/obj/` and `Solution/bin/` first if you intend to quote a bundle size from
it.

## Release

1. Bump the version in **three** places, in one commit — they are checked
   against each other in CI:
   - `ChartView/ControlManifest.Input.xml` → `<control version="…">`
   - `Solution/src/Other/Solution.xml` → `<Version>`
   - `package.json` → `"version"`
2. Write the release notes — what changed for the user, what was fixed, what
   they must do — in a Markdown file.
3. Tag with them: `git tag -a --cleanup=verbatim v1.2.3 -F notes.md && git push origin v1.2.3` — without `--cleanup=verbatim`, git drops every `## Heading` in the notes as a comment, silently

**The tag message is the release body, and the release body is the changelog
on the hub.** A lightweight tag gets GitHub's generated notes instead, which
for a repository without pull requests is a single compare link — and the
workflow warns when that is about to happen.

The release workflow builds, packs both solution types, and attaches them to a
GitHub Release. PCFHub picks the release up from its webhook within seconds, or
from the hourly sweep otherwise. A sync imports a draft; a person publishes it.

## Repository layout

| Path | What it is |
| --- | --- |
| `ChartView/` | The control: manifest, entry point, CSS, localised strings |
| `Solution/` | The Dataverse solution that packages it |
| `dev/` | A stand-in host: `npm run smoke` asserts, `harness.html` shows |
| `SPEC.md` | What building this corrected, and what is verified versus read |
| `docs/` | The pages PCFHub publishes — see the comments in each file |
| `media/` | Images and video referenced from the docs |
| `pcfhub.json` | The hub's manifest: identity, links, docs path, demo |
| `scripts/` | Template setup and the CI guard that keeps it adopted |

## Licence

[MIT](LICENSE)
