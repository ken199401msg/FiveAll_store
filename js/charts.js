/* 輕量 SVG 圖表（不依賴外部套件，輸出 PDF／圖片時可直接擷取） */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const COLORS = ['#145d83', '#e8742f', '#2e8b57', '#8e5ea2'];

  function s(tag, attrs, ...kids) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    for (const k of kids.flat(Infinity)) { if (k != null) el.append(k.nodeType ? k : document.createTextNode(String(k))); }
    return el;
  }
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const f = v / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  const short = (t, n) => (String(t).length > n ? String(t).slice(0, n) + '…' : String(t));

  /* 通用：座標軸＋格線；回傳繪圖區資訊 */
  function frame(o, maxLeft, maxRight, hasRight) {
    const W = o.w || 640, H = o.h || 280;
    const m = { l: 58, r: hasRight ? 52 : 14, t: o.legend ? 40 : 30, b: o.labels.length > 8 ? 62 : 44 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, style: 'max-width:100%;height:auto;display:block', role: 'img', 'aria-label': o.title || '' });
    svg.append(s('rect', { x: 0, y: 0, width: W, height: H, fill: '#fff' }));
    if (o.title) svg.append(s('text', { x: m.l, y: 18, 'font-size': 15, 'font-weight': 700, fill: '#1d2733' }, o.title));
    for (let i = 0; i <= 4; i++) {
      const y = m.t + ph - (ph * i) / 4;
      svg.append(s('line', { x1: m.l, x2: m.l + pw, y1: y, y2: y, stroke: '#e3e8ee' }));
      svg.append(s('text', { x: m.l - 6, y: y + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#667085' }, fmt((maxLeft * i) / 4)));
      if (hasRight) svg.append(s('text', { x: m.l + pw + 6, y: y + 4, 'font-size': 11, fill: '#667085' }, fmt((maxRight * i) / 4)));
    }
    return { svg, m, pw, ph, W, H };
  }
  function xLabels(f, labels, step) {
    const rot = labels.length > 8;
    labels.forEach((t, i) => {
      const x = f.m.l + step * i + step / 2, y = f.m.t + f.ph + 16;
      f.svg.append(s('text', rot
        ? { x, y, 'text-anchor': 'end', 'font-size': 11, fill: '#444', transform: `rotate(-35 ${x} ${y})` }
        : { x, y, 'text-anchor': 'middle', 'font-size': 12, fill: '#444' }, short(t, 6)));
    });
  }
  function legend(f, items) {
    let x = f.m.l;
    items.forEach(([name, color, line]) => {
      f.svg.append(line ? s('line', { x1: x, x2: x + 14, y1: 30, y2: 30, stroke: color, 'stroke-width': 3 }) : s('rect', { x, y: 24, width: 12, height: 12, fill: color, rx: 2 }));
      f.svg.append(s('text', { x: x + 18, y: 34, 'font-size': 12, fill: '#333' }, name));
      x += 18 + name.length * 13 + 14;
    });
  }
  const wrap = (svg) => { const d = document.createElement('div'); d.className = 'chart'; d.append(svg); return d; };
  const valueLabel = (f, x, y, v, color) => f.svg.append(s('text', { x, y: y - 3, 'text-anchor': 'middle', 'font-size': 10, fill: color || '#333' }, fmt(v)));

  /* 單系列長條圖 */
  function bar(o) {
    const max = niceMax(Math.max(...o.values, 0));
    const f = frame(o, max, 0, false);
    const step = f.pw / Math.max(o.labels.length, 1), bw = Math.min(step * 0.6, 46);
    o.values.forEach((v, i) => {
      const h = (v / max) * f.ph, x = f.m.l + step * i + (step - bw) / 2, y = f.m.t + f.ph - h;
      f.svg.append(s('rect', { x, y, width: bw, height: Math.max(h, 0), fill: o.color || COLORS[0], rx: 2 }));
      if (o.labels.length <= 12) valueLabel(f, x + bw / 2, y, v);
    });
    xLabels(f, o.labels, step);
    return wrap(f.svg);
  }

  /* 多系列並排長條圖 */
  function grouped(o) {
    const max = niceMax(Math.max(...o.series.flatMap((x) => x.values), 0));
    const f = frame({ ...o, legend: true }, max, 0, false);
    const step = f.pw / Math.max(o.labels.length, 1), n = o.series.length, bw = Math.min((step * 0.8) / n, 26);
    o.series.forEach((se, si) => se.values.forEach((v, i) => {
      const h = (v / max) * f.ph, x = f.m.l + step * i + (step - bw * n) / 2 + bw * si, y = f.m.t + f.ph - h;
      f.svg.append(s('rect', { x, y, width: bw - 1, height: Math.max(h, 0), fill: se.color || COLORS[si], rx: 2 }));
      if (o.labels.length <= 8) valueLabel(f, x + bw / 2, y, v);
    }));
    legend(f, o.series.map((se, si) => [se.name, se.color || COLORS[si]]));
    xLabels(f, o.labels, step);
    return wrap(f.svg);
  }

  /* 長條（左軸）＋折線（右軸） */
  function combo(o) {
    const maxL = niceMax(Math.max(...o.bars.values, 0));
    const maxR = niceMax(Math.max(...o.lines.flatMap((x) => x.values), 0));
    const f = frame({ ...o, legend: true }, maxL, maxR, true);
    const step = f.pw / Math.max(o.labels.length, 1), bw = Math.min(step * 0.55, 40);
    o.bars.values.forEach((v, i) => {
      const h = (v / maxL) * f.ph;
      f.svg.append(s('rect', { x: f.m.l + step * i + (step - bw) / 2, y: f.m.t + f.ph - h, width: bw, height: Math.max(h, 0), fill: COLORS[0], rx: 2 }));
    });
    o.lines.forEach((li, k) => {
      const color = li.color || COLORS[k + 1];
      const pts = li.values.map((v, i) => [f.m.l + step * i + step / 2, f.m.t + f.ph - (v / maxR) * f.ph]);
      f.svg.append(s('polyline', { points: pts.map((p) => p.join(',')).join(' '), fill: 'none', stroke: color, 'stroke-width': 2.5 }));
      pts.forEach((p) => f.svg.append(s('circle', { cx: p[0], cy: p[1], r: 3.5, fill: color })));
    });
    legend(f, [[o.bars.name, COLORS[0]], ...o.lines.map((li, k) => [li.name, li.color || COLORS[k + 1], true])]);
    xLabels(f, o.labels, step);
    return wrap(f.svg);
  }

  window.CH = { bar, grouped, combo, COLORS };
})();
