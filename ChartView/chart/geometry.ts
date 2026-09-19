/**
 * Where everything is drawn. Pure geometry over `Group[]` and a box, so the
 * smoke suite can assert that six groups make six bars whose heights are in
 * proportion, that a pie's arcs close to a full turn, and that a negative
 * value puts the baseline where it belongs — none of which a rendered SVG
 * shows anyone unless they measure it.
 *
 * Text is measured by estimate: `CHAR_W` per character at the 12px the CSS
 * uses. A font can only be measured on a canvas, and the harness has none;
 * the estimate errs wide, which costs a little margin and never a clipped
 * label.
 */

import { Group } from './types';

/** An average character's width at 12px, generous. */
export const CHAR_W = 6.6;
export const LINE_H = 16;

/** The gap around the plot, in px. */
export const PAD = { top: 12, right: 12, bottom: 8, left: 8 };

export interface Tick {
    value: number;
    /** Position along the value axis, in px. */
    at: number;
}

/**
 * Up to `count` round numbers spanning `min`..`max`, always including zero
 * when the range does. The step is 1, 2, 2.5 or 5 times a power of ten.
 */
export function niceTicks(min: number, max: number, count = 4): number[] {
    const lo = Math.min(0, min);
    const hi = Math.max(0, max);

    if (hi === lo) {
        return [0, hi === 0 ? 1 : hi];
    }

    const rough = (hi - lo) / count;
    const power = Math.pow(10, Math.floor(Math.log10(rough)));
    const fraction = rough / power;
    const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10) * power;
    const start = Math.floor(lo / step) * step;
    const end = Math.ceil(hi / step) * step;
    const ticks: number[] = [];

    for (let v = start; v <= end + step / 2; v += step) {
        // Round away the float drift a repeated addition collects.
        ticks.push(Math.abs(v) < step / 1e6 ? 0 : Number(v.toPrecision(12)));
    }

    return ticks;
}

/** A linear scale from a value range to a pixel range. */
export const scale = (d0: number, d1: number, r0: number, r1: number) => (v: number): number =>
    d1 === d0 ? r0 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);

