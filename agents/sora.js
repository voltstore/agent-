'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const https = require('https');
const { fbGet, fbSet, fbPush, logEvent, checkBudget, DEFAULT_SETTINGS, MAX_FAILURES } = require('./utils');

const GOOGLE_API_KEY = process.env.GOOGLE_SEARCH_API_KEY;

const ALL_AREAS = [
  'الرياض','شمال الرياض','جنوب الرياض','شرق الرياض','غرب الرياض',
  'العليا الرياض','الملقا الرياض','النرجس الرياض','الياسمين الرياض',
  'الورود الرياض','الروضة الرياض','السليمانية الرياض','المحمدية الرياض',
  'الخرج','الدرعية','الزلفي','المجمعة','شقراء','الدوادمي',
  'الأفلاج','وادي الدواسر','السليل',
  'جدة','شمال جدة','جنوب جدة','وسط جدة','الروضة جدة',
  'الحمراء جدة','الزهراء جدة','البوادي جدة','الصفا جدة',
  'الفيصلية جدة','السامر جدة','أبحر جدة','الشاطئ جدة','بريمان جدة',
  'مكة المكرمة','العزيزية مكة','الشهداء مكة',
  'الطائف','شمال الطائف','الهدا','الشفا','الكر',
  'المدينة المنورة','العوالي المدينة','قباء','العقيق المدينة',
  'الدمام','الخبر','الظهران','القطيف','سيهات','صفوى',
  'العوامية','الجبيل','الأحساء','الهفوف','المبرز','العيون',
  'تبوك','شرما','البدع','حائل','بقعاء','الغزالة',
  'عرعر','رفحاء','طريف','سكاكا','القريات','دومة الجندل',
  'أبها','خميس مشيط','محايل عسير','النماص','بيشة',
  'ظهران الجنوب','جازان','صبيا','أبو عريش','صامطة','الدرب',
  'نجران','شرورة','حبونا',
  'ينبع','رابغ','الليث','القنفذة','المويه','العرضيات'
];

/* ══════════════════════════════════
   تطبيع أرقام الجوال (إصلاح الخطأ الرئيسي)
   Google يرجع +9665XXXXXXXX أو 05XXXXXXXX
   كلاهما يجب أن يُقبل ويُحوَّل لـ 05XXXXXXXX
══════════════════════════════════ */
function normalizePhone(raw) {
  if (!raw) return '';
  const d = raw.replace(/\D/g, '');                       // أرقام فقط
  if (d.startsWith('9665')   && d.length >= 12) return '0' + d.slice(3);   // 9665XXXXXXXX → 05XXXXXXXX
  if (d.startsWith('009665') && d.length >= 14) return '0' + d.slice(5);   // 009665XXXXXXXX → 05XXXXXXXX
  if (d.startsWith('05')     && d.length === 10) return d;                  // 05XXXXXXXX ← صحيح أصلاً
  return '';
}

function isValidSaudiMobile(rawPhone) {
  const norm = normalizePhone(rawPhone);
  return norm.startsWith('05') && norm.length === 10;
}

