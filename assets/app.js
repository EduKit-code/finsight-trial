/* FinSight Trial — UI & alur onboarding (Spec v2.1). Semua teks buatan pengguna dirender sebagai teks (tanpa innerHTML). */
(function () {
  'use strict';
  var D = window.FSDomain, S = window.FSStore, ROOT = document.getElementById('app');
  var STEPS = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7'];
  var EN = 'FinSight should not tell people how to become rich. It should help people understand their financial reality, the economic consequences of their movements, and the choices available to them.';
  var IDN = 'FinSight tidak hadir untuk mengajari orang menjadi kaya. FinSight membantu kita memahami kondisi keuangan, dampak ekonomi dari setiap pergerakan uang, serta pilihan yang tersedia untuk diambil.';
  var CTA = 'Are you ready to be wiser with your finance?';
  var A = { view: 'boot', step: 'W1', cats: { income: [], expense: [] }, draft: emptyDraft(), tx: null, storage: 'ok', w0timer: null, busy: false };

  function emptyDraft() { return { opening: null, assets: [], debts: [], firstTx: null }; }
  function el(tag, props) {
    var n = document.createElement(tag); props = props || {};
    Object.keys(props).forEach(function (k) {
      var v = props[k]; if (v == null || v === false) return;
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v); else if (k === 'value') n.value = v;
      else if (v === true) n.setAttribute(k, ''); else n.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) add(n, arguments[i]);
    return n;
  }
  function add(n, c) { if (c == null || c === false) return; if (Array.isArray(c)) c.forEach(function (x) { add(n, x); }); else n.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c); }
  function mount(node) { ROOT.replaceChildren(node); }
  function errText(e) {
    var c = D.codeOf(e); if (D.MESSAGES[c]) return D.MESSAGES[c];
    if (c === 'OPENING_NOT_CONFIRMED') return 'Saldo awal belum dikonfirmasi.';
    if (c === 'TIPE_INVALID' || c === 'KLASIFIKASI_INVALID') return 'Pilihan jenis tidak valid.';
    if (e && (e.fsCode || /Quota|Transaction|IDB/i.test(String(e.name || '') + String(e.message || '')))) return 'Penyimpanan di browser ini gagal. Perubahan belum tersimpan.';
    return 'Tidak dapat diproses (' + c + ').';
  }
  function errBox(id) { return el('div', { id: id || 'msg', role: 'alert', 'aria-live': 'assertive' }); }
  function showMsg(id, text, cls) { var b = document.getElementById(id); if (!b) return; b.replaceChildren(); if (text) b.appendChild(el('p', { class: cls || 'err', text: text })); }
  function money(n) { return D.rupiah(n); }
  function active(list) { return (list || []).filter(function (c) { return c.aktif !== false; }); }
  function sortSeq(r) { return r.slice().sort(function (a, b) { return a.seq - b.seq; }); }

  /* ---------- boot / resolve ---------- */
  function boot() {
    S.resolve().then(function (st) {
      A.storage = 'ok'; A.all = st.all;
      if (st.view === 'new') { A.view = 'w0'; return render(); }
      if (st.view === 'wizard') { A.view = 'wizard'; A.step = STEPS.indexOf(st.stepId) >= 0 ? st.stepId : 'W1'; return loadWizardData().then(render); }
      if (st.view === 'dashboard') { A.view = 'dashboard'; return loadDashboard(); }
      A.view = 'anomaly'; A.reason = st.reason; render();
    }).catch(function (e) {
      var c = e && e.fsCode;
      A.storage = c === 'SCHEMA_NEWER' ? 'schema' : 'unavailable'; A.view = c === 'SCHEMA_NEWER' ? 'schema' : 'w0'; render();
    });
  }
  function loadWizardData() {
    return S.readAll().then(function (a) {
      A.cats = { income: a.incomeCategories.sort(byUrut), expense: a.expenseCategories.sort(byUrut) };
      A.draft = a.setupDraft[0] || emptyDraft(); A.draft.assets = A.draft.assets || []; A.draft.debts = A.draft.debts || [];
      if (A.draft.firstTx && !A.tx) A.tx = { kind: A.draft.firstTx.kind, form: A.draft.firstTx.form, requestId: A.draft.firstTx.requestId, review: false };
    });
  }
  function byUrut(a, b) { return (a.urutan || 0) - (b.urutan || 0); }
  S.onMessage(function (m) { if (m && (m.kind === 'commit' || m.kind === 'reset' || m.kind === 'begin') && A.view !== 'boot') { clearW0(); boot(); } });

  function render() {
    clearW0();
    if (A.view === 'w0') return renderW0();
    if (A.view === 'wizard') return renderWizard();
    if (A.view === 'dashboard') return renderDashboard();
    if (A.view === 'schema') return mount(el('main', { class: 'wrap' }, el('h1', { text: 'Versi data lebih baru' }), el('p', { text: 'Data trial di browser ini dibuat oleh versi aplikasi yang lebih baru. Untuk menjaga datamu, aplikasi ini tidak membukanya.' })));
    if (A.view === 'anomaly') return renderAnomaly();
    mount(el('main', { class: 'wrap' }, el('p', { text: 'Memuat…' })));
  }

  /* ---------- W0 ---------- */
  function clearW0() { if (A.w0timer) { clearTimeout(A.w0timer); A.w0timer = null; } if (A.w0key) { document.removeEventListener('keydown', A.w0key); A.w0key = null; } }
  function renderW0() {
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var en = el('p', { lang: 'en', class: 'w0-en', id: 'w0-en' }), id = el('p', { lang: 'id', class: 'w0-id', id: 'w0-id' });
    var caret = el('span', { class: 'caret', 'aria-hidden': 'true' });
    var skip = el('button', { class: 'w0-skip link', id: 'w0-skip', type: 'button', text: 'Lewati animasi' });
    var cta = el('button', { class: 'w0-cta primary fade', id: 'w0-cta', type: 'button', hidden: true, text: CTA });
    var textBox = el('div', { class: 'w0-text', id: 'w0-text', 'aria-hidden': 'true' }, en, id);
    var main = el('main', { class: 'w0', id: 'w0' },
      el('div', { class: 'sr-only' }, el('p', { lang: 'en', text: EN }), el('p', { lang: 'id', text: IDN })),
      textBox, reduce ? null : skip, cta);
    mount(main);
    var done = false;
    function finish() { done = true; clearW0(); en.textContent = EN; id.textContent = IDN; if (caret.parentNode) caret.remove(); skip.hidden = true; cta.hidden = false; }
    cta.addEventListener('click', function () {
      if (cta.disabled) return; cta.disabled = true;
      if (A.storage !== 'ok') { A.view = 'wizard'; A.step = 'W1'; A.blocked = 'unavailable'; return render(); }
      S.begin().then(function () { A.view = 'wizard'; A.step = 'W1'; A.blocked = null; return loadWizardData().then(render); })
        .catch(function () { A.view = 'wizard'; A.step = 'W1'; A.blocked = 'write'; render(); });
    });
    if (reduce) return finish();
    skip.addEventListener('click', finish);
    textBox.addEventListener('click', function () { if (!done) finish(); });
    A.w0key = function (ev) {
      if (done) return;
      if (ev.key === 'Escape') { ev.preventDefault(); finish(); }
      else if (ev.key === ' ' && !/^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test((ev.target && ev.target.tagName) || '')) { ev.preventDefault(); finish(); }
    };
    document.addEventListener('keydown', A.w0key);
    var SPEED = 25, PAUSE = 500;
    function type(target, text, next) {
      var i = 0; target.textContent = ''; target.appendChild(caret);
      (function tick() {
        if (done) return; i++; target.textContent = text.slice(0, i); target.appendChild(caret);
        if (i < text.length) A.w0timer = setTimeout(tick, SPEED); else next();
      })();
    }
    type(en, EN, function () { A.w0timer = setTimeout(function () { if (done) return; en.textContent = EN; type(id, IDN, function () { finish(); }); }, PAUSE); });
  }

  /* ---------- wizard chrome ---------- */
  var TITLES = { W1: 'Pengantar', W2: 'Kategori pemasukan', W3: 'Kategori pengeluaran', W4: 'Saldo awal', W5: 'Aset & utang', W6: 'Ringkasan setup', W7: 'Transaksi pertama' };
  function go(step) {
    if (A.busy) return; A.busy = true;
    return S.setStep(step).then(function () { A.step = step; return loadWizardData(); }).then(function () { A.busy = false; render(); window.scrollTo(0, 0); })
      .catch(function (e) { A.busy = false; showMsg('msg', errText(e)); });
  }
  function frame(step, body, opts) {
    opts = opts || {}; var i = STEPS.indexOf(step), prev = STEPS[i - 1];
    return el('main', { class: 'wrap' },
      el('p', { class: 'steps', text: 'Langkah ' + (i + 1) + ' dari ' + STEPS.length }),
      el('h1', { id: 'step-title', text: TITLES[step], tabindex: '-1' }), body, errBox('msg'),
      opts.noNav ? null : el('div', { class: 'actions' },
        prev ? el('button', { type: 'button', id: 'btn-back', text: 'Kembali', onclick: function () { go(prev); } }) : el('span'),
        opts.next || null));
  }
  function renderWizard() {
    var s = A.step; var node = s === 'W1' ? viewW1() : s === 'W2' ? viewCats('income') : s === 'W3' ? viewCats('expense') : s === 'W4' ? viewW4() : s === 'W5' ? viewW5() : s === 'W6' ? viewW6() : viewW7();
    mount(node); var t = document.getElementById('step-title'); if (t) t.focus({ preventScroll: true });
  }

  /* ---------- W1 ---------- */
  function viewW1() {
    var blocked = A.blocked;
    var info = el('div', { class: 'card' },
      el('p', { text: 'FinSight membantu kamu melihat kondisi keuanganmu sendiri. Di trial ini kamu menyusun pengaturannya dari nol: kategori, saldo awal, lalu satu pencatatan pertama.' }),
      el('p', { text: 'Kamu boleh melewati sebagian besar langkah. Tidak ada kategori atau angka yang dibuatkan untukmu.' }),
      el('h2', { text: 'Tentang penyimpanan data' }),
      el('ul', {}, el('li', { text: 'Data trial disimpan di browser dan perangkat ini saja.' }), el('li', { text: 'Belum ada akun, sinkronisasi lintas perangkat, atau koneksi ke sistem lain.' }),
        el('li', { text: 'Jika data browser dibersihkan, atau kamu pindah browser atau perangkat, data trial ini hilang dan mulai dari awal.' }),
        el('li', { text: 'Siapa pun yang memakai browser ini bisa melihat datanya. Ini bukan pengamanan akun.' })));
    if (blocked) {
      var msg = blocked === 'unavailable' ? 'Penyimpanan di browser ini tidak tersedia (mungkin mode privat atau dibatasi). Karena itu setup tidak bisa disimpan dan tidak bisa dilanjutkan di sini.'
        : 'Aplikasi tidak berhasil menulis ke penyimpanan browser ini. Karena itu setup tidak bisa disimpan dan tidak bisa dilanjutkan.';
      return el('main', { class: 'wrap' }, el('h1', { id: 'step-title', tabindex: '-1', text: 'Penyimpanan tidak tersedia' }), el('div', { class: 'warn', role: 'alert', id: 'w1-blocked', text: msg }), info,
        el('p', { class: 'hint', text: 'Coba buka di jendela biasa (bukan privat), atau browser lain, lalu muat ulang halaman ini.' }));
    }
    return frame('W1', info, { next: el('button', { type: 'button', class: 'primary', id: 'btn-start', text: 'Mulai atur', onclick: function () { go('W2'); } }) });
  }

  /* ---------- W2 / W3 / W6 / W7 / pengaturan: kategori ---------- */
  function catAdder(kind, afterAdd, idp) {
    idp = idp || kind; var isInc = kind === 'income';
    var name = el('input', { type: 'text', id: idp + '-name', maxlength: '160', autocomplete: 'off' });
    var sel = el('select', { id: idp + '-kind' });
    if (isInc) Object.keys(D.INCOME_TYPES).forEach(function (k) { sel.appendChild(el('option', { value: k, text: D.INCOME_TYPES[k] })); });
    else D.KLASIFIKASI.forEach(function (k) { sel.appendChild(el('option', { value: k, text: k })); });
    var hint = el('div', { id: idp + '-hint' }), box = errBox(idp + '-msg');
    if (!isInc) name.addEventListener('input', function () { hint.replaceChildren(); if (D.cicilanHint(name.value)) hint.appendChild(el('p', { class: 'warn', id: idp + '-cicil', text: 'Bayar utang dicatat lewat menu Utang dan tidak dihitung sebagai pengeluaran.' })); });
    var btn = el('button', { type: 'button', id: idp + '-add', text: 'Tambah kategori' });
    btn.addEventListener('click', function () {
      var input = isInc ? { nama: name.value, tipe: sel.value } : { nama: name.value, klasifikasi: sel.value };
      S.addCategory(kind, input).then(function () { return loadWizardData(); }).then(function () { afterAdd(); })
        .catch(function (e) {
          showMsg(idp + '-msg', errText(e));
          if (D.codeOf(e) === 'NAME_DUPLICATE' && e.existing && e.existing.aktif === false) {
            document.getElementById(idp + '-msg').appendChild(el('button', { type: 'button', text: 'Aktifkan kembali', onclick: function () { S.patchCategory(kind, e.existing.key, { aktif: true }).then(loadWizardData).then(afterAdd).catch(function (x) { showMsg(idp + '-msg', errText(x)); }); } }));
          }
        });
    });
    return el('div', { class: 'card' }, el('h3', { text: 'Buat kategori sendiri' }), el('label', { for: idp + '-name', text: 'Nama kategori' }), name,
      el('label', { for: idp + '-kind', text: isInc ? 'Jenis pemasukan' : 'Klasifikasi' }), sel, hint, btn, box);
  }
  function catList(kind, redraw) {
    var rows = A.cats[kind]; if (!rows.length) return el('p', { class: 'muted', id: kind + '-empty', text: 'Belum ada kategori. Ini tidak apa-apa; kamu bisa menambahkannya kapan saja.' });
    var ul = el('ul', { class: 'list', id: kind + '-list' });
    rows.forEach(function (c) {
      var meta = kind === 'income' ? D.INCOME_TYPES[c.tipe] : c.klasifikasi;
      ul.appendChild(el('li', {}, el('span', {}, c.nama + ' ', el('span', { class: 'muted', text: '(' + meta + (c.aktif === false ? ', nonaktif' : '') + ')' })),
        el('button', { type: 'button', text: c.aktif === false ? 'Aktifkan' : 'Nonaktifkan', 'aria-label': (c.aktif === false ? 'Aktifkan ' : 'Nonaktifkan ') + c.nama,
          onclick: function () { S.patchCategory(kind, c.key, { aktif: c.aktif === false }).then(loadWizardData).then(redraw).catch(function (e) { showMsg('msg', errText(e)); }); } })));
    });
    return ul;
  }
  function viewCats(kind) {
    var isInc = kind === 'income', sug = isInc ? D.SUGGEST_INCOME : D.SUGGEST_EXPENSE, step = isInc ? 'W2' : 'W3', nextStep = isInc ? 'W3' : 'W4';
    var existing = A.cats[kind].map(function (c) { return D.normName(c.nama); });
    var sugBox = el('div', { class: 'card' }, el('h2', { text: 'Saran umum (opsional)' }), el('p', { class: 'hint', text: 'Tidak ada yang dipilih otomatis. Jenis di bawah hanya usulan; ubah sesuai kebutuhanmu sebelum menambahkan.' }));
    sug.forEach(function (s, i) {
      if (existing.indexOf(D.normName(s.nama)) >= 0) return;
      var sel = el('select', { id: kind + '-sug-' + i + '-kind', 'aria-label': 'Jenis untuk ' + s.nama });
      if (isInc) Object.keys(D.INCOME_TYPES).forEach(function (k) { sel.appendChild(el('option', { value: k, text: D.INCOME_TYPES[k], selected: k === s.tipe })); });
      else D.KLASIFIKASI.forEach(function (k) { sel.appendChild(el('option', { value: k, text: k, selected: k === s.klasifikasi })); });
      sugBox.appendChild(el('div', { class: 'row', 'data-sug': s.nama }, el('strong', { text: s.nama }), sel,
        el('button', { type: 'button', id: kind + '-sug-' + i, text: 'Tambah', 'aria-label': 'Tambah ' + s.nama, onclick: function () {
          S.addCategory(kind, isInc ? { nama: s.nama, tipe: sel.value } : { nama: s.nama, klasifikasi: sel.value }).then(loadWizardData).then(render).catch(function (e) { showMsg('msg', errText(e)); });
        } })));
    });
    var body = el('div', {}, el('p', { text: isInc ? 'Pilih sumber pemasukan yang relevan, atau buat sendiri. Nominal tidak diminta di sini.' : 'Pilih kelompok pengeluaran yang relevan, atau buat sendiri. Pembayaran utang tidak dicatat sebagai pengeluaran.' }),
      el('p', { class: 'hint', text: 'Kategori yang kamu tambahkan tersimpan di browser ini walaupun setup belum selesai.' }),
      el('div', { class: 'card' }, el('h2', { text: 'Kategori kamu' }), catList(kind, render)), sugBox, catAdder(kind, render, kind + '-custom'));
    var n = active(A.cats[kind]).length;
    return frame(step, body, { next: el('button', { type: 'button', class: 'primary', id: 'btn-next', text: n ? 'Lanjut' : 'Lewati, atur nanti', onclick: function () { go(nextStep); } }) });
  }

  /* ---------- W4 saldo awal ---------- */
  function moneyField(id, label, value, hint) {
    return el('div', {}, el('label', { for: id, text: label }), el('input', { type: 'text', inputmode: 'numeric', id: id, autocomplete: 'off', value: value == null ? '' : String(value) }), hint ? el('p', { class: 'hint', text: hint }) : null);
  }
  function viewW4() {
    var o = A.draft.opening || {};
    var date = el('input', { type: 'date', id: 'op-date', value: o.snapshotDate || D.todayStr(), max: D.todayStr() });
    var conf = el('input', { type: 'checkbox', id: 'op-confirm', checked: !!o.confirmedAt });
    var body = el('div', { class: 'card' },
      el('p', { text: 'Berapa uang yang kamu pegang sekarang di tiap tempat? Nol (0) sah. Kolom tidak boleh dikosongkan.' }),
      moneyField('op-CASH', 'Cash', o.CASH), moneyField('op-REKENING', 'Rekening', o.REKENING), moneyField('op-E_WALLET', 'E-Wallet', o.E_WALLET),
      el('label', { for: 'op-date', text: 'Tanggal saldo awal' }), date,
      el('div', { class: 'radio' }, conf, el('label', { for: 'op-confirm', text: 'Saldo ini sudah benar.' })),
      el('p', { class: 'hint', text: 'Setelah setup disimpan (di akhir langkah transaksi pertama), saldo awal menjadi final di trial ini.' }));
    var next = el('button', { type: 'button', class: 'primary', id: 'btn-next', text: 'Simpan & lanjut', onclick: function () {
      var raw = { CASH: val('op-CASH'), REKENING: val('op-REKENING'), E_WALLET: val('op-E_WALLET'), snapshotDate: date.value };
      try {
        var v = D.validateOpening(raw, new Date()); if (!conf.checked) throw new Error('OPENING_NOT_CONFIRMED');
        v.confirmedAt = (A.draft.opening && A.draft.opening.confirmedAt) || new Date().toISOString(); A.draft.opening = v;
      } catch (e) { return showMsg('msg', errText(e)); }
      S.saveDraft(A.draft).then(function () { return go('W5'); }).catch(function (e) { showMsg('msg', errText(e)); });
    } });
    return frame('W4', body, { next: next });
  }
  function val(id) { var n = document.getElementById(id); return n ? n.value : ''; }

  /* ---------- W5 aset & utang ---------- */
  function saveDraftAnd(fn) { S.saveDraft(A.draft).then(fn).catch(function (e) { showMsg('msg', errText(e)); }); }
  function viewW5() {
    var d = A.draft;
    function listItems(arr, kind) {
      if (!arr.length) return null;
      var ul = el('ul', { class: 'list', id: kind + '-draft-list' });
      arr.forEach(function (x, i) {
        ul.appendChild(el('li', {}, el('span', { text: kind === 'asset' ? x.name + ' · nilai ' + money(Number(x.value)) + ' · setoran ' + money(Number(x.contribution)) : x.name + ' · sisa ' + money(Number(x.remaining)) + ' dari ' + money(Number(x.principal)) + ' · ' + (x.mode === 'CICILAN' ? 'cicilan ' + money(Number(x.installment)) : 'tunai') }),
          el('button', { type: 'button', text: 'Hapus', 'aria-label': 'Hapus ' + x.name, onclick: function () { arr.splice(i, 1); saveDraftAnd(render); } })));
      });
      return ul;
    }
    var aOpen = d.assets.length > 0 || A.assetOpen, dOpen = d.debts.length > 0 || A.debtOpen;
    var assetRadios = el('fieldset', {}, el('legend', { text: 'Punya tabungan atau investasi?' }),
      el('div', { class: 'radio' }, el('input', { type: 'radio', name: 'has-asset', id: 'asset-no', checked: !aOpen, onchange: function () { A.assetOpen = false; render(); } }), el('label', { for: 'asset-no', text: 'Tidak ada / nanti saja' })),
      el('div', { class: 'radio' }, el('input', { type: 'radio', name: 'has-asset', id: 'asset-yes', checked: aOpen, onchange: function () { A.assetOpen = true; render(); } }), el('label', { for: 'asset-yes', text: 'Ada, saya isi sekarang' })));
    var assetForm = !aOpen ? null : el('div', {}, listItems(d.assets, 'asset'), el('label', { for: 'as-name', text: 'Nama aset' }), el('input', { type: 'text', id: 'as-name', maxlength: '160' }),
      moneyField('as-value', 'Nilai tercatat sekarang', '', 'Berapa nilainya hari ini menurut catatanmu.'), moneyField('as-contrib', 'Total setoran', '', 'Berapa total uang yang pernah kamu setor. Boleh berbeda dari nilai sekarang.'),
      el('button', { type: 'button', id: 'as-add', text: 'Tambah aset', onclick: function () {
        try { var v = D.validateAsset({ name: val('as-name'), value: val('as-value'), contribution: val('as-contrib') }); d.assets.push({ id: D.newId('aset'), requestId: D.newRequestId(), name: v.name, value: v.value, contribution: v.contribution }); }
        catch (e) { return showMsg('msg', errText(e)); } saveDraftAnd(render);
      } }));
    var debtRadios = el('fieldset', {}, el('legend', { text: 'Punya utang?' }),
      el('div', { class: 'radio' }, el('input', { type: 'radio', name: 'has-debt', id: 'debt-no', checked: !dOpen, onchange: function () { A.debtOpen = false; render(); } }), el('label', { for: 'debt-no', text: 'Tidak ada / nanti saja' })),
      el('div', { class: 'radio' }, el('input', { type: 'radio', name: 'has-debt', id: 'debt-yes', checked: dOpen, onchange: function () { A.debtOpen = true; render(); } }), el('label', { for: 'debt-yes', text: 'Ada, saya isi sekarang' })));
    var mode = el('select', { id: 'db-mode' }, el('option', { value: '', text: 'Pilih cara bayar' }), el('option', { value: 'CICILAN', text: 'Cicilan (dibayar bertahap dengan cicilan)' }), el('option', { value: 'TUNAI', text: 'Tunai (tanpa cicilan rutin)' }));
    var inst = moneyField('db-inst', 'Cicilan per bulan', '', null), instWrap = el('div', { id: 'db-inst-wrap', hidden: true }, inst);
    mode.addEventListener('change', function () { instWrap.hidden = mode.value !== 'CICILAN'; if (mode.value !== 'CICILAN') document.getElementById('db-inst').value = ''; });
    var debtForm = !dOpen ? null : el('div', {}, listItems(d.debts, 'debt'), el('label', { for: 'db-name', text: 'Nama utang' }), el('input', { type: 'text', id: 'db-name', maxlength: '160' }),
      moneyField('db-principal', 'Total awal utang', ''), moneyField('db-remaining', 'Sisa utang sekarang', '', 'Isi sendiri; tidak boleh lebih besar dari total awal. Isi 0 bila sudah lunas.'),
      el('label', { for: 'db-mode', text: 'Cara bayar' }), mode, instWrap,
      el('button', { type: 'button', id: 'db-add', text: 'Tambah utang', onclick: function () {
        try { var v = D.validateDebt({ name: val('db-name'), principal: val('db-principal'), remaining: val('db-remaining'), mode: val('db-mode'), installment: val('db-inst') });
          d.debts.push({ id: D.newId('utang'), requestId: D.newRequestId(), name: v.name, principal: v.principal, remaining: v.remaining, mode: v.mode, installment: v.installment }); }
        catch (e) { return showMsg('msg', errText(e)); } saveDraftAnd(render);
      } }));
    var body = el('div', {}, el('p', { text: 'Bagian ini opsional. Kamu bisa melewatinya dan melengkapinya nanti.' }),
      el('div', { class: 'card' }, el('h2', { text: 'Aset' }), assetRadios, assetForm), el('div', { class: 'card' }, el('h2', { text: 'Utang' }), debtRadios, debtForm),
      el('p', { class: 'hint', text: 'Utang dan pembayarannya tidak dihitung sebagai pengeluaran.' }));
    return frame('W5', body, { next: el('button', { type: 'button', class: 'primary', id: 'btn-next', text: 'Lanjut', onclick: function () { go('W6'); } }) });
  }

  /* ---------- W6 ringkasan ---------- */
  function viewW6() {
    var d = A.draft, o = d.opening;
    if (!o) return viewMissingOpening();
    function catsBlock(kind, title, back) {
      var act = active(A.cats[kind]);
      return el('div', { class: 'card' }, el('h2', { text: title }),
        act.length ? el('ul', { class: 'list', id: 'sum-' + kind }, act.map(function (c) { return el('li', {}, el('span', { text: c.nama + ' (' + (kind === 'income' ? D.INCOME_TYPES[c.tipe] : c.klasifikasi) + ')' })); })) : el('p', { class: 'muted', id: 'sum-' + kind + '-empty', text: 'Belum ada kategori.' }),
        el('div', { class: 'row tight' }, el('button', { type: 'button', text: 'Ubah', onclick: function () { go(back); } }),
          el('button', { type: 'button', id: 'sum-add-' + kind, text: 'Tambah kategori', onclick: function () { A['add_' + kind] = !A['add_' + kind]; render(); } })),
        A['add_' + kind] ? catAdder(kind, function () { render(); }, 'sum-' + kind + '-new') : null);
    }
    var body = el('div', {}, el('p', { class: 'hint', text: 'Ini ringkasan konfigurasi yang kamu buat, bukan penilaian kondisi keuangan.' }),
      catsBlock('income', 'Kategori pemasukan', 'W2'), catsBlock('expense', 'Kategori pengeluaran', 'W3'),
      el('div', { class: 'card' }, el('h2', { text: 'Saldo awal' }), el('ul', { class: 'list', id: 'sum-opening' }, D.LOCS.map(function (k) { return el('li', {}, el('span', { text: D.LOC_LABEL[k] }), el('strong', { text: money(o[k]) })); }),
        el('li', {}, el('span', { text: 'Tanggal saldo awal' }), el('strong', { text: o.snapshotDate }))), el('button', { type: 'button', text: 'Ubah', onclick: function () { go('W4'); } })),
      el('div', { class: 'card' }, el('h2', { text: 'Aset dan utang' }),
        d.assets.length || d.debts.length ? el('ul', { class: 'list', id: 'sum-ad' }, d.assets.map(function (a) { return el('li', {}, el('span', { text: 'Aset: ' + a.name }), el('strong', { text: money(Number(a.value)) })); }), d.debts.map(function (x) { return el('li', {}, el('span', { text: 'Utang: ' + x.name }), el('strong', { text: 'sisa ' + money(Number(x.remaining)) })); })) : el('p', { class: 'muted', id: 'sum-ad-empty', text: 'Tidak ada yang dicatat. Bisa dilengkapi nanti.' }),
        el('button', { type: 'button', text: 'Ubah', onclick: function () { go('W5'); } })),
      el('p', { class: 'warn', text: 'Setelah setup disimpan, saldo awal menjadi final di trial ini.' }));
    return frame('W6', body, { next: el('button', { type: 'button', class: 'primary', id: 'btn-next', text: 'Lanjut', onclick: function () { go('W7'); } }) });
  }
  function viewMissingOpening() {
    return frame('W7', el('div', { class: 'warn', role: 'alert', text: 'Saldo awal belum dikonfirmasi. Isi dulu di langkah Saldo awal.' }), { next: el('button', { type: 'button', class: 'primary', text: 'Ke Saldo awal', onclick: function () { go('W4'); } }) });
  }

  /* ---------- W7 transaksi pertama ---------- */
  function viewW7() {
    var d = A.draft, o0 = d.opening; if (!o0) return viewMissingOpening();
    var o = D.validateOpening(o0, new Date()), anyBal = D.LOCS.some(function (k) { return o[k] > 0; });
    var tx = A.tx || (A.tx = { kind: null, form: {}, review: false, requestId: null });
    var expEnabled = anyBal;
    var kindRadios = el('fieldset', {}, el('legend', { text: 'Jenis transaksi' }),
      el('div', { class: 'radio' }, el('input', { type: 'radio', name: 'tx-kind', id: 'kind-income', checked: tx.kind === 'INCOME', onchange: function () { setKind('INCOME'); } }), el('label', { for: 'kind-income', text: 'Pemasukan' })),
      el('div', { class: 'radio' }, el('input', { type: 'radio', name: 'tx-kind', id: 'kind-expense', checked: tx.kind === 'EXPENSE', disabled: !expEnabled, 'aria-disabled': !expEnabled ? 'true' : null, 'aria-describedby': !expEnabled ? 'expense-reason' : null, onchange: function () { setKind('EXPENSE'); } }), el('label', { for: 'kind-expense', text: 'Pengeluaran' })),
      !expEnabled ? el('p', { class: 'warn', id: 'expense-reason', text: 'Pengeluaran belum bisa dicatat karena semua saldo masih Rp 0. Catat pemasukan dulu, atau ubah saldo awal.' }) : null,
      !expEnabled ? el('button', { type: 'button', class: 'link', id: 'link-opening', text: 'Ubah saldo awal', onclick: function () { go('W4'); } }) : null);
    function setKind(k) { tx.kind = k; tx.form = {}; tx.review = false; render(); }
    var form = null;
    if (tx.review) form = reviewCard(o);
    else if (tx.kind === 'INCOME') form = incomeForm(o);
    else if (tx.kind === 'EXPENSE') form = expenseForm(o);
    var skipBtn = el('button', { type: 'button', id: 'btn-skip-tx', text: 'Lewati dulu', onclick: function () { doCommit(null, 'btn-skip-tx'); } });
    var body = el('div', {}, el('p', { text: 'Catat satu transaksi pertama. Ini tersimpan sungguhan di data trial ini, bukan simulasi.' }), el('div', { class: 'card' }, kindRadios), form,
      el('div', { class: 'card' }, el('p', { class: 'hint', text: 'Boleh dilewati. Dashboard tetap terbuka dengan kondisi yang apa adanya. Setelah setup disimpan, saldo awal menjadi final.' }), skipBtn));
    return frame('W7', body, { noNav: false, next: null });
  }
  function catSelect(id, list) { var s = el('select', { id: id }); list.forEach(function (c) { s.appendChild(el('option', { value: c.key, text: c.nama })); }); return s; }
  function noCatCreator(kind) {
    return el('div', { class: 'card' }, el('p', { id: 'tx-nocat', class: 'warn', text: kind === 'income' ? 'Belum ada kategori pemasukan. Buat dulu agar bisa mencatat.' : 'Belum ada kategori pengeluaran. Buat dulu agar bisa mencatat.' }),
      el('button', { type: 'button', id: 'tx-open-creator', text: 'Buat kategori sekarang', onclick: function () { A['creator_' + kind] = true; render(); } }),
      A['creator_' + kind] ? catAdder(kind, render, 'tx-' + kind + '-new') : null);
  }
  function incomeForm(o) {
    var cats = active(A.cats.income); if (!cats.length) return noCatCreator('income');
    var f = A.tx.form, src = catSelect('tx-source', cats); if (f.source) src.value = f.source;
    var allocInputs = D.LOCS.map(function (k) { return moneyField('al-' + k, 'Alokasi ke ' + D.LOC_LABEL[k] + ' (opsional)', (f.allocations && f.allocations[k]) || ''); });
    var sum = el('p', { id: 'alloc-summary', class: 'okbox' });
    function upd() {
      var amt = D.parseMoney(val('tx-amount')) || 0, tot = 0; D.LOCS.forEach(function (k) { var v = D.parseMoney(val('al-' + k)); if (v) tot += v; });
      sum.textContent = 'Dialokasikan ' + money(tot) + ' · Belum dialokasikan ' + money(Math.max(0, amt - tot)) + (tot > amt ? ' (alokasi melebihi pemasukan)' : '') + '. Yang belum dialokasikan belum termasuk Saldo Berjalan.';
    }
    var body = el('div', { class: 'card', id: 'form-income' }, el('h2', { text: 'Pemasukan' }), moneyField('tx-amount', 'Nominal pemasukan', f.amount), el('label', { for: 'tx-source', text: 'Sumber' }), src,
      el('label', { for: 'tx-date', text: 'Tanggal' }), el('input', { type: 'date', id: 'tx-date', value: f.transactionDate || D.todayStr(), min: o.snapshotDate, max: D.todayStr() }),
      el('label', { for: 'tx-note', text: 'Catatan (opsional)' }), el('input', { type: 'text', id: 'tx-note', value: f.note || '' }),
      el('h3', { text: 'Tempatkan uangnya (opsional)' }), el('p', { class: 'hint', text: 'Boleh sebagian atau dikosongkan. Sisa tetap tercatat sebagai belum dialokasikan; tidak diubah jadi pengeluaran.' }), allocInputs, sum,
      el('button', { type: 'button', class: 'primary', id: 'btn-review', text: 'Tinjau', onclick: function () { review('INCOME', o); } }));
    body.addEventListener('input', upd); setTimeout(upd, 0); return body;
  }
  function expenseForm(o) {
    var cats = active(A.cats.expense); if (!cats.length) return noCatCreator('expense');
    var f = A.tx.form, cat = catSelect('tx-category', cats); if (f.category) cat.value = f.category;
    var loc = el('select', { id: 'tx-loc' }); D.LOCS.forEach(function (k) { loc.appendChild(el('option', { value: k, text: D.LOC_LABEL[k] + ' (saldo ' + money(o[k]) + ')', disabled: o[k] <= 0 })); });
    loc.value = f.locationId && o[f.locationId] > 0 ? f.locationId : (D.LOCS.filter(function (k) { return o[k] > 0; })[0]);
    var sub = el('select', { id: 'tx-sub' }); D.KLASIFIKASI.forEach(function (k) { sub.appendChild(el('option', { value: k, text: k })); });
    function syncSub() { var c = cats.filter(function (x) { return x.key === cat.value; })[0]; if (c) sub.value = c.klasifikasi; } syncSub(); cat.addEventListener('change', syncSub); if (f.subCategory) sub.value = f.subCategory;
    return el('div', { class: 'card', id: 'form-expense' }, el('h2', { text: 'Pengeluaran' }), moneyField('tx-amount', 'Nominal pengeluaran', f.amount), el('label', { for: 'tx-loc', text: 'Dari mana uangnya' }), loc,
      el('label', { for: 'tx-category', text: 'Kategori' }), cat, el('label', { for: 'tx-sub', text: 'Klasifikasi' }), sub,
      el('label', { for: 'tx-date', text: 'Tanggal' }), el('input', { type: 'date', id: 'tx-date', value: f.transactionDate || D.todayStr(), min: o.snapshotDate, max: D.todayStr() }),
      el('label', { for: 'tx-note', text: 'Catatan (opsional)' }), el('input', { type: 'text', id: 'tx-note', value: f.note || '' }),
      el('button', { type: 'button', class: 'primary', id: 'btn-review', text: 'Tinjau', onclick: function () { review('EXPENSE', o); } }));
  }
  function review(kind, o) {
    var f = { amount: val('tx-amount'), transactionDate: val('tx-date'), note: val('tx-note') }, cats = A.cats;
    try {
      if (kind === 'INCOME') {
        f.source = val('tx-source'); f.allocations = {}; D.LOCS.forEach(function (k) { f.allocations[k] = val('al-' + k); });
        var b = D.buildIncome(f, o, cats.income, new Date()), tot = 0; Object.keys(b.data.allocations).forEach(function (k) { tot += b.data.allocations[k]; });
        if (tot > b.data.amount) throw new Error('ALLOCATION_EXCEEDS_INCOME');
      } else {
        f.locationId = val('tx-loc'); f.category = val('tx-category'); f.subCategory = val('tx-sub');
        var e = D.buildExpense(f, o, cats.expense, new Date());
        if (e.data.amount > o[e.data.locationId]) throw new Error('INSUFFICIENT_LOCATION_BALANCE:' + e.data.locationId);
      }
    } catch (err) {
      if (D.codeOf(err) === 'INSUFFICIENT_LOCATION_BALANCE') return showMsg('msg', 'Saldo ' + D.LOC_LABEL[f.locationId] + ' ' + money(o[f.locationId]) + ' tidak cukup untuk ' + money(D.parseMoney(f.amount) || 0) + '.');
      return showMsg('msg', errText(err));
    }
    A.tx.kind = kind; A.tx.form = f; A.tx.requestId = A.tx.requestId || D.newRequestId(); A.tx.review = true;
    A.draft.firstTx = { kind: kind, form: f, requestId: A.tx.requestId };
    S.saveDraft(A.draft).then(render).catch(function (e2) { A.tx.review = false; showMsg('msg', errText(e2)); });
  }
  function reviewCard(o) {
    var t = A.tx, f = t.form, amt = D.parseMoney(f.amount), items = [];
    if (t.kind === 'INCOME') {
      var tot = 0; D.LOCS.forEach(function (k) { var v = D.parseMoney(f.allocations[k]); if (v) { tot += v; items.push(el('li', {}, el('span', { text: 'Ke ' + D.LOC_LABEL[k] }), el('strong', { text: money(v) }))); } });
      items.unshift(el('li', {}, el('span', { text: 'Pemasukan dari ' + f.source }), el('strong', { text: money(amt) })));
      items.push(el('li', {}, el('span', { text: 'Belum dialokasikan' }), el('strong', { id: 'review-unalloc', text: money(amt - tot) })));
    } else {
      items.push(el('li', {}, el('span', { text: 'Pengeluaran ' + f.category + ' (' + f.subCategory + ') dari ' + D.LOC_LABEL[f.locationId] }), el('strong', { text: money(amt) })));
    }
    items.push(el('li', {}, el('span', { text: 'Tanggal' }), el('strong', { text: f.transactionDate })));
    return el('div', { class: 'card', id: 'review-card' }, el('h2', { text: 'Periksa dulu' }), el('ul', { class: 'list' }, items),
      el('p', { class: 'hint', text: 'Setelah Simpan, transaksi ini tersimpan di data trial dan saldo awal menjadi final.' }),
      el('div', { class: 'row tight' }, el('button', { type: 'button', id: 'btn-edit', text: 'Ubah', onclick: function () { t.review = false; render(); } }),
        el('button', { type: 'button', class: 'primary', id: 'btn-save', text: 'Simpan', onclick: function () { doCommit({ kind: t.kind, form: t.form, requestId: t.requestId }, 'btn-save'); } })));
  }
  function doCommit(firstTx, btnId) {
    var b = document.getElementById(btnId); if (A.busy) return; A.busy = true; if (b) b.disabled = true;
    S.commit(firstTx).then(function () {
      A.busy = false; A.tx = null; A.view = 'dashboard';
      /* D6: permintaan penyimpanan persisten bersifat non-blocking; kegagalan menulis flag ini tidak boleh memengaruhi apa pun (tanpa unhandled rejection). */
      var quiet = function () { };
      try {
        if (navigator.storage && navigator.storage.persist) navigator.storage.persist().then(function (ok) { return S.updateMeta({ persist: ok ? 'diberikan' : 'tidak-diberikan' }); }).catch(function () { return S.updateMeta({ persist: 'tidak-tersedia' }).catch(quiet); });
        else S.updateMeta({ persist: 'tidak-tersedia' }).catch(quiet);
      } catch (e) { }
      return S.updateMeta({ impactSeen: !firstTx }).catch(function () { }).then(loadDashboard);
    }).catch(function (e) {
      A.busy = false; if (b) b.disabled = false;
      if (D.codeOf(e) === 'ALREADY_COMPLETED') { return boot(); }
      var specific = (D.MESSAGES[D.codeOf(e)] && !e.fsCode) ? errText(e) : '';
      showMsg('msg', 'Setup belum tersimpan. Isianmu masih ada. Coba lagi.' + (specific ? ' ' + specific : ''));
    });
  }

  /* ---------- Dashboard ---------- */
  function loadDashboard() {
    return S.readAll().then(function (all) {
      var open = all.opening[0], ledger = sortSeq(all.ledger), st;
      try { st = D.replay(open, ledger); } catch (e) { A.view = 'anomaly'; A.reason = D.codeOf(e); return render(); }
      return S.rebuildProjections(st).then(function (rebuilt) { A.dash = { all: all, st: st, open: open, ledger: ledger, rebuilt: rebuilt, meta: all.meta[0] || {}, income: all.incomeCategories.sort(byUrut), expense: all.expenseCategories.sort(byUrut) }; A.view = 'dashboard'; render(); });
    }).catch(function (e) { A.view = 'anomaly'; A.reason = D.codeOf(e); render(); });
  }
  function tile(label, value, id, note) { return el('div', { class: 'tile' }, el('small', { text: label }), el('b', { id: id, text: value }), note ? el('small', { id: id + '-note', text: note }) : null); }
  function renderDashboard() {
    if (!A.dash) return loadDashboard();
    var d = A.dash, st = d.st, now = new Date(), month = D.monthSummary(d.ledger, now), sr = D.savingsRate(month, d.open.snapshotDate, now), total = D.totalBalance(st);
    var relevantCount = d.ledger.filter(function (e) { return e.status === 'COMMITTED' && e.data && String(e.data.transactionDate || '').slice(0, 7) === D.todayStr(now).slice(0, 7) && (e.type === 'INCOME' || e.type === 'EXPENSE'); }).length;
    var dayOfMonth = Number(D.todayStr(now).slice(8, 10));
    var savingsLimited = relevantCount < 5 || dayOfMonth < 7;
    var assets = Object.keys(st.assets).map(function (k) { return st.assets[k]; });
    var debts = Object.keys(st.debts).map(function (k) { return st.debts[k]; });
    var net = total + assets.reduce(function (n, a) { return n + (Number(a.value) || 0); }, 0) - debts.reduce(function (n, x) { return n + (Number(x.remaining) || 0); }, 0);
    var persistTxt = { 'diberikan': 'Browser memberi perlindungan tambahan untuk data ini, tetapi data tetap bisa hilang bila kamu membersihkannya.', 'tidak-diberikan': 'Browser tidak memberi perlindungan tambahan. Data lebih mudah hilang bila ruang penyimpanan menipis atau data browser dibersihkan.', 'tidak-tersedia': 'Perlindungan tambahan tidak tersedia di browser ini.', 'belum-diminta': 'Belum ada perlindungan tambahan.' }[d.meta.persist || 'belum-diminta'];

    var pos = el('section', { class: 'card', 'aria-labelledby': 'h-saldo' },
      el('h2', { id: 'h-saldo', text: 'Posisi' }),
      el('div', { class: 'big', id: 'saldo-total', text: money(total) }),
      el('ul', { class: 'list', id: 'saldo-lokasi' }, D.LOCS.map(function (k) {
        return el('li', {}, el('span', { text: D.LOC_LABEL[k] }), el('strong', { id: 'saldo-' + k, text: money(st.locations[k]) }));
      })),
      st.unallocatedIncome > 0 ? el('p', { class: 'warn', id: 'unallocated', text: 'Pemasukan belum ditempatkan: ' + money(st.unallocatedIncome) + '. Angka ini belum termasuk Saldo Berjalan.' }) : null,
      el('div', { class: 'tiles' },
        tile('Nilai aset tercatat', money(assets.reduce(function (n, a) { return n + (Number(a.value) || 0); }, 0)), 'pos-assets'),
        tile('Sisa utang tercatat', money(debts.reduce(function (n, x) { return n + (Number(x.remaining) || 0); }, 0)), 'pos-debts')),
      tile('Kekayaan bersih tercatat', money(net), 'pos-net'),
      el('p', { class: 'hint', text: 'Saldo dihitung dari saldo awal per ' + d.open.snapshotDate + ' dan transaksi. Kekayaan bersih = saldo + aset − sisa utang.' }));

    var bulan = el('section', { class: 'card', 'aria-labelledby': 'h-bulan' },
      el('h2', { id: 'h-bulan', text: 'Bulan Ini' }),
      el('div', { class: 'tiles' },
        tile('Pemasukan', money(month.income), 'bln-income'),
        tile('Pengeluaran konsumsi', money(month.expense), 'bln-expense'),
        tile('Pembayaran utang', money(month.debtPayments), 'bln-debt'),
        tile('Savings Rate', sr.text, 'bln-savings', sr.note)),
      el('p', { class: 'hint', text: 'Savings Rate membandingkan pemasukan dan pengeluaran konsumsi yang tercatat. Pembayaran utang dan transfer internal tidak dihitung sebagai pengeluaran.' }));

    var insights = [];
    if (st.unallocatedIncome > 0) insights.push({
      title: 'Ada pemasukan yang belum ditempatkan',
      meaning: money(st.unallocatedIncome) + ' sudah tercatat sebagai pemasukan, tetapi belum masuk ke saldo Cash, Rekening, atau E-Wallet.',
      impact: 'Jumlah ini belum menambah Saldo Berjalan.',
      basis: 'Sisa pemasukan belum ditempatkan: ' + money(st.unallocatedIncome) + '.'
    });
    if (sr.state === 'noincome') insights.push({
      title: 'Savings Rate belum dapat dihitung',
      meaning: 'Belum ada pemasukan bulan ini yang tercatat.',
      impact: 'FinSight tidak menampilkan 0% karena itu dapat memberi arti yang keliru.',
      basis: 'Pemasukan ' + money(month.income) + '; pengeluaran konsumsi ' + money(month.expense) + '.'
    });
    else if (savingsLimited) insights.push({
      title: 'Data Savings Rate masih terbatas',
      meaning: 'Angka sementara hanya membandingkan catatan yang sudah dimasukkan, belum tentu mewakili seluruh aktivitas bulan ini.',
      impact: 'Nilainya bisa berubah ketika catatan dilengkapi.',
      basis: 'Pemasukan ' + money(month.income) + '; pengeluaran konsumsi ' + money(month.expense) + '; ' + relevantCount + ' catatan relevan; hari ke-' + dayOfMonth + '.'
    });
    if (debts.some(function (x) { return x.status === 'AKTIF' && x.mode === 'CICILAN' && x.installment > 0; })) {
      var inst = debts.filter(function (x) { return x.status === 'AKTIF' && x.mode === 'CICILAN'; }).reduce(function (n, x) { return n + (Number(x.installment) || 0); }, 0);
      insights.push({
        title: 'Saldo dan nominal cicilan bulanan',
        meaning: 'Saldo likuid saat ini ' + money(total) + '; nominal cicilan aktif per bulan ' + money(inst) + '.',
        impact: 'Ini perbandingan nominal, bukan proyeksi ketahanan saldo atau jaminan kemampuan membayar.',
        basis: money(total) + ' ÷ ' + money(inst) + (inst ? ' = ' + (total / inst).toFixed(2).replace('.', ',') + ' kali.' : '.')
      });
    }
    if (!insights.length) insights.push({
      title: 'Belum ada hal khusus yang perlu ditafsirkan',
      meaning: 'Angka utama mengikuti saldo dan transaksi yang sudah kamu catat.',
      impact: 'FinSight tidak membuat kesimpulan di luar data yang tersedia.',
      basis: 'Saldo likuid ' + money(total) + '; pemasukan bulan ini ' + money(month.income) + '; pengeluaran konsumsi ' + money(month.expense) + '.'
    });
    insights = insights.slice(0, 3);
    var memahami = el('section', { class: 'card', id: 'understanding', 'aria-labelledby': 'h-understanding' },
      el('h2', { id: 'h-understanding', text: 'Memahami Angkamu' }),
      insights.map(function (x) {
        return el('article', { class: 'card' },
          el('h3', { text: x.title }),
          el('p', {}, el('strong', { text: 'Arti. ' }), x.meaning),
          el('p', {}, el('strong', { text: 'Dampak. ' }), x.impact),
          el('p', { class: 'hint' }, el('strong', { text: 'Dasar. ' }), x.basis));
      }),
      el('p', { class: 'hint', text: 'Penjelasan dibentuk dari aturan tetap dan angka yang tercatat, bukan keputusan otomatis atau prediksi.' }));

    var detail = el('details', { class: 'card', id: 'detail-wrap' },
      el('summary', { text: 'Detail' }),
      el('div', { id: 'tracker-bottom' }),
      settingsCard(d, persistTxt));
    var main = el('main', { class: 'wrap', id: 'dashboard' },
      el('h1', { id: 'dash-title', text: 'FinSight Trial' }),
      d.rebuilt ? el('p', { class: 'warn', id: 'rebuilt-note', text: 'Data turunan aset dan utang dibangun ulang dari catatan transaksi.' }) : null,
      pos, bulan, memahami, detail);
    mount(main);
  }
  function settingsCard(d, persistTxt) {
    function catManage(kind, title) {
      var rows = kind === 'income' ? d.income : d.expense;
      return el('div', {}, el('h3', { text: title }), rows.length ? el('ul', { class: 'list', id: 'set-' + kind }, rows.map(function (c) {
        var inp = el('input', { type: 'text', value: c.nama, 'aria-label': 'Nama tampilan ' + c.key, maxlength: '160' });
        return el('li', {}, inp, el('button', { type: 'button', text: 'Simpan nama', onclick: function () { S.patchCategory(kind, c.key, { nama: inp.value }).then(loadDashboard).catch(function (e) { showMsg('set-msg', errText(e)); }); } }),
          el('button', { type: 'button', text: c.aktif === false ? 'Aktifkan' : 'Nonaktifkan', onclick: function () { S.patchCategory(kind, c.key, { aktif: c.aktif === false }).then(loadDashboard).catch(function (e) { showMsg('set-msg', errText(e)); }); } }));
      })) : el('p', { class: 'muted', text: 'Belum ada kategori.' }),
        catAdder(kind, function () { loadDashboardAfterAdd(); }, 'set-' + kind + '-new'));
    }
    var reset = el('div', { id: 'reset-area' }, el('button', { type: 'button', id: 'btn-reset', text: 'Mulai ulang trial', onclick: function () {
      var area = document.getElementById('reset-area'); area.replaceChildren(el('div', { class: 'warn', id: 'reset-confirm', role: 'alert' }, el('p', { text: 'Ini menghapus seluruh data trial di browser ini: kategori, saldo awal, aset, utang, dan transaksi. Tidak bisa dibatalkan.' }),
        el('button', { type: 'button', id: 'btn-reset-yes', class: 'primary', text: 'Ya, hapus semua data trial', onclick: function () { S.reset().then(function () { location.reload(); }).catch(function (e) { showMsg('set-msg', D.codeOf(e) === 'IDB_BLOCKED' || e.fsCode === 'IDB_BLOCKED' ? 'Tutup tab FinSight Trial lain lalu coba lagi.' : errText(e)); }); } }),
        el('button', { type: 'button', id: 'btn-reset-no', text: 'Batal', onclick: function () { loadDashboard(); } })));
    } }));
    return el('details', { class: 'card', id: 'settings' }, el('summary', { text: 'Pengaturan dan tentang data' }),
      el('h3', { text: 'Kategori' }), catManage('income', 'Pemasukan'), catManage('expense', 'Pengeluaran'), errBox('set-msg'),
      el('h3', { text: 'Saldo awal' }), el('p', { class: 'hint', text: 'Saldo awal sudah final di trial ini.' }),
      el('h3', { text: 'Tentang data trial' }), el('p', { text: 'Data tersimpan di browser dan perangkat ini saja. Tidak ada akun, sinkronisasi, atau koneksi ke sistem lain. Jika data browser dibersihkan, atau kamu pindah browser atau perangkat, data ini hilang.' }),
      el('p', { id: 'persist-note', class: 'hint', text: persistTxt }), reset);
  }
  function loadDashboardAfterAdd() { loadDashboard(); }
  function renderAnomaly() {
    mount(el('main', { class: 'wrap' }, el('h1', { text: 'Data trial perlu dipulihkan' }), el('p', { id: 'anomaly-msg', role: 'alert', class: 'warn', text: 'Isi penyimpanan di browser ini tidak konsisten (' + (A.reason || 'tidak diketahui') + '). Aplikasi tidak memperbaikinya diam-diam dan tidak menampilkan Dashboard.' }),
      el('div', { class: 'row tight' }, el('button', { type: 'button', text: 'Muat ulang', onclick: function () { location.reload(); } }),
        el('button', { type: 'button', id: 'btn-anomaly-reset', class: 'primary', text: 'Mulai ulang trial (hapus data)', onclick: function () { S.reset().then(function () { location.reload(); }).catch(function () { }); } }))));
  }

  boot();
})();
