'use strict';
require('dotenv').config();

// ===== ط§ظ„ط§ط³طھظٹط±ط§ط¯ط§طھ =====
const express = require('express');
const cors    = require('cors');
const jwt     = require('jsonwebtoken');
const cron    = require('node-cron');
const crypto  = require('crypto');

// ط§ظ„ظˆظƒظ„ط§ط، ط§ظ„ط«ظ„ط§ط«ط© â€” ظƒظ„ ظ…ظ†ظ‡ظ… ظپظٹ ظ…ظ„ظپظ‡ ط§ظ„ظ…ط³طھظ‚ظ„
const { runSora } = require('./agents/sora');
const { runDeep } = require('./agents/deep');
const { runGold } = require('./agents/gold');
const {
  fbGet, fbSet, fbUpdate, logEvent,
  notifyOwner, DEFAULT_SETTINGS
} = require('./agents/utils');

// ===== ط§ظ„ط¥ط¹ط¯ط§ط¯ =====
const app  = express();
const PORT = process.env.PORT || 3000;

// ظ…ظپطھط§ط­ JWT ظ…ط´طھظ‚ طھظ„ظ‚ط§ط¦ظٹط§ظ‹ â€” ظ„ط§ ظٹط­طھط§ط¬ ظ…طھط؛ظٹط± ط¨ظٹط¦ط© ط¥ط¶ط§ظپظٹ
const JWT_SECRET = crypto
  .createHash('sha256')
  .update(`${process.env.DASHBOARD_PIN}:${process.env.ANTHROPIC_API_KEY}:sdg-2025`)
  .digest('hex');

const MONTHLY_BUDGET  = parseFloat(process.env.MONTHLY_BUDGET_SAR || '230');
const loginAttempts   = new Map(); // طھطھط¨ط¹ ظ…ط­ط§ظˆظ„ط§طھ ط§ظ„ط¯ط®ظˆظ„ ط§ظ„ظپط§ط´ظ„ط©
let   cronJobs        = {};        // ظ…ظ‡ط§ظ… ط§ظ„ط¬ط¯ظˆظ„ط© ط§ظ„ظ†ط´ط·ط©

// ===== Express =====
app.use(cors());
app.use(express.json());

// Middleware: ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† ط§ظ„ط¬ظ„ط³ط©
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'ظٹظ„ط²ظ… طھط³ط¬ظٹظ„ ط§ظ„ط¯ط®ظˆظ„ ط£ظˆظ„ط§ظ‹' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'ط¬ظ„ط³ط© ظ…ظ†طھظ‡ظٹط© â€” ظٹط±ط¬ظ‰ ط§ظ„ط¯ط®ظˆظ„ ظ…ظ† ط¬ط¯ظٹط¯' });
  }
}

// ===== ط§ظ„ط¬ط¯ظˆظ„ط© ط§ظ„ط¯ظٹظ†ط§ظ…ظٹظƒظٹط© =====
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

    await logEvent('info', 'ط§ظ„ط¬ط¯ظˆظ„ ط§ظ„ط²ظ…ظ†ظٹ ظ…ظپط¹ظ‘ظ„', sch);
    console.log(`  ط³ظˆط±ط§: ${sch.soraStart} | ط¯ظٹط¨: ${sch.deepStart} | ط¬ظˆظ„ط¯: ${sch.goldStart}`);

  } catch (e) {
    console.error('âڑ  ط®ط·ط£ ظپظٹ ط§ظ„ط¬ط¯ظˆظ„طŒ ط³ظٹظڈط³طھط®ط¯ظ… ط§ظ„ط¬ط¯ظˆظ„ ط§ظ„ط§ط­طھظٹط§ط·ظٹ:', e.message);
    cronJobs.sora = cron.schedule('0 8 * * 0-5', () => runSora(), { timezone: 'Asia/Riyadh' });
    cronJobs.deep = cron.schedule('0 10 * * 0-5', () => runDeep(), { timezone: 'Asia/Riyadh' });
    cronJobs.gold = cron.schedule('0 20 * * 0-5', () => runGold(), { timezone: 'Asia/Riyadh' });
  }
}

// ===== ظ†ظ‚ط§ط· API =====

// طھط³ط¬ظٹظ„ ط§ظ„ط¯ط®ظˆظ„ ط¨ط§ظ„ط±ظ…ط² ط§ظ„ط³ط±ظٹ
app.post('/api/auth/login', (req, res) => {
  const { pin } = req.body;
  const ip  = req.ip;
  const now = Date.now();
  const att = loginAttempts.get(ip) || { count: 0, at: 0 };

  // ط­ط¸ط± 15 ط¯ظ‚ظٹظ‚ط© ط¨ط¹ط¯ 5 ظ…ط­ط§ظˆظ„ط§طھ ظپط§ط´ظ„ط©
  if (att.count >= 5 && now - att.at < 15 * 60 * 1000) {
    const mins = Math.ceil((15 * 60 * 1000 - (now - att.at)) / 60000);
    return res.status(429).json({ error: `ط­ط§ظˆظ„ ط¨ط¹ط¯ ${mins} ط¯ظ‚ظٹظ‚ط©` });
  }

  if (!pin || String(pin) !== String(process.env.DASHBOARD_PIN)) {
    loginAttempts.set(ip, { count: att.count + 1, at: now });
    return res.status(401).json({ error: 'ط±ظ…ط² ط§ظ„ط¯ط®ظˆظ„ ط؛ظٹط± طµط­ظٹط­' });
  }

  loginAttempts.delete(ip);
  const token = jwt.sign({ role: 'owner' }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token });
});

