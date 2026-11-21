/* 日報對帳：貼上 LINE 日報文字 → 檢查加總，並與系統資料比對 */
(function () {
  'use strict';
  const { sb, h } = APP;
  const L = LIB;
  const NS = 'http://www.w3.org/2000/svg';
  const num = (n) => Number(n || 0).toLocaleString('en-US');

  /* ---------- 教學示意圖（重製的示意畫面，不含任何真實資料） ---------- */
  function sv(tag, attrs, ...kids) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, String(v));
    kids.flat().forEach((k) => { if (k != null) e.append(typeof k === 'string' ? document.createTextNode(k) : k); });
    return e;
  }
  const phone = (title, ...inner) => sv('svg', { viewBox: '0 0 240 330', width: 240, height: 330, class: 'rshot' },
    sv('rect', { x: 2, y: 2, width: 236, height: 326, rx: 22, fill: '#1c1c1e', stroke: '#888', 'stroke-width': 2 }),
    sv('text', { x: 120, y: 26, 'text-anchor': 'middle', 'font-size': 13, fill: '#fff', 'font-weight': 700 }, title), inner);
  const bar = (x, y, w, c) => sv('rect', { x, y, width: w, height: 7, rx: 3, fill: c || '#8e8e93' });
  const chk = (y, on) => sv('circle', { cx: 24, cy: y, r: 9, fill: on ? '#06c755' : 'none', stroke: on ? '#06c755' : '#aaa', 'stroke-width': 2 });
  const hl = (x, y, w, hgt) => sv('rect', { x, y, width: w, height: hgt, rx: 8, fill: 'none', stroke: '#ff3b30', 'stroke-width': 3 });
  function shot1() {
    return phone('① 選擇訊息',
      chk(70, false), sv('rect', { x: 48, y: 56, width: 150, height: 38, rx: 10, fill: '#3a3a3c' }), bar(58, 68, 90), bar(58, 80, 60),
      chk(130, true), sv('rect', { x: 48, y: 112, width: 150, height: 74, rx: 10, fill: '#06c755' }), bar(58, 124, 70, '#fff'), bar(58, 138, 110, '#fff'), bar(58, 152, 100, '#fff'), bar(58, 166, 80, '#fff'),
      chk(226, true), sv('rect', { x: 48, y: 200, width: 150, height: 74, rx: 10, fill: '#06c755' }), bar(58, 212, 70, '#fff'), bar(58, 226, 110, '#fff'), bar(58, 240, 100, '#fff'), bar(58, 254, 80, '#fff'),
      sv('rect', { x: 14, y: 288, width: 70, height: 28, rx: 8, fill: 'none', stroke: '#777' }), sv('text', { x: 49, y: 307, 'text-anchor': 'middle', 'font-size': 12, fill: '#fff' }, '取消'),
      sv('rect', { x: 96, y: 288, width: 130, height: 28, rx: 8, fill: '#06c755' }), sv('text', { x: 161, y: 307, 'text-anchor': 'middle', 'font-size': 12, fill: '#fff', 'font-weight': 700 }, '分享 (2)'), hl(94, 286, 134, 32));
  }
  function shot2() {
    return phone('② 選擇傳送對象',
      sv('rect', { x: 8, y: 120, width: 224, height: 202, rx: 16, fill: '#2c2c2e' }),
      [0, 1, 2, 3].map((i) => sv('circle', { cx: 40 + i * 54, cy: 168, r: 20, fill: '#555' })),
      [0, 1, 2].map((i) => sv('circle', { cx: 40 + i * 54, cy: 232, r: 20, fill: '#555' })),
      sv('line', { x1: 14, x2: 226, y1: 268, y2: 268, stroke: '#555' }),
      [['Keep', 36], ['記事本', 100]].map(([t, x]) => sv('g', {}, sv('rect', { x: x - 14, y: 278, width: 28, height: 22, rx: 5, fill: 'none', stroke: '#aaa' }), sv('text', { x, y: 314, 'text-anchor': 'middle', 'font-size': 10, fill: '#ddd' }, t))),
      sv('g', {}, sv('rect', { x: 150, y: 278, width: 28, height: 22, rx: 5, fill: 'none', stroke: '#aaa' }), sv('text', { x: 164, y: 314, 'text-anchor': 'middle', 'font-size': 10, fill: '#ddd' }, '分享至應用程式')),
      hl(126, 272, 76, 50));
  }
  function shot3() {
    return phone('③ 分享選單',
      sv('rect', { x: 8, y: 50, width: 224, height: 272, rx: 16, fill: '#2c2c2e' }),
      sv('rect', { x: 20, y: 62, width: 34, height: 34, rx: 8, fill: '#fff' }), sv('text', { x: 66, y: 76, 'font-size': 12, fill: '#fff', 'font-weight': 700 }, '2 個影像'), bar(66, 84, 90),
      [0, 1, 2, 3].map((i) => sv('circle', { cx: 38 + i * 54, cy: 128, r: 18, fill: '#555' })),
      [0, 1, 2, 3].map((i) => sv('rect', { x: 20 + i * 54, y: 166, width: 36, height: 36, rx: 9, fill: '#4a90e2' })),
      sv('rect', { x: 20, y: 236, width: 36, height: 36, rx: 18, fill: '#666' }), sv('text', { x: 38, y: 290, 'text-anchor': 'middle', 'font-size': 11, fill: '#fff', 'font-weight': 700 }, '拷貝'),
      [1, 2, 3].map((i) => sv('rect', { x: 20 + i * 54, y: 236, width: 36, height: 36, rx: 18, fill: '#444' })),
      hl(14, 228, 48, 74));
  }

  /* ---------- 解析 ---------- */
  function parse(text, aliases, sel) {
    const alSet = [...aliases].sort((a, b) => b.length - a.length);
    const days = [];
    let cur = null;
    const sumPlus = (t) => String(t).split('+').reduce((s, x) => s + (Number(x) || 0), 0);
    for (const raw of String(text).replace(/　/g, ' ').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const dm = line.match(/^(\d{1,2})\/(\d{1,2})\s*(?:未)?\s*(?:共)?$/);
      if (dm) {
        const mo = Number(dm[1]), da = Number(dm[2]);
        let y = sel.y;
        if (mo - sel.m > 6) y -= 1; else if (sel.m - mo > 6) y += 1;
        cur = { date: `${y}-${L.pad(mo)}-${L.pad(da)}`, label: `${mo}/${da}`, rows: [], total: null, notes: [] };
        days.push(cur);
        continue;
      }
      if (!cur) continue;
      const key = line.startsWith('總') ? '總' : alSet.find((a) => line.startsWith(a));
      if (!key) continue;
      const rest = line.slice(key.length).trim();
      const tk = rest.split(/\s+/).filter(Boolean);
      if (!tk.length) continue;
      const first = tk[0].replace(/,/g, '');
      if (/^\d+$/.test(first)) {
        if (tk.length !== 3 || !/^[\d+]+$/.test(tk[1]) || !/^\d+$/.test(tk[2])) { cur.notes.push(`「${line}」格式不完整（需要：業績 散客 總來客）`); cur.rows.push({ alias: key, bad: true, amount: Number(first) }); continue; }
        const rec = { alias: key, status: 'work', amount: Number(first), walkin: sumPlus(tk[1]), count: Number(tk[2]), walkinRaw: tk[1] };
        if (key === '總') cur.total = rec; else cur.rows.push(rec);
      } else if (key !== '總' && tk.length === 1 && tk[0].length <= 2) {
        cur.rows.push({ alias: key, status: 'off', text: tk[0] });
      }
    }
    return days;
  }

  /* ---------- 檢查 ---------- */
  function check(day, sysDay, nameOf) {
    const issues = [];
    const work = day.rows.filter((r) => r.status === 'work');
    const sum = work.reduce((s, r) => ({ a: s.a + r.amount, w: s.w + r.walkin, c: s.c + r.count }), { a: 0, w: 0, c: 0 });
    day.sum = sum;
    const bad = { sumA: false, sumW: false, sumC: false };
    day.notes.forEach((n) => issues.push(n));
    if (!day.total) issues.push('缺少最後一行「總」（店業績）');
    else {
      if (sum.a !== day.total.amount) { bad.sumA = true; issues.push(`業績加總 ${num(sum.a)} ≠ 店業績 ${num(day.total.amount)}（差 ${num(day.total.amount - sum.a)}）`); }
      if (sum.w !== day.total.walkin) { bad.sumW = true; issues.push(`散客加總 ${sum.w} ≠ 店散客 ${day.total.walkin}`); }
      if (sum.c !== day.total.count) { bad.sumC = true; issues.push(`總來客加總 ${sum.c} ≠ 店總來客 ${day.total.count}`); }
    }
    work.forEach((r) => {
      r.flag = {};
      if (r.walkin > r.count) { r.flag.w = r.flag.c = true; issues.push(`${nameOf(r.alias)}：散客 ${r.walkin} 大於總來客 ${r.count}`); }
    });
    const seen = new Set();
    day.rows.forEach((r) => { if (seen.has(r.alias)) issues.push(`${nameOf(r.alias)} 重複出現`); seen.add(r.alias); });
    day.bad = bad;
    // 與系統比對
    day.sys = sysDay || null;
    if (!sysDay) issues.push('系統內找不到這一天的日報');
    else {
      const items = sysDay.items;
      day.rows.forEach((r) => {
        const it = items[r.alias];
        r.sysItem = it || null;
        if (!it) { if (!r.bad) issues.push(`${nameOf(r.alias)}：系統沒有這位師傅的資料`); r.flag = Object.assign(r.flag || {}, { a: true }); return; }
        if (r.status === 'work') {
          r.flag = r.flag || {};
          if (it.status !== 'work') { r.flag.a = true; issues.push(`${nameOf(r.alias)}：LINE 有業績，系統為「${L.STATUS[it.status] || it.status}」`); return; }
          if (it.amount !== r.amount) { r.flag.a = true; issues.push(`${nameOf(r.alias)}：業績 LINE ${num(r.amount)}／系統 ${num(it.amount)}`); }
          if (it.walkin !== r.walkin) { r.flag.w = true; issues.push(`${nameOf(r.alias)}：散客 LINE ${r.walkin}／系統 ${it.walkin}`); }
          if (it.count !== r.count) { r.flag.c = true; issues.push(`${nameOf(r.alias)}：總來客 LINE ${r.count}／系統 ${it.count}`); }
        } else if (it.status === 'work') { r.flag = { a: true }; issues.push(`${nameOf(r.alias)}：LINE 為「${r.text}」，系統有業績 ${num(it.amount)}`); }
      });
      Object.keys(items).forEach((al) => { if (items[al].status === 'work' && !day.rows.some((r) => r.alias === al)) issues.push(`${nameOf(al)}：系統有業績 ${num(items[al].amount)}，LINE 沒有這一行`); });
      if (day.total && sysDay.total.amount !== day.total.amount) { day.bad.sysA = true; issues.push(`店業績 LINE ${num(day.total.amount)}／系統 ${num(sysDay.total.amount)}`); }
    }
    day.issues = issues;
    return day;
  }

  /* ---------- 畫面 ---------- */
  function dayTable(day, nameOf) {
    const c = (v, flag) => ({ t: v, c: flag ? 'rbad' : '' });
    const body = day.rows.map((r) => {
      if (r.bad) return [nameOf(r.alias), c(num(r.amount), true), c('?', true), c('?', true), ''];
      if (r.status === 'off') return [nameOf(r.alias), { t: r.text, c: (r.flag && r.flag.a) ? 'rbad' : 'lvc' }, '', '', r.sysItem && r.sysItem.status !== 'work' ? '' : (r.flag ? '系統有業績' : '')];
      const f = r.flag || {};
      const s = r.sysItem;
      const sysT = s && s.status === 'work' ? `系統 ${num(s.amount)}／${s.walkin}／${s.count}` : (s ? `系統：${L.STATUS[s.status] || s.status}` : '系統：無');
      return [nameOf(r.alias), c(num(r.amount), f.a), c(r.walkinRaw && r.walkinRaw.includes('+') ? `${r.walkinRaw}=${r.walkin}` : r.walkin, f.w), c(r.count, f.c), day.sys ? { t: sysT, c: f.a || f.w || f.c ? 'rbad sm' : 'sm' } : ''];
    });
    const sumRow = ['加總', c(num(day.sum.a), day.bad.sumA), c(day.sum.w, day.bad.sumW), c(day.sum.c, day.bad.sumC), ''];
    const tot = day.total ? ['店業績（總）', c(num(day.total.amount), day.bad.sumA || day.bad.sysA), c(day.total.walkin, day.bad.sumW), c(day.total.count, day.bad.sumC), day.sys ? { t: `系統 ${num(day.sys.total.amount)}`, c: day.bad.sysA ? 'rbad sm' : 'sm' } : ''] : ['店業績（總）', c('缺', true), '', '', ''];
    const cell = (v, i) => { const o = v && typeof v === 'object' ? v : { t: v }; return h('td', { class: ((i === 0 ? 'l ' : '') + (o.c || '')).trim() }, o.t); };
    return h('div', { class: 'tw' }, h('table', {},
      h('thead', {}, h('tr', {}, ['師傅', '業績', '散客', '總來客', day.sys ? '系統（業績／散客／來客）' : ''].map((t, i) => h('th', { class: i === 0 ? 'l' : '' }, t)))),
      h('tbody', {}, body.map((r) => h('tr', {}, r.map(cell))), h('tr', { class: 'tot' }, sumRow.map(cell)), h('tr', { class: 'tot' }, tot.map(cell)))));
  }

  function panel(getSel) {
    const ta = h('textarea', { rows: 9, placeholder: '把從 LINE 拷貝的日報貼在這裡（可一次貼多天）', style: 'font-size:16px' });
    const out = h('div');
    const onlyBad = h('input', { type: 'checkbox' });
    let results = null;
    const paint = () => {
      if (!results) return;
      const { days, nameOf } = results;
      const bad = days.filter((d) => d.issues.length);
      out.replaceChildren(
        h('div', { class: 'msg ' + (bad.length ? 'err' : 'ok') }, bad.length ? `共 ${days.length} 天，${bad.length} 天有異常：${bad.map((d) => d.label).join('、')}` : `共 ${days.length} 天，全部正確 ✓`),
        h('label', { class: 'inl' }, onlyBad, ' 只顯示異常的日期'),
        ...days.filter((d) => !onlyBad.checked || d.issues.length).map((d) => h('div', { class: 'rday' },
          h('h4', {}, `${d.label}　`, d.issues.length ? h('span', { class: 'bad' }, `✗ 異常 ${d.issues.length} 項`) : h('span', { class: 'okk' }, '✓ 正確')),
          dayTable(d, nameOf), d.issues.length ? h('ul', { class: 'rissues' }, d.issues.map((t) => h('li', {}, t))) : null)));
    };
    onlyBad.addEventListener('change', paint);
    const btn = h('button', {
      class: 'primary', onclick: async () => {
        const sel = getSel();
        btn.disabled = true; out.replaceChildren(h('p', { class: 'meta' }, '對帳中…'));
        try {
          const ths = await L.therapists();
          const aliases = ths.map((t) => t.alias);
          const nameOfM = Object.fromEntries(ths.map((t) => [t.alias, t.name]));
          const nameOf = (a) => (a === '總' ? '店' : nameOfM[a] || a);
          const days = parse(ta.value, aliases, sel);
          if (!days.length) { out.replaceChildren(h('div', { class: 'msg err' }, '沒有讀到日期行（例如「11/14」）。請確認貼上的內容。')); btn.disabled = false; return; }
          const dates = days.map((d) => d.date).sort();
          const { data, error } = await sb.from('daily_reports').select('report_date,total_amount,daily_report_items(name,status,amount,total_count,unfulfilled)')
            .eq('store', sel.store).gte('report_date', dates[0]).lte('report_date', dates[dates.length - 1]);
          if (error) throw new Error(error.message);
          const sysBy = {};
          (data || []).forEach((r) => {
            const items = {};
            let tot = 0;
            r.daily_report_items.forEach((it) => { items[it.name] = { status: it.status, amount: Number(it.amount || 0), count: Number(it.total_count || 0), walkin: Number(it.unfulfilled || 0) }; if (it.status === 'work') tot += Number(it.amount || 0); });
            sysBy[r.report_date] = { items, total: { amount: tot } };
          });
          days.forEach((d) => check(d, sysBy[d.date], nameOf));
          results = { days, nameOf };
          APP.logAction('recon', { store: sel.store, days: days.length, bad: days.filter((d) => d.issues.length).length });
          paint();
        } catch (e) { out.replaceChildren(h('div', { class: 'msg err' }, '對帳失敗：' + e.message)); }
        btn.disabled = false;
      }
    }, '送出對帳');
    const steps = h('ol', { class: 'rsteps' },
      ['在 LINE 的日報訊息上「長按」', '點「分享」', '勾選要對帳的訊息（可多則）', '按右下角「分享」', '選「分享至應用程式」', '選「拷貝」', '回到本頁，貼進下方方框', '按「送出對帳」'].map((t) => h('li', {}, t)));
    return h('details', { class: 'recon' }, h('summary', {}, '日報對帳（貼上 LINE 日報，檢查加總並與系統比對）'),
      h('p', { class: 'meta' }, `店別以上方選擇的「${getSel().store}」為準。格式：姓名 業績 散客 總來客；散客「1+0」會自動加總為 1；最後一行「總」是店業績，會用上面各師傅加總來檢查。`),
      steps,
      h('div', { class: 'rshots' }, shot1(), shot2(), shot3()),
      h('p', { class: 'meta' }, '以上為示意畫面，實際外觀依手機與 LINE 版本而異。'),
      ta, h('div', { class: 'act' }, btn), out);
  }
  APP.recon = { panel, _t: { parse, check } };
})();
