import test from 'node:test';
import assert from 'node:assert/strict';
import { appendEvent, snapshot, replay } from '../src/ledger.js';
import { interpret } from '../src/interpret.js';
import { buildReceipt } from '../src/receipt.js';

const TODAY = '2026-11-09'; const ctx = { today: TODAY };
let n = 0;
const ev = (type, o = {}) => ({ id: `e${++n}`, date: '2026-11-02', type, ...o });
const run = (list) => list.reduce((acc, e) => appendEvent(acc, e), []);
const snap = (events, c = ctx) => snapshot(events, c);

// Skenario 4 (dokumen): saldo 4,5jt; belanja 250rb; aset 5,6jt; utang 15jt; bayar 1,5jt
const base = () => run([
  ev('OPENING', { loc: 'REKENING', amount: 4_500_000 }),
  ev('EXPENSE', { loc: 'REKENING', amount: 250_000 }),
  ev('ASSET_ADD', { assetId: 'a1', name: 'Aset', value: 5_600_000 }),
  ev('DEBT_ADD', { debtId: 'd1', amount: 15_000_000, monthly: 1_500_000 }),
]);

test('S4 sebelum bayar utang: saldo 4,25jt, NW -5,15jt', () => {
  const s = snap(base());
  assert.equal(s.liquid, 4_250_000); assert.equal(s.netWorth, -5_150_000);
});
test('S4 pembayaran utang: hasil sesuai dokumen', () => {
  const e = run([...base(), ev('DEBT_PAY', { debtId: 'd1', loc: 'REKENING', amount: 1_500_000 })]);
  const s = snap(e);
  assert.equal(s.liquid, 2_750_000); assert.equal(s.debtsTotal, 13_500_000);
  assert.equal(s.consumption, 250_000); assert.equal(s.debtPaid, 1_500_000);
  assert.equal(s.netWorth, -5_150_000);
  assert.equal(s.savings.status, 'BELUM_ADA_PEMASUKAN'); assert.equal(s.savings.value, null);
  assert.equal(s.slik, 1.83);
});
test('S4 receipt pembayaran utang', () => {
  const before = base(); const evp = ev('DEBT_PAY', { debtId: 'd1', loc: 'REKENING', amount: 1_500_000 });
  const r = buildReceipt(before, appendEvent(before, evp), evp, ctx);
  assert.equal(r.recorded, 'Pembayaran utang Rp1.500.000.');
  assert.ok(r.changed.includes('Total saldo likuid berkurang Rp1.500.000.'));
  assert.ok(r.changed.includes('Sisa utang berkurang Rp1.500.000.'));
  for (const k of ['Pengeluaran konsumsi', 'Savings Rate', 'Net Worth secara nominal']) assert.ok(r.unchanged.includes(k), k);
});

