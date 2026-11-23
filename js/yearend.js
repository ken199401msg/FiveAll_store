/* 年終核對：師傅為欄、月份為列。月獎金＝業績達 90,000 發 500，每多 10,000 加 500。
   資料由 RPC year_end_data 取得（整年完整，不受「資料起始日」截斷）。 */
(function () {
  'use strict';
  const { h, mount, shell, sb } = APP;
  const L = LIB;
  const BASE = 90000, STEP = 10000, UNIT = 500;
  const bonus = (amt) => (amt >= BASE ? (Math.floor((amt - BASE) / STEP) + 1) * UNIT : 0);
  const debugVal = (annual) => Math.round(((annual - BASE * 12) / STEP) * UNIT);
  let sel = null, seq = 0;

  APP.pages.yearend = render;

  async function render() {
    const my = ++seq;
    const stores = L.myStores();
    const opts = stores.length > 1 ? [...stores, '匯總'] : stores.slice();
    if (!sel) sel = { y: L.todayTW().y, store: opts[0] };
    if (!opts.includes(sel.store)) sel.store = opts[0];
    if (!opts.length) { mount(...shell('yearend', h('h2', {}, '年終核對'), h('div', { class: 'msg info' }, '尚未授權任何店別，請聯絡管理員。'))); return; }
    const body = h('div', {}, h('p', { class: 'meta' }, '載入中…'));
    const storeSel = h('select', { onchange: (e) => { sel.store = e.target.value; render(); } }, opts.map((s) => h('option', { value: s, selected: s === sel.store }, s)));
    const picker = h('div', { class: 'row' }, storeSel,
      h('button', { onclick: () => { sel.y--; render(); } }, '◀'), h('b', { style: 'padding:0 10px' }, sel.y + ' 年'), h('button', { onclick: () => { sel.y++; render(); } }, '▶'),
      h('button', { onclick: () => { sel.y = L.todayTW().y; render(); } }, '今年'));
    mount(...shell('yearend', h('h2', {}, '年終核對'), picker, body));
    try {
      const [ths, res] = await Promise.all([L.therapists(), sb.rpc('year_end_data', { p_year: sel.y, p_store: sel.store === '匯總' ? null : sel.store })]);
      if (my !== seq) return;
      if (res.error) throw new Error(res.error.message);
      body.replaceChildren(...build(ths, res.data || []));
    } catch (e) { if (my === seq) body.replaceChildren(h('div', { class: 'msg err' }, '讀取失敗：' + e.message)); }
  }

  function build(ths, rows) {
    const title = `${sel.store} ${sel.y}年 年終核對`;
    const by = {}; // alias -> month(1-12) -> amount
    rows.forEach((r) => { const m = Number(String(r.ym).slice(5, 7)); ((by[r.alias] = by[r.alias] || {})[m] = Number(r.amount || 0)); });
    const order = new Map(ths.map((t, i) => [t.alias, i]));
    const nameOf = (a) => { const t = ths.find((x) => x.alias === a); return t ? t.name : a; };
    const aliases = Object.keys(by).sort((a, b) => (order.has(a) ? order.get(a) : 999) - (order.has(b) ? order.get(b) : 999));
    if (!aliases.length) return [h('p', { class: 'meta' }, `${sel.y} 年尚無日報資料。`)];
    const amt = (a, m) => (by[a][m] || 0);
    const tot = {};
    aliases.forEach((a) => {
      let sum = 0, bon = 0, ok = 0;
      for (let m = 1; m <= 12; m++) { const v = amt(a, m); sum += v; const b = bonus(v); bon += b; if (b > 0) ok++; }
      tot[a] = { sum, bon, ok, dbg: debugVal(sum) };
    });
    const mon = Array.from({ length: 12 }, (_, i) => i + 1);
    const cell = (v) => {
      const b = bonus(v);
      if (!v) return h('td', { class: 'sm' }, '—');
      return h('td', {}, h('div', { style: 'font-size:18px;font-weight:800;color:' + (b ? '#1a7f4b' : '#98a2b3') }, b ? L.num(b) : '未達標'), h('div', { style: 'font-size:11px;color:#667085;font-weight:400' }, L.num(v)));
    };
    const head = h('tr', {}, h('th', {}, '師傅'), mon.map((m) => h('th', {}, m + ' 月')), ['年總業績', '逐月獎金合計', '達標月數', '除錯：(年總−90,000×12)÷10,000×500', '差異＝逐月合計−除錯−達標月數×500'].map((t) => h('th', { class: 'dbg' }, t)));
    const body = aliases.map((a) => {
      const t = tot[a], d = t.bon - t.dbg - t.ok * UNIT;
      return h('tr', {}, h('td', { class: 'l' }, nameOf(a)), mon.map((m) => cell(amt(a, m))),
        h('td', {}, L.num(t.sum)), h('td', { style: 'font-weight:700' }, L.num(t.bon)), h('td', {}, t.ok + ' 月'), h('td', {}, L.num(t.dbg)),
        h('td', { style: d ? 'color:#b54708;font-weight:700' : '' }, L.num(d)));
    });
    const mtot = (m) => aliases.reduce((n, a) => n + amt(a, m), 0);
    const mbon = (m) => aliases.reduce((n, a) => n + bonus(amt(a, m)), 0);
    const foot = [
      h('tr', { class: 'tot' }, h('td', { class: 'l' }, '業績合計'), mon.map((m) => h('td', {}, L.num(mtot(m)))), h('td', {}, L.num(aliases.reduce((n, a) => n + tot[a].sum, 0))), h('td', {}, L.num(aliases.reduce((n, a) => n + tot[a].bon, 0))), h('td', { colspan: 3 })),
      h('tr', {}, h('td', { class: 'l' }, '當月獎金合計'), mon.map((m) => h('td', {}, L.num(mbon(m)))), h('td', { colspan: 5 })),
      h('tr', {}, h('td', { class: 'l' }, '當月達標人數'), mon.map((m) => h('td', {}, aliases.filter((a) => amt(a, m) >= BASE).length + ' 人')), h('td', { colspan: 5 }))
    ];
    const sheet = h('div', { class: 'sheet' }, h('h3', {}, title),
      h('div', { class: 'tw' }, h('table', {}, h('thead', {}, head), h('tbody', {}, body), h('tfoot', {}, foot))),
      h('p', { class: 'meta' }, '月獎金：當月業績達 90,000 發 500，每多 10,000 加 500，未達標為 0。除錯＝個人年總業績直接套公式；「差異」扣掉每個達標月的起算 500 後，若不為 0，代表有月份未達標，或某月業績有不足 10,000 的零頭。本頁為整年完整資料，不受「資料起始日」影響。'));
    return [L.exportBar(() => sheet, () => title, () => ({ page: 'yearend', store: sel.store, year: sel.y })), sheet];
  }
})();
