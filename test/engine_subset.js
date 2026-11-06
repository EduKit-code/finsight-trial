/* Salinan verbatim fungsi engine yang dipakai tes (bukan file deploy). */
function fv3Clone_(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function fv3HasOwn_(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
const FV3_LOCATIONS_ = new Set(['CASH', 'REKENING', 'E_WALLET']);
function fv3Num_(v, label) { if (typeof v !== 'number' || !Number.isSafeInteger(v)) throw new Error(`${label}_INVALID`); return v; }
function fv3SetOwn_(obj, key, value) { Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true }); }
function fv3SafeAdd_(a, b, label) { const result = a + b; if (!Number.isSafeInteger(result)) throw new Error(`${label}_OVERFLOW`); return result; }
function fv3Positive_(v, label) { fv3Num_(v, label); if (v <= 0) throw new Error(`${label}_MUST_BE_POSITIVE`); return v; }
function fv3ValidateNonnegativeBalance_(v, label) { fv3Num_(v, label); if (v < 0) throw new Error(`${label}_NEGATIVE`); return v; }
function fv3CreateState_(seed = {}) {
  const locations = {};
  for (const id of FV3_LOCATIONS_) { const v = seed.locations?.[id] ?? 0; fv3Num_(v, `LOCATION_${id}`); if (v < 0) throw new Error(`LOCATION_${id}_NEGATIVE`); locations[id] = v; }
  return { locations, assets: {}, debts: {}, receivables: {}, income: 0, expense: 0, unallocatedIncome: 0, receipts: 0, ledger: [], requests: {} };
}
function fv3Fingerprint_(type, data) { return JSON.stringify({ type, data }); }
function fv3Run_(state, requestId, type, data, operation) {
  if (typeof requestId !== 'string' || requestId.length < 8 || requestId.length > 64) throw new Error('REQUEST_ID_INVALID');
  const fp = fv3Fingerprint_(type, data);
  const prior = fv3HasOwn_(state.requests, requestId) ? state.requests[requestId] : null;
  const ledgerMatches = state.ledger.filter(e => e && e.requestId === requestId);
  if (ledgerMatches.length > 1) throw new Error('REQUEST_ID_STATE_INCONSISTENT');
  if (prior) {
    if (prior.fv3Fingerprint_ !== fp) throw new Error('REQUEST_ID_REUSED_WITH_DIFFERENT_PAYLOAD');
    if (ledgerMatches.length !== 1) throw new Error('REQUEST_ID_STATE_INCONSISTENT');
    return { ...prior.result, duplicate: true };
  }
  if (ledgerMatches.length !== 0) throw new Error('REQUEST_ID_STATE_INCONSISTENT');
  const draft = fv3Clone_(state);
  const result = operation(draft);
  draft.ledger.push({ requestId, type, data: fv3Clone_(data), result: fv3Clone_(result), status: 'COMMITTED' });
  fv3SetOwn_(draft.requests, requestId, { fv3Fingerprint_: fp, result: fv3Clone_(result) });
  Object.assign(state, draft);
  return { ...result, duplicate: false };
}
function fv3Loc_(state, id) { if (!FV3_LOCATIONS_.has(id)) throw new Error('LOCATION_INVALID'); return state.locations[id]; }
function fv3Debit_(state, id, amount) { fv3Loc_(state, id); fv3Positive_(amount, 'AMOUNT'); if (state.locations[id] < amount) throw new Error('INSUFFICIENT_LOCATION_BALANCE'); state.locations[id] -= amount; }
function fv3Credit_(state, id, amount) { fv3Loc_(state, id); fv3Positive_(amount, 'AMOUNT'); state.locations[id] = fv3SafeAdd_(state.locations[id], amount, 'LOCATION_BALANCE'); }
function fv3AddIncome_(state, requestId, amount, allocations = {}) {
  return fv3Run_(state, requestId, 'INCOME', { amount, allocations }, s => {
    fv3Positive_(amount, 'AMOUNT'); let allocated = 0;
    for (const [id, value] of Object.entries(allocations)) { if (!FV3_LOCATIONS_.has(id)) throw new Error('LOCATION_INVALID'); fv3Positive_(value, 'ALLOCATION_AMOUNT'); allocated = fv3SafeAdd_(allocated, value, 'ALLOCATION_TOTAL'); }
    if (allocated > amount) throw new Error('ALLOCATION_EXCEEDS_INCOME');
    for (const [id, value] of Object.entries(allocations)) fv3Credit_(s, id, value);
    s.income = fv3SafeAdd_(s.income, amount, 'INCOME_TOTAL'); s.unallocatedIncome = fv3SafeAdd_(s.unallocatedIncome, amount - allocated, 'UNALLOCATED_INCOME');
    return { amount, allocated, unallocated: amount - allocated };
  });
}
function fv3AllocateIncome_(state, requestId, locationId, amount) {
  return fv3Run_(state, requestId, 'ALLOCATE_INCOME', { locationId, amount }, s => {
    fv3Positive_(amount, 'AMOUNT'); fv3Loc_(s, locationId);
    if (s.unallocatedIncome < amount) throw new Error('UNALLOCATED_INCOME_INSUFFICIENT');
    s.unallocatedIncome -= amount; fv3Credit_(s, locationId, amount);
    return { locationId, amount, unallocatedIncome: s.unallocatedIncome };
  });
}
function fv3AddExpense_(state, requestId, locationId, amount, category = 'UMUM') {
  return fv3Run_(state, requestId, 'EXPENSE', { locationId, amount, category }, s => { fv3Debit_(s, locationId, amount); s.expense = fv3SafeAdd_(s.expense, amount, 'EXPENSE_TOTAL'); return { locationId, amount, expenseTotal: s.expense }; });
}
function fv3OpenDebt_(state, requestId, d) {
  return fv3Run_(state, requestId, 'OPEN_DEBT', d, s => {
    if (!d.debtId || fv3HasOwn_(s.debts, d.debtId)) throw new Error('DEBT_ID_INVALID_OR_EXISTS');
    fv3Positive_(d.principal, 'PRINCIPAL'); fv3ValidateNonnegativeBalance_(d.remaining, 'DEBT_REMAINING');
    if (d.remaining > d.principal) throw new Error('DEBT_REMAINING_EXCEEDS_PRINCIPAL');
    if (!['CICILAN','TUNAI'].includes(d.mode)) throw new Error('DEBT_MODE_INVALID');
    if (d.mode === 'CICILAN') fv3Positive_(d.installment, 'INSTALLMENT');
    if (d.mode === 'TUNAI' && d.installment != null) throw new Error('CASH_DEBT_MUST_NOT_HAVE_INSTALLMENT');
    fv3SetOwn_(s.debts, d.debtId, {principal:d.principal,remaining:d.remaining,mode:d.mode,installment:d.mode==='CICILAN'?d.installment:null,status:d.remaining===0?'LUNAS':'AKTIF',name:d.name||'',tag:d.tag||'',legacyRowIndex:d.legacyRowIndex||null,legacyFingerprint:d.legacyFingerprint||null,origin:d.origin||'OWNER_CONFIRMED'});
    return {debtId:d.debtId,principal:d.principal,remaining:d.remaining,status:d.remaining===0?'LUNAS':'AKTIF',origin:d.origin||'OWNER_CONFIRMED'};
  });
}
function fv3OpenAsset_(state, requestId, d) {
  return fv3Run_(state, requestId, 'OPEN_ASSET', d, s => {
    if (!d.assetId || fv3HasOwn_(s.assets,d.assetId)) throw new Error('ASSET_ID_INVALID_OR_EXISTS');
    fv3ValidateNonnegativeBalance_(d.value,'ASSET_VALUE'); fv3ValidateNonnegativeBalance_(d.contribution,'ASSET_CONTRIBUTION');
    fv3SetOwn_(s.assets,d.assetId,{value:d.value,contribution:d.contribution,name:d.name||'',origin:d.origin||'OWNER_CONFIRMED',legacyRowIndex:d.legacyRowIndex||null,legacyFingerprint:d.legacyFingerprint||null});
    return {assetId:d.assetId,value:d.value,contribution:d.contribution};
  });
}
function fv3RevalueAsset_(state, requestId, assetId, value, note='') {
  return fv3Run_(state, requestId, 'REVALUE_ASSET', {assetId,value,note}, s => {
    const a=fv3HasOwn_(s.assets,assetId)?s.assets[assetId]:null; if(!a) throw new Error('ASSET_NOT_FOUND');
    fv3ValidateNonnegativeBalance_(value,'ASSET_VALUE'); const before=a.value; a.value=value;
    return {assetId,before,value,delta:value-before,note};
  });
}
function fv3PayDebt_(state, requestId, debtId, locationId, amount, kind = 'PEMBAYARAN') {
  return fv3Run_(state, requestId, 'DEBT_PAYMENT', { debtId, locationId, amount, kind }, s => {
    const d = fv3HasOwn_(s.debts, debtId) ? s.debts[debtId] : null; if (!d) throw new Error('DEBT_NOT_FOUND');
    if (!Number.isFinite(d.remaining) || d.remaining < 0 || !Number.isFinite(d.principal) || d.remaining > d.principal) throw new Error('DEBT_BALANCE_INVALID');
    if (d.status === 'LUNAS') throw new Error('DEBT_ALREADY_PAID');
    fv3Positive_(amount, 'AMOUNT');
    if (amount > d.remaining) throw new Error('PAYMENT_EXCEEDS_DEBT_REMAINING');
    fv3Debit_(s, locationId, amount); d.remaining -= amount;
    if (d.remaining === 0) d.status = 'LUNAS';
    return { debtId, amount, remaining: d.remaining, status: d.status, kind };
  });
}
function fv3Transfer_(state, requestId, from, to, amount) {
  return fv3Run_(state, requestId, 'TRANSFER', { from, to, amount }, s => {
    if (from === to) throw new Error('TRANSFER_SAME_LOCATION');
    fv3Debit_(s, from, amount); fv3Credit_(s, to, amount);
    return { from, to, amount, aggregateLocations: Object.values(s.locations).reduce((a,b)=>a+b,0) };
  });
}
function fv3Dca_(state, requestId, from, assetId, amount) {
  return fv3Run_(state, requestId, 'DCA', { from, assetId, amount }, s => {
    if (!assetId) throw new Error('ASSET_ID_INVALID'); fv3Debit_(s, from, amount);
    const a = fv3HasOwn_(s.assets, assetId) ? s.assets[assetId] : { value: 0, contribution: 0 };
    if (!Number.isFinite(a.value) || a.value < 0 || !Number.isFinite(a.contribution) || a.contribution < 0) throw new Error('ASSET_BALANCE_INVALID');
    a.value = fv3SafeAdd_(a.value, amount, 'ASSET_VALUE'); a.contribution = fv3SafeAdd_(a.contribution, amount, 'ASSET_CONTRIBUTION'); fv3SetOwn_(s.assets, assetId, a);
    return { from, assetId, amount, assetValue: a.value, contribution: a.contribution };
  });
}
function fv3Withdraw_(state, requestId, assetId, to, amount) {
  return fv3Run_(state, requestId, 'WD', { assetId, to, amount }, s => {
    const a = fv3HasOwn_(s.assets, assetId) ? s.assets[assetId] : null; if (!a) throw new Error('ASSET_NOT_FOUND');
    if (!Number.isFinite(a.value) || a.value < 0 || !Number.isFinite(a.contribution) || a.contribution < 0) throw new Error('ASSET_BALANCE_INVALID');
    fv3Positive_(amount, 'AMOUNT');
    if (a.value < amount) throw new Error('ASSET_BALANCE_INSUFFICIENT');
    a.value -= amount; fv3Credit_(s, to, amount);
    return { assetId, to, amount, assetValue: a.value };
  });
}