// Matriks
test('Pemasukan ditempatkan sebagian, sisa belum ditempatkan, lalu penempatan sisa: tidak dihitung dua kali', () => {
  const i = ev('INCOME', { amount: 3_000_000, allocations: [{ loc: 'REKENING', amount: 2_000_000 }] });
  let e = appendEvent([], i);
  let s = snap(e);
  assert.equal(s.income, 3_000_000); assert.equal(s.liquid, 2_000_000); assert.equal(s.unplaced, 1_000_000); assert.equal(s.netWorth, 2_000_000);
  e = appendEvent(e, ev('PLACE_INCOME', { incomeId: i.id, allocations: [{ loc: 'CASH', amount: 1_000_000 }] }));
  s = snap(e);
  assert.equal(s.income, 3_000_000); assert.equal(s.liquid, 3_000_000); assert.equal(s.unplaced, 0); assert.equal(s.netWorth, 3_000_000);
});
test('Penempatan melebihi sisa ditolak, events tidak berubah', () => {
  const i = ev('INCOME', { amount: 1_000_000, allocations: [{ loc: 'CASH', amount: 1_000_000 }] });
  const e = appendEvent([], i);
  assert.throws(() => appendEvent(e, ev('PLACE_INCOME', { incomeId: i.id, allocations: [{ loc: 'CASH', amount: 1 }] })));
  assert.equal(e.length, 1);
});
test('Pengeluaran: saldo & NW turun, konsumsi naik', () => {
  const e = run([ev('OPENING', { loc: 'CASH', amount: 1_000_000 }), ev('EXPENSE', { loc: 'CASH', amount: 100_000 })]);
  const s = snap(e); assert.equal(s.liquid, 900_000); assert.equal(s.consumption, 100_000); assert.equal(s.netWorth, 900_000);
});
test('Transfer internal: total, pemasukan, pengeluaran, NW tidak berubah', () => {
  const b = run([ev('OPENING', { loc: 'CASH', amount: 1_000_000 })]);
  const t = ev('TRANSFER', { from: 'CASH', to: 'E_WALLET', amount: 400_000 });
  const a = appendEvent(b, t); const s = snap(a);
  assert.equal(s.byLoc.CASH, 600_000); assert.equal(s.byLoc.E_WALLET, 400_000);
  assert.equal(s.liquid, 1_000_000); assert.equal(s.consumption, 0); assert.equal(s.income, 0); assert.equal(s.netWorth, 1_000_000);
  assert.ok(buildReceipt(b, a, t, ctx).unchanged.includes('Total saldo likuid'));
});
test('Setoran aset: saldo turun, aset naik, bukan konsumsi, NW tetap', () => {
  const b = run([ev('OPENING', { loc: 'CASH', amount: 1_000_000 }), ev('ASSET_ADD', { assetId: 'a', value: 500_000 })]);
  const a = appendEvent(b, ev('ASSET_DEPOSIT', { assetId: 'a', loc: 'CASH', amount: 300_000 }));
  const s = snap(a); assert.equal(s.liquid, 700_000); assert.equal(s.assetsTotal, 800_000); assert.equal(s.consumption, 0); assert.equal(s.netWorth, snap(b).netWorth);
});
test('Penarikan aset: saldo naik, bukan pemasukan, NW tetap', () => {
  const b = run([ev('ASSET_ADD', { assetId: 'a', value: 500_000 })]);
  const a = appendEvent(b, ev('ASSET_WITHDRAW', { assetId: 'a', loc: 'CASH', amount: 200_000 }));
  const s = snap(a); assert.equal(s.liquid, 200_000); assert.equal(s.income, 0); assert.equal(s.netWorth, 500_000);
});
test('Revaluasi: hanya NW & aset berubah', () => {
  const b = run([ev('OPENING', { loc: 'CASH', amount: 100 }), ev('ASSET_ADD', { assetId: 'a', value: 500_000 })]);
  const a = appendEvent(b, ev('ASSET_REVALUE', { assetId: 'a', newValue: 650_000 }));
  const s = snap(a); assert.equal(s.liquid, 100); assert.equal(s.income, 0); assert.equal(s.consumption, 0); assert.equal(s.netWorth, 650_100);
});
test('Tambah aset & tambah utang tidak mengubah saldo', () => {
  const s = snap(run([ev('ASSET_ADD', { assetId: 'a', value: 1000 }), ev('DEBT_ADD', { debtId: 'd', amount: 400 })]));
  assert.equal(s.liquid, 0); assert.equal(s.income, 0); assert.equal(s.netWorth, 600);
});
test('Saldo tidak boleh negatif (ditolak)', () => {
  assert.throws(() => run([ev('EXPENSE', { loc: 'CASH', amount: 1 })]));
});

