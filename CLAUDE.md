# TRIPLE AGENTS — دليل المشروع الشامل

> هذا الملف يشرح المشروع بالكامل لـ Claude Code. اقرأه أولاً قبل أي تعديل.

---

## نظرة عامة

**TRIPLE AGENTS** نظام تسويق آلي يبحث عن شركات سعودية ليس لها موقع إلكتروني، ثم يساعد على التواصل معها لعرض خدمات تصميم المواقع (تحت علامة **VOLT STORE**).

النظام يتكوّن من ثلاثة وكلاء (Agents):
- **سورا (Sora):** يبحث في خرائط Google عن شركات بلا موقع إلكتروني ويحفظها.
- **ديب (Deep):** مسؤول عن التواصل (إيميل عبر Gmail).
- **جولد (Gold):** يولّد تقارير يومية عن الأداء.

المالك: مصطفى — مطوّر تحت علامة VOLT STORE.

---

## المعمارية (Architecture)

```
┌─────────────────┐      ┌──────────────────────┐      ┌─────────────────┐
│  الواجهة         │ HTTP │   الخادم (Backend)    │      │   Firebase      │
│  (Frontend)     │─────▶│   Express على Render  │─────▶│  Realtime DB    │
│  GitHub Pages   │ JWT  │   sora-deep-gold      │      │  (imam-warsh)   │
└─────────────────┘      └──────────────────────┘      └─────────────────┘
        │                          │
        │                          ├──▶ Google Places API (بحث الشركات)
        │                          ├──▶ Gmail SMTP (إرسال الإيميلات)
        │                          └──▶ node-cron (جدولة تلقائية)
        │
   index.html + app.js
```

### تدفق العمل (Workflow):
1. المستخدم يفتح الواجهة ويسجّل بـ PIN (رمز من 6 أرقام).
2. الواجهة تطلب من الخادم تشغيل **سورا** لمدينة ونشاط معيّن.
3. سورا يبحث في Google Places، يفلتر الشركات (بلا موقع + رقم يبدأ بـ05 + تقييم جيد)، ويحفظها في Firebase بحالة `new`.
4. الواجهة تعرض الشركات. المستخدم يرسل واتساب يدوياً، أو إيميل تلقائياً عبر الأيجنت.
5. **جولد** يولّد تقارير الأداء.

---

## الاستضافة (Hosting)

| المكوّن | المنصة | الرابط |
|--------|--------|--------|
| الواجهة | GitHub Pages | https://voltstore.github.io/agent-/ |
| الواجهة (بديل) | Netlify | https://delicate-axolotl-42a40a.netlify.app/ |
| الخادم | Render (مدفوع Starter $7/شهر — يعمل 24/7) | https://sora-deep-gold.onrender.com |
| قاعدة البيانات | Firebase Realtime Database | imam-warsh |
| المستودع | GitHub | https://github.com/voltstore/agent- |

- الفرع المحلي: `master` → يُدفع لفرع `main` على GitHub.
- المسار المحلي على جهاز المالك: `C:\Users\TechTroniX\Desktop\sora-deep-gold`
- أمر الرفع المعتاد: `git push` (تم ضبط remote.origin.push تلقائياً لـ master:main)
- Render يعيد النشر تلقائياً عند كل push (Auto-Deploy).

---

## بنية الملفات

```
sora-deep-gold/
├── index.html          # الواجهة (HTML + JavaScript كل شيء في ملف واحد)
├── server.js           # خادم Express + المسارات (API) + JWT + جدولة cron
├── agents/
│   ├── sora.js         # وكيل البحث — Google Places API
│   ├── deep.js         # وكيل التواصل — Gmail SMTP
│   ├── gold.js         # وكيل التقارير
│   └── utils.js        # دوال Firebase + الإشعارات + الإعدادات الافتراضية
├── icon.svg / icon.png # شعار التطبيق
├── .env                # المتغيرات السرية (لا يُرفع لـ GitHub)
├── .gitattributes
└── CLAUDE.md           # هذا الملف
```

> **ملاحظة:** JavaScript مدمج داخل `index.html` مباشرة (لا يوجد app.js منفصل).

---

## متغيرات البيئة (.env)

موجودة محلياً وعلى Render (Environment). **لا تُرفع لـ GitHub أبداً.**

