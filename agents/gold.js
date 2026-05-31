'use strict';
// ===================================================================
// جولد — المحلل
// يقرأ بيانات اليوم ويولّد تقريراً شاملاً ويرسله للمالك
// التشغيل المستقل: node agents/gold.js [date]
// ===================================================================
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const Anthropic = require('@anthropic-ai/sdk');
const {
  fbGet, fbSet, logEvent,
  notifyOwner, MAX_FAILURES
} = require('./utils');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ===== الدالة الرئيسية =====
async function runGold(options = {}) {
  let failures = 0;
  const today  = options.date || new Date().toISOString().split('T')[0];

  try {
    await logEvent('info', `جولد: بدء تقرير ${today}`);
    console.log(`\nجولد: يولّد تقرير ${today}...\n`);

    // جمع البيانات من Firebase
    const [allLeads, allOutreach] = await Promise.all([
      fbGet('leads')    || {},
      fbGet('outreach') || {}
    ]);

    const leadsArr    = Object.values(allLeads    || {});
    const outreachArr = Object.values(allOutreach || {});

    // بيانات اليوم
    const todayLeads   = leadsArr.filter(l  => l.discoveredAt?.startsWith(today));
    const todaySent    = outreachArr.filter(o => o.sentAt?.startsWith(today));
    const todayReplies = outreachArr.filter(o => o.repliedAt?.startsWith(today));

    // بيانات كلية
    const allClients   = leadsArr.filter(l => l.status === 'عميل');
    const convRate     = todaySent.length
      ? Math.round(todayReplies.length / todaySent.length * 100) : 0;

    // أفضل الشركات المرشحة للتحويل
    const topLeads = leadsArr
      .filter(l => l.status === 'ردّ')
      .sort((a,b) => Number(b.rating) - Number(a.rating))
      .slice(0, 5);

    // تحليل توزيع المدن
    const cityCount = {};
    todayLeads.forEach(l => {
      cityCount[l.city] = (cityCount[l.city] || 0) + 1;
    });
    const topCity = Object.entries(cityCount)
      .sort((a,b) => b[1]-a[1])[0]?.[0] || '—';

    console.log('البيانات المجمّعة:');
    console.log(`  · اليوم — مكتشفة: ${todayLeads.length} | مرسلة: ${todaySent.length} | ردود: ${todayReplies.length}`);
    console.log(`  · الكلي — عملاء محتملون: ${leadsArr.length} | عملاء فعليون: ${allClients.length}`);

    // توليد نص التقرير بـ Claude Haiku
    const resp = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      system: `أنت محلل أعمال محترف. تولّد تقارير يومية مختصرة وعملية باللغة العربية.
التقرير منظّم وسهل القراءة، لا يتجاوز 250 كلمة.`,
      messages: [{
        role: 'user',
        content: buildAnalysisPrompt({
          today, todayLeads, todaySent, todayReplies,
          convRate, topCity, leadsArr, allClients, topLeads
        })
      }]
    });

    const reportText = resp.content[0].text.trim();

    // بناء كائن التقرير
    const report = {
      date:           today,
      companiesFound: todayLeads.length,
      messagesSent:   todaySent.length,
      replies:        todayReplies.length,
      conversionRate: convRate,
      topCity,
      totalLeads:     leadsArr.length,
      totalClients:   allClients.length,
      topLeads:       topLeads.map(l => ({ name: l.name, city: l.city, rating: l.rating })),
      reportText,
      generatedAt:    new Date().toISOString()
    };

    // حفظ التقرير في Firebase
    await fbSet(`reports/${today}`, report);
    console.log(`✓ التقرير حُفظ في Firebase تحت reports/${today}`);

    // إرسال الملخص للمالك
    const summary = buildSummary(report);
    await notifyOwner(`📊 تقرير جولد — ${today}`, summary);

    await logEvent('info', `جولد: اكتمل تقرير ${today}`);
    console.log('\n' + '─'.repeat(50));
    console.log(reportText);
    console.log('─'.repeat(50) + '\n');

    return { success: true, report };

  } catch (err) {
    failures++;
    if (failures >= MAX_FAILURES) {
      await notifyOwner('🚨 جولد: خطأ حرج', `فشل ${MAX_FAILURES} مرات: ${err.message}`);
    }
    await logEvent('error', 'جولد: فشل التقرير', { error: err.message });
    console.error('جولد فشل:', err.message);
    return { success: false, error: err.message };
  }
}

// ===== بناء برومت التحليل =====
function buildAnalysisPrompt({ today, todayLeads, todaySent, todayReplies,
  convRate, topCity, leadsArr, allClients, topLeads }) {

  const topLeadsStr = topLeads.length
    ? topLeads.map(l => `  - ${l.name} (${l.city}) ⭐${l.rating}`).join('\n')
    : '  لا يوجد بعد';

  return `حلّل بيانات يوم ${today} وولّد تقريراً مختصراً:

📅 إحصائيات اليوم:
• شركات مكتشفة: ${todayLeads.length}
• رسائل مرسلة: ${todaySent.length}
• ردود واردة: ${todayReplies.length}
• نسبة التحويل: ${convRate}%
• أكثر مدينة نشاطاً: ${topCity}

📊 الإحصائيات الكلية:
• إجمالي العملاء المحتملين: ${leadsArr.length}
• إجمالي العملاء الفعليين: ${allClients.length}

🌟 أفضل المرشحين للتحويل:
${topLeadsStr}

اكتب التقرير بثلاثة أقسام:
١. الملخص التنفيذي (جملتان)
٢. أبرز إنجاز اليوم
٣. توصية واحدة ملموسة للغد`;
}

// ===== بناء الملخص النصي للإشعار =====
function buildSummary(r) {
  return `🏢 مكتشفة: ${r.companiesFound} | 📧 مرسلة: ${r.messagesSent} | 💬 ردود: ${r.replies} | 📊 تحويل: ${r.conversionRate}%

${r.reportText}`;
}

// ===== تشغيل مستقل =====
// node agents/gold.js            ← تقرير اليوم
// node agents/gold.js 2025-05-29 ← تقرير يوم محدد
if (require.main === module) {
  const [,, date] = process.argv;
  runGold({ date })
    .then(r => { console.log('النتيجة:', r.success ? '✅ نجح' : '❌ فشل'); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}

module.exports = { runGold };
