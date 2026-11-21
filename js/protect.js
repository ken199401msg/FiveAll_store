/* 浮水印與防截圖保護（嚇阻與追查用；網頁無法真正阻止系統截圖） */
(function () {
  'use strict';
  const { sb, h, state, shell, mount, showMsg } = APP;
  const DEF = { watermark: { on: true, title: '五眾店務管理', body: '{使用者} {時間}', opacity: 0.12, density: 3 }, protect: { on: true } };
  let cfg = { watermark: Object.assign({}, DEF.watermark), protect: Object.assign({}, DEF.protect) };
  let loadedAt = 0, email = '';
  let overlay = null;

  async function load(force) {
    if (!force && Date.now() - loadedAt < 300000) return;
    try {
      const { data } = await sb.from('app_settings').select('key,value');
      (data || []).forEach((r) => { if (cfg[r.key]) cfg[r.key] = Object.assign({}, DEF[r.key], r.value); });
      loadedAt = Date.now();
      const s = await sb.auth.getSession();
      email = (s && s.data && s.data.session && s.data.session.user && s.data.session.user.email) || '';
    } catch (e) { /* 讀不到就用預設值 */ }
  }

  function fill(text) {
    const now = new Date();
    const t = now.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
    return String(text || '')
      .replace(/\{使用者\}/g, state.real ? state.real.profile.display_name : (state.profile ? state.profile.display_name : ''))
      .replace(/\{帳號\}/g, email).replace(/\{時間\}/g, t).replace(/\{日期\}/g, t.split(' ')[0]);
  }

  /* 產生 45 度斜向重複圖樣；回傳 { url, size }（size 為 CSS 像素） */
  function wrap(text, n) {
    const out = [];
    String(text || '').split(/\n/).forEach((para) => { for (let i = 0; i < para.length; i += n) out.push(para.slice(i, i + n)); if (!para) out.push(''); });
    return out.filter((l, i, a) => l || i < a.length - 1);
  }
  function pattern(w) {
    const title = fill(w.title), lines = wrap(fill(w.body), 22);
    const k = 2; // 輸出圖片用 2 倍解析度
    const c = document.createElement('canvas');
    const g0 = c.getContext('2d');
    g0.font = 'bold 22px sans-serif'; let textW = g0.measureText(title).width;
    g0.font = '16px sans-serif'; lines.forEach((l) => { textW = Math.max(textW, g0.measureText(l).width); });
    const blockH = (title ? 30 : 0) + lines.length * 21;
    const cell = Math.round(460 - (Math.min(5, Math.max(1, w.density)) - 1) * 80); // 密集度 1(疏)~5(密)
    const S = Math.max(cell, Math.ceil((textW + blockH + 50) / 1.414));
    c.width = S * k; c.height = S * k;
    const g = c.getContext('2d');
    g.scale(k, k); g.translate(S / 2, S / 2); g.rotate(-Math.PI / 4);
    g.globalAlpha = Math.min(0.6, Math.max(0.02, w.opacity));
    g.fillStyle = '#000'; g.textAlign = 'center'; g.textBaseline = 'middle';
    let y = -blockH / 2 + 12;
    if (title) { g.font = 'bold 22px sans-serif'; g.fillText(title, 0, y); y += 30; }
    g.font = '16px sans-serif';
    lines.forEach((l) => { g.fillText(l, 0, y); y += 21; });
    return { url: c.toDataURL('image/png'), size: S };
  }

  function layer(fixed, w) {
    const p = pattern(w || cfg.watermark);
    const d = document.createElement('div');
    d.className = 'wm';
    d.style.cssText = `position:${fixed ? 'fixed' : 'absolute'};left:0;top:0;right:0;bottom:0;pointer-events:none;z-index:${fixed ? 9999 : 5};background-image:url(${p.url});background-size:${p.size}px ${p.size}px;background-repeat:repeat`;
    return d;
  }

  function paintOverlay() {
    if (overlay) { overlay.remove(); overlay = null; }
    if (!state.profile || !cfg.watermark.on) return;
    overlay = layer(true);
    document.body.append(overlay);
  }

  /* 供輸出圖片／PDF 使用：在要輸出的區塊內加上浮水印，回傳移除函式 */
  function attach(el) {
    if (!state.profile || !cfg.watermark.on) return () => {};
    const prev = el.style.position;
    if (!prev) el.style.position = 'relative';
    const d = layer(false);
    el.append(d);
    return () => { d.remove(); el.style.position = prev; };
  }

  /* ---------- 防截圖／防外流保護 ---------- */
  let wired = false;
  function wire() {
    if (wired) return; wired = true;
    const on = () => cfg.protect.on && state.profile;
    const veil = (v) => document.body.classList.toggle('veil', !!v && on());
    document.addEventListener('visibilitychange', () => veil(document.hidden));
    window.addEventListener('pagehide', () => veil(true));
    window.addEventListener('pageshow', () => veil(false));
    document.addEventListener('contextmenu', (e) => { if (on() && !/INPUT|TEXTAREA/.test(e.target.tagName)) e.preventDefault(); });
    document.addEventListener('copy', (e) => { if (on() && !/INPUT|TEXTAREA/.test((e.target || {}).tagName || '')) e.preventDefault(); });
    document.addEventListener('keydown', (e) => {
      if (!on()) return;
      if (e.key === 'PrintScreen') { veil(true); try { navigator.clipboard.writeText(''); } catch (x) { /* ignore */ } setTimeout(() => veil(false), 1500); }
      if ((e.ctrlKey || e.metaKey) && ['p', 's'].includes(String(e.key).toLowerCase())) e.preventDefault();
    });
  }

  async function refresh() {
    await load();
    document.body.classList.toggle('protect', !!(cfg.protect.on && state.profile));
    wire();
    paintOverlay();
  }
  setInterval(() => { if (state.profile) paintOverlay(); }, 60000); // 讓浮水印上的時間保持最新

  /* ---------- 管理頁：浮水印與保護設定（僅超級管理員） ---------- */
  async function renderSettings() {
    if (!state.real || state.real.profile.role !== 'admin') { location.hash = '#home'; return; }
    await load(true);
    const w = Object.assign({}, cfg.watermark), pr = Object.assign({}, cfg.protect);
    const msg = h('div');
    const prev = h('div', { class: 'wmprev' });
    const repaint = () => { const p = pattern(w); prev.style.backgroundImage = `url(${p.url})`; prev.style.backgroundSize = `${p.size}px ${p.size}px`; };
    const onBox = h('input', { type: 'checkbox', checked: w.on, onchange: (e) => { w.on = e.target.checked; } });
    const title = h('input', { type: 'text', maxlength: 30, value: w.title, oninput: (e) => { w.title = e.target.value; repaint(); } });
    const body = h('textarea', { rows: 4, maxlength: 300, value: w.body, oninput: (e) => { w.body = e.target.value; repaint(); } });
    const opLab = h('b', {}, Math.round(w.opacity * 100) + '%');
    const op = h('input', { type: 'range', min: 3, max: 40, step: 1, value: Math.round(w.opacity * 100), oninput: (e) => { w.opacity = Number(e.target.value) / 100; opLab.textContent = e.target.value + '%'; repaint(); } });
    const dnLab = h('b', {}, String(w.density));
    const dn = h('input', { type: 'range', min: 1, max: 5, step: 1, value: w.density, oninput: (e) => { w.density = Number(e.target.value); dnLab.textContent = e.target.value; repaint(); } });
    const pBox = h('input', { type: 'checkbox', checked: pr.on, onchange: (e) => { pr.on = e.target.checked; } });
    const save = h('button', {
      class: 'primary', onclick: async () => {
        save.disabled = true;
        const a = await sb.rpc('admin_set_setting', { p_key: 'watermark', p_value: w });
        const b = !a.error && await sb.rpc('admin_set_setting', { p_key: 'protect', p_value: pr });
        save.disabled = false;
        const err = a.error || (b && b.error);
        if (err) { showMsg(msg, '儲存失敗：' + err.message, 'err'); return; }
        await load(true); await refresh(); showMsg(msg, '已儲存，所有帳號下次開啟頁面時生效', 'ok');
      }
    }, '儲存');
    mount(...shell('wmset', h('h2', {}, '浮水印與保護'),
      h('div', { class: 'card', style: 'max-width:560px' },
        h('label', { class: 'inl' }, onBox, ' 顯示浮水印（畫面與輸出的 PDF／圖片都會有，固定斜 45 度）'),
        h('label', {}, '標題', title),
        h('label', {}, '內文', body),
        h('p', { class: 'meta' }, '內文可用：{使用者}　{帳號}　{時間}　{日期}（會自動換成登入者與當下時間，方便追查外流來源）'),
        h('label', {}, '不透明度 ', opLab, op),
        h('label', {}, '密集度（1 疏 ～ 5 密） ', dnLab, dn),
        prev,
        h('label', { class: 'inl' }, pBox, ' 防截圖保護：禁止選取／複製／列印、切換程式時畫面遮蔽'),
        h('p', { class: 'meta' }, '提醒：網頁無法真正偵測或阻止 iPad／手機的系統截圖；這些措施用於嚇阻與追查。「輸出 PDF／分享圖片」功能不受影響，但輸出檔同樣帶有浮水印。'),
        save, msg)));
    repaint();
  }
  APP.pages.wmset = renderSettings;
  APP.protect = { refresh, attach, pattern };
})();