// ط¥ط­طµط§ط¦ظٹط§طھ ظ„ظˆط­ط© ط§ظ„طھط­ظƒظ…
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
        sent:    la.filter(l => ['ط£ظڈط±ط³ظ„','ط±ط¯ظ‘','ط¹ظ…ظٹظ„'].includes(l.status)).length,
        replies: oa.filter(o => o.status === 'ط±ط¯ظ‘').length,
        clients: la.filter(l => l.status === 'ط¹ظ…ظٹظ„').length
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
        new:     la.filter(l => l.status === 'ط¬ط¯ظٹط¯').length,
        sent:    la.filter(l => l.status === 'ط£ظڈط±ط³ظ„').length,
        replied: la.filter(l => l.status === 'ط±ط¯ظ‘').length,
        client:  la.filter(l => l.status === 'ط¹ظ…ظٹظ„').length
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ط¬ظ„ط¨ ط§ظ„ط¥ط¹ط¯ط§ط¯ط§طھ
app.get('/api/settings', requireAuth, async (req, res) => {
  try {
    res.json(await fbGet('settings') || DEFAULT_SETTINGS);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// طھط­ط¯ظٹط« ط§ظ„ط¥ط¹ط¯ط§ط¯ط§طھ + ط¥ط¹ط§ط¯ط© ط§ظ„ط¬ط¯ظˆظ„ط© ظپظˆط±ط§ظ‹
app.put('/api/settings', requireAuth, async (req, res) => {
  try {
    await fbUpdate('settings', req.body);
    if (req.body.schedule || req.body.days) await initSchedule();
    res.json({ success: true, message: 'طھظ… ط§ظ„ط­ظپط¸ ظˆطھط·ط¨ظٹظ‚ظ‡ ظپظˆط±ط§ظ‹' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// طھط´ط؛ظٹظ„ ط§ظ„ظˆظƒظ„ط§ط، ظٹط¯ظˆظٹط§ظ‹ (ظٹط¹ظ…ظ„ ظپظٹ ط§ظ„ط®ظ„ظپظٹط© ظˆظٹط±ط¯ ظپظˆط±ط§ظ‹)

// تحديث حالة شركة
app.put('/api/leads/:id', requireAuth, async (req, res) => {
  try {
    await fbUpdate(\leads/\\, req.body);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// حذف شركة
app.delete('/api/leads/:id', requireAuth, async (req, res) => {
  try {
    const all = await fbGet('leads') || {};
    delete all[req.params.id];
    await fbSet('leads', all);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/agents/sora/run', requireAuth, (req, res) => {
  res.json({ success: true, message: 'ط³ظˆط±ط§ ظٹط¹ظ…ظ„ ظپظٹ ط§ظ„ط®ظ„ظپظٹط©...' });
  runSora(req.body).catch(e => logEvent('error', 'ط³ظˆط±ط§ (ظٹط¯ظˆظٹ)', { error: e.message }));
});
app.post('/api/agents/deep/run', requireAuth, (req, res) => {
  res.json({ success: true, message: 'ط¯ظٹط¨ ظٹط¹ظ…ظ„ ظپظٹ ط§ظ„ط®ظ„ظپظٹط©...' });
  runDeep(req.body).catch(e => logEvent('error', 'ط¯ظٹط¨ (ظٹط¯ظˆظٹ)', { error: e.message }));
});
app.post('/api/agents/gold/run', requireAuth, (req, res) => {
  res.json({ success: true, message: 'ط¬ظˆظ„ط¯ ظٹط¹ظ…ظ„ ظپظٹ ط§ظ„ط®ظ„ظپظٹط©...' });
  runGold().catch(e => logEvent('error', 'ط¬ظˆظ„ط¯ (ظٹط¯ظˆظٹ)', { error: e.message }));
});

// ط¬ظ„ط¨ ط§ظ„ط¹ظ…ظ„ط§ط، ط§ظ„ظ…ط­طھظ…ظ„ظٹظ†
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

// ط¬ظ„ط¨ ط§ظ„طھظ‚ط§ط±ظٹط± (ط¢ط®ط± 30)
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

// ظپط­طµ ط§ظ„طµط­ط©
app.get('/health', (_, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ===== طھط´ط؛ظٹظ„ ط§ظ„ط®ط§ط¯ظ… =====
app.listen(PORT, async () => {
  console.log(`\nâœ… ط³ظˆط±ط§ آ· ط¯ظٹط¨ آ· ط¬ظˆظ„ط¯ â€” ظ…ظ†ظپط° ${PORT}\n`);

  try {
    const existing = await fbGet('settings');
    if (!existing) {
      await fbSet('settings', DEFAULT_SETTINGS);
      console.log('âœ… طھظ… طھظ‡ظٹط¦ط© ط§ظ„ط¥ط¹ط¯ط§ط¯ط§طھ ط§ظ„ط§ظپطھط±ط§ط¶ظٹط© ظپظٹ Firebase');
    }
  } catch {
    console.warn('âڑ  طھط¹ط°ظ‘ط± ط§ظ„ط§طھطµط§ظ„ ط¨ظ€ Firebase â€” طھط£ظƒط¯ ظ…ظ† FIREBASE_DATABASE_URL ظˆ FIREBASE_DATABASE_SECRET');
  }

  await initSchedule();
  console.log('âœ… ط§ظ„ط¬ط¯ظˆظ„ ط§ظ„ط²ظ…ظ†ظٹ ظ…ظپط¹ظ‘ظ„ (Asia/Riyadh)\n');
});

