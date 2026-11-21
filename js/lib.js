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
    const ym = `${y}-${pad(m)}`;
    const [{ data: reports, error }, ths, ord] = await Promise.all([
      sb.from('daily_reports')
        .select('id,report_date,daily_report_items(name,status,amount,total_count,unfulfilled)')
        .eq('store', store).gte('report_date', start).lte('report_date', end).order('report_date'),
      therapists(),
      sb.from('therapist_order').select('ym,aliases').eq('store', store).lte('ym', ym).order('ym', { ascending: false }).limit(1)
    ]);
    if (error) throw new Error(error.message);
    const byAlias = Object.fromEntries(ths.map((t) => [t.alias, t]));
    const days = [];
    for (let d = 1; d <= last; d++) {
      const date = `${y}-${pad(m)}-${pad(d)}`;
      days.push({ date, d, dow: new Date(y, m - 1, d).getDay(), cells: {}, has: false, amount: 0, count: 0, walkin: 0 });
    }
    const dayIdx = Object.fromEntries(days.map((x) => [x.date, x]));
    for (const r of reports) {
      const day = dayIdx[r.report_date];
      if (!day) continue;
      day.has = true;
      for (const it of r.daily_report_items) {
        const a = Number(it.amount || 0), c = Number(it.total_count || 0), w = Number(it.unfulfilled || 0);
        day.cells[it.name] = { status: it.status, amount: a, count: c, walkin: w, designated: c - w };
        if (it.status === 'work') { day.amount += a; day.count += c; day.walkin += w; }
      }
    }
    // 店休日不計入師傅工作日與休假
    // 店休＝店業績為 0，且當日有師傅狀態為颱風假／國定假日（店休、春節、中秋等）；一般個人休假不算
    days.forEach((x) => {
      const st = Object.values(x.cells).map((c) => c.status);
      x.closed = x.has && x.amount === 0 && x.count === 0 && st.some((v) => v === 'typhoon' || v === 'holiday');
      x.closedType = st.includes('typhoon') ? 'typhoon' : 'holiday';
    });
    const tot = {};
    for (const day of days) {
      if (day.closed) continue;
      for (const [name, c] of Object.entries(day.cells)) {
        const t = tot[name] || (tot[name] = { amount: 0, count: 0, walkin: 0, designated: 0, work: 0, leave: [] });
        if (c.status === 'work') { t.amount += c.amount; t.count += c.count; t.walkin += c.walkin; t.designated += c.designated; t.work += 1; }
        else t.leave.push({ date: day.date, status: c.status });
      }
    }
    // 師傅欄位順序：依師傅編號；沒有對應者排最後
    const order = (alias) => (byAlias[alias] ? byAlias[alias].id : 9999);
    let aliases = Object.keys(tot).filter((a) => tot[a].work > 0 || tot[a].leave.length).sort((a, b) => order(a) - order(b));
    // 套用已儲存的排序（沿用最近一次；未在排序中的師傅排在最後）
    const saved = ord && ord.data && ord.data[0] ? ord.data[0] : null;
    if (saved) {
      const idx = new Map(saved.aliases.map((a, i) => [a, i]));
      const pos = (a) => (idx.has(a) ? idx.get(a) : 1000 + order(a));
      aliases = aliases.sort((a, b) => pos(a) - pos(b));
    }
    const nameOf = (alias) => (byAlias[alias] ? byAlias[alias].name : alias);
    const store_t = days.reduce((s, x) => ({ amount: s.amount + x.amount, count: s.count + x.count, walkin: s.walkin + x.walkin, days: s.days + (x.has && !x.closed ? 1 : 0) }), { amount: 0, count: 0, walkin: 0, days: 0 });
    store_t.designated = store_t.count - store_t.walkin;
    return { days, aliases, tot, nameOf, store: store_t, y, m, range: { start, end, last }, orderYm: saved ? saved.ym : null };
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

  /* ---------- 排班設定與紀錄 ---------- */
  const SCHED_DEFAULT = { roster: null, week_off: {}, parttime: [], early: {}, early_label: '早班上班師傅 09:30～下班', weekday_staff: 0, weekend_staff: 0 };
  async function loadSchedule(store, y, m) {
    const { start, end } = monthRange(y, m);
    const [a, b] = await Promise.all([
      sb.from('schedule_settings').select('settings').eq('store', store).maybeSingle(),
      sb.from('schedule_entries').select('work_date,alias,kind').eq('store', store).gte('work_date', start).lte('work_date', end)
    ]);
    if (a.error) throw new Error(a.error.message);
    if (b.error) throw new Error(b.error.message);
    const settings = Object.assign({}, SCHED_DEFAULT, a.data ? a.data.settings : {});
    settings.week_off = settings.week_off || {}; settings.parttime = settings.parttime || []; settings.early = settings.early || {};
    const entries = new Map(b.data.map((r) => [`${r.work_date}|${r.alias}`, r.kind]));
    return { settings, saved: !!a.data, entries };
  }
  /* 尚未儲存名單時：依近 60 天日報有上班的師傅帶入 */
  async function defaultRoster(store) {
    const since = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
    const { data } = await sb.from('daily_reports').select('daily_report_items(name,status)').eq('store', store).gte('report_date', since);
    const set = new Set();
    (data || []).forEach((r) => r.daily_report_items.forEach((i) => { if (i.status === 'work') set.add(i.name); }));
    const ths = await therapists();
    const idx = new Map(ths.map((t, i) => [t.alias, i]));
    return [...set].sort((a, b) => (idx.has(a) ? idx.get(a) : 999) - (idx.has(b) ? idx.get(b) : 999));
  }

  /* ---------- 師傅排序（依店別＋月份儲存） ---------- */
  function orderPanel(d, store, y, m, onSaved) {
    const ym = `${y}-${pad(m)}`;
    let list = d.aliases.slice();
    const box = h('div');
    const msg = h('div');
    const note = d.orderYm ? (d.orderYm === ym ? '本月已儲存排序。' : `目前沿用 ${d.orderYm} 的排序，儲存後會成為本月排序。`) : '目前為預設排序。';
    function swap(i, j) { [list[i], list[j]] = [list[j], list[i]]; paint(); }
    function paint() {
      box.replaceChildren(...list.map((a, i) => h('div', { class: 'ord' },
        h('span', {}, `${i + 1}. ${d.nameOf(a)}`),
        h('span', {},
          h('button', { class: 'small', disabled: i === 0, onclick: () => swap(i, i - 1) }, '▲'), ' ',
          h('button', { class: 'small', disabled: i === list.length - 1, onclick: () => swap(i, i + 1) }, '▼')))));
    }
    paint();
    const run = (fn, okText) => async (e) => {
      e.target.disabled = true; msg.replaceChildren();
      const { error } = await fn();
      e.target.disabled = false;
      if (error) { APP.showMsg(msg, '失敗：' + error.message, 'err'); return; }
      APP.showMsg(msg, okText, 'ok'); onSaved();
    };
    return h('details', {},
      h('summary', {}, '調整師傅順序'),
      h('p', { class: 'meta' }, `${store} ${y} 年 ${m} 月。${note}日帳明細與月結表共用同一份排序。`),
      box,
      h('div', { class: 'row' },
        h('button', { class: 'small', onclick: run(() => sb.rpc('set_therapist_order', { p_store: store, p_ym: ym, p_order: list }), '已儲存排序') }, '儲存排序'),
        h('button', { class: 'small', onclick: run(() => sb.rpc('reset_therapist_order', { p_store: store, p_ym: ym }), '已還原為預設排序') }, '還原預設')),
      msg);
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
    const saved = wraps.map((w) => w.style.overflow);
    wraps.forEach((w) => { w.style.overflow = 'visible'; });
    const hidden = [...el.querySelectorAll('.noexp')];
    hidden.forEach((x) => { x.style.display = 'none'; });
    el.classList.add('exporting'); // 緊湊大字、不換行、寬度依內容
    try {
      await new Promise((r) => setTimeout(r, 50));
      return await window.html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    } finally {
      el.classList.remove('exporting');
      hidden.forEach((x) => { x.style.display = ''; });
      wraps.forEach((w, i) => { w.style.overflow = saved[i]; });
    }
  }
  async function toPdf(el, name) {
    const c = await capture(el);
    await loadLib('jspdf', () => window.jspdf);
    const { jsPDF } = window.jspdf;
    const M = 20, A4W = 595.28, A4H = 841.89;
    const fit = (W, H) => Math.min((W - 2 * M) / c.width, (H - 2 * M) / c.height);
    const sl = fit(A4H, A4W), sp = fit(A4W, A4H); // 橫向、直向各自能放大的倍率
    const s = Math.max(sl, sp);
    if (s * 2 >= 0.55) { // 放得下一頁且字夠大：縮放到單頁、置中
      const pdf = new jsPDF({ orientation: sl >= sp ? 'l' : 'p', unit: 'pt', format: 'a4' });
      const W = pdf.internal.pageSize.getWidth();
      const w = c.width * s, hh = c.height * s;
      pdf.addImage(c.toDataURL('image/jpeg', 0.95), 'JPEG', (W - w) / 2, M, w, hh);
      pdf.save(name + '.pdf');
      return;
    }
    // 內容太長：依寬度縮放並分頁
    const pdf = new jsPDF({ orientation: c.width >= c.height ? 'l' : 'p', unit: 'pt', format: 'a4' });
    const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
    const k = (W - M * 2) / c.width;
    const sliceH = Math.floor((H - M * 2) / k);
    for (let y = 0, page = 0; y < c.height; y += sliceH, page++) {
      const part = document.createElement('canvas');
      part.width = c.width; part.height = Math.min(sliceH, c.height - y);
      part.getContext('2d').drawImage(c, 0, y, c.width, part.height, 0, 0, c.width, part.height);
      if (page > 0) pdf.addPage();
      pdf.addImage(part.toDataURL('image/jpeg', 0.92), 'JPEG', M, M, c.width * k, part.height * k);
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

  window.LIB = { STATUS, WEEK, pad, num, pct, div, todayTW, monthRange, myStores, loadMonth, picker, initialSel, exportBar, orderPanel, therapists, loadSchedule, defaultRoster };
})();
