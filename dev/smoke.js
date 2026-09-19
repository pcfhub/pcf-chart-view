/*
 * Drives the real built bundle outside a browser.
 *
 *     npm run build && npm run smoke
 *
 * What it does: installs the DOM and the platform globals, loads
 * `out/controls/ChartView/bundle.js` the way a form would, binds it to a
 * twelve-record view with three pages in it, and asserts what the control did —
 * both what it rendered and what it asked the platform for.
 *
 * Why it exists alongside `npm start` and `dev/harness.html`: half of what a
 * dataset control does is ask the platform for things, and a rendered table
 * shows none of it. Whether a sort *replaced* the order or appended to it,
 * whether a page turn asked for page two or for "one more page", whether a page
 * size change settles or loops — those are decisions, they are what regresses,
 * and here they are assertions with an exit code.
 *
 * Why no test framework: there is none in this repository, and adding one to
 * run a handful of assertions against a bundle would be a dependency, a config
 * file and a second build pipeline for something `node` already does. It also
 * runs the **built bundle** rather than the TypeScript sources, which is the
 * part worth checking. CI runs it after the msbuild pack, so there it drives
 * the production bundle.
 *
 * **What passing here does NOT mean.** Every record below is supplied by this
 * file. It cannot tell you that a real view hands over what this fixture hands
 * over, that server-side sorting sorts the same way, that `openDatasetItem`
 * opens anything, or that the control looks right. Keep those in SPEC.md under
 * "Not verified".
 *
 * **The quirks default to the platform's observed misbehaviour, not to its
 * documentation**, and that is load-bearing. See the header of `dev/host.js`:
 * a harness modelling the platform as written down passes a control that cannot
 * page on a real form.
 *
 * ---
 *
 * **The assertions below the divider are a worked example. Replace them.**
 * Everything above the divider is plumbing that works for any dataset control;
 * the examples exercise the scaffolded table and are meant to be thrown away
 * with it.
 */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const root = path.join(__dirname, '..');
const dom = require('./dom.js');
const host = require('./host.js');
const clock = require('./clock.js');
const fixture = require('./fixture.js');

const BUNDLE = path.join(root, 'out', 'controls', 'ChartView', 'bundle.js');

if (!fs.existsSync(BUNDLE)) {
    console.error('\n  No bundle at out/controls/ChartView. Run npm run build first.\n');
    process.exit(1);
}

/* ----------------------------------------------------------- the platform */

dom.install(global);

/*
 * Time, replaced with something the test drives.
 *
 * `vm.runInThisContext` below evaluates the bundle in *this* realm, so the
 * `Date`, `setInterval` and `setTimeout` the control closes over are the ones
 * installed here — no injectable clock parameter, and therefore no production
 * code bent to suit a harness.
 *
 * A dataset control is likelier to want a timer than a field control is: an
 * auto-refreshing view, a debounce around `dataset.refresh()`, a countdown in a
 * cell. A control with none is unaffected — nothing schedules and
 * `time.pending()` stays at zero — but the teardown assertion at the bottom of
 * this file is written against it either way.
 */
const time = clock.install(Date.UTC(2026, 0, 1, 12, 0, 0), global);

const registration = host.captureRegistration(global);

const source = fs.readFileSync(BUNDLE, 'utf8');

/*
 * The platform libraries, supplied under the names the bundle actually asks
 * for — read out of the bundle rather than written down here.
 *
 * A `<platform-library>` entry becomes a webpack external, and the global it
 * compiles to carries a version in its name. **That version is not the one the
 * manifest declares.** `pcf-scripts` maps a declared version onto the platform
 * build it supports, so Fluent `9.46.2` arrives as `FluentUIReactv940` and
 * React `16.14.0` as `Reactv16`. Hardcoding either is a trap that springs on
 * the next version bump, with a `ReferenceError` naming a global that appears
 * nowhere in the repository.
 *
 * A standard control has no externals at all, in which case both lists are
 * empty and nothing below runs.
 */
const reactGlobals = [...new Set(source.match(/\bReactv[\w]*\b/g) || [])];
const fluentGlobals = [...new Set(source.match(/\bFluentUIReact[\w]*\b/g) || [])];

let React = null;

if (reactGlobals.length > 0) {
    React = require(path.join(root, 'node_modules', 'react'));
    reactGlobals.forEach((name) => {
        global[name] = React;
    });
}

/*
 * Fluent is stubbed rather than loaded: every component resolves to its own
 * name as an element type, so the props the control passed survive for
 * inspection. These assertions are about the control's decisions, not about how
 * Fluent renders them — and Fluent 9 ships no UMD build to load anyway.
 */
/*
 * **A stand-in component per name, not the name as the element type.** React
 * lower-cases an unknown element, so `MenuItem` became `<menuitem>` — which
 * HTML treats as a void element, and `renderToStaticMarkup` throws rather
 * than give it children. Every capitalised export is therefore a function
 * component rendering a `<div data-fluent="Name">` with the string, number
 * and boolean props the control passed — className, aria-*, title, disabled
 * — so `renderDeep` can look for them; a lower-case export (`webLightTheme`,
 * `tokens`) is a plain object. Found by `pcf-calendar-view`, whose move menu
 * was the first `MenuItem` a suite tried to render.
 */
const standIns = new Map();

function fluentStandIn(name) {
    if (!standIns.has(name)) {
        const StandIn = (props) => {
            const passed = { 'data-fluent': name };

            Object.keys(props || {}).forEach((key) => {
                const value = props[key];

                if (key !== 'children' && ['string', 'number', 'boolean'].includes(typeof value)) {
                    passed[key] = value;
                }
            });

            return React.createElement('div', passed, props.children);
        };

        StandIn.displayName = name;
        standIns.set(name, StandIn);
    }

    return standIns.get(name);
}

const fluent = new Proxy({}, {
    get: (_target, name) => {
        if (typeof name !== 'string') {
            return undefined;
        }

        return /^[A-Z]/.test(name) ? fluentStandIn(name) : {};
    },
});

fluentGlobals.forEach((name) => {
    global[name] = fluent;
});

// A 0.0.x bundle logs the probe's answers through console.info; the suite is not the form.
console.info = () => {};

vm.runInThisContext(source, { filename: 'bundle.js' });

