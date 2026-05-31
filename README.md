# سورا · ديب · جولد — نظام توليد العملاء الذكي

نظام متكامل يكتشف الشركات السعودية بدون مواقع إلكترونية ويتواصل معها تلقائياً.

---

## خطوات النشر

### 1. تجهيز الملفات

```bash
git clone https://github.com/YOUR-USERNAME/sora-deep-gold
cd sora-deep-gold
cp .env.example .env
# أملأ .env بمفاتيحك
```

### 2. الحصول على مفتاح Firebase Database Secret

1. اذهب إلى [Firebase Console](https://console.firebase.google.com)
2. اختر مشروع `imam-warsh`
3. Project Settings ← Service Accounts ← Database Secrets
4. انقر "Add secret" وانسخ القيمة إلى `FIREBASE_DATABASE_SECRET` في `.env`

### 3. نشر الخادم على Render

1. ادخل [render.com](https://render.com) وأنشئ حساباً
2. New ← Web Service ← اربط مستودع GitHub
3. في إعدادات الخدمة:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** Node
4. في قسم **Environment Variables** أضف كل محتويات `.env`
5. انشر — ستحصل على رابط مثل `https://sora-deep-gold.onrender.com`

### 4. تحديث رابط الخادم في الواجهة

في ملف `index.html`، ابحث عن:
```javascript
const SERVER_URL = ...
```
وعدّل السطر الثاني ليكون:
```javascript
: 'https://sora-deep-gold.onrender.com'  // ← رابطك هنا
```

### 5. نشر الواجهة على GitHub Pages

1. ارفع الكود على GitHub
2. Settings ← Pages ← Source: Deploy from branch `main` ← folder `/root`
3. الموقع سيكون على: `https://YOUR-USERNAME.github.io/sora-deep-gold`

### 6. إضافته على شاشة الآيفون

1. افتح الموقع في Safari
2. زر المشاركة ← "إضافة إلى الشاشة الرئيسية"
3. سيعمل كتطبيق مستقل

---

## المفاتيح المطلوبة

| المفتاح | المصدر |
|---------|--------|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| `RESEND_API_KEY` | [resend.com/api-keys](https://resend.com/api-keys) |
| `FIREBASE_DATABASE_SECRET` | Firebase Console > Project Settings > Service Accounts |
| `DASHBOARD_PIN` | رمز 6 أرقام تختاره أنت |
| `OWNER_EMAIL` | بريدك الإلكتروني |

---

## تفعيل واتساب (لاحقاً)

عند اكتمال تحقق Meta من نشاطك التجاري:

1. اذهب إلى [developers.facebook.com](https://developers.facebook.com)
2. احصل على `WHATSAPP_API_TOKEN` من تطبيقك
3. أضفه في متغيرات بيئة Render
4. فعّل واتساب من قسم **الإعدادات** في لوحة التحكم

النظام سيتحول تلقائياً للإرسال والإشعارات عبر واتساب.

---

## ملاحظة الإيميل

في الخطة المجانية لـ Resend بدون نطاق مخصص، الإرسال للشركات الخارجية محدود.
لإرسال مئات الرسائل يومياً:
1. اشترِ نطاقاً (domain)
2. اربطه في Resend وتحقق منه
3. في `server.js` غيّر `from` إلى: `'اسمك <info@your-domain.com>'`

---

## الوكلاء

| الوكيل | النموذج | المهمة |
|--------|---------|--------|
| سورا | claude-sonnet-4-6 | البحث واكتشاف الشركات بأداة البحث على الويب |
| ديب | claude-haiku-4-5 | كتابة وإرسال رسائل مخصصة |
| جولد | claude-haiku-4-5 | تحليل البيانات وتوليد التقارير |
