/* 五眾店務管理 — 登入、註冊、等待開通、帳號管理、紀錄 */
(function () {
  'use strict';
  const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
  const app = document.getElementById('app');
  const ROLE = { admin: '超級管理員', manager: '店長', accountant: '帳務人員', pending: '待開通' };
  const state = { profile: null, stores: [] };
  // 提供給各頁面模組使用
  const APP = window.APP = { sb, h, state, mount, shell, fmtTime, showMsg, logAction, ROLE, pages: {} };

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
    const { data: p, error } = await sb.from('profiles').select('id,display_name,role,is_active').eq('id', uid).maybeSingle();
    if (error || !p) return null;
    const { data: s } = await sb.from('user_stores').select('store_name').eq('user_id', uid);
    state.stores = (s || []).map((r) => r.store_name);
    return p;
  }

  /* ---------- 版型 ---------- */
  function shell(active, ...content) {
    const p = state.profile;
    const items = [['home', '首頁'], ['daily', '日帳明細'], ['monthly', '月結表']];
    if (p.role === 'admin') items.push(['users', '帳號管理'], ['logs', '操作紀錄']);
    return [
      h('div', { class: 'topbar' },
        h('div', { class: 't' }, '五眾店務管理'),
        h('div', { class: 'who' }, p.display_name, h('span', { class: 'badge ' + p.role }, ROLE[p.role])),
        h('button', { class: 'small', onclick: signOut }, '登出')),
      h('div', { class: 'nav' }, items.map(([k, label]) =>
        h('a', { href: '#' + k, class: k === active ? 'on' : '' }, label))),
      h('div', { class: 'main' }, content)
    ];
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
      [null, '分析', '店舖與個人績效分析'],
      [null, '排班表', '每月排班與固定週休'],
      [null, '行事曆', '週曆與休假，可輸出 PDF']
    ];
    mount(...shell('home',
      h('h2', {}, '歡迎，' + p.display_name),
      h('p', { class: 'meta' }, scope),
      h('div', { class: 'grid' }, pages.map(([k, t, d]) => k
        ? h('a', { class: 'tile', href: '#' + k }, h('h3', {}, t), h('p', {}, d))
        : h('div', { class: 'tile off' }, h('h3', {}, t, h('span', { class: 'badge' }, '開發中')), h('p', {}, d))))));
  }

  /* ---------- 帳號管理（僅超級管理員） ---------- */
  async function renderUsers() {
    const list = h('div', {}, h('p', { class: 'meta' }, '載入中…'));
    mount(...shell('users', h('h2', {}, '帳號管理'),
      h('p', { class: 'meta' }, '新註冊的帳號預設為「待開通」。請設定角色；店長需勾選可管理的店別（可多選）。'), list));
    const { data, error } = await sb.rpc('admin_list_users');
    if (error) { list.replaceChildren(h('div', { class: 'msg err' }, '讀取失敗：' + error.message)); return; }
    list.replaceChildren(...data.map(userCard));
  }

  function userCard(u) {
    const me = u.id === state.profile.id;
    const roleSel = h('select', { disabled: me },
      ['pending', 'manager', 'accountant', 'admin'].map((r) => h('option', { value: r, selected: r === u.role }, ROLE[r])));
    const boxes = CONFIG.STORES.map((s) => {
      const cb = h('input', { type: 'checkbox', value: s, checked: u.stores.includes(s) });
      return h('label', {}, cb, s);
    });
    const active = h('input', { type: 'checkbox', checked: u.is_active, disabled: me });
    const msg = h('div');
    const save = h('button', {
      class: 'small',
      onclick: async () => {
        save.disabled = true; msg.replaceChildren();
        try {
          if (!me && roleSel.value !== u.role) await must(sb.rpc('admin_set_role', { p_user: u.id, p_role: roleSel.value }));
          const stores = boxes.map((l) => l.firstChild).filter((c) => c.checked).map((c) => c.value);
          if (stores.join() !== u.stores.join()) await must(sb.rpc('admin_set_stores', { p_user: u.id, p_stores: stores }));
          if (!me && active.checked !== u.is_active) await must(sb.rpc('admin_set_active', { p_user: u.id, p_active: active.checked }));
          showMsg(msg, '已儲存', 'ok');
          u.role = roleSel.value; u.is_active = active.checked; u.stores = stores;
        } catch (e) { showMsg(msg, '儲存失敗：' + e.message, 'err'); }
        save.disabled = false;
      }
    }, '儲存');
    return h('div', { class: 'ucard' },
      h('div', { class: 'hd' },
        h('div', {}, h('span', { class: 'nm' }, u.display_name), h('span', { class: 'badge ' + u.role }, ROLE[u.role]), me ? h('span', { class: 'badge' }, '我') : null,
          h('div', { class: 'em' }, u.email)),
        h('div', { class: 'meta' }, '註冊：' + fmtTime(u.created_at), h('br'), '最近登入：' + fmtTime(u.last_sign_in_at))),
      h('div', { class: 'row' }, h('label', {}, '角色', roleSel), h('label', {}, active, '啟用')),
      h('div', { class: 'row' }, h('span', { class: 'meta' }, '授權店別：'), boxes),
      h('div', { class: 'row' }, save), msg);
  }

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
    const page = (location.hash || '#home').slice(1);
    if ((page === 'users' || page === 'logs') && p.role === 'admin') {
      logAction('view_page', { page });
      return page === 'users' ? renderUsers() : renderLogs('auth');
    }
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