/**
 * Render what a virtual control returned, executing the component body.
 *
 * **`updateView` only *builds* an element.** A virtual control's component does
 * not run until something renders it, so an assertion that reads props alone
 * cannot see a crash inside the component — and half of what a React dataset
 * control does lives there. That is not hypothetical: the `dataset.sorting`
 * crash below is in the component, and a props-only suite passes against the
 * broken control.
 *
 * `react-dom/server` needs no DOM and no browser. Fluent is stubbed, so its
 * components render as their own names and the markup is meaningless — the
 * point is entirely whether rendering threw.
 *
 * Returns `null` for a standard control, which has no element and no react-dom.
 */
function renderDeep(element) {
    if (element === undefined || element === null || React === null) {
        return null;
    }

    let server = null;

    try {
        server = require(path.join(root, 'node_modules', 'react-dom', 'server'));
    } catch (error) {
        return null;
    }

    // React's development warnings about unknown element types would bury the
    // report; the assertions are about throwing, not about tag names.
    const warn = console.error;
    console.error = () => {};

    try {
        return server.renderToStaticMarkup(element);
    } finally {
        console.error = warn;
    }
}

/* ---------------------------------------------------------------- harness */

const results = [];

function check(label, ok, detail) {
    results.push({ ok, label, detail });
}

// `getString` returns a marked key rather than a real string, so an assertion
// can tell "read from the .resx" apart from "hardcoded in the source".
const marked = (key) => `resx:${key}`;

/**
 * Bind a fresh control to a fresh view and render until it settles.
 *
 * The returned handle exposes both halves: what was drawn (or, for a virtual
 * control, what was passed down), and what the platform was asked to do.
 */
/**
 * Every control bound and not yet destroyed.
 *
 * A suite that binds and walks away is testing something other than what it
 * says: an abandoned control keeps its interval and its `document` listeners,
 * so the next section's counts include them. That is the leak the teardown
 * assertion exists to catch, and asserting it from inside one proves nothing.
 */
const live = [];

function disposeAll() {
    while (live.length > 0) {
        live.pop().destroy();
    }
}

function bind(options) {
    const handle = host.createHost(fixture, { getString: marked, ...options });
    const container = dom.createElement('div');
    const instance = new registration.ctor();

    let notifications = 0;

    instance.init(handle.context, () => {
        notifications += 1;
    }, {}, container);

    let driven = host.drive(instance, handle, 10);

    const view = {
        instance,
        container,
        handle,
        get driven() {
            return driven;
        },
        /** The props a virtual control passed down; `{}` for a standard one. */
        props: () => (driven.element && driven.element.props) || {},
        calls: () => handle.state.calls,
        /** How many times the control said its outputs changed. */
        notifications: () => notifications,
        outputs: () => (instance.getOutputs ? instance.getOutputs() : {}),
        find: (selector) => container.querySelector(selector),
        findAll: (selector) => container.querySelectorAll(selector),
        /** Let the platform catch up after something the control asked for. */
        settle: () => {
            driven = host.drive(instance, handle, 10);

            return driven;
        },
        /** Unmount, as the platform does when the form closes or navigates. */
        destroy: () => {
            instance.destroy();

            const at = live.indexOf(view);

            if (at !== -1) {
                live.splice(at, 1);
            }
        },
    };

    live.push(view);

    return view;
}

check('bundle registered a control', typeof registration.ctor === 'function');

if (typeof registration.ctor !== 'function') {
    report();
}

/* ======================================================================== *
 *  The control's own decisions.
 *
 *  Two layers. The **pure modules** — the query builder, the date buckets,
 *  the row reader, the grouping and the geometry — are transpiled from
 *  source and asserted directly, because a rendered chart shows none of
 *  what they decide. The **bundle** is then bound to the rig's view and
 *  asserted through the props it passes down and the platform calls it
 *  makes; the component's own effects (the server route, the metadata read)
 *  cannot run under `react-dom/server`, so their inputs are asserted here
 *  and their behaviour on the harness page and the form.
 * ======================================================================== */

const ts = require(path.join(root, 'node_modules', 'typescript'));
const { Module } = require('module');
const src = path.join(root, 'ChartView');

/**
 * Transpile one source file and evaluate it as its own module. Relative
 * imports come back through here; `react` is the React the bundle got;
 * `@fluentui/react-components` is the same stand-in Proxy the bundle got.
 */
const moduleCache = new Map();

function load(name) {
    if (moduleCache.has(name)) {
        return moduleCache.get(name).exports;
    }

    const file = path.join(src, `${name}.ts${fs.existsSync(path.join(src, `${name}.tsx`)) ? 'x' : ''}`);
    const sourceText = fs.readFileSync(file, 'utf8');
    const { outputText, diagnostics } = ts.transpileModule(sourceText, {
        fileName: file,
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true, jsx: ts.JsxEmit.React },
        reportDiagnostics: true,
    });

    if (diagnostics && diagnostics.length > 0) {
        throw new Error(`${name}: ${diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n')}`);
    }

    const mod = new Module(file, module);
    mod.filename = file;
    mod.paths = Module._nodeModulePaths(src);
    moduleCache.set(name, mod);
    mod.require = function (request) {
        if (request.startsWith('.')) {
            return load(path.posix.normalize(path.posix.join(path.posix.dirname(name), request)));
        }
        if (request === 'react') {
            return React;
        }
        if (request === '@fluentui/react-components') {
            return fluent;
        }
        return Module.prototype.require.call(this, request);
    };
    mod._compile(outputText, file);

    return mod.exports;
}

const Q = load('query/fetchXml');
const R = load('query/rows');
const D = load('chart/dates');
const A = load('chart/aggregate');
const G = load('chart/geometry');
const P = load('platform');
const Data = load('data/ChartData');
const Components = load('components/ChartViewControl');

const VIEW = fixture.views[fixture.viewId].fetchxml;
const shape = (over) => ({
    entity: 'account',
    category: 'industrycode',
    categoryKind: 'choice',
    dateGrouping: 'month',
    value: null,
    aggregate: 'count',
    primaryId: 'accountid',
    ...over,
});

/* --------------------------------------------------------- the query text */

check(
    'a count groups by the category and counts the primary key under n',
    Q.aggregateAttributes(shape())
        === "<attribute name='industrycode' groupby='true' alias='g'/><attribute name='accountid' aggregate='count' alias='n'/>",
    Q.aggregateAttributes(shape()),
);