```
ANTHROPIC_API_KEY=...
FIREBASE_DATABASE_URL=https://imam-warsh-default-rtdb.asia-southeast1.firebasedatabase.app
FIREBASE_DATABASE_SECRET=...
FIREBASE_PROJECT_ID=imam-warsh
GOOGLE_SEARCH_API_KEY=...        # مفتاح Google Places API (New)
GMAIL_USER=voltstore301@gmail.com
GMAIL_PASS=...                    # App Password وليس كلمة المرور العادية
DASHBOARD_PIN=356356              # رمز الدخول للواجهة
MONTHLY_BUDGET_SAR=230
OWNER_EMAIL=voltstore301@gmail.com
```

---

## قاعدة البيانات (Firebase Realtime DB)

المشروع: **imam-warsh** (مشترك مع مشاريع أخرى للمالك).
نوع القاعدة: **Realtime Database** (وليست Firestore).

البنية:
```
/leads/{id}        # الشركات المكتشفة
  ├── name         # اسم الشركة
  ├── phone        # رقم الجوال (يجب أن يبدأ بـ 05)
  ├── city         # المدينة/المنطقة
  ├── category     # النشاط التجاري
  ├── rating       # التقييم
  ├── reviewCount  # عدد التقييمات
  ├── address      # العنوان
  ├── email        # الإيميل (نادراً ما يتوفر من Google)
  ├── status       # الحالة: new / sent / reply / client
  ├── discoveredAt # تاريخ الاكتشاف
  ├── source       # المصدر (Google Maps / يدوي)
  └── contacted    # هل تم التواصل

/settings          # إعدادات النظام
  ├── messageTemplate  # قالب الرسالة
  ├── dailyTarget      # الهدف اليومي
  ├── minRating        # أدنى تقييم مقبول
  ├── categories       # قائمة الأنشطة
  ├── schedule         # مواعيد التشغيل الآلي
  ├── days             # أيام التشغيل
  ├── mode             # auto / manual
  └── usedAreas        # المناطق التي بحث فيها سورا (لتجنب التكرار)

/outreach          # سجل التواصل
/reports/{date}    # التقارير اليومية
/stats/daily/{date}# إحصائيات يومية
```

---

## نظام الحالات (Status) — مهم جداً

حالة كل شركة لها 4 قيم. **النظام يقبل القيم بالعربي والإنجليزي معاً** بسبب تاريخ المشروع (كانت تُحفظ بالعربي ثم تحولنا للإنجليزي):

| الحالة | القيمة الإنجليزية | القيمة العربية (قديمة) |
|--------|------------------|----------------------|
| جديد | `new` | جديد |
| مرسل | `sent` | أُرسل |
| ردّ | `reply` | ردّ |
| عميل | `client` | عميل |

**القاعدة:** سورا الآن يحفظ بـ `new` (إنجليزي) لتجنب مشاكل الترميز. لكن قد توجد سجلات قديمة بالعربي أو بترميز مكسور. لذلك دوال الفلترة في `server.js` و `index.html` تستخدم `includes()` لتقبل كل الأشكال:

```javascript
function sNew(s){return !s||s==='new'||(s.includes&&s.includes('جدي'))}
function sSent(s){return s==='sent'||(s.includes&&s.includes('رسل'))}
```

**لا تكسر هذا المنطق.** أي فلترة على الحالة يجب أن تمر عبر هذه الدوال، لا بمقارنة مباشرة `===`.

---

## ⚠️ المشاكل المعروفة (اقرأها بعناية)

### 1. مشكلة الترميز (Encoding) — الأهم
هذه أكبر مشكلة واجهناها. النصوص العربية تتحول لرموز مكسورة مثل `ط¬ط¯ظٹط¯` بدل `جديد`.

**السبب:** حفظ الملفات بترميز **ANSI/Windows-1256** بدل **UTF-8**. يحدث عند:
- الحفظ من Notepad وهو مضبوط على "عربي/ANSI".
- بعض أوامر PowerShell التي تحفظ بترميز افتراضي خاطئ.

**القواعد الصارمة لتجنبها:**
- **دائماً** احفظ كل الملفات بترميز **UTF-8** (بدون BOM يُفضّل).
- لا تستخدم Notepad لتحرير الملفات العربية. استخدم محرراً يحفظ UTF-8 افتراضياً.
- عند التحرير برمجياً، استخدم Node.js مع `'utf8'` صراحةً: `fs.writeFileSync(path, content, 'utf8')`.
- بعد أي تعديل على ملف فيه عربي، تحقق: `node -e "const c=require('fs').readFileSync('FILE','utf8');console.log(c.includes('جديد'))"` — يجب أن يطبع `true`.
- إن وجدت ملفاً مكسوراً، أعد بناءه نظيفاً من جديد بدل محاولة إصلاحه بالاستبدال.

