/* 分析頁面：店舖分析、師傅個人分析 */
(function () {
  'use strict';
  const { sb, h, state, mount, shell, showMsg } = APP;
  const L = LIB;
  const CH = window.CH;
  let sel = null;          // { store, y, m }
  let tab = 'store';       // store | person
  let person = null;       // 個人分析選擇的師傅簡稱
  let seq = 0;

  APP.pages.analysis = render;

  /* ---------- 小工具 ---------- */
  const ymOf = (y, m) => `${y}-${L.pad(m)}`;
  function addM(ym, d) {
    const [y, m] = ym.split('-').map(Number);
    const t = new Date(y, m - 1 + d, 1);
    return ymOf(t.getFullYear(), t.getMonth() + 1);
  }
  const num = (n) => Number(Math.round(n || 0)).toLocaleString('en-US');
  const sg = (n) => (n > 0 ? '+' : '') + num(n);
  const pct1 = (a, b) => (b > 0 ? ((a / b) * 100).toFixed(1) + '%' : '—');
  const pts = (n) => (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  const up = (n) => (n > 0 ? 'up' : n < 0 ? 'dn' : '');
  function sumRows(rows) {
    const a = { amount: 0, cnt: 0, walkin: 0, work_days: 0 };
    for (const r of rows) { a.amount += r.amount; a.cnt += r.cnt; a.walkin += r.walkin; a.work_days += r.work_days; }
    a.designated = a.cnt - a.walkin;
    return a;
  }
  function groupBy(rows, keyFn) {
    const m = new Map();
    for (const r of rows) { const k = keyFn(r); (m.get(k) || m.set(k, []).get(k)).push(r); }
    return m;
  }
  function table(headers, rows, foot) {
    const td = (v, i, tag) => {
      const o = v && typeof v === 'object' ? v : { t: v };
      return h(tag || 'td', { class: ((i === 0 ? 'l ' : '') + (o.c || '')).trim() }, o.t);
    };
    return h('div', { class: 'tw' }, h('table', {},
      h('thead', {}, h('tr', {}, headers.map((t, i) => h('th', { class: i === 0 ? 'l' : '' }, t)))),
      h('tbody', {}, rows.map((r) => h('tr', {}, r.map((v, i) => td(v, i))))),
      foot ? h('tfoot', {}, h('tr', { class: 'tot' }, foot.map((v, i) => td(v, i)))) : null));
  }
  const section = (title, ...kids) => h('div', { class: 'blk' }, h('h4', {}, title), kids);
  const charts = (...c) => h('div', { class: 'charts' }, c);

  /* ---------- 資料 ---------- */
  async function loadData() {
    const stores = sel.store === '全部' ? L.myStores() : [sel.store];
    const to = L.monthRange(sel.y, sel.m).end;
    const canRate = ['admin', 'accountant'].includes(state.profile.role);
    const [a, b, ths, rt] = await Promise.all([
      sb.rpc('analytics_monthly', { p_stores: stores, p_from: '2020-01-01', p_to: to }),
      sb.rpc('analytics_days', { p_stores: stores, p_from: '2020-01-01', p_to: to }),
      L.therapists(),
      canRate ? sb.from('therapist_rates').select('alias,rate') : Promise.resolve({ data: [] })
    ]);
    for (const r of [a, b, rt]) if (r.error) throw new Error(r.error.message);
    const rows = a.data.map((r) => ({ ...r, amount: Number(r.amount), cnt: Number(r.cnt), walkin: Number(r.walkin), work_days: Number(r.work_days) }));
    const byAlias = Object.fromEntries(ths.map((t) => [t.alias, t]));
    return {
      stores, rows, days: b.data, ths, canRate,
      rates: Object.fromEntries(rt.data.map((r) => [r.alias, Number(r.rate)])),
      nameOf: (al) => (byAlias[al] ? byAlias[al].name : al),
      idOf: (al) => (byAlias[al] ? byAlias[al].id : 9999)
    };
  }

  /* ---------- 版面 ---------- */
  async function render() {
    const my = ++seq;
    if (!sel) { const t = L.todayTW(); sel = { store: '全部', y: t.y, m: t.m }; }
    if (sel.store !== '全部' && !L.myStores().includes(sel.store)) sel.store = '全部';
    if (!L.myStores().length) {
      mount(...shell('analysis', h('h2', {}, '分析'), h('div', { class: 'msg info' }, '尚未授權任何店別，請聯絡管理員。')));
      return;
    }
    const body = h('div', {}, h('p', { class: 'meta' }, '載入中…'));
    mount(...shell('analysis', h('h2', {}, '分析'), controls(), body));
    try {
      const data = await loadData();
      if (my !== seq) return;
      body.replaceChildren(...(tab === 'store' ? await storeView(data) : await personView(data)));
    } catch (e) {
      if (my === seq) body.replaceChildren(h('div', { class: 'msg err' }, '讀取失敗：' + e.message));
    }
  }

  function controls() {
    const stores = ['全部', ...L.myStores()];
    const storeSel = h('select', { onchange: () => { sel.store = storeSel.value; render(); } },
      stores.map((s) => h('option', { value: s, selected: s === sel.store }, s)));
    const go = (d) => { const n = ymOf(sel.y, sel.m); const t = addM(n, d).split('-').map(Number); sel.y = t[0]; sel.m = t[1]; render(); };
    return h('div', {},
      h('div', { class: 'tabs' },
        h('button', { class: tab === 'store' ? 'on' : '', onclick: () => { tab = 'store'; render(); } }, '店舖分析'),
        h('button', { class: tab === 'person' ? 'on' : '', onclick: () => { tab = 'person'; render(); } }, '師傅個人分析')),
      h('div', { class: 'bar' }, storeSel, h('button', { onclick: () => go(-1) }, '◀'), h('span', { class: 'mo' }, `${sel.y} 年 ${sel.m} 月`), h('button', { onclick: () => go(1) }, '▶'),
        h('button', { onclick: () => { const t = L.todayTW(); sel.y = t.y; sel.m = t.m; render(); } }, '本月')));
  }

  /* ---------- 店舖分析 ---------- */
  async function storeView(d) {
    const ym = ymOf(sel.y, sel.m), prev = addM(ym, -1);
    const title = `${sel.store === '全部' ? d.stores.join('＋') : sel.store} ${sel.y}年${sel.m}月 店舖分析`;
    const cur = sumRows(d.rows.filter((r) => r.ym === ym));
    const pre = sumRows(d.rows.filter((r) => r.ym === prev));

    // A：上月與本月
    const metric = (name, a, b, kind) => {
      const diff = b - a;
      return [name, num(a), num(b), { t: sg(diff), c: kind === 'neutral' ? '' : up(diff) }, { t: a > 0 ? pts((diff / a) * 100) : '—', c: kind === 'neutral' ? '' : up(diff) }];
    };
    const rate = (x) => (x.cnt > 0 ? (x.designated / x.cnt) * 100 : 0);
    const A = table(['指標', '上月', '本月', '增減', '增減率'], [
      metric('業績', pre.amount, cur.amount), metric('總來客', pre.cnt, cur.cnt), metric('指定客', pre.designated, cur.designated), metric('散客', pre.walkin, cur.walkin, 'neutral'),
      ['指定率', pct1(pre.designated, pre.cnt), pct1(cur.designated, cur.cnt), { t: pts(rate(cur) - rate(pre)), c: up(rate(cur) - rate(pre)) }, '']]);

    // 本月師傅
    const thisM = [...groupBy(d.rows.filter((r) => r.ym === ym), (r) => r.alias)].map(([al, rs]) => ({ al, ...sumRows(rs) })).sort((a, b) => b.amount - a.amount);
    const lab = thisM.map((x) => d.nameOf(x.al));
    const A2 = thisM.length ? [
      table(['師傅', '業績', '總來客', '指定', '散客', '業績占比'], thisM.map((x) => [d.nameOf(x.al), num(x.amount), x.cnt, x.designated, x.walkin, pct1(x.amount, cur.amount)]),
        ['合計', num(cur.amount), cur.cnt, cur.designated, cur.walkin, '100%']),
      charts(CH.bar({ title: '本月師傅業績', labels: lab, values: thisM.map((x) => x.amount) }),
        CH.grouped({ title: '本月師傅來客結構', labels: lab, series: [{ name: '指定', values: thisM.map((x) => x.designated) }, { name: '散客', values: thisM.map((x) => x.walkin) }] }))
    ] : h('p', { class: 'meta' }, '本月尚無資料');

    // B：近 12 個月
    const months = Array.from({ length: 12 }, (_, i) => addM(ym, i - 11));
    const mrows = months.map((m) => ({ m, ...sumRows(d.rows.filter((r) => r.ym === m)) }));
    const withData = mrows.filter((x) => x.cnt > 0 || x.amount > 0);
    const tot12 = sumRows(withData);
    const B = [
      table(['年月', '業績', '總來客', '指定', '散客', '指定率'], mrows.map((x) => [x.m, num(x.amount), x.cnt, x.designated, x.walkin, pct1(x.designated, x.cnt)]),
        ['近12月合計', num(tot12.amount), tot12.cnt, tot12.designated, tot12.walkin, pct1(tot12.designated, tot12.cnt)]),
      h('p', { class: 'meta' }, `月均業績（有資料月份）：${num(withData.length ? tot12.amount / withData.length : 0)}`),
      charts(CH.bar({ title: '近12個月業績', labels: months.map((m) => m.slice(2)), values: mrows.map((x) => x.amount) }),
        CH.grouped({ title: '近12個月來客（指定／散客）', labels: months.map((m) => m.slice(2)), series: [{ name: '指定', values: mrows.map((x) => x.designated) }, { name: '散客', values: mrows.map((x) => x.walkin) }] }))
    ];

    // C：年度累計各師傅
    const yStart = `${sel.y}-01`;
    const ytd = d.rows.filter((r) => r.ym >= yStart && r.ym <= ym);
    const ysum = sumRows(ytd);
    const yl = [...groupBy(ytd, (r) => r.alias)].map(([al, rs]) => ({ al, ...sumRows(rs) })).sort((a, b) => b.amount - a.amount);
    const ylab = yl.map((x) => d.nameOf(x.al));
    const C = yl.length ? [
      table(['師傅', '年度業績', '總來客', '指定', '散客', '指定率', '客單價', '業績占比'],
        yl.map((x) => [d.nameOf(x.al), num(x.amount), x.cnt, x.designated, x.walkin, pct1(x.designated, x.cnt), num(x.cnt ? x.amount / x.cnt : 0), pct1(x.amount, ysum.amount)]),
        ['合計', num(ysum.amount), ysum.cnt, ysum.designated, ysum.walkin, pct1(ysum.designated, ysum.cnt), num(ysum.cnt ? ysum.amount / ysum.cnt : 0), '100%']),
      charts(CH.bar({ title: '各師傅年度累計業績', labels: ylab, values: yl.map((x) => x.amount) }),
        CH.grouped({ title: '各師傅年度來客', labels: ylab, series: [{ name: '年度指定', values: yl.map((x) => x.designated) }, { name: '年度散客', values: yl.map((x) => x.walkin) }] }))
    ] : h('p', { class: 'meta' }, '本年度尚無資料');

    const sheet = h('div', { class: 'sheet ana' }, h('h3', {}, title),
      section('上月與本月營運總覽', A), section('本月師傅業績與來客', A2),
      section('近 12 個月趨勢', B), section(`各師傅年度累計（${sel.y} 年 1 月至 ${sel.m} 月）`, C));
    return [L.exportBar(() => sheet, () => title, () => ({ page: 'analysis_store', store: sel.store, month: ym })), sheet];
  }

  /* ---------- 師傅個人分析 ---------- */
  async function personView(d) {
    const ym = ymOf(sel.y, sel.m);
    const aliases = [...new Set(d.rows.map((r) => r.alias))].sort((a, b) => d.idOf(a) - d.idOf(b));
    if (!aliases.length) return [h('p', { class: 'meta' }, '尚無資料')];
    if (!person || !aliases.includes(person)) {
      const active = aliases.find((a) => d.rows.some((r) => r.alias === a && r.ym === ym && r.work_days > 0));
      person = active || aliases[0];
    }
    const pSel = h('select', { onchange: () => { person = pSel.value; render(); } },
      aliases.map((a) => h('option', { value: a, selected: a === person }, d.nameOf(a))));
    const picker = h('div', { class: 'bar' }, h('span', { class: 'meta' }, '師傅：'), pSel);

    const mine = d.rows.filter((r) => r.alias === person);
    const byM = new Map([...groupBy(mine, (r) => r.ym)].map(([k, rs]) => [k, sumRows(rs)]));
    const cur = byM.get(ym) || { amount: 0, cnt: 0, walkin: 0, designated: 0, work_days: 0 };
    const past = [...byM.keys()].filter((k) => k < ym && byM.get(k).work_days > 0).sort().reverse();
    const past3 = past.slice(0, 3).reverse();
    const p3 = sumRows(past3.map((k) => byM.get(k)));
    const n3 = past3.length || 1;
    const title = `${d.nameOf(person)} ${sel.y}年${sel.m}月 個人績效`;

    // 本月休假天數（取自排班表）
    const scheds = await Promise.all(d.stores.map((s) => L.loadSchedule(s, sel.y, sel.m).catch(() => null)));
    let leaveDays = 0;
    scheds.forEach((sc) => { if (sc) for (const [k, v] of sc.entries) if (v === 'leave' && k.split('|')[1] === person) leaveDays++; });
    const { last } = L.monthRange(sel.y, sel.m);
    const planned = Math.max(0, last - leaveDays);

    // 與過去 3 個月平均比較
    const cmp = (name, a, b, isPct) => {
      const diff = b - a;
      return [name, isPct ? a.toFixed(1) + '%' : num(a), isPct ? b.toFixed(1) + '%' : num(b), { t: isPct ? pts(diff) : sg(diff), c: up(diff) },
        { t: isPct ? pts(diff) : (a > 0 ? pts((diff / a) * 100) : '—'), c: up(diff) }];
    };
    const r3 = p3.cnt ? (p3.designated / p3.cnt) * 100 : 0, rc = cur.cnt ? (cur.designated / cur.cnt) * 100 : 0;
    const CMP = past3.length ? table(['指標', `過去${past3.length}月平均`, '本月', '增減', '成長／衰退'],
      [cmp('業績', p3.amount / n3, cur.amount), cmp('來客', p3.cnt / n3, cur.cnt), cmp('指定', p3.designated / n3, cur.designated), cmp('指定率', r3, rc, true)])
      : h('p', { class: 'meta' }, '沒有過去月份資料可比較');
    const info = h('p', { class: 'meta' }, `比較期間：${past3.length ? past3.join('、') : '—'}　｜　本月排定休假 ${leaveDays} 天（來自排班表）　｜　本月預計出勤 ${planned} 天`);

    // 本月預估：歷史平均每日業績 × 預計出勤天數
    const hist = sumRows(past.map((k) => byM.get(k)));
    const avgDay = hist.work_days ? hist.amount / hist.work_days : 0;
    const estAmount = avgDay * planned;
    const rate = d.rates[person];
    const est = h('div', {}, table(['歷史平均每日業績', '採用歷史月份', '預計出勤天數', '預估業績'], [[num(avgDay), past.length + ' 個月', planned + ' 天', num(estAmount)]]),
      h('p', { class: 'meta' }, '公式：歷史總業績 ÷ 歷史總出勤天數 × 本月預計出勤天數（本月天數 − 排班表休假天數）。'));

    // 薪資試算：只有超級管理員、帳務可見，且不會出現在輸出的 PDF／圖片
    let salary = null;
    if (d.canRate) {
      const inp = h('input', { type: 'number', min: 0, max: 100, step: 0.5, value: rate != null ? rate * 100 : '', placeholder: '例如 55', style: 'width:90px;padding:8px' });
      const msg = h('div');
      salary = h('div', { class: 'noexp salary' }, h('h4', {}, '薪資試算（僅超級管理員與帳務可見，不會輸出）'),
        h('div', { class: 'row' }, h('label', {}, '抽成比例 %', inp),
          h('button', { class: 'small', onclick: async (e) => {
            const v = Number(inp.value);
            if (!(v >= 0 && v <= 100) || inp.value === '') { showMsg(msg, '請輸入 0 到 100 的數字', 'err'); return; }
            e.target.disabled = true;
            const { error } = await sb.rpc('set_therapist_rate', { p_alias: person, p_rate: v / 100 });
            e.target.disabled = false;
            if (error) showMsg(msg, '儲存失敗：' + error.message, 'err'); else render();
          } }, '儲存比例')),
        rate != null ? table(['本月目前業績', '抽成比例', '本月薪資', '預估薪資'], [[num(cur.amount), (rate * 100).toFixed(1) + '%', num(cur.amount * rate), num(estAmount * rate)]]) : h('p', { class: 'meta' }, '尚未設定抽成比例'), msg);
    }

    // 近 12 個月
    const months = Array.from({ length: 12 }, (_, i) => addM(ym, i - 11));
    const m12 = months.map((m) => ({ m, ...(byM.get(m) || { amount: 0, cnt: 0, walkin: 0, designated: 0 }) }));
    const M12 = [
      table(['年月', '業績', '來客', '指定', '指定率', '客單價'], m12.filter((x) => x.cnt > 0 || x.amount > 0).map((x) => [x.m, num(x.amount), x.cnt, x.designated, pct1(x.designated, x.cnt), num(x.cnt ? x.amount / x.cnt : 0)])),
      charts(CH.combo({ title: '近12個月業績／來客／指定', labels: months.map((m) => m.slice(2)), bars: { name: '業績', values: m12.map((x) => x.amount) }, lines: [{ name: '來客', values: m12.map((x) => x.cnt) }, { name: '指定', values: m12.map((x) => x.designated), color: '#2e8b57' }] }))
    ];

    // 本月日業績明細
    const monthData = await Promise.all(d.stores.map((s) => L.loadMonth(s, sel.y, sel.m).then((x) => ({ s, x })).catch(() => null)));
    const drows = [];
    monthData.forEach((md) => { if (!md) return; md.x.days.forEach((day) => { const c = day.cells[person]; if (c && c.status === 'work' && !day.closed) drows.push({ date: day.date, store: md.s, ...c }); }); });
    drows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.store.localeCompare(b.store)));
    const D = drows.length ? table(['日期', '店別', '業績', '來客', '指定', '散客', '客單價'],
      drows.map((r) => [r.date.slice(5).replace('-', '/'), r.store, num(r.amount), r.count, r.designated, r.walkin, num(r.count ? r.amount / r.count : 0)])) : h('p', { class: 'meta' }, '本月尚無日業績');

    const sheet = h('div', { class: 'sheet ana' }, h('h3', {}, title), info,
      section('本月績效與過去平均比較', CMP), salary, section('本月預估', est),
      section('近 12 個月個人月業績明細', M12), section('本月日業績明細', D));
    return [picker, L.exportBar(() => sheet, () => title, () => ({ page: 'analysis_person', store: sel.store, month: ym, therapist: person })), sheet];
  }
})();