check(
    'a sum adds the measure under v beside the count',
    Q.aggregateAttributes(shape({ value: 'revenue', aggregate: 'sum' })).endsWith("<attribute name='revenue' aggregate='sum' alias='v'/>"),
);

check(
    'an aggregate without a value column counts, whatever was asked',
    Q.effectiveAggregate({ value: null, aggregate: 'avg' }) === 'count' && Q.aggregateAttributes(shape({ aggregate: 'avg' })).indexOf("alias='v'") === -1,
);

check(
    'a month grouping asks for the month and the year',
    Q.aggregateAttributes(shape({ category: 'createdon', categoryKind: 'date' }))
        === "<attribute name='createdon' groupby='true' dategrouping='month' alias='g'/><attribute name='createdon' groupby='true' dategrouping='year' alias='y'/><attribute name='accountid' aggregate='count' alias='n'/>",
    Q.aggregateAttributes(shape({ category: 'createdon', categoryKind: 'date' })),
);

check(
    'a day grouping adds the month, and a year grouping asks for the year alone',
    Q.aggregateAttributes(shape({ category: 'createdon', categoryKind: 'date', dateGrouping: 'day' })).indexOf("dategrouping='month' alias='mo'") !== -1
        && Q.aggregateAttributes(shape({ category: 'createdon', categoryKind: 'date', dateGrouping: 'year' })).indexOf("alias='y'") === -1,
);

const stripped = Q.stripView(VIEW);

check(
    "stripping a view removes every <attribute> and <order>, at every depth, and keeps <filter> and <link-entity>",
    stripped.indexOf('<attribute') === -1 && stripped.indexOf('<order') === -1 && stripped.indexOf('<filter') !== -1 && stripped.indexOf('<link-entity') !== -1,
    stripped,
);

const built = Q.aggregateFetchXml(shape(), VIEW, '');

check(
    "the query is the view's filter and link-entity under aggregate='true', with the two attributes first",
    built.startsWith("<fetch aggregate='true'><entity name='account'><attribute name='industrycode' groupby='true' alias='g'/>")
        && built.indexOf("<condition attribute=\"statecode\" operator=\"eq\" value=\"0\"/>") !== -1
        && built.indexOf('<link-entity name="contact"') !== -1
        && built.indexOf('version="1.0"') === -1
        && built.endsWith('</entity></fetch>'),
    built,
);

check(
    'the runtime filter is appended inside the root entity',
    Q.aggregateFetchXml(shape(), VIEW, "<filter type='and'><condition attribute='name' operator='like' value='%a%'/></filter>").indexOf(
        "operator='like' value='%a%'/></filter></entity></fetch>",
    ) !== -1,
);

check(
    'a view on another table is ignored rather than aggregated',
    Q.aggregateFetchXml(shape(), '<fetch><entity name="contact"><filter><condition attribute="x" operator="eq" value="1"/></filter></entity></fetch>', '')
        === "<fetch aggregate='true'><entity name='account'>" + Q.aggregateAttributes(shape()) + '</entity></fetch>',
);

check('no view is the bare table', Q.aggregateFetchXml(shape(), null, '') === "<fetch aggregate='true'><entity name='account'>" + Q.aggregateAttributes(shape()) + '</entity></fetch>');

check('the FetchXML is sent raw, as documented and measured', Q.FETCHXML_ENCODED === false && Q.queryString('<fetch/>') === '?fetchXml=<fetch/>');

/* ------------------------------------------------------ the runtime filter */

check('no filter is an empty, translatable string', Q.filterToFetchXml(null).xml === '' && Q.filterToFetchXml(null).translatable);

const f1 = Q.filterToFetchXml({ conditions: [{ attributeName: 'name', conditionOperator: 6, value: '%con%' }], filterOperator: 0 });

check("Like (6) is <condition operator='like'> inside an and-filter", f1.xml === "<filter type='and'><condition attribute='name' operator='like' value='%con%'/></filter>" && f1.translatable, f1.xml);

const f2 = Q.filterToFetchXml({
    conditions: [{ attributeName: 'industrycode', conditionOperator: 8, value: ['1', '2'] }],
    filterOperator: 1,
    filters: [{ conditions: [{ attributeName: 'revenue', conditionOperator: 12, value: '' }], filterOperator: 0 }],
});

check(
    'In (8) takes <value> children, Null (12) takes no value, a nested filter nests, Or is or',
    f2.xml === "<filter type='or'><condition attribute='industrycode' operator='in'><value>1</value><value>2</value></condition><filter type='and'><condition attribute='revenue' operator='null'/></filter></filter>",
    f2.xml,
);

check('Contains (49) becomes a like over %value%', Q.filterToFetchXml({ conditions: [{ attributeName: 'name', conditionOperator: 49, value: 'con' }], filterOperator: 0 }).xml.indexOf("operator='like' value='%con%'") !== -1);

check(
    'an operator the table does not know makes the whole filter untranslatable',
    Q.filterToFetchXml({ conditions: [{ attributeName: 'name', conditionOperator: 99, value: 'x' }], filterOperator: 0 }).translatable === false,
);

check(
    'and so does an attribute that is not a logical name',
    Q.filterToFetchXml({ conditions: [{ attributeName: "x' or 1=1", conditionOperator: 0, value: 'x' }], filterOperator: 0 }).translatable === false,
);

check(
    "a value's quotes and angle brackets are escaped",
    Q.filterToFetchXml({ conditions: [{ attributeName: 'name', conditionOperator: 0, value: "O'Neil <x>" }], filterOperator: 0 }).xml.indexOf("value='O&apos;Neil &lt;x&gt;'") !== -1,
);

check(
    'a linked entity alias goes on the condition as entityname',
    Q.filterToFetchXml({ conditions: [{ attributeName: 'fullname', conditionOperator: 0, value: 'x', entityAliasName: 'pc' }], filterOperator: 0 }).xml.indexOf("entityname='pc'") !== -1,
);

/* ---------------------------------------------------------------- the days */

// 04:30Z on 1 March: 28 February for a user five hours west, 1 March in the browser's UTC.
const instant = new Date('2026-03-01T04:30:00Z');

check('a wall date is the user\'s, not the browser\'s', D.wallOf(instant, -300).day === 28 && D.wallOf(instant, -300).month === 2 && D.wallOf(instant, 0).day === 1);

