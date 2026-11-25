/* 日帳明細：日期 × 師傅（業績、來客、指定）＋店合計＋記事 */
(function () {
  'use strict';
  const { sb, h, state, mount, shell, showMsg, fmtTime } = APP;
  const L = LIB;
  let sel = null; // 登入後第一次開啟頁面時才建立
  let seq = 0;

  APP.pages.daily = render;

  async function loadNotes() {
    const { start, end } = L.monthRange(sel.y, sel.m);
    const { data, error } = await sb.from('daily_notes').select('*').eq('store', sel.store)
      .gte('note_date', start).lte('note_date', end).order('note_date').order('created_at');
    if (error) throw new Error(error.message);
    return data;
  }

  async function render() {
    const my = ++seq;
    if (!sel || (sel.store && !L.myStores().includes(sel.store))) sel = L.initialSel();
    if (!sel.store) {
      mount(...shell('daily', h('h2', {}, '日帳明細'), h('div', { class: 'msg info' }, '尚未授權任何店別，請聯絡管理員。')));
      return;
    }
    const body = h('div', {}, h('p', { class: 'meta' }, '載入中…'));
    mount(...shell('daily', h('h2', {}, '日帳明細'), L.picker(sel, render), body));
    try {
      const rg = L.monthRange(sel.y, sel.m);
      const [data, notes, sch, mk] = await Promise.all([L.loadMonth(sel.store, sel.y, sel.m), loadNotes(), L.loadSchedule(sel.store, sel.y, sel.m).catch(() => null),
        sb.from('recon_marks').select('report_date').eq('store', sel.store).gte('report_date', rg.start).lte('report_date', rg.end)]);
      marks = new Set((mk.data || []).map((x) => x.report_date));
      if (my !== seq) return;
      body.replaceChildren(...build(data, notes, sch));
    } catch (e) {
      if (my === seq) body.replaceChildren(h('div', { class: 'msg err' }, '讀取失敗：' + e.message));
    }
  }

  let marks = new Set();
  const stamps = {};
  APP.recon.onMark = (store, dates, on) => {
    if (store !== (sel && sel.store)) return;
    dates.forEach((dt) => { if (on) marks.add(dt); else marks.delete(dt); if (stamps[dt]) stamps[dt].className = 'stamp' + (on ? ' on' : ''); });
  };

  function build(d, notes, sch) {
    const s = d.store;
    const title = `${sel.store} ${sel.y}年${sel.m}月 日帳明細`;
    const tiles = h('div', { class: 'sum' },
      [['本月業績', L.num(s.amount)], ['來客', L.num(s.count)], ['指定率', L.pct(s.designated, s.count)],
        ['客單價', L.num(L.div(s.amount, s.count))], ['日均業績', L.num(L.div(s.amount, s.days))], ['已營業天數', s.days + ' 天']]
        .map(([k, v]) => h('div', {}, h('b', {}, v), h('span', {}, k))));

    // 休假摘要（可折疊）
    const leaves = d.aliases.filter((a) => d.tot[a].leave.length);
    const leaveBox = h('details', {},
      h('summary', {}, `本月休假（${leaves.reduce((n, a) => n + d.tot[a].leave.length, 0)} 人次）`),
      leaves.length
        ? leaves.map((a) => h('p', { class: 'meta' }, d.nameOf(a) + '：' + d.tot[a].leave.map((x) => `${Number(x.date.slice(8))}日${L.STATUS[x.status] || x.status}`).join('、')))
        : h('p', { class: 'meta' }, '本月尚無休假紀錄'),
      plannedLeaves(d, sch));

    // 表格：手機直立只顯示「業績」，橫放／平板／電腦顯示「業績、來客、指定」等全部欄位
    // wl＝寬版（橫放）儲存格、pn＝窄版（直立）儲存格、hd＝直立時隱藏的欄
    const A = d.aliases;
    const th = (t, o) => h('th', o || {}, t);
    const two = (tag, cls, content, n) => [h(tag, { class: (cls + ' wl').trim(), colspan: n }, content), h(tag, { class: (cls + ' pn').trim() }, content)];
    const head1 = h('tr', {}, th('日期', { class: 'l stk', rowspan: 2 }),
      A.map((a) => two('th', '', d.nameOf(a), 3)), two('th', '', '店合計', 5));
    const head2 = h('tr', { class: 'sub' }, A.map(() => [th('業績'), th('來客', { class: 'hd' }), th('指定', { class: 'hd' })]),
      th('業績'), ['來客', '指定', '散客', '客單價'].map((t) => th(t, { class: 'hd' })));
    const t0 = L.todayTW();
    const todayStr = `${t0.y}-${L.pad(t0.m)}-${L.pad(t0.d)}`;
    const span = A.length * 3 + 5;
    const rows = d.days.map((day) => {
      const we = day.dow === 0 || day.dow === 6 ? ' we' : '';
      const stamp = h('span', { class: 'stamp' + (marks.has(day.date) ? ' on' : '') }, '已對帳');
      stamps[day.date] = stamp;
      const tds = [h('td', { class: 'stk' + we }, `${sel.m}/${day.d} 週${L.WEEK[day.dow]}`, stamp)];
      // 店休：整天沒有業績，整列合併顯示；過去日期沒有日報則標示「無日報」
      if (day.closed) return h('tr', {}, tds, two('td', 'cl', day.closedType === 'typhoon' ? '店休（颱風）' : '店休', span).map((e, i) => { if (i) e.setAttribute('colspan', A.length + 1); return e; }));
      if (!day.has && day.date < todayStr) return h('tr', {}, tds, two('td', 'cl2', '無日報', span).map((e, i) => { if (i) e.setAttribute('colspan', A.length + 1); return e; }));
      for (const a of A) {
        const c = day.cells[a];
        if (!c) tds.push(two('td', we.trim(), '', 3));
        else if (c.status !== 'work') tds.push(two('td', 'lv', L.STATUS[c.status] || c.status, 3));
        else {
          const z = c.amount === 0 && c.count === 0 ? ' zero' : '';
          const k = (we + z).trim();
          tds.push(h('td', { class: k }, L.num(c.amount)), h('td', { class: (k + ' hd').trim() }, c.count), h('td', { class: (k + ' hd').trim() }, c.designated));
        }
      }
      const k = we.trim(), kh = (k + ' hd').trim();
      if (day.has) tds.push(h('td', { class: k }, L.num(day.amount)), h('td', { class: kh }, day.count), h('td', { class: kh }, day.count - day.walkin), h('td', { class: kh }, day.walkin), h('td', { class: kh }, L.num(L.div(day.amount, day.count))));
      else tds.push(two('td', k, '', 5));
      return h('tr', {}, tds);
    });
    const foot = [
      h('tr', { class: 'tot' }, h('td', { class: 'stk' }, '小計'),
        A.map((a) => [h('td', {}, L.num(d.tot[a].amount)), h('td', { class: 'hd' }, d.tot[a].count), h('td', { class: 'hd' }, d.tot[a].designated)]),
        h('td', {}, L.num(s.amount)), [s.count, s.designated, s.walkin, L.num(L.div(s.amount, s.count))].map((v) => h('td', { class: 'hd' }, v))),
      h('tr', { class: 'tot' }, h('td', { class: 'stk' }, '工作日'),
        A.map((a) => two('td', '', d.tot[a].work + ' 天', 3)), two('td', '', s.days + ' 天', 5)),
      h('tr', { class: 'tot' }, h('td', { class: 'stk' }, '指定率'),
        A.map((a) => two('td', '', L.pct(d.tot[a].designated, d.tot[a].count), 3)), two('td', '', L.pct(s.designated, s.count), 5))
    ];
    const table = h('div', { class: 'tw' }, h('table', {}, h('thead', {}, head1, head2), h('tbody', {}, rows), h('tfoot', {}, foot)));

    const notesHost = h('div');
    const sheet = h('div', { class: 'sheet' }, h('h3', {}, title), table, h('h3', { style: 'margin-top:14px' }, '記事'), notesHost);
    const paint = (list) => notesHost.replaceChildren(...noteList(list, refresh));
    async function refresh() {
      try { paint(await loadNotes()); } catch (e) { notesHost.replaceChildren(h('div', { class: 'msg err' }, e.message)); }
    }
    paint(notes);

    const exp = L.exportBar(() => sheet, () => title, () => ({ page: 'daily', store: sel.store, month: `${sel.y}-${L.pad(sel.m)}` }));
    return [APP.recon.panel(() => sel), tiles, leaveBox, APP.canEdit() ? L.orderPanel(d, sel.store, sel.y, sel.m, render) : null, exp, sheet, APP.canEdit() ? addForm(refresh) : null].filter(Boolean);
  }

  /* 預排休假：來自排班表（固定週休與已排的休假） */
  function plannedLeaves(d, sch) {
    if (!sch) return h('p', { class: 'meta' }, '（排班資料讀取失敗）');
    const byAlias = {};
    for (const [key, kind] of sch.entries) {
      if (kind !== 'leave') continue;
      const [date, alias] = key.split('|');
      (byAlias[alias] = byAlias[alias] || []).push(date);
    }
    const names = Object.keys(byAlias);
    const wk = Object.entries(sch.settings.week_off || {}).filter(([, v]) => v.length);
    return h('div', {},
      h('p', { class: 'meta' }, '預排休假（來自排班表）：' + (names.length ? '' : '尚未排班')),
      names.map((a) => h('p', { class: 'meta' }, d.nameOf(a) + '：' + byAlias[a].sort().map((x) => `${Number(x.slice(5, 7))}/${Number(x.slice(8))}`).join('、'))),
      wk.length ? h('p', { class: 'meta' }, '固定週休：' + wk.map(([a, v]) => d.nameOf(a) + ' 週' + v.map((w) => L.WEEK[w]).join('、')).join('；')) : null);
  }

  function noteList(list, refresh) {
    if (!list.length) return [h('p', { class: 'meta' }, '本月尚無記事')];
    const me = state.profile;
    return list.map((n) => h('div', { class: 'note' },
      h('div', {},
        h('div', { class: 'c' }, `${Number(n.note_date.slice(5, 7))}/${Number(n.note_date.slice(8))}　${n.content}`),
        h('div', { class: 'm' }, `${n.created_by_name}　${fmtTime(n.created_at)}`)),
      (APP.canEdit() && (n.created_by === me.id || me.role === 'admin'))
        ? h('button', {
          class: 'small noexp', onclick: async (e) => {
            e.target.disabled = true;
            const { error } = await sb.rpc('note_delete', { p_id: n.id });
            if (error) { e.target.disabled = false; alert('刪除失敗：' + error.message); } else refresh();
          }
        }, '刪除') : null));
  }

  function addForm(refresh) {
    const { start, end } = L.monthRange(sel.y, sel.m);
    const t = L.todayTW();
    const inMonth = t.y === sel.y && t.m === sel.m;
    const date = h('input', { type: 'date', min: start, max: end, value: inMonth ? `${t.y}-${L.pad(t.m)}-${L.pad(t.d)}` : start });
    const text = h('textarea', { placeholder: '輸入記事內容（例如：冷氣報修、師傅調班、客訴處理）', maxlength: 1000 });
    const box = h('div');
    const btn = h('button', {
      class: 'primary', type: 'button', onclick: async () => {
        if (!text.value.trim()) { showMsg(box, '請輸入記事內容', 'err'); return; }
        btn.disabled = true; box.replaceChildren();
        const { error } = await sb.rpc('note_add', { p_store: sel.store, p_date: date.value, p_content: text.value });
        btn.disabled = false;
        if (error) { showMsg(box, '新增失敗：' + error.message, 'err'); return; }
        text.value = ''; showMsg(box, '已新增', 'ok'); refresh();
      }
    }, '新增記事');
    return h('div', { class: 'card' }, h('h3', { style: 'margin:0 0 8px' }, `新增記事（${sel.store}）`), h('label', { style: 'margin-top:0' }, '日期'), date, h('label', {}, '內容'), text, btn, box);
  }
})();
