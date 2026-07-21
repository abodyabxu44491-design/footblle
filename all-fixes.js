// ═══════════════════════════════════════════════════════════════════
//  all-fixes.js  — إصلاح شامل لجميع المشكلات المُبلَّغ عنها
//
//  أضفه آخر سكريبت في league-admin.html وكذلك league-viewer.html
//
//  ما يصلحه هذا الملف:
//
//  ┌─ إدارة البطولة (Admin) ────────────────────────────────────────
//  │  FIX-1 : مدة الأشواط تُطبَّق فعلياً على البث وتُفصل الشوط
//  │  FIX-2 : الترتيب (Standings) لا يظهر في نظام المجموعات/الإقصاء
//  │  FIX-3 : حساب نقاط كل فريق داخل مجموعته بشكل صحيح
//  │  FIX-4 : الهدافون يظهرون في جميع الأنظمة
//  │  FIX-5 : التأهل يدوي فقط — يُزال التأهل التلقائي من الجمهور
//  └────────────────────────────────────────────────────────────────
//
//  ┌─ صفحة الجمهور (Viewer) ────────────────────────────────────────
//  │  FIX-6 : جدول الترتيب لا يظهر في نظام المجموعات/الإقصاء
//  │  FIX-7 : الهدافون يظهرون في جميع الأنظمة
//  │  FIX-8 : "متأهل" يدوي فقط — لا يُعرض تلقائياً
//  └────────────────────────────────────────────────────────────────
//
// ═══════════════════════════════════════════════════════════════════

