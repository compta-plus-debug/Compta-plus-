// Fenêtre de scan de code-barres/QR via la caméra du téléphone/ordinateur. Utilise la
// bibliothèque html5-qrcode chargée en CDN (window.Html5Qrcode). Appelle onScan(code) dès
// qu'un code est détecté, puis se ferme automatiquement.
//
// stop() lève une exception SYNCHRONE (pas seulement une promesse rejetée) si on
// l'appelle alors que le scanner n'est pas encore pleinement démarré (caméra encore
// en cours d'initialisation) — un simple .catch() sur la promesse ne suffit donc pas à
// l'intercepter, il faut aussi envelopper l'appel lui-même dans un try/catch.
const safeStopScanner = (instance) => {
  try {
    const result = instance.stop();
    if (result && typeof result.then === "function") {
      result.then(() => { try { instance.clear(); } catch (e) {} }).catch(() => {});
    }
  } catch (e) {
    // Rien à arrêter (pas encore démarré, déjà arrêté...) : sans conséquence.
  }
};

function BarcodeScannerModal({ onScan, onClose }) {
  const [error, setError] = useState("");
  const scannerRef = React.useRef(null);
  const stoppedRef = React.useRef(false);

  useEffect(() => {
    if (typeof window.Html5Qrcode === "undefined") {
      setError("Le module de scan n'a pas pu se charger (vérifiez votre connexion internet), utilisez la saisie manuelle.");
      return;
    }
    const html5QrCode = new window.Html5Qrcode("barcode-scanner-view");
    scannerRef.current = html5QrCode;
    html5QrCode
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 150 } },
        (decodedText) => {
          if (stoppedRef.current) return;
          stoppedRef.current = true;
          safeStopScanner(html5QrCode);
          onScan(decodedText);
        },
        () => {} // erreurs image par image (aucun code détecté) : ignorées, normal en continu
      )
      .catch(() => {
        setError("Impossible d'accéder à la caméra. Vérifiez que vous avez autorisé l'accès, ou utilisez la saisie manuelle.");
      });
    return () => {
      if (!stoppedRef.current) {
        stoppedRef.current = true;
        safeStopScanner(html5QrCode);
      }
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }}>
      <div className="bg-white rounded-lg p-5 w-full max-w-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-medium" style={{ color: "#152238" }}>Scanner un code</div>
          <button onClick={onClose} style={{ color: "#8A8370" }}><X size={18} /></button>
        </div>
        {error ? (
          <div className="text-xs py-6 text-center" style={{ color: "#A6432F" }}>{sanitizeUserMessage(error)}</div>
        ) : (
          <>
            <div id="barcode-scanner-view" className="rounded overflow-hidden" style={{ background: "#000" }} />
            <p className="text-xs mt-3 text-center" style={{ color: "#8A8370" }}>Visez le code-barres ou le QR code avec la caméra.</p>
          </>
        )}
        <button onClick={onClose} className="w-full mt-3 py-2 rounded text-sm" style={{ border: "1px solid #DDD6C4", color: "#152238" }}>
          Annuler
        </button>
      </div>
    </div>
  );
}

