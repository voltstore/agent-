'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const axios      = require('axios');
const nodemailer = require('nodemailer');

const FIREBASE_URL    = process.env.FIREBASE_DATABASE_URL;
const FIREBASE_SECRET = process.env.FIREBASE_DATABASE_SECRET;

exports.MONTHLY_BUDGET = parseFloat(process.env.MONTHLY_BUDGET_SAR || '230');
exports.MAX_FAILURES   = 5;

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});

async function fbGet(path) {
  try {
    const r = await axios.get(`${FIREBASE_URL}/${path}.json?auth=${FIREBASE_SECRET}`, { timeout: 10000 });
    return r.data;
  } catch (e) { console.error(`Firebase GET /${path}:`, e.message); return null; }
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
exports.fbGet = fbGet; exports.fbSet = fbSet; exports.fbPush = fbPush; exports.fbUpdate = fbUpdate;

async function logEvent(level, message, data = {}) {
  const ts = new Date().toISOString();
  console.log(`[${level.toUpperCase()}][${ts}] ${message}`, Object.keys(data).length ? data : '');
  try { await fbPush('logs', { level, message, data, timestamp: ts }); } catch {}
}
exports.logEvent = logEvent;

async function sendWhatsApp(to, message) {
  if (!process.env.WHATSAPP_API_TOKEN) throw new Error('WHATSAPP_API_TOKEN فارغ');
  await axios.post(
    `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_ID}/messages`,
    { messaging_product: 'whatsapp', to: to.replace(/\D/g, ''), type: 'text', text: { body: message } },
    { headers: { Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}` }, timeout: 15000 }
  );
}
exports.sendWhatsApp = sendWhatsApp;

async function sendEmail(to, subject, html) {
  await transporter.sendMail({
    from: `سورا · ديب · جولد <${process.env.GMAIL_USER}>`,
    to, subject, html
  });
}
exports.sendEmail = sendEmail;

async function notifyOwner(subject, body) {
  if (process.env.WHATSAPP_API_TOKEN && process.env.OWNER_WHATSAPP_NUMBER) {
    try { await sendWhatsApp(process.env.OWNER_WHATSAPP_NUMBER, `*${subject}*\n\n${body}`); return; }
    catch (e) { console.error('واتساب فشل:', e.message); }
  }
  if (!process.env.GMAIL_USER) return;
  try {
    await sendEmail(process.env.OWNER_EMAIL, `[SDG] ${subject}`,
      `<div dir="rtl" style="font-family:Arial;max-width:600px;background:#0d0d1a;color:#e2e8f0;padding:24px;border-radius:12px;">
      <h2 style="color:#dc2626;">${subject}</h2>
      <p style="line-height:1.9;">${body.replace(/\n/g,'<br>')}</p>
      </div>`);
  } catch (e) { console.error('إيميل فشل:', e.message); }
}
exports.notifyOwner = notifyOwner;

async function checkBudget() {
  try {
    const s = await fbGet('settings');
    const used = s?.budgetUsed || 0;
    if (used >= exports.MONTHLY_BUDGET) {
      await notifyOwner('⛔ الميزانية نفدت', `المصروف ${used} ريال تجاوز الحد.`);
      return false;
    }
    if (used >= exports.MONTHLY_BUDGET * 0.85)
      await notifyOwner('⚠️ الميزانية تقترب', `${Math.round(used/exports.MONTHLY_BUDGET*100)}% استُخدمت`);
    return true;
  } catch { return true; }
}
exports.checkBudget = checkBudget;

exports.DEFAULT_SETTINGS = {
  dailyTarget: 30, minRating: 4.0, mode: 'auto', budgetUsed: 0,
  schedule: { soraStart: '08:00', deepStart: '10:00', goldStart: '20:00' },
  days: { saturday:true, sunday:true, monday:true, tuesday:true, wednesday:true, thursday:true, friday:true },
  cities: { saturday:'الرياض', sunday:'جدة', monday:'الدمام والخبر',
            tuesday:'مكة والمدينة', wednesday:'أبها والطائف', thursday:'تبوك والقصيم', friday:'الرياض' },
  categories: ['تنظيف','مقاولات','شحن ونقل','صيانة','دعاية وإعلان'],
  channels: { email: true, whatsapp: false }
};