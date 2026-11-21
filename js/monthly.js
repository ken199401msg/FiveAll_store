/* 月結表：師傅月業績、工作日、平均額、指定率與店務摘要 */
(function () {
  'use strict';
  const { h, mount, shell } = APP;
  const L = LIB;
  const sel = L.initialSel();
  let seq = 0;

  APP.pages.monthly = render;

  async function render() {
    const my = ++seq;
    if (!sel.store) {
      mount(...shell('monthly', h('h2', {}, '月結表'), h('div', { class: 'msg info' }, '尚未授權任何店別，請聯絡管理員。')));
      return;
    }
    const body = h('div', {}, h('p', { class: 'meta' }, '載入中…'));
    mount(...shell('monthly', h('h2', {}, '月結表'), L.picker(sel, render), body));
    try {
      const data = await L.loadMonth(sel.store, sel.y, sel.m);
      if (my !== seq) return;
      body.replaceChildren(...build(data));
    } catch (e) {
      if (my === seq) body.replaceChildren(h('div', { class: 'msg err' }, '讀取失敗：' + e.message));
    }
  }

  function build(d) {
    const s = d.store;
    const title = `${sel.store} ${sel.y}年${sel.m}月 月結表`;
    const list = d.aliases.filter((a) => d.tot[a].work > 0).sort((a, b) => d.tot[b].amount - d.tot[a].amount);
    const th = (t) => h('th', {}, t);
    const head = h('tr', {}, ['師傅', '業績總額', '工作日', '平均額', '總人數', '指定', '指定率', '散客', '休假'].map(th));
    const rows = list.map((a) => {
      const t = d.tot[a];
      return h('tr', {}, h('td', { class: 'l' }, d.nameOf(a)), [L.num(t.amount), t.work, L.num(L.div(t.amount, t.work)), t.count, t.designated, L.pct(t.designated, t.count), t.walkin, t.leave.length].map((v) => h('td', {}, v)));
    });
    const workSum = list.reduce((n, a) => n + d.tot[a].work, 0);
    const leaveSum = d.aliases.reduce((n, a) => n + d.tot[a].leave.length, 0);
    const foot = h('tr', { class: 'tot' }, h('td', { class: 'l' }, '小計'),
      [L.num(s.amount), workSum, L.num(L.div(s.amount, workSum)), s.count, s.designated, L.pct(s.designated, s.count), s.walkin, leaveSum].map((v) => h('td', {}, v)));
    const table = h('div', { class: 'tw' }, h('table', {}, h('thead', {}, head), h('tbody', {}, rows), h('tfoot', {}, foot)));
    const kv = h('div', { class: 'kv' },
      [['客單價', L.num(L.div(s.amount, s.count))], ['日均額（依已營業天數）', L.num(L.div(s.amount, s.days))], ['總人數', L.num(s.count)],
        ['指定數', `${s.designated}（${L.pct(s.designated, s.count)}）`], ['散客數', `${s.walkin}（${L.pct(s.walkin, s.count)}）`], ['已營業天數', s.days + ' 天']]
        .map(([k, v]) => h('div', {}, h('span', {}, k), h('b', {}, v))));
    const sheet = h('div', { class: 'sheet' }, h('h3', {}, title), table,
      h('p', { class: 'big2' }, `總計 ${L.num(s.amount)} 元`), kv,
      h('p', { class: 'meta' }, '平均額＝業績 ÷ 工作日；工作日以日報表中狀態為「上班」的天數計算。'));
    const exp = L.exportBar(() => sheet, () => title, () => ({ page: 'monthly', store: sel.store, month: `${sel.y}-${L.pad(sel.m)}` }));
    return [exp, sheet];
  }
})();