check(
    'a month bucket is yyyy-MM and the number the server would return',
    JSON.stringify(D.bucketOf({ year: 2026, month: 3, day: 1 }, 'month')) === '{"key":"2026-03","bucket":3}',
);

check('a quarter bucket', D.bucketOf({ year: 2026, month: 11, day: 5 }, 'quarter').key === '2026-Q4' && D.quarterOf(11) === 4);

check('week 1 holds 1 January and weeks start on Sunday', D.weekOfYear({ year: 2026, month: 1, day: 1 }) === 1 && D.weekOfYear({ year: 2026, month: 1, day: 3 }) === 1 && D.weekOfYear({ year: 2026, month: 1, day: 4 }) === 2);

check(
    'the server\'s (year, bucket) makes the same key as the browser\'s date',
    D.keyFromBucket('month', 2026, 3) === '2026-03' && D.keyFromBucket('week', 2026, 7) === '2026-W07' && D.keyFromBucket('day', 2026, 14, 3) === '2026-03-14' && D.keyFromBucket('year', 2025, 2025) === '2025',
);

const labels = { monthNames: D.EN_MONTHS, week: 'W{0} {1}', quarter: 'Q{0} {1}', formatDay: (y, m, d) => `${d}/${m}/${y}` };

check(
    'a key labels itself: month name and year, Q, W, the short date, the year',
    D.labelForKey('2026-03', labels) === 'Mar 2026' && D.labelForKey('2026-Q2', labels) === 'Q2 2026' && D.labelForKey('2026-W07', labels) === 'W7 2026' && D.labelForKey('2026-03-14', labels) === '14/3/2026' && D.labelForKey('2026', labels) === '2026',
);

check('an unreadable date is a blank, not an Invalid Date group', D.readDate('not a date') === null && D.readDate('') === null && D.readDate(null) === null);

/* ---------------------------------------------------------- the row reader */

const rowShape = { categoryKind: 'choice', dateGrouping: 'month', dateLabels: labels, twoOptions: { yes: 'Yes', no: 'No' } };

check(
    'a choice row: integer key, the annotation as label, n as count and value',
    JSON.stringify(R.toReading({ g: 2, 'g@OData.Community.Display.V1.FormattedValue': 'Manufacturing', n: 3 }, rowShape, true))
        === '{"key":"2","label":"Manufacturing","value":3,"count":3,"sortKey":2}',
);

check(
    'a row with no g is the blank group — a FetchXML result omits nulls',
    R.toReading({ n: 1 }, rowShape, true).key === null && R.toReading({ n: 1 }, rowShape, true).count === 1,
);

check(
    'a sum row keeps the count beside the measure',
    R.toReading({ g: 1, n: 4, v: 2500 }, rowShape, false).value === 2500 && R.toReading({ g: 1, n: 4, v: 2500 }, rowShape, false).count === 4,
);

check(
    'a lookup row: bare lower-case GUID as key, the name as label',
    R.toReading({ g: '{B3F1A0C2-0000-4000-8000-000000000001}', 'g@OData.Community.Display.V1.FormattedValue': 'Sam Vaziri', n: 2 }, { ...rowShape, categoryKind: 'lookup' }, true).key === 'b3f1a0c2-0000-4000-8000-000000000001',
);

check(
    'a month row: (g, y) → the 2026-03 key and its label',
    R.toReading({ g: 3, y: 2026, n: 5 }, { ...rowShape, categoryKind: 'date' }, true).key === '2026-03' && R.toReading({ g: 3, y: 2026, n: 5 }, { ...rowShape, categoryKind: 'date' }, true).label === 'Mar 2026',
);

check('a month row with no year is a blank, not a 2026-less group', R.toReading({ g: 3, n: 5 }, { ...rowShape, categoryKind: 'date' }, true).key === null);

check('numbers arrive as numbers or strings and read the same', R.numberOf('12.5') === 12.5 && R.numberOf(7) === 7 && R.numberOf('') === null && R.numberOf('x') === null);

/* ------------------------------------------------------------ the grouping */

const reading = (key, value, label) => ({ key, label: label || String(key), value, count: 1, sortKey: typeof key === 'number' ? key : String(key) });
const finishOpts = (over) => ({
    aggregate: 'count',
    categoryKind: 'choice',
    sortBy: 'value',
    topN: null,
    source: 'client',
    otherLabel: 'Other',
    blankLabel: '(blank)',
    colorFor: (key, index) => (key === A.OTHER_KEY ? A.NEUTRAL : A.PALETTE[index % A.PALETTE.length]),
    recordCount: null,
    ...over,
});

const counted = A.finishGroups(A.groupReadings([reading('1', null), reading('2', null), reading('2', null), reading(null, null, '')]), finishOpts());

check(
    'a count groups by key, largest first, blank included',
    counted.groups.map((g) => `${g.label}:${g.value}`).join(',') === '2:2,1:1,(blank):1' && counted.total === 4,
    counted.groups.map((g) => `${g.label}:${g.value}`).join(','),
);

const summed = A.finishGroups(A.groupReadings([reading('a', 10), reading('a', null), reading('b', 5)]), finishOpts({ aggregate: 'sum', categoryKind: 'text' }));

check('a sum skips a blank number and keeps the record in the count', summed.groups[0].value === 10 && summed.groups[0].count === 2 && summed.total === 15);

const averaged = A.finishGroups(A.groupReadings([reading('a', 10), reading('a', 20), reading('a', null)]), finishOpts({ aggregate: 'avg', categoryKind: 'text' }));

check('an average divides by the readings that had a number', averaged.groups[0].value === 15);

const serverAvg = A.finishGroups(A.groupReadings([{ key: 'a', label: 'a', value: 15, count: 3, sortKey: 'a' }]), finishOpts({ aggregate: 'avg', categoryKind: 'text', source: 'server' }));

check("a server average is passed through, not re-averaged from the group's count", serverAvg.groups[0].value === 15 && serverAvg.groups[0].count === 3);

const folded = A.finishGroups(
    A.groupReadings([reading('a', null), reading('a', null), reading('a', null), reading('b', null), reading('b', null), reading('c', null), reading('d', null), reading('e', null)]),
    finishOpts({ topN: 2, categoryKind: 'text' }),
);

