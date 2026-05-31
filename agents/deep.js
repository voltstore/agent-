'use strict';
// ===================================================================
// ديب — المُرسِل
// يكتب رسالة مخصصة لكل شركة ويرسلها عبر الإيميل أو الواتساب
// التشغيل المستقل: node agents/deep.js [limit]
// ===================================================================
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const Anthropic  = require('@anthropic-ai/sdk');
const { Resend } = require('resend');
const {
  fbGet, fbPush, fbUpdate, logEvent,
  notifyOwner, sendWhatsApp, checkBudget,
  DEFAULT_SETTINGS, MAX_FAILURES
} = require('./utils');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const resend    = new Resend(process.env.RESEND_API_KEY);

const DEFAULT_TEMPLATE = `السلام عليكم ورحمة الله،

أتواصل معكم من فريق تصميم المواقع الإلكترونية.

لاحظنا أن شركة {اسم_الشركة} المتخصصة في {النشاط} بـ{المدينة}
تحظى بتقييم ممتاز {التقييم}/5 — وهذا دليل واضح على احترافيتكم.

نودّ مساعدتكم في الوصول لعملاء جدد عبر موقع إلكتروني يليق بسمعتكم:
✅ عرض خدماتكم باحترافية
✅ ظهور في نتائج Google
✅ بيانات تواصل واضحة للعملاء

مواقع احترافية بأسعار مناسبة وبأقصر وقت ممكن.

للاستفسار يسعدنا خدمتكم.

مع التقدير`;

// ===== الدالة الرئيسية =====
async function runDeep(options = {}) {
  let failures = 0;
  const t0 = Date.now();

  try {
    if (!(await checkBudget())) return { success: false, reason: 'ميزانية منتهية' };

    const settings    = await fbGet('settings') || DEFAULT_SETTINGS;
    const dailyTarget = Number(options.limit || settings.dailyTarget || 30);
    const channels    = settings.channels   || DEFAULT_SETTINGS.channels;
    const template    = settings.messageTemplate || DEFAULT_TEMPLATE;

    // جلب الشركات الجديدة
    const allLeads = await fbGet('leads') || {};
    const queue = Object.entries(allLeads)
      .filter(([, l]) => l.status === 'جديد' && (l.email || l.phone))
      .slice(0, dailyTarget);

    if (!queue.length) {
      console.log('ديب: لا توجد شركات جديدة للإرسال');
      return { success: true, sent: 0 };
    }

    await logEvent('info', `ديب: بدء الإرسال — ${queue.length} شركة`);
    await notifyOwner('📧 ديب بدأ الإرسال', `عدد الشركات: ${queue.length}`);
    console.log(`ديب: يُرسل لـ ${queue.length} شركة (دفعات بمعدل 2 كل 4 دقائق)\n`);

    let sent = 0, failed = 0;
    const BATCH = 2;
    const DELAY = 4 * 60 * 1000; // 4 دقائق بين الدفعات تجنباً للحظر

    for (let i = 0; i < queue.length; i += BATCH) {
      const batch = queue.slice(i, i + BATCH);
      console.log(`← دفعة ${Math.floor(i/BATCH)+1}: معالجة ${batch.map(([,l])=>l.name).join('، ')}`);

      for (const [leadId, lead] of batch) {
        try {
          const msg = await generateMessage(lead, template);
          let channel = null;

          // إرسال إيميل
          if (channels.email && lead.email) {
            try {
              await sendEmail(lead.email,
                `عرض خاص لـ ${lead.name} — تصميم موقع احترافي`,
                buildEmailHtml(msg, lead));
              channel = 'email';
              console.log(`  ✓ إيميل → ${lead.name} (${lead.email})`);
            } catch (e) {
              console.error(`  ✗ إيميل فشل لـ ${lead.name}:`, e.message);
              await logEvent('error', `ديب: إيميل فشل لـ ${lead.name}`, { error: e.message });
            }
          }

          // إرسال واتساب (عند التفعيل)
          if (channels.whatsapp && process.env.WHATSAPP_API_TOKEN && lead.phone) {
            try {
              await sendWhatsApp(lead.phone, msg);
              channel = channel ? 'email+whatsapp' : 'whatsapp';
              console.log(`  ✓ واتساب → ${lead.name} (${lead.phone})`);
            } catch (e) {
              console.error(`  ✗ واتساب فشل لـ ${lead.name}:`, e.message);
              await logEvent('error', `ديب: واتساب فشل لـ ${lead.name}`, { error: e.message });
            }
          }

          if (channel) {
            await fbUpdate(`leads/${leadId}`, { status: 'أُرسل', sentAt: new Date().toISOString() });
            await fbPush('outreach', {
              leadId, channel,
              messageText: msg,
              status:  'مُرسَل',
              sentAt:  new Date().toISOString(),
              repliedAt: null
            });
            sent++;
            failures = 0;
          } else {
            failed++;
            failures++;
            if (failures >= MAX_FAILURES) {
              await notifyOwner('🚨 ديب: خطأ حرج', `فشل ${MAX_FAILURES} مرات متتالية`);
              throw new Error('تجاوز حد الفشل');
            }
          }
        } catch (e) {
          await logEvent('error', `ديب: خطأ في ${lead?.name}`, { error: e.message });
          failed++;
        }
      }

      // تأخير بين الدفعات (إلا الأخيرة)
      if (i + BATCH < queue.length) {
        console.log(`  ⏳ انتظار 4 دقائق قبل الدفعة التالية...\n`);
        await sleep(DELAY);
      }
    }

    const mins = Math.round((Date.now() - t0) / 60000);
    await logEvent('info', `ديب: اكتمل — ${sent} مرسلة`);
    await notifyOwner('✅ ديب انتهى',
      `📧 مرسلة: ${sent}\n❌ فاشلة: ${failed}\n⏱️ المدة: ${mins} دقيقة`);
    console.log(`\nديب اكتمل — مرسلة: ${sent} | فاشلة: ${failed} | المدة: ${mins} دقيقة\n`);

    return { success: true, sent, failed };

  } catch (err) {
    await logEvent('error', 'ديب: فشل عام', { error: err.message });
    return { success: false, error: err.message };
  }
}