// =====================================================================
// Vente hors ligne — file d'attente locale + synchronisation sûre
// Principe : hors connexion, la vente est gardée sur l'appareil (localStorage) avec un numéro
// PROVISOIRE (HL-…). Au retour du réseau, chaque vente est rejouée dans l'ordre : vrai numéro de
// facture (compteur atomique), stock vérifié et décrémenté de façon atomique, puis facture +
// écritures ajoutées ; la vente ne quitte la file qu'une fois CONFIRMÉE côté serveur.
// =====================================================================
const OFL_EVT = "compta-plus-ofl-change";
const oflKey = () => "compta-plus-offline-sales-" + ((typeof _membership !== "undefined" && _membership && _membership.companyId) || "local");
function oflLoad() { try { const a = JSON.parse(localStorage.getItem(oflKey()) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function oflNotify() { try { window.dispatchEvent(new Event(OFL_EVT)); } catch (e) { /* ignoré */ } }
function oflSave(arr) { try { localStorage.setItem(oflKey(), JSON.stringify(arr)); oflNotify(); return true; } catch (e) { return false; } }
function oflEnqueue(item) { const q = oflLoad(); q.push(item); return oflSave(q); }
function oflPatch(qid, patch) { const q = oflLoad(); const i = q.findIndex((x) => x.qid === qid); if (i < 0) return null; q[i] = { ...q[i], ...patch }; oflSave(q); return q[i]; }
function oflRemove(qid) { oflSave(oflLoad().filter((x) => x.qid !== qid)); }
function oflProvisionalNumber() {
  let dev = "X";
  try { dev = (localStorage.getItem("compta-plus-device-id") || "X").replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase() || "X"; } catch (e) { /* ignoré */ }
  const k = oflKey() + "-seq"; let n = 0;
  try { n = (Number(localStorage.getItem(k)) || 0) + 1; localStorage.setItem(k, String(n)); } catch (e) { n = Date.now() % 100000; }
  return `HL-${dev}-${String(n).padStart(4, "0")}`;
}
function oflIsNetworkError(e) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (!e) return false;
  if (e.status === 0) return true;
  const m = String((e && e.message) || e);
  return !e.code && /failed to fetch|networkerror|network request|load failed|fetch failed|timeout|timed out|internet|abort|offline|pas de réponse/i.test(m);
}
// Quantités déjà « promises » par les ventes hors ligne dont le stock n'est pas encore décrémenté sur le serveur
function oflReserved(queue) {
  const m = {};
  (queue || []).forEach((it) => { if (!it.stockDone) (it.stockLines || []).forEach((l) => { m[l.productId] = (m[l.productId] || 0) + (Number(l.qty) || 0); }); });
  return m;
}
function oflFinal(it) {
  const prov = it.provNumber, num = it.number;
  const rep = (s) => (typeof s === "string" && prov && prov !== num ? s.split(prov).join(num) : s);
  return { invoice: { ...it.invoice, number: num }, entries: (it.entries || []).map((e) => ({ ...e, label: rep(e.label) })) };
}
// Un réseau « connecté mais sans internet » (Wi-Fi sans accès, données mobiles épuisées) laisse les requêtes
// pendantes très longtemps : on abandonne l'attente au bout de quelques secondes et on passe en mode hors ligne.
function oflTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout: pas de réponse du réseau")), ms || 7000);
    Promise.resolve(promise).then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
const oflCompanyId = async () => (_membership && _membership.companyId) || (await oflTimeout(resolveMembership(), 6000)).companyId;
let _oflSyncing = false;
async function oflSyncAll(ctx) {
  if (_oflSyncing) return { skipped: true };
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { offline: true };
  if (oflLoad().length === 0) return { done: 0, failed: 0, conflicts: 0 };
  _oflSyncing = true;
  let done = 0, failed = 0, conflicts = 0;
  try {
    const companyId = (typeof _membership !== "undefined" && _membership && _membership.companyId) || (await oflTimeout(ctx.resolveMembership(), 8000)).companyId;
    for (const q0 of oflLoad()) {
      let it = oflLoad().find((x) => x.qid === q0.qid);
      if (!it) continue;
      try {
        // 1. vrai numéro de facture
        if (!it.numberReal) {
          const { data: n, error } = await oflTimeout(ctx.supabase.rpc("next_invoice_number", { target_company_id: companyId }), 12000);
          if (error) throw error;
          it = oflPatch(it.qid, { provNumber: it.provNumber || it.number, number: "F" + String(n).padStart(4, "0"), numberReal: true });
        }
        // 2. stock : vérifié et décrémenté de façon atomique côté base (une seule fois)
        if ((it.stockLines || []).length > 0 && !it.stockDone) {
          let already = false;
          if (it.stockAttempted) {
            // une tentative précédente a peut-être réussi sans que la réponse nous parvienne
            const res = await oflTimeout(ctx.storageGet("compta-movements"), 12000);
            if (res && res.value) { const d = ctx.unwrap(JSON.parse(res.value)).data; already = Array.isArray(d) && d.some((m) => m.invoiceId === it.invId); }
          }
          if (already) { it = oflPatch(it.qid, { stockDone: true, stockMode: "server" }); }
          else {
            it = oflPatch(it.qid, { stockAttempted: true });
            const { data: r, error } = await oflTimeout(ctx.supabase.rpc("commit_sale_stock", { target_company_id: companyId, sale_lines: it.stockLines.map((l) => ({ productId: l.productId, qty: l.qty })), p_invoice_id: it.invId, p_invoice_number: it.number, p_date: it.date }), 15000);
            if (error) throw error;
            if (r && r.ok) it = oflPatch(it.qid, { stockDone: true, stockMode: "server" });
            else {
              // Stock devenu insuffisant entre-temps : la marchandise est DÉJÀ sortie, la vente est réelle.
              // On la comptabilise quand même et on signale l'écart à vérifier.
              const det = ((r && r.insufficient) || []).map((i) => `${i.name} (${i.available} dispo, ${i.requested} vendu)`).join(", ");
              it = oflPatch(it.qid, { stockDone: true, stockMode: "local", conflict: det || "stock insuffisant" });
              conflicts++;
            }
          }
        }
        // 3. état local : produits/mouvements puis facture + écritures (idempotent par identifiant)
        if (it.stockMode === "server") { try { await ctx.refreshStock(); } catch (e) { /* rattrapé au prochain rechargement */ } }
        else if (it.stockMode === "local" && !it.localStockApplied) {
          try { await ctx.refreshStock(); } catch (e) { /* l'état local sert de repli */ }
          ctx.applyLocalStock(it);
          it = oflPatch(it.qid, { localStockApplied: true });
        }
        const fin = oflFinal(it);
        if (it.conflict) fin.invoice = { ...fin.invoice, offlineNote: `Vendue hors ligne — stock insuffisant à la synchronisation : ${it.conflict}. Vérifiez l'inventaire.` };
        ctx.addSale(fin);
        // 4. la vente ne quitte la file qu'une fois confirmée sur le serveur
        const ok = await ctx.confirm(fin);
        if (ok) { oflRemove(it.qid); done++; ctx.logAudit && ctx.logAudit("Vente", "Vente hors ligne synchronisée", `${it.provNumber || ""} → ${it.number}`); if (ctx.verifyLater) ctx.verifyLater(fin, it); }
        else { failed++; oflPatch(it.qid, { lastError: "Confirmation en attente de réseau" }); }
      } catch (e) {
        failed++; oflPatch(it.qid, { lastError: friendlyError(e) });
        if (oflIsNetworkError(e)) break; // réseau retombé : on s'arrête, reprise automatique
      }
    }
  } catch (e) { failed++; }
  finally { _oflSyncing = false; oflNotify(); }
  return { done, failed, conflicts };
}


function OflPanel({ queue, offline, syncing, onSync, onPrint, onDiscard, canEdit }) {
  if (!offline && queue.length === 0) return null;
  return (
    <div className="mb-4 rounded-lg p-3 text-sm no-print" data-ofl="panel" style={{ background: offline ? "#FFF6E0" : "#EAF3EE", border: "1px solid #E4DFD1", color: "#152238" }}>
      <div className="font-medium" data-ofl="status">
        {offline ? "📶 Mode hors ligne — vous pouvez continuer à vendre : les ventes sont gardées sur cet appareil et synchronisées automatiquement au retour de la connexion." : `⏳ ${queue.length} vente(s) hors ligne en attente de synchronisation.`}
      </div>
      {queue.length > 0 && (
        <div className="mt-2">
          <div className="text-xs mb-1" style={{ color: "#7A7460" }}>{queue.length} vente(s) en attente{offline ? "" : " — synchronisation en cours ou à relancer"} : le stock affiché tient déjà compte de ces ventes.</div>
          <div style={{ overflowX: "auto" }}>
            <table className="w-full text-xs" style={{ minWidth: 420 }}>
              <tbody>
                {queue.map((it) => (
                  <tr key={it.qid} data-ofl="row" style={{ borderTop: "1px solid #EEE9DA" }}>
                    <td className="py-1 pr-2 font-medium">{it.number}</td>
                    <td className="py-1 pr-2">{it.invoice && it.invoice.client}</td>
                    <td className="py-1 pr-2 tabular">{fmt(it.invoice ? it.invoice.total : 0)}</td>
                    <td className="py-1 pr-2" style={{ color: it.lastError ? "#A6432F" : "#7A7460" }}>{it.lastError ? "En attente — " + it.lastError : (it.numberReal ? "Numéro attribué" : "Numéro provisoire")}</td>
                    <td className="py-1"><button className="px-2 py-0.5 rounded" style={{ border: "1px solid #DDD6C4", background: "#fff" }} data-ofl="print" onClick={() => onPrint(it)}>Reçu</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!offline && <button className="mt-2 px-3 py-1 rounded text-xs" style={{ background: "#152238", color: "#fff", opacity: syncing ? 0.6 : 1 }} data-ofl="sync" disabled={syncing} onClick={onSync}>{syncing ? "Synchronisation…" : "Synchroniser maintenant"}</button>}
        </div>
      )}
    </div>
  );
}

