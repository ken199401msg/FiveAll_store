// 日曆訂閱（ICS）：GET /functions/v1/calendar-feed?store=五健&token=XXXX[&notes=1]
// 以每家店的專屬 token 驗證（verify_jwt 關閉，因為 Apple／Google 日曆無法帶登入資訊）
const SB = Deno.env.get('SUPABASE_URL')!;
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const HEAD = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function q(path: string) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: HEAD });
  if (!r.ok) throw new Error(`db ${r.status}`);
  return await r.json();
}
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
// ICS 每行最多 75 位元組，超過要折行（以字元為單位，避免切斷中文）
function fold(line: string) {
  const enc = new TextEncoder();
  let out = '', cur = '', bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > 73) { out += cur + '\r\n '; cur = ''; bytes = 1; }
    cur += ch; bytes += b;
  }
  return out + cur;
}
const ymd = (d: string) => d.replaceAll('-', '');
function addDays(d: string, n: number) {
  const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export function buildIcs(opts: {
  store: string; today: string; nowStamp: string;
  entries: { work_date: string; alias: string; kind: string }[];
  settings: any; names: Record<string, string>;
  notes: { id: number; note_date: string; content: string; created_by_name: string }[];
}) {
  const { store, today, nowStamp, entries, settings, names, notes } = opts;
  const roster: string[] = settings?.roster || [];
  const order = (a: string) => { const i = roster.indexOf(a); return i < 0 ? 999 : i; };
  const nm = (a: string) => names[a] || a;
  const L: string[] = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FiveAll//Schedule//ZH', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(store + ' 排班')}`, 'X-WR-TIMEZONE:Asia/Taipei',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'
  ];
  const ev = (uid: string, date: string, summary: string, desc?: string) => {
    L.push('BEGIN:VEVENT', `UID:${uid}@fiveall`, `DTSTAMP:${opts.nowStamp}`,
      `DTSTART;VALUE=DATE:${ymd(date)}`, `DTEND;VALUE=DATE:${ymd(addDays(date, 1))}`,
      `SUMMARY:${esc(summary)}`, 'TRANSP:TRANSPARENT');
    if (desc) L.push(`DESCRIPTION:${esc(desc)}`);
    L.push('END:VEVENT');
  };
  const by = new Map<string, { leave: string[]; work: string[] }>();
  for (const e of entries) {
    const o = by.get(e.work_date) || { leave: [], work: [] };
    (e.kind === 'leave' ? o.leave : o.work).push(e.alias);
    by.set(e.work_date, o);
  }
  for (const [date, o] of [...by.entries()].sort()) {
    if (o.leave.length) ev(`leave-${date}-${encodeURIComponent(store)}`, date, `${store} 休假：` + o.leave.sort((a, b) => order(a) - order(b)).map(nm).join('、'));
    if (o.work.length) ev(`work-${date}-${encodeURIComponent(store)}`, date, `${store} 兼職上班：` + o.work.sort((a, b) => order(a) - order(b)).map(nm).join('、'));
  }
  const early = settings?.early || {};
  const start = addDays(today, -31), end = addDays(today, 120);
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const a = early[new Date(d + 'T00:00:00Z').getUTCDay()];
    if (a) ev(`early-${d}-${encodeURIComponent(store)}`, d, `${store} 早班：${nm(a)}`, settings?.early_label || undefined);
  }
  for (const n of notes) ev(`note-${n.id}`, n.note_date, `${store} 記事：${n.content.slice(0, 40)}`, `${n.content}\n（${n.created_by_name}）`);
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

Deno.serve(async (req) => {
  const u = new URL(req.url);
  const store = u.searchParams.get('store') || '';
  const token = u.searchParams.get('token') || '';
  const notFound = () => new Response('Not found', { status: 404 });
  if (!store || token.length < 32) return notFound();
  try {
    const s = encodeURIComponent(store);
    const t = await q(`calendar_tokens?store=eq.${s}&select=token`);
    if (!t.length || t[0].token !== token) return notFound();

    const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
    const from = addDays(today, -31), to = addDays(today, 120);
    const wantNotes = u.searchParams.get('notes') === '1';
    const [entries, st, ths, notes] = await Promise.all([
      q(`schedule_entries?store=eq.${s}&work_date=gte.${from}&work_date=lte.${to}&select=work_date,alias,kind&order=work_date`),
      q(`schedule_settings?store=eq.${s}&select=settings`),
      q('therapists?select=alias,name'),
      wantNotes ? q(`daily_notes?store=eq.${s}&note_date=gte.${from}&note_date=lte.${to}&select=id,note_date,content,created_by_name`) : Promise.resolve([])
    ]);
    const names: Record<string, string> = Object.fromEntries(ths.map((x: any) => [x.alias, x.name]));
    const nowStamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const ics = buildIcs({ store, today, nowStamp, entries, settings: st[0]?.settings || {}, names, notes });
    return new Response(ics, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-cache' } });
  } catch (_e) {
    return new Response('Error', { status: 500 });
  }
});
