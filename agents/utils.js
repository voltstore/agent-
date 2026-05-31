'use strict';
// ===== أدوات مشتركة بين الوكلاء الثلاثة =====
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const axios      = require('axios');
const { Resend } = require('resend');

const FIREBASE_URL    = process.env.FIREBASE_DATABASE_URL;
const FIREBASE_SECRET = process.env.FIREBASE_DATABASE_SECRET;

exports.MONTHLY_BUDGET = parseFloat(process.env.MONTHLY_BUDGET_SAR || '230');
exports.MAX_FAILURES   = 5;

// ===== Firebase REST API =====
async function fbGet(path) {
  try {
    const r = await axios.get(`${FIREBASE_URL}/${path}.json?auth=${FIREBASE_SECRET}`, { timeout: 10000 });
    return r.data;
  } catch (e) {
    console.error(`Firebase GET /${path}:`, e.message);
    return null;
  }
}
async function fbSet(path, data) {
  await axios.put(`${FIREBASE_URL}/${path}.json?auth=${FIREBASE_SECRET}`, data, { timeout: 10000 });
}
async function fbPush(path, data) {
  const r = await axios.post(`${FIREBASE_URL}/${path}.json?auth=${FIREBASE_SECRET}`, data, { timeout: 10000 });
  return r.data.name;
}
async function fbUpdate(path, data) {
  await axios.patch(`${FIREBASE_URL}/${path}.json?auth=${FIREBASE_SECRET}`, data, { timeout: 10000 });
}
exports.fbGet    = fbGet;
exports.fbSet    = fbSet;
exports.fbPush   = fbPush;
exports.fbUpdate = fbUpdate;

// ===== تسجيل العمليات =====
async function logEvent(level, message, data = {}) {
  const ts = new Date().toISOString();
  console.log(`[${level.toUpperCase()}][${ts}] ${message}`, Object.keys(data).length ? data : '');
  try {
    await fbPush('logs', { level, message, data, timestamp: ts });
  } catch {}
}
exports.logEvent = logEvent;

// ===== إرسال واتساب =====
async function sendWhatsApp(to, message) {
  if (!process.env.WHATSAPP_API_TOKEN) throw new Error('WHATSAPP_API_TOKEN فارغ');
  await axios.post(
    `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_ID}/messages`,
    { messaging_product: 'whatsapp', to: to.replace(/\D/g, ''), type: 'text', text: { body: message } },
    { headers: { Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}` }, timeout: 15000 }
  );
}
exports.sendWhatsApp = sendWhatsApp;

// ===== إشعار المالك (إيميل أو واتساب) =====
const resend = new Resend(process.env.RESEND_API_KEY);

async function notifyOwner(subject, body) {
  if (process.env.WHATSAPP_API_TOKEN && process.env.OWNER_WHATSAPP_NUMBER) {
    try {
      await sendWhatsApp(process.env.OWNER_WHATSAPP_NUMBER, `*${subject}*\n\n${body}`);
      return;
    } catch (e) {
      console.error('واتساب فشل، سيُجرَّب الإيميل:', e.message);
    }
  }
  if (!process.env.OWNER_EMAIL) return;
  try {
    await resend.emails.send({
      from: 'سورا · ديب · جولد <onboarding@resend.dev>',
      to:   process.env.OWNER_EMAIL,
      subject: `[SDG] ${subject}`,
      html: `<div dir="rtl" style="font-family:Arial;max-width:600px;background:#0d0d1a;color:#e2e8f0;
        padding:24px;border-radius:12px;border:1px solid rgba(220,38,38,.3);">
        <h2 style="color:#dc2626;margin-top:0;">${subject}</h2>
        <div style="background:rgba(255,255,255,.04);padding:16px;border-radius:8px;
          border-right:3px solid #dc2626;">
          <p style="line-height:1.9;margin:0;">${body.replace(/\n/g,'<br>')}</p>
        </div>
        <p style="color:#475569;font-size:12px;margin-top:16px;margin-bottom:0;">
          سورا · ديب · جولد</p>
      </div>`
    });
  } catch (e) {
    console.error('إيميل فشل:', e.message);
  }
}
exports.notifyOwner = notifyOwner;

// ===== فحص الميزانية =====
async function checkBudget() {
  try {
    const s    = await fbGet('settings');
    const used = s?.budgetUsed || 0;
    if (used >= exports.MONTHLY_BUDGET) {
      await notifyOwner('⛔ الميزانية نفدت',
        `المصروف ${used} ريال تجاوز الحد ${exports.MONTHLY_BUDGET} ريال.\nتم إيقاف العمليات.`);
      return false;
    }
    if (used >= exports.MONTHLY_BUDGET * 0.85) {
      await notifyOwner('⚠️ الميزانية تقترب',
        `${Math.round(used/exports.MONTHLY_BUDGET*100)}% من الميزانية استُخدمت (${used}/${exports.MONTHLY_BUDGET} ريال)`);
    }
    return true;
  } catch { return true; }
}
exports.checkBudget = checkBudget;

// ===== الإعدادات الافتراضية =====
exports.DEFAULT_SETTINGS = {
  dailyTarget: 30, minRating: 4.0, mode: 'auto', budgetUsed: 0,
  schedule: { soraStart: '08:00', deepStart: '10:00', goldStart: '20:00' },
  days: { saturday:true, sunday:true, monday:true, tuesday:true, wednesday:true, thursday:true, friday:true },
  cities: { saturday:'الرياض', sunday:'جدة', monday:'الدمام والخبر',
            tuesday:'مكة والمدينة', wednesday:'أبها والطائف', thursday:'تبوك والقصيم', friday:'الرياض' },
  categories: ['تنظيف','مقاولات','شحن ونقل','صيانة','دعاية وإعلان'],
  channels: { email: true, whatsapp: false }
};
