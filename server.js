'use strict';
require('dotenv').config();

// ===== الاستيرادات =====
const express = require('express');
const cors    = require('cors');
const jwt     = require('jsonwebtoken');
const cron    = require('node-cron');
const crypto  = require('crypto');

// الوكلاء الثلاثة — كل منهم في ملفه المستقل
const { runSora } = require('./agents/sora');
const { runDeep } = require('./agents/deep');
const { runGold } = require('./agents/gold');
const {
  fbGet, fbSet, fbUpdate, logEvent,
  notifyOwner, DEFAULT_SETTINGS
} = require('./agents/utils');

// ===== الإعداد =====
const app  = express();
const PORT = process.env.PORT || 3000;

// مفتاح JWT مشتق تلقائياً — لا يحتاج متغير بيئة إضافي
const JWT_SECRET = crypto
  .createHash('sha256')
  .update(`${process.env.DASHBOARD_PIN}:${process.env.ANTHROPIC_API_KEY}:sdg-2025`)
  .digest('hex');

const MONTHLY_BUDGET  = parseFloat(process.env.MONTHLY_BUDGET_SAR || '230');
const loginAttempts   = new Map(); // تتبع محاولات الدخول الفاشلة
let   cronJobs        = {};        // مهام الجدولة النشطة

// ===== Express =====
app.use(cors());
app.use(express.json());

// Middleware: التحقق من الجلسة
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'يلزم تسجيل الدخول أولاً' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'جلسة منتهية — يرجى الدخول من جديد' });
  }
}

// ===== الجدولة الديناميكية =====
function timeToCron(hhmm, days) {
  const [h, m] = hhmm.split(':').map(Number);
  const map = { sunday:0, monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6 };
  const nums = Object.entries(days)
    .filter(([, on]) => on)
    .map(([d]) => map[d])
    .sort()
    .join(',');
  return `${m} ${h} * * ${nums || '0-6'}`;
}

async function initSchedule() {
  Object.values(cronJobs).forEach(j => j?.destroy?.());
  cronJobs = {};

  try {
    const s   = await fbGet('settings') || DEFAULT_SETTINGS;
    const sch = s.schedule || DEFAULT_SETTINGS.schedule;
    const day = s.days     || DEFAULT_SETTINGS.days;

    cronJobs.sora = cron.schedule(
      timeToCron(sch.soraStart || '08:00', day),
      async () => {
        const curr = await fbGet('settings');
        if (curr?.mode === 'manual') return;
        await runSora();
      },
      { timezone: 'Asia/Riyadh' }
    );

    cronJobs.deep = cron.schedule(
      timeToCron(sch.deepStart || '10:00', day),
      async () => {
        const curr = await fbGet('settings');
        if (curr?.mode === 'manual') return;
        await runDeep();
      },
      { timezone: 'Asia/Riyadh' }
    );

    cronJobs.gold = cron.schedule(
      timeToCron(sch.goldStart || '20:00', day),
      async () => {
        const curr = await fbGet('settings');
        if (curr?.mode === 'manual') return;
        await runGold();
      },
      { timezone: 'Asia/Riyadh' }
    );

    await logEvent('info', 'الجدول الزمني مفعّل', sch);
    console.log(`  سورا: ${sch.soraStart} | ديب: ${sch.deepStart} | جولد: ${sch.goldStart}`);

  } catch (e) {
    console.error('⚠ خطأ في الجدول، سيُستخدم الجدول الاحتياطي:', e.message);
    cronJobs.sora = cron.schedule('0 8 * * 0-5', () => runSora(), { timezone: 'Asia/Riyadh' });
    cronJobs.deep = cron.schedule('0 10 * * 0-5', () => runDeep(), { timezone: 'Asia/Riyadh' });
    cronJobs.gold = cron.schedule('0 20 * * 0-5', () => runGold(), { timezone: 'Asia/Riyadh' });
  }
}

// ===== نقاط API =====

// تسجيل الدخول بالرمز السري
app.post('/api/auth/login', (req, res) => {
  const { pin } = req.body;
  const ip  = req.ip;
  const now = Date.now();
  const att = loginAttempts.get(ip) || { count: 0, at: 0 };

  // حظر 15 دقيقة بعد 5 محاولات فاشلة
  if (att.count >= 5 && now - att.at < 15 * 60 * 1000) {
    const mins = Math.ceil((15 * 60 * 1000 - (now - att.at)) / 60000);
    return res.status(429).json({ error: `حاول بعد ${mins} دقيقة` });
  }

  if (!pin || String(pin) !== String(process.env.DASHBOARD_PIN)) {
    loginAttempts.set(ip, { count: att.count + 1, at: now });
    return res.status(401).json({ error: 'رمز الدخول غير صحيح' });
  }

  loginAttempts.delete(ip);
  const token = jwt.sign({ role: 'owner' }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token });
});