check(
    'topN keeps the largest and folds the tail into Other, last, in neutral',
    folded.groups.map((g) => `${g.label}:${g.value}`).join(',') === 'a:3,b:2,Other:3' && folded.groups[2].other && folded.groups[2].color === A.NEUTRAL && folded.groups[2].count === 3,
    folded.groups.map((g) => `${g.label}:${g.value}`).join(','),
);

check(
    'topN with a tail of one group folds nothing — an Other of one is just a rename',
    A.finishGroups(A.groupReadings([reading('a', null), reading('a', null), reading('b', null), reading('c', null)]), finishOpts({ topN: 2, categoryKind: 'text' })).groups.length === 3,
);

const byLabel = A.finishGroups(A.groupReadings([reading(3, null, 'Services'), reading(1, null, 'Retail'), reading(1, null, 'Retail')]), finishOpts({ sortBy: 'label' }));

check("a label sort on a choice follows the option's value when metadata is absent", byLabel.groups.map((g) => g.label).join(',') === 'Retail,Services');

const byMeta = A.finishGroups(A.groupReadings([reading(3, null, 'Services'), reading(1, null, 'Retail')]), finishOpts({ sortBy: 'label', orderFor: (key) => ({ 3: 0, 1: 1 })[key] }));

check("and the option's position from metadata when present", byMeta.groups.map((g) => g.label).join(',') === 'Services,Retail');

const dated = A.finishGroups(
    A.groupReadings([{ key: '2026-03', label: 'Mar 2026', value: null, count: 1, sortKey: '2026-03' }, { key: '2025-11', label: 'Nov 2025', value: null, count: 1, sortKey: '2025-11' }, { key: '2026-01', label: 'Jan 2026', value: null, count: 1, sortKey: '2026-01' }]),
    finishOpts({ categoryKind: 'date', topN: 1 }),
);

check('a date category is chronological whatever the sort, and never folded', dated.groups.map((g) => g.key).join(',') === '2025-11,2026-01,2026-03' && dated.groups.length === 3);

check('a percentage is of the total, rounded; an empty chart has none', A.percentOf(1, 3) === 33 && A.percentOf(2, 3) === 67 && A.percentOf(0, 0) === 0);

check('the palette holds ten colours, brand first', A.PALETTE.length === 10 && A.PALETTE[0] === '#0f6cbd');

/* ------------------------------------------------------------ the geometry */

check('nice ticks span zero to the maximum in round steps', JSON.stringify(G.niceTicks(0, 7)) === '[0,2,4,6,8]' && JSON.stringify(G.niceTicks(0, 1250000)).indexOf('1500000') !== -1);

check('nice ticks include zero when the range crosses it', G.niceTicks(-3, 7).indexOf(0) !== -1 && G.niceTicks(-3, 7)[0] < 0);

const groupsForGeometry = counted.groups;
const cols = G.columnLayout(groupsForGeometry, 400, 240, (v) => String(v));

check(
    'a column per group, heights in proportion, all standing on the baseline',
    cols.rects.length === 3 && Math.abs(cols.rects[0].h - 2 * cols.rects[1].h) < 0.01 && cols.rects.every((r) => Math.abs(r.y + r.h - cols.baseline) < 0.01),
    JSON.stringify(cols.rects),
);

check('the plot leaves room on the left for the widest tick label', cols.plot.x > G.PAD.left + 6);

const negative = G.columnLayout([{ ...groupsForGeometry[0], value: -2 }, groupsForGeometry[1]], 400, 240, (v) => String(v));

check('a negative value hangs below the baseline', negative.rects[0].y >= negative.baseline - 0.01 && negative.rects[1].y + negative.rects[1].h <= negative.baseline + 0.01);

const bars = G.barLayout(groupsForGeometry, 400, 240, (v) => String(v));

check('bars run from the baseline rightwards, one per group, labels on the left', bars.rects.length === 3 && bars.rects.every((r) => Math.abs(r.x - bars.baseline) < 0.01) && bars.categories.every((c) => c.anchor === 'end'));

const arcs = G.pieLayout(groupsForGeometry, 100, 100, 80, 0);

check('a pie closes: the shares sum to one and every slice has a path', Math.abs(arcs.reduce((s, a) => s + a.share, 0) - 1) < 1e-9 && arcs.every((a) => a.d !== ''));

check('a lone slice is drawn as a full ring rather than a path from a point to itself', G.pieLayout([groupsForGeometry[0]], 100, 100, 80, 0)[0].d.split(' A ').length === 3);

check('a donut has an inner radius in every path', G.pieLayout(groupsForGeometry, 100, 100, 80, 40).every((a) => a.d.indexOf(' 40 40 ') !== -1));

check('a zero value takes no slice', G.pieLayout([groupsForGeometry[0], { ...groupsForGeometry[1], value: 0 }], 100, 100, 80, 0)[1].d === '');

const line = G.lineLayout(groupsForGeometry, 400, 240, (v) => String(v));

check('a line has a point per group and a path through them', line.points.length === 3 && line.d.startsWith('M ') && line.d.split(' L ').length === 3);

check('a label is cut to its slot with an ellipsis', G.fitText('Consolidated Messenger Intercontinental', 60).endsWith('…') && G.fitText('Retail', 60) === 'Retail');

/* --------------------------------------------------------------- platform */

check(
    'a category kind is compared exactly, never by substring',
    P.categoryKindOf('OptionSet') === 'choice' && P.categoryKindOf('Lookup.Owner') === 'lookup' && P.categoryKindOf('DateAndTime.DateOnly') === 'date' && P.categoryKindOf('OptionSet | TwoOptions') === 'unknown' && P.categoryKindOf(undefined) === 'unknown',
);

check('a measure kind', P.measureKindOf('Currency') === 'currency' && P.measureKindOf('Whole.None') === 'whole' && P.measureKindOf('FP') === 'decimal' && P.measureKindOf('SingleLine.Text') === 'none');

const offsetWest = () => -300;

check(
    "a record's date is bucketed by the user's zone",
    P.readingOf('2026-03-01T04:30:00Z', '', null, 'date', 'month', offsetWest, labels).key === '2026-02' && P.readingOf('2026-03-01T04:30:00Z', '', null, 'date', 'month', () => 0, labels).key === '2026-03',
);