export interface Rect {
    key: string;
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface TextAt {
    key: string;
    x: number;
    y: number;
    text: string;
    /** `start`, `middle` or `end`. */
    anchor: 'start' | 'middle' | 'end';
    /** The widest the text may be before it is cut, in px. */
    maxWidth: number;
}

export interface AxisLayout {
    /** The bars or columns. */
    rects: Rect[];
    /** Value ticks with their gridline positions. */
    ticks: Tick[];
    /** The zero line: a `y` for columns, an `x` for bars. */
    baseline: number;
    /** The category labels along the category axis. */
    categories: TextAt[];
    /** The value written on each mark; the caller decides whether to draw it. */
    values: TextAt[];
    /** The plot's inner box. */
    plot: { x: number; y: number; w: number; h: number };
}

/** Cut a label to a width, with an ellipsis, by the character estimate. */
export function fitText(text: string, maxWidth: number): string {
    const chars = Math.max(1, Math.floor(maxWidth / CHAR_W));

    if (text.length <= chars) {
        return text;
    }

    return chars <= 1 ? '…' : `${text.slice(0, chars - 1).trimEnd()}…`;
}

const widest = (labels: string[]): number => labels.reduce((w, l) => Math.max(w, l.length * CHAR_W), 0);

/**
 * Vertical bars. The value axis is on the left, sized to its widest tick
 * label; the category labels run along the bottom, each cut to its slot.
 * Bars take 70% of a slot, and a slot narrower than a character shows no
 * label rather than a pile of glyphs.
 */
export function columnLayout(groups: Group[], width: number, height: number, formatTick: (v: number) => string): AxisLayout {
    const values = groups.map((g) => g.value);
    const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
    const tickLabels = ticks.map(formatTick);
    const axisW = Math.ceil(widest(tickLabels)) + 8;
    const plot = {
        x: PAD.left + axisW,
        y: PAD.top,
        w: Math.max(0, width - PAD.left - axisW - PAD.right),
        h: Math.max(0, height - PAD.top - PAD.bottom - LINE_H - 6),
    };
    const y = scale(ticks[0], ticks[ticks.length - 1], plot.y + plot.h, plot.y);
    const slot = groups.length > 0 ? plot.w / groups.length : plot.w;
    const barW = Math.max(2, slot * 0.7);
    const baseline = y(0);

    return {
        plot,
        baseline,
        ticks: ticks.map((value) => ({ value, at: y(value) })),
        rects: groups.map((g, i) => {
            const top = y(Math.max(0, g.value));
            const bottom = y(Math.min(0, g.value));

            return { key: g.key, x: plot.x + i * slot + (slot - barW) / 2, y: top, w: barW, h: Math.max(bottom - top, g.value === 0 ? 0 : 1) };
        }),
        categories: groups.map((g, i) => ({
            key: g.key,
            x: plot.x + i * slot + slot / 2,
            y: plot.y + plot.h + LINE_H,
            text: slot < CHAR_W * 2 ? '' : fitText(g.label, slot - 4),
            anchor: 'middle' as const,
            maxWidth: slot - 4,
        })),
        values: groups.map((g, i) => ({
            key: g.key,
            x: plot.x + i * slot + slot / 2,
            y: g.value >= 0 ? y(g.value) - 4 : y(g.value) + LINE_H - 4,
            text: '',
            anchor: 'middle' as const,
            maxWidth: slot,
        })),
    };
}

/**
 * Horizontal bars. The category labels sit on the left, sized to the widest
 * (capped at a third of the width, cut beyond that); the value axis runs
 * along the bottom.
 */
export function barLayout(groups: Group[], width: number, height: number, formatTick: (v: number) => string): AxisLayout {
    const values = groups.map((g) => g.value);
    const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
    const labelW = Math.min(Math.ceil(widest(groups.map((g) => g.label))) + 8, Math.floor(width / 3));
    // The last tick label is centred on the plot's right edge, so half of it hangs past it.
    const overhang = Math.ceil(widest(ticks.map(formatTick)) / 2);
    const plot = {
        x: PAD.left + labelW,
        y: PAD.top,
        w: Math.max(0, width - PAD.left - labelW - PAD.right - overhang),
        h: Math.max(0, height - PAD.top - PAD.bottom - LINE_H - 6),
    };
    const x = scale(ticks[0], ticks[ticks.length - 1], plot.x, plot.x + plot.w);
    const slot = groups.length > 0 ? plot.h / groups.length : plot.h;
    const barH = Math.max(2, Math.min(slot * 0.7, 40));
    const baseline = x(0);

    return {
        plot,
        baseline,
        ticks: ticks.map((value) => ({ value, at: x(value) })),
        rects: groups.map((g, i) => {
            const left = x(Math.min(0, g.value));
            const right = x(Math.max(0, g.value));

            return { key: g.key, x: left, y: plot.y + i * slot + (slot - barH) / 2, w: Math.max(right - left, g.value === 0 ? 0 : 1), h: barH };
        }),
        categories: groups.map((g, i) => ({
            key: g.key,
            x: plot.x - 6,
            y: plot.y + i * slot + slot / 2 + 4,
            text: slot < LINE_H * 0.8 ? '' : fitText(g.label, labelW - 8),
            anchor: 'end' as const,
            maxWidth: labelW - 8,
        })),
        values: groups.map((g, i) => ({
            key: g.key,
            x: g.value >= 0 ? x(g.value) + 4 : x(g.value) - 4,
            y: plot.y + i * slot + slot / 2 + 4,
            text: '',
            anchor: (g.value >= 0 ? 'start' : 'end') as 'start' | 'end',
            maxWidth: 80,
        })),
    };
}

export interface Arc {
    key: string;
    /** The SVG path. */
    d: string;
    /** Where the label sits, on the arc's bisector. */
    labelX: number;
    labelY: number;
    /** The slice's share of the turn, 0–1. */
    share: number;
}

const polar = (cx: number, cy: number, r: number, angle: number): [number, number] => [cx + r * Math.sin(angle), cy - r * Math.cos(angle)];

/**
 * A pie, or a donut with `inner > 0`. Slices start at twelve o'clock and run
 * clockwise in group order. A value that is zero or negative takes no
 * slice; a lone slice that is the whole is drawn as a full ring, because
 * an arc from a point to itself draws nothing.
 */
export function pieLayout(groups: Group[], cx: number, cy: number, r: number, inner: number): Arc[] {
    const positive = groups.map((g) => Math.max(0, g.value));
    const total = positive.reduce((s, v) => s + v, 0);
    let angle = 0;

    return groups.map((g, i) => {
        const share = total > 0 ? positive[i] / total : 0;
        const sweep = share * Math.PI * 2;
        const start = angle;
        const end = angle + sweep;
        const mid = (start + end) / 2;
        const labelR = inner > 0 ? (r + inner) / 2 : r * 0.62;
        const [lx, ly] = polar(cx, cy, labelR, mid);

        angle = end;

        if (share <= 0) {
            return { key: g.key, d: '', labelX: lx, labelY: ly, share };
        }

        if (share >= 0.99999) {
            // A full turn: two half-arcs, because a single arc to its own start collapses.
            const [ax, ay] = polar(cx, cy, r, 0);
            const [bx, by] = polar(cx, cy, r, Math.PI);
            const outer = `M ${ax} ${ay} A ${r} ${r} 0 1 1 ${bx} ${by} A ${r} ${r} 0 1 1 ${ax} ${ay}`;

            if (inner <= 0) {
                return { key: g.key, d: `${outer} Z`, labelX: lx, labelY: ly, share };
            }

            const [ix, iy] = polar(cx, cy, inner, 0);
            const [jx, jy] = polar(cx, cy, inner, Math.PI);

            return { key: g.key, d: `${outer} Z M ${ix} ${iy} A ${inner} ${inner} 0 1 0 ${jx} ${jy} A ${inner} ${inner} 0 1 0 ${ix} ${iy} Z`, labelX: lx, labelY: ly, share };
        }

        const large = sweep > Math.PI ? 1 : 0;
        const [sx, sy] = polar(cx, cy, r, start);
        const [ex, ey] = polar(cx, cy, r, end);

        if (inner <= 0) {
            return { key: g.key, d: `M ${cx} ${cy} L ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey} Z`, labelX: lx, labelY: ly, share };
        }

        const [isx, isy] = polar(cx, cy, inner, start);
        const [iex, iey] = polar(cx, cy, inner, end);

        return {
            key: g.key,
            d: `M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey} L ${iex} ${iey} A ${inner} ${inner} 0 ${large} 0 ${isx} ${isy} Z`,
            labelX: lx,
            labelY: ly,
            share,
        };
    });
}

export interface LineLayout extends AxisLayout {
    /** The polyline's points, one per group. */
    points: { key: string; x: number; y: number }[];
    /** The `d` of the path joining them. */
    d: string;
}

/** A line through the groups in order, on the column layout's axes. */
export function lineLayout(groups: Group[], width: number, height: number, formatTick: (v: number) => string): LineLayout {
    const base = columnLayout(groups, width, height, formatTick);
    const points = base.rects.map((r, i) => ({ key: r.key, x: r.x + r.w / 2, y: groups[i].value >= 0 ? r.y : r.y + r.h }));
    const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

    return { ...base, points, d };
}

/** Round to the pixel grid for the SVG attributes, so the markup stays short and crisp. */
export const px = (n: number): number => Math.round(n * 2) / 2;
