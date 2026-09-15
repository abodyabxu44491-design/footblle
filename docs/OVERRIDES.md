# خريطة الاستبدالات (Overrides) — اقرأها قبل أي تعديل

## المشكلة التي كانت موجودة

ثلاثة ملفات تُحمَّل بهذا الترتيب، وكل واحد يعيد كتابة دوال الذي قبله:

```
1. admin.js                ← التعريفات الأصلية
2. all-fixes.js            ← يستبدل 3 دوال
3. league-admin.html       ← يستبدل 13 دالة (سكربت داخلي)
4. timer-hotfix.js         ← FIX 2/3/6 (آخر شيء)
5. clock-sync.js           ← FIX 4 (مزامنة ساعة الخادم)
```

## ⚠️ الفخ الذي وقع فيه هذا الملف نفسه

`admin.js:5734` كان يقول:

```js
// Override الـ save القديمة تماماً
window._lpSave = _lpSaveV2;      // ❌ لا يفعل شيئاً!
```

لكن كل الاستدعاءات داخل `admin.js` هي `await _lpSave(id)` — ربط **محلي**
وقت التحليل، لا يمرّ بـ `window` أبداً. النتيجة: `window._lpSave === _lpSaveV2`
تعطي `true`، ومع ذلك الهدف يصيب النسخة القديمة. **خطأ يبدو مُصلَحاً — وهو أسوأ
من عدم الإصلاح.**

**القاعدة:** ما يُستدعى بـ `window.x()` يُصلَح خارجياً.
ما يُستدعى بـ `x()` **يتطلب تعديل المصدر**. لا استثناء.

لهذا عُولج FIX 1 و FIX 8 داخل `admin.js` مباشرة، لا في `timer-hotfix.js`.

**الخطأ القاتل:** لو كتبت في `admin.js`:

```js
function renderStandings() { ... }
function renderAll() { renderStandings(); }   // ❌ استدعاء مباشر
```

فإن `renderAll` تستدعي **نسخة admin.js دائماً** وتتخطى استبدال `all-fixes.js` تماماً —
لأن الاستدعاء المباشر يُربط بالدالة المحلية وقت التحميل، لا بـ `window` وقت التنفيذ.

هذا سبب تكرار ثلاث ملاحظات: تنبيه جدول الترتيب، بطاقات المجموعات، ونافذة سبب الإيقاف.

## القاعدة الإلزامية

أي دالة في القائمة أدناه **يجب**:

1. أن تُصدَّر: `window.fnName = fnName;`
2. أن تُستدعى دائماً عبر `window.fnName(...)` — **لا** `fnName(...)` مباشرة

## الدوال المُستبدَلة

### يستبدلها `all-fixes.js`
| الدالة | السبب |
|---|---|
| `renderStandings` | إخفاء جدول الترتيب خارج نظام الدوري |
| `renderGroupsAdmin` | حساب نقاط المجموعات + زر توزيع الفرق |
| `_adaptAdminUIToType` | إظهار/إخفاء الأقسام حسب نوع البطولة |

### يستبدلها `league-admin.html` (توحيد TimerCore)
| الدالة | السبب |
|---|---|
| `_lpUpdateTimerDisplay` | عرض الوقت من TimerCore |
| `_calcSecsFromServer` | حساب الثواني من مرجع الخادم |
| `_lpSaveV2` | ضبط `phaseSeconds` قبل الحفظ |
| `openLivePage` | إعادة تشغيل العدّاد عند الفتح |
| `lpStartMatch` / `lpStartSecondHalf` | بدء الأشواط |
| `lpHalfTime` / `lpHalfTimeET` | إنهاء الأشواط |
| `lpStartET1` / `lpStartET2` | الوقت الإضافي |
| `lpPauseMatch` + `_lpDoPauseTC` | الإيقاف/الاستئناف + نافذة السبب |
| `lpOpenAddTime` / `lpConfirmAddTime` / `lpCloseAddTime` | بدل الضائع |

## استثناء آمن

استدعاءات `onclick="fnName(...)"` داخل نصوص HTML **آمنة** —
المتصفح يبحث عن الدالة في `window` وقت الضغط، أي بعد اكتمال كل الاستبدالات.

## عند إضافة دالة جديدة تُستبدَل

```js
// في admin.js
function myFn() { ... }
window.myFn = myFn;          // ← 1. صدّرها

// أي استدعاء داخلي
window.myFn();               // ← 2. عبر window دائماً
```

ثم أضفها لهذا الملف.

## فحص سريع

للتأكد أن لا شيء يتخطى الاستبدالات:

```bash
python3 - <<'EOF'
import re
s = open('admin.js', encoding='utf-8').read()
fns = ['renderStandings','renderGroupsAdmin','_adaptAdminUIToType',
       '_lpSaveV2','_calcSecsFromServer','openLivePage']
for f in fns:
    calls = len(re.findall(r'(?<![\w.$])'+f+r'\s*\(', s))
    defs  = len(re.findall(r'function\s+'+f+r'\s*\(', s))
    n = calls - defs
    print(('✅' if n == 0 else '❌'), f, '— تخطّي:', n)
EOF
```

النتيجة المطلوبة: صفر تخطّي للجميع
(عدا `openLivePage` = 1، وهو نص `onclick` وآمن).
