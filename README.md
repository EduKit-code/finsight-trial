# FinSight Trial
Trial FinSight: onboarding (W0–W7) + Dashboard (catat transaksi, cashflow, riwayat, kelola aset & utang).
Data hanya di IndexedDB browser. Tidak ada GAS, workbook, atau jaringan keluar (CSP `connect-src 'self'`).

- `assets/engine/FinSightVNextEngine.js` — engine produksi, **jangan diubah** (SHA-256 harus sama dengan produksi).
- `assets/domain.js`, `store.js`, `app.js` — onboarding + dashboard dasar (deployment dpl_Hp6UXv…).
- `assets/ledger.js` — ekstensi ledger: ALLOCATE_INCOME, DEBT_PAYMENT, REVALUE_ASSET, TRANSFER, DCA, WD.
- `assets/tracker.js` — UI pasca-onboarding, menempel ke Dashboard lewat MutationObserver.
- `test/` — `cd test && node ledger.test.js` (memakai salinan subset engine/domain, bukan file deploy).

Deploy: root repo = root deployment Vercel (statis, tanpa build). Jangan deploy Production tanpa persetujuan Owner.
