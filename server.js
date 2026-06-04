'use strict';
require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const jwt      = require('jsonwebtoken');
const cron     = require('node-cron');
const crypto   = require('crypto');
const { runSora }   = require('./agents/sora');
const { runDeep }   = require('./agents/deep');
const { runGold }   = require('./agents/gold');
const { fbGet, fbSet, fbUpdate, fbPush, logEvent, DEFAULT_SETTINGS } = require('./agents/utils');

const app    = express();
const PORT   = process.env.PORT || 3000;
const SECRET = crypto.createHash('sha256')
  .update((process.env.DASHBOARD_PIN || '') + ':' + (process.env.ANTHROPIC_API_KEY || '') + ':sdg-2025')
  .digest('hex');
const BUDGET = parseFloat(process.env.MONTHLY_BUDGET_SAR || '230');

const attempts = new Map();
let cronJobs   = {};
let soraState  = { running: false, found: 0, scanned: 0, city: '', category: '', startedAt: null, completedAt: null };

app.use(cors());
app.use(express.json({ limit: '10mb' }));

/* ── حالات الشركات ── */
function isNew(s)    { return !s || s === 'new'   || (typeof s === 'string' && s.includes('جدي')); }
function isSent(s)   { return s === 'sent'        || (typeof s === 'string' && s.includes('رسل')); }
function isReply(s)  { return s === 'reply'       || (typeof s === 'string' && (s.includes('ردّ') || s.includes('ردد') || s === 'رد')); }
function isClient(s) { return s === 'client'      || (typeof s === 'string' && s.includes('عميل')); }

/* ── مصادقة JWT ── */
function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'يلزم تسجيل الدخول' });
  try { req.user = jwt.verify(token, SECRET); next(); }
  catch { res.status(401).json({ error: 'جلسة منتهية' }); }
}

/* ── جدولة ── */
function toCron(hhmm, days) {
  const [h, m] = hhmm.split(':').map(Number);
  const map = { sunday:0, monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6 };
  const nums = Object.entries(days).filter(([,on]) => on).map(([d]) => map[d]).sort().join(',');
  return `${m} ${h} * * ${nums || '0-6'}`;
}

async function initSchedule() {
  Object.values(cronJobs).forEach(j => j?.destroy?.());
  cronJobs = {};
  try {
    const s = await fbGet('settings') || DEFAULT_SETTINGS;
    const sch = s.schedule || DEFAULT_SETTINGS.schedule;
    const day = s.days    || DEFAULT_SETTINGS.days;
    const guard = async (fn) => { const c = await fbGet('settings'); if (c?.mode !== 'manual') await fn(); };
    cronJobs.sora = cron.schedule(toCron(sch.soraStart || '08:00', day), () => guard(runSora),  { timezone: 'Asia/Riyadh' });
    cronJobs.deep = cron.schedule(toCron(sch.deepStart || '10:00', day), () => guard(runDeep),  { timezone: 'Asia/Riyadh' });
    cronJobs.gold = cron.schedule(toCron(sch.goldStart || '20:00', day), () => guard(runGold),  { timezone: 'Asia/Riyadh' });
  } catch {
    cronJobs.sora = cron.schedule('0 8 * * 0-5',  () => runSora(), { timezone: 'Asia/Riyadh' });
    cronJobs.deep = cron.schedule('0 10 * * 0-5', () => runDeep(), { timezone: 'Asia/Riyadh' });
    cronJobs.gold = cron.schedule('0 20 * * 0-5', () => runGold(), { timezone: 'Asia/Riyadh' });
  }
}

/* ══════════════════════════════════════
   AUTH
══════════════════════════════════════ */
app.post('/api/auth/login', (req, res) => {
  const { pin } = req.body;
  const ip = req.ip, now = Date.now();
  const att = attempts.get(ip) || { count: 0, at: 0 };
  if (att.count >= 5 && now - att.at < 15 * 60 * 1000) {
    const mins = Math.ceil((15 * 60 * 1000 - (now - att.at)) / 60000);
    return res.status(429).json({ error: `حاول بعد ${mins} دقيقة` });
  }
  if (!pin || String(pin) !== String(process.env.DASHBOARD_PIN)) {
    attempts.set(ip, { count: att.count + 1, at: now });
    return res.status(401).json({ error: 'رمز خاطئ' });
  }
  attempts.delete(ip);
  res.json({ token: jwt.sign({ role: 'owner' }, SECRET, { expiresIn: '7d' }) });
});

