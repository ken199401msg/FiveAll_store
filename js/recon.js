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
  function shot1() { // 勾選訊息 → 分享
    return phone('① 長按 → 分享 → 勾選訊息',
      chk(70, true), sv('rect', { x: 48, y: 54, width: 170, height: 44, rx: 10, fill: '#06c755' }), bar(58, 66, 100, '#fff'), bar(58, 80, 70, '#fff'),
      chk(134, true), sv('rect', { x: 48, y: 114, width: 170, height: 44, rx: 10, fill: '#06c755' }), bar(58, 126, 100, '#fff'), bar(58, 140, 70, '#fff'),
      chk(198, true), sv('rect', { x: 48, y: 178, width: 170, height: 44, rx: 10, fill: '#06c755' }), bar(58, 190, 100, '#fff'), bar(58, 204, 70, '#fff'),
      chk(256, false), sv('rect', { x: 48, y: 238, width: 170, height: 36, rx: 10, fill: '#3a3a3c' }), bar(58, 252, 90),
      sv('rect', { x: 14, y: 288, width: 70, height: 28, rx: 8, fill: 'none', stroke: '#777' }), sv('text', { x: 49, y: 307, 'text-anchor': 'middle', 'font-size': 12, fill: '#fff' }, '取消'),
      sv('rect', { x: 96, y: 288, width: 130, height: 28, rx: 8, fill: '#06c755' }), sv('text', { x: 161, y: 307, 'text-anchor': 'middle', 'font-size': 12, fill: '#fff', 'font-weight': 700 }, '分享 (3)'), hl(94, 286, 134, 32));
  }
  function shot2() { // 儲存至記事本
    return phone('② 選「儲存至記事本」',
      sv('rect', { x: 8, y: 120, width: 224, height: 202, rx: 16, fill: '#2c2c2e' }),
      [0, 1, 2, 3].map((i) => sv('circle', { cx: 40 + i * 54, cy: 168, r: 20, fill: '#555' })),
      [0, 1, 2].map((i) => sv('circle', { cx: 40 + i * 54, cy: 232, r: 20, fill: '#555' })),
      sv('line', { x1: 14, x2: 226, y1: 268, y2: 268, stroke: '#555' }),
      [['Keep 筆記', 40], ['儲存至記事本', 110], ['分享至應用程式', 190]].map(([t, x]) => sv('g', {}, sv('rect', { x: x - 14, y: 278, width: 28, height: 22, rx: 5, fill: 'none', stroke: '#aaa' }), sv('text', { x, y: 314, 'text-anchor': 'middle', 'font-size': 9, fill: '#ddd' }, t))),
      hl(70, 272, 80, 50));
  }
  function shot3() { // 記事本貼文：全選拷貝 → 回本頁貼上
    return phone('③ 編輯畫面：全選 → 拷貝（不用貼文）',
      sv('rect', { x: 14, y: 46, width: 212, height: 176, rx: 8, fill: '#111', stroke: '#444' }),
      [0, 1, 2, 3, 4, 5, 6, 7].map((i) => bar(24, 60 + i * 20, 70 + (i % 3) * 30, '#ccc')),
      sv('rect', { x: 14, y: 236, width: 100, height: 34, rx: 8, fill: '#2c2c2e' }), sv('text', { x: 64, y: 258, 'text-anchor': 'middle', 'font-size': 13, fill: '#fff' }, '全選 → 拷貝'),
      sv('rect', { x: 126, y: 236, width: 100, height: 34, rx: 8, fill: '#12507a' }), sv('text', { x: 176, y: 258, 'text-anchor': 'middle', 'font-size': 13, fill: '#fff', 'font-weight': 700 }, '回本頁貼上'),
      hl(10, 232, 108, 42),
      sv('text', { x: 120, y: 300, 'text-anchor': 'middle', 'font-size': 11, fill: '#ddd' }, '一次就能帶入多天'));
  }

  /* ---------- 解析 ---------- */
  function parse(text, aliases, sel) {
    const alSet = [...aliases].sort((a, b) => b.length - a.length);
    const days = [];
    let cur = null;
    const sumPlus = (t) => String(t).split('+').reduce((s, x) => s + (Number(x) || 0), 0);
    const clean = String(text).replace(/[　 ​-‍﻿]/g, ' ').replace(/[／⁄]/g, '/').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 65248)).replace(/[「」『』［］【】\[\]〔〕〈〉《》“”"]/g, ' ');
    for (const raw of clean.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const dm = line.match(/^(\d{1,2})\s*\/\s*(\d{1,2})(?!\d)(?![-~–])(?:\s*[（(][^)）]*[)）])?\s*(?:未)?\s*(?:共)?\s*$/);
      // 備援：整行只有「月 分隔 日 未 共」（分隔符號或空白種類不明時）也視為日期行
      const dm2 = dm || (/未/.test(line) && /共/.test(line) && !/^[^\d]/.test(line) ? line.match(/^(\d{1,2})[^\d\n]{1,6}?(\d{1,2})(?!\d)[^\d]*$/) : null);
      if (dm2) {
        const mo = Number(dm2[1]), da = Number(dm2[2]);
        let y = sel.y;
        if (mo - sel.m > 6) y -= 1; else if (sel.m - mo > 6) y += 1;
        cur = { date: `${y}-${L.pad(mo)}-${L.pad(da)}`, label: `${mo}/${da}`, rows: [], total: null, notes: [] };
        days.push(cur);
        continue;
      }
      if (!cur) continue;
      if (cur.total && alSet.some((a) => line.startsWith(a))) { // 已有「總」行卻又出現師傅行：視為新的一天（日期行沒讀到）
        cur = { date: '', label: `（日期不明，接在 ${cur.label} 之後）`, rows: [], total: null, notes: ['這一天沒有讀到日期行，無法與系統比對'], undated: true };
        days.push(cur);
      }
      const key = line.startsWith('總') ? '總' : alSet.find((a) => line.startsWith(a));
      if (!key) { if (/^\S{1,5}\s+[\d,]+\s+[\d+]+\s+\d+$/.test(line)) cur.notes.push(`「${line}」讀不出是哪位師傅（簡稱未登錄或寫法不同），未列入加總`); continue; }
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
  function check(day, sysDay, nameOf, others) {
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
    if (day.undated) { /* 無日期：不與系統比對 */ }
    else if (!sysDay) issues.push('系統內找不到這一天的日報');
    else {
      const items = sysDay.items;
      day.rows.forEach((r) => {
        let it = items[r.alias];
        // 師傅的業績可能記在其他店（例如軒）：本店沒有時，到其他店同一天找
        if (r.status === 'work' && (!it || it.status !== 'work')) {
          const o = (others || []).find((x) => x.day && x.day.items[r.alias] && x.day.items[r.alias].status === 'work');
          if (o) { it = o.day.items[r.alias]; r.fromStore = o.store; }
        }
        r.sysItem = it || null;
        if (!it) {
          if (r.status === 'work' && !r.bad) { r.flag = Object.assign(r.flag || {}, { a: true }); issues.push(`${nameOf(r.alias)}：LINE 有業績 ${num(r.amount)}，系統本店與其他店都找不到`); }
          return;
        }
        if (r.status === 'work') {
          r.flag = r.flag || {};
          if (it.status !== 'work') { r.flag.a = true; issues.push(`${nameOf(r.alias)}：LINE 有業績，系統為「${L.STATUS[it.status] || it.status}」`); return; }
          if (it.amount !== r.amount) { r.flag.a = true; issues.push(`${nameOf(r.alias)}：業績 LINE ${num(r.amount)}／系統 ${num(it.amount)}`); }
          if (it.walkin !== r.walkin) { r.flag.w = true; issues.push(`${nameOf(r.alias)}：散客 LINE ${r.walkin}／系統 ${it.walkin}`); }
          if (it.count !== r.count) { r.flag.c = true; issues.push(`${nameOf(r.alias)}：總來客 LINE ${r.count}／系統 ${it.count}`); }
        } else if (it.status === 'work') { r.flag = { a: true }; issues.push(`${nameOf(r.alias)}：LINE 為「${r.text}」，系統有業績 ${num(it.amount)}`); }
      });
      Object.keys(items).forEach((al) => { if (items[al].status === 'work' && !day.rows.some((r) => r.alias === al)) issues.push(`${nameOf(al)}：系統有業績 ${num(items[al].amount)}，LINE 沒有這一行`); });
      const moved = day.rows.filter((r) => r.fromStore && r.sysItem).reduce((a, r) => a + r.sysItem.amount, 0); // 記在其他店、但 LINE 算在本店的業績
      day.sysTotal = sysDay.total.amount + moved;
      day.movedAmt = moved;
      if (day.total && day.sysTotal !== day.total.amount) { day.bad.sysA = true; issues.push(`店業績 LINE ${num(day.total.amount)}／系統 ${num(day.sysTotal)}${moved ? `（含記在其他店的 ${num(moved)}）` : ''}`); }
    }
    day.issues = issues;
    return day;
  }

  /* ---------- 畫面 ---------- */
  function dayTable(day, nameOf) {
    const c = (v, flag) => ({ t: v, c: flag ? 'rbad' : '' });
    const body = day.rows.map((r) => {
      if (r.bad) return [nameOf(r.alias), c(num(r.amount), true), c('?', true), c('?', true), ''];
      if (r.status === 'off') return [nameOf(r.alias), { t: r.text, c: (r.flag && r.flag.a) ? 'rbad' : 'lvc' }, '', '', r.flag && r.flag.a ? '系統有業績' : ''];
      const f = r.flag || {};
      const s = r.sysItem;
      const sysT = s && s.status === 'work' ? `系統${r.fromStore ? '（' + r.fromStore + '）' : ''} ${num(s.amount)}／${s.walkin}／${s.count}` : (s ? `系統：${L.STATUS[s.status] || s.status}` : '系統：無');
      return [nameOf(r.alias), c(num(r.amount), f.a), c(r.walkinRaw && r.walkinRaw.includes('+') ? `${r.walkinRaw}=${r.walkin}` : r.walkin, f.w), c(r.count, f.c), day.sys ? { t: sysT, c: f.a || f.w || f.c ? 'rbad sm' : 'sm' } : ''];
    });
    const sumRow = ['加總', c(num(day.sum.a), day.bad.sumA), c(day.sum.w, day.bad.sumW), c(day.sum.c, day.bad.sumC), ''];
    const tot = day.total ? ['店業績（總）', c(num(day.total.amount), day.bad.sumA || day.bad.sysA), c(day.total.walkin, day.bad.sumW), c(day.total.count, day.bad.sumC), day.sys ? { t: `系統 ${num(day.sysTotal != null ? day.sysTotal : day.sys.total.amount)}${day.movedAmt ? '（含其他店 ' + num(day.movedAmt) + '）' : ''}`, c: day.bad.sysA ? 'rbad sm' : 'sm' } : ''] : ['店業績（總）', c('缺', true), '', '', ''];
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
    const mark = async (dates, on) => {
      const r = results;
      const { error } = await sb.rpc('recon_mark', { p_store: r.store, p_dates: dates, p_on: on });
      if (error) { alert('標記失敗：' + error.message); return; }
      dates.forEach((d) => (on ? r.marked.add(d) : r.marked.delete(d)));
      APP.logAction(on ? 'recon_mark' : 'recon_unmark', { store: r.store, dates });
      if (APP.recon.onMark) APP.recon.onMark(r.store, dates, on);
      paint();
    };
    const paint = () => {
      if (!results) return;
      const { days, nameOf } = results;
      const bad = days.filter((d) => d.issues.length);
      const okDays = days.filter((d) => d.date && !d.issues.length && !results.marked.has(d.date));
      const canMark = ['admin', 'manager', 'accountant'].includes(APP.state.profile.role); // 一般帳務人員也可標記已對帳
      out.replaceChildren(
        h('div', { class: 'msg ' + (bad.length ? 'err' : 'ok') }, bad.length ? `共 ${days.length} 天，${bad.length} 天有異常：${bad.map((d) => d.label).join('、')}` : `共 ${days.length} 天，全部正確 ✓`),
        canMark && okDays.length ? h('div', { class: 'act' }, h('button', { class: 'primary', onclick: () => mark(okDays.map((d) => d.date), true) }, `全部正確的 ${okDays.length} 天標記為「已對帳」`)) : null,
        h('label', { class: 'inl' }, onlyBad, ' 只顯示異常的日期'),
        ...days.filter((d) => !onlyBad.checked || d.issues.length).map((d) => h('div', { class: 'rday' },
          h('h4', {}, `${d.label}　`, d.issues.length ? h('span', { class: 'bad' }, `✗ 異常 ${d.issues.length} 項`) : h('span', { class: 'okk' }, '✓ 正確'), results.marked.has(d.date) ? h('span', { class: 'stamp on' }, '已對帳') : null,
            canMark && d.date ? h('button', { class: 'small', style: 'margin-left:10px', onclick: () => {
              const on = !results.marked.has(d.date);
              if (on && d.issues.length && !confirm(`${d.label} 還有 ${d.issues.length} 項異常，確定仍要標記為已對帳？`)) return;
              mark([d.date], on);
            } }, results.marked.has(d.date) ? '取消已對帳' : '標記已對帳') : null),
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
          const dates = days.map((d) => d.date).filter(Boolean).sort();
          if (!dates.length) { out.replaceChildren(h('div', { class: 'msg err' }, '沒有讀到日期行。')); btn.disabled = false; return; }
          const { data, error } = await sb.from('daily_reports').select('store,report_date,total_amount,daily_report_items(name,status,amount,total_count,unfulfilled)')
            .gte('report_date', dates[0]).lte('report_date', dates[dates.length - 1]);
          if (error) throw new Error(error.message);
          const sysBy = {}, otherBy = {};
          (data || []).forEach((r) => {
            const items = {};
            let tot = 0;
            r.daily_report_items.forEach((it) => { items[it.name] = { status: it.status, amount: Number(it.amount || 0), count: Number(it.total_count || 0), walkin: Number(it.unfulfilled || 0) }; if (it.status === 'work') tot += Number(it.amount || 0); });
            const rec = { items, total: { amount: tot } };
            if (r.store === sel.store) sysBy[r.report_date] = rec;
            else if (!L.myStores().includes(r.store)) return; // 無權限的店不納入（含管理員預覽他人視角時）
            else (otherBy[r.report_date] = otherBy[r.report_date] || []).push({ store: r.store, day: rec });
          });
          days.forEach((d) => check(d, sysBy[d.date], nameOf, otherBy[d.date]));
          const mk = await sb.from('recon_marks').select('report_date').eq('store', sel.store).gte('report_date', dates[0]).lte('report_date', dates[dates.length - 1]);
          results = { days, nameOf, store: sel.store, marked: new Set((mk.data || []).map((x) => x.report_date)) };
          APP.logAction('recon', { store: sel.store, days: days.length, bad: days.filter((d) => d.issues.length).length });
          paint();
        } catch (e) { out.replaceChildren(h('div', { class: 'msg err' }, '對帳失敗：' + e.message)); }
        btn.disabled = false;
      }
    }, '送出對帳');
    const pasteBtn = h('button', {
      onclick: async () => {
        try {
          const t = await navigator.clipboard.readText();
          if (!t || !t.trim()) { alert('剪貼簿是空的，請先到 LINE 拷貝一則日報'); return; }
          ta.value = (ta.value ? ta.value.replace(/\s+$/, '') + '\n' : '') + t.trim() + '\n';
        } catch (e) { alert('無法讀取剪貼簿，請在方框內長按後選「貼上」'); }
      }
    }, '貼上剪貼簿（加在下面）');
    const clearBtn = h('button', { onclick: () => { ta.value = ''; out.replaceChildren(); results = null; } }, '清空');
    const steps = h('ol', { class: 'rsteps' },
      ['在 LINE 的日報訊息上「長按」→「分享」', '勾選要對帳的多則日報，按右下「分享」', '選「儲存至記事本」，進入記事本編輯畫面（不用按「貼文」）', '在編輯畫面長按文字，選「全選」→「拷貝」，再按左上 ✕ 離開（不用發佈）', '回到本頁，按下方「貼上剪貼簿」（或在方框內長按貼上）', '按「送出對帳」'].map((t) => h('li', {}, t)));
    return h('details', { class: 'recon' }, h('summary', {}, '日報對帳（貼上 LINE 日報，檢查加總並與系統比對）'),
      h('p', { class: 'meta' }, `店別以上方選擇的「${getSel().store}」為準。格式：姓名 業績 散客 總來客；散客「1+0」會自動加總為 1；最後一行「總」是店業績，會用上面各師傅加總來檢查。`),
      steps,
      h('div', { class: 'rshots' }, shot1(), shot2(), shot3()),
      h('p', { class: 'meta' }, '以上為示意畫面，實際外觀依手機與 LINE 版本而異。LINE 若只能單則拷貝，也可以一則一則拷貝後按「貼上剪貼簿」累加。'),
      ta, h('div', { class: 'act' }, pasteBtn, clearBtn, btn), out);
  }
  APP.recon = { onMark: null, panel, _t: { parse, check } };
})();