// Savings Rate
const incomeCase = (nExp, today, expAmt = 100_000) => {
  const list = [ev('INCOME', { amount: 1_000_000, allocations: [{ loc: 'CASH', amount: 1_000_000 }] })];
  for (let i = 0; i < nExp; i++) list.push(ev('EXPENSE', { loc: 'CASH', amount: expAmt }));
  return snap(run(list), { today });
};
test('Savings Rate: tanpa pemasukan -> belum dapat dihitung', () => assert.equal(snap([]).savings.status, 'BELUM_ADA_PEMASUKAN'));
test('Savings Rate: data terbatas (<5 catatan)', () => assert.equal(incomeCase(2, '2026-11-09').savings.status, 'DATA_TERBATAS'));
test('Savings Rate: data terbatas (sebelum hari ke-7)', () => assert.equal(incomeCase(5, '2026-11-05').savings.status, 'DATA_TERBATAS'));
test('Savings Rate: syarat hitung terpenuhi', () => { const s = incomeCase(5, '2026-11-09'); assert.equal(s.savings.status, 'SYARAT_TERPENUHI'); assert.equal(s.savings.value, 50); });
test('Savings Rate: pembayaran utang & transfer tidak dihitung sebagai catatan relevan/konsumsi', () => {
  const list = [ev('INCOME', { amount: 1_000_000, allocations: [{ loc: 'CASH', amount: 1_000_000 }] }), ev('DEBT_ADD', { debtId: 'd', amount: 900_000 })];
  for (let i = 0; i < 4; i++) list.push(ev('DEBT_PAY', { debtId: 'd', loc: 'CASH', amount: 10_000 }));
  list.push(ev('TRANSFER', { from: 'CASH', to: 'REKENING', amount: 1000 }));
  const s = snap(run(list)); assert.equal(s.relevantCount, 1); assert.equal(s.consumption, 0); assert.notEqual(s.savings.status, 'SYARAT_TERPENUHI');
});

// Aset & interpretasi
test('Umur data aset > 30 hari ditampilkan informatif, nilai tidak berubah otomatis', () => {
  const e = run([{ id: 'x', date: '2026-09-01', type: 'ASSET_ADD', assetId: 'a', name: 'Motor', value: 1000 }]);
  const s = snap(e); assert.ok(s.assets[0].ageDays > 30); assert.equal(s.assets[0].value, 1000);
  assert.ok(interpret(s).some((i) => i.id === 'STALE'));
});
test('Aset baru diperbarui: tidak ada pernyataan STALE', () => {
  assert.ok(!interpret(snap(base())).some((i) => i.id === 'STALE'));
});
test('Interpretasi: maks 3, tidak ada kata berlabel, S-LIK bersyarat', () => {
  const e = run([...base(), ev('INCOME', { amount: 500_000, allocations: [] }), { id: 'old', date: '2026-08-01', type: 'ASSET_ADD', assetId: 'z', value: 10 }]);
  const out = interpret(snap(e));
  assert.ok(out.length <= 3);
  const text = JSON.stringify(out).toLowerCase();
  for (const w of ['sehat', 'buruk', 'boros', 'hemat', 'berbahaya', 'severity', 'confidence', 'data cukup']) assert.ok(!text.includes(w), w);
  const paid = [...base(), ev('DEBT_PAY', { debtId: 'd1', loc: 'REKENING', amount: 1_500_000 })];
  const slik = interpret(snap(paid)).find((i) => i.id === 'SLIK');
  assert.match(slik.kondisi, /1,83 kali/); assert.match(slik.dampak, /Bukan proyeksi/);
});
test('Tanpa cicilan aktif: S-LIK tidak dipaksakan', () => {
  const s = snap(run([ev('OPENING', { loc: 'CASH', amount: 100 })])); assert.equal(s.slik, null);
  assert.ok(!interpret(s).some((i) => i.id === 'SLIK'));
});

// Projection consistency
test('Projection: snapshot setelah append == snapshot dari replay penuh (tidak ada data turunan basi)', () => {
  const e = run([...base(), ev('DEBT_PAY', { debtId: 'd1', loc: 'REKENING', amount: 1_500_000 })]);
  assert.deepEqual(snap(e), snap(JSON.parse(JSON.stringify(e))));
});
// VOID
test('VOID: transaksi di-void tidak dihitung, jejak tetap ada; void yang merusak saldo ditolak', () => {
  const o = ev('OPENING', { loc: 'CASH', amount: 1000 }); const x = ev('EXPENSE', { loc: 'CASH', amount: 400 });
  let e = run([o, x]); e = appendEvent(e, ev('VOID', { targetId: x.id }));
  assert.equal(snap(e).liquid, 1000); assert.equal(e.length, 3);
  const e2 = run([o, ev('EXPENSE', { loc: 'CASH', amount: 400 })]);
  assert.throws(() => appendEvent(e2, ev('VOID', { targetId: o.id })));
});