check(
    "a record's lookup reads the EntityReference's guid and name",
    P.readingOf({ id: { guid: 'B3F1A0C2-0000-4000-8000-000000000001' }, etn: 'systemuser', name: 'Sam Vaziri' }, '', null, 'lookup', 'month', offsetWest, labels).key === 'b3f1a0c2-0000-4000-8000-000000000001'
        && P.readingOf({ id: { guid: 'x' }, name: 'Sam' }, '', null, 'lookup', 'month', offsetWest, labels).label === 'Sam',
);

check("a record's choice arrives as an integer or a string and keys the same", P.readingOf(3, 'Services', null, 'choice', 'month', offsetWest, labels).key === '3' && P.readingOf('3', 'Services', null, 'choice', 'month', offsetWest, labels).key === '3');

check('a blank category is a null key whatever the kind', P.readingOf(null, '', 5, 'choice', 'month', offsetWest, labels).key === null && P.readingOf('', '', 5, 'text', 'month', offsetWest, labels).key === null);

check('the primary key is <table>id, except for the activity tables', P.primaryIdOf('account') === 'accountid' && P.primaryIdOf('cr123_thing') === 'cr123_thingid' && P.primaryIdOf('phonecall') === 'activityid');

/* ------------------------------------------------------- the rig, directly */

const FORMATTED = '@OData.Community.Display.V1.FormattedValue';

async function rigChecks() {
    const ctx = host.createHost(fixture, {}).context;

    const viewRow = await ctx.webAPI.retrieveRecord('savedquery', fixture.viewId, '?$select=fetchxml');

    check('the rig answers savedquery with the view\'s FetchXML', viewRow.fetchxml === VIEW);

    let refused = null;

    await ctx.webAPI.retrieveRecord('userquery', fixture.viewId, '?$select=fetchxml').catch((e) => {
        refused = e;
    });

    check('and refuses the same id in the other table as not found', refused !== null && refused.errorCode === 2147746581);

    const personal = await Data.readViewFetchXml(ctx.webAPI, '00000000-0000-0000-0000-00000000b22e');

    check('readViewFetchXml tries savedquery then userquery', typeof personal === 'string' && personal.indexOf('<fetch>') === 0);

    Data.resetViewCache();

    const unreadable = await Data.readViewFetchXml(host.createHost(fixture, { viewsReadable: false }).context.webAPI, fixture.viewId);

    check('and answers null when neither table will say', unreadable === null);

    Data.resetViewCache();

    const counts = await ctx.webAPI.retrieveMultipleRecords('account', Q.queryString(Q.aggregateFetchXml(shape(), VIEW, '')));
    const rows = counts.entities;
    const total = rows.reduce((n, r) => n + r.n, 0);

    check(
        "an aggregate over the view honours the view's filter: 10 active accounts, not the 12 the dataset holds",
        total === 10,
        `${total} across ${rows.length} groups`,
    );

    const manufacturing = rows.find((r) => r.g === 2);

    check("a choice group's g is the integer with the label in the annotation", manufacturing !== undefined && manufacturing[`g${FORMATTED}`] === 'Manufacturing' && manufacturing.n === 3, JSON.stringify(manufacturing));

    const blank = rows.find((r) => !('g' in r));

    check('the blank group has no g at all — nulls are omitted — and still a count', blank !== undefined && blank.n === 1);

    const sums = await ctx.webAPI.retrieveMultipleRecords('account', Q.queryString(Q.aggregateFetchXml(shape({ value: 'revenue', aggregate: 'sum' }), VIEW, '')));
    const services = sums.entities.find((r) => r.g === 3);

    check('a sum per group, with the count beside it', services !== undefined && services.v === 480000 && services.n === 1, JSON.stringify(services));

    const blankSum = sums.entities.find((r) => !('g' in r));

    check('a sum over a group whose only value is blank omits v and keeps n', blankSum !== undefined && !('v' in blankSum) && blankSum.n === 1, JSON.stringify(blankSum));

    const byOwner = await ctx.webAPI.retrieveMultipleRecords('account', Q.queryString(Q.aggregateFetchXml(shape({ category: 'ownerid', categoryKind: 'lookup' }), VIEW, '')));
    const sam = byOwner.entities.find((r) => r.g === 'b3f1a0c2-0000-4000-8000-000000000001');

    check("a lookup group's g is the bare GUID with the name in the annotation", sam !== undefined && sam[`g${FORMATTED}`] === 'Sam Vaziri' && sam.n === 6, JSON.stringify(byOwner.entities));

    const byMonth = await ctx.webAPI.retrieveMultipleRecords('account', Q.queryString(Q.aggregateFetchXml(shape({ category: 'modifiedon', categoryKind: 'date' }), VIEW, '')));
    const march = byMonth.entities.find((r) => r.g === 3 && r.y === 2026);

    check('a month group carries the bucket under g and the year under y', march !== undefined && march.n === 3, JSON.stringify(byMonth.entities));

    const readings = R.toReadings(byMonth.entities, { categoryKind: 'date', dateGrouping: 'month', dateLabels: labels, twoOptions: { yes: 'Yes', no: 'No' } }, true);
    const finished = A.finishGroups(A.groupReadings(readings), finishOpts({ categoryKind: 'date', source: 'server' }));

    check('and the rows read into chronological month groups', finished.groups[0].key < finished.groups[finished.groups.length - 1].key && finished.groups.some((g) => g.label === 'Mar 2026'));

    const filtered = await ctx.webAPI.retrieveMultipleRecords(
        'account',
        Q.queryString(Q.aggregateFetchXml(shape(), VIEW, "<filter type='and'><condition attribute='name' operator='like' value='%o%'/></filter>")),
    );

    check('the appended runtime filter narrows the aggregate further', filtered.entities.reduce((n, r) => n + r.n, 0) < 10);

    let limited = null;

    await host.createHost(fixture, { aggregateLimit: 5 }).context.webAPI.retrieveMultipleRecords('account', Q.queryString(Q.aggregateFetchXml(shape(), VIEW, ''))).catch((e) => {
        limited = e;
    });

    check('over the aggregate limit the rig refuses with 0x8004E023', limited !== null && limited.errorCode === 2147164195 && /AggregateQueryRecordLimit/.test(limited.message));

    let viaData = null;

    await Data.loadAggregate(host.createHost(fixture, { aggregateRefused: true }).context.webAPI, { shape: shape(), viewXml: VIEW, filterXml: '' }).catch((e) => {
        viaData = e;
    });

    check('loadAggregate wraps a refusal as a Refusal with one readable sentence', viaData !== null && typeof viaData.message === 'string' && viaData.raw !== undefined);

    const merged = host.createHost(fixture, { hostFilter: { conditions: [{ attributeName: 'statecode', conditionOperator: 0, value: '0' }], filterOperator: 0 } }).context.parameters.records;

    check('a host filter narrows the rows and comes back from getFilter()', merged.paging.totalResultCount === 10 && merged.filtering.getFilter().conditions.length === 1);

    const plain = host.createHost(fixture, { viewId: null }).context.parameters.records;

    check("getViewId() can answer null, as it did on a bound lookup's dataset", plain.getViewId() === null && ctx.parameters.records.getViewId() === fixture.viewId);
}