### 2. BOM في index.html
بعض أدوات Windows تضيف BOM (bytes: EF BB BF) في بداية الملف. كان يُحذف بأمر PowerShell. الأفضل الحفظ بـ UTF-8 بدون BOM من البداية.

### 3. CRLF vs LF
Git يحوّل CRLF إلى LF. هذا تحذير عادي وليس خطأ — يمكن تجاهله.

### 4. Google Places لا يعطي إيميلات
معظم الشركات من Google Places **ليس لها إيميل**. لذلك زر الإيميل التلقائي يعمل فقط للشركات التي لديها إيميل مخزّن. التواصل الأساسي عبر واتساب (يدوي).

### 5. تكرار الشركات
سورا يتجنب التكرار بفحص الاسم/الرقم في Firebase. كما يتنقّل بين المناطق (`usedAreas`) لتجنب البحث في نفس المكان مراراً.

---

## مسارات الـ API (في server.js)

كلها (عدا login و health) تتطلب رأس `Authorization: Bearer <token>`.

```
POST   /api/auth/login           # تسجيل الدخول بـ PIN → يرجع JWT
GET    /api/stats                # إحصائيات شاملة
GET    /api/stats/weekly         # إحصائيات آخر 7 أيام
GET    /api/settings             # جلب الإعدادات
PUT    /api/settings             # تحديث الإعدادات
GET    /api/leads                # جلب الشركات (?status= &limit= &offset=)
POST   /api/leads                # إضافة شركة يدوياً
PUT    /api/leads/:id            # تحديث شركة (تغيير الحالة مثلاً)
DELETE /api/leads/:id            # حذف شركة
POST   /api/leads/bulk           # عمليات جماعية (حذف/تغيير حالة)
POST   /api/leads/:id/email      # إرسال إيميل للشركة عبر Gmail
POST   /api/agents/sora/run      # تشغيل سورا (body: city, category, target)
GET    /api/agents/sora/status   # حالة سورا الحالية (running/found/city)
POST   /api/agents/deep/run      # تشغيل ديب
POST   /api/agents/gold/run      # تشغيل جولد
GET    /api/reports              # جلب التقارير
GET    /api/export               # تصدير كل البيانات JSON
POST   /api/import               # استيراد بيانات
GET    /health                   # فحص حالة الخادم (بدون مصادقة)
```

### المصادقة (Auth):
- JWT_SECRET = `sha256(DASHBOARD_PIN + ':' + ANTHROPIC_API_KEY + ':sdg-2025')`
- التوكن صالح 7 أيام.
- حماية من brute-force: 5 محاولات خاطئة → حظر 15 دقيقة.

---

## وكيل سورا (agents/sora.js) — تفاصيل

- يستخدم **Google Places API (New)**: `places.googleapis.com/v1/places:searchText`.
- يبحث بـ 8 صيغ مختلفة لكل مدينة (`مطاعم الرياض`، `أفضل مطاعم الرياض`، إلخ).
- قائمة `ALL_AREAS` فيها ~60+ منطقة سعودية. يتنقّل بينها تلقائياً عبر `usedAreas`.
- **فلاتر القبول:** بلا موقع إلكتروني + تقييم ≥ minRating + تقييمات ≥ minReviews + رقم يبدأ بـ `05` + غير مكرر.
- الـ FieldMask يجب أن يحتوي على `nextPageToken` وإلا تفشل الطلبات.
- يحفظ النتائج بحالة `status:'new'`.
- يتتبع حالة التشغيل في `soraState` على الخادم (running/found/city).

---

## كيف تشغّل النظام محلياً (للاختبار)

```bash
# تثبيت الحزم
npm install

# تشغيل الخادم محلياً
node server.js          # يعمل على المنفذ 3000

# اختبار سورا مباشرة
node -e "require('dotenv').config();const {runSora}=require('./agents/sora');runSora({city:'الرياض',category:'مطاعم',target:3}).then(r=>console.log(JSON.stringify(r)))"
```

---

## أوامر مفيدة للصيانة

```bash
# مسح كل الشركات (بداية نظيفة)
node -e "require('dotenv').config();const {fbSet}=require('./agents/utils');fbSet('leads',{}).then(()=>console.log('done'))"

# عدّ الشركات حسب الحالة
node -e "require('dotenv').config();const {fbGet}=require('./agents/utils');fbGet('leads').then(r=>{const l=Object.values(r||{});console.log('total:',l.length)})"

# تصفير المناطق المستخدمة
node -e "require('dotenv').config();const {fbSet}=require('./agents/utils');fbSet('settings/usedAreas',[]).then(()=>console.log('done'))"
```

---

## أولويات العمل الحالية (Roadmap)