/* ══════════════════════════════════
   طلب Google Places مع دعم الـ pageToken
══════════════════════════════════ */
function gRequest(body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'places.googleapis.com',
      path:     '/v1/places:searchText',
      method:   'POST',
      headers: {
        'Content-Type':     'application/json',
        'X-Goog-Api-Key':   GOOGLE_API_KEY,
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
    const req = https.request(opts, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); }
        catch(e) { reject(new Error('JSON: ' + buf.slice(0, 100))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(18000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(JSON.stringify(body));
    req.end();
  });
}

/* جلب كل الصفحات لاستعلام واحد (حتى 60 نتيجة بدل 20) */
async function fetchAllPages(query) {
  const all = [];
  let token = null, page = 0;
  do {
    const body = { textQuery: query, languageCode: 'ar', maxResultCount: 20 };
    if (token) body.pageToken = token;
    const r = await gRequest(body);
    all.push(...(r.places || []));
    token = r.nextPageToken || null;
    page++;
    if (token && page < 3) await sleep(500);
  } while (token && page < 3);
  return all;
}

/* 12 صيغة بحث مختلفة لتجنب نفس النتائج */
function buildQueries(city, category) {
  return [
    `${category} ${city}`,
    `${category} في ${city}`,
    `محلات ${category} ${city}`,
    `أفضل ${category} ${city}`,
    `خدمات ${category} ${city}`,
    `شركة ${category} ${city}`,
    `مؤسسة ${category} ${city}`,
    `${category} ${city} رخيص`,
    `${category} منطقة ${city}`,
    `${city} ${category}`,
    `${category} قريب من ${city}`,
    `متاجر ${category} في ${city}`,
  ];
}

async function isAlreadySaved(phone, name) {
  try {
    const norm = normalizePhone(phone);
    const all  = await fbGet('leads') || {};
    return Object.values(all).some(l => {
      const lp = normalizePhone(l.phone || '');
      return (norm && lp === norm) || l.name === name;
    });
  } catch { return false; }
}

function parsePlace(p, city, category) {
  const rawPhone = p.nationalPhoneNumber || p.internationalPhoneNumber || '';
  return {
    name:        p.displayName?.text || '',
    phone:       normalizePhone(rawPhone),
    hasWebsite:  !!p.websiteUri,
    rating:      p.rating || 0,
    reviewCount: p.userRatingCount || 0,
    address:     p.formattedAddress || city,
    city, category,
    placeId:     p.id || ''
  };
}

async function getNextArea(preferred) {
  if (preferred) return preferred;
  try {
    const s    = await fbGet('settings') || {};
    const used = s.usedAreas || [];
    const free = ALL_AREAS.filter(a => !used.includes(a));
    if (!free.length) { await fbSet('settings/usedAreas', []); return ALL_AREAS[0]; }
    return free[Math.floor(Math.random() * free.length)];
  } catch { return ALL_AREAS[0]; }
}

async function markAreaUsed(area) {
  try {
    const s = await fbGet('settings') || {};
    const used = s.usedAreas || [];
    if (!used.includes(area)) await fbSet('settings/usedAreas', [...used, area]);
  } catch {}
}

/* ══════════════════════════════════
   runSora — الوظيفة الرئيسية
══════════════════════════════════ */
async function runSora(options = {}) {
  const t0 = Date.now();
  let totalScanned = 0, totalSkipped = 0, failures = 0;

  try {
    if (!(await checkBudget())) return { success: false, reason: 'ميزانية منتهية' };

    const settings   = await fbGet('settings') || DEFAULT_SETTINGS;
    const city       = await getNextArea(options.city);
    const cats       = settings.categories || DEFAULT_SETTINGS.categories;
    const category   = options.category  || cats[Math.floor(Math.random() * cats.length)];
    const target     = Number(options.target     || settings.dailyTarget || 30);
    const minRating  = Number(options.minRating  || settings.minRating   || 3.5); // ← خُفِّف من 4.0
    const minReviews = Number(options.minReviews || settings.minReviews  || 3);   // ← خُفِّف من 5

    await logEvent('info', `سورا: بدأ — ${city} | ${category} | هدف:${target} | تقييم≥${minRating} | مراجعات≥${minReviews}`);
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`سورا ▶ ${city} | ${category} | هدف: ${target}`);
    console.log(`الفلاتر: تقييم≥${minRating} | مراجعات≥${minReviews} | بلا موقع`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    const found   = [];
    const seenIds = new Set();
    const queries = buildQueries(city, category);
    let   qIdx    = 0;

    while (found.length < target && qIdx < queries.length) {
      const query = queries[qIdx++];
      console.log(`\n[${qIdx}/${queries.length}] "${query}"`);

      try {
        const places = await fetchAllPages(query);  // يجلب حتى 60 نتيجة
        totalScanned += places.length;
        console.log(`  Google: ${places.length} نتيجة`);

        for (const place of places) {
          if (found.length >= target) break;

          /* منع التكرار بالـ placeId */
          const pid = place.id || (place.displayName?.text + place.formattedAddress);
          if (pid && seenIds.has(pid)) { totalSkipped++; continue; }
          if (pid) seenIds.add(pid);

          const c = parsePlace(place, city, category);

          /* ─── الفلاتر ─── */
          if (c.hasWebsite)                { totalSkipped++; continue; }       // لديه موقع ← تجاهل
          if (c.rating < minRating)        { totalSkipped++; continue; }       // تقييم منخفض
          if (c.reviewCount < minReviews)  { totalSkipped++; continue; }       // مراجعات قليلة
          if (!c.phone)                    { totalSkipped++; continue; }       // بلا رقم
          if (!isValidSaudiMobile(c.phone)){ totalSkipped++; continue; }       // رقم غير سعودي/جوال
          if (!c.name || c.name.length < 2){ totalSkipped++; continue; }       // اسم مفقود
          /* تكرار داخل الجلسة */
          if (found.some(f => f.phone === c.phone || f.name === c.name)) { totalSkipped++; continue; }
          /* تكرار في Firebase */
          if (await isAlreadySaved(c.phone, c.name)) {
            console.log(`  ↩ مكرر: ${c.name}`);
            totalSkipped++; continue;
          }

          found.push(c);
          console.log(`  ✓ [${found.length}/${target}] ${c.name} | ${c.phone} | ⭐${c.rating} (${c.reviewCount})`);
          await sleep(30);
        }

        failures = 0;
        if (found.length < target && qIdx < queries.length) await sleep(300);

      } catch(e) {
        failures++;
        await logEvent('error', `سورا: خطأ "${query}"`, { error: e.message });
        console.error(`  ✗ خطأ: ${e.message}`);
        if (failures >= MAX_FAILURES) throw e;
        await sleep(2000);
      }
    }

    await markAreaUsed(city);

    /* الحفظ في Firebase */
    let saved = 0;
    const now = new Date().toISOString();
    for (const c of found) {
      try {
        await fbPush('leads', {
          name: c.name, phone: c.phone, city: c.city, category: c.category,
          rating: c.rating, reviewCount: c.reviewCount, address: c.address,
          status: 'new', discoveredAt: now, source: 'Google Maps',
          contacted: false, notes: '', placeId: c.placeId || ''
        });
        saved++;
      } catch(e) { await logEvent('error', `سورا: فشل حفظ ${c.name}`, { error: e.message }); }
    }

    /* إحصاء يومي */
    try {
      const key = `stats/daily/${now.split('T')[0]}`;
      const ex  = await fbGet(key) || {};
      await fbSet(key, {
        ...ex,
        soraFound:   (ex.soraFound   || 0) + saved,
        soraScanned: (ex.soraScanned || 0) + totalScanned,
        soraRuns:    (ex.soraRuns    || 0) + 1,
        lastRun: now
      });
    } catch {}

    const dur = Math.round((Date.now() - t0) / 1000);
    const durStr = dur >= 60 ? `${Math.round(dur/60)} دقيقة` : `${dur} ثانية`;
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`سورا ✓ | محفوظ: ${saved}/${target} | فحص: ${totalScanned} | تخطي: ${totalSkipped} | ${durStr}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    await logEvent('info', `سورا: اكتمل — ${saved}/${target} من ${city} (فحص:${totalScanned} تخطي:${totalSkipped})`);

    return { success: true, found: saved, scanned: totalScanned, skipped: totalSkipped, city, category, duration: dur };

  } catch(err) {
    await logEvent('error', 'سورا: فشل عام', { error: err.message });
    return { success: false, error: err.message };
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

if (require.main === module) {
  const [,, city, category, target] = process.argv;
  runSora({ city, category, target: target ? Number(target) : undefined })
    .then(r => { console.log('\nالنتيجة:', r); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}
module.exports = { runSora };