// إحصائيات لوحة التحكم
app.get('/api/stats', requireAuth, async (req, res) => {
  try {
    const [leads, outreach, settings] = await Promise.all([
      fbGet('leads'), fbGet('outreach'), fbGet('settings')
    ]);
    const la  = Object.values(leads    || {});
    const oa  = Object.values(outreach || {});
    const tod = new Date().toISOString().split('T')[0];

    res.json({
      total: {
        leads:   la.length,
        sent:    la.filter(l => ['أُرسل','ردّ','عميل'].includes(l.status)).length,
        replies: oa.filter(o => o.status === 'ردّ').length,
        clients: la.filter(l => l.status === 'عميل').length
      },
      today: {
        discovered: la.filter(l => l.discoveredAt?.startsWith(tod)).length,
        sent:       oa.filter(o => o.sentAt?.startsWith(tod)).length,
        replies:    oa.filter(o => o.repliedAt?.startsWith(tod)).length
      },
      budget: {
        used:      settings?.budgetUsed || 0,
        limit:     MONTHLY_BUDGET,
        remaining: MONTHLY_BUDGET - (settings?.budgetUsed || 0)
      },
      byStatus: {
        new:     la.filter(l => l.status === 'جديد').length,
        sent:    la.filter(l => l.status === 'أُرسل').length,
        replied: la.filter(l => l.status === 'ردّ').length,
        client:  la.filter(l => l.status === 'عميل').length
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// جلب الإعدادات
app.get('/api/settings', requireAuth, async (req, res) => {
  try {
    res.json(await fbGet('settings') || DEFAULT_SETTINGS);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// تحديث الإعدادات + إعادة الجدولة فوراً
app.put('/api/settings', requireAuth, async (req, res) => {
  try {
    await fbUpdate('settings', req.body);
    if (req.body.schedule || req.body.days) await initSchedule();
    res.json({ success: true, message: 'تم الحفظ وتطبيقه فوراً' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// تشغيل الوكلاء يدوياً (يعمل في الخلفية ويرد فوراً)
app.post('/api/agents/sora/run', requireAuth, (req, res) => {
  res.json({ success: true, message: 'سورا يعمل في الخلفية...' });
  runSora(req.body).catch(e => logEvent('error', 'سورا (يدوي)', { error: e.message }));
});
app.post('/api/agents/deep/run', requireAuth, (req, res) => {
  res.json({ success: true, message: 'ديب يعمل في الخلفية...' });
  runDeep(req.body).catch(e => logEvent('error', 'ديب (يدوي)', { error: e.message }));
});
app.post('/api/agents/gold/run', requireAuth, (req, res) => {
  res.json({ success: true, message: 'جولد يعمل في الخلفية...' });
  runGold().catch(e => logEvent('error', 'جولد (يدوي)', { error: e.message }));
});

// جلب العملاء المحتملين
app.get('/api/leads', requireAuth, async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;
    const all = await fbGet('leads') || {};
    let list  = Object.entries(all).map(([id, d]) => ({ id, ...d }));
    if (status) list = list.filter(l => l.status === status);
    list.sort((a, b) => new Date(b.discoveredAt) - new Date(a.discoveredAt));
    res.json({
      total: list.length,
      leads: list.slice(Number(offset), Number(offset) + Number(limit))
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// جلب التقارير (آخر 30)
app.get('/api/reports', requireAuth, async (req, res) => {
  try {
    const all  = await fbGet('reports') || {};
    const list = Object.entries(all)
      .map(([date, d]) => ({ date, ...d }))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 30);
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// فحص الصحة
app.get('/health', (_, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ===== تشغيل الخادم =====
app.listen(PORT, async () => {
  console.log(`\n✅ سورا · ديب · جولد — منفذ ${PORT}\n`);

  try {
    const existing = await fbGet('settings');
    if (!existing) {
      await fbSet('settings', DEFAULT_SETTINGS);
      console.log('✅ تم تهيئة الإعدادات الافتراضية في Firebase');
    }
  } catch {
    console.warn('⚠ تعذّر الاتصال بـ Firebase — تأكد من FIREBASE_DATABASE_URL و FIREBASE_DATABASE_SECRET');
  }

  await initSchedule();
  console.log('✅ الجدول الزمني مفعّل (Asia/Riyadh)\n');
});
