/* FinSight Trial — domain layer (pure logic, no storage, no DOM).
   Memakai engine VNext yang disematkan byte-identik (assets/engine/FinSightVNextEngine.js).
   Kontrak: Spec v2.1. Dimuat di browser (global FSDomain) dan di Node vm (tes parity). */
(function (root) {
  'use strict';
  var LOCS = ['CASH', 'REKENING', 'E_WALLET'];
  var LOC_LABEL = { CASH: 'Cash', REKENING: 'Rekening', E_WALLET: 'E-Wallet' };
  var INCOME_TYPES = { fixed: 'Tetap', fixed_variable_date: 'Tetap, tanggal berubah', recurring_session: 'Per sesi', irregular: 'Tidak tentu' };
  var KLASIFIKASI = ['Kebutuhan', 'Keinginan'];
  /* Saran generik (Spec v2 §6.1): tidak ada yang terpilih otomatis; jenis/klasifikasi hanya usulan yang bisa diubah (D2). */
  var SUGGEST_INCOME = [
    { nama: 'Gaji', tipe: 'fixed' }, { nama: 'Usaha/Jualan', tipe: 'irregular' }, { nama: 'Honor/Proyek', tipe: 'irregular' },
    { nama: 'Bonus/THR', tipe: 'irregular' }, { nama: 'Kiriman/Bantuan', tipe: 'irregular' }];
  var SUGGEST_EXPENSE = [
    { nama: 'Makan & Kebutuhan Harian', klasifikasi: 'Kebutuhan' }, { nama: 'Tagihan & Rumah', klasifikasi: 'Kebutuhan' },
    { nama: 'Transportasi', klasifikasi: 'Kebutuhan' }, { nama: 'Kesehatan', klasifikasi: 'Kebutuhan' },
    { nama: 'Pendidikan', klasifikasi: 'Kebutuhan' }, { nama: 'Belanja', klasifikasi: 'Keinginan' },
    { nama: 'Hiburan', klasifikasi: 'Keinginan' }, { nama: 'Lainnya', klasifikasi: 'Keinginan' }];

  var MESSAGES = {
    AMOUNT_INVALID: 'Nominal harus bilangan bulat lebih dari 0.',
    ALLOCATION_INVALID: 'Alokasi harus bilangan bulat lebih dari 0 (kosongkan lokasi yang tidak dipakai).',
    ALLOCATION_EXCEEDS_INCOME: 'Total alokasi tidak boleh lebih besar dari pemasukan.',
    VALUE_INVALID: 'Nilai harus bilangan bulat 0 atau lebih.',
    CONTRIBUTION_INVALID: 'Total setoran harus bilangan bulat 0 atau lebih.',
    PRINCIPAL_INVALID: 'Total awal utang harus bilangan bulat lebih dari 0.',
    REMAINING_INVALID: 'Sisa utang harus bilangan bulat 0 atau lebih.',
    INSTALLMENT_INVALID: 'Cicilan per bulan harus bilangan bulat lebih dari 0.',
    DEBT_REMAINING_EXCEEDS_PRINCIPAL: 'Sisa utang tidak boleh lebih besar dari total awal.',
    DEBT_MODE_INVALID: 'Pilih cara bayar: Cicilan atau Tunai.',
    CASH_DEBT_MUST_NOT_HAVE_INSTALLMENT: 'Utang tunai tidak memakai cicilan.',
    NAME_INVALID: 'Nama wajib diisi (maksimal 160 karakter).',
    NAME_DUPLICATE: 'Nama ini sudah ada.',
    LOCATION_INVALID: 'Pilih lokasi uang.',
    INSUFFICIENT_LOCATION_BALANCE: 'Saldo lokasi ini tidak cukup untuk pengeluaran tersebut.',
    TRANSACTION_DATE_INVALID: 'Tanggal tidak valid.',
    TRANSACTION_BEFORE_SNAPSHOT: 'Tanggal tidak boleh sebelum tanggal saldo awal.',
    TRANSACTION_IN_FUTURE: 'Tanggal tidak boleh di masa depan.',
    OPENING_INVALID: 'Isi ketiga saldo (boleh 0).',
    OPENING_DATE_INVALID: 'Tanggal saldo awal tidak valid.',
    OPENING_DATE_IN_FUTURE: 'Tanggal saldo awal tidak boleh di masa depan.',
    SOURCE_INVALID: 'Pilih sumber pemasukan.',
    CATEGORY_INVALID: 'Pilih kategori pengeluaran.'
  };
  function codeOf(e) { var m = String((e && e.message) || e || ''); var c = m.split(':')[0].trim(); return c; }
  function humanError(e) { var c = codeOf(e); return MESSAGES[c] || ('Tidak dapat diproses (' + c + ').'); }
  function fail(code) { throw new Error(code); }

  /* parseMoney: menerima "1.000.000" / "1000000" / " 25 000 ". Desimal, minus, huruf → null. */
  function parseMoney(s) {
    if (typeof s === 'number') return Number.isSafeInteger(s) ? s : null;
    var t = String(s == null ? '' : s).trim().replace(/[\s.]/g, '');
    if (t === '' || !/^\d+$/.test(t)) return null;
    var n = Number(t); return Number.isSafeInteger(n) ? n : null;
  }
  function strictInt(v, label, zeroOk) {
    var n = parseMoney(v);
    if (n === null || (zeroOk ? n < 0 : n <= 0)) fail(label + '_INVALID');
    return n;
  }
  function cleanName(v, label) { var s = String(v == null ? '' : v).trim(); if (!s || s.length > 160) fail((label || 'NAME') + '_INVALID'); return s; }
  function normName(s) { return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase(); }
  function isIsoDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s; }
  function todayStr(d) { d = d || new Date(); var p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
  function newId(prefix) {
    var c = (root.crypto || {}), a = new Uint8Array(12), s = '';
    if (c.getRandomValues) c.getRandomValues(a); else for (var i = 0; i < 12; i++) a[i] = Math.floor(Math.random() * 256);
    var al = 'abcdefghijklmnopqrstuvwxyz0123456789';
    for (var j = 0; j < a.length; j++) s += al[a[j] % al.length];
    return prefix + '_' + s;
  }
  var newRequestId = function () { return newId('vnext'); }; // pola produksi: /^vnext_[A-Za-z0-9_-]{8,64}$/

  /* ---------- kategori (konfigurasi; bukan ledger) ---------- */
  function validateCategoryInput(kind, input, existing) {
    var nama = cleanName(input && input.nama, 'NAME');
    var n = normName(nama);
    (existing || []).forEach(function (c) { if (normName(c.nama) === n || normName(c.key) === n) { var e = new Error('NAME_DUPLICATE'); e.existing = c; throw e; } });
    if (kind === 'income') { var t = input.tipe; if (!INCOME_TYPES[t]) fail('TIPE_INVALID'); return { key: nama, nama: nama, tipe: t, aktif: true }; }
    var k = input.klasifikasi; if (KLASIFIKASI.indexOf(k) < 0) fail('KLASIFIKASI_INVALID');
    return { key: nama, nama: nama, klasifikasi: k, aktif: true };
  }
  /* D3: soft hint, tidak memblokir */
  function cicilanHint(nama) { return /cicil|angsur|utang|hutang/i.test(String(nama || '')); }

  /* ---------- saldo awal (draft) ---------- */
  function validateOpening(o, now) {
    var out = {};
    LOCS.forEach(function (k) {
      var raw = o ? o[k] : null; if (raw === '' || raw == null) fail('OPENING_INVALID');
      var n = parseMoney(raw); if (n === null || n < 0) fail('OPENING_INVALID'); out[k] = n;
    });
    var d = String((o && o.snapshotDate) || ''); if (!isIsoDate(d)) fail('OPENING_DATE_INVALID');
    if (d > todayStr(now)) fail('OPENING_DATE_IN_FUTURE');
    out.snapshotDate = d; return out;
  }

  /* ---------- aset & utang (draft W5) ---------- */
  function validateAsset(a) {
    return { name: cleanName(a.name, 'NAME'), value: strictInt(a.value, 'VALUE', true), contribution: strictInt(a.contribution, 'CONTRIBUTION', true) };
  }
  function validateDebt(d) {
    var name = cleanName(d.name, 'NAME');
    var principal = strictInt(d.principal, 'PRINCIPAL', false);
    var remaining = strictInt(d.remaining, 'REMAINING', true);
    if (remaining > principal) fail('DEBT_REMAINING_EXCEEDS_PRINCIPAL');
    var mode = String(d.mode || ''); if (mode !== 'CICILAN' && mode !== 'TUNAI') fail('DEBT_MODE_INVALID');
    var installment = null;
    if (mode === 'CICILAN') installment = strictInt(d.installment, 'INSTALLMENT', false);
    else if (d.installment !== null && d.installment !== undefined && String(d.installment).trim() !== '') fail('CASH_DEBT_MUST_NOT_HAVE_INSTALLMENT');
    return { name: name, principal: principal, remaining: remaining, mode: mode, installment: installment };
  }

  /* ---------- transaksi pertama ---------- */
  function validateDate(date, snapshotDate, now) {
    var d = String(date || ''); if (!isIsoDate(d)) fail('TRANSACTION_DATE_INVALID');
    if (snapshotDate && d < snapshotDate) fail('TRANSACTION_BEFORE_SNAPSHOT');
    if (d > todayStr(now)) fail('TRANSACTION_IN_FUTURE'); return d;
  }
  /* Kontrak INCOME (Spec v2.1 §2.2): alokasi boleh kosong/sebagian; tiap entri > 0; total <= amount; sisa = unallocatedIncome. */
  function buildIncome(f, opening, cats, now) {
    var amount = strictInt(f.amount, 'AMOUNT', false);
    var source = cleanName(f.source, 'SOURCE');
    if (!cats.some(function (c) { return c.key === source && c.aktif !== false; })) fail('SOURCE_INVALID');
    var date = validateDate(f.transactionDate, opening.snapshotDate, now);
    var al = {};
    LOCS.forEach(function (k) { var v = f.allocations && f.allocations[k]; if (v === '' || v == null || v === 0 || v === '0') return; al[k] = strictInt(v, 'ALLOCATION', false); });
    return { type: 'INCOME', data: { amount: amount, source: source, note: String(f.note || ''), transactionDate: date, allocations: al } };
  }
  function buildExpense(f, opening, cats, now) {
    var amount = strictInt(f.amount, 'AMOUNT', false);
    var loc = String(f.locationId || ''); if (LOCS.indexOf(loc) < 0) fail('LOCATION_INVALID');
    var category = cleanName(f.category, 'CATEGORY');
    var cat = cats.filter(function (c) { return c.key === category && c.aktif !== false; })[0]; if (!cat) fail('CATEGORY_INVALID');
    var sub = KLASIFIKASI.indexOf(f.subCategory) >= 0 ? f.subCategory : (cat.klasifikasi || 'Kebutuhan');
    var date = validateDate(f.transactionDate, opening.snapshotDate, now);
    return { type: 'EXPENSE', data: { amount: amount, locationId: loc, category: category, subCategory: sub, note: String(f.note || ''), transactionDate: date } };
  }

  /* ---------- engine bridge (persis dispatch produksi: FinSightVNextAdapter.gs fv3Dispatch_) ---------- */
  function dispatch(state, requestId, type, d) {
    switch (type) {
      case 'INCOME': return fv3AddIncome_(state, requestId, d.amount, d.allocations || {});
      case 'EXPENSE': return fv3AddExpense_(state, requestId, d.locationId, d.amount, d.category || 'UMUM');
      case 'OPEN_DEBT': return fv3OpenDebt_(state, requestId, d);
      case 'OPEN_ASSET': return fv3OpenAsset_(state, requestId, d);
      default: throw new Error('FV3_TRANSACTION_TYPE_UNSUPPORTED');
    }
  }
  function core(r) { var o = Object.assign({}, r); delete o.duplicate; return o; } /* ledger menyimpan result tanpa bidang 'duplicate' */
  function seedState(opening) { return fv3CreateState_({ locations: { CASH: opening.CASH, REKENING: opening.REKENING, E_WALLET: opening.E_WALLET } }); }
  /* Replay: sumber kebenaran = opening + ledger. Hasil tiap event harus sama dengan yang tercatat. */
  function replay(opening, ledger) {
    var st = seedState(opening);
    (ledger || []).forEach(function (e) {
      var r = dispatch(st, e.requestId, e.type, e.data);
      if (JSON.stringify(core(r)) !== JSON.stringify(e.result)) throw new Error('LEDGER_REPLAY_MISMATCH:' + e.requestId);
    });
    return st;
  }
  /* Susun event komit dari draft. Memvalidasi seluruhnya lewat engine pada state klon. */
  function prepareCommit(draft, firstTx, cats, now) {
    var opening = validateOpening(draft.opening, now);
    if (!draft.opening.confirmedAt) fail('OPENING_NOT_CONFIRMED');
    var st = seedState(opening), events = [];
    (draft.assets || []).forEach(function (a) {
      var v = validateAsset(a), data = { assetId: a.id, name: v.name, value: v.value, contribution: v.contribution, origin: 'TRIAL_USER' };
      var rid = a.requestId || newRequestId(); var res = core(dispatch(st, rid, 'OPEN_ASSET', data));
      events.push({ requestId: rid, type: 'OPEN_ASSET', data: data, result: res });
    });
    (draft.debts || []).forEach(function (x) {
      var v = validateDebt(x), data = { debtId: x.id, name: v.name, principal: v.principal, remaining: v.remaining, mode: v.mode, installment: v.installment, origin: 'TRIAL_USER' };
      var rid = x.requestId || newRequestId(); var res = core(dispatch(st, rid, 'OPEN_DEBT', data));
      events.push({ requestId: rid, type: 'OPEN_DEBT', data: data, result: res });
    });
    if (firstTx) {
      var b = firstTx.kind === 'INCOME' ? buildIncome(firstTx.form, opening, cats.income, now) : buildExpense(firstTx.form, opening, cats.expense, now);
      var res2 = core(dispatch(st, firstTx.requestId, b.type, b.data));
      events.push({ requestId: firstTx.requestId, type: b.type, data: b.data, result: res2 });
    }
    return { opening: opening, events: events, state: st };
  }

  /* ---------- turunan untuk Dashboard ---------- */
  var LOCKING = { INCOME: 1, EXPENSE: 1 };
  /* D5-b: terkunci bila pernah ada INCOME/EXPENSE ter-commit (void tidak membuka kunci). OPEN_* tidak mengunci. A2 terverifikasi. */
  function isOpeningLocked(ledger) { return (ledger || []).some(function (e) { return LOCKING[e.type] === 1 && e.status === 'COMMITTED'; }); }
  function monthSummary(ledger, now) {
    var ym = todayStr(now).slice(0, 7), m = { income: 0, expense: 0, debtPayments: 0 };
    (ledger || []).forEach(function (e) {
      if (e.status !== 'COMMITTED' || !e.data) return;
      var ed = String(e.data.transactionDate || '').slice(0, 7); if (ed !== ym) return;
      if (e.type === 'INCOME') m.income += e.data.amount; else if (e.type === 'EXPENSE') m.expense += e.data.amount;
      else if (e.type === 'DEBT_PAYMENT') m.debtPayments += e.data.amount;
    });
    return m;
  }
  function formatPct(p) { return p.toFixed(1).replace('.', ',') + '%'; }
  /* Formula FIX14 tidak berubah. D4 (diusulkan): keterangan jujur bila saldo awal di tengah bulan berjalan. */
  function savingsRate(month, snapshotDate, now) {
    var inc = Number(month.income) || 0, exp = Number(month.expense) || 0;
    if (!(inc > 0)) return { state: 'noincome', text: '—', note: 'Belum ada pemasukan bulan ini' };
    var pct = (inc - exp) / inc * 100, t = todayStr(now), partial = !!snapshotDate && snapshotDate.slice(0, 7) === t.slice(0, 7) && Number(snapshotDate.slice(8, 10)) > 1;
    return { state: 'ok', pct: pct, text: formatPct(pct), note: partial ? 'Perhitungan dimulai dari tanggal saldo awal.' : '' };
  }
  function rupiah(n) { return 'Rp ' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function totalBalance(state) { return LOCS.reduce(function (a, k) { return a + state.locations[k]; }, 0); }
  function notes(state, month, ledger, now) {
    var out = [], hasTx = (ledger || []).some(function (e) { return e.type === 'INCOME' || e.type === 'EXPENSE'; });
    if (!hasTx) out.push('Belum ada transaksi. Catatan akan muncul setelah ada pergerakan uang yang kamu catat.');
    if (state.unallocatedIncome > 0) out.push(rupiah(state.unallocatedIncome) + ' dari pemasukanmu belum ditempatkan di Cash, Rekening, atau E-Wallet, jadi belum masuk Saldo Berjalan.');
    if (month.income > 0 || month.expense > 0) out.push('Bulan ini kamu mencatat pemasukan ' + rupiah(month.income) + ' dan pengeluaran ' + rupiah(month.expense) + '.');
    var rem = Object.keys(state.debts || {}).reduce(function (a, k) { return a + (state.debts[k].remaining || 0); }, 0);
    if (rem > 0) out.push('Sisa utang yang kamu catat: ' + rupiah(rem) + '. Pembayaran utang tidak dihitung sebagai pengeluaran.');
    return out;
  }
  function describeError(e) { return humanError(e); }

  var api = {
    LOCS: LOCS, LOC_LABEL: LOC_LABEL, INCOME_TYPES: INCOME_TYPES, KLASIFIKASI: KLASIFIKASI, SUGGEST_INCOME: SUGGEST_INCOME, SUGGEST_EXPENSE: SUGGEST_EXPENSE,
    MESSAGES: MESSAGES, parseMoney: parseMoney, strictInt: strictInt, cleanName: cleanName, normName: normName, isIsoDate: isIsoDate, todayStr: todayStr,
    newId: newId, newRequestId: newRequestId, validateCategoryInput: validateCategoryInput, cicilanHint: cicilanHint, validateOpening: validateOpening,
    validateAsset: validateAsset, validateDebt: validateDebt, validateDate: validateDate, buildIncome: buildIncome, buildExpense: buildExpense,
    dispatch: dispatch, seedState: seedState, replay: replay, prepareCommit: prepareCommit, isOpeningLocked: isOpeningLocked,
    monthSummary: monthSummary, savingsRate: savingsRate, rupiah: rupiah, totalBalance: totalBalance, notes: notes, humanError: humanError, describeError: describeError, codeOf: codeOf
  };
  root.FSDomain = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