(function() {
  'use strict';

  // ─── كشف البيئة ─────────────────────────────────────────────────
  const IS_ADMIN  = !!document.querySelector('.sidebar, #panel-main');
  const IS_VIEWER = !!document.querySelector('.bottom-nav, #tab-groups');

  // ─── أداة انتظار دالة أو متغير ──────────────────────────────────
  function waitFor(check, cb, maxMs = 12000) {
    const start = Date.now();
    const t = setInterval(() => {
      if (check()) { clearInterval(t); cb(); }
      if (Date.now() - start > maxMs) { clearInterval(t); }
    }, 200);
  }

  // ════════════════════════════════════════════════════════════════
  //  FIX-1  مدة الأشواط — الفصل التلقائي عند انتهاء وقت الشوط
  // ════════════════════════════════════════════════════════════════
  // المشكلة: window._lpAutoEndHalf كانت تحتاج half1Duration/half2Duration
  //           مُحمَّلاً من settings.matchSettings ولكن في بعض الحالات
  //           كانت تُستخدم القيمة الافتراضية 45 بدلاً من القيمة المحفوظة.
  // الحل: نربط cfg بـ settings.matchSettings عند كل بدء شوط.
  // ⛔ FIX-1 أُزيل — نُقل منطق التوقيت بالكامل إلى timer-core.js + timer-admin.js
  //    (كان يعيد تعريف _getCfg و lpStartMatch ويتعارض مع نظام التوقيت الموحّد)

  // ════════════════════════════════════════════════════════════════
  //  FIX-2 + FIX-6  إخفاء Standings في نظام المجموعات/الإقصاء
  // ════════════════════════════════════════════════════════════════
  // المشكلة: صفحة "الترتيب" تظهر في جميع الأنظمة بما فيها المجموعات.
  // الحل (Admin): _adaptAdminUIToType تُخفي standings — هذا يعمل بالفعل،
  //               لكن نتأكد أنه يعمل عند كل تحميل.
  // الحل (Viewer): renderAll تستدعي renderStandings() حتى في نظام المجموعات —
  //               نمنع ذلك وكذلك نخفي عرض homeStandings.

  if (IS_ADMIN) {
    waitFor(
      () => typeof window._adaptAdminUIToType === 'function',
      function() {
        const _orig = window._adaptAdminUIToType;
        window._adaptAdminUIToType = function(type) {
          _orig(type);

          // إخفاء صفحة الترتيب الكاملة في القائمة الجانبية والتبويبات
          const standingsSection = document.getElementById('page-standings');
          if (standingsSection) {
            standingsSection.style.display = (type === 'league') ? '' : 'none';
          }

          // إظهار/إخفاء Scorers — يظهر في جميع الأنظمة
          const scorersSection = document.getElementById('page-scorers');
          if (scorersSection) {
            scorersSection.style.display = '';
          }

          // Zones page — فقط للدوري العادي
          const sbZones = document.getElementById('sb-zones');
          if (sbZones) sbZones.style.display = (type === 'league') ? 'flex' : 'none';

          // tiebreakCard — فقط للدوري العادي
          const tiebreakCard = document.getElementById('tiebreakCard');
          if (tiebreakCard) tiebreakCard.style.display = (type === 'league') ? '' : 'none';

          console.log('[FIX-2] ✅ UI مُكيَّف لنوع البطولة:', type);
        };

        // طبّق فوراً إذا كان النوع موجوداً
        const currentType = window.settings?.type || window.league?.type;
        if (currentType) window._adaptAdminUIToType(currentType);
      }
    );
  }

  // ════════════════════════════════════════════════════════════════
  //  FIX-3  حساب نقاط المجموعات في الإدارة (renderGroupsAdmin)
  // ════════════════════════════════════════════════════════════════
  // المشكلة: بطاقة كل مجموعة في الإدارة تُظهر الفرق بدون نقاط.
  // الحل: نُعيد كتابة renderGroupsAdmin لتشمل جدول النقاط.

  if (IS_ADMIN) {
    waitFor(
      () => typeof window.renderGroupsAdmin === 'function' && Array.isArray(window.adminGroups),
      function() {
        // ✅ نحافظ على أي دالة سابقة (محرّك السحب والإفلات في admin.js يلفّها
        // ليزامن بنك الفرق) بدل استبدالها بالكامل — وإلا يتوقف تحديث
        // بنك الفرق/اللوحة تلقائياً كلما تغيّرت المجموعات (نفس فخ OVERRIDES.md).
        const _prevRenderGroupsAdmin = window.renderGroupsAdmin;
        window.renderGroupsAdmin = function() {
          // ✅ شغّل السابقة أولاً (تزامن بنك السحب/الإفلات) — ثم نرسم
          // نحن فوقها أخيراً فتبقى واجهة جدول النقاط هي الظاهرة.
          if (typeof _prevRenderGroupsAdmin === 'function') {
            try { _prevRenderGroupsAdmin(); } catch (e) {}
          }
          const el = document.getElementById('groupsAdminList');
          if (!el) return;

          const adminGroups = window.adminGroups || [];
          const teams       = window.teams       || [];
          const matches     = window.matches     || [];
          const settings    = window.settings    || {};
          const winPts  = settings.winPts  || 3;
          const drawPts = settings.drawPts || 1;

          if (adminGroups.length === 0) {
            el.innerHTML = `
              <div class="empty-state">
                <div class="e-icon">👥</div>
                <div>لا توجد مجموعات بعد</div>
                <div style="font-size:11px;color:var(--muted);margin-top:6px">أضف مجموعة أو استخدم التوزيع التلقائي</div>
              </div>`;
            return;
          }

          el.innerHTML = adminGroups.map(g => {
            const gTeamIds   = g.teamIds || [];
            const groupTeams = gTeamIds.map(id => teams.find(t => t.id === id)).filter(Boolean);
            const qualifyCount = g.qualify || 2;

            // ── حساب النقاط ──
            const statsMap = {};
            gTeamIds.forEach(id => { statsMap[id] = { p:0, w:0, d:0, l:0, gf:0, ga:0, pts:0 }; });
            matches.filter(m => m.status === 'finished').forEach(m => {
              if (!gTeamIds.includes(m.homeId) || !gTeamIds.includes(m.awayId)) return;
              const h = statsMap[m.homeId], a = statsMap[m.awayId];
              if (!h || !a) return;
              h.p++; a.p++;
              h.gf += (m.homeScore||0); h.ga += (m.awayScore||0);
              a.gf += (m.awayScore||0); a.ga += (m.homeScore||0);
              if ((m.homeScore||0) > (m.awayScore||0)) {
                h.w++; h.pts += winPts; a.l++;
              } else if ((m.homeScore||0) < (m.awayScore||0)) {
                a.w++; a.pts += winPts; h.l++;
              } else {
                h.d++; a.d++; h.pts += drawPts; a.pts += drawPts;
              }
            });

            // ترتيب حسب النقاط ثم فارق الأهداف
            const sortedTeams = [...groupTeams].sort((a, b) => {
              const sa = statsMap[a.id] || {}, sb = statsMap[b.id] || {};
              if ((sb.pts||0) !== (sa.pts||0)) return (sb.pts||0) - (sa.pts||0);
              const gdB = (sb.gf||0)-(sb.ga||0), gdA = (sa.gf||0)-(sa.ga||0);
              return gdB - gdA;
            });

            const manualQ = new Set(g.qualifiedTeamIds || []);
            const hasManualQ = manualQ.size > 0;
            // ✅ رجّعنا خطوة الاعتماد المنفصلة: تحديد المتأهلين لا يُظهرهم
            // للجمهور وحده — لازم اعتماد صريح عبر adminPublishQualification.
            const isPublished = g.qualificationPublished === true;

            const logoFn = window.logoHtml || (logo => logo || '⚽');

            return `
              <div class="admin-group-card" style="background:var(--card);border:1px solid var(--border2);border-radius:14px;overflow:hidden;margin-bottom:14px">
                <div class="agc-header" style="padding:12px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;background:linear-gradient(90deg,var(--card2),var(--card))">
                  <div>
                    <div style="font-size:14px;font-weight:900;color:var(--gold)">${g.icon||'👥'} المجموعة ${g.name||''}</div>
                    <div style="font-size:10px;color:var(--muted);margin-top:2px">${groupTeams.length} فريق · المتأهلون: ${hasManualQ ? 'يدوي (' + manualQ.size + ')' : 'أفضل ' + qualifyCount}</div>
                  </div>
                  <div style="display:flex;gap:6px">
                    <button class="icon-btn" onclick="adminEditGroup('${g.id}')" title="تعديل">✏️</button>
                    <button class="icon-btn del" onclick="adminDeleteGroup('${g.id}')">🗑</button>
                  </div>
                </div>

                <!-- جدول الترتيب داخل المجموعة -->
                <div style="padding:0 4px 4px">
                  <div style="display:grid;grid-template-columns:20px 1fr 28px 28px 28px 28px 30px 34px 60px;padding:5px 8px;font-size:9px;font-weight:700;color:var(--muted);border-bottom:1px solid var(--border)">
                    <span>#</span><span>الفريق</span><span style="text-align:center">ل</span><span style="text-align:center">ف</span>
                    <span style="text-align:center">ت</span><span style="text-align:center">خ</span>
                    <span style="text-align:center">±</span><span style="text-align:center;color:var(--gold)">ن</span><span style="text-align:center">تأهيل</span>
                  </div>
                  ${sortedTeams.length === 0
                    ? `<div style="text-align:center;padding:14px;color:var(--muted);font-size:11px">لا توجد فرق — أضف فرقاً للمجموعة</div>`
                    : sortedTeams.map((t, i) => {
                        const s = statsMap[t.id] || {};
                        const gd = (s.gf||0)-(s.ga||0);
                        const isManualQ = manualQ.has(t.id);
                        const isQ = hasManualQ ? isManualQ : i < qualifyCount;
                        const qColor = isQ ? 'var(--green)' : 'var(--muted)';
                        return `
                          <div style="display:grid;grid-template-columns:20px 1fr 28px 28px 28px 28px 30px 34px 60px;padding:7px 8px;border-bottom:1px solid var(--border);border-right:3px solid ${isQ?'var(--green)':'transparent'};background:${isQ?'rgba(39,174,96,.04)':''}">
                            <span style="font-size:10px;font-weight:900;color:${qColor}">${i+1}</span>
                            <span style="display:flex;align-items:center;gap:5px;font-size:11px;font-weight:700">${logoFn(t.logo,16,4)} ${t.name}</span>
                            <span style="text-align:center;font-size:11px">${s.p||0}</span>
                            <span style="text-align:center;font-size:11px;color:var(--green)">${s.w||0}</span>
                            <span style="text-align:center;font-size:11px">${s.d||0}</span>
                            <span style="text-align:center;font-size:11px;color:var(--red)">${s.l||0}</span>
                            <span style="text-align:center;font-size:11px;color:${gd>0?'var(--green)':gd<0?'var(--red)':'#888'}">${gd>0?'+'+gd:gd}</span>
                            <span style="text-align:center;font-size:13px;font-weight:900;color:var(--gold);font-family:Tajawal,sans-serif">${s.pts||0}</span>
                            <span style="text-align:center">
                              <button onclick="adminToggleQualified('${g.id}','${t.id}')"
                                style="font-size:9px;padding:2px 7px;border-radius:5px;border:1px solid ${isManualQ?'var(--green)':'var(--border2)'};background:${isManualQ?'rgba(39,174,96,.15)':'transparent'};color:${isManualQ?'var(--green)':'var(--muted)'};cursor:pointer;white-space:nowrap">
                                ${isManualQ ? '✅ متأهل' : '+ تأهيل'}
                              </button>
                            </span>
                          </div>`;
                      }).join('')
                  }
                </div>

                <!-- ✅ §4: توزيع الفرق بالضغط — نافذة تعرض الفرق غير الموزّعة فقط -->
                <div class="agc-add-team" style="padding:10px 12px;border-top:1px solid var(--border)">
                  <button class="btn btn-gold btn-sm" style="width:100%" onclick="openGroupAssign('${g.id}')">
                    👥 توزيع الفرق على هذه المجموعة
                  </button>
                </div>

                <!-- إعداد عدد المتأهلين -->
                <div style="padding:10px 12px;border-top:1px solid var(--border);display:flex;align-items:center;gap:10px;background:var(--card2)">
                  <span style="font-size:11px;color:var(--muted2);flex:1">عدد المتأهلين من المجموعة</span>
                  <input type="number" class="form-input" style="width:60px;padding:5px;text-align:center;font-size:12px"
                    value="${qualifyCount}" min="1" max="${groupTeams.length||10}"
                    onchange="adminUpdateGroupQualify('${g.id}', this.value)"/>
                  <span style="font-size:10px;color:var(--muted)">فريق</span>
                </div>

                <!-- ✅ حالة النشر + زر الاعتماد الرسمي -->
                <div style="padding:10px 12px;border-top:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:10px;background:${isPublished ? 'rgba(39,174,96,.04)' : 'rgba(243,156,18,.03)'}">
                  <div>
                    <div style="font-size:11px;font-weight:700;color:${isPublished ? 'var(--green)' : 'var(--muted2)'}">
                      ${isPublished ? '🌍 المتأهلون ظاهرون للجمهور' : '🔒 المتأهلون مخفيون عن الجمهور'}
                    </div>
                    <div style="font-size:9px;color:var(--muted);margin-top:2px">
                      ${isPublished ? 'اضغط لإخفائهم مؤقتاً' : 'حدد المتأهلين أولاً ثم اعتمد رسمياً'}
                    </div>
                  </div>
                  <button onclick="adminPublishQualification('${g.id}')"
                    style="font-size:11px;font-weight:800;padding:8px 14px;border-radius:8px;cursor:pointer;white-space:nowrap;
                    border:1px solid ${isPublished ? 'rgba(39,174,96,.4)' : 'rgba(243,156,18,.4)'};
                    background:${isPublished ? 'rgba(39,174,96,.12)' : 'rgba(243,156,18,.1)'};
                    color:${isPublished ? 'var(--green)' : '#D35400'}">
                    ${isPublished ? '🔒 إخفاء' : '✅ اعتماد ونشر'}
                  </button>
                </div>
              </div>`;
          }).join('');
        };

        // أعِد الرندر فوراً
        if (typeof window.renderGroupsAdmin === 'function') window.renderGroupsAdmin();
        console.log('[FIX-3] ✅ renderGroupsAdmin مُحدَّث مع حساب النقاط');
      }
    );
  }

  // ════════════════════════════════════════════════════════════════
  //  FIX-4  الهدافون يظهرون في جميع الأنظمة (Admin)
  // ════════════════════════════════════════════════════════════════
  if (IS_ADMIN) {
    waitFor(
      () => typeof window.renderScorers === 'function',
      function() {
        // تأكد أن sb-item الهدافين دائماً مرئي
        const observer = new MutationObserver(() => {
          const sbScorers = document.querySelector('.sb-item[onclick*="scorers"]');
          if (sbScorers) sbScorers.style.display = 'flex';
          const mnScorers = document.querySelector('.mn-item[onclick*="scorers"]');
          if (mnScorers) mnScorers.style.display  = '';
        });
        observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['style'] });

        // أبعِد الهدافين عن إخفاء _adaptAdminUIToType
        const _origAdapt = window._adaptAdminUIToType;
        if (typeof _origAdapt === 'function') {
          const _p = window._adaptAdminUIToType;
          window._adaptAdminUIToType = function(type) {
            _p(type);
            // أعد إظهار الهدافين دائماً
            const sbScorers = document.querySelector('.sb-item[onclick*="scorers"]');
            if (sbScorers) sbScorers.style.display = 'flex';
            const mnScorers = document.querySelector('.mn-item[onclick*="scorers"]');
            if (mnScorers) mnScorers.style.display  = '';
          };
        }
        console.log('[FIX-4] ✅ الهدافون ظاهرون في جميع الأنظمة');
      }
    );
  }

  // ════════════════════════════════════════════════════════════════
  //  FIX-5 + FIX-8  التأهل يدوي فقط — لا "متأهل" تلقائي للجمهور
  // ════════════════════════════════════════════════════════════════
  // في صفحة الجمهور: computeGroupStats / renderGroupsStandings
  // كانت تُظهر "✅ متأهل" على أول N فريق تلقائياً بدون قرار من الإدارة.
  // الآن: إذا hasManualQ = false → لا نعرض شارة "متأهل" ولا "خرج"

  if (IS_VIEWER) {
    waitFor(
      () => typeof window.renderGroupsStandings === 'function',
      function() {
        const _orig = window.renderGroupsStandings;
        window.renderGroupsStandings = function() {
          const el = document.getElementById('groupsContent');
          if (!el) return;
          const groups   = window.groups   || [];
          const teams    = window.teams    || [];
          const matches  = window.matches  || [];
          const settings = window.settings || {};

          if (!groups.length) {
            el.innerHTML = '<div class="empty-state"><span class="empty-icon">👥</span><div>لا توجد مجموعات</div></div>';
            return;
          }

          el.innerHTML = groups.map(g => {
            const gTeamIds = g.teamIds || [];
            const gTeams   = gTeamIds.map(id => teams.find(t => t.id === id)).filter(Boolean);

            // حساب الإحصائيات
            const gs = {};
            gTeamIds.forEach(id => { gs[id] = { pts:0, p:0, w:0, d:0, l:0, gf:0, ga:0 }; });
            matches.filter(m => m.status === 'finished').forEach(m => {
              if (!gTeamIds.includes(m.homeId) || !gTeamIds.includes(m.awayId)) return;
              const h = gs[m.homeId], a = gs[m.awayId];
              if (!h || !a) return;
              h.p++; a.p++;
              h.gf += (m.homeScore||0); h.ga += (m.awayScore||0);
              a.gf += (m.awayScore||0); a.ga += (m.homeScore||0);
              if ((m.homeScore||0) > (m.awayScore||0)) {
                h.w++; h.pts += settings.winPts||3; a.l++;
              } else if ((m.homeScore||0) < (m.awayScore||0)) {
                a.w++; a.pts += settings.winPts||3; h.l++;
              } else {
                h.d++; a.d++; h.pts += settings.drawPts||1; a.pts += settings.drawPts||1;
              }
            });

            // ترتيب
            const sorted = [...gTeams].sort((a, b) => {
              const sa = gs[a.id]||{}, sb = gs[b.id]||{};
              if ((sb.pts||0) !== (sa.pts||0)) return (sb.pts||0)-(sa.pts||0);
              return ((sb.gf||0)-(sb.ga||0)) - ((sa.gf||0)-(sa.ga||0));
            });

            // ── تأهل يدوي + اعتماد رسمي ──
            const manualQ    = new Set(g.qualifiedTeamIds || []);
            // ✅ رجّعنا شرط الاعتماد: تحديد المتأهلين وحده لا يكفي لإظهارهم
            // للجمهور — لازم qualificationPublished === true (زر اعتماد ونشر).
            const isPublished = g.qualificationPublished === true;
            const hasManualQ  = isPublished && manualQ.size > 0;
            // لا نُعرض تأهلاً تلقائياً أبداً

            const logoFn = window.logoHtml || (logo => logo || '⚽');

            // مباريات المجموعة
            const groupMatches = matches.filter(m =>
              gTeams.some(t => t.id === m.homeId) && gTeams.some(t => t.id === m.awayId)
            );
            const gmHtml = groupMatches.length ? `
              <div class="group-matches-toggle" onclick="toggleGroupMatches(this,'${g.id}')">
                <span>⚽ مباريات المجموعة (${groupMatches.length})</span><span class="gmt-arrow">▼</span>
              </div>
              <div class="group-matches-list" id="gml-${g.id}" style="display:none">
                ${groupMatches.map(m => {
                  const ht = teams.find(t=>t.id===m.homeId)||{name:m.homeName||'?',logo:''};
                  const at = teams.find(t=>t.id===m.awayId)||{name:m.awayName||'?',logo:''};
                  const fin = m.status==='finished', live = m.status==='live';
                  return `<div class="gm-row${live?' gm-live':''}" onclick="openMatchDetail('${m.id}')">
                    <div class="gm-team gm-home">${logoFn(ht.logo,16,4)} <span>${ht.name}</span></div>
                    <div class="gm-score${fin||live?' gm-score-fin':''}">${fin||live?`${m.homeScore??0} - ${m.awayScore??0}`:m.date||'—'}</div>
                    <div class="gm-team gm-away"><span>${at.name}</span> ${logoFn(at.logo,16,4)}</div>
                    ${live?'<div class="gm-live-badge">🔴</div>':''}
                  </div>`;
                }).join('')}
              </div>` : '';

            return `<div class="group-card">
              <div class="group-header">
                <div class="group-title">${g.icon||'👥'} المجموعة ${g.name||''}</div>
                <div class="group-sub">${hasManualQ ? `✅ ${manualQ.size} متأهل` : `${gTeams.length} فريق`}</div>
              </div>
              <div class="gt-header">
                <div>#</div><div>الفريق</div>
                <div>ل</div><div>ف</div><div>ت</div><div>خ</div><div>±</div><div>ن</div>
              </div>
              ${sorted.map((t, i) => {
                const s = gs[t.id]||{};
                const gd = (s.gf||0)-(s.ga||0);
                // ── FIX-8: تأهل يدوي فقط ──
                const isQ    = hasManualQ && manualQ.has(t.id);
                const isElim = hasManualQ && !manualQ.has(t.id);
                return `<div class="gt-row${isQ?' gt-row-qualified':''}${isElim?' gt-row-eliminated':''}">
                  <div class="gt-pos" style="color:${isQ?'var(--green)':isElim?'var(--red)':'var(--t3)'}">${i+1}</div>
                  <div class="gt-team">
                    <span>${logoFn(t.logo,18,4)}</span>
                    <span class="gt-name">${t.name}</span>
                    ${isQ   ? '<span class="qualify-badge">✅ متأهل</span>' : ''}
                    ${isElim? '<span class="elim-badge">❌ خرج</span>' : ''}
                  </div>
                  <div class="gt-val">${s.p||0}</div>
                  <div class="gt-val" style="color:var(--green)">${s.w||0}</div>
                  <div class="gt-val">${s.d||0}</div>
                  <div class="gt-val" style="color:var(--red)">${s.l||0}</div>
                  <div class="gt-val" style="color:${gd>0?'var(--green)':gd<0?'var(--red)':'#666'}">${gd>0?'+'+gd:gd}</div>
                  <div class="gt-pts" style="color:${isQ?'var(--green)':'var(--gold)'}">${s.pts||0}</div>
                </div>`;
              }).join('')}
              ${gmHtml}
            </div>`;
          }).join('');
        };

        console.log('[FIX-5/8] ✅ التأهل يدوي فقط في صفحة الجمهور');
      }
    );
  }

  // ════════════════════════════════════════════════════════════════
  //  FIX-6  إخفاء Standings في نظام المجموعات/الإقصاء (Viewer)
  // ════════════════════════════════════════════════════════════════
  if (IS_VIEWER) {
    waitFor(
      () => typeof window.renderAll === 'function',
      function() {

        function _hideStandingsElements() {
          const type = window.tournamentType || window.settings?.type || 'league';
          if (type === 'league') return; // لا تخفي في الدوري العادي

          // إخفاء tab-standings الكامل
          const tabStandings = document.getElementById('tab-standings');
          if (tabStandings) tabStandings.style.display = 'none';

          // إخفاء قسم "الترتيب المصغر" في الرئيسية
          // (يشمل home-sub-header + homeStandings)
          const homeStandings = document.getElementById('homeStandings');
          if (homeStandings) {
            homeStandings.style.display = 'none';
            // إخفاء الـ header المصاحب (السابق المباشر)
            let prev = homeStandings.previousElementSibling;
            while (prev) {
              if (prev.classList && prev.classList.contains('home-sub-header')) {
                // تحقق أنه header الترتيب تحديداً
                if (prev.textContent.includes('الترتيب')) {
                  prev.style.display = 'none';
                }
                break;
              }
              prev = prev.previousElementSibling;
            }
          }

          // إخفاء زر "عرض الكل" الخاص بالترتيب
          document.querySelectorAll('[onclick*="standings"]').forEach(el => {
            if (el.classList.contains('home-sub-btn')) el.style.display = 'none';
          });
        }

        // Override renderAll
        const _origRenderAll = window.renderAll;
        window.renderAll = function() {
          _origRenderAll();
          _hideStandingsElements();
        };

        // Override renderStandings في نظام المجموعات/الإقصاء لمنع الكتابة
        const _origRenderStandings = window.renderStandings;
        if (typeof _origRenderStandings === 'function') {
          window.renderStandings = function() {
            const type = window.tournamentType || window.settings?.type || 'league';
            if (type !== 'league') {
              _hideStandingsElements();
              return; // لا تكتب جدول الترتيب
            }
            return _origRenderStandings();
          };
        }

        // طبّق فوراً
        setTimeout(_hideStandingsElements, 300);
        setTimeout(_hideStandingsElements, 1000);
        console.log('[FIX-6] ✅ إخفاء Standings في المجموعات/الإقصاء');
      }
    );
  }

  // ════════════════════════════════════════════════════════════════
  //  FIX-7  الهدافون في الجمهور — يظهرون في جميع الأنظمة
  // ════════════════════════════════════════════════════════════════
  if (IS_VIEWER) {
    waitFor(
      () => typeof window.setupNavTabs === 'function' || typeof window.buildNavTabs === 'function',
      function() {
        // الهدافون موجودون بالفعل في جميع أنواع التنقل
        // ⛔ أُزيل — نُقل إلى scorers-core.js (مفتاح الهوية بدل الاسم)
        console.log('[FIX-7] ✅ الهدافون في جميع الأنظمة');
      }
    );
  }

  // ════════════════════════════════════════════════════════════════
  //  FIX-DASHBOARD-GROUPS  لوحة التحكم في المجموعات — لا ترتيب
  // ════════════════════════════════════════════════════════════════
  // في dashStandings (الرئيسية) — إذا نظام مجموعات → عرض ملخص المجموعات
  if (IS_ADMIN) {
    waitFor(
      () => typeof window.renderGroupsAdmin === 'function',
      function() {
        // Override renderStandings لتُخفي نفسها في نظام المجموعات/الإقصاء
        const _origRenderStandings = window.renderStandings;
        if (typeof _origRenderStandings === 'function') {
          window.renderStandings = function() {
            const type = window.settings?.type || 'league';
            if (type === 'groups' || type === 'knockout') {
              // ✅ القسم محذوف خارج نظام الدوري — لا تنبيه ولا ملخص مكانه
              const d1 = document.getElementById('dashStandings');
              if (d1) d1.innerHTML = '';
              const d2 = document.getElementById('fullStandings');
              if (d2) d2.innerHTML = '';
              const card = document.getElementById('dashStandingsCard');
              if (card) card.style.display = 'none';
              return; // لا ترندر جدول الترتيب
            }
            const card = document.getElementById('dashStandingsCard');
            if (card) card.style.display = '';
            return _origRenderStandings();
          };
        }
        console.log('[FIX-DASH] ✅ لوحة التحكم مُكيَّفة للمجموعات');
      }
    );
  }

  // ════════════════════════════════════════════════════════════════
  //  FIX-SCORERS-ADMIN  الهدافون في جميع الأنظمة (Admin sidebar)
  // ════════════════════════════════════════════════════════════════
  if (IS_ADMIN) {
    // انتظر تحميل الصفحة الكاملة ثم أصلح sidebar
    window.addEventListener('load', function() {
      setTimeout(function() {
        // الهدافون دائماً ظاهرون في sidebar
        const sbItems = document.querySelectorAll('.sb-item');
        sbItems.forEach(item => {
          if (item.getAttribute('onclick') && item.getAttribute('onclick').includes('scorers')) {
            item.style.display = 'flex';
          }
        });
      }, 1000);
    });
  }

  console.log('[all-fixes.js] ✅ تم تحميل الإصلاحات الشاملة');

})();
