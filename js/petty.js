/* 零用金：瀏覽（含收據照片）、新增；只有店長（與超級管理員）可修改、刪除 */
(function () {
  'use strict';
  const { h, mount, shell, sb, showMsg } = APP;
  const L = LIB;
  let sel = null, seq = 0;
  APP.pages.petty = render;

  const canManage = () => ['admin', 'manager'].includes(APP.state.profile.role);

  async function render() {
    const my = ++seq;
    if (!sel || (sel.store && !L.myStores().includes(sel.store))) sel = L.initialSel();
    if (!sel.store) { mount(...shell('petty', h('h2', {}, '零用金'), h('div', { class: 'msg info' }, '尚未授權任何店別，請聯絡管理員。'))); return; }
    const body = h('div', {}, h('p', { class: 'meta' }, '載入中…'));
    mount(...shell('petty', h('h2', {}, '零用金'), L.picker(sel, render), body));
    try {
      const { start, end } = L.monthRange(sel.y, sel.m);
      const { data, error } = await sb.from('petty_cash_receipts').select('id,store,receipt_date,item,amount,note,batch_id')
        .eq('store', sel.store).gte('receipt_date', start).lte('receipt_date', end).order('receipt_date', { ascending: false }).order('id');
      if (error) throw new Error(error.message);
      const batches = [...new Set((data || []).map((r) => r.batch_id).filter(Boolean))];
      let photos = [];
      if (batches.length) {
        const p = await sb.from('petty_cash_photos').select('batch_id,photo_path').in('batch_id', batches).order('id');
        photos = p.data || [];
      }
      if (my !== seq) return;
      body.replaceChildren(...build(data || [], photos));
    } catch (e) { if (my === seq) body.replaceChildren(h('div', { class: 'msg err' }, '讀取失敗：' + e.message)); }
  }

  function addForm() {
    const t = L.todayTW();
    const date = h('input', { type: 'date', value: `${t.y}-${L.pad(t.m)}-${L.pad(t.d)}` });
    const item = h('input', { type: 'text', placeholder: '品項，例如 衛生紙', maxlength: 60 });
    const amt = h('input', { type: 'number', inputmode: 'numeric', min: 0, placeholder: '金額', style: 'width:110px' });
    const note = h('input', { type: 'text', placeholder: '備註（選填）', maxlength: 100 });
    const msg = h('div');
    const btn = h('button', { class: 'small', onclick: async () => {
      if (!item.value.trim()) { showMsg(msg, '請輸入品項', 'err'); return; }
      if (amt.value === '' || Number(amt.value) < 0) { showMsg(msg, '請輸入正確金額', 'err'); return; }
      btn.disabled = true;
      const { error } = await sb.rpc('petty_add', { p_store: sel.store, p_date: date.value, p_item: item.value, p_amount: Math.round(Number(amt.value)), p_note: note.value });
      btn.disabled = false;
      if (error) showMsg(msg, '新增失敗：' + error.message, 'err'); else { const [y, m] = date.value.split('-').map(Number); sel.y = y; sel.m = m; render(); }
    } }, '新增');
    return h('div', { class: 'card', style: 'margin-bottom:12px' }, h('b', {}, `新增零用金（${sel.store}）`),
      h('div', { class: 'row' }, date, item, amt, note, btn), msg);
  }

  function build(rows, photos) {
    const total = rows.reduce((n, r) => n + (r.amount || 0), 0);
    const groups = [];
    const idx = new Map();
    rows.forEach((r) => { const k = r.batch_id || ('id' + r.id); if (!idx.has(k)) { idx.set(k, groups.length); groups.push({ key: k, date: r.receipt_date, rows: [] }); } groups[idx.get(k)].rows.push(r); });
    const photoBy = {};
    photos.forEach((p) => (photoBy[p.batch_id] = photoBy[p.batch_id] || []).push(p.photo_path));
    const manage = canManage();
    const list = groups.length ? groups.map((g) => group(g, photoBy[g.key] || [], manage)) : [h('p', { class: 'meta' }, '本月尚無零用金紀錄')];
    return [addForm(), h('div', { class: 'card', style: 'margin-bottom:12px' }, h('b', {}, `${sel.store} ${sel.y} 年 ${sel.m} 月合計：${L.num(total)} 元`), h('span', { class: 'meta', style: 'margin-left:10px' }, `${rows.length} 筆`)),
      h('p', { class: 'meta' }, manage ? '店長可修改、刪除；帳務人員只能新增與瀏覽。' : '帳務人員可新增與瀏覽；修改、刪除需由店長處理。'), ...list];
  }

  function group(g, paths, manage) {
    const sub = g.rows.reduce((n, r) => n + (r.amount || 0), 0);
    const photoBox = h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px' });
    const photoBtn = paths.length ? h('button', { class: 'small', onclick: async () => {
      photoBtn.disabled = true; photoBtn.textContent = '載入中…';
      photoBox.replaceChildren();
      for (const p of paths) {
        const { data, error } = await sb.storage.from('petty-cash').download(p);
        if (error || !data) { photoBox.append(h('span', { class: 'meta' }, '照片讀取失敗')); continue; }
        const url = URL.createObjectURL(data);
        photoBox.append(h('img', { src: url, style: 'max-width:100%;width:320px;border:1px solid var(--line);border-radius:8px' }));
      }
      photoBtn.remove();
    } }, `查看收據照片（${paths.length}）`) : null;
    const body = h('tbody');
    const draw = () => body.replaceChildren(...g.rows.map((r) => row(r, manage)));
    const rowEls = {};
    function row(r, canEdit) {
      const tr = h('tr', {}, h('td', { class: 'l' }, r.item), h('td', {}, L.num(r.amount)), h('td', { class: 'l' }, r.note || ''),
        canEdit ? h('td', {}, h('button', { class: 'small', onclick: () => edit(r, tr) }, '修改'), ' ', h('button', { class: 'small', onclick: async () => {
          if (!confirm(`確定刪除「${r.item} ${r.amount} 元」？`)) return;
          const { error } = await sb.rpc('petty_delete', { p_id: r.id });
          if (error) alert('刪除失敗：' + error.message); else render();
        } }, '刪除')) : null);
      return tr;
    }
    function edit(r, tr) {
      const date = h('input', { type: 'date', value: r.receipt_date }), item = h('input', { type: 'text', value: r.item, maxlength: 60 });
      const amt = h('input', { type: 'number', value: r.amount, min: 0, style: 'width:100px' }), note = h('input', { type: 'text', value: r.note || '', maxlength: 100 });
      const msg = h('span', { class: 'meta' });
      const save = h('button', { class: 'small', onclick: async () => {
        save.disabled = true;
        const { error } = await sb.rpc('petty_update', { p_id: r.id, p_date: date.value, p_item: item.value, p_amount: Math.round(Number(amt.value)), p_note: note.value });
        save.disabled = false;
        if (error) msg.textContent = '儲存失敗：' + error.message; else render();
      } }, '儲存');
      tr.replaceChildren(h('td', { colspan: 4 }, h('div', { class: 'row' }, date, item, amt, note, save, h('button', { class: 'small', onclick: () => render() }, '取消'), msg)));
    }
    draw();
    return h('div', { class: 'card', style: 'margin-bottom:10px' },
      h('div', {}, h('b', {}, g.date.slice(5).replace('-', '/')), h('span', { class: 'meta', style: 'margin-left:10px' }, `小計 ${L.num(sub)} 元`), ' ', photoBtn),
      h('div', { class: 'tw', style: 'margin-top:8px' }, h('table', {}, h('thead', {}, h('tr', {}, ['品項', '金額', '備註', manage ? '' : null].filter((x) => x !== null).map((t) => h('th', {}, t)))), body)), photoBox);
  }
})();
