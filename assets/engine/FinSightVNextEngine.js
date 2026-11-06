
function fv3Clone_(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function fv3HasOwn_(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

// Port of the REV4 domain engine for Apps Script V8. Do not edit baseline functions.


// Isolated domain prototype. No Google APIs, no live spreadsheet writes.
const FV3_LOCATIONS_ = new Set(['CASH', 'REKENING', 'E_WALLET']);
function fv3Num_(v, label) {
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) throw new Error(`${label}_INVALID`);
  return v;
}
function fv3SetOwn_(obj, key, value) {
  Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
}
function fv3SafeAdd_(a, b, label) {
  const result = a + b;
  if (!Number.isSafeInteger(result)) throw new Error(`${label}_OVERFLOW`);
  return result;
}
function fv3Positive_(v, label) {
  fv3Num_(v, label);
  if (v <= 0) throw new Error(`${label}_MUST_BE_POSITIVE`);
  return v;
}
function fv3ValidateNonnegativeBalance_(v, label) {
  fv3Num_(v, label);
  if (v < 0) throw new Error(`${label}_NEGATIVE`);
  return v;
}
function fv3CreateState_(seed = {}) {
  const locations = {};
  for (const id of FV3_LOCATIONS_) {
    const v = seed.locations?.[id] ?? 0;
    fv3Num_(v, `LOCATION_${id}`);
    if (v < 0) throw new Error(`LOCATION_${id}_NEGATIVE`);
    locations[id] = v;
  }
  const assets = fv3Clone_(seed.assets || {});
  const debts = fv3Clone_(seed.debts || {});
  const receivables = fv3Clone_(seed.receivables || {});
  for (const [id, a] of Object.entries(assets)) {
    if (!id || !a || typeof a !== 'object') throw new Error('ASSET_SEED_INVALID');
    fv3ValidateNonnegativeBalance_(a.value, `ASSET_${id}_VALUE`);
    fv3ValidateNonnegativeBalance_(a.contribution, `ASSET_${id}_CONTRIBUTION`);
  }
  for (const [id, d] of Object.entries(debts)) {
    if (!id || !d || typeof d !== 'object') throw new Error('DEBT_SEED_INVALID');
    fv3ValidateNonnegativeBalance_(d.principal, `DEBT_${id}_PRINCIPAL`);
    fv3ValidateNonnegativeBalance_(d.remaining, `DEBT_${id}_REMAINING`);
    if (d.remaining > d.principal) throw new Error(`DEBT_${id}_REMAINING_EXCEEDS_PRINCIPAL`);
    if (!['CICILAN', 'TUNAI'].includes(d.mode)) throw new Error(`DEBT_${id}_MODE_INVALID`);
    if (!['AKTIF', 'LUNAS'].includes(d.status)) throw new Error(`DEBT_${id}_STATUS_INVALID`);
    if (d.mode === 'CICILAN') fv3Positive_(d.installment, `DEBT_${id}_INSTALLMENT`);
    if (d.mode === 'TUNAI' && d.installment != null) throw new Error(`DEBT_${id}_CASH_INSTALLMENT_INVALID`);
    if ((d.remaining === 0) !== (d.status === 'LUNAS')) throw new Error(`DEBT_${id}_STATUS_BALANCE_MISMATCH`);
  }
  for (const [id, r] of Object.entries(receivables)) {
    if (!id || !r || typeof r !== 'object') throw new Error('RECEIVABLE_SEED_INVALID');
    fv3ValidateNonnegativeBalance_(r.remaining, `RECEIVABLE_${id}_REMAINING`);
    if (!['AKTIF', 'LUNAS'].includes(r.status)) throw new Error(`RECEIVABLE_${id}_STATUS_INVALID`);
    if ((r.remaining === 0) !== (r.status === 'LUNAS')) throw new Error(`RECEIVABLE_${id}_STATUS_BALANCE_MISMATCH`);
  }
  return {
    locations,
    assets,
    debts,
    receivables,
    income: 0,
    expense: 0,
    unallocatedIncome: 0,
    receipts: 0,
    ledger: [],
    requests: {}
  };
}
function fv3Fingerprint_(type, data) { return JSON.stringify({ type, data }); }
function fv3Run_(state, requestId, type, data, operation) {
  if (typeof requestId !== 'string' || requestId.length < 8 || requestId.length > 64) throw new Error('REQUEST_ID_INVALID');
  const fp = fv3Fingerprint_(type, data);
  const prior = fv3HasOwn_(state.requests, requestId) ? state.requests[requestId] : null;
  const ledgerMatches = state.ledger.filter(e => e && e.requestId === requestId);
  // Idempotency depends on both indexes agreeing. Never replay a request if either
  // the request index or ledger evidence is missing/corrupt; fail closed instead.
  if (ledgerMatches.length > 1) throw new Error('REQUEST_ID_STATE_INCONSISTENT');
  if (prior) {
    if (prior.fv3Fingerprint_ !== fp) throw new Error('REQUEST_ID_REUSED_WITH_DIFFERENT_PAYLOAD');
    if (ledgerMatches.length !== 1) throw new Error('REQUEST_ID_STATE_INCONSISTENT');
    const priorLedger = ledgerMatches[0];
    if (priorLedger.type !== type || fv3Fingerprint_(priorLedger.type, priorLedger.data) !== fp ||
        JSON.stringify(priorLedger.result) !== JSON.stringify(prior.result)) {
      throw new Error('REQUEST_ID_STATE_INCONSISTENT');
    }
    return { ...prior.result, duplicate: true };
  }
  if (ledgerMatches.length !== 0) throw new Error('REQUEST_ID_STATE_INCONSISTENT');
  // Validate and calculate on a clone; commit only when all domain preconditions pass.
  const draft = fv3Clone_(state);
  const result = operation(draft);
  draft.ledger.push({ requestId, type, data: fv3Clone_(data), result: fv3Clone_(result), status: 'COMMITTED' });
  fv3SetOwn_(draft.requests, requestId, { fv3Fingerprint_: fp, result: fv3Clone_(result) });
  Object.assign(state, draft);
  return { ...result, duplicate: false };
}
function fv3Loc_(state, id) {
  if (!FV3_LOCATIONS_.has(id)) throw new Error('LOCATION_INVALID');
  return state.locations[id];
}
function fv3Debit_(state, id, amount) {
  fv3Loc_(state, id);
  fv3Positive_(amount, 'AMOUNT');
  if (state.locations[id] < amount) throw new Error('INSUFFICIENT_LOCATION_BALANCE');
  state.locations[id] -= amount;
}
function fv3Credit_(state, id, amount) { fv3Loc_(state, id); fv3Positive_(amount, 'AMOUNT'); state.locations[id] = fv3SafeAdd_(state.locations[id], amount, 'LOCATION_BALANCE'); }
function fv3AddIncome_(state, requestId, amount, allocations = {}) {
  return fv3Run_(state, requestId, 'INCOME', { amount, allocations }, s => {
    fv3Positive_(amount, 'AMOUNT');
    let allocated = 0;
    for (const [id, value] of Object.entries(allocations)) {
      if (!FV3_LOCATIONS_.has(id)) throw new Error('LOCATION_INVALID');
      fv3Positive_(value, 'ALLOCATION_AMOUNT');
      allocated = fv3SafeAdd_(allocated, value, 'ALLOCATION_TOTAL');
    }
    if (allocated > amount) throw new Error('ALLOCATION_EXCEEDS_INCOME');
    for (const [id, value] of Object.entries(allocations)) fv3Credit_(s, id, value);
    s.income = fv3SafeAdd_(s.income, amount, 'INCOME_TOTAL');
    s.unallocatedIncome = fv3SafeAdd_(s.unallocatedIncome, amount - allocated, 'UNALLOCATED_INCOME');
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
  return fv3Run_(state, requestId, 'EXPENSE', { locationId, amount, category }, s => {
    fv3Debit_(s, locationId, amount); s.expense = fv3SafeAdd_(s.expense, amount, 'EXPENSE_TOTAL');
    return { locationId, amount, expenseTotal: s.expense };
  });
}
function fv3AddDebt_(state, requestId, debtId, principal, mode, installment = null) {
  return fv3Run_(state, requestId, 'ADD_DEBT', { debtId, principal, mode, installment }, s => {
    if (!debtId || fv3HasOwn_(s.debts, debtId)) throw new Error('DEBT_ID_INVALID_OR_EXISTS');
    fv3Positive_(principal, 'PRINCIPAL');
    if (!['CICILAN', 'TUNAI'].includes(mode)) throw new Error('DEBT_MODE_INVALID');
    if (mode === 'CICILAN') fv3Positive_(installment, 'INSTALLMENT');
    if (mode === 'TUNAI' && installment != null) throw new Error('CASH_DEBT_MUST_NOT_HAVE_INSTALLMENT');
    fv3SetOwn_(s.debts, debtId, { principal, remaining: principal, mode, installment: mode === 'CICILAN' ? installment : null, status: 'AKTIF' });
    return { debtId, remaining: principal, mode };
  });
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
function fv3OpenReceivable_(state, requestId, d) {
  return fv3Run_(state, requestId, 'OPEN_RECEIVABLE', d, s => {
    if (!d.receivableId || fv3HasOwn_(s.receivables,d.receivableId)) throw new Error('RECEIVABLE_ID_INVALID_OR_EXISTS');
    fv3Positive_(d.principal, 'RECEIVABLE_PRINCIPAL'); fv3ValidateNonnegativeBalance_(d.remaining, 'RECEIVABLE_REMAINING');
    if (d.remaining > d.principal) throw new Error('RECEIVABLE_REMAINING_EXCEEDS_PRINCIPAL');
    fv3SetOwn_(s.receivables,d.receivableId,{principal:d.principal,remaining:d.remaining,status:d.remaining===0?'LUNAS':'AKTIF',name:d.name||'',legacyRowIndex:d.legacyRowIndex||null,legacyFingerprint:d.legacyFingerprint||null,origin:d.origin||'OWNER_CONFIRMED'});
    return {receivableId:d.receivableId,principal:d.principal,remaining:d.remaining,status:d.remaining===0?'LUNAS':'AKTIF'};
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

function fv3AdjustBalance_(state, requestId, d) {
  return fv3Run_(state, requestId, 'ADJUST_BALANCE', d, s => {
    const loc = d.locationId;
    if (!FV3_LOCATIONS_.has(loc)) throw new Error('LOCATION_INVALID');
    fv3ValidateNonnegativeBalance_(d.expectedBalance, 'EXPECTED_BALANCE');
    fv3ValidateNonnegativeBalance_(d.newBalance, 'NEW_BALANCE');
    if (s.locations[loc] !== d.expectedBalance) throw new Error('BALANCE_CHANGED');
    if (d.newBalance === d.expectedBalance) throw new Error('ADJUST_NO_CHANGE');
    if (!['LUPA_CATAT','BIAYA_ADMIN','SELISIH_KAS','LAINNYA'].includes(d.reason)) throw new Error('ADJUST_REASON_INVALID');
    s.locations[loc] = d.newBalance;
    return { locationId: loc, before: d.expectedBalance, after: d.newBalance, delta: d.newBalance - d.expectedBalance, reason: d.reason };
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
function fv3AddReceivable_(state, requestId, receivableId, amount) {
  return fv3Run_(state, requestId, 'ADD_RECEIVABLE', { receivableId, amount }, s => {
    if (!receivableId || fv3HasOwn_(s.receivables, receivableId)) throw new Error('RECEIVABLE_ID_INVALID_OR_EXISTS');
    fv3Positive_(amount, 'AMOUNT'); fv3SetOwn_(s.receivables, receivableId, { remaining: amount, status: 'AKTIF' });
    return { receivableId, remaining: amount };
  });
}
function fv3ReceiveReceivable_(state, requestId, receivableId, locationId, amount) {
  return fv3Run_(state, requestId, 'RECEIVABLE_RECEIPT', { receivableId, locationId, amount }, s => {
    const r = fv3HasOwn_(s.receivables, receivableId) ? s.receivables[receivableId] : null; if (!r) throw new Error('RECEIVABLE_NOT_FOUND');
    if (!Number.isFinite(r.remaining) || r.remaining < 0) throw new Error('RECEIVABLE_BALANCE_INVALID');
    fv3Positive_(amount, 'AMOUNT'); if (amount > r.remaining) throw new Error('RECEIPT_EXCEEDS_RECEIVABLE_REMAINING');
    fv3Credit_(s, locationId, amount); r.remaining -= amount; if (r.remaining === 0) r.status = 'LUNAS';
    s.receipts = fv3SafeAdd_(s.receipts, amount, 'RECEIPTS_TOTAL');
    return { receivableId, locationId, amount, remaining: r.remaining, status: r.status };
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
function fv3VoidTransaction_(state, requestId, targetRequestId, reason) {
  return fv3Run_(state, requestId, 'VOID', { targetRequestId, reason }, s => {
    if (typeof targetRequestId !== 'string' || !targetRequestId) throw new Error('VOID_TARGET_INVALID');
    if (typeof reason !== 'string' || reason.trim().length < 3 || reason.length > 300) throw new Error('VOID_REASON_REQUIRED');
    const target = s.ledger.find(e => e.requestId === targetRequestId && e.type !== 'VOID');
    if (!target) throw new Error('VOID_TARGET_NOT_FOUND');
    if (target.status !== 'COMMITTED') throw new Error('VOID_TARGET_NOT_COMMITTED');
    const later = s.ledger.slice(s.ledger.indexOf(target) + 1).some(e => e.type !== 'VOID' && e.status !== 'VOIDED');
    if (later) throw new Error('VOID_REQUIRES_LATEST_TRANSACTION');
    const d = target.data, r = target.result;
    switch (target.type) {
      case 'INCOME': {
        for (const [id, amount] of Object.entries(d.allocations || {})) fv3Debit_(s, id, amount);
        s.income -= d.amount; s.unallocatedIncome -= r.unallocated;
        if (s.income < 0 || s.unallocatedIncome < 0) throw new Error('VOID_INVARIANT_FAILED');
        break;
      }
      case 'ALLOCATE_INCOME':
        fv3Debit_(s, d.locationId, d.amount); s.unallocatedIncome = fv3SafeAdd_(s.unallocatedIncome, d.amount, 'UNALLOCATED_INCOME'); break;
      case 'EXPENSE':
        fv3Credit_(s, d.locationId, d.amount); s.expense -= d.amount; if (s.expense < 0) throw new Error('VOID_INVARIANT_FAILED'); break;
      case 'OPEN_DEBT': {
        const debt=fv3HasOwn_(s.debts,d.debtId)?s.debts[d.debtId]:null;
        if(!debt || debt.remaining!==d.remaining || debt.status!==(d.remaining===0?'LUNAS':'AKTIF')) throw new Error('VOID_DEPENDENCY_EXISTS');
        delete s.debts[d.debtId]; break;
      }
      case 'ADD_DEBT': {
        const debt = fv3HasOwn_(s.debts, d.debtId) ? s.debts[d.debtId] : null;
        if (!debt || debt.remaining !== debt.principal || debt.status !== 'AKTIF') throw new Error('VOID_DEPENDENCY_EXISTS');
        delete s.debts[d.debtId]; break;
      }
      case 'DEBT_PAYMENT': {
        const debt = fv3HasOwn_(s.debts, d.debtId) ? s.debts[d.debtId] : null;
        if (!debt) throw new Error('VOID_DEPENDENCY_EXISTS');
        fv3Credit_(s, d.locationId, d.amount); debt.remaining = fv3SafeAdd_(debt.remaining, d.amount, 'DEBT_REMAINING');
        if (debt.remaining > debt.principal) throw new Error('VOID_INVARIANT_FAILED'); debt.status = 'AKTIF'; break;
      }
      case 'OPEN_RECEIVABLE': {
        const rec=fv3HasOwn_(s.receivables,d.receivableId)?s.receivables[d.receivableId]:null;
        if(!rec || rec.remaining!==d.remaining || rec.status!==(d.remaining===0?'LUNAS':'AKTIF')) throw new Error('VOID_DEPENDENCY_EXISTS');
        delete s.receivables[d.receivableId]; break;
      }
      case 'OPEN_ASSET': {
        const a=fv3HasOwn_(s.assets,d.assetId)?s.assets[d.assetId]:null;
        if(!a || a.value!==d.value || a.contribution!==d.contribution) throw new Error('VOID_DEPENDENCY_EXISTS');
        delete s.assets[d.assetId]; break;
      }
      case 'REVALUE_ASSET': {
        const a=fv3HasOwn_(s.assets,d.assetId)?s.assets[d.assetId]:null;
        if(!a || a.value!==d.value) throw new Error('VOID_DEPENDENCY_EXISTS');
        a.value=r.before; break;
      }
      case 'ADD_RECEIVABLE': {
        const rec = fv3HasOwn_(s.receivables, d.receivableId) ? s.receivables[d.receivableId] : null;
        if (!rec || rec.remaining !== r.remaining || rec.status !== 'AKTIF') throw new Error('VOID_DEPENDENCY_EXISTS');
        delete s.receivables[d.receivableId]; break;
      }
      case 'RECEIVABLE_RECEIPT': {
        const rec = fv3HasOwn_(s.receivables, d.receivableId) ? s.receivables[d.receivableId] : null;
        if (!rec || s.locations[d.locationId] < d.amount || s.receipts < d.amount) throw new Error('VOID_INVARIANT_FAILED');
        fv3Debit_(s, d.locationId, d.amount); rec.remaining = fv3SafeAdd_(rec.remaining, d.amount, 'RECEIVABLE_REMAINING');
        rec.status = 'AKTIF'; s.receipts -= d.amount; break;
      }
      case 'ADJUST_BALANCE':
        if (s.locations[d.locationId] !== r.after) throw new Error('VOID_DEPENDENCY_EXISTS');
        s.locations[d.locationId] = r.before; break;
      case 'TRANSFER': fv3Debit_(s, d.to, d.amount); fv3Credit_(s, d.from, d.amount); break;
      case 'DCA': {
        const a = fv3HasOwn_(s.assets, d.assetId) ? s.assets[d.assetId] : null;
        if (!a || a.value < d.amount || a.contribution < d.amount) throw new Error('VOID_INVARIANT_FAILED');
        a.value -= d.amount; a.contribution -= d.amount; fv3Credit_(s, d.from, d.amount); break;
      }
      case 'WD': {
        const a = fv3HasOwn_(s.assets, d.assetId) ? s.assets[d.assetId] : null;
        if (!a || s.locations[d.to] < d.amount) throw new Error('VOID_INVARIANT_FAILED');
        fv3Debit_(s, d.to, d.amount); a.value = fv3SafeAdd_(a.value, d.amount, 'ASSET_VALUE'); break;
      }
      default: throw new Error('VOID_TYPE_NOT_SUPPORTED');
    }
    target.status = 'VOIDED'; target.voidReason = reason.trim();
    return { targetRequestId, targetType: target.type, status: 'VOIDED', reason: reason.trim() };
  });
}
function fv3ReconcileState_(state) {
  const issues = [];
  for (const id of FV3_LOCATIONS_) if (!Number.isSafeInteger(state.locations[id]) || state.locations[id] < 0) issues.push(`LOCATION_${id}_INVALID`);
  for (const key of ['income','expense','unallocatedIncome','receipts']) if (!Number.isSafeInteger(state[key]) || state[key] < 0) issues.push(`${key.toUpperCase()}_INVALID`);
  for (const [id,d] of Object.entries(state.debts)) {
    if (!Number.isSafeInteger(d.remaining) || d.remaining < 0 || d.remaining > d.principal) issues.push(`DEBT_${id}_BALANCE_INVALID`);
    if ((d.remaining === 0) !== (d.status === 'LUNAS')) issues.push(`DEBT_${id}_STATUS_MISMATCH`);
  }
  for (const [id,r] of Object.entries(state.receivables)) {
    if (!Number.isSafeInteger(r.remaining) || r.remaining < 0) issues.push(`RECEIVABLE_${id}_BALANCE_INVALID`);
    if ((r.remaining === 0) !== (r.status === 'LUNAS')) issues.push(`RECEIVABLE_${id}_STATUS_MISMATCH`);
  }
  const seen = new Set();
  for (const e of state.ledger) {
    if (!e || typeof e.requestId !== 'string') { issues.push('LEDGER_ENTRY_INVALID'); continue; }
    if (seen.has(e.requestId)) issues.push(`LEDGER_DUPLICATE_REQUEST_${e.requestId}`);
    seen.add(e.requestId);
    if (!['COMMITTED','VOIDED'].includes(e.status)) issues.push(`LEDGER_STATUS_INVALID_${e.requestId}`);
    if (e.type === 'VOID' && (!e.data?.targetRequestId || !e.data?.reason)) issues.push(`VOID_AUDIT_INCOMPLETE_${e.requestId}`);
    if (!fv3HasOwn_(state.requests, e.requestId)) {
      issues.push(`LEDGER_WITHOUT_REQUEST_${e.requestId}`);
    } else {
      const request = state.requests[e.requestId];
      if (!request || request.fv3Fingerprint_ !== fv3Fingerprint_(e.type, e.data) ||
          JSON.stringify(request.result) !== JSON.stringify(e.result)) {
        issues.push(`REQUEST_LEDGER_MISMATCH_${e.requestId}`);
      }
    }
  }
  for (const id of Object.keys(state.requests)) if (!seen.has(id)) issues.push(`REQUEST_WITHOUT_LEDGER_${id}`);
  return { ok: issues.length === 0, issues, ledgerEntries: state.ledger.length, committedEntries: state.ledger.filter(e=>e.status==='COMMITTED').length, voidedEntries: state.ledger.filter(e=>e.status==='VOIDED').length };
}
function fv3SavingsRate_(state) { return state.income > 0 ? ((state.income - state.expense) / state.income) * 100 : 0; }

