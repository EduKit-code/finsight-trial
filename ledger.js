// Ledger = sumber kebenaran. Semua angka diturunkan lewat replay() (tidak ada cache -> tidak ada projection basi).
export const LOCATIONS = ['CASH', 'REKENING', 'E_WALLET'];
const fail = (m) => { throw new Error(m); };
const amt = (n, l = 'jumlah') => (Number.isInteger(n) && n > 0 ? n : fail(`${l} harus bilangan bulat > 0`));
const loc = (l) => (LOCATIONS.includes(l) ? l : fail(`lokasi tidak valid: ${l}`));
const sum = (a) => a.reduce((x, y) => x + y, 0);

function allocs(list = []) {
  return list.map((a) => ({ loc: loc(a.loc), amount: amt(a.amount, 'alokasi') }));
}
function spend(s, l, n) {
  if (s.balances[l] < n) fail(`saldo ${l} tidak cukup`);
  s.balances[l] -= n;
}

function apply(s, e) {
  switch (e.type) {
    case 'OPENING': s.balances[loc(e.loc)] += amt(e.amount); break; // saldo awal (asumsi: perlu audit vs matriks)
    case 'INCOME': {
      const a = allocs(e.allocations); const total = amt(e.amount);
      if (sum(a.map((x) => x.amount)) > total) fail('alokasi melebihi pemasukan');
      a.forEach((x) => { s.balances[x.loc] += x.amount; });
      s.incomes[e.id] = { amount: total, placed: sum(a.map((x) => x.amount)) };
      break;
    }
    case 'PLACE_INCOME': {
      const inc = s.incomes[e.incomeId] || fail('pemasukan asal tidak ditemukan');
      const a = allocs(e.allocations); const t = sum(a.map((x) => x.amount));
      if (inc.placed + t > inc.amount) fail('penempatan melebihi sisa belum ditempatkan');
      a.forEach((x) => { s.balances[x.loc] += x.amount; });
      inc.placed += t; // BUKAN pemasukan kedua
      break;
    }
    case 'EXPENSE': spend(s, loc(e.loc), amt(e.amount)); break;
    case 'TRANSFER':
      if (loc(e.from) === loc(e.to)) fail('asal dan tujuan sama');
      spend(s, e.from, amt(e.amount)); s.balances[e.to] += e.amount; break;
    case 'ASSET_ADD':
      if (s.assets[e.assetId]) fail('aset sudah ada');
      s.assets[e.assetId] = { name: e.name || e.assetId, value: amt(e.value, 'nilai'), updatedAt: e.date }; break;
    case 'ASSET_DEPOSIT': {
      const as = s.assets[e.assetId] || fail('aset tidak ditemukan');
      spend(s, loc(e.loc), amt(e.amount)); as.value += e.amount; break;
    }
    case 'ASSET_WITHDRAW': {
      const as = s.assets[e.assetId] || fail('aset tidak ditemukan');
      if (as.value < amt(e.amount)) fail('nilai aset tidak cukup');
      as.value -= e.amount; s.balances[loc(e.loc)] += e.amount; break;
    }
    case 'ASSET_REVALUE': {
      const as = s.assets[e.assetId] || fail('aset tidak ditemukan');
      if (!Number.isInteger(e.newValue) || e.newValue < 0) fail('nilai baru tidak valid');
      as.value = e.newValue; as.updatedAt = e.date; break;
    }
    case 'DEBT_ADD':
      if (s.debts[e.debtId]) fail('utang sudah ada');
      s.debts[e.debtId] = { remaining: amt(e.amount), monthly: e.monthly || 0 }; break;
    case 'DEBT_PAY': {
      const d = s.debts[e.debtId] || fail('utang tidak ditemukan');
      if (amt(e.amount) > d.remaining) fail('pembayaran melebihi sisa utang');
      spend(s, loc(e.loc), e.amount); d.remaining -= e.amount; break;
    }
    default: fail(`tipe tidak dikenal: ${e.type}`);
  }
}

export function replay(events) {
  const ids = new Set(); const voided = new Set();
  for (const e of events) {
    if (!e.id || ids.has(e.id)) fail('id kosong/duplikat');
    ids.add(e.id);
    if (e.type === 'VOID') voided.add(e.targetId);
  }
  const s = { balances: { CASH: 0, REKENING: 0, E_WALLET: 0 }, assets: {}, debts: {}, incomes: {}, active: [] };
  for (const e of events) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) fail('tanggal harus YYYY-MM-DD');
    if (e.type === 'VOID') {
      const t = events.find((x) => x.id === e.targetId);
      if (!t || t.type === 'VOID') fail('target VOID tidak valid');
      continue;
    }
    if (voided.has(e.id)) continue;
    apply(s, e); s.active.push(e);
  }
  return s;
}

// Tambah event. Jika hasil replay tidak valid -> throw, events lama tidak berubah (tidak ada tulis parsial).
export function appendEvent(events, ev) {
  const next = [...events, ev]; replay(next); return next;
}

const days = (a, b) => Math.floor((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8))) / 864e5);

export function snapshot(events, { today, period = today.slice(0, 7) }) {
  const s = replay(events);
  const liquid = sum(Object.values(s.balances));
  const assetsTotal = sum(Object.values(s.assets).map((a) => a.value));
  const debtsTotal = sum(Object.values(s.debts).map((d) => d.remaining));
  const unplaced = sum(Object.values(s.incomes).map((i) => i.amount - i.placed));
  const inP = s.active.filter((e) => e.date.startsWith(period));
  const income = sum(inP.filter((e) => e.type === 'INCOME').map((e) => e.amount));
  const consumption = sum(inP.filter((e) => e.type === 'EXPENSE').map((e) => e.amount));
  const debtPaid = sum(inP.filter((e) => e.type === 'DEBT_PAY').map((e) => e.amount));
  const relevantCount = inP.filter((e) => e.type === 'INCOME' || e.type === 'EXPENSE').length;
  const day = period === today.slice(0, 7) ? +today.slice(8) : 31;
  let savings;
  if (income === 0) savings = { status: 'BELUM_ADA_PEMASUKAN', value: null };
  else {
    const ok = relevantCount >= 5 && day >= 7 && consumption > 0;
    savings = { status: ok ? 'SYARAT_TERPENUHI' : 'DATA_TERBATAS', value: Math.round(((income - consumption) / income) * 1000) / 10 };
  }
  const installment = sum(Object.values(s.debts).filter((d) => d.remaining > 0).map((d) => d.monthly));
  return {
    byLoc: { ...s.balances }, liquid, assetsTotal, debtsTotal, netWorth: liquid + assetsTotal - debtsTotal, unplaced,
    income, consumption, debtPaid, relevantCount, day, savings, installment,
    slik: installment > 0 ? Math.round((liquid / installment) * 100) / 100 : null,
    assets: Object.entries(s.assets).map(([id, a]) => ({ id, ...a, ageDays: days(a.updatedAt, today) })),
  };
}
