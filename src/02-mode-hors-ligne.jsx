// ═══ MODULE ═══
// @module Mode hors ligne
// @depends —
// @exports HL_EVT, _hlNetBadUntil, hlCacheAll, hlCachePut, hlClearCache, hlKeys, hlMeta, hlNetDown
//   hlOffline, hlOfflineAllowed, hlOfflineSession, hlOfflineWhyNot, hlOverlay, hlPendAll
//   hlPendDel, hlPendMark, hlPinMark, hlPinValid, hlSaveMeta
// ═══ FIN DE L'EN-TÊTE ═══
// ── Chantier H : hors-ligne étendu ──────────────────────────────────────────
// 1) Cache local (IndexedDB) de la dernière version connue de chaque catégorie de données.
// 2) Journal des modifications NON synchronisées : quand une sauvegarde échoue (pas de réseau),
//    l'état local complet de la catégorie est gardé sur l'appareil, avec la version de référence ;
//    au démarrage suivant (en ligne), il est refusionné avec le serveur (fusion par identifiant :
//    jamais de doublon) puis resauvegardé.
// 3) Démarrage sans réseau : possible seulement si cet appareil a déjà ouvert l'application en
//    ligne (session présente, double authentification déjà passée) ; efface au déconnexion.
const HL_META_KEY = "compta-plus-hl-meta";
const HL_EVT = "compta-plus-hl-change";
let _hlDbP = null;
function hlDb() {
  if (_hlDbP) return _hlDbP;
  _hlDbP = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const rq = indexedDB.open("compta-plus-offline-v1", 1);
      rq.onupgradeneeded = () => { try { rq.result.createObjectStore("kv"); } catch (e) { /* ignoré */ } };
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => resolve(null);
      rq.onblocked = () => resolve(null);
    } catch (e) { resolve(null); }
  });
  return _hlDbP;
}
function hlTx(mode, fn) {
  return hlDb().then((db) => new Promise((resolve) => {
    if (!db) return resolve(null);
    try {
      const tx = db.transaction("kv", mode);
      let out = null;
      const r = fn(tx.objectStore("kv"));
      if (r) r.onsuccess = () => { out = r.result; };
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch (e) { resolve(null); }
  }));
}
const hlPut = (k, v) => hlTx("readwrite", (st) => st.put(v, k));
const hlGetK = (k) => hlTx("readonly", (st) => st.get(k));
const hlDelK = (k) => hlTx("readwrite", (st) => st.delete(k));
const hlNotify = () => { try { window.dispatchEvent(new Event(HL_EVT)); } catch (e) { /* ignoré */ } };
async function hlKeys(prefix) {
  const r = await hlTx("readonly", (st) => st.getAllKeys(IDBKeyRange.bound(prefix, prefix + "￿")));
  return Array.isArray(r) ? r : [];
}
const hlCachePut = (cid, cat, rec) => hlPut(`cache:${cid}:${cat}`, rec);
async function hlCacheAll(cid) {
  const out = {};
  const pre = `cache:${cid}:`;
  for (const k of await hlKeys(pre)) { const v = await hlGetK(k); if (v) out[k.slice(pre.length)] = v; }
  return out;
}
async function hlPendAll(cid) {
  const out = {};
  const pre = `pend:${cid}:`;
  for (const k of await hlKeys(pre)) { const v = await hlGetK(k); if (v) out[k.slice(pre.length)] = v; }
  return out;
}
async function hlPendDel(cid, cat) { const had = await hlGetK(`pend:${cid}:${cat}`); if (had) { await hlDelK(`pend:${cid}:${cat}`); hlNotify(); } }
function hlMini(snap) {
  if (Array.isArray(snap)) return snap.map((x) => (x && typeof x === "object" ? { id: x.id, code: x.code, stock: x.stock } : x));
  if (snap && typeof snap === "object") return Object.keys(snap);
  return [];
}
async function hlPendMark(cid, cat, value, snapshot, baseV) {
  const key = `pend:${cid}:${cat}`;
  const old = await hlGetK(key);
  const rec = old && old.baseline !== undefined ? { ...old, data: value, ts: Date.now() } : { ts: Date.now(), baseV: baseV || 0, baseline: hlMini(snapshot), data: value };
  await hlPut(key, rec);
  hlNotify();
}
async function hlClearCache() {
  for (const k of await hlKeys("cache:")) await hlDelK(k);
  try { localStorage.removeItem(HL_META_KEY); } catch (e) { /* ignoré */ }
  hlPinClear();
}
function hlSaveMeta(membership) {
  try {
    if (!membership || !membership.companyId || !membership.email || membership.needsCompanyPick) return;
    localStorage.setItem(HL_META_KEY, JSON.stringify({ email: membership.email, companyId: membership.companyId, membership, savedAt: Date.now(), bootOk: true }));
  } catch (e) { /* ignoré */ }
}
function hlMeta() { try { return JSON.parse(localStorage.getItem(HL_META_KEY) || "null"); } catch (e) { return null; } }
function hlHasAuthToken() { try { return Object.keys(localStorage).some((k) => /^sb-.*-auth-token$/.test(k)); } catch (e) { return false; } }
// Code PIN d'entreprise et hors ligne : le PIN ne peut être vérifié que par le serveur. Quand il a été saisi
// correctement EN LIGNE sur cet appareil, on garde une trace (entreprise + compte + heure) qui autorise
// l'ouverture hors ligne pendant 7 jours ; au-delà, il faut le ressaisir avec internet.
// La trace disparaît à la déconnexion. Elle ne contient jamais le PIN lui-même.
const HL_PIN_DAYS = 7;
const HL_PIN_PREFIX = "compta-plus-pin-offline-";
function hlPinMark(cid, email) { try { if (cid && email) localStorage.setItem(HL_PIN_PREFIX + cid, JSON.stringify({ email, t: Date.now() })); } catch (e) { /* ignoré */ } }
function hlPinValid(cid, email) {
  try {
    const r = JSON.parse(localStorage.getItem(HL_PIN_PREFIX + cid) || "null");
    if (!r || !email || r.email !== email) return false;
    const age = Date.now() - Number(r.t);
    return age >= -60000 && age < HL_PIN_DAYS * 86400000;
  } catch (e) { return false; }
}
function hlPinClear() { try { Object.keys(localStorage).filter((k) => k.indexOf(HL_PIN_PREFIX) === 0).forEach((k) => localStorage.removeItem(k)); } catch (e) { /* ignoré */ } }
// Démarrage hors ligne autorisé ? (jamais sans session déjà ouverte sur cet appareil)
const hlOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;
// Après un premier échec de réseau « instable », on évite de réattendre chaque appel pendant une minute.
let _hlNetBadUntil = 0;
const hlNetDown = () => hlOffline() || Date.now() < _hlNetBadUntil;
// Pourquoi le démarrage hors ligne est impossible (pour un message clair plutôt qu'un chargement sans fin).
function hlOfflineWhyNot() {
  const m = hlMeta();
  if (!m || !m.bootOk || !m.membership) return "Cet appareil n'a pas encore ouvert Compta+ en ligne depuis la dernière mise à jour. Connectez-vous une première fois avec internet, puis l'ouverture hors ligne sera possible.";
  if (!hlHasAuthToken()) return "Votre session n'est plus enregistrée sur cet appareil. Reconnectez-vous une fois avec internet.";
  if (m.membership.hasSecurityPin && !hlPinValid(m.membership.companyId, m.email)) return "Cette entreprise est protégée par un code PIN. Il n'a pas été saisi sur cet appareil depuis moins de " + HL_PIN_DAYS + " jours : connectez-vous avec internet et saisissez-le une fois ; l'ouverture sans internet sera ensuite possible pendant " + HL_PIN_DAYS + " jours.";
  return "";
}
// force = true : ignore l'état « en ligne » du navigateur (réseau instable : connecté mais sans accès réel).
function hlOfflineAllowed(force) {
  if (!force && !hlOffline()) return null;
  const m = hlMeta();
  if (!m || !m.bootOk || !m.email || !m.membership || !hlHasAuthToken()) return null;
  if (m.membership.hasSecurityPin && !hlPinValid(m.membership.companyId, m.email)) return null; // PIN non saisi en ligne sur cet appareil depuis moins de 7 jours
  return m;
}
function hlOfflineSession(force) { const m = hlOfflineAllowed(force); return m ? { user: { id: m.membership.userId || "offline", email: m.email }, offline: true } : null; }
function hlMergeByKey(serverArr, localArr, keyFn, baselineArr) {
  const baseline = Array.isArray(baselineArr) ? baselineArr : [];
  const keyOf = (item) => item && keyFn(item);
  const baselineKeys = new Set(baseline.map(keyOf).filter((k) => k !== undefined && k !== null));
  const localKeys = new Set(localArr.map(keyOf).filter((k) => k !== undefined && k !== null));
  const deleted = new Set([...baselineKeys].filter((k) => !localKeys.has(k)));
  const map = new Map();
  serverArr.forEach((item) => { const k = keyOf(item); if (k !== undefined && k !== null && !deleted.has(k)) map.set(k, item); });
  localArr.forEach((item) => { const k = keyOf(item); if (k !== undefined && k !== null) map.set(k, item); });
  return Array.from(map.values());
}
// Refusionne une modification locale non synchronisée avec l'état du serveur.
function hlOverlay(cat, serverData, serverV, rec, keyFn) {
  if (!rec) return { kind: "none" };
  const local = rec.data;
  const same = (a, b) => { try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; } };
  if (Array.isArray(local)) {
    const srv = Array.isArray(serverData) ? serverData : [];
    let merged = hlMergeByKey(srv, local, keyFn, rec.baseline);
    if (cat === "products") {
      const baseById = new Map((rec.baseline || []).map((x) => [x && x.id, x]));
      const srvById = new Map(srv.map((x) => [x && x.id, x]));
      merged = merged.map((item) => {
        const b = baseById.get(item.id), sv = srvById.get(item.id);
        if (!b || !sv) return item;
        const localUntouched = (Number(item.stock) || 0) === (Number(b.stock) || 0);
        const serverMoved = (Number(sv.stock) || 0) !== (Number(b.stock) || 0);
        return localUntouched && serverMoved ? { ...item, stock: sv.stock } : item;
      });
    }
    return same(merged, srv) ? { kind: "none" } : { kind: "merged", data: merged };
  }
  if (local && typeof local === "object") {
    if (cat === "productImages") {
      const srvObj = serverData && typeof serverData === "object" && !Array.isArray(serverData) ? serverData : {};
      const merged = { ...srvObj };
      (Array.isArray(rec.baseline) ? rec.baseline : []).forEach((k) => { if (!(k in local)) delete merged[k]; });
      Object.assign(merged, local);
      return same(merged, srvObj) ? { kind: "none" } : { kind: "merged", data: merged };
    }
    if ((rec.baseV || 0) === (serverV || 0)) return same(local, serverData) ? { kind: "none" } : { kind: "merged", data: local };
    return { kind: "conflict" };
  }
  return { kind: "none" };
}

