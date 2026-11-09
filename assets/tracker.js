/* FinSight Trial — UI pasca-onboarding: Catat transaksi, Cashflow, Riwayat, Kelola aset & utang.
   Dimuat setelah app.js. Terhubung ke Dashboard lewat MutationObserver (app.js tidak diubah) dan menulis ledger lewat satu transaksi IndexedDB atomik.
   Teks pengguna selalu dirender sebagai teks (tanpa innerHTML). Berisi juga 2 perbaikan kecil (label "utang", peringatan isian W5 yang belum ditambahkan). */
(function () {
  'use strict';
  var D = window.FSDomain, S = window.FSStore, Lg = window.FSLedger, ROOT = document.getElementById('app');
  var T = { form: null, rid: null, flash: '', all: false, busy: false, injecting: false, v: 0, ctx: null };
  var chan = null; try { chan = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('finsight-trial') : null; } catch (e) { chan = null; }
  function el(tag, props) {
    var n = document.createElement(tag); props = props || {};
    Object.keys(props).forEach(function (k) { var v = props[k]; if (v == null || v === false) return; if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v); else if (v === true) n.setAttribute(k, ''); else n.setAttribute(k, v); });
    for (var i = 2; i < arguments.length; i++) add(n, arguments[i]);
    return n;
  }
  function add(n, c) { if (c == null || c === false) return; if (Array.isArray(c)) c.forEach(function (x) { add(n, x); }); else n.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c); }
  function v(id) { var n = document.getElementById(id); return n ? n.value : ''; }
  function rp(n) { return D.rupiah(n); }
  function byUrut(a, b) { return (a.urutan || 0) - (b.urutan || 0); }
  function active(l) { return (l || []).filter(function (c) { return c.aktif !== false; }); }

  /* ---------- baca & tulis ---------- */
  function readCtx() {
    return S.readAll().then(function (all) {
      var open = all.opening[0], ledger = Lg.sortSeq(all.ledger);
      return { all: all, open: open, ledger: ledger, st: Lg.replay(open, ledger), cats: { income: all.incomeCategories.sort(byUrut), expense: all.expenseCategories.sort(byUrut) } };
    });
  }
  /* Satu transaksi readwrite: baca saldo awal+ledger+kategori, validasi lewat engine, lalu tambah ledger+requests. Gagal di mana pun → tidak ada yang tertulis. */
  function append(spec) {
    return S.open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx, out = null, err = null, got = {}, names = ['opening', 'ledger', 'incomeCategories', 'expenseCategories', 'assets', 'debts'], left = names.length;
        try { tx = db.transaction(['opening', 'ledger', 'requests', 'incomeCategories', 'expenseCategories', 'assets', 'debts'], 'readwrite'); } catch (e) { return reject(e); }
        tx.oncomplete = function () { resolve(out); };
        tx.onabort = function () { reject(err || tx.error || new Error('TX_ABORTED')); };
        function bail(e) { err = err || e; try { tx.abort(); } catch (x) { reject(e); } }
        names.forEach(function (n) { var r = tx.objectStore(n).getAll(); r.onsuccess = function () { got[n] = r.result; if (--left === 0) go(); }; r.onerror = function () { bail(r.error); }; });
        function go() {
          try {
            if (!got.opening.length) throw new Error('OPENING_NOT_CONFIRMED');
            spec.cats = { income: got.incomeCategories, expense: got.expenseCategories };
            var ev = Lg.build(got.opening[0], got.ledger, spec, new Date());
            var createdAt = new Date().toISOString();
            tx.objectStore('ledger').add({ requestId: ev.requestId, type: ev.type, data: ev.data, result: ev.result, status: 'COMMITTED', createdAt: createdAt });
            if (ev.type === 'VOID') {
              var targetEvent = got.ledger.filter(function (x) { return x.requestId === ev.data.targetRequestId; })[0];
              if (!targetEvent) throw new Error('VOID_TARGET_NOT_FOUND');
              targetEvent.status = 'VOIDED'; targetEvent.voidReason = ev.data.reason;
              tx.objectStore('ledger').put(targetEvent);
            }
            tx.objectStore('requests').put({ requestId: ev.requestId, result: ev.result });

            // Ledger tetap sumber kebenaran. Perbarui proyeksi aset/utang di transaksi IDB yang sama.
            var beforeState = Lg.replay(got.opening[0], Lg.sortSeq(got.ledger));
            var nextLedger = got.ledger.slice();
            var nextSeq = nextLedger.reduce(function (m, x) { return Math.max(m, Number(x.seq) || 0); }, 0) + 1;
            nextLedger.push({ seq: nextSeq, requestId: ev.requestId, type: ev.type, data: ev.data, result: ev.result, status: 'COMMITTED', createdAt: createdAt });
            var afterState = Lg.replay(got.opening[0], Lg.sortSeq(nextLedger));
            var assetStore = tx.objectStore('assets'), debtStore = tx.objectStore('debts');
            assetStore.clear(); debtStore.clear();
            Object.keys(afterState.assets).forEach(function (id) {
              var a = afterState.assets[id];
              assetStore.put({ assetId: id, name: a.name, value: a.value, contribution: a.contribution });
            });
            Object.keys(afterState.debts).forEach(function (id) {
              var d = afterState.debts[id];
              debtStore.put({ debtId: id, name: d.name, principal: d.principal, remaining: d.remaining, mode: d.mode, installment: d.installment, status: d.status });
            });
            out = { event: ev, before: beforeState, after: afterState };
          } catch (e) { bail(e); }
        }
      });
    });
  }
  function errText(e) {
    var c = D.codeOf(e); if (e && e.name === 'ConstraintError') return 'Catatan ini sudah tersimpan sebelumnya.';
    if (D.MESSAGES[c]) return D.MESSAGES[c]; if (c === 'OPENING_NOT_CONFIRMED') return 'Saldo awal belum ada.';
    return 'Tidak dapat menyimpan (' + c + '). Perubahan belum tersimpan.';
  }

  /* ---------- field ---------- */
  function money(id, label, val, hint) { return el('div', {}, el('label', { for: id, text: label }), el('input', { type: 'text', inputmode: 'numeric', id: id, autocomplete: 'off', value: val == null ? '' : String(val) }), hint ? el('p', { class: 'hint', text: hint }) : null); }
  function text(id, label, hint) { return el('div', {}, el('label', { for: id, text: label }), el('input', { type: 'text', id: id, maxlength: '160', autocomplete: 'off' }), hint ? el('p', { class: 'hint', text: hint }) : null); }
  function sel(id, label, opts, val) { var s = el('select', { id: id }); opts.forEach(function (o) { s.appendChild(el('option', { value: o[0], text: o[1], selected: String(o[0]) === String(val), disabled: o[2] === true })); }); return el('div', {}, el('label', { for: id, text: label }), s); }
  function dateF(c) { return el('div', {}, el('label', { for: 'f-date', text: 'Tanggal' }), el('input', { type: 'date', id: 'f-date', value: D.todayStr(), min: c.open.snapshotDate, max: D.todayStr() })); }
  function noteF() { return el('div', {}, el('label', { for: 'f-note', text: 'Catatan (opsional)' }), el('input', { type: 'text', id: 'f-note', maxlength: '300', autocomplete: 'off' })); }
  function locOpts(c, bal) { return D.LOCS.map(function (k) { return [k, D.LOC_LABEL[k] + (bal ? ' (saldo ' + rp(c.st.locations[k]) + ')' : ''), bal && c.st.locations[k] <= 0]; }); }
  function firstOk(c) { return D.LOCS.filter(function (k) { return c.st.locations[k] > 0; })[0] || 'CASH'; }
  function assetOpts(c) { return Object.keys(c.st.assets).map(function (id) { return [id, c.st.assets[id].name + ' (' + rp(c.st.assets[id].value) + ')']; }); }
  function debtOpts(c) { return Object.keys(c.st.debts).filter(function (id) { return c.st.debts[id].status === 'AKTIF'; }).map(function (id) { return [id, c.st.debts[id].name + ' · sisa ' + rp(c.st.debts[id].remaining)]; }); }
  function notice(t) { return el('p', { class: 'warn', role: 'status', text: t }); }
  var COMMON = function () { return { transactionDate: v('f-date'), note: v('f-note') }; };
  function withCommon(o) { var k = COMMON(); o.transactionDate = k.transactionDate; o.note = k.note; return o; }

  /* ---------- definisi form ---------- */
  var FORMS = {
    INCOME: { title: 'Catat pemasukan', build: function (c) {
      var cats = active(c.cats.income); if (!cats.length) return [notice('Belum ada kategori pemasukan. Tambahkan di Pengaturan, lalu kembali ke sini.')];
      return [money('f-amount', 'Nominal pemasukan'), sel('f-source', 'Sumber', cats.map(function (x) { return [x.key, x.nama]; })), dateF(c), noteF(),
        el('h3', { text: 'Tempatkan uangnya (opsional)' }), el('p', { class: 'hint', text: 'Boleh sebagian atau dikosongkan. Sisanya tercatat "belum dialokasikan" dan bisa ditempatkan nanti; total alokasi tidak menggandakan pemasukan.' })]
        .concat(D.LOCS.map(function (k) { return money('al-' + k, 'Ke ' + D.LOC_LABEL[k], ''); }));
    }, collect: function () { var al = {}; D.LOCS.forEach(function (k) { al[k] = v('al-' + k); }); return withCommon({ amount: v('f-amount'), source: v('f-source'), allocations: al }); } },
    EXPENSE: { title: 'Catat pengeluaran', build: function (c) {
      var cats = active(c.cats.expense); if (!cats.length) return [notice('Belum ada kategori pengeluaran. Tambahkan di Pengaturan, lalu kembali ke sini.')];
      var cat = sel('f-cat', 'Kategori', cats.map(function (x) { return [x.key, x.nama]; })), sub = sel('f-sub', 'Klasifikasi', D.KLASIFIKASI.map(function (k) { return [k, k]; }));
      function sync() { var x = cats.filter(function (y) { return y.key === cat.querySelector('select').value; })[0]; if (x) sub.querySelector('select').value = x.klasifikasi; } cat.querySelector('select').addEventListener('change', sync); setTimeout(sync, 0);
      return [money('f-amount', 'Nominal pengeluaran'), sel('f-loc', 'Dari mana uangnya', locOpts(c, true), firstOk(c)), cat, sub, dateF(c), noteF()];
    }, collect: function () { return withCommon({ amount: v('f-amount'), locationId: v('f-loc'), category: v('f-cat'), subCategory: v('f-sub') }); } },
    DEBT_PAYMENT: { title: 'Bayar utang', build: function (c, p) {
      var o = debtOpts(c); if (!o.length) return [notice('Tidak ada utang aktif. Catat utang dulu di "Aset dan utang".')];
      var d = p && p.debtId && c.st.debts[p.debtId], pre = d && d.mode === 'CICILAN' ? Math.min(d.installment, d.remaining) : '';
      return [sel('f-debt', 'Utang', o, p && p.debtId), money('f-amount', 'Jumlah dibayar', pre), sel('f-loc', 'Dibayar dari', locOpts(c, true), firstOk(c)), dateF(c), noteF(), el('p', { class: 'hint', text: 'Bayar utang mengurangi saldo dan sisa utang, tetapi bukan pengeluaran dan tidak menurunkan Savings Rate.' })];
    }, collect: function () { return withCommon({ debtId: v('f-debt'), amount: v('f-amount'), locationId: v('f-loc') }); } },
    TRANSFER: { title: 'Pindah uang antar lokasi', build: function (c) {
      return [sel('f-from', 'Dari', locOpts(c, true), firstOk(c)), sel('f-to', 'Ke', locOpts(c, false), D.LOCS.filter(function (k) { return k !== firstOk(c); })[0]), money('f-amount', 'Jumlah'), dateF(c), noteF(), el('p', { class: 'hint', text: 'Pindah uang bukan pemasukan dan bukan pengeluaran.' })];
    }, collect: function () { return withCommon({ from: v('f-from'), to: v('f-to'), amount: v('f-amount') }); } },
    ALLOCATE_INCOME: { title: 'Tempatkan sisa pemasukan', build: function (c) {
      var u = c.st.unallocatedIncome; if (!(u > 0)) return [notice('Tidak ada pemasukan yang belum dialokasikan.')];
      return [el('p', { class: 'hint', text: 'Belum dialokasikan: ' + rp(u) + '. Menempatkannya memindahkan ke saldo lokasi, bukan pemasukan baru.' }), sel('f-loc', 'Ke lokasi', locOpts(c, false), 'REKENING'), money('f-amount', 'Jumlah', u), dateF(c), noteF()];
    }, collect: function () { return withCommon({ locationId: v('f-loc'), amount: v('f-amount') }); } },
    DCA: { title: 'Setor ke aset', build: function (c, p) {
      var o = assetOpts(c); if (!o.length) return [notice('Belum ada aset. Tambahkan aset terlebih dahulu, lalu gunakan Setor untuk memindahkan saldo ke aset.'), el('button', { type: 'button', text: '+ Tambah aset', onclick: function () { openForm('OPEN_ASSET'); } })];
      return [sel('f-asset', 'Aset', o, p && p.assetId), money('f-amount', 'Jumlah setoran'), sel('f-from', 'Dari lokasi', locOpts(c, true), firstOk(c)), dateF(c), noteF(), el('p', { class: 'hint', text: 'Uang pindah dari saldo ke aset (nilai dan total setoran naik). Bukan pengeluaran.' })];
    }, collect: function () { return withCommon({ assetId: v('f-asset'), amount: v('f-amount'), from: v('f-from') }); } },
    WD: { title: 'Tarik dari aset', build: function (c, p) {
      var o = assetOpts(c); if (!o.length) return [notice('Belum ada aset. Tambahkan aset terlebih dahulu sebelum melakukan penarikan.'), el('button', { type: 'button', text: '+ Tambah aset', onclick: function () { openForm('OPEN_ASSET'); } })];
      return [sel('f-asset', 'Aset', o, p && p.assetId), money('f-amount', 'Jumlah penarikan'), sel('f-to', 'Ke lokasi', locOpts(c, false), 'REKENING'), dateF(c), noteF(), el('p', { class: 'hint', text: 'Penarikan memindahkan nilai aset ke saldo. Bukan pemasukan.' })];
    }, collect: function () { return withCommon({ assetId: v('f-asset'), amount: v('f-amount'), to: v('f-to') }); } },
    VOID: { title: 'Batalkan catatan transaksi', build: function (c, p) {
      var target = (c.ledger || []).filter(function (e) { return e.requestId === (p && p.targetRequestId); })[0];
      if (!target) return [notice('Catatan yang akan dibatalkan tidak ditemukan. Muat ulang Riwayat lalu coba lagi.')];
      var d = Lg.describe(target, c.st);
      return [el('p', { text: d.title + (d.amount ? ' · ' + rp(d.amount) : '') }),
        el('p', { class: 'warn', text: 'Dampak catatan ini akan dibalik dari saldo, aset, utang, dan ringkasan terkait. Jejak pembatalan tetap disimpan di Riwayat.' }),
        el('label', { for: 'f-void-reason', text: 'Alasan pembatalan' }),
        el('textarea', { id: 'f-void-reason', maxlength: '300', rows: '3' }),
        el('p', { class: 'hint', text: 'Minimal 3 karakter. Demi menjaga urutan saldo, hanya transaksi terakhir yang bisa dibatalkan.' })];
    }, collect: function () { return { targetRequestId: T.form.preset.targetRequestId, reason: v('f-void-reason') }; } },
    REVALUE_ASSET: { title: 'Perbarui nilai aset', build: function (c, p) {
      var o = assetOpts(c); if (!o.length) return [notice('Belum ada aset.')];
      return [sel('f-asset', 'Aset', o, p && p.assetId), money('f-value', 'Nilai terbaru', p && p.assetId ? c.st.assets[p.assetId].value : ''), dateF(c), noteF(), el('p', { class: 'hint', text: 'Hanya memperbarui nilai catatan. Tidak mengubah saldo dan tidak dihitung pemasukan atau pengeluaran.' })];
    }, collect: function () { return withCommon({ assetId: v('f-asset'), value: v('f-value') }); } },
    OPEN_ASSET: { title: 'Tambah aset', build: function (c) {
      return [text('f-name', 'Nama aset'), money('f-value', 'Nilai tercatat sekarang'), money('f-contrib', 'Total setoran'), dateF(c), el('p', { class: 'hint', text: 'Hanya mencatat aset yang sudah ada; saldo tidak berubah. Untuk memindahkan uang dari saldo ke aset, pakai "Setor".' })];
    }, collect: function () { return { name: v('f-name'), value: v('f-value'), contribution: v('f-contrib'), transactionDate: v('f-date') }; } },
    OPEN_DEBT: { title: 'Tambah utang', build: function (c) {
      var mode = sel('f-mode', 'Cara bayar', [['', 'Pilih cara bayar'], ['CICILAN', 'Cicilan'], ['TUNAI', 'Tunai']]), inst = el('div', { id: 'f-inst-wrap', hidden: true }, money('f-inst', 'Cicilan per bulan'));
      mode.querySelector('select').addEventListener('change', function () { inst.hidden = v('f-mode') !== 'CICILAN'; });
      return [text('f-name', 'Nama utang'), money('f-principal', 'Total awal utang'), money('f-remaining', 'Sisa utang sekarang', '', 'Isi 0 bila sudah lunas.'), mode, inst, dateF(c), el('p', { class: 'hint', text: 'Mencatat utang yang sudah ada; bukan pengeluaran dan tidak mengubah saldo.' })];
    }, collect: function () { return { name: v('f-name'), principal: v('f-principal'), remaining: v('f-remaining'), mode: v('f-mode'), installment: v('f-inst'), transactionDate: v('f-date') }; } }
  };
  function openForm(kind, preset) {
    T.form = { kind: kind, preset: preset || null }; T.rid = D.newRequestId(); T.flash = ''; var box = document.getElementById('tr-form'); if (!box) return;
    var def = FORMS[kind], nodes = def.build(T.ctx, preset), blocked = nodes.some(function (n) { return n && n.className === 'warn'; }), ok = !blocked;
    box.replaceChildren(el('div', { class: 'card', id: 'form-' + kind }, el('h3', { text: def.title }), nodes, el('div', { id: 'tr-msg', role: 'alert', 'aria-live': 'assertive' }),
      el('div', { class: 'row tight' }, ok ? el('button', { type: 'button', class: 'primary', id: 'tr-save', text: 'Simpan', onclick: submit }) : null, el('button', { type: 'button', id: 'tr-cancel', text: 'Batal', onclick: function () { T.form = null; box.replaceChildren(); } }))));
    var top = document.getElementById('tracker-top'); if (top && top.scrollIntoView) top.scrollIntoView({ block: 'start' });
    var f = box.querySelector('input,select'); if (f) f.focus({ preventScroll: true });
  }
  function showMsg(t) { var b = document.getElementById('tr-msg'); if (b) b.replaceChildren(t ? el('p', { class: 'err', text: t }) : ''); }
  function contributionTotal(state) {
    return Object.keys(state.assets || {}).reduce(function (sum, id) {
      return sum + (Number(state.assets[id].contribution) || 0);
    }, 0);
  }
  function submit() {
    if (T.busy || !T.form) return; var btn = document.getElementById('tr-save'), kind = T.form.kind, def = FORMS[kind];
    if (kind === 'VOID' && !window.confirm('Batalkan catatan ini? Dampak keuangan akan dibalik, tetapi jejak transaksi dan alasan pembatalan tetap tersimpan.')) return;
    T.busy = true; if (btn) btn.disabled = true; showMsg('');
    append({ kind: kind, form: def.collect(), requestId: T.rid }).then(function (saved) {
      var ev = saved.event, d = Lg.describe(ev, saved.after);
      var before = Lg.netWorth(saved.before), after = Lg.netWorth(saved.after);
      var locationChanges = D.LOCS.map(function (id) {
        var delta = saved.after.locations[id] - saved.before.locations[id];
        return delta ? D.LOC_LABEL[id] + ' ' + signed(delta) : null;
      }).filter(Boolean);
      var changed = [
        'Saldo likuid total: ' + signed(after.liquid - before.liquid),
        'Nilai aset: ' + signed(after.assets - before.assets),
        'Total setoran aset: ' + signed(contributionTotal(saved.after) - contributionTotal(saved.before)),
        'Sisa utang: ' + signed(after.debts - before.debts),
        'Kekayaan bersih tercatat: ' + signed(after.net - before.net)
      ].filter(function (x) { return !/Rp 0$/.test(x); });
      if (locationChanges.length) changed.unshift('Perubahan lokasi: ' + locationChanges.join(' · '));
      T.busy = false;
      T.flash = {
        recorded: d.title + (d.amount ? ' · ' + rp(d.amount) : '') + '.',
        changed: changed,
        unchanged: ev.type === 'DEBT_PAYMENT' ? ['Pembayaran utang bukan pengeluaran konsumsi.', 'Savings Rate tidak dikurangi oleh pembayaran utang.'] :
          (ev.type === 'TRANSFER' || ev.type === 'DCA' || ev.type === 'WD' ? ['Bukan pemasukan atau pengeluaran konsumsi.'] : [])
      };
      T.form = null; refresh();
    }).catch(function (e) { T.busy = false; if (btn) btn.disabled = false; showMsg(errText(e)); });
  }
  /* Minta app.js memuat ulang Dashboard lewat kanal yang sama (pesan dari objek BroadcastChannel lain di halaman ini tetap diterima). Cadangan: muat ulang halaman. */
  function refresh() {
    var pending = String(T.v); if (chan) { try { chan.postMessage({ kind: 'commit', at: Date.now() }); } catch (e) { location.reload(); return; } } else { location.reload(); return; }
    setTimeout(function () { var t = document.getElementById('tracker-top'); if (t && t.getAttribute('data-v') === pending) location.reload(); }, 1500);
  }

  /* ---------- tampilan ---------- */
  function renderTop(c) {
    var btns = [['INCOME', '+ Pemasukan'], ['EXPENSE', '− Pengeluaran'], ['DEBT_PAYMENT', 'Bayar utang'], ['TRANSFER', 'Pindah uang'], ['DCA', 'Setor ke aset'], ['WD', 'Tarik dari aset']]; if (!Object.keys(c.st.assets).length) btns.push(['OPEN_ASSET', '+ Tambah aset']); if (c.st.unallocatedIncome > 0) btns.push(['ALLOCATE_INCOME', 'Tempatkan sisa pemasukan']);
    var f = T.flash; T.flash = '';
    var receipt = f ? el('div', { class: 'okbox', id: 'tr-flash', role: 'status' },
      el('strong', { text: 'Dicatat' }), el('p', { text: f.recorded }),
      el('strong', { text: 'Yang berubah' }), f.changed.length ? el('ul', {}, f.changed.map(function (x) { return el('li', { text: x }); })) : el('p', { text: 'Tidak ada perubahan pada saldo, aset, utang, atau kekayaan bersih tercatat.' }),
      el('strong', { text: 'Yang tidak berubah' }), f.unchanged.length ? el('ul', {}, f.unchanged.map(function (x) { return el('li', { text: x }); })) : el('p', { text: 'Tidak ada keterangan tambahan.' }),
      el('button', { type: 'button', text: 'Tutup', onclick: function () { var n = document.getElementById('tr-flash'); if (n) n.remove(); } })) : null;
    return el('section', { class: 'card', id: 'tracker-top', 'data-v': String(T.v), 'aria-labelledby': 'h-catat' }, el('h2', { id: 'h-catat', text: 'Catat' }), receipt,
      el('div', { class: 'tiles' }, btns.map(function (b) { return el('button', { type: 'button', id: 'btn-' + b[0], text: b[1], onclick: function () { openForm(b[0]); } }); })), el('div', { id: 'tr-form' }));
  }
  function signed(n) { return (n < 0 ? '−' : n > 0 ? '+' : '') + rp(Math.abs(n)); }
  function cashflowCard(c) {
    var rows = Lg.cashflow(c.ledger, new Date(), 6).filter(function (r, i) { return i === 0 || r.income || r.expense || r.debtPayments; });
    return el('section', { class: 'card', id: 'cashflow-card', 'aria-labelledby': 'h-cf' }, el('h2', { id: 'h-cf', text: 'Cashflow per bulan' }),
      el('ul', { class: 'list' }, rows.map(function (r) { return el('li', {}, el('div', {}, el('strong', { text: r.label }), el('div', { class: 'hint', text: 'Masuk ' + rp(r.income) + ' · Keluar ' + rp(r.expense) + ' · Bayar utang ' + rp(r.debtPayments) })), el('strong', { text: signed(r.net) })); })),
      el('p', { class: 'hint', text: 'Selisih = pemasukan − pengeluaran. Bayar utang, setor aset, dan pindah uang tidak dihitung sebagai pengeluaran.' }));
  }
  function historyCard(c) {
    var all = c.ledger.slice().reverse(), shown = T.all ? all : all.slice(0, 15);
    var stateEvents = c.st.ledger || [], latest = stateEvents.filter(function (e) { return e.type !== 'VOID' && e.status === 'COMMITTED'; }).slice(-1)[0];
    var ul = el('ul', { class: 'list hist', id: 'hist-list' }, shown.map(function (e) {
      var d = Lg.describe(e, c.st), stateEvent = stateEvents.filter(function (x) { return x.requestId === e.requestId; })[0];
      var status = stateEvent ? stateEvent.status : e.status;
      var detail = d.detail + (status === 'VOIDED' ? ' · DIBATALKAN' : '');
      var info = el('div', {}, el('strong', { text: d.title }), el('div', { class: 'hint', text: detail }), el('div', { class: 'hint', text: Lg.evDate(e) + (e.data && e.data.note ? ' · ' + e.data.note : '') }));
      var amount = el('span', { class: 'amt' + (d.sign === '+' ? ' pos' : ''), text: (d.sign === '-' ? '−' : d.sign) + rp(d.amount) });
      var actions = status === 'COMMITTED' && latest && latest.requestId === e.requestId && e.type !== 'VOID'
        ? el('div', { class: 'acts' }, el('button', { type: 'button', text: 'Batalkan catatan', 'aria-label': 'Batalkan ' + d.title, onclick: function () { openForm('VOID', { targetRequestId: e.requestId }); } }))
        : null;
      return el('li', {}, info, amount, actions);
    }));
    return el('section', { class: 'card', id: 'history-card', 'aria-labelledby': 'h-hist' }, el('h2', { id: 'h-hist', text: 'Riwayat transaksi' }), all.length ? ul : el('p', { class: 'muted', text: 'Belum ada catatan.' }),
      el('p', { class: 'hint', text: 'Pembatalan tidak menghapus jejak. Catatan yang dibatalkan tetap terlihat dan tidak lagi dihitung dalam saldo atau ringkasan.' }),
      all.length > 15 ? el('button', { type: 'button', id: 'hist-toggle', text: T.all ? 'Tampilkan lebih sedikit' : 'Tampilkan semua (' + all.length + ')', onclick: function () { T.all = !T.all; renderBottom(); } }) : null);
  }
  function manageCard(c) {
    var nw = Lg.netWorth(c.st), A = Object.keys(c.st.assets), B = Object.keys(c.st.debts);
    return el('section', { class: 'card', id: 'manage-card', 'aria-labelledby': 'h-kelola' }, el('h2', { id: 'h-kelola', text: 'Kelola aset dan utang' }),
      el('ul', { class: 'list', id: 'networth' }, [['Saldo di Cash, Rekening, E-Wallet', nw.liquid], ['Nilai aset tercatat', nw.assets], ['Sisa utang tercatat', -nw.debts], ['Kekayaan bersih tercatat', nw.net]].map(function (r, i) { return el('li', {}, el('span', { text: r[0] }), el(i === 3 ? 'strong' : 'span', { text: signed(r[1]).replace('+', '') })); })),
      el('p', { class: 'hint', text: 'Dihitung dari yang kamu catat, bukan perkiraan atau prediksi. Nilai aset tidak menambah saldo.' }),
      el('h3', { text: 'Aset' }), A.length ? el('ul', { class: 'list' }, A.map(function (id) { var a = c.st.assets[id]; return el('li', {}, el('span', { text: a.name + ' · setoran ' + rp(a.contribution) }), el('strong', { text: rp(a.value) }),
        el('div', { class: 'acts' }, el('button', { type: 'button', text: 'Perbarui nilai', onclick: function () { openForm('REVALUE_ASSET', { assetId: id }); } }), el('button', { type: 'button', text: 'Setor', onclick: function () { openForm('DCA', { assetId: id }); } }), el('button', { type: 'button', text: 'Tarik', onclick: function () { openForm('WD', { assetId: id }); } }))); })) : el('p', { class: 'muted', text: 'Belum ada aset.' }),
      el('h3', { text: 'Utang' }), B.length ? el('ul', { class: 'list' }, B.map(function (id) { var d = c.st.debts[id]; return el('li', {}, el('span', { text: d.name + ' · ' + (d.mode === 'CICILAN' ? 'cicilan ' + rp(d.installment) : 'tunai') + ' · ' + (d.status === 'LUNAS' ? 'lunas' : 'aktif') }), el('strong', { text: 'sisa ' + rp(d.remaining) }),
        d.status === 'AKTIF' ? el('div', { class: 'acts' }, el('button', { type: 'button', text: 'Bayar', onclick: function () { openForm('DEBT_PAYMENT', { debtId: id }); } })) : null); })) : el('p', { class: 'muted', text: 'Belum ada utang.' }),
      el('div', { class: 'row tight' }, el('button', { type: 'button', id: 'btn-OPEN_ASSET', text: 'Tambah aset', onclick: function () { openForm('OPEN_ASSET'); } }), el('button', { type: 'button', id: 'btn-OPEN_DEBT', text: 'Tambah utang', onclick: function () { openForm('OPEN_DEBT'); } })));
  }
  function renderBottom() { var b = document.getElementById('tracker-bottom'); if (b && T.ctx) b.replaceChildren(cashflowCard(T.ctx), historyCard(T.ctx), manageCard(T.ctx)); }
  function inject() {
    if (T.injecting) return; T.injecting = true;
    readCtx().then(function (c) {
      var main = document.getElementById('dashboard'); if (!main || document.getElementById('tracker-top')) return;
      T.ctx = c; T.v++; var saldo = main.querySelector('section[aria-labelledby="h-saldo"]'), top = renderTop(c);
      if (saldo && saldo.nextSibling) main.insertBefore(top, saldo.nextSibling); else main.appendChild(top);
      // Dashboard menyediakan wadah Detail agar cashflow, riwayat, dan kelola tidak memenuhi layar utama.
      if (!document.getElementById('tracker-bottom')) {
        var detail = document.getElementById('detail-wrap');
        var bottom = el('div', { id: 'tracker-bottom' });
        if (detail) detail.appendChild(bottom); else main.appendChild(bottom);
      }
      renderBottom();
      Array.prototype.forEach.call(main.querySelectorAll('.tile small'), function (n) { if (n.textContent === 'Bayar hutang') n.textContent = 'Bayar utang'; });
    }).catch(function () { }).then(function () { T.injecting = false; });
  }
  new MutationObserver(function () { if (document.getElementById('dashboard') && !document.getElementById('tracker-top')) inject(); }).observe(ROOT, { childList: true });
  if (document.getElementById('dashboard')) inject();

  /* Perbaikan W5: isian aset/utang yang belum ditekan "Tambah" tidak ikut tersimpan. Klik Lanjut pertama memperingatkan; klik kedua melanjutkan. */
  document.addEventListener('click', function (ev) {
    var b = ev.target && ev.target.closest && ev.target.closest('#btn-next'); if (!b || (!document.getElementById('db-name') && !document.getElementById('as-name'))) return;
    if (b.getAttribute('data-warned') === '1') return;
    var pend = ['db-name', 'db-principal', 'db-remaining', 'as-name', 'as-value', 'as-contrib'].some(function (id) { var n = document.getElementById(id); return n && n.value.trim() !== ''; });
    if (!pend) return;
    ev.preventDefault(); ev.stopImmediatePropagation(); b.setAttribute('data-warned', '1');
    var box = document.getElementById('msg'); if (box) box.replaceChildren(el('p', { class: 'warn', id: 'w5-pending', text: 'Ada isian aset atau utang yang belum ditambahkan, jadi belum tersimpan. Tekan "Tambah aset" atau "Tambah utang" dulu. Kalau memang ingin lanjut tanpa itu, tekan Lanjut sekali lagi.' }));
  }, true);
})();
