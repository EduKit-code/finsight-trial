import { snapshot } from './ledger.js';
import { rp } from './format.js';
const REC = {
  OPENING: (e) => `Saldo awal ${e.loc} ${rp(e.amount)}.`, INCOME: (e) => `Pemasukan ${rp(e.amount)}.`,
  PLACE_INCOME: () => 'Penempatan sisa pemasukan.', EXPENSE: (e) => `Pengeluaran ${rp(e.amount)} dari ${e.loc}.`,
  TRANSFER: (e) => `Transfer ${rp(e.amount)} dari ${e.from} ke ${e.to}.`, ASSET_ADD: (e) => `Aset baru ${e.name || e.assetId} bernilai ${rp(e.value)}.`,
  ASSET_DEPOSIT: (e) => `Setoran ke aset ${rp(e.amount)}.`, ASSET_WITHDRAW: (e) => `Penarikan dari aset ${rp(e.amount)}.`,
  ASSET_REVALUE: (e) => `Pembaruan nilai aset menjadi ${rp(e.newValue)}.`, DEBT_ADD: (e) => `Utang baru ${rp(e.amount)}.`,
  DEBT_PAY: (e) => `Pembayaran utang ${rp(e.amount)}.`,
};
const up = (d, nm, pos = 'bertambah', neg = 'berkurang') => `${nm} ${d > 0 ? pos : neg} ${rp(Math.abs(d))}.`;
// Dibangun dari perbandingan snapshot ledger sebelum/sesudah -> selalu konsisten dengan ledger. Panggil HANYA setelah simpan sukses.
export function buildReceipt(before, after, event, ctx) {
  const a = snapshot(before, ctx); const b = snapshot(after, ctx);
  const changed = []; const unchanged = [];
  const chk = (d, nm, pos, neg) => (d ? changed.push(up(d, nm, pos, neg)) : unchanged.push(nm));
  if (event.type === 'TRANSFER') Object.keys(b.byLoc).forEach((l) => { const d = b.byLoc[l] - a.byLoc[l]; if (d) changed.push(up(d, `Saldo ${l}`)); });
  chk(b.liquid - a.liquid, 'Total saldo likuid');
  chk(b.unplaced - a.unplaced, 'Dana belum ditempatkan');
  chk(b.assetsTotal - a.assetsTotal, 'Nilai aset');
  chk(b.debtsTotal - a.debtsTotal, 'Sisa utang');
  chk(b.income - a.income, 'Pemasukan bulan ini');
  chk(b.consumption - a.consumption, 'Pengeluaran konsumsi');
  chk(b.debtPaid - a.debtPaid, 'Pembayaran utang bulan ini');
  chk(b.netWorth - a.netWorth, 'Net Worth');
  if (a.savings.value === b.savings.value && a.savings.status === b.savings.status) unchanged.push('Savings Rate');
  else changed.push(`Savings Rate: ${b.savings.value === null ? 'belum dapat dihitung' : b.savings.value + '%'}.`);
  return { recorded: REC[event.type](event), changed, unchanged: unchanged.map((x) => (x === 'Net Worth' ? 'Net Worth secara nominal' : x)) };
}
