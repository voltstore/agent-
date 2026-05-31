'use strict';
// ===================================================================
// سورا — الباحث
// ===================================================================
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const Anthropic = require('@anthropic-ai/sdk');
const {
  fbGet, fbPush, logEvent,
  notifyOwner, checkBudget,
  DEFAULT_SETTINGS, MAX_FAILURES
} = require('./utils');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function runSora(options = {}) {
  let failures = 0;
  const t0 = Date.now();

  try {
    if (!(await checkBudget())) return { success: false, reason: 'ميزانية منتهية' };

    const settings  = await fbGet('settings') || DEFAULT_SETTINGS;
    const dayNames  = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const todayKey  = dayNames[new Date().getDay()];
    const cityMap   = settings.cities      || DEFAULT_SETTINGS.cities;
    const cats      = settings.categories  || DEFAULT_SETTINGS.categories;

    const city      = options.city     || cityMap[todayKey] || 'الرياض';
    const category  = options.category || cats[Math.floor(Math.random()*cats.length)];
    const target    = Number(options.target  || settings.dailyTarget || 30);
    const minRating = Number(settings.minRating || 4.0);

    await logEvent('info', `سورا: بدء البحث — ${city} | ${category} | الهدف: ${target}`);
    await notifyOwner('🔍 سورا بدأ البحث',
      `المدينة: ${city}\nالنشاط: ${category}\nالهدف: ${target} شركة`);

    const found    = [];
    let   round    = 0;
    const maxRound = 6;

    while (found.length < target && round < maxRound) {
      round++;
      const remaining = target - found.length;

      try {
        console.log(`  ← جولة البحث ${round} — متبقٍّ ${remaining} شركة`);

        const resp = await anthropic.messages.create({
          model:      'claude-haiku-4-5-20251001',
          max_tokens: 2000,
          tools:      [{ type: 'web_search_20250305', name: 'web_search' }],
          messages: [{
            role: 'user',
            content: buildSearchPrompt(city, category, remaining, minRating)
          }]
        });

        const text = resp.content
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('');

        // تنظيف الرد من علامات markdown
        const clean = text.replace(/```json|```/g, '').trim();
        const match = clean.match(/\{[\s\S]*"companies"[\s\S]*\}/);

        if (match) {
          try {
            const parsed = JSON.parse(match[0]);
            for (const c of (parsed.companies || [])) {
              if (isQualified(c, minRating) && !isDuplicate(c, found)) {
                found.push(c);
                console.log(`  ✓ [${found.length}/${target}] ${c.name} — ${c.city} — ⭐${c.rating}`);
              }
              if (found.length >= target) break;
            }
          } catch (parseErr) {
            console.warn('  ⚠ فشل تحليل JSON:', parseErr.message);
          }
        } else {
          console.warn('  ⚠ لم يُعثر على JSON في الرد');
        }

        failures = 0;
        // تأخير دقيقة بين الجولات
        if (found.length < target && round < maxRound) {
          await sleep(65000);
        }
      } catch (e) {
        failures++;
        await logEvent('error', `سورا: خطأ جولة ${round}`, { error: e.message });
        console.error(`  ✗ جولة ${round} فشلت (${failures}/${MAX_FAILURES}):`, e.message);

        if (failures >= MAX_FAILURES) {
          await notifyOwner('🚨 سورا: خطأ حرج',
            `فشل ${MAX_FAILURES} مرات متتالية:\n${e.message}`);
          throw e;
        }
        await sleep(65000);
      }
    }

    let saved = 0;
    const now = new Date().toISOString();
    for (const c of found) {
      try {
        await fbPush('leads', { ...c, status: 'جديد', discoveredAt: now });
        saved++;
      } catch (e) {
        await logEvent('error', `سورا: فشل حفظ ${c.name}`, { error: e.message });
      }
    }

    const mins = Math.round((Date.now() - t0) / 60000);
    const summary = `المدينة: ${city} | النشاط: ${category}\n🏢 محفوظة: ${saved}\n⏱️ المدة: ${mins} دقيقة`;
    await logEvent('info', `سورا: اكتمل — ${saved} شركة`);
    await notifyOwner('✅ سورا انتهى', summary);
    console.log(`\nسورا اكتمل — ${saved} شركة في ${mins} دقيقة\n`);

    return { success: true, found: saved, city, category };

  } catch (err) {
    await logEvent('error', 'سورا: فشل عام', { error: err.message });
    return { success: false, error: err.message };
  }
}

function buildSearchPrompt(city, category, count, minRating) {
  return `أنت باحث متخصص في السوق السعودي.

ابحث عن ${count} شركة في "${category}" بـ "${city}" تستوفي:
١. لا موقع إلكتروني
٢. تقييم ${minRating}/5 أو أعلى
٣. جوال واتساب أو إيميل للتواصل

أعد النتيجة بـ JSON خام فقط (لا تستخدم \`\`\`json):
{"companies":[{"name":"الاسم","city":"${city}","category":"${category}","phone":"05xxxxxxxx","email":"x@x.com","rating":4.5,"hasWebsite":false,"source":"المصدر"}]}`;
}

function isQualified(c, minRating) {
  return c.name
    && c.hasWebsite === false
    && Number(c.rating) >= minRating
    && (c.phone || c.email);
}

function isDuplicate(c, list) {
  return list.some(x => x.name === c.name);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

if (require.main === module) {
  const [,, city, category, target] = process.argv;
  runSora({ city, category, target: target ? Number(target) : undefined })
    .then(r => { console.log('النتيجة:', r); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}

module.exports = { runSora };