/* ══════════════════════════════════════
   STATS
══════════════════════════════════════ */
app.get('/api/stats', requireAuth, async (req, res) => {
  try {
    const [leads, outreach, settings] = await Promise.all([
      fbGet('leads'), fbGet('outreach'), fbGet('settings')
    ]);
    const la  = Object.values(leads    || {});
    const oa  = Object.values(outreach || {});
    const tod = new Date().toISOString().split('T')[0];
    const nw  = la.filter(l => isNew(l.status));
    const snt = la.filter(l => isSent(l.status));
    const rpl = la.filter(l => isReply(l.status));
    const cli = la.filter(l => isClient(l.status));
    res.json({
      total:    { leads: la.length, sent: snt.length+rpl.length+cli.length, replies: rpl.length, clients: cli.length },
      today:    { discovered: la.filter(l => l.discoveredAt?.startsWith(tod)).length, sent: oa.filter(o => o.sentAt?.startsWith(tod)).length, replies: oa.filter(o => o.repliedAt?.startsWith(tod)).length },
      budget:   { used: settings?.budgetUsed || 0, limit: BUDGET, remaining: BUDGET - (settings?.budgetUsed || 0) },
      byStatus: { new: nw.length, sent: snt.length, replied: rpl.length, client: cli.length }
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* إحصاءات أسبوعية */
app.get('/api/stats/weekly', requireAuth, async (req, res) => {
  try {
    const leads = Object.values(await fbGet('leads') || {});
    const days  = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const date = d.toISOString().split('T')[0];
      days.push({
        date,
        label:     d.toLocaleDateString('ar-SA', { weekday: 'short' }),
        discovered: leads.filter(l => l.discoveredAt?.startsWith(date)).length,
        sent:       leads.filter(l => (isSent(l.status) || isReply(l.status) || isClient(l.status)) && l.sentAt?.startsWith(date)).length
      });
    }
    res.json(days);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════════════════
   SETTINGS
══════════════════════════════════════ */
app.get('/api/settings', requireAuth, async (req, res) => {
  try { res.json(await fbGet('settings') || DEFAULT_SETTINGS); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/settings', requireAuth, async (req, res) => {
  try {
    await fbUpdate('settings', req.body);
    if (req.body.schedule || req.body.days) await initSchedule();
    res.json({ success: true, message: 'تم الحفظ' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════════════════
   LEADS — CRUD
══════════════════════════════════════ */
app.get('/api/leads', requireAuth, async (req, res) => {
  try {
    const { status, limit = 200, offset = 0 } = req.query;
    const all  = await fbGet('leads') || {};
    let   list = Object.entries(all).map(([id, d]) => ({ id, ...d }));
    if      (status === 'new')    list = list.filter(l => isNew(l.status));
    else if (status === 'sent')   list = list.filter(l => isSent(l.status));
    else if (status === 'reply')  list = list.filter(l => isReply(l.status));
    else if (status === 'client') list = list.filter(l => isClient(l.status));
    list.sort((a, b) => new Date(b.discoveredAt) - new Date(a.discoveredAt));
    res.json({ total: list.length, leads: list.slice(Number(offset), Number(offset) + Number(limit)) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/leads/:id', requireAuth, async (req, res) => {
  try {
    const all  = await fbGet('leads') || {};
    const lead = all[req.params.id];
    if (!lead) return res.status(404).json({ error: 'لا توجد' });
    res.json({ id: req.params.id, ...lead });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/leads', requireAuth, async (req, res) => {
  try {
    const lead = { ...req.body, status: 'new', discoveredAt: new Date().toISOString(), source: 'manual', contacted: false };
    const id   = await fbPush('leads', lead);
    res.json({ success: true, id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/leads/:id', requireAuth, async (req, res) => {
  try { await fbUpdate('leads/' + req.params.id, req.body); res.json({ success: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/leads/:id', requireAuth, async (req, res) => {
  try {
    const all = await fbGet('leads') || {};
    delete all[req.params.id];
    await fbSet('leads', all);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════════════════
   BULK OPERATIONS
══════════════════════════════════════ */
app.post('/api/leads/bulk', requireAuth, async (req, res) => {
  try {
    const { operation, ids, status } = req.body;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'لا توجد معرفات' });

    if (operation === 'delete') {
      const all = await fbGet('leads') || {};
      ids.forEach(id => delete all[id]);
      await fbSet('leads', all);
      return res.json({ success: true, count: ids.length });
    }

    if (operation === 'status' && status) {
      await Promise.all(ids.map(id => fbUpdate('leads/' + id, { status })));
      return res.json({ success: true, count: ids.length });
    }

    res.status(400).json({ error: 'عملية غير معروفة' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════════════════
   EMAIL
══════════════════════════════════════ */
app.post('/api/leads/:id/email', requireAuth, async (req, res) => {
  try {
    const leads = await fbGet('leads') || {};
    const lead  = leads[req.params.id];
    if (!lead)       return res.status(404).json({ error: 'لا توجد' });
    if (!lead.email) return res.status(400).json({ error: 'لا يوجد إيميل' });
    const nodemailer = require('nodemailer');
    const tm  = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS } });
    const msg = req.body.message || `السلام عليكم،\n\nنحن من فريق VOLT STORE المتخصص في تصميم المواقع.\n\nلاحظنا أن "${lead.name}" في ${lead.city} ليس لها موقع إلكتروني.\n\nنقدم:\n✅ تصميم موقع احترافي\n✅ ظهور في Google\n✅ دعم فني مستمر\n\nهل يمكننا التحدث؟ 🙏`;
    await tm.sendMail({
      from:    `VOLT STORE <${process.env.GMAIL_USER}>`,
      to:      lead.email,
      subject: `عرض خاص لـ ${lead.name}`,
      text:    msg,
      html:    `<div dir="rtl" style="font-family:Arial;padding:24px;max-width:600px"><h2 style="color:#00c97a">${lead.name}</h2><p style="color:#666">${lead.category} · ${lead.city}</p><div style="background:#f8f8f8;padding:18px;border-radius:8px;border-right:3px solid #00c97a;line-height:2">${msg.replace(/\n/g,'<br>')}</div></div>`
    });
    await fbUpdate('leads/' + req.params.id, { status: 'sent', sentAt: new Date().toISOString() });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════════════════
   AGENTS
══════════════════════════════════════ */
app.get('/api/agents/sora/status', requireAuth, (req, res) => res.json(soraState));

app.post('/api/agents/sora/run', requireAuth, (req, res) => {
  if (soraState.running) return res.json({ success: false, message: 'سورا يعمل بالفعل', state: soraState });
  res.json({ success: true, message: 'سورا يعمل...' });
  soraState = { running: true, found: 0, scanned: 0, city: req.body?.city || '', category: req.body?.category || '', startedAt: new Date().toISOString(), completedAt: null };
  runSora(req.body)
    .then(r => { soraState = { running: false, found: r.found || 0, scanned: r.scanned || 0, city: r.city || '', category: r.category || '', startedAt: soraState.startedAt, completedAt: new Date().toISOString() }; })
    .catch(e => { soraState.running = false; logEvent('error', 'سورا', { error: e.message }); });
});

app.post('/api/agents/deep/run', requireAuth, (req, res) => {
  res.json({ success: true, message: 'ديب يعمل...' });
  runDeep(req.body).catch(e => logEvent('error', 'ديب', { error: e.message }));
});

app.post('/api/agents/gold/run', requireAuth, (req, res) => {
  res.json({ success: true, message: 'جولد يعمل...' });
  runGold().catch(e => logEvent('error', 'جولد', { error: e.message }));
});

/* ══════════════════════════════════════
   REPORTS
══════════════════════════════════════ */
app.get('/api/reports', requireAuth, async (req, res) => {
  try {
    const all  = await fbGet('reports') || {};
    const list = Object.entries(all).map(([date, d]) => ({ date, ...d }))
      .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
    res.json(list);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════════════════
   DATA EXPORT / IMPORT
══════════════════════════════════════ */
app.get('/api/export', requireAuth, async (req, res) => {
  try {
    const [leads, reports, settings] = await Promise.all([
      fbGet('leads'), fbGet('reports'), fbGet('settings')
    ]);
    res.json({ leads, reports, settings, exportedAt: new Date().toISOString(), version: '6.0' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/import', requireAuth, async (req, res) => {
  try {
    const { leads } = req.body;
    if (!leads || typeof leads !== 'object') return res.status(400).json({ error: 'بيانات غير صالحة' });
    const existing = await fbGet('leads') || {};
    const merged   = { ...existing, ...leads };
    await fbSet('leads', merged);
    res.json({ success: true, imported: Object.keys(leads).length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════════════════
   HEALTH
══════════════════════════════════════ */
app.get('/health', (_, res) => res.json({ status: 'ok', time: new Date().toISOString(), version: '6.0' }));

/* ── تشغيل الخادم ── */
app.listen(PORT, async () => {
  console.log(`\nTRIPLE AGENTS v6.0 — منفذ ${PORT}`);
  try { const e = await fbGet('settings'); if (!e) await fbSet('settings', DEFAULT_SETTINGS); } catch {}
  await initSchedule();
  console.log('✓ الجدولة التلقائية جاهزة');
});
