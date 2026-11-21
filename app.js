/* ==========================================================
   OROMO VIP — منطق التطبيق
   يعمل بالكامل داخل المتصفح (localStorage) بدون أي ربط خارجي.
   ========================================================== */
(() => {
  'use strict';

  /* ===================== الإعدادات ===================== */
  const CONFIG = {
    STAFF_PIN: '1234',
    WHATSAPP: '201022622210',
    // ⚠️ استبدل هذا الرابط برابط صفحة التقييم الكاملة للكافيه على خرائط جوجل
    REVIEW_URL: 'https://goo.gl',
    STAMPS_TARGET: 5,
    DB_KEY: 'oromo_vip_db_v1',
    ME_KEY: 'oromo_vip_me',
    POLL_MS: 1500
  };

  /* ===================== أدوات مساعدة ===================== */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  const toWestern = (s) => String(s || '')
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0));

  const digitsOnly = (s) => toWestern(s).replace(/\D/g, '');

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  const fmtDate = (ts) => (ts
    ? new Date(ts).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' })
    : '—');

  let toastTimer = null;
  function toast(msg, ms = 2600) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  /* ===================== قاعدة البيانات المحلية ===================== */
  const DB = {
    load() {
      try {
        const raw = localStorage.getItem(CONFIG.DB_KEY);
        if (raw) {
          const d = JSON.parse(raw);
          return {
            seq: Number(d.seq) || 1000,
            customers: d.customers || {},
            ratings: Array.isArray(d.ratings) ? d.ratings : []
          };
        }
      } catch (e) {
        /* بيانات تالفة: نبدأ من جديد بدل ما نتوقف */
      }
      return { seq: 1000, customers: {}, ratings: [] };
    },
    save(db) {
      try {
        localStorage.setItem(CONFIG.DB_KEY, JSON.stringify(db));
        return true;
      } catch (e) {
        toast('تعذّر حفظ البيانات على هذا الجهاز، تأكد من المساحة المتاحة');
        return false;
      }
    }
  };

  const Me = {
    get() { return localStorage.getItem(CONFIG.ME_KEY) || ''; },
    set(phone) { localStorage.setItem(CONFIG.ME_KEY, phone); }
  };

  /* ===================== الصوت (تنبيه هادئ) ===================== */
  let audioCtx = null;

  function unlockAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
  }

  function playChime() {
    const ctx = audioCtx || unlockAudio();
    if (!ctx) return;
    // نغمة مؤلفة من ثلاث نوتات متتابعة بنعومة
    const notes = [987.77, 1318.51, 1567.98];
    notes.forEach((freq, i) => {
      const t = ctx.currentTime + i * 0.22;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.22, t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 1.2);
    });
  }

  /* ===================== التنقل بين الواجهات ===================== */
  let staffAuthed = false;
  let pin = '';
  let selectedPhone = null;

  function setView(name) {
    $('#customerView').classList.toggle('hidden', name !== 'customer');
    $('#staffView').classList.toggle('hidden', name !== 'staff');
    $('#staffLock').classList.toggle('hidden', name !== 'customer');
    window.scrollTo(0, 0);
  }

  function openStaff() {
    setView('staff');
    if (staffAuthed) {
      $('#pinBox').classList.add('hidden');
      $('#staffPanel').classList.remove('hidden');
      refreshStaff();
    } else {
      $('#pinBox').classList.remove('hidden');
      $('#staffPanel').classList.add('hidden');
      $('#pinError').classList.add('hidden');
    }
  }

  /* ===================== واجهة العميل ===================== */
  let renderedId = null;
  let lastPagerState = null;
  let lastSignature = null;

  function renderCustomer() {
    const db = DB.load();
    const c = db.customers[Me.get()];

    $('#registerBox').classList.toggle('hidden', !!c);
    $('#cardBox').classList.toggle('hidden', !c);

    if (!c) {
      renderedId = null;
      lastPagerState = null;
      lastSignature = null;
      return;
    }

    if (renderedId !== c.id) {
      renderCard(c);
      renderedId = c.id;
      lastPagerState = c.pager;
      lastSignature = null;
    }
    refreshCustomer(c);
  }

  function renderCard(c) {
    $('#cardName').textContent = c.name;
    $('#cardId').textContent = '#' + c.id;
    $('#qrCode').innerHTML = makeQR(c.id);
  }

  function makeQR(text) {
    try {
      if (typeof qrcode === 'undefined') return '';
      const qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      return qr.createSvgTag(3, 0);
    } catch (e) {
      return '';
    }
  }

  function refreshCustomer(c) {
    const target = CONFIG.STAMPS_TARGET;
    const signature = `${c.stamps}|${c.pager}`;

    if (signature !== lastSignature) {
      $('#stamps').innerHTML = Array.from({ length: target }, (_, i) =>
        `<span class="stamp ${i < c.stamps ? 'on' : ''}">${i < c.stamps ? '☕' : ''}</span>`
      ).join('');

      $('#cardFoot').textContent = c.stamps >= target
        ? '🎁 هديتك جاهزة، اطلبها من الكاشير'
        : `باقي ${target - c.stamps} ختم للهدية المجانية`;

      const ready = c.pager === 'ready';
      $('#pagerBox').classList.toggle('is-ready', ready);
      $('#pagerText').textContent = ready
        ? 'طلبك جاهز! تفضل استلمه من الكاشير ☕'
        : c.pager === 'preparing'
          ? 'طلبك قيد التحضير… لحظات ونبلغك'
          : 'لا يوجد طلب قيد التحضير حالياً';

      lastSignature = signature;
    }

    // تنبيه البيجر عند تحوّل الحالة إلى "جاهز" فقط
    if (c.pager !== lastPagerState) {
      if (c.pager === 'ready') triggerPagerAlert();
      lastPagerState = c.pager;
    }
  }

  function triggerPagerAlert() {
    const box = $('#pagerBox');
    box.classList.add('alert');
    setTimeout(() => box.classList.remove('alert'), 9000);

    if (navigator.vibrate) {
      navigator.vibrate([350, 180, 350, 180, 600]);
      let n = 0;
      const id = setInterval(() => {
        navigator.vibrate([400, 200, 400]);
        if (++n >= 4) clearInterval(id);
      }, 2400);
    }
    playChime();
    toast('طلبك جاهز ☕ تفضل استلمه من الكاشير', 4500);
  }

  /* ===================== تفعيل التنبيهات ===================== */
  function bindAlerts() {
    $('#enableAlertsBtn').addEventListener('click', () => {
      unlockAudio();
      if (navigator.vibrate) navigator.vibrate(120);
      playChime();
      toast('تم تفعيل التنبيهات الصامتة 🔔');
    });
    // فتح قفل الصوت عند أول لمسة على الشاشة (سياسة المتصفحات)
    document.addEventListener('pointerdown', unlockAudio, { once: true });
  }

  /* ===================== تأثير 3D وانعكاس الضوء ===================== */
  function initTilt() {
    const scene = $('#cardScene');
    const card = $('#vipCard');
    let gyroActive = false;
    let gyroListening = false;

    const setTilt = (rx, ry) => {
      card.style.transform = `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
    };
    const setLight = (px, py) => {
      card.style.setProperty('--mx', `${px.toFixed(1)}%`);
      card.style.setProperty('--my', `${py.toFixed(1)}%`);
    };

    scene.addEventListener('pointermove', (e) => {
      if (gyroActive || e.pointerType !== 'mouse') return;
      const r = scene.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      setTilt((0.5 - py) * 18, (px - 0.5) * 22);
      setLight(px * 100, py * 100);
    });

    scene.addEventListener('pointerleave', () => {
      if (gyroActive) return;
      setTilt(0, 0);
      setLight(50, 40);
    });

    const onOrientation = (e) => {
      if (e.beta == null || e.gamma == null) return;
      gyroActive = true;
      const rx = clamp((e.beta - 45) * 0.3, -14, 14);
      const ry = clamp(e.gamma * 0.4, -18, 18);
      setTilt(-rx, ry);
      setLight(50 + ry * 2.2, 50 + rx * 2.5);
    };

    const enableGyro = async () => {
      if (gyroListening || !('DeviceOrientationEvent' in window)) return;
      try {
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
          const res = await DeviceOrientationEvent.requestPermission();
          if (res !== 'granted') return;
        }
        window.addEventListener('deviceorientation', onOrientation);
        gyroListening = true;
      } catch (_) { /* الجهاز لا يدعم الحركة */ }
    };

    scene.addEventListener('click', enableGyro);
  }

  /* ===================== التسجيل ===================== */
  function showRegError(msg) {
    const el = $('#regError');
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  function bindRegister() {
    $('#registerForm').addEventListener('submit', (e) => {
      e.preventDefault();
      $('#regError').classList.add('hidden');

      const name = $('#regName').value.trim().replace(/\s+/g, ' ');
      const phone = digitsOnly($('#regPhone').value);

      if (name.length < 2) return showRegError('من فضلك اكتب اسمك بالكامل');
      if (!/^01[0-25]\d{8}$/.test(phone)) return showRegError('رقم الموبايل غير صحيح (مثال: 01XXXXXXXXX)');

      const db = DB.load();
      if (!db.customers[phone]) {
        db.seq += 1;
        db.customers[phone] = {
          id: 'ORM-' + String(db.seq).padStart(4, '0'),
          name,
          phone,
          stamps: 0,
          gifts: 0,
          pager: 'idle',
          createdAt: Date.now(),
          lastVisit: null
        };
        if (!DB.save(db)) return;
      }

      Me.set(phone);
      renderCustomer();
      toast('أهلاً بك في نادي أورومو VIP 👑');
    });
  }

  /* ===================== WhatsApp ===================== */
  function customerContext() {
    const c = DB.load().customers[Me.get()];
    return c
      ? [`الاسم: ${c.name}`, `رقم العضوية: ${c.id}`, `الموبايل: ${c.phone}`]
      : ['زائر (غير مسجّل)'];
  }

  function openWhatsApp(lines) {
    const text = encodeURIComponent(lines.filter(Boolean).join('\n'));
    window.open(`https://wa.me/${CONFIG.WHATSAPP}?text=${text}`, '_blank', 'noopener');
  }

  function tableLine() {
    const t = $('#tableNo').value.trim();
    return t ? `رقم الترابيزة: ${t}` : '';
  }

  function requestOrder(item) {
    openWhatsApp([
      '👑 *نادي أورومو VIP*',
      '🛎️ *طلب إضافة*',
      ...customerContext(),
      tableLine(),
      `الطلب: ${item}`
    ]);
  }

  function callWaiter(req) {
    openWhatsApp([
      '👑 *نادي أورومو VIP*',
      '🔔 *خدمة الطاولة*',
      ...customerContext(),
      tableLine(),
      `الطلب: ${req}`
    ]);
  }

  function bindConcierge() {
    $$('[data-order]').forEach((btn) => {
      btn.addEventListener('click', () => requestOrder(btn.dataset.order));
    });
    $$('[data-req]').forEach((btn) => {
      btn.addEventListener('click', () => callWaiter(btn.dataset.req));
    });
  }

  /* ===================== التقييم الذكي ===================== */
  function buildStars() {
    $('#stars').innerHTML = [1, 2, 3, 4, 5]
      .map((n) => `<button type="button" data-star="${n}" aria-label="${n} نجوم">★</button>`)
      .join('');
  }

  function submitRating(n) {
    const db = DB.load();
    const c = db.customers[Me.get()];
    db.ratings.push({ stars: n, at: Date.now(), member: c ? c.id : 'guest' });
    DB.save(db);

    const out = $('#ratingResult');
    out.classList.remove('hidden');

    if (n >= 4) {
      out.innerHTML = `
        <p class="thanks">يسعدنا رضاك الملكي 🤍<br>شاركنا رأيك على خرائط جوجل ليصل صوتك لكل محبي أورومو</p>
        <a class="btn gold small" href="${esc(CONFIG.REVIEW_URL)}" target="_blank" rel="noopener">قيّمنا على خرائط جوجل</a>`;
    } else {
      out.innerHTML = `
        <p class="thanks">نأسف لأن تجربتك لم تكن كما تستحق.<br>مدير الكافيه في خدمتك الآن لحل الأمر فوراً.</p>
        <button type="button" class="btn ghost small" id="contactMgr">تواصل مع الإدارة الآن</button>`;
      $('#contactMgr').addEventListener('click', () => openComplaint(n));
      openComplaint(n);
    }
  }

  function openComplaint(n) {
    openWhatsApp([
      '👑 *نادي أورومو VIP*',
      `⭐ *التقييم:* ${n} من 5`,
      ...customerContext(),
      tableLine(),
      'تجربة تحتاج متابعة فورية'
    ]);
  }

  function bindRating() {
    $('#stars').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-star]');
      if (!btn) return;
      const n = Number(btn.dataset.star);
      $$('#stars button').forEach((b) => {
        b.classList.toggle('on', Number(b.dataset.star) <= n);
      });
      submitRating(n);
    });
  }

  /* ===================== تثبيت التطبيق (PWA) ===================== */
  let deferredPrompt = null;

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

  function bindInstall() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      $('#installBtn').classList.remove('hidden');
    });

    $('#installBtn').addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        try { await deferredPrompt.userChoice; } catch (_) {}
        deferredPrompt = null;
        $('#installBtn').classList.add('hidden');
        return;
      }
      if (isIOS) {
        $('#iosHint').classList.toggle('hidden');
      } else {
        toast('من قائمة المتصفح اختر «إضافة إلى الشاشة الرئيسية»', 3800);
      }
    });

    if (isStandalone()) {
      $('#installBtn').classList.add('hidden');
    } else if (isIOS) {
      $('#installBtn').classList.remove('hidden');
    }

    window.addEventListener('appinstalled', () => {
      $('#installBtn').classList.add('hidden');
      toast('تمت إضافة الكارت إلى شاشتك الرئيسية 👑');
    });
  }

  /* ===================== لوحة الإدارة ===================== */
  function buildPinPad() {
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
    $('#pinPad').innerHTML = keys
      .map((k) => (k === ''
        ? '<span></span>'
        : `<button type="button" class="pin-key" data-key="${k}">${k}</button>`))
      .join('');
  }

  function renderPinDots() {
    $$('#pinDots span').forEach((s, i) => s.classList.toggle('on', i < pin.length));
  }

  function pressKey(k) {
    if (k === '⌫') {
      pin = pin.slice(0, -1);
    } else if (/^\d$/.test(k) && pin.length < 4) {
      pin += k;
    }
    renderPinDots();

    if (pin.length === 4) {
      if (pin === CONFIG.STAFF_PIN) {
        staffAuthed = true;
        pin = '';
        renderPinDots();
        $('#pinBox').classList.add('hidden');
        $('#staffPanel').classList.remove('hidden');
        refreshStaff();
      } else {
        pin = '';
        renderPinDots();
        $('#pinError').classList.remove('hidden');
        const box = $('#pinBox');
        box.classList.remove('shake');
        void box.offsetWidth;
        box.classList.add('shake');
        setTimeout(() => box.classList.remove('shake'), 500);
      }
    }
  }

  function findCustomer(query) {
    const db = DB.load();
    const raw = toWestern(query).trim();
    if (!raw) return null;

    const idMatch = raw.toUpperCase().match(/ORM-?\s*(\d{4})/);
    if (idMatch) {
      return Object.values(db.customers).find((c) => c.id === 'ORM-' + idMatch[1]) || null;
    }

    const digits = digitsOnly(raw);
    if (digits.length >= 8) {
      return db.customers[digits] || null;
    }
    if (/^\d{4}$/.test(digits)) {
      return Object.values(db.customers).find((c) => c.id === 'ORM-' + digits) || null;
    }
    return null;
  }

  function runSearch() {
    const q = $('#staffSearch').value;
    const found = findCustomer(q);
    selectedPhone = found ? found.phone : null;

    if (!found) {
      $('#searchResult').innerHTML = q.trim()
        ? '<p class="muted">لا يوجد عميل بهذا الرقم أو رقم العضوية</p>'
        : '';
      return;
    }
    renderResult();
  }

  function renderResult() {
    const box = $('#searchResult');
    const db = DB.load();
    const c = db.customers[selectedPhone];
    if (!c) {
      box.innerHTML = '';
      return;
    }

    const target = CONFIG.STAMPS_TARGET;
    const dots = Array.from({ length: target }, (_, i) =>
      `<span class="stamp ${i < c.stamps ? 'on' : ''}">${i < c.stamps ? '☕' : ''}</span>`
    ).join('');

    const pagerLabel = c.pager === 'ready'
      ? 'جاهز للاستلام ☕'
      : c.pager === 'preparing' ? 'قيد التحضير' : 'لا يوجد طلب';

    box.innerHTML = `
      <div class="result-card">
        <div class="result-head">
          <div>
            <div class="res-name">${esc(c.name)}</div>
            <div class="muted small" dir="ltr">${esc(c.id)} · ${esc(c.phone)}</div>
          </div>
          <span class="badge ${c.pager === 'ready' ? 'ready' : 'prep'}">${pagerLabel}</span>
        </div>
        <div class="stamps staff-stamps">${dots}</div>
        <p class="muted small">الهدايا المسلّمة: ${c.gifts || 0} · آخر زيارة: ${fmtDate(c.lastVisit)}</p>
        <div class="result-actions">
          <button class="btn gold small" type="button" data-act="stamp" ${c.stamps >= target ? 'disabled' : ''}>
            ${c.stamps >= target ? 'الهدية جاهزة 🎁' : '+ إضافة ختم'}
          </button>
          <button class="btn ghost small" type="button" data-act="gift" ${c.stamps < target ? 'disabled' : ''}>
            تصفير الهدية 🎁
          </button>
        </div>
        <div class="result-actions">
          <button class="btn ghost small" type="button" data-act="prep">قيد التحضير ⏳</button>
          <button class="btn gold small" type="button" data-act="ready">جاهز للاستلام ☕</button>
          <button class="btn ghost small" type="button" data-act="done">إنهاء الطلب</button>
        </div>
      </div>`;
  }

  function bindStaffActions() {
    $('#searchResult').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn || !selectedPhone) return;

      const db = DB.load();
      const c = db.customers[selectedPhone];
      if (!c) return;
      const target = CONFIG.STAMPS_TARGET;

      switch (btn.dataset.act) {
        case 'stamp':
          if (c.stamps >= target) { toast('الهدية جاهزة، صفّرها أولاً'); return; }
          c.stamps += 1;
          c.lastVisit = Date.now();
          toast(`تمت إضافة ختم لـ ${c.name} ☕`);
          break;
        case 'gift':
          if (c.stamps < target) { toast('الكارت لم يكتمل بعد'); return; }
          c.stamps = 0;
          c.gifts = (c.gifts || 0) + 1;
          toast('تم تسليم الهدية وتصفير الأختام 🎁');
          break;
        case 'prep':
          c.pager = 'preparing';
          toast('تم تحديث الحالة: قيد التحضير');
          break;
        case 'ready':
          c.pager = 'ready';
          toast('تم إرسال تنبيه الجاهزية للعميل ☕');
          break;
        case 'done':
          c.pager = 'idle';
          toast('تم إنهاء الطلب');
          break;
        default:
          return;
      }

      if (DB.save(db)) {
        renderResult();
        refreshStaff();
      }
    });
  }

  function refreshStaff() {
    if (!staffAuthed) return;
    const db = DB.load();
    const list = Object.values(db.customers);

    const totalStamps = list.reduce((s, c) => s + (c.stamps || 0), 0);
    const gifts = list.reduce((s, c) => s + (c.gifts || 0), 0);
    const readyCount = list.filter((c) => c.pager === 'ready').length;
    const avg = db.ratings.length
      ? (db.ratings.reduce((s, r) => s + r.stars, 0) / db.ratings.length).toFixed(1)
      : '—';

    $('#stats').innerHTML = [
      ['الأعضاء', list.length],
      ['الأختام الحالية', totalStamps],
      ['الهدايا المسلّمة', gifts],
      ['طلبات جاهزة الآن', readyCount],
      ['متوسط التقييم', avg]
    ].map(([k, v]) => `<div class="stat"><b>${v}</b><span class="muted small">${k}</span></div>`).join('');

    const rows = list
      .slice()
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .map((c) => `
        <tr data-phone="${esc(c.phone)}">
          <td dir="ltr">${esc(c.id)}</td>
          <td>${esc(c.name)}</td>
          <td dir="ltr">${esc(c.phone)}</td>
          <td>${c.stamps || 0}/${CONFIG.STAMPS_TARGET}</td>
          <td>${c.lastVisit ? fmtDate(c.lastVisit) : '—'}</td>
        </tr>`)
      .join('');

    $('#customersTable tbody').innerHTML =
      rows || '<tr><td colspan="5" class="muted">لا يوجد عملاء بعد</td></tr>';
  }

  function exportCSV() {
    const db = DB.load();
    const list = Object.values(db.customers);
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['رقم العضوية', 'الاسم', 'الموبايل', 'الأختام', 'الهدايا', 'آخر زيارة', 'تاريخ التسجيل'];
    const lines = [head.map(q).join(',')].concat(
      list.map((c) => [
        c.id,
        c.name,
        c.phone,
        c.stamps || 0,
        c.gifts || 0,
        c.lastVisit ? fmtDate(c.lastVisit) : '',
        c.createdAt ? fmtDate(c.createdAt) : ''
      ].map(q).join(','))
    );

    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `oromo-vip-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('تم تصدير الملف، يفتح مباشرة في Excel');
  }

  /* ===================== ماسح QR ===================== */
  let scanStream = null;
  let scanRaf = null;

  async function startScanner() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('الكاميرا غير متاحة على هذا المتصفح');
      return;
    }
    if (typeof jsQR === 'undefined') {
      toast('ماسح الكود غير جاهز، تأكد من الاتصال');
      return;
    }

    try {
      scanStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false
      });
    } catch (e) {
      toast('لم نتمكن من فتح الكاميرا، اسمح بالوصول أولاً');
      return;
    }

    const video = $('#scanVideo');
    $('#scanner').classList.remove('hidden');
    video.srcObject = scanStream;
    await video.play().catch(() => {});

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const tick = () => {
      if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (code && code.data) {
          $('#staffSearch').value = code.data;
          runSearch();
          stopScanner();
          toast('تمت قراءة العضوية ✓');
          return;
        }
      }
      scanRaf = requestAnimationFrame(tick);
    };
    scanRaf = requestAnimationFrame(tick);
  }

  function stopScanner() {
    if (scanRaf) cancelAnimationFrame(scanRaf);
    scanRaf = null;
    if (scanStream) scanStream.getTracks().forEach((t) => t.stop());
    scanStream = null;
    const video = $('#scanVideo');
    if (video) video.srcObject = null;
    $('#scanner').classList.add('hidden');
  }

  /* ===================== ربط الأحداث ===================== */
  function bindStaff() {
    $('#staffLock').addEventListener('click', openStaff);

    $('#pinPad').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-key]');
      if (btn) pressKey(btn.dataset.key);
    });

    document.addEventListener('keydown', (e) => {
      const onPin = !$('#staffView').classList.contains('hidden') && !$('#pinBox').classList.contains('hidden');
      if (!onPin) return;
      if (/^\d$/.test(e.key)) pressKey(e.key);
      else if (e.key === 'Backspace') pressKey('⌫');
    });

    $('#staffLogout').addEventListener('click', () => {
      staffAuthed = false;
      pin = '';
      selectedPhone = null;
      stopScanner();
      $('#staffSearch').value = '';
      $('#searchResult').innerHTML = '';
      history.replaceState(null, '', location.pathname);
      setView('customer');
      renderCustomer();
    });

    $('#staffSearch').addEventListener('input', () => {
      const v = $('#staffSearch').value.trim();
      if (v.length >= 4) runSearch();
      else { selectedPhone = null; $('#searchResult').innerHTML = ''; }
    });
    $('#staffSearch').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runSearch();
    });

    $('#scanBtn').addEventListener('click', startScanner);
    $('#scanStop').addEventListener('click', stopScanner);
    $('#exportBtn').addEventListener('click', exportCSV);

    $('#customersTable tbody').addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-phone]');
      if (!tr) return;
      $('#staffSearch').value = tr.dataset.phone;
      runSearch();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ===================== المزامنة والتحديث الدوري ===================== */
  function bindSync() {
    // مزامنة بين التبويبات على نفس المتصفح
    window.addEventListener('storage', (e) => {
      if (e.key !== CONFIG.DB_KEY) return;
      renderCustomer();
      refreshStaff();
      if (selectedPhone) renderResult();
    });

    // مراقبة حالة البيجر بشكل دوري
    setInterval(() => {
      if ($('#customerView').classList.contains('hidden')) return;
      renderCustomer();
    }, CONFIG.POLL_MS);
  }

  /* ===================== تسجيل الـ Service Worker ===================== */
  function registerWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* التطبيق يعمل بدونه */ });
    });
  }

  /* ===================== التشغيل ===================== */
  function init() {
    buildPinPad();
    buildStars();
    initTilt();
    bindAlerts();
    bindRegister();
    bindConcierge();
    bindRating();
    bindInstall();
    bindStaff();
    bindStaffActions();
    bindSync();
    registerWorker();

    renderCustomer();

    const params = new URLSearchParams(location.search);
    if (params.get('view') === 'staff') {
      openStaff();
    } else {
      setView('customer');
    }
  }

  init();
})();
