/* 五眾店務管理 — 登入、註冊、等待開通、帳號管理、紀錄 */
(function () {
  'use strict';
  const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
  const app = document.getElementById('app');
  const ROLE = { admin: '超級管理員', manager: '店長', accountant: '帳務人員', pending: '待開通' };
  const state = { profile: null, stores: [], real: null };
  // 提供給各頁面模組使用
  const APP = window.APP = { sb, h, state, mount, shell, fmtTime, showMsg, logAction, ROLE, pages: {}, canEdit: () => canEdit(), canEditCal: () => canEditCal() };

  /* ---------- 小工具（一律用 textContent，避免 XSS） ---------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  function mount(...nodes) { app.replaceChildren(...nodes); }
  function fmtTime(t) {
    if (!t) return '—';
    return new Date(t).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
  }
  function showMsg(box, text, kind) {
    box.replaceChildren(h('div', { class: 'msg ' + kind }, text));
  }
  function logAction(action, detail) {
    if (!state.profile || state.profile.role === 'pending' || !state.profile.is_active) return;
    sb.rpc('log_action', { p_action: action, p_detail: detail || null }).then(() => {}, () => {});
  }

  /* ---------- 登入／註冊 ---------- */
  function renderAuth(mode) {
    const isLogin = mode === 'login';
    const box = h('div');
    const email = h('input', { type: 'email', autocomplete: 'username', required: true, placeholder: 'name@example.com' });
    const pw = h('input', { type: 'password', autocomplete: isLogin ? 'current-password' : 'new-password', required: true, placeholder: isLogin ? '' : '至少 8 碼' });
    const name = h('input', { type: 'text', autocomplete: 'name', required: true, placeholder: '例如：王小明' });
    const btn = h('button', { class: 'primary', type: 'submit' }, isLogin ? '登入' : '建立帳號');
    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        btn.disabled = true; box.replaceChildren();
        try {
          if (isLogin) {
            const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pw.value });
            if (error) throw new Error('帳號或密碼錯誤');
            await afterSignIn();
          } else {
            if (pw.value.length < 8) throw new Error('密碼至少需要 8 碼');
            const { data, error } = await sb.auth.signUp({
              email: email.value.trim(), password: pw.value,
              options: { data: { display_name: name.value.trim() } }
            });
            if (error) throw new Error(error.message.includes('registered') ? '這個 Email 已經註冊過了' : '註冊失敗：' + error.message);
            if (data.session) await afterSignIn();
            else { showMsg(box, '帳號已建立，請到信箱點擊確認連結後再登入。', 'ok'); }
          }
        } catch (err) { showMsg(box, err.message, 'err'); }
        btn.disabled = false;
      }
    },
      isLogin ? null : [h('label', {}, '姓名'), name],
      h('label', {}, 'Email'), email,
      h('label', {}, '密碼'), pw,
      btn, box);
    mount(h('div', { class: 'auth' },
      h('div', { class: 'brand' }, h('h1', {}, '五眾店務管理'), h('p', {}, isLogin ? '請登入以進入系統' : '建立帳號後，需由管理員開通權限')),
      h('div', { class: 'card' }, form),
      h('div', { class: 'switch' }, isLogin ? '還沒有帳號？' : '已經有帳號？',
        h('button', { class: 'link', type: 'button', onclick: () => renderAuth(isLogin ? 'register' : 'login') }, isLogin ? '建立帳號' : '回登入'))));
  }

  async function afterSignIn() {
    sb.rpc('log_auth_event', { p_event: 'login' }).then(() => {}, () => {});
    await route();
  }

  async function signOut() {
    try { await sb.rpc('log_auth_event', { p_event: 'logout' }); } catch (e) { /* 忽略 */ }
    await sb.auth.signOut();
    state.profile = null; state.stores = [];
    renderAuth('login');
  }

  /* ---------- 載入使用者資料 ---------- */
  async function loadProfile(uid) {
    const { data: p, error } = await sb.from('profiles').select('id,display_name,role,is_active,can_edit,can_analysis,data_from').eq('id', uid).maybeSingle();
    if (error || !p) return null;
    const { data: s } = await sb.from('user_stores').select('store_name').eq('user_id', uid);
    state.stores = (s || []).map((r) => r.store_name);
    state.real = { profile: p, stores: state.stores.slice() };
    return applyView(p);
  }

  /* 超級管理員「檢視視角」：只改變畫面呈現（預覽他人看到的樣子），資料權限仍是管理員本人 */
  const VIEWS = {
    self: ['本人（超級管理員）'],
    'mgr:五健': ['店長｜五健', { role: 'manager' }, ['五健']],
    'mgr:五順': ['店長｜五順', { role: 'manager' }, ['五順']],
    'mgr:all': ['店長｜五健＋五順', { role: 'manager' }, ['五健', '五順']],
    'acc:ro': ['帳務｜僅檢視', { role: 'accountant', can_edit: false, can_analysis: false }],
    'acc:edit': ['帳務｜已授權修改', { role: 'accountant', can_edit: true, can_analysis: false }],
    'acc:full': ['帳務｜授權修改＋分析', { role: 'accountant', can_edit: true, can_analysis: true }]
  };
  function curView() { try { const v = sessionStorage.getItem('viewAs'); return VIEWS[v] ? v : 'self'; } catch (e) { return 'self'; } }
  function applyView(p) {
    if (!p || p.role !== 'admin') return p;
    const v = VIEWS[curView()];
    if (!v[1]) { state.stores = state.real.stores.slice(); return p; }
    state.stores = (v[2] || []).slice();
    return Object.assign({}, p, v[1]);
  }
  function setView(k) {
    try { sessionStorage.setItem('viewAs', k); } catch (e) { /* ignore */ }
    state.profile = applyView(state.real.profile);
    route();
  }

  /* ---------- 版型 ---------- */
  // 帳務人員只能看：首頁、日帳明細、月結表、行事曆；且需授權（can_edit）才能新增／修改
  const ACCT_PAGES = ['home', 'daily', 'monthly', 'calendar', 'password'];
  const canEdit = () => { const p = state.profile; return !!p && (p.role === 'admin' || p.role === 'manager' || (p.role === 'accountant' && !!p.can_edit)); };
  const canEditCal = () => { const p = state.profile; return !!p && (p.role === 'admin' || p.role === 'manager'); }; // 行事曆：帳務一律不可修改
  const canOpen = (k) => !(state.profile.role === 'accountant' && !(ACCT_PAGES.includes(k) || (k === 'analysis' && state.profile.can_analysis)));
  /* 資料更新時間：最新一筆日報的日期與寫入時間 */
  function updateBadge() {
    const el = h('div', { class: 'upd' }, '資料更新時間：讀取中…');
    sb.from('daily_reports').select('report_date,created_at').order('created_at', { ascending: false }).limit(1)
      .then(({ data, error }) => {
        const r = data && data[0];
        el.textContent = error || !r ? '資料更新時間：—' : `資料更新時間：${fmtTime(r.created_at)}（最新日報 ${r.report_date}）`;
      }, () => { el.textContent = '資料更新時間：—'; });
    return el;
  }
  function shell(active, ...content) {
    const p = state.profile;
    const items = [['home', '首頁'], ['daily', '日帳明細'], ['monthly', '月結表'], ['analysis', '分析'], ['schedule', '排班表'], ['calendar', '行事曆']].filter(([k]) => canOpen(k));
    if (p.role === 'admin') items.push(['users', '帳號管理'], ['wmset', '浮水印'], ['logs', '操作紀錄']);
    return [
      h('div', { class: 'topbar' },
        h('div', { class: 't' }, '五眾店務管理'),
        h('div', { class: 'who' }, p.display_name, h('span', { class: 'badge ' + p.role }, ROLE[p.role])),
        state.real && state.real.profile.role === 'admin' ? h('select', { class: 'vsel', title: '檢視視角', onchange: (e) => setView(e.target.value) },
          Object.entries(VIEWS).map(([k, v]) => h('option', { value: k, selected: k === curView() }, k === 'self' ? '視角：本人' : '視角：' + v[0]))) : null,
        h('a', { class: 'small pwl', href: '#password' }, '改密碼'), h('button', { class: 'small', onclick: signOut }, '登出')),
      updateBadge(),
      h('div', { class: 'nav' }, items.map(([k, label]) =>
        h('a', { href: '#' + k, class: k === active ? 'on' : '' }, label))),
      curView() !== 'self' && state.real && state.real.profile.role === 'admin' ? h('div', { class: 'msg info vbar' }, '目前以「' + VIEWS[curView()][0] + '」視角預覽（僅改變畫面，不改變實際權限）。') : null,
      h('div', { class: 'main' }, content)
    ].filter(Boolean);
  }

  function renderPending(reason) {
    const p = state.profile;
    mount(h('div', { class: 'auth' },
      h('div', { class: 'brand' }, h('h1', {}, '五眾店務管理')),
      h('div', { class: 'card center' },
        h('div', { class: 'big' }, reason === 'disabled' ? '🚫' : '⏳'),
        h('h2', {}, reason === 'disabled' ? '帳號已停用' : '等待管理員開通'),
        h('p', {}, reason === 'disabled' ? '請聯絡管理員。' : (p ? p.display_name + '，您好。' : '') + '您的帳號已建立，管理員開通並設定權限後才能使用。'),
        h('button', { onclick: signOut }, '登出'),
        ' ',
        h('button', { onclick: () => route() }, '重新檢查'))));
  }

  /* ---------- 首頁 ---------- */
  function renderHome() {
    const p = state.profile;
    const scope = p.role === 'manager'
      ? (state.stores.length ? '授權店別：' + state.stores.join('、') : '尚未授權任何店別，請聯絡管理員。')
      : '可查看全部店別';
    const pages = [
      ['daily', '日帳明細', '每日各師傅業績、來客、指定與記事'],
      ['monthly', '月結表', '師傅月業績、工作日、指定率'],
      ['analysis', '分析', '店舖與個人績效分析'],
      ['schedule', '排班表', '每月排班、固定週休與一鍵帶入休假'],
      ['calendar', '行事曆', '週曆與休假、早班師傅，可輸出 PDF']
    ];
    mount(...shell('home',
      h('h2', {}, '歡迎，' + p.display_name),
      h('p', { class: 'meta' }, scope),
      h('div', { class: 'grid' }, pages.filter(([k]) => !k || canOpen(k)).map(([k, t, d]) => k
        ? h('a', { class: 'tile', href: '#' + k }, h('h3', {}, t), h('p', {}, d))
        : h('div', { class: 'tile off' }, h('h3', {}, t, h('span', { class: 'badge' }, '開發中')), h('p', {}, d))))));
  }

  /* ---------- 帳號管理（僅超級管理員） ---------- */
  async function renderUsers() {
    const list = h('div', {}, h('p', { class: 'meta' }, '載入中…'));
    mount(...shell('users', h('h2', {}, '帳號管理'),
      h('p', { class: 'meta' }, '新註冊的帳號預設為「待開通」。設定角色與店別；「資料起始日」之前的資料該帳號看不到（留空＝不限制）。修改授權後，對方需重新登入才會生效。'), list));
    const { data, error } = await sb.rpc('admin_list_users');
    if (error) { list.replaceChildren(h('div', { class: 'msg err' }, '讀取失敗：' + error.message)); return; }
    const heads = ['帳號', '角色', ...CONFIG.STORES, '啟用', '可修改', '可看分析', '資料起始日', '', ''];
    list.replaceChildren(h('div', { class: 'tw utbl' }, h('table', {},
      h('thead', {}, h('tr', {}, heads.map((t, i) => h('th', { class: i === 0 ? 'l' : '' }, t)))),
      h('tbody', {}, data.map(userRow)))));
  }

  function userRow(u) {
    const me = u.id === state.profile.id;
    const roleSel = h('select', { disabled: me },
      ['pending', 'manager', 'accountant', 'admin'].map((r) => h('option', { value: r, selected: r === u.role }, ROLE[r])));
    const storeCb = CONFIG.STORES.map((s) => h('input', { type: 'checkbox', value: s, checked: u.stores.includes(s) }));
    const cbx = (v, dis) => h('input', { type: 'checkbox', checked: v, disabled: dis });
    const active = cbx(u.is_active, me), edit = cbx(u.can_edit, me), ana = cbx(u.can_analysis, me);
    const from = h('input', { type: 'date', value: u.data_from || '', disabled: u.role === 'admin' });
    const msg = h('span', { class: 'meta' });
    const save = h('button', {
      class: 'small',
      onclick: async () => {
        save.disabled = true; msg.textContent = '';
        try {
          if (!me && roleSel.value !== u.role) await must(sb.rpc('admin_set_role', { p_user: u.id, p_role: roleSel.value }));
          const stores = storeCb.filter((c) => c.checked).map((c) => c.value);
          if (stores.join() !== u.stores.join()) await must(sb.rpc('admin_set_stores', { p_user: u.id, p_stores: stores }));
          if (!me && edit.checked !== u.can_edit) await must(sb.rpc('admin_set_can_edit', { p_user: u.id, p_can: edit.checked }));
          if (!me && ana.checked !== u.can_analysis) await must(sb.rpc('admin_set_can_analysis', { p_user: u.id, p_can: ana.checked }));
          if (!me && active.checked !== u.is_active) await must(sb.rpc('admin_set_active', { p_user: u.id, p_active: active.checked }));
          if ((from.value || null) !== (u.data_from || null)) await must(sb.rpc('admin_set_data_from', { p_user: u.id, p_date: from.value || null }));
          u.role = roleSel.value; u.can_edit = edit.checked; u.can_analysis = ana.checked; u.is_active = active.checked; u.stores = stores; u.data_from = from.value || null;
          msg.textContent = '已儲存 ✓';
        } catch (e) { msg.textContent = '失敗：' + e.message; }
        save.disabled = false;
      }
    }, '儲存');
    const reset = h('button', {
      class: 'small', disabled: me, onclick: async () => {
        const pw = window.prompt(`幫「${u.display_name}」設定新密碼（至少 8 碼）：`);
        if (pw === null) return;
        if (pw.length < 8) { msg.textContent = '密碼至少需要 8 碼'; return; }
        const { error } = await sb.rpc('admin_set_password', { p_user: u.id, p_password: pw });
        msg.textContent = error ? '失敗：' + error.message : '密碼已更新，請告知對方（對方會被登出）';
      }
    }, '重設密碼');
    return h('tr', {},
      h('td', { class: 'l' }, h('b', {}, u.display_name), me ? ' (我)' : '', h('div', { class: 'em' }, u.email), h('div', { class: 'em' }, '最近登入：' + fmtTime(u.last_sign_in_at))),
      h('td', {}, roleSel), storeCb.map((c) => h('td', {}, c)),
      h('td', {}, active), h('td', {}, edit), h('td', {}, ana), h('td', {}, from),
      h('td', {}, save, h('div', {}, msg)), h('td', {}, reset));
  }

  /* ---------- 修改自己的密碼（所有帳號） ---------- */
  function renderPassword() {
    const msg = h('div');
    const p1 = h('input', { type: 'password', autocomplete: 'new-password', placeholder: '至少 8 碼' });
    const p2 = h('input', { type: 'password', autocomplete: 'new-password', placeholder: '再輸入一次' });
    const btn = h('button', { class: 'primary', type: 'submit' }, '更新密碼');
    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault(); msg.replaceChildren();
        if (p1.value.length < 8) { showMsg(msg, '密碼至少需要 8 碼', 'err'); return; }
        if (p1.value !== p2.value) { showMsg(msg, '兩次輸入不一致', 'err'); return; }
        btn.disabled = true;
        const { error } = await sb.auth.updateUser({ password: p1.value });
        btn.disabled = false;
        if (error) { showMsg(msg, '更新失敗：' + error.message, 'err'); return; }
        logAction('change_password');
        p1.value = ''; p2.value = '';
        showMsg(msg, '密碼已更新', 'ok');
      }
    }, h('label', {}, '新密碼', p1), h('label', {}, '確認新密碼', p2), btn, msg);
    mount(...shell('password', h('h2', {}, '修改密碼'), h('div', { class: 'card', style: 'max-width:420px' }, form)));
  }
  APP.pages.password = renderPassword;

  async function must(promise) {
    const { error } = await promise;
    if (error) throw new Error(error.message);
  }

  /* ---------- 操作紀錄（僅超級管理員） ---------- */
  async function renderLogs(tab) {
    tab = tab || 'auth';
    const body = h('div', {}, h('p', { class: 'meta' }, '載入中…'));
    const tabs = h('div', { class: 'tabs' },
      h('button', { class: tab === 'auth' ? 'on' : '', onclick: () => renderLogs('auth') }, '登入登出'),
      h('button', { class: tab === 'audit' ? 'on' : '', onclick: () => renderLogs('audit') }, '操作項目'));
    mount(...shell('logs', h('h2', {}, '操作紀錄'), tabs, body));
    const table = tab === 'auth' ? 'auth_logs' : 'audit_logs';
    const { data, error } = await sb.from(table).select('*').order('created_at', { ascending: false }).limit(200);
    if (error) { body.replaceChildren(h('div', { class: 'msg err' }, '讀取失敗：' + error.message)); return; }
    const cols = tab === 'auth'
      ? [['時間', (r) => fmtTime(r.created_at)], ['帳號', (r) => r.email], ['事件', (r) => ({ login: '登入', logout: '登出', login_failed: '登入失敗' }[r.event] || r.event)], ['IP', (r) => r.ip], ['裝置', (r) => (r.user_agent || '').slice(0, 60)]]
      : [['時間', (r) => fmtTime(r.created_at)], ['帳號', (r) => r.email || '系統'], ['來源', (r) => ({ web: '網頁', line: 'LINE', system: '系統' }[r.source])], ['動作', (r) => r.action], ['資料表', (r) => r.table_name], ['店別', (r) => r.store], ['資料編號', (r) => r.record_id], ['內容', (r) => r.detail ? JSON.stringify(r.detail) : '']];
    body.replaceChildren(h('div', { class: 'tw' }, h('table', {},
      h('thead', {}, h('tr', {}, cols.map(([n]) => h('th', {}, n)))),
      h('tbody', {}, data.map((r) => h('tr', {}, cols.map(([, f]) => h('td', {}, f(r) ?? ''))))))),
      data.length === 0 ? h('p', { class: 'meta' }, '目前沒有紀錄') : h('p', { class: 'meta' }, '顯示最近 ' + data.length + ' 筆'));
  }

  /* ---------- 路由 ---------- */
  async function route() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { renderAuth('login'); return; }
    if (!state.profile || state.profile.id !== session.user.id || state.profile.role === 'pending' || !state.profile.is_active) {
      state.profile = await loadProfile(session.user.id);
    }
    const p = state.profile;
    if (!p) { renderPending('pending'); return; }
    if (!p.is_active) { renderPending('disabled'); return; }
    if (p.role === 'pending') { renderPending('pending'); return; }
    if (APP.protect) APP.protect.refresh();
    const page = (location.hash || '#home').slice(1);
    if ((page === 'users' || page === 'logs') && p.role === 'admin') {
      logAction('view_page', { page });
      return page === 'users' ? renderUsers() : renderLogs('auth');
    }
    if (APP.pages[page] && !canOpen(page)) { logAction('view_page', { page: 'home' }); return renderHome(); }
    if (APP.pages[page]) {
      logAction('view_page', { page });
      return APP.pages[page]();
    }
    logAction('view_page', { page: 'home' });
    renderHome();
  }

  window.addEventListener('hashchange', route);
  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') { state.profile = null; renderAuth('login'); }
  });
  document.addEventListener('DOMContentLoaded', route);
})();
