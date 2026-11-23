/* 資料匯出（僅超級管理員）：一鍵下載過去的日報（店家＋店日帳＋師傅日帳），供其他系統匯入 */
(function () {
  'use strict';
  const { h, mount, shell, sb, showMsg } = APP;
  APP.pages.export = render;

  const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const toCsv = (cols, rows) => '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n');
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  async function fetchAll(from, to, withTest, onProgress) {
    const out = [];
    for (let off = 0; ; off += 500) {
      let q = sb.from('daily_reports').select('id,store,report_date,total_amount,total_count,total_unfulfilled,is_closed,daily_report_items(name,status,amount,total_count,unfulfilled)')
        .order('report_date').order('id').range(off, off + 499);
      if (from) q = q.gte('report_date', from);
      if (to) q = q.lte('report_date', to);
      if (!withTest) q = q.neq('store', '五測');
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      out.push(...data); onProgress(out.length);
      if (data.length < 500) break;
    }
    return out;
  }

  function render() {
    if (APP.state.real ? APP.state.real.profile.role !== 'admin' : APP.state.profile.role !== 'admin') { mount(...shell('export', h('h2', {}, '資料匯出'), h('div', { class: 'msg err' }, '只有超級管理員可以使用。'))); return; }
    const from = h('input', { type: 'date' }), to = h('input', { type: 'date' });
    const test = h('input', { type: 'checkbox' });
    const msg = h('div');
    const run = (kind) => async (e) => {
      e.target.disabled = true; showMsg(msg, '讀取中…', 'info');
      try {
        const reps = await fetchAll(from.value, to.value, test.checked, (n) => showMsg(msg, `已讀取 ${n} 筆日報…`, 'info'));
        const { data: stores, error } = await sb.from('stores').select('code,name,full_name,phone,address,is_active');
        if (error) throw new Error(error.message);
        const stamp = new Date().toISOString().slice(0, 10);
        const items = [];
        reps.forEach((r) => (r.daily_report_items || []).forEach((i) => items.push({ store: r.store, report_date: r.report_date, name: i.name, status: i.status, amount: i.amount, total_count: i.total_count, unfulfilled: i.unfulfilled })));
        if (kind === 'json') {
          download(`fiveall_daily_${stamp}.json`, JSON.stringify({ exported_at: new Date().toISOString(), stores, daily_reports: reps.map(({ id, ...r }) => r) }, null, 1), 'application/json');
        } else {
          download(`fiveall_stores_${stamp}.csv`, toCsv(['code', 'name', 'full_name', 'phone', 'address', 'is_active'], stores), 'text/csv');
          setTimeout(() => download(`fiveall_daily_reports_${stamp}.csv`, toCsv(['store', 'report_date', 'total_amount', 'total_count', 'total_unfulfilled', 'is_closed'], reps), 'text/csv'), 400);
          setTimeout(() => download(`fiveall_daily_items_${stamp}.csv`, toCsv(['store', 'report_date', 'name', 'status', 'amount', 'total_count', 'unfulfilled'], items), 'text/csv'), 800);
        }
        APP.logAction('export_data', { kind, reports: reps.length, items: items.length });
        showMsg(msg, `完成：${stores.length} 間店、${reps.length} 筆日報、${items.length} 筆師傅日帳。`, 'ok');
      } catch (err) { showMsg(msg, '匯出失敗：' + err.message, 'err'); }
      e.target.disabled = false;
    };
    mount(...shell('export', h('h2', {}, '資料匯出'),
      h('div', { class: 'card' },
        h('p', { class: 'meta' }, '把過去的日報一次下載，給其他系統匯入。內容含：店家、店日帳（每店每天）、師傅日帳（每人每天的業績、來客、散客、狀態）。檔案含營業資料，請妥善保管。'),
        h('div', { class: 'row' }, h('label', {}, '從', from), h('label', {}, '到', to), h('span', { class: 'meta' }, '（日期留空＝全部）')),
        h('label', { style: 'display:block;margin:10px 0' }, test, ' 包含測試店「五測」'),
        h('div', { class: 'row' }, h('button', { class: 'primary', style: 'width:auto;margin-top:0', onclick: run('csv') }, '下載 CSV（3 個檔）'), h('button', { onclick: run('json') }, '下載 JSON（1 個檔）')),
        msg)));
  }
})();
