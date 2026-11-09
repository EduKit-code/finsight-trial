import { rp } from './format.js';
// Aturan deterministik, maks 3 pernyataan. Struktur: Kondisi -> Arti -> Dampak -> Pilihan (+ basis yang bisa dilihat pengguna).
export function interpret(snap) {
  const out = [];
  const { savings: sv } = snap;
  if (sv.status === 'BELUM_ADA_PEMASUKAN') out.push({ id: 'SAVINGS',
    kondisi: 'Belum ada pemasukan tercatat bulan ini.',
    arti: 'Savings Rate belum dapat dihitung dari data yang tersedia.',
    dampak: 'Angka 0% tidak ditampilkan karena akan menyesatkan.',
    pilihan: 'Jika ada pemasukan bulan ini, kamu bisa mencatatnya agar metrik ini terhitung.',
    basis: `Pemasukan ${rp(snap.income)}; pengeluaran konsumsi ${rp(snap.consumption)}.` });
  else out.push({ id: 'SAVINGS',
    kondisi: `Savings Rate bulan ini ${sv.value}%.`,
    arti: sv.status === 'SYARAT_TERPENUHI' ? 'Syarat hitung terpenuhi (syarat teknis penyajian, bukan bukti data lengkap).' : 'Data masih terbatas, angka ini belum mewakili pola keuanganmu.',
    dampak: 'Nilai ini hanya membandingkan pemasukan dan pengeluaran konsumsi yang tercatat.',
    pilihan: 'Kamu bisa melengkapi catatan bulan ini bila ada yang belum masuk.',
    basis: `(${rp(snap.income)} − ${rp(snap.consumption)}) / ${rp(snap.income)}; ${snap.relevantCount} catatan relevan, hari ke-${snap.day}.` });
  if (snap.unplaced > 0) out.push({ id: 'UNPLACED',
    kondisi: `${rp(snap.unplaced)} dari pemasukan belum ditempatkan ke CASH, REKENING, atau E_WALLET.`,
    arti: 'Pemasukan sudah tercatat penuh, tetapi belum menambah saldo lokasi mana pun.',
    dampak: 'Saldo likuid dan Net Worth belum memuat dana ini.',
    pilihan: 'Kamu bisa menempatkannya kapan saja; penempatan tidak dihitung sebagai pemasukan kedua.',
    basis: `Dana belum ditempatkan: ${rp(snap.unplaced)}.` });
  if (snap.slik !== null) out.push({ id: 'SLIK',
    kondisi: `Saldo likuid ${rp(snap.liquid)} sama dengan sekitar ${String(snap.slik).replace('.', ',')} kali nominal cicilan bulanan ${rp(snap.installment)}.`,
    arti: 'Ini hanya perbandingan nominal saldo dan cicilan.',
    dampak: 'Bukan proyeksi ketahanan saldo dan bukan jaminan kemampuan membayar; kebutuhan hidup dan pengeluaran berikutnya tidak diperhitungkan.',
    pilihan: 'Kamu bisa menggunakannya sebagai satu bahan pertimbangan saja.',
    basis: `${rp(snap.liquid)} / ${rp(snap.installment)}.` });
  const stale = snap.assets.filter((a) => a.ageDays > 30);
  if (stale.length) out.push({ id: 'STALE',
    kondisi: `Nilai ${stale.map((a) => a.name).join(', ')} terakhir diperbarui ${Math.max(...stale.map((a) => a.ageDays))} hari lalu.`,
    arti: 'Net Worth memakai nilai terakhir yang kamu catat; nilai tidak diubah otomatis.',
    dampak: 'Net Worth bisa berbeda dari nilai aset saat ini.',
    pilihan: 'Kamu bisa memperbarui nilai aset bila ingin.',
    basis: stale.map((a) => `${a.name}: diperbarui ${a.updatedAt}`).join('; ') });
  return out.slice(0, 3);
}