// ===== توليد رسالة مخصصة =====
async function generateMessage(lead, template) {
  try {
    const resp = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: `أنت كاتب رسائل تسويقية محترف باللغة العربية.
اكتب رسائل واتساب/إيميل مختصرة وفعّالة (لا تتجاوز 120 كلمة).
الرسالة ودية وتذكر اسم الشركة ونشاطها وتقييمها بشكل طبيعي.`,
      messages: [{
        role: 'user',
        content: `اكتب رسالة مخصصة لهذه الشركة بناءً على القالب:

الاسم: ${lead.name}
المدينة: ${lead.city}
النشاط: ${lead.category}
التقييم: ${lead.rating}/5

القالب:
${template}

استبدل {اسم_الشركة} و{المدينة} و{النشاط} و{التقييم} بالقيم الحقيقية.`
      }]
    });
    return resp.content[0].text.trim();
  } catch {
    return template
      .replace(/{اسم_الشركة}/g, lead.name)
      .replace(/{المدينة}/g, lead.city)
      .replace(/{النشاط}/g, lead.category)
      .replace(/{التقييم}/g, lead.rating);
  }
}

// ===== إرسال إيميل =====
// ملاحظة: الخطة المجانية لـ Resend بدون نطاق مخصص
// تقتصر على بريد المالك المسجّل. لإرسال للشركات الخارجية:
// اربط نطاقاً مخصصاً وغيّر from إلى 'info@your-domain.com'
async function sendEmail(to, subject, html) {
  return resend.emails.send({
    from: 'سورا · ديب · جولد <onboarding@resend.dev>',
    to, subject, html
  });
}

function buildEmailHtml(msg, lead) {
  return `
<div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;
  background:#0d0d1a;color:#e2e8f0;padding:28px;border-radius:12px;">
  <h2 style="color:#dc2626;margin-top:0;">عرض خاص لـ ${lead.name}</h2>
  <p style="color:#94a3b8;font-size:13px;margin-bottom:18px;">
    ${lead.category} · ${lead.city} · ⭐ ${lead.rating}
  </p>
  <div style="background:rgba(255,255,255,.05);padding:18px;border-radius:8px;
    border-right:3px solid #dc2626;">
    <p style="line-height:1.9;margin:0;">${msg.replace(/\n/g,'<br>')}</p>
  </div>
  <p style="color:#475569;font-size:11px;margin-top:18px;margin-bottom:0;">
    للاستفسار يرجى الرد على هذا البريد
  </p>
</div>`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ===== تشغيل مستقل =====
// node agents/deep.js 15
if (require.main === module) {
  const [,, limit] = process.argv;
  runDeep({ limit: limit ? Number(limit) : undefined })
    .then(r => { console.log('النتيجة:', r); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}

module.exports = { runDeep };