/* ---------------------------------------------------------- the bundle */

const first = bind({});
const propsOf = (view) => view.props();

check('the control is virtual and hands the component props', first.driven.element !== undefined && typeof propsOf(first).roles === 'object');

check('the roles are found by alias and read by name', propsOf(first).roles.category === 'industrycode' && propsOf(first).roles.categoryKind === 'choice' && propsOf(first).roles.value === 'revenue' && propsOf(first).roles.valueKind === 'currency');

check('one reading per loaded record — the first page of five, with more to come', propsOf(first).readings.length === 5 && propsOf(first).loaded === 5 && propsOf(first).hasMore === true);

const wholeView = bind({ pageSize: 12 });

check('a host paging at twelve hands over all twelve, and nothing more to come', propsOf(wholeView).readings.length === 12 && propsOf(wholeView).hasMore === false);

check('a choice reading carries the integer key and the formatted label', propsOf(first).readings.find((r) => r.key === '2') !== undefined && propsOf(first).readings.find((r) => r.key === '2').label === 'Manufacturing');

check('the blank record is a null-key reading', propsOf(wholeView).readings.some((r) => r.key === null));

check('the server route is offered on a model-driven host with the view id and no filter', propsOf(first).server !== null && propsOf(first).server.viewId === fixture.viewId && propsOf(first).server.filterXml === '' && propsOf(first).server.entity === 'account');

check('the settings read their defaults', propsOf(first).settings.chartType === 'column' && propsOf(first).settings.aggregate === 'count' && propsOf(first).settings.height === 280 && propsOf(first).settings.topN === null);

check('the view\'s title is offered for the heading', propsOf(first).viewTitle === 'Active Accounts');

check('the metadata loader is offered with Utility', typeof propsOf(first).metadata === 'function');

check('the control does not touch the dataset: no refresh, no filter, no paging', first.calls().filter((c) => /^(refresh|filtering\.set|paging\.)/.test(c.name)).length === 0, first.calls().map((c) => c.name).join(','));

check('it settles in one pass', first.driven.passes === 1 && !first.driven.looping, `${first.driven.passes} passes`);

const markup = renderDeep(first.driven.element);

check('and the component renders without throwing', typeof markup === 'string' && markup.indexOf('ChartView') !== -1);

check('the caption names the measure, from the .resx', markup.indexOf('resx:ChartView_Measure_Count') !== -1);

first.handle.setInput('chartType', 'pie');
first.handle.setInput('aggregate', 'sum');
first.handle.setInput('topN', 3);
first.settle();

check('inputs are read on every pass, never copied in init', propsOf(first).settings.chartType === 'pie' && propsOf(first).settings.aggregate === 'sum' && propsOf(first).settings.topN === 3);

check("the server route's key changes with the aggregate, so the query re-runs", propsOf(first).server.key.indexOf('|sum|') !== -1);

first.handle.setInput('height', 40);
first.handle.setInput('chartType', 'nonsense');
first.settle();

check('a height under 80 and an enum outside the union fall back rather than break', propsOf(first).settings.height === 280 && propsOf(first).settings.chartType === 'column');

propsOf(first).onSelect('2', 'Manufacturing');

check('selecting a group notifies and emits key and label', first.notifications() === 1 && first.outputs().selectedKey === '2' && first.outputs().selectedLabel === 'Manufacturing');

propsOf(first).onSelect('2', 'Manufacturing');

check('selecting it again clears both to the empty string, not undefined', first.notifications() === 2 && first.outputs().selectedKey === '' && first.outputs().selectedLabel === '');

const canvas = bind({ host: 'canvas' });

check('a canvas host has no server route, no metadata, and the readings stand', propsOf(canvas).server === null && propsOf(canvas).readings.length === 5 && propsOf(canvas).metadata === null);

check('and renders', typeof renderDeep(canvas.driven.element) === 'string');

const noApi = bind({ webAPI: false });

check('a declined WebAPI feature withholds the server route', propsOf(noApi).server === null);

const hostFiltered = bind({ hostFilter: { conditions: [{ attributeName: 'statecode', conditionOperator: 0, value: '0' }], filterOperator: 0 } });

check(
    "a host filter is carried into the server route as FetchXML, and the readings are the narrowed rows",
    propsOf(hostFiltered).server !== null && propsOf(hostFiltered).server.filterXml === "<filter type='and'><condition attribute='statecode' operator='eq' value='0'/></filter>" && hostFiltered.handle.context.parameters.records.paging.totalResultCount === 10,
    propsOf(hostFiltered).server && propsOf(hostFiltered).server.filterXml,
);

const untranslatable = bind({ hostFilter: { conditions: [{ attributeName: 'statecode', conditionOperator: 99, value: '0' }], filterOperator: 0 } });

check('a filter the control cannot spell withholds the server route rather than sending a different question', propsOf(untranslatable).server === null);

const unmapped = bind({ columns: fixture.columns.map((c) => (c.alias === 'categoryField' ? { ...c, alias: c.name } : c)) });

check('an unmapped category is no readings, no server route, and the choose-a-column message', propsOf(unmapped).roles.category === '' && propsOf(unmapped).server === null && renderDeep(unmapped.driven.element).indexOf('resx:ChartView_NoCategory') !== -1);

const byOwner = bind({ columns: fixture.columns.map((c) => (c.alias === 'categoryField' ? { ...c, alias: c.name } : c.name === 'ownerid' ? { ...c, alias: 'categoryField' } : c)) });

