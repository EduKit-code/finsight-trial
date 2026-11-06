/* Salinan verbatim fungsi domain.js yang dipakai tes (bukan file deploy). */
(function (root) {
  var LOCS = ['CASH', 'REKENING', 'E_WALLET'], LOC_LABEL = { CASH: 'Cash', REKENING: 'Rekening', E_WALLET: 'E-Wallet' }, KLASIFIKASI = ['Kebutuhan', 'Keinginan'], MESSAGES = { AMOUNT_INVALID: 'x', INSUFFICIENT_LOCATION_BALANCE: 'x' };
  function fail(code) { throw new Error(code); }
  function parseMoney(s) { if (typeof s === 'number') return Number.isSafeInteger(s) ? s : null; var t = String(s == null ? '' : s).trim().replace(/[\s.]/g, ''); if (t === '' || !/^\d+$/.test(t)) return null; var n = Number(t); return Number.isSafeInteger(n) ? n : null; }
  function strictInt(v, label, zeroOk) { var n = parseMoney(v); if (n === null || (zeroOk ? n < 0 : n <= 0)) fail(label + '_INVALID'); return n; }
  function cleanName(v, label) { var s = String(v == null ? '' : v).trim(); if (!s || s.length > 160) fail((label || 'NAME') + '_INVALID'); return s; }
  function isIsoDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s; }
  function todayStr(d) { d = d || new Date(); var p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
  var __n = 0; function newId(prefix) { return prefix + '_test' + (++__n) + 'abcdefgh'; }
  function validateAsset(a) { return { name: cleanName(a.name, 'NAME'), value: strictInt(a.value, 'VALUE', true), contribution: strictInt(a.contribution, 'CONTRIBUTION', true) }; }
  function validateDebt(d) {
    var name = cleanName(d.name, 'NAME'), principal = strictInt(d.principal, 'PRINCIPAL', false), remaining = strictInt(d.remaining, 'REMAINING', true);
    if (remaining > principal) fail('DEBT_REMAINING_EXCEEDS_PRINCIPAL'); var mode = String(d.mode || ''); if (mode !== 'CICILAN' && mode !== 'TUNAI') fail('DEBT_MODE_INVALID');
    var installment = null; if (mode === 'CICILAN') installment = strictInt(d.installment, 'INSTALLMENT', false);
    return { name: name, principal: principal, remaining: remaining, mode: mode, installment: installment };
  }
  function validateDate(date, snapshotDate, now) { var d = String(date || ''); if (!isIsoDate(d)) fail('TRANSACTION_DATE_INVALID'); if (snapshotDate && d < snapshotDate) fail('TRANSACTION_BEFORE_SNAPSHOT'); if (d > todayStr(now)) fail('TRANSACTION_IN_FUTURE'); return d; }
  function buildIncome(f, opening, cats, now) {
    var amount = strictInt(f.amount, 'AMOUNT', false), source = cleanName(f.source, 'SOURCE');
    if (!cats.some(function (c) { return c.key === source && c.aktif !== false; })) fail('SOURCE_INVALID');
    var date = validateDate(f.transactionDate, opening.snapshotDate, now), al = {};
    LOCS.forEach(function (k) { var v = f.allocations && f.allocations[k]; if (v === '' || v == null || v === 0 || v === '0') return; al[k] = strictInt(v, 'ALLOCATION', false); });
    return { type: 'INCOME', data: { amount: amount, source: source, note: String(f.note || ''), transactionDate: date, allocations: al } };
  }
  function buildExpense(f, opening, cats, now) {
    var amount = strictInt(f.amount, 'AMOUNT', false), loc = String(f.locationId || ''); if (LOCS.indexOf(loc) < 0) fail('LOCATION_INVALID');
    var category = cleanName(f.category, 'CATEGORY'), cat = cats.filter(function (c) { return c.key === category && c.aktif !== false; })[0]; if (!cat) fail('CATEGORY_INVALID');
    var sub = KLASIFIKASI.indexOf(f.subCategory) >= 0 ? f.subCategory : (cat.klasifikasi || 'Kebutuhan'), date = validateDate(f.transactionDate, opening.snapshotDate, now);
    return { type: 'EXPENSE', data: { amount: amount, locationId: loc, category: category, subCategory: sub, note: String(f.note || ''), transactionDate: date } };
  }
  function dispatch(state, requestId, type, d) {
    switch (type) {
      case 'INCOME': return fv3AddIncome_(state, requestId, d.amount, d.allocations || {});
      case 'EXPENSE': return fv3AddExpense_(state, requestId, d.locationId, d.amount, d.category || 'UMUM');
      case 'OPEN_DEBT': return fv3OpenDebt_(state, requestId, d);
      case 'OPEN_ASSET': return fv3OpenAsset_(state, requestId, d);
      default: throw new Error('FV3_TRANSACTION_TYPE_UNSUPPORTED');
    }
  }
  function seedState(opening) { return fv3CreateState_({ locations: { CASH: opening.CASH, REKENING: opening.REKENING, E_WALLET: opening.E_WALLET } }); }
  function monthSummary(ledger, now) {
    var ym = todayStr(now).slice(0, 7), m = { income: 0, expense: 0, debtPayments: 0 };
    (ledger || []).forEach(function (e) { if (e.status !== 'COMMITTED' || !e.data) return; var ed = String(e.data.transactionDate || '').slice(0, 7); if (ed !== ym) return;
      if (e.type === 'INCOME') m.income += e.data.amount; else if (e.type === 'EXPENSE') m.expense += e.data.amount; else if (e.type === 'DEBT_PAYMENT') m.debtPayments += e.data.amount; });
    return m;
  }
  function rupiah(n) { return 'Rp ' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function totalBalance(state) { return LOCS.reduce(function (a, k) { return a + state.locations[k]; }, 0); }
  root.FSDomain = { LOCS: LOCS, LOC_LABEL: LOC_LABEL, KLASIFIKASI: KLASIFIKASI, MESSAGES: MESSAGES, parseMoney: parseMoney, strictInt: strictInt, cleanName: cleanName, todayStr: todayStr, newId: newId, validateAsset: validateAsset, validateDebt: validateDebt, validateDate: validateDate, buildIncome: buildIncome, buildExpense: buildExpense, dispatch: dispatch, seedState: seedState, monthSummary: monthSummary, rupiah: rupiah, totalBalance: totalBalance };
})(globalThis);
