/* 排班表與行事曆（共用同一份排班資料） */
(function () {
  'use strict';
  const { sb, h, mount, shell, showMsg } = APP;
  const L = LIB;
  let sel = null;
  let seq = 0;

  APP.pages.schedule = () => page('schedule');
  APP.pages.calendar = () => page('calendar');
  // 手機畫面：班表用帳務名（簡稱），選單用「休／上」，格子更窄
  const PHONE = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width:720px)').matches;

  async function page(kind) {
    const my = ++seq;
    if (!sel || (sel.store && !L.myStores().includes(sel.store))) sel = L.initialSel();
    const title = kind === 'schedule' ? '排班表' : '行事曆';
    if (!sel.store) {
      mount(...shell(kind, h('h2', {}, title), h('div', { class: 'msg info' }, '尚未授權任何店別，請聯絡管理員。')));
      return;
    }
    const body = h('div', {}, h('p', { class: 'meta' }, '載入中…'));
    mount(...shell(kind, h('h2', {}, title), L.picker(sel, () => page(kind)), body));
    try {
      const data = await load();
      if (my !== seq) return;
      const reload = () => page(kind);
      body.replaceChildren(...(kind === 'schedule' ? buildSchedule(data, reload) : buildCalendar(data, reload)));
    } catch (e) {
      if (my === seq) body.replaceChildren(h('div', { class: 'msg err' }, '讀取失敗：' + e.message));
    }
  }

  async function load() {
    const [sch, ths] = await Promise.all([L.loadSchedule(sel.store, sel.y, sel.m), L.therapists()]);
    let rosterDefault = false;
    if (!sch.settings.roster) { sch.settings.roster = await L.defaultRoster(sel.store); rosterDefault = true; }
    const byAlias = Object.fromEntries(ths.map((t) => [t.alias, t]));
    return { ...sch, rosterDefault, ths, nameOf: (a) => (byAlias[a] ? byAlias[a].name : a) };
  }

  const dstr = (d) => `${sel.y}-${L.pad(sel.m)}-${L.pad(d)}`;
  const toggle = (arr, v, on) => { const i = arr.indexOf(v); if (on && i < 0) arr.push(v); if (!on && i >= 0) arr.splice(i, 1); };
  async function applyChunks(items) {
    for (let i = 0; i < items.length; i += 200) {
      const { error } = await sb.rpc('schedule_apply', { p_store: sel.store, p_entries: items.slice(i, i + 200) });
      if (error) throw new Error(error.message);
    }
  }
  async function saveSettings(st) {
    const { error } = await sb.rpc('schedule_save_settings', { p_store: sel.store, p_settings: st });
    if (error) throw new Error(error.message);
  }

  /* ---------- 設定面板：師傅名單、兼職、固定週休、人數 ---------- */
  function settingsPanel(data, reload) {
    const st = JSON.parse(JSON.stringify(data.settings));
    const box = h('div');
    const msg = h('div');
    const cb = (checked, fn) => h('input', { type: 'checkbox', checked, onchange: (e) => fn(e.target.checked) });
    const move = (i, j) => { [st.roster[i], st.roster[j]] = [st.roster[j], st.roster[i]]; paint(); };
    function paint() {
      const candidates = data.ths.filter((t) => !st.roster.includes(t.alias));
      const addSel = h('select', {}, h('option', { value: '' }, '選擇師傅…'), candidates.map((t) => h('option', { value: t.alias }, t.name)));
      const num = (key) => h('input', { type: 'number', min: 0, max: 20, value: st[key] || 0, style: 'width:70px;padding:8px', onchange: (e) => { st[key] = Math.max(0, Number(e.target.value) || 0); } });
      box.replaceChildren(
        data.rosterDefault ? h('p', { class: 'meta' }, '尚未儲存過師傅名單，目前依近 60 天日報帶入，確認後請按「儲存設定」。') : null,
        h('div', { class: 'tw' }, h('table', {},
          h('thead', {}, h('tr', {}, ['師傅', '兼職', '週日', '週一', '週二', '週三', '週四', '週五', '週六', '順序', ''].map((t) => h('th', {}, t)))),
          h('tbody', {}, st.roster.map((a, i) => h('tr', {},
            h('td', { class: 'l' }, data.nameOf(a)),
            h('td', {}, cb(st.parttime.includes(a), (v) => toggle(st.parttime, a, v))),
            [0, 1, 2, 3, 4, 5, 6].map((w) => h('td', {}, cb((st.week_off[a] || []).includes(w), (v) => { const arr = st.week_off[a] || (st.week_off[a] = []); toggle(arr, w, v); }))),
            h('td', {}, h('button', { class: 'small', disabled: i === 0, onclick: () => move(i, i - 1) }, '▲'), ' ', h('button', { class: 'small', disabled: i === st.roster.length - 1, onclick: () => move(i, i + 1) }, '▼')),
            h('td', {}, h('button', { class: 'small', onclick: () => { st.roster.splice(i, 1); paint(); } }, '移除'))))))),
        h('div', { class: 'row' }, addSel, h('button', { class: 'small', onclick: () => { if (addSel.value) { st.roster.push(addSel.value); paint(); } } }, '加入師傅')),
        h('div', { class: 'row' }, h('label', {}, '平日最少上班人數', num('weekday_staff')), h('label', {}, '假日最少上班人數', num('weekend_staff'))),
        h('p', { class: 'meta' }, '勾選的「固定週休」會在按「一鍵帶入休假」時填入排班表；兼職師傅預設不上班，需手動標示上班。人數不足時，排班表會以紅字提醒。'));
    }
    paint();
    const save = h('button', {
      class: 'small', onclick: async () => {
        save.disabled = true; msg.replaceChildren();
        try { await saveSettings(st); reload(); } catch (e) { showMsg(msg, '儲存失敗：' + e.message, 'err'); save.disabled = false; }
      }
    }, '儲存設定');
    return h('details', {}, h('summary', {}, '師傅名單、固定週休與人數設定'), box, h('div', { class: 'row' }, save), msg);
  }

  /* ---------- 排班表 ---------- */
  function buildSchedule(data, reload) {
    const { settings, entries, nameOf } = data;
    const roster = settings.roster;
    const { last } = L.monthRange(sel.y, sel.m);
    const isPart = (a) => settings.parttime.includes(a);
    const working = (date, a) => { const k = entries.get(`${date}|${a}`); return isPart(a) ? k === 'work' : k !== 'leave'; };
    const label = (k, a) => (k === 'leave' ? '休假' : k === 'work' ? (isPart(a) ? '上班(兼職)' : '上班') : '');
    const cls = (k) => (k === 'leave' ? 'lvc' : k === 'work' ? 'wkc' : '');
    const title = `${sel.store} ${sel.y}年${sel.m}月 排班表`;

    const countTds = [];
    const footWork = {}, footLeave = {};
    const dateTd = {};
    const sumEl = h('div', { class: 'staffsum' });
    function recalc() {
      let short = 0;
      countTds.forEach(({ d, dow, td }) => {
        const date = dstr(d);
        const n = roster.filter((a) => working(date, a)).length;
        const need = dow === 0 || dow === 6 || HOL.is(date) ? settings.weekend_staff : settings.weekday_staff;
        td.textContent = need > 0 ? `${n}／${need}` : String(n);
        td.className = 'cnt' + (need > 0 && n < need ? ' low' : '');
        if (dateTd[d]) dateTd[d].classList.toggle('low', need > 0 && n < need);
        if (n < need) short++;
      });
      roster.forEach((a) => {
        let w = 0, lv = 0;
        for (let d = 1; d <= last; d++) { if (working(dstr(d), a)) w++; if (entries.get(`${dstr(d)}|${a}`) === 'leave') lv++; }
        footWork[a].textContent = String(w); footLeave[a].textContent = String(lv);
      });
      const part = roster.filter(isPart).length;
      sumEl.replaceChildren(
        h('span', {}, `店內師傅 ${roster.length} 人，兼職 ${part} 人 → 全職 ${roster.length - part} 人`),
        h('span', {}, `平日維持 ${settings.weekday_staff || '—'} 人`), h('span', {}, `假日／國定假日維持 ${settings.weekend_staff || '—'} 人`),
        short ? h('span', { class: 'bad' }, `人數不足 ${short} 天（紅色）`) : (settings.weekday_staff || settings.weekend_staff ? h('span', { class: 'okk' }, '人數皆達標') : null));
    }

    function cell(d, a, we) {
      const key = `${dstr(d)}|${a}`;
      const cur = entries.get(key) || '';
      const td = h('td', { class: (we + ' ' + cls(cur)).trim() });
      const eo = h('span', { class: 'eo' }, label(cur, a));
      const opts = [['', ''], ['leave', PHONE ? '休' : '休假'], ['work', PHONE ? '上' : (isPart(a) ? '上班(兼職)' : '上班')]];
      const s = h('select', {
        class: 'noexp cs', onchange: async () => {
          const k = s.value;
          s.disabled = true;
          const { error } = await sb.rpc('schedule_apply', { p_store: sel.store, p_entries: [{ d: dstr(d), a, k: k || null }] });
          s.disabled = false;
          if (error) { s.value = entries.get(key) || ''; alert('儲存失敗：' + error.message); return; }
          if (k) entries.set(key, k); else entries.delete(key);
          eo.textContent = label(k, a);
          td.className = (we + ' ' + cls(k)).trim();
          recalc();
        }
      }, opts.map(([v, t]) => h('option', { value: v, selected: v === cur }, t)));
      td.append(eo, s);
      return td;
    }

    const head = h('tr', {}, h('th', { class: 'l stk' }, '日期'), h('th', {}, '國定假日'),
      roster.map((a) => h('th', PHONE ? { title: nameOf(a) } : {}, PHONE ? (a + (isPart(a) ? '兼' : '')) : nameOf(a) + (isPart(a) ? '（兼）' : ''))), h('th', {}, PHONE ? '人數' : '當日上班人數'));
    const rows = [];
    for (let d = 1; d <= last; d++) {
      const dow = new Date(sel.y, sel.m - 1, d).getDay();
      const we = dow === 0 || dow === 6 ? 'we' : '';
      const cnt = h('td', {});
      countTds.push({ d, dow, td: cnt });
      const hn = HOL.name(dstr(d));
      const dtd = h('td', { class: ('stk ' + we).trim() }, `${sel.m}/${d} 週${L.WEEK[dow]}`);
      dateTd[d] = dtd;
      rows.push(h('tr', {}, dtd, h('td', { class: 'holc' }, hn), roster.map((a) => cell(d, a, we)), cnt));
    }
    const fw = h('tr', { class: 'tot' }, h('td', { class: 'stk' }, '上班天數'), h('td', {}), roster.map((a) => (footWork[a] = h('td', {}))), h('td', {}));
    const fl = h('tr', { class: 'tot' }, h('td', { class: 'stk' }, '休假天數'), h('td', {}), roster.map((a) => (footLeave[a] = h('td', {}))), h('td', {}));
    recalc();

    const msg = h('div');
    const fill = h('button', {
      onclick: async () => {
        const items = [];
        for (const a of roster) {
          if (isPart(a)) continue;
          const wk = settings.week_off[a] || [];
          for (let d = 1; d <= last; d++) {
            const dow = new Date(sel.y, sel.m - 1, d).getDay();
            if (wk.includes(dow) && !entries.has(`${dstr(d)}|${a}`)) items.push({ d: dstr(d), a, k: 'leave' });
          }
        }
        if (!items.length) { showMsg(msg, '沒有需要帶入的休假（可能已帶入，或尚未設定固定週休）。', 'info'); return; }
        fill.disabled = true;
        try { await applyChunks(items); reload(); } catch (e) { showMsg(msg, '帶入失敗：' + e.message, 'err'); fill.disabled = false; }
      }
    }, '一鍵帶入休假');
    const clear = h('button', {
      onclick: async () => {
        if (!confirm(`確定要清除 ${sel.store} ${sel.y} 年 ${sel.m} 月的全部排班嗎？`)) return;
        clear.disabled = true;
        const { error } = await sb.rpc('schedule_clear_month', { p_store: sel.store, p_ym: `${sel.y}-${L.pad(sel.m)}` });
        if (error) { showMsg(msg, '清除失敗：' + error.message, 'err'); clear.disabled = false; } else reload();
      }
    }, '全部清除');

    const sheet = h('div', { class: 'sheet' }, h('h3', {}, title), sumEl,
      h('div', { class: 'tw' }, h('table', {}, h('thead', {}, head), h('tbody', {}, rows), h('tfoot', {}, fw, fl))));
    const exp = L.exportBar(() => sheet, () => title, () => ({ page: 'schedule', store: sel.store, month: `${sel.y}-${L.pad(sel.m)}` }));
    return [settingsPanel(data, reload), h('div', { class: 'act' }, fill, clear), msg, exp, sheet];
  }

  /* ---------- 日曆訂閱連結（Apple／Google 日曆） ---------- */
  function subscribePanel() {
    const box = h('div');
    const msg = h('div');
    let token = null, notes = false;
    const base = `${CONFIG.SUPABASE_URL}/functions/v1/calendar-feed`;
    const url = () => `${base}?store=${encodeURIComponent(sel.store)}&token=${token}${notes ? '&notes=1' : ''}`;
    async function fetchToken(fn, ask) {
      if (ask && !confirm('重新產生後，舊的訂閱連結會立即失效，已加入日曆的人需要重新訂閱。確定嗎？')) return;
      msg.replaceChildren();
      const { data, error } = await sb.rpc(fn, { p_store: sel.store });
      if (error) { showMsg(msg, '失敗：' + error.message, 'err'); return; }
      token = data; APP.logAction(fn === 'calendar_token_reset' ? 'calendar_link_reset' : 'calendar_link_view', { store: sel.store });
      paint();
    }
    function paint() {
      if (!token) {
        box.replaceChildren(h('button', { class: 'small', onclick: () => fetchToken('calendar_token_get') }, '顯示訂閱連結'));
        return;
      }
      const input = h('input', { type: 'text', readonly: true, value: url(), onfocus: (e) => e.target.select() });
      const copyMsg = h('span', { class: 'meta' });
      box.replaceChildren(
        h('label', { style: 'margin-top:0' }, h('input', { type: 'checkbox', checked: notes, onchange: (e) => { notes = e.target.checked; paint(); } }), ' 同時包含日帳記事（可能含客訴等內容，請謹慎）'),
        input,
        h('div', { class: 'row' },
          h('button', { class: 'small', onclick: async () => { try { await navigator.clipboard.writeText(input.value); copyMsg.textContent = '已複製'; } catch (e) { input.select(); copyMsg.textContent = '請長按連結後選「拷貝」'; } } }, '複製連結'),
          h('a', { href: url().replace(/^https:/, 'webcal:'), class: 'small', style: 'padding:7px 12px;border:1px solid var(--line);border-radius:10px;text-decoration:none;color:var(--ink);font-size:14px' }, '加到 Apple 日曆'),
          h('button', { class: 'small', onclick: () => fetchToken('calendar_token_reset', true) }, '重新產生連結'), copyMsg),
        h('p', { class: 'meta' }, 'Apple 日曆：點「加到 Apple 日曆」按訂閱。Google 日曆：到網頁版 Google 日曆，左側「其他日曆」旁的「＋」→「透過網址新增」，貼上上方連結（Google 約每半天到一天才更新一次）。'));
    }
    paint();
    return h('details', {}, h('summary', {}, '加入手機日曆（訂閱連結）'),
      h('p', { class: 'meta' }, `訂閱後，${sel.store} 的休假、兼職上班與早班師傅會顯示在手機日曆，排班修改後自動更新。拿到連結的人都能看到該店排班，請勿公開轉貼；外流時按「重新產生連結」。`),
      box, msg);
  }

  /* ---------- 行事曆 ---------- */
  function buildCalendar(data, reload) {
    const { settings, entries, nameOf } = data;
    const roster = settings.roster;
    const { last } = L.monthRange(sel.y, sel.m);
    const title = `${sel.store} ${sel.y}年${sel.m}月 休假日曆`;
    const orderOf = (a) => { const i = roster.indexOf(a); return i < 0 ? 999 : i; };
    const byDate = new Map();
    for (const [key, kind] of entries) {
      const [date, alias] = key.split('|');
      const o = byDate.get(date) || { leave: [], work: [] };
      o[kind].push(alias); byDate.set(date, o);
    }
    byDate.forEach((o) => { o.leave.sort((a, b) => orderOf(a) - orderOf(b)); o.work.sort((a, b) => orderOf(a) - orderOf(b)); });

    const first = new Date(sel.y, sel.m - 1, 1).getDay();
    const weeks = Math.ceil((first + last) / 7);
    const rows = [];
    for (let w = 0; w < weeks; w++) {
      const days = [0, 1, 2, 3, 4, 5, 6].map((c) => { const d = w * 7 + c - first + 1; return d >= 1 && d <= last ? d : null; });
      const tdc = (c) => (c === 0 || c === 6 ? 'we' : '');
      rows.push(
        h('tr', { class: 'wkstart' }, h('th', { class: 'rl' }, '標籤'), days.map((d, c) => h('td', { class: ('dl ' + tdc(c)).trim() }, d ? `${sel.m}/${d}` : ''))),
        h('tr', {}, h('th', { class: 'rl' }, '休假'), days.map((d, c) => h('td', { class: ('nm ' + tdc(c)).trim() }, d ? ((byDate.get(dstr(d)) || { leave: [] }).leave.map((a) => h('div', {}, nameOf(a)))) : ''))),
        h('tr', {}, h('th', { class: 'rl' }, '上班'), days.map((d, c) => h('td', { class: ('nm wk ' + tdc(c)).trim() }, d ? [((byDate.get(dstr(d)) || { work: [] }).work.map((a) => h('div', {}, nameOf(a)))), HOL.is(dstr(d)) ? h('div', { class: 'holt' }, HOL.name(dstr(d))) : null] : ''))));
    }
    const head = h('tr', {}, h('th', { class: 'rl' }, ''), L.WEEK.map((t, c) => h('th', { class: c === 0 || c === 6 ? 'we' : '' }, '週' + t)));

    // 早班師傅（每週固定）：選擇後立即儲存
    const msg = h('div');
    const early = Object.assign({}, settings.early);
    const saveEarly = async (extra) => {
      try { await saveSettings({ ...settings, early, ...extra }); msg.replaceChildren(); } catch (e) { showMsg(msg, '儲存失敗：' + e.message, 'err'); }
    };
    const earlyCells = [0, 1, 2, 3, 4, 5, 6].map((c) => {
      const eo = h('span', { class: 'eo' }, early[c] ? nameOf(early[c]) : '無早班');
      const s = h('select', {
        class: 'noexp cs', onchange: () => { early[c] = s.value; eo.textContent = s.value ? nameOf(s.value) : '無早班'; saveEarly(); }
      }, h('option', { value: '' }, '無早班'), roster.map((a) => h('option', { value: a, selected: early[c] === a }, nameOf(a))));
      return h('td', { class: c === 0 || c === 6 ? 'we' : '' }, eo, APP.canEditCal() ? s : null);
    });
    const labelEo = h('span', { class: 'eo early-t' }, settings.early_label);
    const labelIn = h('input', { type: 'text', class: 'noexp', value: settings.early_label, maxlength: 40, onchange: () => { labelEo.textContent = labelIn.value; saveEarly({ early_label: labelIn.value }); } });
    const earlyBlock = h('div', { style: 'margin-top:12px' },
      h('div', { class: 'early-t' }, labelEo, APP.canEditCal() ? labelIn : null),
      h('div', { class: 'tw' }, h('table', { class: 'calt' }, h('thead', {}, h('tr', {}, L.WEEK.map((t, c) => h('th', { class: c === 0 || c === 6 ? 'we' : '' }, '週' + t)))), h('tbody', {}, h('tr', {}, earlyCells)))));

    const sheet = h('div', { class: 'sheet cal' }, h('h3', {}, title),
      h('div', { class: 'tw' }, h('table', { class: 'calt' }, h('thead', {}, head), h('tbody', {}, rows))), earlyBlock);
    const exp = L.exportBar(() => sheet, () => title, () => ({ page: 'calendar', store: sel.store, month: `${sel.y}-${L.pad(sel.m)}` }));
    return [h('p', { class: 'meta' }, APP.canEditCal() ? '行事曆內容來自「排班表」；早班師傅選擇後會自動儲存。' : '行事曆內容來自「排班表」（唯讀）。'), APP.canEditCal() ? subscribePanel() : null, exp, sheet, msg].filter(Boolean);
  }
})();
