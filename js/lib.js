/* 共用：資料讀取、統計、月份與店別選擇、PDF／圖片輸出 */
(function () {
  'use strict';
  const { sb, h, state } = APP;

  const STATUS = { work: '上班', off: '休假', sick: '病假', annual: '特休', personal: '事假', typhoon: '颱風假', bereavement: '喪假', holiday: '國定假日' };
  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
  const pad = (n) => String(n).padStart(2, '0');
  const num = (n) => Number(n || 0).toLocaleString('en-US');
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) + '%' : '—');
  const div = (a, b) => (b > 0 ? Math.round(a / b) : 0);

  function todayTW() {
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
    return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
  }
  function monthRange(y, m) {
    const last = new Date(y, m, 0).getDate();
    return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(last)}`, last };
  }
  function shiftMonth(y, m, delta) {
    const d = new Date(y, m - 1 + delta, 1);
    return { y: d.getFullYear(), m: d.getMonth() + 1 };
  }

  /* 可選店別：超級管理員、帳務為全部；店長為被授權的店 */
  function myStores() {
    return state.profile.role === 'manager' ? CONFIG.STORES.filter((s) => state.stores.includes(s)) : CONFIG.STORES.slice();
  }

  let therapistCache = null;
  async function therapists() {
    if (therapistCache) return therapistCache;
    const { data, error } = await sb.from('therapists').select('id,name,alias').order('id');
    if (error) throw new Error(error.message);
    therapistCache = data;
    return data;
  }

  /* 讀取某店某月的日報（含明細）並統計 */
  async function loadMonth(store, y, m) {
    const { start, end, last } = monthRange(y, m);
    const [{ data: reports, error }, ths] = await Promise.all([
      sb.from('daily_reports')
        .select('id,report_date,daily_report_items(name,status,amount,total_count,unfulfilled)')
        .eq('store', store).gte('report_date', start).lte('report_date', end).order('report_date'),
      therapists()
    ]);
    if (error) throw new Error(error.message);
    const byAlias = Object.fromEntries(ths.map((t) => [t.alias, t]));
    const days = [];
    for (let d = 1; d <= last; d++) {
      const date = `${y}-${pad(m)}-${pad(d)}`;
      days.push({ date, d, dow: new Date(y, m - 1, d).getDay(), cells: {}, has: false, amount: 0, count: 0, walkin: 0 });
    }
    const dayIdx = Object.fromEntries(days.map((x) => [x.date, x]));
    const tot = {};
    for (const r of reports) {
      const day = dayIdx[r.report_date];
      if (!day) continue;
      day.has = true;
      for (const it of r.daily_report_items) {
        const a = Number(it.amount || 0), c = Number(it.total_count || 0), w = Number(it.unfulfilled || 0);
        day.cells[it.name] = { status: it.status, amount: a, count: c, walkin: w, designated: c - w };
        const t = tot[it.name] || (tot[it.name] = { amount: 0, count: 0, walkin: 0, designated: 0, work: 0, leave: [] });
        if (it.status === 'work') { t.amount += a; t.count += c; t.walkin += w; t.designated += c - w; t.work += 1; day.amount += a; day.count += c; day.walkin += w; }
        else t.leave.push({ date: r.report_date, status: it.status });
      }
    }
    // 師傅欄位順序：依師傅編號；沒有對應者排最後
    const order = (alias) => (byAlias[alias] ? byAlias[alias].id : 9999);
    const aliases = Object.keys(tot).filter((a) => tot[a].work > 0 || tot[a].leave.length).sort((a, b) => order(a) - order(b));
    const nameOf = (alias) => (byAlias[alias] ? byAlias[alias].name : alias);
    const store_t = days.reduce((s, x) => ({ amount: s.amount + x.amount, count: s.count + x.count, walkin: s.walkin + x.walkin, days: s.days + (x.has ? 1 : 0) }), { amount: 0, count: 0, walkin: 0, days: 0 });
    store_t.designated = store_t.count - store_t.walkin;
    return { days, aliases, tot, nameOf, store: store_t, y, m, range: { start, end, last } };
  }

  /* 店別＋月份選擇列。onChange(store,y,m) */
  function picker(sel, onChange) {
    const stores = myStores();
    const storeSel = h('select', { onchange: () => { sel.store = storeSel.value; onChange(); } },
      stores.map((s) => h('option', { value: s, selected: s === sel.store }, s)));
    const label = h('span', { class: 'mo' }, `${sel.y} 年 ${sel.m} 月`);
    const go = (d) => { const n = shiftMonth(sel.y, sel.m, d); sel.y = n.y; sel.m = n.m; onChange(); };
    return h('div', { class: 'bar' },
      storeSel, h('button', { onclick: () => go(-1) }, '◀'), label, h('button', { onclick: () => go(1) }, '▶'),
      h('button', { onclick: () => { const t = todayTW(); sel.y = t.y; sel.m = t.m; onChange(); } }, '本月'));
  }
  function initialSel() {
    const t = todayTW();
    return { store: myStores()[0], y: t.y, m: t.m };
  }

  /* ---------- 輸出：PDF／圖片 ---------- */
  const LIBS = {
    html2canvas: 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
    jspdf: 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js'
  };
  const loading = {};
  function loadLib(name, check) {
    if (check()) return Promise.resolve();
    if (loading[name]) return loading[name];
    loading[name] = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = LIBS[name]; s.onload = res; s.onerror = () => { delete loading[name]; rej(new Error('輸出元件載入失敗，請檢查網路')); };
      document.head.append(s);
    });
    return loading[name];
  }
  async function capture(el) {
    await loadLib('html2canvas', () => window.html2canvas);
    const wraps = [el, ...el.querySelectorAll('.tw')];
    const saved = wraps.map((w) => [w.style.overflow, w.style.width]);
    wraps.forEach((w) => { w.style.overflow = 'visible'; });
    el.style.width = 'max-content';
    const hidden = [...el.querySelectorAll('.noexp')];
    hidden.forEach((x) => { x.style.display = 'none'; });
    try {
      return await window.html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    } finally {
      hidden.forEach((x) => { x.style.display = ''; });
      wraps.forEach((w, i) => { w.style.overflow = saved[i][0]; });
      el.style.width = saved[0][1];
    }
  }
  async function toPdf(el, name) {
    const c = await capture(el);
    await loadLib('jspdf', () => window.jspdf);
    const { jsPDF } = window.jspdf;
    const landscape = c.width >= c.height;
    const pdf = new jsPDF({ orientation: landscape ? 'l' : 'p', unit: 'pt', format: 'a4' });
    const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight(), M = 20;
    const scale = (W - M * 2) / c.width;
    const sliceH = Math.floor((H - M * 2) / scale); // 每頁可放的原圖高度
    for (let y = 0, page = 0; y < c.height; y += sliceH, page++) {
      const part = document.createElement('canvas');
      part.width = c.width; part.height = Math.min(sliceH, c.height - y);
      part.getContext('2d').drawImage(c, 0, y, c.width, part.height, 0, 0, c.width, part.height);
      if (page > 0) pdf.addPage();
      pdf.addImage(part.toDataURL('image/jpeg', 0.92), 'JPEG', M, M, c.width * scale, part.height * scale);
    }
    pdf.save(name + '.pdf');
  }
  async function toImage(el, name) {
    const c = await capture(el);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const file = new File([blob], name + '.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name + '.png'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  /* 輸出按鈕列：getEl 回傳要輸出的區塊 */
  function exportBar(getEl, name, meta) {
    const msg = h('span', { class: 'meta' });
    const run = (kind, fn) => async () => {
      msg.textContent = '產生中…';
      try { await fn(getEl(), name()); msg.textContent = ''; APP.logAction(kind, meta()); }
      catch (e) { msg.textContent = '失敗：' + e.message; }
    };
    return h('div', { class: 'act' },
      h('button', { onclick: run('export_pdf', toPdf) }, '輸出 PDF'),
      h('button', { onclick: run('share_image', toImage) }, '分享圖片'), msg);
  }

  window.LIB = { STATUS, WEEK, pad, num, pct, div, todayTW, monthRange, myStores, loadMonth, picker, initialSel, exportBar };
})();