check('a lookup category reads GUID keys and names', propsOf(byOwner).roles.categoryKind === 'lookup' && propsOf(byOwner).readings.every((r) => r.key === null || /^[0-9a-f-]{36}$/.test(r.key)) && propsOf(byOwner).readings.some((r) => r.label === 'Jo Park'));

const byDate = bind({
    columns: fixture.columns.map((c) => (c.alias === 'categoryField' ? { ...c, alias: c.name } : c.name === 'createdon' ? { ...c, alias: 'categoryField' } : c)),
    userTimeZoneOffset: -300,
});

check(
    "a date category buckets by the Dataverse user's zone: 04:30Z on 1 March is February for a user at UTC-5",
    propsOf(byDate).roles.categoryKind === 'date' && propsOf(byDate).readings.find((r) => r.key !== null).key === '2026-02',
    JSON.stringify(propsOf(byDate).readings.filter((r) => r.key !== null)),
);

const loadingView = bind({ loading: true });

check('while loading with nothing yet, the loading message', renderDeep(loadingView.driven.element).indexOf('resx:ChartView_Loading') !== -1);

const errored = bind({ error: true });

check('a dataset error is the error message, with role=alert', /role="alert"[^>]*>resx:ChartView_Error/.test(renderDeep(errored.driven.element)));

const emptyView = bind({ records: [] });

check('no records is the empty message', renderDeep(emptyView.driven.element).indexOf('resx:ChartView_Empty') !== -1);

const hidden = bind({ visible: false });

check('an invisible control renders nothing', renderDeep(hidden.driven.element) === '' || renderDeep(hidden.driven.element) === null);

const noTheme = bind({ host: 'canvas', dark: true });

check('a host with no theme still renders, dark or light', typeof renderDeep(noTheme.driven.element) === 'string');

/* ----------------------------------------------- the component, directly */

// The chart itself, with a width the ResizeObserver would have measured.
const strings = (key) => `resx:${key}`;
const chartData = A.finishGroups(A.groupReadings(propsOf(first).readings), finishOpts({ aggregate: 'count' }));
const chartProps = (over) => ({
    data: chartData,
    settings: { ...propsOf(first).settings, chartType: 'column', valueLabels: 'auto', legend: 'auto' },
    width: 480,
    height: 280,
    formatValue: (v) => String(v),
    getString: strings,
    selectedKey: '',
    hover: null,
    onHover: () => {},
    onSelect: () => {},
    title: 'Chart',
    disabled: false,
    ...over,
});

['column', 'bar', 'pie', 'donut', 'line'].forEach((type) => {
    const out = renderDeep(React.createElement(Components.Chart, chartProps({ settings: { ...chartProps().settings, chartType: type } })));
    const marks = (out.match(/class="ChartView-mark/g) || []).length;

    check(`the ${type} chart draws one focusable button per group`, marks === chartData.groups.length && (out.match(/role="button"/g) || []).length === chartData.groups.length, `${marks} marks`);
});

const columnOut = renderDeep(React.createElement(Components.Chart, chartProps()));

check('columns label themselves with the value, pies with the percentage', columnOut.indexOf('class="ChartView-value"') !== -1 && renderDeep(React.createElement(Components.Chart, chartProps({ settings: { ...chartProps().settings, chartType: 'pie' } }))).indexOf('resx:ChartView_Percent') !== -1);

check('labels none writes nothing on the marks', renderDeep(React.createElement(Components.Chart, chartProps({ settings: { ...chartProps().settings, valueLabels: 'none' } }))).indexOf('ChartView-value') === -1);

check('every mark carries an accessible name with label, value and share', (columnOut.match(/aria-label="resx:ChartView_ItemLabel"/g) || []).length === chartData.groups.length);

const selectedOut = renderDeep(React.createElement(Components.Chart, chartProps({ selectedKey: chartData.groups[0].key })));

check('a selection presses one mark and mutes the others', (selectedOut.match(/aria-pressed="true"/g) || []).length === 1 && (selectedOut.match(/is-muted/g) || []).length === chartData.groups.length - 1);

const legendOut = renderDeep(React.createElement(Components.Legend, { data: chartData, width: 160, formatValue: (v) => String(v), selectedKey: '', hover: null, onHover: () => {}, onSelect: () => {}, getString: strings }));

check('the legend is a button per group with swatch, label, value and share', (legendOut.match(/ChartView-legendButton/g) || []).length === chartData.groups.length && legendOut.indexOf('ChartView-swatch') !== -1);

const tableOut = renderDeep(React.createElement(Components.DataTable, { data: chartData, roles: propsOf(first).roles, measure: 'Count', formatValue: (v) => String(v), getString: strings }));

check('the screen-reader table has a row per group under the category heading', (tableOut.match(/<tr>/g) || []).length === chartData.groups.length + 1 && tableOut.indexOf('Industry') !== -1);

/* ---------------------------------------------------- what destroy owes */

disposeAll();

const timersBefore = time.pending();
const listeners = () => Object.values(dom.document.listeners).reduce((total, list) => total + list.length, 0);
const listenersBefore = listeners();

bind({}).destroy();

check('destroy() releases every timer the control took', time.pending() === timersBefore, `${timersBefore} → ${time.pending()}`);

check('and every document-level listener', listeners() === listenersBefore, `${listenersBefore} → ${listeners()}`);

const rerendered = bind({});
const afterFirst = time.pending();

rerendered.settle();
rerendered.settle();
rerendered.settle();

check('and re-rendering does not add another one', time.pending() === afterFirst, `${afterFirst} → ${time.pending()}`);

disposeAll();

rigChecks().then(report, (error) => {
    check('the asynchronous rig checks ran at all', false, String((error && error.stack) || error));
    report();
});

function report() {
    const failed = results.filter((result) => !result.ok);

    for (const result of results) {
        const detail = result.detail ? `  — ${result.detail}` : '';

        console.log(`  ${result.ok ? 'ok  ' : 'FAIL'}  ${result.label}${detail}`);
    }

    console.log(
        failed.length > 0
            ? `\n  ${failed.length} of ${results.length} failed\n`
            : `\n  ${results.length} passed — the control's own decisions only; see SPEC.md for what a real view still has to confirm\n`,
    );

    process.exit(failed.length > 0 ? 1 : 0);
}
