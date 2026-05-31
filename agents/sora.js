'use strict';
// ===================================================================
// سورا — الباحث الذكي (Google Places API New)
// ===================================================================
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const https = require('https');
const {
  fbGet, fbSet, fbPush, logEvent,
  notifyOwner, checkBudget,
  DEFAULT_SETTINGS, MAX_FAILURES
} = require('./utils');

const GOOGLE_API_KEY = process.env.GOOGLE_SEARCH_API_KEY;

// ── البحث في Google Places (New API) ──────────────────────────────
function placesSearch(query, pageToken = null) {
  return new Promise((resolve, reject) => {
    const body = { textQuery: query, languageCode: 'ar', maxResultCount: 20 };
    if (pageToken) body.pageToken = pageToken;

    const options = {
      hostname: 'places.googleapis.com',
      path: '/v1/places:searchText',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_API_KEY,
        'X-Goog-FieldMask': [
          'places.displayName',
          'places.nationalPhoneNumber',
          'places.internationalPhoneNumber',
          'places.websiteUri',
          'places.rating',
          'places.userRatingCount',
          'places.formattedAddress',
          'places.id',
          'nextPageToken'
        ].join(',')
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

// ── تحقق من التكرار في Firebase ───────────────────────────────────
async function isAlreadySaved(phone, name) {
  try {
    const leads = await fbGet('leads') || {};
    return Object.values(leads).some(l =>
      (phone && l.phone === phone) || l.name === name
    );
  } catch { return false; }
}

// ── تحليل مكان وتحويله لشركة ──────────────────────────────────────
function parsePlace(place, city, category) {
  const name = place.displayName?.text || '';
  const phone = (place.nationalPhoneNumber || place.internationalPhoneNumber || '')
    .replace(/\s|-/g, '');
  const hasWebsite = !!place.websiteUri;
  const rating = place.rating || 0;
  const reviewCount = place.userRatingCount || 0;
  const address = place.formattedAddress || city;

  return { name, phone, hasWebsite, rating, reviewCount, address, city, category };
}

// ── الدالة الرئيسية ────────────────────────────────────────────────
async function runSora(options = {}) {
  const t0 = Date.now();
  let failures = 0;
  let totalScanned = 0;
  let totalSkipped = 0;

  try {
    if (!(await checkBudget())) return { success: false, reason: 'ميزانية منتهية' };

    const settings  = await fbGet('settings') || DEFAULT_SETTINGS;
    const dayNames  = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const todayKey  = dayNames[new Date().getDay()];
    const cityMap   = settings.cities     || DEFAULT_SETTINGS.cities;
    const cats      = settings.categories || DEFAULT_SETTINGS.categories;

    const city      = options.city     || cityMap[todayKey] || 'الرياض';
    const category  = options.category || cats[Math.floor(Math.random() * cats.length)];
    const target    = Number(options.target || settings.dailyTarget || 30);
    const minRating = Number(settings.minRating || 4.0);
    const minReviews = Number(settings.minReviews || 10);

    await logEvent('info', `سورا: بدء البحث — ${city} | ${category} | الهدف: ${target}`);
    await notifyOwner('🔍 سورا بدأ البحث',
      `المدينة: ${city}\nالنشاط: ${category}\nالهدف: ${target} شركة\nالحد الأدنى للتقييم: ${minRating}⭐`);

    const found = [];
    let round = 0;
    const maxRound = 8;

    // استعلامات متنوعة لتغطية أوسع
    const queries = [
      `${category} ${city}`,
      `${category} في ${city}`,
      `أفضل ${category} ${city}`,
      `${category} ${city} خدمات`,
      `شركة ${category} ${city}`,
      `مؤسسة ${category} ${city}`,
      `${category} ${city} محترف`,
      `${category} بالقرب من ${city}`,
    ];

    while (found.length < target && round < maxRound) {
      round++;
      const query = queries[(round - 1) % queries.length];
      console.log(`\n  ← جولة البحث ${round}/${maxRound} — "${query}"`);
      console.log(`     متبقٍّ: ${target - found.length} | تم العثور: ${found.length}`);

      try {
        const results = await placesSearch(query);
        const places = results.places || [];
        totalScanned += places.length;

        console.log(`     نتائج Google: ${places.length} مكان`);

        for (const place of places) {
          if (found.length >= target) break;

          const company = parsePlace(place, city, category);

          // فلاتر الجودة
          if (company.hasWebsite) {
            totalSkipped++;
            continue; // عنده موقع — تخطى
          }
          if (company.rating < minRating) {
            totalSkipped++;
            continue; // تقييم منخفض
          }
          if (company.reviewCount < minReviews) {
            totalSkipped++;
            continue; // تقييمات قليلة
          }
          if (!company.phone) {
            totalSkipped++;
            continue; // لا رقم هاتف
          }
          if (!company.name || company.name.length < 3) {
            totalSkipped++;
            continue;
          }

          // تحقق من التكرار في الجلسة الحالية
          if (found.some(f => f.phone === company.phone || f.name === company.name)) {
            totalSkipped++;
            continue;
          }

          // تحقق من التكرار في Firebase
          if (await isAlreadySaved(company.phone, company.name)) {
            console.log(`     ⟳ مكرر: ${company.name}`);
            totalSkipped++;
            continue;
          }

          found.push(company);
          console.log(`  ✓ [${found.length}/${target}] ${company.name}`);
          console.log(`     📞 ${company.phone} | ⭐ ${company.rating} (${company.reviewCount} تقييم)`);

          await sleep(100); // تأخير صغير
        }

        failures = 0;

        if (found.length < target && round < maxRound) {
          console.log(`     ⏳ انتظار 2 ثانية...`);
          await sleep(2000);
        }

      } catch (e) {
        failures++;
        await logEvent('error', `سورا: خطأ جولة ${round}`, { error: e.message });
        console.error(`  ✗ جولة ${round} فشلت (${failures}/${MAX_FAILURES}):`, e.message);

        if (failures >= MAX_FAILURES) {
          await notifyOwner('🚨 سورا: خطأ حرج', `فشل ${MAX_FAILURES} مرات:\n${e.message}`);
          throw e;
        }
        await sleep(5000);
      }
    }

    // ── حفظ الشركات في Firebase ──
    let saved = 0;
    const now = new Date().toISOString();

    for (const c of found) {
      try {
        await fbPush('leads', {
          ...c,
          status: 'جديد',
          discoveredAt: now,
          source: 'Google Maps',
          contacted: false,
          notes: ''
        });
        saved++;
      } catch (e) {
        await logEvent('error', `سورا: فشل حفظ ${c.name}`, { error: e.message });
      }
    }

    // ── تحديث إحصائيات اليوم ──
    try {
      const today = new Date().toISOString().split('T')[0];
      const statsKey = `stats/daily/${today}`;
      const existing = await fbGet(statsKey) || {};
      await fbSet(statsKey, {
        ...existing,
        soraFound: (existing.soraFound || 0) + saved,
        soraScanned: (existing.soraScanned || 0) + totalScanned,
        soraRuns: (existing.soraRuns || 0) + 1,
        lastRun: now
      });
    } catch (e) {
      console.warn('تحذير: فشل تحديث الإحصائيات:', e.message);
    }

    const mins = Math.round((Date.now() - t0) / 60000);
    const secs = Math.round((Date.now() - t0) / 1000);

    const summary = [
      `المدينة: ${city} | النشاط: ${category}`,
      `🏢 محفوظة: ${saved}/${target}`,
      `🔍 فُحص: ${totalScanned} | تجاوز: ${totalSkipped}`,
      `⏱️ المدة: ${mins > 0 ? mins + ' دقيقة' : secs + ' ثانية'}`
    ].join('\n');

    await logEvent('info', `سورا: اكتمل — ${saved} شركة`);
    await notifyOwner('✅ سورا انتهى', summary);

    console.log(`\n${'='.repeat(50)}`);
    console.log(`سورا اكتمل!`);
    console.log(`محفوظة: ${saved} | فُحص: ${totalScanned} | تجاوز: ${totalSkipped}`);
    console.log(`المدة: ${mins > 0 ? mins + ' دقيقة' : secs + ' ثانية'}`);
    console.log('='.repeat(50) + '\n');

    return { success: true, found: saved, scanned: totalScanned, skipped: totalSkipped, city, category };

  } catch (err) {
    await logEvent('error', 'سورا: فشل عام', { error: err.message });
    return { success: false, error: err.message };
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

if (require.main === module) {
  const [,, city, category, target] = process.argv;
  runSora({ city, category, target: target ? Number(target) : undefined })
    .then(r => { console.log('\nالنتيجة النهائية:', r); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}

module.exports = { runSora };