// Hand-built SVG charts (createElementNS only). Every chart has a data table next to it,
// and every mark has a <title> so hovering shows the exact value.
import { el, svg } from './dom.js';

/**
 * Horizontal bar chart (one series). items: [{ label, value }], value in cents.
 */
export function barChart({ items, format, label, seriesClass = 'series-spend' }) {
  const rowH = 30, labelW = 170, valueW = 96, width = 640;
  const plotW = width - labelW - valueW;
  const max = Math.max(...items.map((d) => d.value), 1);
  const height = items.length * rowH + 8;
  const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart', role: 'img', 'aria-label': label, preserveAspectRatio: 'xMinYMin meet' });
  items.forEach((d, i) => {
    const y = i * rowH + 4;
    const w = Math.max((Math.max(d.value, 0) / max) * plotW, d.value > 0 ? 2 : 0);
    const name = d.label.length > 24 ? d.label.slice(0, 23) + '…' : d.label;
    root.append(
      svg('g', { class: 'bar-row' },
        svg('title', {}, `${d.label}: ${format(d.value)}`),
        svg('text', { x: labelW - 8, y: y + rowH / 2, class: 'chart-label', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, name),
        svg('path', { d: roundedBar(labelW, y + 5, w, rowH - 10), class: `bar ${seriesClass}` }),
        svg('text', { x: labelW + w + 6, y: y + rowH / 2, class: 'chart-value', 'dominant-baseline': 'middle' }, format(d.value)),
        // invisible, larger hit target for hover
        svg('rect', { x: 0, y, width, height: rowH, class: 'hit' })));
  });
  return el('figure', { class: 'chart-figure' }, root);
}

/** A bar with a 4px rounded data end and a square baseline end. */
function roundedBar(x, y, w, h) {
  const r = Math.min(4, w / 2, h / 2);
  if (w <= 0) return '';
  return `M${x},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} H${x} Z`;
}

function columnPath(x, base, w, h) {
  const r = Math.min(4, w / 2, h);
  if (h <= 0) return '';
  const top = base - h;
  return `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${base} Z`;
}

/**
 * Grouped column chart over months. groups: [{ label, values: { key: cents } }],
 * series: [{ key, name, cls }].
 */
export function columnChart({ groups, series, format, formatAxis, label }) {
  const width = 640, height = 260, left = 64, right = 8, top = 12, bottom = 36;
  const plotW = width - left - right, plotH = height - top - bottom;
  const max = Math.max(...groups.flatMap((g) => series.map((s) => g.values[s.key] || 0)), 1);
  const nice = niceMax(max);
  const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart', role: 'img', 'aria-label': label });
  // gridlines + axis labels
  for (let i = 0; i <= 4; i++) {
    const v = (nice / 4) * i;
    const y = top + plotH - (v / nice) * plotH;
    root.append(svg('line', { x1: left, x2: width - right, y1: y, y2: y, class: i === 0 ? 'axis' : 'grid' }));
    root.append(svg('text', { x: left - 6, y, class: 'chart-axis', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, formatAxis(v)));
  }
  const groupW = plotW / Math.max(groups.length, 1);
  const gap = 2;
  const barW = Math.max(Math.min((groupW * 0.7 - gap * (series.length - 1)) / series.length, 40), 3);
  groups.forEach((g, gi) => {
    const totalW = barW * series.length + gap * (series.length - 1);
    const x0 = left + gi * groupW + (groupW - totalW) / 2;
    const base = top + plotH;
    const grp = svg('g', { class: 'col-group' }, svg('title', {}, `${g.label}: ` + series.map((s) => `${s.name} ${format(g.values[s.key] || 0)}`).join(', ')));
    series.forEach((s, si) => {
      const v = Math.max(g.values[s.key] || 0, 0);
      const h = (v / nice) * plotH;
      grp.append(svg('path', { d: columnPath(x0 + si * (barW + gap), base, barW, h), class: `bar ${s.cls}` }));
    });
    grp.append(svg('rect', { x: left + gi * groupW, y: top, width: groupW, height: plotH, class: 'hit' }));
    root.append(grp);
    if (groups.length <= 12 || gi % Math.ceil(groups.length / 12) === 0) {
      root.append(svg('text', { x: left + gi * groupW + groupW / 2, y: height - 14, class: 'chart-axis', 'text-anchor': 'middle' }, g.label));
    }
  });
  const legend = el('ul', { class: 'legend', 'aria-hidden': 'true' },
    series.map((s) => el('li', {}, el('span', { class: `swatch ${s.cls}` }), s.name)));
  return el('figure', { class: 'chart-figure' }, legend, root);
}

function niceMax(v) {
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * exp >= v) return m * exp;
  return 10 * exp;
}
