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
      const [data, notes] = await Promise.all([L.loadMonth(sel.store, sel.y, sel.m), loadNotes()]);
      if (my !== seq) return;
      body.replaceChildren(...build(data, notes));
    } catch (e) {
      if (my === seq) body.replaceChildren(h('div', { class: 'msg err' }, '讀取失敗：' + e.message));
    }
  }

  function build(d, notes) {
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
      h('p', { class: 'meta' }, '排班表上線後，可由排班表／行事曆帶入預排休假。'));

    // 表格
    const A = d.aliases;
    const th = (t, o) => h('th', o || {}, t);
    const head1 = h('tr', {}, th('日期', { class: 'l stk', rowspan: 2 }),
      A.map((a) => th(d.nameOf(a), { colspan: 3 })), th('店合計', { colspan: 5 }));
    const head2 = h('tr', { class: 'sub' }, A.map(() => ['業績', '來客', '指定'].map((t) => th(t))), ['業績', '來客', '指定', '散客', '客單價'].map((t) => th(t)));
    const rows = d.days.map((day) => {
      const we = day.dow === 0 || day.dow === 6 ? ' we' : '';
      const tds = [h('td', { class: 'stk' + we }, `${sel.m}/${day.d} 週${L.WEEK[day.dow]}`)];
      for (const a of A) {
        const c = day.cells[a];
        if (!c) tds.push(h('td', { class: we.trim(), colspan: 3 }, ''));
        else if (c.status !== 'work') tds.push(h('td', { class: 'lv', colspan: 3 }, L.STATUS[c.status] || c.status));
        else {
          const z = c.amount === 0 && c.count === 0 ? ' zero' : '';
          tds.push(h('td', { class: (we + z).trim() }, L.num(c.amount)), h('td', { class: (we + z).trim() }, c.count), h('td', { class: (we + z).trim() }, c.designated));
        }
      }
      if (day.has) tds.push(h('td', { class: we.trim() }, L.num(day.amount)), h('td', { class: we.trim() }, day.count), h('td', { class: we.trim() }, day.count - day.walkin), h('td', { class: we.trim() }, day.walkin), h('td', { class: we.trim() }, L.num(L.div(day.amount, day.count))));
      else tds.push(h('td', { class: we.trim(), colspan: 5 }, ''));
      return h('tr', {}, tds);
    });
    const foot = [
      h('tr', { class: 'tot' }, h('td', { class: 'stk' }, '小計'),
        A.map((a) => [L.num(d.tot[a].amount), d.tot[a].count, d.tot[a].designated].map((v) => h('td', {}, v))),
        [L.num(s.amount), s.count, s.designated, s.walkin, L.num(L.div(s.amount, s.count))].map((v) => h('td', {}, v))),
      h('tr', { class: 'tot' }, h('td', { class: 'stk' }, '工作日'),
        A.map((a) => h('td', { colspan: 3 }, d.tot[a].work + ' 天')), h('td', { colspan: 5 }, s.days + ' 天')),
      h('tr', { class: 'tot' }, h('td', { class: 'stk' }, '指定率'),
        A.map((a) => h('td', { colspan: 3 }, L.pct(d.tot[a].designated, d.tot[a].count))), h('td', { colspan: 5 }, L.pct(s.designated, s.count)))
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
    return [tiles, leaveBox, exp, sheet, addForm(refresh)];
  }

  function noteList(list, refresh) {
    if (!list.length) return [h('p', { class: 'meta' }, '本月尚無記事')];
    const me = state.profile;
    return list.map((n) => h('div', { class: 'note' },
      h('div', {},
        h('div', { class: 'c' }, `${Number(n.note_date.slice(5, 7))}/${Number(n.note_date.slice(8))}　${n.content}`),
        h('div', { class: 'm' }, `${n.created_by_name}　${fmtTime(n.created_at)}`)),
      (n.created_by === me.id || me.role === 'admin')
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
