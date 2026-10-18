// ═══ MODULE ═══
// @module Compta revision et cloture
// @depends EC_BALANCE_COLS, EC_JOURNAL_COLS, EC_PLAN_COLS, EC_TARGETS, FileDown, _membership
//   applyLettrage, bankRecoCompute, bkBuildFile, ecBalanceRows, ecChecks, ecCsv, ecDownloadCsv
//   ecFmt, ecJournalRows, ecPlanRows, ecSortEntries, fmt, lettrageLines, lettrageSuggest
//   nextLetterCode, rcR2, removeLettrage, rpSave, stockReconcile, supabase, todayStr, uid
//   useEffect, useMemo, useState
// @exports AffectationResultatPanel, BankReconciliationPanel, ClotureAnnuellePanel, LettragePanel
//   RevisionPanel
// ═══ FIN DE L'EN-TÊTE ═══
function RevisionPanel({ accounts, entries, invoices, settings, role, isAccountant, companyId, currentUserEmail, showToast, logAudit }) {
  const canEdit = role === "Administrateur" || role === "Éditeur";
  const [comments, setComments] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [sqlMissing, setSqlMissing] = useState(false);
  const [filter, setFilter] = useState("ouvert");
  const [form, setForm] = useState({ type: "general", ref: "", body: "" });
  const [busy, setBusy] = useState(false);
  const me = (currentUserEmail || "").toLowerCase();
  const checks = useMemo(() => ecChecks(accounts, entries), [accounts, entries]);
  const recentEntries = useMemo(() => ecSortEntries(entries).slice(-200).reverse(), [entries]);
  const company = (settings?.companyName || "export").replace(/\s+/g, "");

  const load = async () => {
    if (!companyId) return;
    try {
      const { data, error } = await supabase.from("compta_comments").select("*").eq("company_id", companyId).order("created_at", { ascending: false }).limit(300);
      if (error) {
        const msg = String(error.message || error.code || "");
        if (error.code === "42P01" || /compta_comments|schema cache|does not exist/i.test(msg)) { setSqlMissing(true); setLoadErr(""); }
        else setLoadErr("Impossible de charger les commentaires pour le moment. Vérifiez votre connexion puis actualisez.");
        setComments([]);
        return;
      }
      setSqlMissing(false); setLoadErr(""); setComments(data || []);
    } catch (e) {
      setLoadErr("Impossible de charger les commentaires pour le moment. Vérifiez votre connexion puis actualisez.");
      setComments([]);
    }
  };
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [companyId]); // eslint-disable-line

  const targetLabel = (c) => {
    if (c.target_type === "entry") {
      const e = (entries || []).find((x) => x.id === c.target_ref);
      return e ? `Écriture du ${e.date} — ${e.label || ""}` : "Écriture (introuvable ou supprimée)";
    }
    if (c.target_type === "invoice") {
      const inv = (invoices || []).find((x) => x.id === c.target_ref || x.number === c.target_ref);
      return inv ? `Facture ${inv.number} — ${inv.client || ""}` : `Facture ${c.target_ref || ""}`;
    }
    if (c.target_type === "account") return `Compte ${c.target_ref || ""}`;
    if (c.target_type === "period") return `Période ${c.target_ref || ""}`;
    return "Général";
  };

  const add = async () => {
    const body = form.body.trim();
    if (!body) { showToast("Écrivez d'abord votre commentaire."); return; }
    if (form.type !== "general" && !String(form.ref || "").trim()) { showToast("Précisez l'élément concerné (ou choisissez « Général »)."); return; }
    setBusy(true);
    try {
      const { error } = await supabase.from("compta_comments").insert({
        company_id: companyId, author_email: currentUserEmail || "inconnu", body,
        target_type: form.type, target_ref: form.type === "general" ? null : String(form.ref).trim(),
      });
      if (error) { showToast(/compta_comments|schema cache|does not exist/i.test(String(error.message)) ? "Les commentaires ne sont pas encore disponibles sur votre compte. Contactez le support." : "Le commentaire n'a pas pu être enregistré. Réessayez."); }
      else { setForm({ type: "general", ref: "", body: "" }); showToast("Commentaire ajouté."); try { logAudit("Révision", "Commentaire ajouté", body.slice(0, 60)); } catch (e) {} await load(); }
    } catch (e) { showToast("Le commentaire n'a pas pu être enregistré. Réessayez."); }
    setBusy(false);
  };
  const setStatus = async (c, status) => {
    const upd = status === "résolu" ? { status, resolved_at: new Date().toISOString(), resolved_by: currentUserEmail || null } : { status, resolved_at: null, resolved_by: null };
    const { error } = await supabase.from("compta_comments").update(upd).eq("id", c.id);
    if (error) { showToast("Action impossible pour le moment."); return; }
    try { logAudit("Révision", status === "résolu" ? "Commentaire résolu" : "Commentaire rouvert", String(c.body).slice(0, 60)); } catch (e) {}
    load();
  };
  const remove = async (c) => {
    if (!window.confirm("Supprimer ce commentaire ?")) return;
    const { error } = await supabase.from("compta_comments").delete().eq("id", c.id);
    if (error) { showToast("Suppression impossible pour le moment."); return; }
    load();
  };

  const doExport = (kind) => {
    const d = todayStr();
    if (kind === "journal") ecDownloadCsv(`journal-normalise-${company}-${d}.csv`, ecCsv(EC_JOURNAL_COLS, ecJournalRows(entries, accounts, settings?.currency)));
    else if (kind === "balance") ecDownloadCsv(`balance-${company}-${d}.csv`, ecCsv(EC_BALANCE_COLS, ecBalanceRows(accounts, entries)));
    else ecDownloadCsv(`plan-comptable-${company}-${d}.csv`, ecCsv(EC_PLAN_COLS, ecPlanRows(accounts)));
    showToast("Export généré.");
    try { logAudit("Révision", "Export normalisé", kind); } catch (e) {}
  };

  const shown = (comments || []).filter((c) => filter === "tous" || c.status === filter);
  const openCount = (comments || []).filter((c) => c.status === "ouvert").length;

  return (
    <div data-ec="revision" data-ro-ok="1" className="grid gap-4" style={{ minWidth: 0 }}>
      <div className="rounded-lg p-4 text-sm" style={{ background: isAccountant ? "#E6F1EE" : "#FAF8F1", border: "1px solid #E4DFD1", color: "#152238" }}>
        {isAccountant
          ? <><b>Accès expert-comptable</b> — consultation en lecture seule. Vous pouvez exporter les données et laisser des commentaires à l'entreprise ; vous ne pouvez rien modifier.</>
          : <><b>Révision par votre cabinet</b> — invitez votre expert-comptable (Administration → Utilisateurs → rôle « Expert-comptable »). Il consulte tout en lecture seule, exporte le journal et la balance, et vous laisse ses remarques ici.</>}
      </div>

      <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}>
        <div className="text-sm font-medium mb-2" style={{ color: "#152238" }}>Contrôles avant transmission</div>
        <ul className="text-xs grid gap-1" style={{ color: "#5C6B8C" }}>
          <li data-ec="chk-balance" style={{ color: checks.balanced ? "#0F6B5C" : "#A6432F" }}>{checks.balanced ? "✓" : "✗"} Journal {checks.balanced ? "équilibré" : "DÉSÉQUILIBRÉ"} : débit {ecFmt(checks.totalDebit)} / crédit {ecFmt(checks.totalCredit)} ({checks.entryCount} écritures)</li>
          <li data-ec="chk-entries" style={{ color: checks.unbalancedEntries ? "#A6432F" : "#0F6B5C" }}>{checks.unbalancedEntries ? "✗" : "✓"} {checks.unbalancedEntries ? `${checks.unbalancedEntries} écriture(s) non équilibrée(s)` : "Toutes les écritures sont équilibrées"}</li>
          <li data-ec="chk-accounts" style={{ color: checks.unknownAccounts.length ? "#A6432F" : "#0F6B5C" }}>{checks.unknownAccounts.length ? "✗" : "✓"} {checks.unknownAccounts.length ? `Comptes hors plan comptable : ${checks.unknownAccounts.join(", ")}` : "Tous les comptes utilisés figurent au plan comptable"}</li>
          {checks.noDate > 0 && <li style={{ color: "#A6432F" }}>✗ {checks.noDate} écriture(s) sans date</li>}
        </ul>
      </div>

      <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}>
        <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Exports normalisés pour le cabinet</div>
        <p className="text-xs mb-3" style={{ color: "#8A8370" }}>CSV séparé par des points-virgules (UTF-8, montants avec virgule décimale, dates AAAAMMJJ), ouvrable directement dans Excel. Le journal reprend le lettrage et le pointage bancaire.</p>
        <div className="flex gap-2 flex-wrap">
          <button data-ec="exp-journal" onClick={() => doExport("journal")} className="px-3 py-1.5 rounded text-xs text-white flex items-center gap-1.5" style={{ background: "#152238" }}><FileDown size={13} /> Journal normalisé</button>
          <button data-ec="exp-balance" onClick={() => doExport("balance")} className="px-3 py-1.5 rounded text-xs text-white flex items-center gap-1.5" style={{ background: "#152238" }}><FileDown size={13} /> Balance générale</button>
          <button data-ec="exp-plan" onClick={() => doExport("plan")} className="px-3 py-1.5 rounded text-xs text-white flex items-center gap-1.5" style={{ background: "#152238" }}><FileDown size={13} /> Plan comptable</button>
        </div>
      </div>

      <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1", minWidth: 0 }}>
        <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
          <div className="text-sm font-medium" style={{ color: "#152238" }}>Commentaires de révision {comments ? `(${openCount} ouvert${openCount > 1 ? "s" : ""})` : ""}</div>
          <div className="flex items-center gap-1.5">
            {["ouvert", "résolu", "tous"].map((f) => (
              <button key={f} data-ec={`filter-${f}`} onClick={() => setFilter(f)} className="px-2 py-1 rounded text-xs" style={{ background: filter === f ? "#152238" : "#F3EFE3", color: filter === f ? "#fff" : "#5C6B8C" }}>{f === "ouvert" ? "Ouverts" : f === "résolu" ? "Résolus" : "Tous"}</button>
            ))}
            <button onClick={load} className="px-2 py-1 rounded text-xs" style={{ background: "#F3EFE3", color: "#5C6B8C" }}>Actualiser</button>
          </div>
        </div>

        {sqlMissing && <div data-ec="sql-missing" className="p-3 rounded text-xs mb-3" style={{ background: "#FBF1DC", color: "#7A5E12" }}>Les commentaires ne sont pas encore disponibles sur votre compte. Réessayez plus tard ou contactez le support.</div>}
        {loadErr && <div data-ec="load-err" className="p-3 rounded text-xs mb-3" style={{ background: "#F7E9E3", color: "#A6432F" }}>{loadErr}</div>}

        {!sqlMissing && (
          <div className="grid gap-2 mb-4 p-3 rounded" style={{ background: "#FAF8F1", border: "1px solid #EEE9DA" }}>
            <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
              <select data-ec="c-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, ref: "" })} className="border rounded px-2 py-1.5 text-xs" style={{ borderColor: "#DDD6C4", minWidth: 0, maxWidth: "100%" }}>
                {EC_TARGETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              {form.type === "entry" && (
                <select data-ec="c-ref" value={form.ref} onChange={(e) => setForm({ ...form, ref: e.target.value })} className="border rounded px-2 py-1.5 text-xs" style={{ borderColor: "#DDD6C4", minWidth: 0, maxWidth: "100%" }}>
                  <option value="">— choisir l'écriture —</option>
                  {recentEntries.map((e) => <option key={e.id} value={e.id}>{e.date} · {(e.label || "").slice(0, 40)}</option>)}
                </select>
              )}
              {form.type === "invoice" && (
                <select data-ec="c-ref" value={form.ref} onChange={(e) => setForm({ ...form, ref: e.target.value })} className="border rounded px-2 py-1.5 text-xs" style={{ borderColor: "#DDD6C4", minWidth: 0, maxWidth: "100%" }}>
                  <option value="">— choisir la facture —</option>
                  {[...(invoices || [])].slice(-200).reverse().map((i) => <option key={i.id} value={i.id}>{i.number} · {(i.client || "").slice(0, 30)}</option>)}
                </select>
              )}
              {(form.type === "account" || form.type === "period") && (
                <input data-ec="c-ref" value={form.ref} onChange={(e) => setForm({ ...form, ref: e.target.value })} placeholder={form.type === "account" ? "ex. 411" : "ex. 2026-08"} className="border rounded px-2 py-1.5 text-xs" style={{ borderColor: "#DDD6C4", minWidth: 0 }} />
              )}
            </div>
            <textarea data-ec="c-body" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={3} maxLength={2000} placeholder="Votre remarque (pièce manquante, compte à corriger, question…)" className="border rounded px-2 py-1.5 text-sm w-full" style={{ borderColor: "#DDD6C4" }} />
            <div><button data-ec="c-add" onClick={add} disabled={busy} className="px-3 py-1.5 rounded text-xs text-white" style={{ background: "#0F6B5C", opacity: busy ? 0.6 : 1 }}>Ajouter le commentaire</button></div>
          </div>
        )}

        {comments === null && !sqlMissing && <div className="text-xs" style={{ color: "#A39C87" }}>Chargement…</div>}
        {comments && !sqlMissing && shown.length === 0 && <div data-ec="empty" className="text-xs py-4 text-center" style={{ color: "#A39C87" }}>Aucun commentaire {filter === "tous" ? "" : filter === "ouvert" ? "ouvert" : "résolu"} pour le moment.</div>}
        <div className="grid gap-2">
          {shown.map((c) => {
            const mine = (c.author_email || "").toLowerCase() === me;
            return (
              <div key={c.id} data-ec="comment" className="p-3 rounded text-sm" style={{ border: "1px solid #EEE9DA", background: c.status === "résolu" ? "#F6F8F6" : "#fff", minWidth: 0 }}>
                <div className="flex items-center justify-between gap-2 flex-wrap text-xs mb-1" style={{ color: "#8A8370" }}>
                  <span style={{ minWidth: 0, wordBreak: "break-word" }}><b style={{ color: "#152238" }}>{c.author_email}</b> · {String(c.created_at || "").slice(0, 10)} · {targetLabel(c)}</span>
                  <span className="px-1.5 py-0.5 rounded" style={{ background: c.status === "résolu" ? "#E6F1EE" : "#FBF1DC", color: c.status === "résolu" ? "#0F6B5C" : "#9A7B1E" }}>{c.status}</span>
                </div>
                <div style={{ color: "#152238", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{c.body}</div>
                {c.status === "résolu" && c.resolved_by && <div className="text-xs mt-1" style={{ color: "#8A8370" }}>Résolu par {c.resolved_by}</div>}
                <div className="flex gap-3 mt-2 text-xs">
                  {(canEdit || mine) && (c.status === "ouvert"
                    ? <button data-ec="resolve" onClick={() => setStatus(c, "résolu")} className="underline" style={{ color: "#0F6B5C" }}>Marquer comme résolu</button>
                    : <button data-ec="reopen" onClick={() => setStatus(c, "ouvert")} className="underline" style={{ color: "#9A7B1E" }}>Rouvrir</button>)}
                  {(canEdit || (mine && c.status === "ouvert")) && <button data-ec="delete" onClick={() => remove(c)} className="underline" style={{ color: "#A6432F" }}>Supprimer</button>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function BankReconciliationPanel({ accounts, entries, setEntries, settings, setSettings, role, showToast, logAudit }) {
  const canEdit = role === "Administrateur" || role === "Éditeur";
  const bankAccounts = accounts.filter((a) => /^51/.test(a.code));
  const [account, setAccount] = useState((bankAccounts.find((a) => a.code === "512") || bankAccounts[0] || { code: "512" }).code);
  const [date, setDate] = useState(todayStr());
  const [stmt, setStmt] = useState("");
  const r = useMemo(() => bankRecoCompute(entries, account, date, stmt), [entries, account, date, stmt]);
  const saved = (settings.bankRecs || []).filter((x) => x.account === account).slice(-6).reverse();
  const toggle = (id) => {
    if (!canEdit) return;
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, reconciled: !e.reconciled } : e)));
  };
  const save = () => {
    if (!canEdit) return;
    if (r.gap == null) { showToast("Saisissez le solde indiqué sur le relevé de la banque."); return; }
    if (r.gap !== 0 && !window.confirm(`Il reste un écart non expliqué de ${fmt(r.gap)}. Enregistrer quand même ce rapprochement ?`)) return;
    const rec = { id: uid(), at: new Date().toISOString(), date, account, statementBalance: Number(stmt), bookBalance: r.book, gap: r.gap, unpointed: r.unpointed.length };
    setSettings({ ...settings, bankRecs: [...(settings.bankRecs || []), rec] });
    logAudit("Comptabilité", "Rapprochement bancaire", `${account} au ${date} — relevé ${fmt(Number(stmt))}, écart ${fmt(r.gap)}`);
    showToast(r.gap === 0 ? "Rapprochement enregistré : aucun écart." : "Rapprochement enregistré avec un écart.");
  };
  const inputCls = "w-full border rounded px-2 py-1.5 text-sm mt-1";
  const inputStyle = { borderColor: "#DDD6C4" };
  return (
    <div className="space-y-6" data-testid="reco-panel">
      <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
        <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Rapprochement bancaire</div>
        <p className="text-xs mb-4" style={{ color: "#8A8370" }}>Pointez les écritures qui figurent sur votre relevé. Le solde du relevé doit être égal au total des écritures pointées ; les écritures non pointées (chèques en circulation, dépôts en transit) expliquent la différence avec le solde comptable.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Compte bancaire</label>
            <select value={account} onChange={(e) => setAccount(e.target.value)} className={inputCls} style={inputStyle} data-testid="reco-account">
              {bankAccounts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Date d'arrêté du relevé</label>
            <input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} className={inputCls} style={inputStyle} data-testid="reco-date" />
          </div>
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Solde final du relevé</label>
            <input type="number" step="any" value={stmt} onChange={(e) => setStmt(e.target.value)} className={inputCls + " tabular"} style={inputStyle} data-testid="reco-stmt" />
          </div>
        </div>
        <div className="mt-4 p-3 rounded text-sm tabular" style={{ background: "#FAF8F1", border: "1px solid #EEE9DA" }}>
          <div>Solde comptable au {date} : <b data-testid="reco-book">{fmt(r.book)}</b></div>
          <div>+ Chèques émis / paiements non pointés : <span data-testid="reco-outstanding">{fmt(r.outstanding)}</span></div>
          <div>− Dépôts / encaissements non pointés : <span data-testid="reco-transit">{fmt(r.inTransit)}</span></div>
          <div>= Solde attendu sur le relevé : <b data-testid="reco-expected">{fmt(r.expectedStatement)}</b></div>
          <div className="mt-1 font-medium" data-testid="reco-gap" style={{ color: r.gap == null ? "#8A8370" : r.gap === 0 ? "#0F6B5C" : "#A6432F" }}>
            {r.gap == null ? "Saisissez le solde du relevé pour calculer l'écart." : r.gap === 0 ? "Rapproché : aucun écart." : `Écart non expliqué : ${fmt(r.gap)} (relevé − écritures pointées).`}
          </div>
        </div>
        {canEdit && <button onClick={save} className="mt-3 px-4 py-2 rounded text-sm text-white" style={{ background: "#152238" }} data-testid="reco-save">Enregistrer ce rapprochement</button>}
      </div>
      <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
        <div className="text-sm font-medium mb-3" style={{ color: "#152238" }}>Écritures non pointées ({r.unpointed.length})</div>
        {r.unpointed.length === 0 ? <div className="text-xs" style={{ color: "#A39C87" }} data-testid="reco-none">Toutes les écritures de la période sont pointées.</div> : (
          <div className="overflow-x-auto"><table className="w-full text-sm" data-testid="reco-table"><tbody>
            {r.unpointed.map((u) => (
              <tr key={u.id} data-testid="reco-row" style={{ borderTop: "1px solid #EEE9DA" }}>
                <td className="py-2 pr-2">{canEdit && <input type="checkbox" checked={false} onChange={() => toggle(u.id)} data-testid="reco-point" aria-label="Pointer" />}</td>
                <td className="py-2 pr-2 tabular text-xs">{u.date}</td>
                <td className="py-2 pr-2" style={{ wordBreak: "break-word" }}>{u.label}</td>
                <td className="py-2 text-right tabular" style={{ color: u.net > 0 ? "#0F6B5C" : "#A6432F" }}>{fmt(u.net)}</td>
              </tr>
            ))}
          </tbody></table></div>
        )}
      </div>
      {saved.length > 0 && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <div className="text-sm font-medium mb-3" style={{ color: "#152238" }}>Rapprochements enregistrés</div>
          <div className="text-xs space-y-1" data-testid="reco-history">
            {saved.map((x) => <div key={x.id}>{x.date} — relevé {fmt(x.statementBalance)} · comptable {fmt(x.bookBalance)} · {x.gap === 0 ? "aucun écart" : `écart ${fmt(x.gap)}`}</div>)}
          </div>
        </div>
      )}
    </div>
  );
}

function LettragePanel({ accounts, entries, setEntries, role, showToast, logAudit }) {
  const canEdit = role === "Administrateur" || role === "Éditeur";
  const tiers = accounts.filter((a) => /^4/.test(a.code));
  const [account, setAccount] = useState((tiers.find((a) => a.code === "411") || tiers[0] || { code: "411" }).code);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [sel, setSel] = useState([]);
  const lines = useMemo(() => lettrageLines(entries, account), [entries, account]);
  const shown = onlyOpen ? lines.filter((l) => !l.letter) : lines;
  const selLines = lines.filter((l) => sel.includes(l.key));
  const sd = rcR2(selLines.reduce((t, l) => t + l.debit, 0));
  const sc = rcR2(selLines.reduce((t, l) => t + l.credit, 0));
  const balanced = selLines.length >= 2 && sd === sc;
  const usedCodes = lines.filter((l) => l.letter).map((l) => l.letter);
  const suggestions = useMemo(() => lettrageSuggest(lines), [lines]);
  const openBalance = rcR2(lines.filter((l) => !l.letter).reduce((t, l) => t + l.debit - l.credit, 0));
  const flip = (k) => setSel((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  const doLetter = () => {
    if (!canEdit || !balanced) return;
    const code = nextLetterCode(usedCodes);
    setEntries((prev) => applyLettrage(prev, sel, code));
    logAudit("Comptabilité", "Lettrage", `${account} — lettre ${code} (${sel.length} lignes, ${fmt(sd)})`);
    showToast(`Lettrage ${code} enregistré.`);
    setSel([]);
  };
  const doSuggestions = () => {
    if (!canEdit || !suggestions.length) return;
    const used = [...usedCodes];
    let next = entries;
    suggestions.forEach((pair) => { const code = nextLetterCode(used); used.push(code); next = applyLettrage(next, pair, code); });
    setEntries(() => next);
    logAudit("Comptabilité", "Lettrage automatique", `${account} — ${suggestions.length} paire(s) de même montant`);
    showToast(`${suggestions.length} lettrage(s) appliqué(s).`);
    setSel([]);
  };
  const undo = (code) => {
    if (!canEdit) return;
    if (!window.confirm(`Supprimer le lettrage ${code} ?`)) return;
    setEntries((prev) => removeLettrage(prev, account, code));
    logAudit("Comptabilité", "Délettrage", `${account} — lettre ${code}`);
  };
  const inputStyle = { borderColor: "#DDD6C4" };
  return (
    <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }} data-testid="lettrage-panel">
      <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Lettrage des comptes de tiers</div>
      <p className="text-xs mb-4" style={{ color: "#8A8370" }}>Associez les lignes qui se soldent (une facture et son règlement, par exemple). Sélectionnez-les : le lettrage n'est possible que si le total débit est égal au total crédit.</p>
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <div style={{ maxWidth: "100%", minWidth: 0 }}>
          <label className="text-xs" style={{ color: "#8A8370" }}>Compte</label>
          <select value={account} onChange={(e) => { setAccount(e.target.value); setSel([]); }} className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ ...inputStyle, maxWidth: "100%" }} data-testid="let-account">
            {tiers.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-xs pb-2" style={{ color: "#152238" }}><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} data-testid="let-only-open" /> Lignes non lettrées seulement</label>
        {canEdit && suggestions.length > 0 && <button onClick={doSuggestions} className="px-3 py-1.5 rounded text-xs" style={{ border: "1px solid #DDD6C4", color: "#152238" }} data-testid="let-auto">Lettrer {suggestions.length} paire(s) de même montant</button>}
      </div>
      <div className="text-xs mb-2" style={{ color: "#152238" }}>Solde des lignes non lettrées : <b data-testid="let-open-balance">{fmt(openBalance)}</b></div>
      {shown.length === 0 ? <div className="text-xs" style={{ color: "#A39C87" }} data-testid="let-empty">Aucune ligne à afficher sur ce compte.</div> : (
        <div className="overflow-x-auto"><table className="w-full text-sm" data-testid="let-table">
          <thead><tr style={{ background: "#C7CCDA" }}>{["", "Date", "Libellé", "Débit", "Crédit", "Lettre"].map((h, i) => <th key={i} className="py-2 px-2 text-left font-medium" style={{ color: "#152238", fontSize: 11, textTransform: "uppercase" }}>{h}</th>)}</tr></thead>
          <tbody>
            {shown.map((l) => (
              <tr key={l.key} data-testid="let-row" style={{ borderTop: "1px solid #EEE9DA" }}>
                <td className="py-2 px-2">{canEdit && !l.letter && <input type="checkbox" checked={sel.includes(l.key)} onChange={() => flip(l.key)} data-testid="let-check" aria-label="Sélectionner" />}</td>
                <td className="py-2 px-2 tabular text-xs">{l.date}</td>
                <td className="py-2 px-2" style={{ wordBreak: "break-word" }}>{l.label}</td>
                <td className="py-2 px-2 tabular text-right">{l.debit ? fmt(l.debit) : ""}</td>
                <td className="py-2 px-2 tabular text-right">{l.credit ? fmt(l.credit) : ""}</td>
                <td className="py-2 px-2">{l.letter && (canEdit ? <button onClick={() => undo(l.letter)} className="px-2 rounded text-xs font-semibold" style={{ background: "#E6F1EE", color: "#0F6B5C" }} title="Supprimer ce lettrage" data-testid="let-letter">{l.letter}</button> : <span className="text-xs font-semibold" data-testid="let-letter">{l.letter}</span>)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {canEdit && (
        <div className="mt-4 text-xs" style={{ color: "#152238" }}>
          <div data-testid="let-sel">Sélection : débit {fmt(sd)} · crédit {fmt(sc)}{selLines.length >= 2 && sd !== sc ? ` · écart ${fmt(rcR2(sd - sc))}` : ""}</div>
          <button onClick={doLetter} disabled={!balanced} className="mt-2 px-4 py-2 rounded text-sm text-white" style={{ background: "#152238", opacity: balanced ? 1 : 0.4 }} data-testid="let-apply">Lettrer la sélection</button>
        </div>
      )}
    </div>
  );
}

// Clôture annuelle formelle — calcule le résultat de la période depuis la
// dernière clôture (ou depuis toujours, si aucune n'a encore eu lieu), solde tous
// les comptes de charges et de produits mouvementés pendant cette période
// (ramenés à zéro pour que le prochain exercice reparte propre), et transfère le
// résultat vers le Report à nouveau (110) — bénéfice au crédit, perte au débit.
// Verrouille ensuite la période jusqu'à la date de clôture choisie.
function ClotureAnnuellePanel({ accounts, entries, setEntries, settings, setSettings, role, showToast, logAudit, planTier, currentUserEmail, pendingApprovals, setPendingApprovals, products }) {
  const canEdit = role === "Administrateur";
  const [closingDate, setClosingDate] = useState(() => {
    const y = new Date().getFullYear();
    const dec31 = `${y}-12-31`;
    return dec31 <= todayStr() ? dec31 : todayStr();
  });

  const sinceDate = settings.lastClosingDate || "0000-01-01";
  const periodEntries = entries.filter((e) => e.date > sinceDate && e.date <= closingDate);
  const periodBalances = {};
  periodEntries.forEach((e) => {
    (e.lines || []).forEach((l) => {
      periodBalances[l.account] = (periodBalances[l.account] || 0) + Number(l.debit || 0) - Number(l.credit || 0);
    });
  });
  const chargeLines = accounts.filter((a) => a.type === "Charge" && Math.round((periodBalances[a.code] || 0) * 100) !== 0);
  const produitLines = accounts.filter((a) => a.type === "Produit" && Math.round((periodBalances[a.code] || 0) * 100) !== 0);
  const totalCharges = chargeLines.reduce((s, a) => s + (periodBalances[a.code] || 0), 0);
  const totalProduits = produitLines.reduce((s, a) => s - (periodBalances[a.code] || 0), 0);
  const resultat = totalProduits - totalCharges;

  // Contrôles avant clôture : une écriture déséquilibrée BLOQUE la clôture ; les autres
  // points sont des avertissements.
  const scoped = entries.filter((e) => e.date && e.date <= closingDate);
  const unbalanced = scoped.filter((e) => Math.abs((e.lines || []).reduce((t, l) => t + Number(l.debit || 0) - Number(l.credit || 0), 0)) > 0.005);
  const knownCodes = new Set(accounts.map((a) => a.code));
  const unknownAccts = [...new Set(scoped.flatMap((e) => (e.lines || []).map((l) => l.account)).filter((c) => c && !knownCodes.has(c)))];
  const pendingOthers = (pendingApprovals || []).filter((a) => a.type !== "cloture_annuelle");
  const lateEntries = entries.filter((e) => e.date && e.date > closingDate).length;
  const preChecks = [
    { ok: unbalanced.length === 0, level: "error", label: unbalanced.length === 0 ? "Toutes les écritures sont équilibrées (débit = crédit)." : `${unbalanced.length} écriture(s) déséquilibrée(s) : à corriger avant de clôturer.` },
    { ok: unknownAccts.length === 0, level: "warn", label: unknownAccts.length === 0 ? "Tous les comptes utilisés existent dans le plan comptable." : `Comptes utilisés mais absents du plan comptable : ${unknownAccts.join(", ")}.` },
    { ok: pendingOthers.length === 0, level: "warn", label: pendingOthers.length === 0 ? "Aucune approbation en attente." : `${pendingOthers.length} approbation(s) en attente : traitez-les avant de clôturer.` },
    ...(lateEntries > 0 ? [{ ok: true, level: "info", label: `${lateEntries} écriture(s) datée(s) après le ${closingDate} : elles ne sont pas incluses dans cette clôture.` }] : []),
    ...(() => {
      // Contrôle stock ↔ compte 370 : comparable seulement si aucune écriture n'est postérieure à la date de clôture
      // (le stock en rayon est celui d'aujourd'hui).
      if (!settings || settings.stockValuationMethod !== "actif" || !products) return [];
      if (lateEntries > 0) return [{ ok: true, level: "info", label: "Contrôle du stock non fait : des écritures sont postérieures à la date de clôture (le stock en rayon est celui d'aujourd'hui)." }];
      const rec = stockReconcile(products, accounts, entries, settings);
      if (!rec) return [];
      return [{ ok: rec.ok, level: "warn", label: rec.ok ? "Le stock en rayon correspond au compte 370." : `Le stock en rayon (${fmt(rec.stockValue)}) ne correspond pas au compte 370 (${fmt(rec.bal370)}) : écart ${fmt(rec.gap)}. Faites un inventaire physique ou régularisez avant de clôturer.` }];
    })(),
  ];
  const closingBlocked = preChecks.some((c) => !c.ok && c.level === "error");

  const cloturer = () => {
    if (closingBlocked) {
      showToast("Corrigez d'abord les écritures déséquilibrées avant de clôturer.");
      return;
    }
    if (chargeLines.length === 0 && produitLines.length === 0) {
      showToast("Aucun mouvement de charge ou de produit à clôturer sur cette période.");
      return;
    }
    if (!window.confirm(`Clôturer l'exercice du ${sinceDate === "0000-01-01" ? "début" : sinceDate} au ${closingDate} ? Résultat calculé : ${fmt(resultat)}${resultat >= 0 ? " (bénéfice)" : " (perte)"}. Toutes les écritures jusqu'à cette date seront verrouillées — cette action ne peut pas être annulée facilement.`)) return;
    const lines = [];
    chargeLines.forEach((a) => lines.push({ account: a.code, debit: 0, credit: periodBalances[a.code] }));
    produitLines.forEach((a) => lines.push({ account: a.code, debit: -periodBalances[a.code], credit: 0 }));
    // Le résultat s'équilibre sur le Report à nouveau : au crédit si bénéfice
    // (augmente les capitaux propres), au débit si perte (les diminue).
    if (resultat >= 0) lines.push({ account: "110", debit: 0, credit: resultat });
    else lines.push({ account: "110", debit: -resultat, credit: 0 });
    const entry = {
      id: uid(), date: closingDate, createdAt: new Date().toISOString(),
      label: `Clôture de l'exercice au ${closingDate} — Résultat : ${fmt(resultat)}`,
      lines,
    };
    const newSettings = { lastClosingDate: closingDate, lockDate: closingDate };

    // Double validation (forfait Assisté) : tout est déjà calculé, seule
    // l'application (écriture + verrouillage de la période) attend l'approbation
    // explicite d'un administrateur depuis Administration → Approbations en attente.
    if (planTier === "assisted") {
      const alreadyPending = (pendingApprovals || []).some((a) => a.type === "cloture_annuelle");
      if (alreadyPending) {
        showToast("Une clôture est déjà en attente d'approbation — inutile d'en créer une seconde.");
        return;
      }
      setPendingApprovals((prev) => [...prev, {
        id: uid(), type: "cloture_annuelle",
        label: `Clôture de l'exercice au ${closingDate} — Résultat : ${fmt(resultat)}`,
        requestedBy: currentUserEmail || "Inconnu", requestedAt: new Date().toISOString(),
        payload: { entry, newSettings },
      }]);
      showToast("Demande envoyée — en attente d'approbation par un administrateur.");
      return;
    }

    // Filet de sécurité : point de restauration (comptes, écritures, paramètres) AVANT la clôture.
    try { rpSave(_membership && _membership.companyId, bkBuildFile({ accounts, entries, settings, pendingApprovals }, _membership && _membership.companyId, "Avant clôture"), `Avant clôture au ${closingDate}`, true); } catch (e) { /* sans stockage local : la clôture se fait quand même */ }
    setEntries((prev) => [...prev, entry]);
    setSettings({ ...settings, ...newSettings });
    logAudit("Comptabilité", "Clôture annuelle", `Exercice au ${closingDate} — Résultat : ${fmt(resultat)}`);
    showToast(`Exercice clôturé au ${closingDate}. Résultat de ${fmt(resultat)} transféré au Report à nouveau.`);
  };

  if (!canEdit) {
    return (
      <div className="bg-white rounded-lg p-6 text-sm" style={{ border: "1px solid #E4DFD1", color: "#8A8370" }}>
        Seul un administrateur principal peut effectuer la clôture annuelle.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
        <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Clôture de l'exercice</div>
        <p className="text-xs mb-4" style={{ color: "#8A8370" }}>
          Calcule le résultat depuis la {settings.lastClosingDate ? `dernière clôture (${settings.lastClosingDate})` : "création de l'entreprise"} jusqu'à la date choisie, solde tous les comptes de charges et de produits mouvementés sur cette période, et transfère le résultat au Report à nouveau. La période est ensuite verrouillée jusqu'à cette date.
        </p>
        <div className="mb-4">
          <label className="text-xs" style={{ color: "#8A8370" }}>Date de clôture</label>
          <input type="date" value={closingDate} max={todayStr()} min={sinceDate !== "0000-01-01" ? sinceDate : undefined} onChange={(e) => setClosingDate(e.target.value)}
            className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
        </div>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="p-3 rounded" style={{ background: "#FAF8F1" }}>
            <div className="text-xs" style={{ color: "#8A8370" }}>Total produits (période)</div>
            <div className="text-lg font-medium tabular" style={{ color: "#0F6B5C" }}>{fmt(totalProduits)}</div>
          </div>
          <div className="p-3 rounded" style={{ background: "#FAF8F1" }}>
            <div className="text-xs" style={{ color: "#8A8370" }}>Total charges (période)</div>
            <div className="text-lg font-medium tabular" style={{ color: "#A6432F" }}>{fmt(totalCharges)}</div>
          </div>
        </div>
        <div className="p-3 rounded mb-4" style={{ background: resultat >= 0 ? "#E6F1EE" : "#F7E9E3" }}>
          <div className="text-xs" style={{ color: "#8A8370" }}>Résultat de l'exercice</div>
          <div className="text-xl font-medium tabular" style={{ color: resultat >= 0 ? "#0F6B5C" : "#A6432F" }}>{fmt(resultat)} {resultat >= 0 ? "(bénéfice)" : "(perte)"}</div>
        </div>
        <div className="mb-4" data-testid="closing-checks">
          <div className="text-xs font-medium mb-2" style={{ color: "#152238" }}>Contrôles avant clôture</div>
          {preChecks.map((c, i) => (
            <div key={i} className="text-xs py-1" style={{ color: c.ok ? "#0F6B5C" : c.level === "error" ? "#A6432F" : "#7A5F10", wordBreak: "break-word" }}>
              {c.ok ? "✔ " : c.level === "error" ? "✖ " : "⚠ "}{c.label}
            </div>
          ))}
          <div className="text-xs py-1" style={{ color: "#8A8370" }}>Un point de restauration (Administration → Données) est créé automatiquement juste avant la clôture.</div>
        </div>
        <button onClick={cloturer} disabled={closingBlocked} data-testid="closing-btn" className="px-4 py-2 rounded text-sm text-white" style={{ background: "#152238", opacity: closingBlocked ? 0.5 : 1 }}>Clôturer l'exercice</button>
      </div>

      {(chargeLines.length > 0 || produitLines.length > 0) && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <div className="text-sm font-medium mb-3" style={{ color: "#152238" }}>Détail des comptes à solder</div>
          <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(21,34,56,0.08)" }}>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead>
              <tr style={{ background: "#D4C9F0" }}>
                <th className="py-2 px-3 text-left font-medium" style={{ color: "#5B3FA0", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Code</th>
                <th className="py-2 px-3 text-left font-medium" style={{ color: "#5B3FA0", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Compte</th>
                <th className="py-2 px-3 text-right font-medium" style={{ color: "#5B3FA0", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Montant</th>
              </tr>
            </thead>
            <tbody>
              {produitLines.map((a) => (
                <tr key={a.code}>
                  <td className="py-2 pl-3 pr-1 tabular" style={{ color: "#152238", borderLeft: "3px solid #639922" }}>{a.code}</td>
                  <td className="py-2 px-3" style={{ color: "#152238" }}>{a.name}</td>
                  <td className="py-2 px-3 tabular text-right" style={{ color: "#0F6B5C" }}>{fmt(-periodBalances[a.code])}</td>
                </tr>
              ))}
              {chargeLines.map((a) => (
                <tr key={a.code}>
                  <td className="py-2 pl-3 pr-1 tabular" style={{ color: "#152238", borderLeft: "3px solid #D85A30" }}>{a.code}</td>
                  <td className="py-2 px-3" style={{ color: "#152238" }}>{a.name}</td>
                  <td className="py-2 px-3 tabular text-right" style={{ color: "#A6432F" }}>{fmt(periodBalances[a.code])}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          </div>
        </div>
      )}
    </div>
  );
}

// Affectation du résultat entre associés — répartit le solde du Report à nouveau
// entre mise en réserve et dividendes, ces derniers proportionnels à la part de
// capital de chaque associé (modifiable ligne par ligne). Un sous-compte "Dividendes
// à payer" par associé (457.N, même numéro que son compte de capital 101.N) garde
// la trace de ce qui reste à verser, jusqu'au règlement effectif.
function AffectationResultatPanel({ accounts, setAccounts, entries, setEntries, balances, settings, role, showToast, logAudit, planTier, currentUserEmail, pendingApprovals, setPendingApprovals }) {
  const canEdit = role === "Administrateur";
  const associateAccounts = accounts.filter((a) => /^101\.\d+$/.test(a.code)).map((a) => ({ ...a, solde: -(balances[a.code] || 0) }));
  const totalCapital = associateAccounts.reduce((s, a) => s + a.solde, 0);
  const reportBalance = -(balances["110"] || 0);
  const [form, setForm] = useState({ date: todayStr(), reserveAmount: "", dividendTotal: "" });
  const [manualSplit, setManualSplit] = useState({});

  const proposedSplit = associateAccounts.map((a) => {
    const share = totalCapital > 0 ? a.solde / totalCapital : 0;
    const proposed = manualSplit[a.code] !== undefined && manualSplit[a.code] !== ""
      ? Number(manualSplit[a.code]) || 0
      : Math.round((Number(form.dividendTotal) || 0) * share * 100) / 100;
    return { ...a, share, proposed };
  });
  const totalProposed = Math.round(proposedSplit.reduce((s, x) => s + x.proposed, 0) * 100) / 100;
  const reserveAmount = Number(form.reserveAmount) || 0;
  const totalAffecte = reserveAmount + totalProposed;

  const affecter = () => {
    if (totalAffecte <= 0) { showToast("Renseignez un montant à mettre en réserve ou à distribuer."); return; }
    if (totalAffecte > reportBalance + 0.01) { showToast(`Le montant affecté (${fmt(totalAffecte)}) dépasse le Report à nouveau disponible (${fmt(reportBalance)}).`); return; }
    if (!window.confirm(`Affecter ${fmt(totalAffecte)} du Report à nouveau — ${fmt(reserveAmount)} en réserve, ${fmt(totalProposed)} en dividendes ? Cette opération crée une écriture définitive.`)) return;

    const accountsToAdd = [];
    proposedSplit.forEach((a) => {
      if (a.proposed > 0) {
        const n = a.code.split(".")[1];
        const divCode = `457.${n}`;
        if (!accounts.some((acc) => acc.code === divCode)) {
          accountsToAdd.push({ code: divCode, name: `Dividendes à payer — ${a.name.replace(/^Capital — /, "")}`, type: "Passif" });
        }
      }
    });

    const lines = [{ account: "110", debit: totalAffecte, credit: 0 }];
    if (reserveAmount > 0) lines.push({ account: "106", debit: 0, credit: reserveAmount });
    proposedSplit.forEach((a) => {
      if (a.proposed > 0) lines.push({ account: `457.${a.code.split(".")[1]}`, debit: 0, credit: a.proposed });
    });
    const entry = {
      id: uid(), date: form.date, createdAt: new Date().toISOString(),
      label: `Affectation du résultat — réserves ${fmt(reserveAmount)}, dividendes ${fmt(totalProposed)}`,
      lines,
    };

    // Double validation (forfait Assisté) : les nouveaux sous-comptes de
    // dividendes (le cas échéant) et l'écriture attendent l'approbation explicite
    // d'un administrateur depuis Administration → Approbations en attente.
    if (planTier === "assisted") {
      const alreadyPending = (pendingApprovals || []).some((a) => a.type === "affectation_resultat");
      if (alreadyPending) {
        showToast("Une affectation du résultat est déjà en attente d'approbation — inutile d'en créer une seconde.");
        return;
      }
      setPendingApprovals((prev) => [...prev, {
        id: uid(), type: "affectation_resultat",
        label: `Affectation du résultat — réserves ${fmt(reserveAmount)}, dividendes ${fmt(totalProposed)}`,
        requestedBy: currentUserEmail || "Inconnu", requestedAt: new Date().toISOString(),
        payload: { entry, accountsToAdd },
      }]);
      showToast("Demande envoyée — en attente d'approbation par un administrateur.");
      setForm({ date: todayStr(), reserveAmount: "", dividendTotal: "" });
      setManualSplit({});
      return;
    }

    if (accountsToAdd.length) setAccounts((prev) => [...prev, ...accountsToAdd]);
    setEntries((prev) => [...prev, entry]);
    logAudit("Comptabilité", "Affectation du résultat", `Réserves ${fmt(reserveAmount)}, dividendes ${fmt(totalProposed)}`);
    showToast("Affectation du résultat enregistrée.");
    setForm({ date: todayStr(), reserveAmount: "", dividendTotal: "" });
    setManualSplit({});
  };

  const pendingDividends = accounts.filter((a) => /^457\.\d+$/.test(a.code)).map((a) => ({ ...a, solde: -(balances[a.code] || 0) })).filter((a) => a.solde > 0.01);

  const verserDividende = (divAccount, payAccount) => {
    const entry = {
      id: uid(), date: todayStr(), createdAt: new Date().toISOString(),
      label: `Versement dividende — ${divAccount.name.replace(/^Dividendes à payer — /, "")}`,
      lines: [{ account: divAccount.code, debit: divAccount.solde, credit: 0 }, { account: payAccount, debit: 0, credit: divAccount.solde }],
    };
    setEntries((prev) => [...prev, entry]);
    logAudit("Comptabilité", "Versement dividende", `${divAccount.name} : ${fmt(divAccount.solde)}`);
    showToast(`Dividende de ${fmt(divAccount.solde)} versé.`);
  };

  if (!canEdit) {
    return (
      <div className="bg-white rounded-lg p-6 text-sm" style={{ border: "1px solid #E4DFD1", color: "#8A8370" }}>
        Seul un administrateur principal peut affecter le résultat entre associés.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
        <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Affectation du résultat</div>
        <p className="text-xs mb-4" style={{ color: "#8A8370" }}>
          Répartit le solde du Report à nouveau (bénéfices cumulés non encore affectés) entre mise en réserve et dividendes aux associés, proportionnels à leur part de capital — modifiable ligne par ligne si besoin.
        </p>
        <div className="p-3 rounded mb-4" style={{ background: "#FAF8F1" }}>
          <div className="text-xs" style={{ color: "#8A8370" }}>Report à nouveau disponible</div>
          <div className="text-lg font-medium tabular" style={{ color: reportBalance >= 0 ? "#0F6B5C" : "#A6432F" }}>{fmt(reportBalance)}</div>
        </div>
        {associateAccounts.length === 0 ? (
          <div className="text-xs py-2" style={{ color: "#A39C87" }}>Aucun associé enregistré — ajoutez d'abord un apport de capital dans l'onglet "Associés (capital)" pour pouvoir distribuer des dividendes.</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-xs" style={{ color: "#8A8370" }}>Date</label>
                <input type="date" value={form.date} max={todayStr()} onChange={(e) => setForm({ ...form, date: e.target.value })}
                  className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
              </div>
              <div>
                <label className="text-xs" style={{ color: "#8A8370" }}>Montant mis en réserve</label>
                <input type="number" min="0" value={form.reserveAmount} onChange={(e) => setForm({ ...form, reserveAmount: e.target.value })} placeholder="0"
                  className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
              </div>
              <div className="col-span-2">
                <label className="text-xs" style={{ color: "#8A8370" }}>Montant total distribué en dividendes</label>
                <input type="number" min="0" value={form.dividendTotal} onChange={(e) => { setForm({ ...form, dividendTotal: e.target.value }); setManualSplit({}); }} placeholder="0"
                  className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
              </div>
            </div>

            <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(21,34,56,0.08)", marginBottom: 16 }}>
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead>
                <tr style={{ background: "#D4C9F0" }}>
                  <th className="py-2 px-3 text-left font-medium" style={{ color: "#5B3FA0", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Associé</th>
                  <th className="py-2 px-3 text-right font-medium" style={{ color: "#5B3FA0", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Part du capital</th>
                  <th className="py-2 px-3 text-right font-medium" style={{ color: "#5B3FA0", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Dividende proposé</th>
                </tr>
              </thead>
              <tbody>
                {proposedSplit.map((a) => (
                  <tr key={a.code}>
                    <td className="py-2 pl-3 pr-1" style={{ color: "#152238", borderLeft: "3px solid #A79AE0" }}>{a.name.replace(/^Capital — /, "")}</td>
                    <td className="py-2 px-3 tabular text-right" style={{ color: "#7A7460" }}>{(a.share * 100).toFixed(1)}%</td>
                    <td className="py-2 px-3 text-right">
                      <input type="number" min="0" value={manualSplit[a.code] ?? String(a.proposed)}
                        onChange={(e) => setManualSplit((prev) => ({ ...prev, [a.code]: e.target.value }))}
                        className="w-24 border rounded px-2 py-1 text-xs tabular text-right" style={{ borderColor: "#DDD6C4" }} />
                    </td>
                  </tr>
                ))}
                <tr style={{ background: "#FAF8F1" }}>
                  <td className="py-2 pl-3 pr-1 font-semibold" colSpan={2} style={{ color: "#152238", borderLeft: "3px solid #152238" }}>Total affecté (réserve + dividendes)</td>
                  <td className="py-2 px-3 tabular text-right font-semibold" style={{ color: "#152238" }}>{fmt(totalAffecte)}</td>
                </tr>
              </tbody>
            </table></div>
            </div>

            <button onClick={affecter} className="px-4 py-2 rounded text-sm text-white" style={{ background: "#152238" }}>Affecter le résultat</button>
          </>
        )}
      </div>

      {pendingDividends.length > 0 && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <div className="text-sm font-medium mb-3" style={{ color: "#152238" }}>Dividendes en attente de versement</div>
          <div className="space-y-2">
            {pendingDividends.map((a) => (
              <div key={a.code} className="flex flex-wrap items-center justify-between gap-2 p-2 rounded" style={{ border: "1px solid #F3EFE3" }}>
                <span className="text-sm">{a.name.replace(/^Dividendes à payer — /, "")} — <span className="tabular font-medium">{fmt(a.solde)}</span></span>
                <div className="flex gap-2">
                  <button onClick={() => verserDividende(a, "530")} className="text-xs px-2 py-1 rounded" style={{ background: "#152238", color: "#EFE9DD" }}>Verser (caisse)</button>
                  <button onClick={() => verserDividende(a, "512")} className="text-xs px-2 py-1 rounded" style={{ background: "#152238", color: "#EFE9DD" }}>Verser (banque)</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

