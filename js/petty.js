/* 零用金：瀏覽（含收據照片）、新增；只有店長（與超級管理員）可修改、刪除 */
(function () {
  'use strict';
  const { h, mount, shell, sb, showMsg } = APP;
  const L = LIB;
  let sel = null, seq = 0;
  APP.pages.petty = render;

  const canManage = () => { const p = APP.state.profile; return ['admin', 'manager'].includes(p.role) || (p.role === 'accountant' && !!p.can_high); };

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
        const p = await sb.from('petty_cash_photos').select('id,batch_id,photo_path').in('batch_id', batches).order('id');
        photos = p.data || [];
      }
      if (my !== seq) return;
      body.replaceChildren(...build(data || [], photos));
    } catch (e) { if (my === seq) body.replaceChildren(h('div', { class: 'msg err' }, '讀取失敗：' + e.message)); }
  }

  // 縮圖：長邊 1600px、JPEG，手機拍的大圖也能快速上傳
  function shrink(file) {
    return new Promise((resolve, reject) => {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, 1600 / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob((b) => (b ? resolve(b) : reject(new Error('圖片轉換失敗'))), 'image/jpeg', 0.85);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('無法讀取圖片')); };
      img.src = url;
    });
  }
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));

  // 上傳多張照片到 petty-cash，回傳資料表用的路徑
  async function uploadPhotos(list, onProgress) {
    const now = new Date(); const y = String(now.getFullYear()), m = L.pad(now.getMonth() + 1); const folder = 'web-' + uuid();
    const out = [];
    for (let i = 0; i < list.length; i++) {
      onProgress(`上傳照片 ${i + 1} / ${list.length}…`);
      const blob = await shrink(list[i]);
      const name = `${y}/${m}/${folder}/${Date.now()}${i}.jpg`;
      const up = await sb.storage.from('petty-cash').upload(name, blob, { contentType: 'image/jpeg' });
      if (up.error) throw new Error('照片上傳失敗：' + up.error.message);
      out.push('petty-cash/' + name);
    }
    return out;
  }

  function addForm() {
    const t = L.todayTW();
    const date = h('input', { type: 'date', value: `${t.y}-${L.pad(t.m)}-${L.pad(t.d)}` });
    const lines = h('div');
    const mkLine = () => {
      const item = h('input', { type: 'text', placeholder: '品項，例如 衛生紙', maxlength: 60 });
      const amt = h('input', { type: 'number', inputmode: 'numeric', min: 0, placeholder: '金額', style: 'width:100px' });
      const note = h('input', { type: 'text', placeholder: '備註（選填）', maxlength: 100 });
      const el = h('div', { class: 'row' }, item, amt, note, h('button', { class: 'small', title: '移除這一行', onclick: () => { if (lines.children.length > 1) el.remove(); } }, '✕'));
      el._v = () => ({ item: item.value.trim(), amount: amt.value === '' ? null : Math.round(Number(amt.value)), note: note.value.trim() });
      return el;
    };
    lines.append(mkLine());
    const files = h('input', { type: 'file', accept: 'image/*', multiple: true });
    const msg = h('div');
    const btn = h('button', { class: 'small', onclick: async () => {
      const items = [...lines.children].map((e) => e._v()).filter((x) => x.item || x.amount != null);
      if (!items.length) { showMsg(msg, '請輸入品項與金額', 'err'); return; }
      if (items.some((x) => !x.item || x.amount == null || x.amount < 0)) { showMsg(msg, '每一行都要有品項和正確的金額', 'err'); return; }
      btn.disabled = true;
      try {
        const batch = 'web-' + uuid(); const [y, m] = date.value.split('-');
        const paths = [];
        const list = [...files.files];
        for (let i = 0; i < list.length; i++) {
          showMsg(msg, `上傳照片 ${i + 1} / ${list.length}…`, 'info');
          const blob = await shrink(list[i]);
          const name = `${y}/${m}/${batch}/${Date.now()}${i}.jpg`;
          const up = await sb.storage.from('petty-cash').upload(name, blob, { contentType: 'image/jpeg' });
          if (up.error) throw new Error('照片上傳失敗：' + up.error.message);
          paths.push('petty-cash/' + name);
        }
        showMsg(msg, '儲存中…', 'info');
        const { error } = await sb.rpc('petty_add_batch', { p_store: sel.store, p_date: date.value, p_items: items, p_batch: batch, p_photos: paths });
        if (error) throw new Error(error.message);
        sel.y = Number(y); sel.m = Number(m); render();
      } catch (e) { showMsg(msg, '新增失敗：' + e.message, 'err'); btn.disabled = false; }
    } }, '新增這張收據');
    return h('div', { class: 'card', style: 'margin-bottom:12px' }, h('b', {}, `新增零用金（${sel.store}）`),
      h('div', { class: 'row' }, h('label', {}, '日期', date)), lines,
      h('div', { class: 'row' }, h('button', { class: 'small', onclick: () => lines.append(mkLine()) }, '＋ 加一個品項'), h('label', {}, '收據照片（可多張）', files), btn), msg);
  }

  function build(rows, photos) {
    const total = rows.reduce((n, r) => n + (r.amount || 0), 0);
    const groups = [];
    const idx = new Map();
    rows.forEach((r) => { const k = r.batch_id || ('id' + r.id); if (!idx.has(k)) { idx.set(k, groups.length); groups.push({ key: k, date: r.receipt_date, rows: [] }); } groups[idx.get(k)].rows.push(r); });
    const photoBy = {};
    photos.forEach((p) => (photoBy[p.batch_id] = photoBy[p.batch_id] || []).push({ id: p.id, path: p.photo_path }));
    const manage = canManage();
    const list = groups.length ? groups.map((g) => group(g, photoBy[g.key] || [], manage)) : [h('p', { class: 'meta' }, '本月尚無零用金紀錄')];
    return [addForm(), h('div', { class: 'card', style: 'margin-bottom:12px' }, h('b', {}, `${sel.store} ${sel.y} 年 ${sel.m} 月合計：${L.num(total)} 元`), h('span', { class: 'meta', style: 'margin-left:10px' }, `${rows.length} 筆`)),
      h('p', { class: 'meta' }, manage ? '店長可修改（含新增、刪除照片）、刪除；帳務人員只能新增與瀏覽。' : '帳務人員可新增與瀏覽；修改、刪除需由店長處理。'), ...list];
  }

  function group(g, paths, manage) {
    const sub = g.rows.reduce((n, r) => n + (r.amount || 0), 0);
    const photoBox = h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px' });
    const photoBtn = paths.length ? h('button', { class: 'small', onclick: async () => {
      photoBtn.disabled = true; photoBtn.textContent = '載入中…';
      photoBox.replaceChildren();
      for (const ph of paths) {
        const { data, error } = await sb.storage.from('petty-cash').download(ph.path.replace(/^petty-cash\//, ''));
        if (error || !data) { photoBox.append(h('span', { class: 'meta' }, '照片讀取失敗')); continue; }
        const url = URL.createObjectURL(data);
        const fig = h('div', { style: 'width:320px;max-width:100%' }, h('img', { src: url, style: 'width:100%;border:1px solid var(--line);border-radius:8px;display:block' }),
          manage ? h('button', { class: 'small', style: 'margin-top:4px', onclick: async (e) => {
            if (!confirm('確定刪除這張照片？刪除後無法復原。')) return;
            e.target.disabled = true;
            const r = await sb.rpc('petty_delete_photo', { p_id: ph.id });
            if (r.error) { alert('刪除失敗：' + r.error.message); e.target.disabled = false; return; }
            await sb.storage.from('petty-cash').remove([String(r.data).replace(/^petty-cash\//, '')]);
            fig.remove(); URL.revokeObjectURL(url);
          } }, '刪除這張照片') : null);
        photoBox.append(fig);
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
      const files = h('input', { type: 'file', accept: 'image/*', multiple: true });
      const msg = h('span', { class: 'meta' });
      const save = h('button', { class: 'small', onclick: async () => {
        save.disabled = true;
        try {
          const list = [...files.files];
          const paths = list.length ? await uploadPhotos(list, (t) => { msg.textContent = t; }) : [];
          msg.textContent = '儲存中…';
          const u = await sb.rpc('petty_update', { p_id: r.id, p_date: date.value, p_item: item.value, p_amount: Math.round(Number(amt.value)), p_note: note.value });
          if (u.error) throw new Error(u.error.message);
          if (paths.length) { const ph = await sb.rpc('petty_add_photos_by_id', { p_id: r.id, p_photos: paths }); if (ph.error) throw new Error(ph.error.message); }
          render();
        } catch (e) { msg.textContent = '儲存失敗：' + e.message; save.disabled = false; }
      } }, '儲存');
      tr.replaceChildren(h('td', { colspan: 4 }, h('div', { class: 'row' }, date, item, amt, note), h('div', { class: 'row' }, h('label', {}, '新增收據照片', files), save, h('button', { class: 'small', onclick: () => render() }, '取消'), msg)));
    }
    draw();
    return h('div', { class: 'card', style: 'margin-bottom:10px' },
      h('div', {}, h('b', {}, g.date.slice(5).replace('-', '/')), h('span', { class: 'meta', style: 'margin-left:10px' }, `小計 ${L.num(sub)} 元`), ' ', photoBtn),
      h('div', { class: 'tw', style: 'margin-top:8px' }, h('table', {}, h('thead', {}, h('tr', {}, ['品項', '金額', '備註', manage ? '' : null].filter((x) => x !== null).map((t) => h('th', {}, t)))), body)), photoBox);
  }
})();