- [x] إصلاح بحث سورا (FieldMask + التنقّل بين المناطق)
- [x] شرط الرقم يبدأ بـ 05
- [x] واجهة عصرية (navy/cyan)
- [x] الإرسال التلقائي للإيميل عبر الأيجنت
- [x] رسم بياني أسبوعي + إحصاءات اليوم
- [x] live counter لسورا + منع التشغيل المزدوج
- [x] تحسينات Emil Design Engineering (animations/easing)
- [x] ضبط git push تلقائياً لـ master:main
- [ ] ضمان توافق الحالات القديمة/الجديدة في كل المسارات
- [ ] (مقترح) ديب يبحث عن إيميل الشركة من موقعها قبل الإرسال
- [ ] (مقترح) إضافة AI داخل التطبيق (Claude API) لاقتراح المدن/الأنشطة

---

## ملاحظات للتعامل مع المالك

- يتواصل بالعربية (لهجة سعودية/خليجية). ردّ بالعربية.
- يفضّل خطوات عملية مباشرة وأوامر جاهزة للنسخ.
- يعمل على Windows + PowerShell. راعِ ذلك في الأوامر (PowerShell حسّاس لعلامات الاقتباس).
- **أهم نقطة:** انتبه لترميز UTF-8 في كل تعديل يمسّ نصاً عربياً — هذه مصدر معظم المشاكل السابقة.

---

## ⚠️⚠️ كيفية نشر التعديلات (Deployment) — اقرأ هذا قبل أي تعديل!

**مشكلة شائعة جداً:** بعد تعديل الملفات، يقول المساعد "تم التعديل" لكن **الموقع لا يتغير**. السبب أن التعديل تمّ على الملفات المحلية فقط، ولم يُرفع إلى GitHub. الموقع يقرأ من GitHub وليس من جهاز المالك.

### القاعدة الذهبية:
**أي تعديل على أي ملف لا يظهر للمستخدم إطلاقاً حتى يُدفع (push) إلى GitHub. التعديل المحلي وحده عديم الفائدة بالنسبة للموقع.**

### سلسلة النشر (كيف يصل التعديل للموقع):

```
1. تعدّل الملف محلياً (index.html / server.js / agents/*)
        ↓
2. git add .              ← تجهيز التغييرات
        ↓
3. git commit -m "وصف"    ← حفظ التغييرات محلياً
        ↓
4. git push               ← رفعها لـ GitHub (master → main تلقائياً)
        ↓
5a. GitHub Pages          → يحدّث الواجهة خلال 1-2 دقيقة تلقائياً
5b. Render (Auto-Deploy)  → يعيد نشر الخادم خلال 2-4 دقيقة تلقائياً
        ↓
6. المستخدم يضغط Ctrl+Shift+R لتجاوز الكاش ويرى التحديث
```

### الأمر الكامل للنشر:

```bash
git add .
git commit -m "وصف التعديل"
git push
```

> **ملاحظة:** تم ضبط `remote.origin.push = refs/heads/master:refs/heads/main` في إعدادات git المحلية، لذا `git push` وحده يكفي.
> إذا فشل لسبب ما، استخدم: `git push origin master:main --force`

### نقاط حرجة يجب التحقق منها بعد كل نشر:

1. **تحقق أن الدفع نجح فعلاً:** بعد `git push`، يجب أن ترى سطراً مثل:
   ```
   abc1234..def5678  master -> main
   ```
   إذا رأيت `Everything up-to-date` فهذا يعني **لم يُرفع شيء** — غالباً لأن الملف لم يتغير فعلاً.

2. **إذا قال git "nothing to commit":** التعديل لم يُحفظ في الملف على القرص.

3. **الخادم على Render لا يتحدّث فوراً:** يحتاج 2-4 دقائق. للتحقق:
   ```bash
   curl https://sora-deep-gold.onrender.com/health
   ```

4. **الواجهة لا تتحدّث رغم نجاح الرفع:** اضغط **Ctrl+Shift+R**.

5. **فرق بين تعديل الواجهة وتعديل الخادم:**
   - `index.html` → **GitHub Pages** (1-2 دقيقة)
   - `server.js` أو `agents/*` → **Render** (2-4 دقائق)

### تنبيه مهم حول الترميز عند النشر:
بعد أي تعديل يمسّ نصاً عربياً وقبل `git push`، تحقق دائماً:
```bash
node -e "const c=require('fs').readFileSync('index.html','utf8');console.log('OK:',c.includes('سورا'))"
```
يجب أن يطبع `OK: true`. إذا طبع `false`، فالملف انكسر ترميزه — **لا ترفعه**.
