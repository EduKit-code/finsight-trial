/* FinSight Trial — ekstensi ledger pasca-onboarding (logika murni, tanpa DOM/penyimpanan).
   Dimuat SETELAH engine + domain.js; engine dan domain.js tidak diubah. Menambah jenis event yang sudah ada di engine produksi:
   ALLOCATE_INCOME, DEBT_PAYMENT, REVALUE_ASSET, TRANSFER, DCA, WD (+ OPEN_ASSET/OPEN_DEBT pasca-setup).
   Mengganti FSDomain.dispatch & FSDomain.replay agar replay mengenali event baru (app.js memanggilnya lewat objek FSDomain). */
(function (root) {
  'use strict';
  var D = root.FSDomain, LOCS = D.LOCS, L = D.LOC_LABEL, baseDispatch = D.dispatch;
  Object.assign(D.MESSAGES, {
    DEBT_INVALID: 'Pilih utang.', ASSET_INVALID: 'Pilih aset.', NOTE_TOO_LONG: 'Catatan maksimal 300 karakter.',
    DEBT_NOT_FOUND: 'Utang tidak ditemukan.', DEBT_ALREADY_PAID: 'Utang ini sudah lunas.', PAYMENT_EXCEEDS_DEBT_REMAINING: 'Pembayaran tidak boleh lebih besar dari sisa utang.',
    UNALLOCATED_INCOME_INSUFFICIENT: 'Jumlah melebihi pemasukan yang belum dialokasikan.', ASSET_NOT_FOUND: 'Aset tidak ditemukan.',
    ASSET_BALANCE_INSUFFICIENT: 'Nilai aset tidak cukup untuk penarikan ini.', TRANSFER_SAME_LOCATION: 'Lokasi asal dan tujuan harus berbeda.', KIND_UNSUPPORTED: 'Jenis catatan tidak didukung.'
  });
  function dispatch(st, rid, type, d) {
    switch (type) {
      case 'ALLOCATE_INCOME': return fv3AllocateIncome_(st, rid, d.locationId, d.amount);
      case 'DEBT_PAYMENT': return fv3PayDebt_(st, rid, d.debtId, d.locationId, d.amount, d.kind || 'PEMBAYARAN');
      case 'REVALUE_ASSET': return fv3RevalueAsset_(st, rid, d.assetId, d.value, d.note || '');
      case 'TRANSFER': return fv3Transfer_(st, rid, d.from, d.to, d.amount);
      case 'DCA': return fv3Dca_(st, rid, d.from, d.assetId, d.amount);
      case 'WD': return fv3Withdraw_(st, rid, d.assetId, d.to, d.amount);
      default: return baseDispatch(st, rid, type, d);
    }
  }
  function core(r) { var o = Object.assign({}, r); delete o.duplicate; return o; }
  function sortSeq(a) { return (a || []).slice().sort(function (x, y) { return x.seq - y.seq; }); }
  /* Sumber kebenaran = saldo awal + ledger. Hasil tiap event harus sama dengan yang tercatat. */
  function replay(opening, ledger) {
    var st = D.seedState(opening);
    (ledger || []).forEach(function (e) {
      var r = dispatch(st, e.requestId, e.type, e.data);
      if (JSON.stringify(core(r)) !== JSON.stringify(e.result)) throw new Error('LEDGER_REPLAY_MISMATCH:' + e.requestId);
    });
    return st;
  }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function note(v) { var s = String(v == null ? '' : v).trim(); if (s.length > 300) throw new Error('NOTE_TOO_LONG'); return s; }
  function loc(v) { if (LOCS.indexOf(v) < 0) throw new Error('LOCATION_INVALID'); return v; }
  function makeData(spec, st, opening, now) {
    var f = spec.form || {}, c = spec.cats || { income: [], expense: [] }, date = function () { return D.validateDate(f.transactionDate, opening.snapshotDate, now); };
    switch (spec.kind) {
      case 'INCOME': return D.buildIncome(f, opening, c.income, now);
      case 'EXPENSE': return D.buildExpense(f, opening, c.expense, now);
      case 'DEBT_PAYMENT': {
        var did = String(f.debtId || ''); if (!has(st.debts, did)) throw new Error('DEBT_INVALID');
        return { type: 'DEBT_PAYMENT', data: { debtId: did, locationId: loc(f.locationId), amount: D.strictInt(f.amount, 'AMOUNT', false), kind: 'PEMBAYARAN', transactionDate: date(), note: note(f.note) } };
      }
      case 'ALLOCATE_INCOME': return { type: 'ALLOCATE_INCOME', data: { locationId: loc(f.locationId), amount: D.strictInt(f.amount, 'AMOUNT', false), transactionDate: date(), note: note(f.note) } };
      case 'TRANSFER': return { type: 'TRANSFER', data: { from: loc(f.from), to: loc(f.to), amount: D.strictInt(f.amount, 'AMOUNT', false), transactionDate: date(), note: note(f.note) } };
      case 'DCA': case 'WD': {
        var aid = String(f.assetId || ''); if (!has(st.assets, aid)) throw new Error('ASSET_INVALID');
        var amt = D.strictInt(f.amount, 'AMOUNT', false);
        return spec.kind === 'DCA' ? { type: 'DCA', data: { from: loc(f.from), assetId: aid, amount: amt, transactionDate: date(), note: note(f.note) } }
          : { type: 'WD', data: { assetId: aid, to: loc(f.to), amount: amt, transactionDate: date(), note: note(f.note) } };
      }
      case 'REVALUE_ASSET': {
        var rid2 = String(f.assetId || ''); if (!has(st.assets, rid2)) throw new Error('ASSET_INVALID');
        return { type: 'REVALUE_ASSET', data: { assetId: rid2, value: D.strictInt(f.value, 'VALUE', true), note: note(f.note), transactionDate: date() } };
      }
      case 'OPEN_ASSET': { var a = D.validateAsset(f); return { type: 'OPEN_ASSET', data: { assetId: D.newId('aset'), name: a.name, value: a.value, contribution: a.contribution, origin: 'TRIAL_USER', transactionDate: date() } }; }
      case 'OPEN_DEBT': { var d = D.validateDebt(f); return { type: 'OPEN_DEBT', data: { debtId: D.newId('utang'), name: d.name, principal: d.principal, remaining: d.remaining, mode: d.mode, installment: d.installment, origin: 'TRIAL_USER', transactionDate: date() } }; }
      default: throw new Error('KIND_UNSUPPORTED');
    }
  }
  /* Validasi + hitung event baru terhadap state hasil replay. Tidak menulis apa pun. */
  function build(opening, ledger, spec, now) {
    var st = replay(opening, sortSeq(ledger)), m = makeData(spec, st, opening, now || new Date());
    var res = core(dispatch(st, spec.requestId, m.type, m.data));
    return { requestId: spec.requestId, type: m.type, data: m.data, result: res, status: 'COMMITTED' };
  }
  function evDate(e) { return String((e.data && e.data.transactionDate) || e.createdAt || '').slice(0, 10); }
  /* Teks riwayat. Nama aset/utang diambil dari state saat ini. */
  function describe(e, st) {
    var d = e.data || {}, r = e.result || {}, m = D.rupiah, A = (st && st.assets) || {}, B = (st && st.debts) || {};
    var nm = function (o, id, fb) { return (o[id] && o[id].name) || fb; };
    switch (e.type) {
      case 'INCOME': {
        var parts = LOCS.filter(function (k) { return d.allocations && d.allocations[k]; }).map(function (k) { return L[k] + ' ' + m(d.allocations[k]); });
        return { title: 'Pemasukan · ' + d.source, amount: d.amount, sign: '+', detail: (parts.length ? 'Masuk ke ' + parts.join(', ') : 'Belum ditempatkan') + (r.unallocated > 0 ? ' · belum dialokasikan ' + m(r.unallocated) : '') };
      }
      case 'EXPENSE': return { title: 'Pengeluaran · ' + d.category, amount: d.amount, sign: '-', detail: d.subCategory + ' · dari ' + L[d.locationId] };
      case 'DEBT_PAYMENT': return { title: 'Bayar utang · ' + nm(B, d.debtId, 'utang'), amount: d.amount, sign: '-', detail: 'Dari ' + L[d.locationId] + ' · bukan pengeluaran · sisa ' + m(r.remaining) };
      case 'ALLOCATE_INCOME': return { title: 'Tempatkan pemasukan ke ' + L[d.locationId], amount: d.amount, sign: '', detail: 'Dari "belum dialokasikan"; bukan pemasukan baru' };
      case 'TRANSFER': return { title: 'Pindah uang', amount: d.amount, sign: '', detail: L[d.from] + ' → ' + L[d.to] + ' · bukan pemasukan atau pengeluaran' };
      case 'DCA': return { title: 'Setor ke aset · ' + nm(A, d.assetId, 'aset'), amount: d.amount, sign: '-', detail: 'Dari ' + L[d.from] + ' · alokasi aset, bukan pengeluaran' };
      case 'WD': return { title: 'Tarik dari aset · ' + nm(A, d.assetId, 'aset'), amount: d.amount, sign: '+', detail: 'Ke ' + L[d.to] + ' · bukan pemasukan' };
      case 'OPEN_ASSET': return { title: 'Aset dicatat · ' + d.name, amount: d.value, sign: '', detail: 'Nilai tercatat; tidak mengubah saldo' };
      case 'OPEN_DEBT': return { title: 'Utang dicatat · ' + d.name, amount: d.remaining, sign: '', detail: 'Sisa utang; bukan pengeluaran' };
      case 'REVALUE_ASSET': return { title: 'Nilai aset diperbarui · ' + nm(A, d.assetId, 'aset'), amount: d.value, sign: '', detail: 'Sebelumnya ' + m(r.before) + '; tidak mengubah saldo' };
      default: return { title: String(e.type), amount: 0, sign: '', detail: '' };
    }
  }
  var BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  /* Cashflow per bulan (n bulan terakhir, terbaru dulu), pakai monthSummary FIX14 (menurut tanggal transaksi). */
  function cashflow(ledger, now, n) {
    var out = [];
    for (var i = 0; i < n; i++) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 15), s = D.monthSummary(ledger, d);
      out.push({ label: BULAN[d.getMonth()] + ' ' + d.getFullYear(), income: s.income, expense: s.expense, debtPayments: s.debtPayments, net: s.income - s.expense });
    }
    return out;
  }
  function sumOf(o, k) { return Object.keys(o || {}).reduce(function (a, id) { return a + (Number(o[id][k]) || 0); }, 0); }
  /* Kekayaan bersih tercatat = saldo lokasi + nilai aset − sisa utang. Piutang tidak ada di Trial. */
  function netWorth(st) { var cash = D.totalBalance(st), a = sumOf(st.assets, 'value'), d = sumOf(st.debts, 'remaining'); return { liquid: cash, assets: a, debts: d, net: cash + a - d }; }

  D.dispatch = dispatch; D.replay = replay;
  var api = { dispatch: dispatch, replay: replay, build: build, describe: describe, evDate: evDate, cashflow: cashflow, netWorth: netWorth, sortSeq: sortSeq };
  root.FSLedger = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
