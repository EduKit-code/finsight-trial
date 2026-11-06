/* FinSight Trial — penyimpanan lokal (IndexedDB). Tidak ada jaringan, tidak ada GAS.
   Basis data tetap `finsight-trial` per origin (Spec v2 koreksi C1). Komit setup atomik lintas store (Spec v2.1 §2.4). */
(function (root) {
  'use strict';
  var DB = 'finsight-trial', VER = 1, APP_VERSION = 'trial-onboarding-0.1.0', SCHEMA = 1;
  var STORES = ['meta', 'onboarding', 'incomeCategories', 'expenseCategories', 'setupDraft', 'opening', 'ledger', 'requests', 'assets', 'debts'];
  var chan = null; try { chan = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('finsight-trial') : null; } catch (e) { chan = null; }
  var db = null, listeners = [];
  /* tag: tandai galat tanpa pernah melempar. DOMException.code bersifat read-only (menulisnya melempar TypeError di mode strict),
     jadi hanya `fsCode` yang ditulis. Galat domain (kode ada di MESSAGES) tidak ditandai sebagai kegagalan penyimpanan. */
  function tag(e, code) {
    var x; try { x = (e instanceof Error) ? e : new Error(String((e && e.message) || e || code)); } catch (_) { x = new Error(code); }
    try {
      var m = String((x && x.message) || '').split(':')[0].trim();
      var isDomain = !!(root.FSDomain && root.FSDomain.MESSAGES && root.FSDomain.MESSAGES[m]);
      if (!isDomain && !x.fsCode) x.fsCode = code;
    } catch (_) { }
    return x;
  }
  function onMessage(fn) { listeners.push(fn); }
  if (chan) chan.onmessage = function (m) { listeners.forEach(function (f) { try { f(m.data); } catch (e) { } }); };
  function notify(kind) { try { if (chan) chan.postMessage({ kind: kind, at: Date.now() }); } catch (e) { } }

  function open() {
    return new Promise(function (resolve, reject) {
      if (db) return resolve(db);
      var idb; try { idb = root.indexedDB; } catch (e) { idb = null; }
      if (!idb) return reject(tag(new Error('IDB_UNAVAILABLE'), 'IDB_UNAVAILABLE'));
      var rq; try { rq = idb.open(DB, VER); } catch (e) { return reject(tag(e, 'IDB_UNAVAILABLE')); }
      rq.onupgradeneeded = function () {
        var d = rq.result;
        d.createObjectStore('meta', { keyPath: 'k' }); d.createObjectStore('onboarding', { keyPath: 'k' });
        d.createObjectStore('incomeCategories', { keyPath: 'key' }); d.createObjectStore('expenseCategories', { keyPath: 'key' });
        d.createObjectStore('setupDraft', { keyPath: 'k' }); d.createObjectStore('opening', { keyPath: 'k' });
        var l = d.createObjectStore('ledger', { keyPath: 'seq', autoIncrement: true }); l.createIndex('requestId', 'requestId', { unique: true });
        d.createObjectStore('requests', { keyPath: 'requestId' }); d.createObjectStore('assets', { keyPath: 'assetId' }); d.createObjectStore('debts', { keyPath: 'debtId' });
      };
      rq.onsuccess = function () {
        db = rq.result; db.onversionchange = function () { try { db.close(); } catch (e) { } db = null; };
        db.onclose = function () { db = null; }; resolve(db);
      };
      rq.onerror = function () { var e = rq.error || new Error('IDB_OPEN_FAILED'); reject(tag(e, e.name === 'VersionError' ? 'SCHEMA_NEWER' : 'IDB_UNAVAILABLE')); };
      rq.onblocked = function () { reject(tag(new Error('IDB_BLOCKED'), 'IDB_BLOCKED')); };
    });
  }
  /* txRun: satu transaksi; body(tx, setResult, abort). Galat di mana pun → tx.abort() dan promise ditolak. */
  function txRun(names, mode, body) {
    return open().then(function (d) {
      return new Promise(function (resolve, reject) {
        var tx, result, failed = null;
        try { tx = d.transaction(names, mode); } catch (e) { return reject(tag(e, 'IDB_WRITE_FAILED')); }
        function abort(e) { try { failed = failed || tag(e, 'IDB_WRITE_FAILED'); } catch (_) { failed = failed || new Error('IDB_WRITE_FAILED'); } try { tx.abort(); } catch (x) { } }
        tx.oncomplete = function () { failed ? reject(failed) : resolve(result); };
        tx.onabort = function () { reject(failed || tag(tx.error || new Error('TX_ABORTED'), 'IDB_WRITE_FAILED')); };
        try { body(tx, function (v) { result = v; }, abort); } catch (e) { abort(e); }
      });
    });
  }
  function G(abort, fn) { return function (ev) { try { fn(ev); } catch (e) { abort(e); } }; }
  function getAllIn(tx, name, cb, abort) { var r = tx.objectStore(name).getAll(); r.onsuccess = G(abort, function () { cb(r.result); }); r.onerror = function () { abort(r.error); }; }
  function getIn(tx, name, key, cb, abort) { var r = tx.objectStore(name).get(key); r.onsuccess = G(abort, function () { cb(r.result); }); r.onerror = function () { abort(r.error); }; }
  function now() { return new Date().toISOString(); }

  function readAll() {
    return txRun(STORES, 'readonly', function (tx, set, abort) {
      var out = {}, pending = STORES.length;
      STORES.forEach(function (n) { getAllIn(tx, n, function (rows) { out[n] = rows; if (--pending === 0) set(out); }, abort); });
    });
  }
  /* Keadaan aplikasi saat dibuka (Spec v2 §4.7 + v2.1 §2.4.2). */
  function resolve() {
    return open().then(readAll).then(function (a) {
      var ob = a.onboarding[0] || null, base = { all: a, ob: ob };
      if (!ob) return Object.assign(base, { view: 'new' });
      if (ob.status === 'completed') {
        if (!a.opening.length) return Object.assign(base, { view: 'anomaly', reason: 'COMPLETED_WITHOUT_OPENING' });
        return Object.assign(base, { view: 'dashboard' });
      }
      if (a.ledger.length > 0 || a.opening.length > 0) return Object.assign(base, { view: 'anomaly', reason: 'COMMIT_RESIDUE' });
      return Object.assign(base, { view: 'wizard', stepId: ob.stepId });
    });
  }
  /* CTA W0: menulis meta + onboarding. Idempotens. */
  function begin() {
    return txRun(['meta', 'onboarding'], 'readwrite', function (tx, set, abort) {
      getIn(tx, 'onboarding', 'main', G(abort, function (ex) {
        if (ex) return set(ex);
        var t = now();
        tx.objectStore('meta').put({ k: 'main', schemaVersion: SCHEMA, profilId: root.FSDomain.newId('profil'), createdAt: t, appVersion: APP_VERSION, impactSeen: true, persist: 'belum-diminta' });
        var ob = { k: 'main', status: 'in_progress', stepId: 'W1', startedAt: t, updatedAt: t }; tx.objectStore('onboarding').put(ob); set(ob);
      }), abort);
    }).then(function (r) { notify('begin'); return r; });
  }
  function setStep(stepId) {
    return txRun(['onboarding'], 'readwrite', function (tx, set, abort) {
      getIn(tx, 'onboarding', 'main', G(abort, function (ob) {
        if (!ob || ob.status !== 'in_progress') return abort(new Error('NOT_IN_PROGRESS'));
        ob.stepId = stepId; ob.updatedAt = now(); tx.objectStore('onboarding').put(ob); set(ob);
      }), abort);
    });
  }
  function catStore(kind) { return kind === 'income' ? 'incomeCategories' : 'expenseCategories'; }
  /* Kategori = konfigurasi, ditulis langsung per aksi (v2.1 §2.4.4). Validasi duplikat dalam transaksi yang sama. */
  function addCategory(kind, input) {
    var st = catStore(kind);
    return txRun([st], 'readwrite', function (tx, set, abort) {
      getAllIn(tx, st, function (rows) {
        var rec = root.FSDomain.validateCategoryInput(kind, input, rows); rec.urutan = rows.length + 1; rec.createdAt = now();
        tx.objectStore(st).put(rec); set(rec);
      }, abort);
    });
  }
  function patchCategory(kind, key, patch) {
    var st = catStore(kind);
    return txRun([st], 'readwrite', function (tx, set, abort) {
      getAllIn(tx, st, function (rows) {
        var cur = rows.filter(function (r) { return r.key === key; })[0]; if (!cur) return abort(new Error('CATEGORY_NOT_FOUND'));
        if (patch.nama !== undefined) {
          var nm = root.FSDomain.cleanName(patch.nama, 'NAME'), n = root.FSDomain.normName(nm);
          if (rows.some(function (r) { return r.key !== key && root.FSDomain.normName(r.nama) === n; })) return abort(new Error('NAME_DUPLICATE'));
          patch.nama = nm;
        }
        Object.keys(patch).forEach(function (k) { cur[k] = patch[k]; }); tx.objectStore(st).put(cur); set(cur);
      }, abort);
    });
  }
  function saveDraft(draft) {
    return txRun(['setupDraft'], 'readwrite', function (tx, set) { draft.k = 'main'; draft.updatedAt = now(); tx.objectStore('setupDraft').put(draft); set(draft); });
  }
  /* KOMIT SETUP (atomik). Syarat: semua tulis berhasil bersama atau tidak ada yang tertulis; `completed` hanya setelah semuanya ada. */
  function commit(firstTx) {
    var names = ['onboarding', 'setupDraft', 'incomeCategories', 'expenseCategories', 'opening', 'ledger', 'requests', 'assets', 'debts'];
    return txRun(names, 'readwrite', function (tx, set, abort) {
      getIn(tx, 'onboarding', 'main', G(abort, function (ob) {
        if (!ob) return abort(new Error('NOT_STARTED'));
        if (ob.status === 'completed') return abort(new Error('ALREADY_COMPLETED')); // compare-and-set (lintas tab)
        getIn(tx, 'setupDraft', 'main', G(abort, function (draft) {
          if (!draft || !draft.opening) return abort(new Error('OPENING_NOT_CONFIRMED'));
          getAllIn(tx, 'incomeCategories', function (inc) {
            getAllIn(tx, 'expenseCategories', function (exp) {
              var prep = root.FSDomain.prepareCommit(draft, firstTx || null, { income: inc, expense: exp }, new Date()), t = now();
              var o = prep.opening; o.k = 'main'; o.confirmedAt = draft.opening.confirmedAt; o.committedAt = t; tx.objectStore('opening').put(o);
              var assets = draft.assets || [], debts = draft.debts || [];
              prep.events.forEach(function (e) {
                tx.objectStore('ledger').add({ requestId: e.requestId, type: e.type, data: e.data, result: e.result, status: 'COMMITTED', createdAt: t });
                tx.objectStore('requests').put({ requestId: e.requestId, result: e.result });
              });
              assets.forEach(function (a) { tx.objectStore('assets').put({ assetId: a.id, name: a.name, value: Number(a.value), contribution: Number(a.contribution) }); });
              prep.state && Object.keys(prep.state.debts).forEach(function (id) { var d = prep.state.debts[id]; tx.objectStore('debts').put({ debtId: id, name: d.name, principal: d.principal, remaining: d.remaining, mode: d.mode, installment: d.installment, status: d.status }); });
              tx.objectStore('setupDraft').delete('main');
              ob.status = 'completed'; ob.stepId = 'W8'; ob.completedAt = t; ob.updatedAt = t; tx.objectStore('onboarding').put(ob);
              set({ events: prep.events });
            }, abort);
          }, abort);
        }), abort);
      }), abort);
    }).then(function (r) { notify('commit'); return r; });
  }
  /* Proyeksi assets/debts = cache turunan ledger; bila beda dari replay → replay menang (Spec v2 §7). */
  function rebuildProjections(state) {
    return txRun(['assets', 'debts'], 'readwrite', function (tx, set, abort) {
      getAllIn(tx, 'assets', function (A) { getAllIn(tx, 'debts', function (D) {
        var wantA = Object.keys(state.assets).map(function (id) { var a = state.assets[id]; return { assetId: id, name: a.name, value: a.value, contribution: a.contribution }; });
        var wantD = Object.keys(state.debts).map(function (id) { var d = state.debts[id]; return { debtId: id, name: d.name, principal: d.principal, remaining: d.remaining, mode: d.mode, installment: d.installment, status: d.status }; });
        var norm = function (x, k) { return JSON.stringify(x.slice().sort(function (p, q) { return p[k] < q[k] ? -1 : 1; })); };
        var same = norm(A, 'assetId') === norm(wantA, 'assetId') && norm(D, 'debtId') === norm(wantD, 'debtId');
        if (!same) { tx.objectStore('assets').clear(); tx.objectStore('debts').clear(); wantA.forEach(function (a) { tx.objectStore('assets').put(a); }); wantD.forEach(function (d) { tx.objectStore('debts').put(d); }); }
        set(!same);
      }, abort); }, abort);
    });
  }
  function updateMeta(patch) {
    return txRun(['meta'], 'readwrite', function (tx, set, abort) {
      getIn(tx, 'meta', 'main', G(abort, function (m) { if (!m) return set(null); Object.keys(patch).forEach(function (k) { m[k] = patch[k]; }); tx.objectStore('meta').put(m); set(m); }), abort);
    });
  }
  function reset() {
    return new Promise(function (resolve, reject) {
      try { if (db) { db.close(); db = null; } } catch (e) { }
      var r = root.indexedDB.deleteDatabase(DB);
      r.onsuccess = function () { notify('reset'); resolve(true); };
      r.onerror = function () { reject(tag(r.error, 'IDB_WRITE_FAILED')); };
      r.onblocked = function () { reject(tag(new Error('IDB_BLOCKED'), 'IDB_BLOCKED')); };
    });
  }
  root.FSStore = { DB: DB, STORES: STORES, open: open, resolve: resolve, readAll: readAll, begin: begin, setStep: setStep, addCategory: addCategory, patchCategory: patchCategory, saveDraft: saveDraft, commit: commit, rebuildProjections: rebuildProjections, updateMeta: updateMeta, reset: reset, onMessage: onMessage };
})(window);
