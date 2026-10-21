// ═══ MODULE ═══
// @module Compta exercices
// @depends BilanClasseView, FX_USD_ACCOUNT, _membership, bilanClasse, bkBuildFile, fmt, fmtFx, fxDocs
//   fxRateOn, fxcPosition, isLocked, rpSave, todayStr, uid, useMemo, useState
// @exports ExercicesPanel
// ═══ FIN DE L'EN-TÊTE ═══
// Exercices comptables (v240) — trois volets :
//   1. Consulter un exercice clos (bilan, résultat, balance avant clôture, journal), en lecture seule.
//   2. Réévaluation des devises à la clôture : écart de change LATENT estimé et écriture proposée.
//      Règle non encore validée par l'expert-comptable : rien n'est comptabilisé sans sa validation
//      déclarée (nom de l'expert + case cochée). Écriture aux comptes 476 / 477 (différences de conversion,
//      sans effet sur le résultat), extournée automatiquement le lendemain.
//   3. Réouverture encadrée du DERNIER exercice clos : administrateur, motif obligatoire, contrepassation
//      de l'écriture de clôture à sa date, point de restauration, trace dans l'historique.

// <calcul-exercices>
const EXO_LABEL_RE = /^Clôture de l'exercice au (\d{4}-\d{2}-\d{2})/;
const EXO_DIFF_ACCOUNTS = {
  actif: { code: "476", name: "Différences de conversion — Actif", type: "Actif" },
  passif: { code: "477", name: "Différences de conversion — Passif", type: "Passif" },
};
const exoR2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
const exoIsClosing = (e) => !!e && !e.reversalOf && !e.cancelledBy && EXO_LABEL_RE.test(String(e.label || ""));
function exoAddDays(s, n) {
  const [y, m, d] = String(s || "").slice(0, 10).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.getUTCFullYear() + "-" + String(t.getUTCMonth() + 1).padStart(2, "0") + "-" + String(t.getUTCDate()).padStart(2, "0");
}
// Clôtures effectives (écritures de clôture non annulées), de la plus ancienne à la plus récente.
function exoClosings(entries) {
  return (entries || []).filter(exoIsClosing)
    .map((e) => ({ date: e.date || String(e.label).match(EXO_LABEL_RE)[1], entryId: e.id, label: e.label }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
// Exercices : un par clôture, plus l'exercice en cours.
function exoList(entries, today) {
  const cl = exoClosings(entries);
  const list = cl.map((c, i) => ({ key: c.entryId, from: i > 0 ? cl[i - 1].date : null, to: c.date, closingEntryId: c.entryId, open: false }));
  const last = cl.length ? cl[cl.length - 1].date : null;
  list.push({ key: "open", from: last, to: last && today < last ? last : today, closingEntryId: null, open: true });
  return list;
}
const exoInRange = (e, from, to) => !!e.date && (!from || e.date > from) && e.date <= to;
// Soldes (débit - crédit) cumulés à une date, en ignorant éventuellement une écriture.
function exoBalancesAt(entries, to, excludeId) {
  const b = {};
  (entries || []).forEach((e) => {
    if (!e.date || e.date > to || e.id === excludeId) return;
    (e.lines || []).forEach((l) => { b[l.account] = (b[l.account] || 0) + Number(l.debit || 0) - Number(l.credit || 0); });
  });
  return b;
}
// Situation d'un exercice : résultat, balance avant clôture, journal.
function exoStatement(accounts, entries, ex) {
  const byCode = new Map((accounts || []).map((a) => [a.code, a]));
  const per = (entries || []).filter((e) => exoInRange(e, ex.from, ex.to) && e.id !== ex.closingEntryId);
  const mv = {};
  per.forEach((e) => (e.lines || []).forEach((l) => { mv[l.account] = (mv[l.account] || 0) + Number(l.debit || 0) - Number(l.credit || 0); }));
  const pick = (type, sign) => (accounts || []).filter((a) => a.type === type && Math.round((mv[a.code] || 0) * 100) !== 0)
    .map((a) => ({ code: a.code, name: a.name, amount: exoR2(sign * (mv[a.code] || 0)) }))
    .sort((x, y) => String(x.code).localeCompare(String(y.code), undefined, { numeric: true }));
  const produits = pick("Produit", -1), charges = pick("Charge", 1);
  const totalProduits = exoR2(produits.reduce((s, r) => s + r.amount, 0)), totalCharges = exoR2(charges.reduce((s, r) => s + r.amount, 0));
  const cum = {};
  (entries || []).forEach((e) => {
    if (!e.date || e.date > ex.to || e.id === ex.closingEntryId) return;
    (e.lines || []).forEach((l) => {
      const c = cum[l.account] || (cum[l.account] = { debit: 0, credit: 0 });
      c.debit += Number(l.debit || 0); c.credit += Number(l.credit || 0);
    });
  });
  const trial = Object.keys(cum).map((code) => {
    const a = byCode.get(code), c = cum[code];
    return { code, name: a ? a.name : "(compte absent du plan comptable)", type: a ? a.type : "", debit: exoR2(c.debit), credit: exoR2(c.credit), solde: exoR2(c.debit - c.credit) };
  }).filter((r) => r.debit !== 0 || r.credit !== 0).sort((x, y) => String(x.code).localeCompare(String(y.code), undefined, { numeric: true }));
  const journal = (entries || []).filter((e) => exoInRange(e, ex.from, ex.to))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.createdAt || "").localeCompare(String(b.createdAt || ""))));
  return { produits, charges, totalProduits, totalCharges, resultat: exoR2(totalProduits - totalCharges), trial, journal };
}
// Emprunt en devise à une date : capital restant dû et valeur comptable (en gourdes) selon les paiements déjà faits.
function exoLoanAt(loan, asOf) {
  if (!loan || !loan.currency || loan.currency === "HTG") return null;
  if (!loan.alreadyRunning && loan.startDate && loan.startDate > asOf) return null;
  const paid = (loan.rows || []).filter((r) => r.status === "payee" && (r.paidDate || r.date) <= asOf);
  const cap = paid.reduce((s, r) => s + (r.capital || 0), 0), carry = paid.reduce((s, r) => s + (r.carry || 0), 0);
  const remaining = exoR2((loan.principal || 0) - cap), book = exoR2((loan.bookHtg || 0) - carry);
  if (!(remaining > 0.004)) return null;
  return { remaining, book };
}
// Plan de réévaluation. items : [{ kind: creance|dette|banque|emprunt, label, currency, foreign, book, account }]
// rateOf(currency) → taux ou null. delta = valeur au taux de clôture - valeur comptable.
// Actif (créance, banque) : delta > 0 = gain latent ; Passif (dette, emprunt) : delta > 0 = perte latente.
function exoRevalPlan(items, rateOf) {
  const rows = [], missing = [];
  (items || []).forEach((it) => {
    const rate = rateOf(it.currency);
    if (!(rate > 0)) { if (!missing.includes(it.currency)) missing.push(it.currency); rows.push({ ...it, rate: null, value: null, delta: 0, nature: "taux" }); return; }
    const value = exoR2(it.foreign * rate), delta = exoR2(value - it.book);
    const asset = it.kind === "creance" || it.kind === "banque";
    const gain = asset ? delta > 0 : delta < 0;
    rows.push({ ...it, rate, value, delta, nature: delta === 0 ? "nul" : gain ? "gain" : "perte" });
  });
  const totals = {
    gain: exoR2(rows.filter((r) => r.nature === "gain").reduce((s, r) => s + Math.abs(r.delta), 0)),
    perte: exoR2(rows.filter((r) => r.nature === "perte").reduce((s, r) => s + Math.abs(r.delta), 0)),
  };
  const acc = {};
  const add = (code, side, amt) => { const k = code + "|" + side; acc[k] = exoR2((acc[k] || 0) + amt); };
  rows.forEach((r) => {
    if (r.nature !== "gain" && r.nature !== "perte") return;
    const d = Math.abs(r.delta);
    // Gain latent (actif en hausse ou dette en baisse) : débit du compte, crédit 477 — le gain n'est pas pris en résultat.
    // Perte latente (actif en baisse ou dette en hausse) : débit 476, crédit du compte.
    if (r.nature === "gain") { add(r.account, "d", d); add(EXO_DIFF_ACCOUNTS.passif.code, "c", d); }
    else { add(EXO_DIFF_ACCOUNTS.actif.code, "d", d); add(r.account, "c", d); }
  });
  const lines = [];
  Object.keys(acc).forEach((k) => {
    const [code, side] = k.split("|"), amt = acc[k];
    if (amt > 0) lines.push({ account: code, debit: side === "d" ? amt : 0, credit: side === "c" ? amt : 0 });
  });
  // Un compte peut figurer des deux côtés (ex. 411 en gain et en perte) : on les regroupe par compte.
  const merged = {};
  lines.forEach((l) => { const m = merged[l.account] || (merged[l.account] = { account: l.account, debit: 0, credit: 0 }); m.debit = exoR2(m.debit + l.debit); m.credit = exoR2(m.credit + l.credit); });
  const outLines = Object.values(merged).map((m) => {
    const net = exoR2(m.debit - m.credit);
    return { account: m.account, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 };
  }).filter((l) => l.debit > 0 || l.credit > 0);
  const bal = exoR2(outLines.reduce((s, l) => s + l.debit - l.credit, 0));
  return { rows, totals, lines: outLines, balanced: bal === 0, missing };
}
// Réouverture du dernier exercice clos : contrepassation de l'écriture de clôture, à sa date.
function exoReopen(entries, motif, mkId, nowIso, by) {
  const cl = exoClosings(entries);
  if (!cl.length) return null;
  const last = cl[cl.length - 1];
  const orig = (entries || []).find((e) => e.id === last.entryId);
  if (!orig) return null;
  const prevDate = cl.length > 1 ? cl[cl.length - 2].date : null;
  const entry = {
    id: mkId(), date: orig.date, createdAt: nowIso,
    label: "Clôture de l'exercice au " + last.date + " — annulée (réouverture)",
    reversalOf: orig.id,
    lines: (orig.lines || []).map((l) => ({ account: l.account, debit: Number(l.credit || 0), credit: Number(l.debit || 0) })),
    reopen: { motif, by: by || "", at: nowIso },
  };
  const newSettings = { lastClosingDate: prevDate, lockDate: prevDate || "", exerciseReopen: { closingDate: last.date, motif, by: by || "", at: nowIso } };
  return { orig, entry, newSettings, closingDate: last.date, prevDate };
}
// </calcul-exercices>

function exoCsv(rows) {
  return "﻿" + rows.map((r) => r.map((c) => { const s = String(c == null ? "" : c); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(";")).join("\r\n");
}
function exoDownload(name, rows) {
  try {
    const blob = new Blob([exoCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) { /* téléchargement indisponible */ }
}
const exoNum = (n) => String(exoR2(n)).replace(".", ",");

function ExercicesPanel({ accounts, setAccounts, entries, setEntries, settings, setSettings, loans, role, planTier, currentUserEmail, pendingApprovals, setPendingApprovals, showToast, logAudit }) {
  const isAdmin = role === "Administrateur";
  const today = todayStr();
  const [view, setView] = useState("consulter");
  const list = useMemo(() => exoList(entries, today), [entries, today]);
  const closed = list.filter((x) => !x.open);
  const [selKey, setSelKey] = useState(null);
  const sel = list.find((x) => x.key === selKey) || (closed.length ? closed[closed.length - 1] : list[list.length - 1]);
  const [part, setPart] = useState("bilan");

  const inp = "border rounded px-2 py-1.5 text-sm";
  const bd = { borderColor: "#DDD6C4" };
  const th = { color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 };
  const label = (x) => (x.open ? "Exercice en cours" : "Exercice clos le " + x.to) + (x.from ? " (depuis le " + x.from + ")" : " (depuis le début)");

  // ── 1. Consulter ───────────────────────────────────────────────────────────
  const st = useMemo(() => exoStatement(accounts, entries, sel), [accounts, entries, sel]);
  const idx = list.findIndex((x) => x.key === sel.key);
  const prevEx = idx > 0 ? list[idx - 1] : null;
  const stPrev = useMemo(() => (prevEx ? exoStatement(accounts, entries, prevEx) : null), [accounts, entries, prevEx]);
  const bilanCur = useMemo(() => bilanClasse(accounts, exoBalancesAt(entries, sel.to), 0), [accounts, entries, sel]);
  const bilanPrev = useMemo(() => (prevEx ? { date: prevEx.to, cls: bilanClasse(accounts, exoBalancesAt(entries, prevEx.to), 0) } : null), [accounts, entries, prevEx]);

  const exportJournal = () => exoDownload("journal-" + (sel.open ? "exercice-en-cours" : "exercice-" + sel.to) + ".csv",
    [["Date", "Libellé", "Compte", "Débit", "Crédit"], ...st.journal.flatMap((e) => (e.lines || []).map((l) => [e.date, e.label, l.account, exoNum(l.debit || 0), exoNum(l.credit || 0)]))]);
  const exportTrial = () => exoDownload("balance-avant-cloture-" + (sel.open ? "en-cours" : sel.to) + ".csv",
    [["Compte", "Intitulé", "Débit", "Crédit", "Solde"], ...st.trial.map((r) => [r.code, r.name, exoNum(r.debit), exoNum(r.credit), exoNum(r.solde)])]);

  const renderResult = () => {
    const pm = new Map();
    const merge = (arr, key, k) => arr.forEach((r) => { const m = pm.get(key + r.code) || { code: r.code, name: r.name, key, cur: 0, prev: 0 }; m[k] = r.amount; pm.set(key + r.code, m); });
    merge(st.produits, "p", "cur"); merge(st.charges, "c", "cur");
    if (stPrev) { merge(stPrev.produits, "p", "prev"); merge(stPrev.charges, "c", "prev"); }
    const rows = [...pm.values()].sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
    const block = (title, key, total, totalPrev, color) => (
      <>
        <tr><td colSpan={stPrev ? 3 : 2} className="pt-3 pb-1 pl-3 font-semibold" style={{ color: "#152238", background: "#F6F3EA", fontSize: 12 }}>{title}</td></tr>
        {rows.filter((r) => r.key === key).map((r) => (
          <tr key={key + r.code}><td className="py-1.5 pl-5 pr-2" style={{ color: "#152238" }}>{r.code} — {r.name}</td><td className="py-1.5 px-3 text-right tabular" style={{ color }}>{fmt(r.cur)}</td>{stPrev && <td className="py-1.5 px-3 text-right tabular" style={{ color: "#8A8370" }}>{fmt(r.prev)}</td>}</tr>
        ))}
        <tr style={{ background: "#FAF8F1" }}><td className="py-2 pl-3 font-semibold" style={{ color: "#152238" }}>Total</td><td className="py-2 px-3 text-right tabular font-semibold" style={{ color }}>{fmt(total)}</td>{stPrev && <td className="py-2 px-3 text-right tabular font-semibold" style={{ color: "#8A8370" }}>{fmt(totalPrev)}</td>}</tr>
      </>
    );
    return (
      <div className="overflow-x-auto" data-testid="exo-result"><table className="w-full text-sm">
        <thead><tr style={{ background: "#C7CCDA" }}><th className="py-2 px-3 text-left font-medium" style={th}>Rubrique</th><th className="py-2 px-3 text-right font-medium" style={th}>{sel.open ? "Exercice en cours" : "Au " + sel.to}</th>{stPrev && <th className="py-2 px-3 text-right font-medium" style={th}>Au {prevEx.to}</th>}</tr></thead>
        <tbody>
          {block("Produits", "p", st.totalProduits, stPrev ? stPrev.totalProduits : 0, "#0F6B5C")}
          {block("Charges", "c", st.totalCharges, stPrev ? stPrev.totalCharges : 0, "#A6432F")}
          <tr style={{ background: st.resultat >= 0 ? "#E6F1EE" : "#F7E9E3" }}><td className="py-2.5 pl-3 font-semibold" style={{ color: "#152238" }}>Résultat ({st.resultat >= 0 ? "bénéfice" : "perte"})</td><td className="py-2.5 px-3 text-right tabular font-semibold" data-testid="exo-resultat" style={{ color: st.resultat >= 0 ? "#0F6B5C" : "#A6432F" }}>{fmt(st.resultat)}</td>{stPrev && <td className="py-2.5 px-3 text-right tabular font-semibold" style={{ color: "#8A8370" }}>{fmt(stPrev.resultat)}</td>}</tr>
        </tbody>
      </table></div>
    );
  };

  // ── 2. Réévaluation des devises ───────────────────────────────────────────
  const [asOf, setAsOf] = useState(() => { const y = new Date().getFullYear(); return `${y}-12-31` <= today ? `${y}-12-31` : today; });
  const [rateIn, setRateIn] = useState({});
  const [expert, setExpert] = useState("");
  const [validated, setValidated] = useState(false);
  const rates = settings.fxRates || [];
  const items = useMemo(() => {
    const upto = (entries || []).filter((e) => e.date && e.date <= asOf);
    const out = [];
    fxDocs(upto).filter((d) => d.remainingForeign > 0.004).forEach((d) => out.push({ kind: d.kind, label: (d.kind === "creance" ? "Créance " : "Dette ") + (d.party || "") + (d.ref ? " (" + d.ref + ")" : ""), currency: d.currency, foreign: d.remainingForeign, book: d.remainingBase, account: d.kind === "creance" ? "411" : "401" }));
    const pos = fxcPosition(upto);
    if (pos.usd > 0.004) out.push({ kind: "banque", label: "Compte en dollars (5121)", currency: "USD", foreign: pos.usd, book: pos.cost, account: FX_USD_ACCOUNT.code });
    (loans || []).forEach((l) => { const x = exoLoanAt(l, asOf); if (x) out.push({ kind: "emprunt", label: "Emprunt — " + l.name, currency: l.currency, foreign: x.remaining, book: x.book, account: l.account }); });
    return out;
  }, [entries, loans, asOf]);
  const rateOf = (cur) => (rateIn[cur] !== undefined && rateIn[cur] !== "" ? Number(rateIn[cur]) : fxRateOn(rates, cur, asOf));
  const plan = exoRevalPlan(items, rateOf);
  const curs = [...new Set(items.map((i) => i.currency))];
  const accName = (code) => { const a = accounts.find((x) => x.code === code); return a ? a.name : (code === "476" ? EXO_DIFF_ACCOUNTS.actif.name : code === "477" ? EXO_DIFF_ACCOUNTS.passif.name : ""); };
  const already = (entries || []).some((e) => e.exoReval && e.exoReval.asOf === asOf && !e.reversalOf && !e.cancelledBy);
  const exportReval = () => exoDownload("reevaluation-devises-" + asOf + ".csv", [
    ["Élément", "Devise", "Montant en devise", "Valeur comptable (HTG)", "Taux de clôture", "Valeur au taux de clôture (HTG)", "Écart", "Nature"],
    ...plan.rows.map((r) => [r.label, r.currency, exoNum(r.foreign), exoNum(r.book), r.rate == null ? "" : r.rate, r.value == null ? "" : exoNum(r.value), exoNum(r.delta), r.nature === "gain" ? "gain latent" : r.nature === "perte" ? "perte latente" : r.nature === "taux" ? "taux manquant" : "aucun écart"]),
    [], ["Écriture proposée à la date du " + asOf], ["Compte", "Intitulé", "Débit", "Crédit"],
    ...plan.lines.map((l) => [l.account, accName(l.account), exoNum(l.debit), exoNum(l.credit)]),
  ]);
  const bookReval = () => {
    if (!isAdmin) { showToast("Seul un administrateur peut comptabiliser cette écriture."); return; }
    if (isLocked(asOf, settings)) { showToast("La période comptable est clôturée jusqu'au " + settings.lockDate + " inclus : choisissez une date postérieure."); return; }
    if (already) { showToast("La réévaluation à cette date a déjà été comptabilisée."); return; }
    if (plan.missing.length) { showToast("Indiquez le taux de clôture manquant : " + plan.missing.join(", ") + "."); return; }
    if (!plan.lines.length || !plan.balanced) { showToast("Aucune écriture à comptabiliser."); return; }
    if (!validated || expert.trim().length < 3) { showToast("Indiquez le nom de l'expert-comptable et cochez la validation avant de comptabiliser."); return; }
    if (!window.confirm("Comptabiliser la réévaluation des devises au " + asOf + " ? Une écriture sera passée aux comptes 476/477, puis extournée automatiquement le lendemain. Le résultat n'est pas modifié.")) return;
    const missingAcc = [];
    [...plan.lines.map((l) => l.account)].forEach((c) => { if (!accounts.some((a) => a.code === c) && !missingAcc.includes(c)) missingAcc.push(c); });
    if (missingAcc.length) setAccounts((prev) => [...prev, ...missingAcc.filter((c) => !prev.some((a) => a.code === c)).map((c) => (c === "476" ? EXO_DIFF_ACCOUNTS.actif : EXO_DIFF_ACCOUNTS.passif)).filter(Boolean).map((a) => ({ code: a.code, name: a.name, type: a.type }))]);
    const meta = { asOf, validatedBy: expert.trim(), rates: Object.fromEntries(curs.map((c) => [c, rateOf(c)])) };
    const e1 = { id: uid(), date: asOf, createdAt: new Date().toISOString(), label: "Réévaluation des devises au " + asOf + " (écarts de conversion)", lines: plan.lines, exoReval: meta };
    const e2 = { id: uid(), date: exoAddDays(asOf, 1), createdAt: new Date().toISOString(), label: "Extourne réévaluation des devises du " + asOf, lines: plan.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })), reversalOf: e1.id };
    e1.cancelledBy = e2.id;
    setEntries((prev) => [...prev, e1, e2]);
    logAudit("Comptabilité", "Réévaluation des devises comptabilisée", "Au " + asOf + " — validée par " + expert.trim() + " — gains latents " + fmt(plan.totals.gain) + ", pertes latentes " + fmt(plan.totals.perte));
    showToast("Réévaluation comptabilisée au " + asOf + ", avec extourne le lendemain.");
    setValidated(false);
  };

  // ── 3. Réouverture ─────────────────────────────────────────────────────────
  const [motif, setMotif] = useState("");
  const lastClosing = closed.length ? closed[closed.length - 1] : null;
  const reopened = settings.exerciseReopen;
  const doReopen = () => {
    if (!isAdmin) { showToast("Seul un administrateur peut rouvrir un exercice."); return; }
    if (!lastClosing) { showToast("Aucun exercice clos à rouvrir."); return; }
    if (motif.trim().length < 10) { showToast("Indiquez le motif de la réouverture (au moins 10 caractères)."); return; }
    const r = exoReopen(entries, motif.trim(), uid, new Date().toISOString(), currentUserEmail);
    if (!r) { showToast("L'écriture de clôture est introuvable."); return; }
    if (planTier === "assisted") {
      if ((pendingApprovals || []).some((a) => a.type === "reouverture_exercice")) { showToast("Une réouverture est déjà en attente d'approbation."); return; }
      setPendingApprovals((prev) => [...prev, { id: uid(), type: "reouverture_exercice", label: "Réouverture de l'exercice clos le " + r.closingDate + " — motif : " + motif.trim(), requestedBy: currentUserEmail || "Inconnu", requestedAt: new Date().toISOString(), payload: { entry: r.entry, origId: r.orig.id, newSettings: r.newSettings } }]);
      showToast("Demande envoyée — en attente d'approbation par un administrateur.");
      setMotif("");
      return;
    }
    if (!window.confirm("Rouvrir l'exercice clos le " + r.closingDate + " ? L'écriture de clôture sera annulée à sa date, les charges et produits de cet exercice redeviendront visibles et la période sera déverrouillée" + (r.prevDate ? " après le " + r.prevDate : " en totalité") + ". Après vos corrections, vous devrez clôturer à nouveau. Un point de restauration sera créé.")) return;
    try { rpSave(_membership && _membership.companyId, bkBuildFile({ accounts, entries, settings, pendingApprovals }, _membership && _membership.companyId, "Avant réouverture"), "Avant réouverture de l'exercice du " + r.closingDate, true); } catch (e) { /* sans stockage local : la réouverture se fait quand même */ }
    setEntries((prev) => [...prev.map((x) => (x.id === r.orig.id ? { ...x, cancelledBy: r.entry.id } : x)), r.entry]);
    setSettings({ ...settings, ...r.newSettings });
    logAudit("Comptabilité", "Réouverture d'exercice", "Exercice clos le " + r.closingDate + " rouvert — motif : " + motif.trim());
    showToast("Exercice du " + r.closingDate + " rouvert. Corrigez, puis clôturez à nouveau.");
    setMotif("");
  };

  const tabBtn = (k, t) => (
    <button key={k} onClick={() => setView(k)} data-testid={"exo-view-" + k} className="px-3 py-1.5 rounded text-sm" style={{ background: view === k ? "#5B3FA0" : "#EDEAF7", color: view === k ? "#fff" : "#5B3FA0" }}>{t}</button>
  );
  const partBtn = (k, t) => (
    <button key={k} onClick={() => setPart(k)} data-testid={"exo-part-" + k} className="px-3 py-1 rounded text-xs" style={{ border: "1px solid #DDD6C4", background: part === k ? "#152238" : "#fff", color: part === k ? "#fff" : "#152238" }}>{t}</button>
  );

  return (
    <div className="space-y-5" data-testid="exercices-panel" data-ro-ok="1">
      <div className="flex flex-wrap gap-2">
        {tabBtn("consulter", "Consulter un exercice")}
        {tabBtn("devises", "Réévaluation des devises")}
        {tabBtn("rouvrir", "Rouvrir un exercice")}
      </div>

      {view === "consulter" && (
        <div className="bg-white rounded-lg p-5" style={{ border: "1px solid #E4DFD1" }}>
          <p className="text-xs mb-3" style={{ color: "#8A8370" }}>Consultation en lecture seule : les chiffres sont recalculés à la date de clôture choisie et ne modifient rien. La balance est présentée avant l'écriture de clôture.</p>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <select value={sel.key} onChange={(e) => setSelKey(e.target.value)} className={inp} style={bd} data-testid="exo-select">
              {list.slice().reverse().map((x) => <option key={x.key} value={x.key}>{label(x)}</option>)}
            </select>
            {closed.length === 0 && <span className="text-xs" style={{ color: "#8A8370" }}>Aucun exercice n'a encore été clôturé : seul l'exercice en cours est disponible.</span>}
          </div>
          <div className="flex flex-wrap gap-2 mb-4">{partBtn("bilan", "Bilan")}{partBtn("resultat", "Résultat")}{partBtn("balance", "Balance")}{partBtn("journal", "Journal")}</div>
          {part === "bilan" && <div data-testid="exo-bilan"><BilanClasseView cur={bilanCur} prev={bilanPrev} /></div>}
          {part === "resultat" && renderResult()}
          {part === "balance" && (
            <div>
              <div className="flex justify-end mb-2"><button onClick={exportTrial} className="px-3 py-1.5 rounded text-xs" style={{ border: "1px solid #DDD6C4", color: "#152238" }}>Exporter (Excel/CSV)</button></div>
              <div className="overflow-x-auto" data-testid="exo-balance"><table className="w-full text-sm">
                <thead><tr style={{ background: "#C7CCDA" }}>{["Compte", "Intitulé", "Débit", "Crédit", "Solde"].map((h, i) => <th key={h} className={"py-2 px-3 font-medium " + (i > 1 ? "text-right" : "text-left")} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {st.trial.map((r) => <tr key={r.code} style={{ borderTop: "1px solid #F3EFE3" }}><td className="py-1.5 px-3 tabular">{r.code}</td><td className="py-1.5 px-3">{r.name}</td><td className="py-1.5 px-3 text-right tabular">{fmt(r.debit)}</td><td className="py-1.5 px-3 text-right tabular">{fmt(r.credit)}</td><td className="py-1.5 px-3 text-right tabular font-medium">{fmt(r.solde)}</td></tr>)}
                  <tr style={{ background: "#FAF8F1" }}><td colSpan={2} className="py-2 px-3 font-semibold">Total</td><td className="py-2 px-3 text-right tabular font-semibold">{fmt(st.trial.reduce((s, r) => s + r.debit, 0))}</td><td className="py-2 px-3 text-right tabular font-semibold">{fmt(st.trial.reduce((s, r) => s + r.credit, 0))}</td><td className="py-2 px-3" /></tr>
                </tbody>
              </table></div>
            </div>
          )}
          {part === "journal" && (
            <div>
              <div className="flex justify-between items-center mb-2"><span className="text-xs" style={{ color: "#8A8370" }}>{st.journal.length} écriture(s) sur la période.</span><button onClick={exportJournal} className="px-3 py-1.5 rounded text-xs" style={{ border: "1px solid #DDD6C4", color: "#152238" }}>Exporter (Excel/CSV)</button></div>
              <div className="overflow-x-auto" data-testid="exo-journal"><table className="w-full text-sm">
                <thead><tr style={{ background: "#C7CCDA" }}>{["Date", "Libellé", "Montant"].map((h, i) => <th key={h} className={"py-2 px-3 font-medium " + (i === 2 ? "text-right" : "text-left")} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {st.journal.map((e) => <tr key={e.id} data-testid="exo-journal-row" style={{ borderTop: "1px solid #F3EFE3" }}><td className="py-1.5 px-3 tabular whitespace-nowrap">{e.date}</td><td className="py-1.5 px-3">{e.label}</td><td className="py-1.5 px-3 text-right tabular">{fmt((e.lines || []).reduce((s, l) => s + Number(l.debit || 0), 0))}</td></tr>)}
                </tbody>
              </table></div>
            </div>
          )}
        </div>
      )}

      {view === "devises" && (
        <div className="bg-white rounded-lg p-5" style={{ border: "1px solid #E4DFD1" }} data-testid="exo-reval">
          <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Réévaluation des devises à la clôture</div>
          <p className="text-xs mb-3" style={{ color: "#8A8370" }}>
            Les créances, dettes, emprunts et le compte en dollars encore ouverts sont revalorisés au taux de clôture. L'écart obtenu est un écart <b>latent</b> : il est estimé ici et n'affecte pas le résultat. Le traitement comptable en Haïti (comptes 476/477, provision éventuelle pour les pertes latentes) doit être <b>validé par votre expert-comptable</b> avant toute écriture : vous pouvez d'abord exporter l'état pour le lui soumettre.
          </p>
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div><label className="text-xs block" style={{ color: "#8A8370" }}>Date de clôture</label><input type="date" value={asOf} max={today} onChange={(e) => setAsOf(e.target.value)} className={inp} style={bd} data-testid="reval-date" /></div>
            {curs.map((c) => (
              <div key={c}><label className="text-xs block" style={{ color: "#8A8370" }}>Taux {c} à la clôture</label><input type="number" min="0" step="any" value={rateIn[c] !== undefined ? rateIn[c] : ""} placeholder={fxRateOn(rates, c, asOf) ? String(fxRateOn(rates, c, asOf)) : "Taux"} onChange={(e) => setRateIn({ ...rateIn, [c]: e.target.value })} className={inp + " text-right tabular"} style={{ ...bd, width: 130 }} data-testid={"reval-rate-" + c} /></div>
            ))}
          </div>
          {items.length === 0 ? (
            <div className="text-sm py-4" style={{ color: "#A39C87" }} data-testid="reval-empty">Aucune créance, dette, emprunt ni solde en devise ouvert à cette date : rien à réévaluer.</div>
          ) : (
            <>
              <div className="overflow-x-auto"><table className="w-full text-sm" data-testid="reval-table">
                <thead><tr style={{ background: "#C7CCDA" }}>{["Élément", "En devise", "Valeur comptable", "Au taux de clôture", "Écart latent"].map((h, i) => <th key={h} className={"py-2 px-3 font-medium " + (i > 0 ? "text-right" : "text-left")} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {plan.rows.map((r, i) => (
                    <tr key={i} data-testid="reval-row" style={{ borderTop: "1px solid #F3EFE3" }}>
                      <td className="py-1.5 px-3">{r.label}</td>
                      <td className="py-1.5 px-3 text-right tabular">{fmtFx(r.foreign, r.currency)}</td>
                      <td className="py-1.5 px-3 text-right tabular">{fmt(r.book)}</td>
                      <td className="py-1.5 px-3 text-right tabular">{r.value == null ? "taux manquant" : fmt(r.value)}</td>
                      <td className="py-1.5 px-3 text-right tabular font-medium" style={{ color: r.nature === "gain" ? "#0F6B5C" : r.nature === "perte" ? "#A6432F" : "#8A8370" }}>{r.nature === "taux" ? "—" : r.nature === "nul" ? "aucun" : (r.nature === "gain" ? "gain " : "perte ") + fmt(Math.abs(r.delta))}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
              <div className="flex flex-wrap gap-6 mt-3 text-sm" data-testid="reval-totals">
                <div>Gains latents : <b className="tabular" style={{ color: "#0F6B5C" }} data-testid="reval-gain">{fmt(plan.totals.gain)}</b></div>
                <div>Pertes latentes : <b className="tabular" style={{ color: "#A6432F" }} data-testid="reval-perte">{fmt(plan.totals.perte)}</b></div>
              </div>
              {plan.lines.length > 0 && (
                <div className="mt-4 p-3 rounded" style={{ background: "#F7F4EA" }} data-testid="reval-proposal">
                  <div className="text-xs font-medium mb-2" style={{ color: "#152238" }}>Écriture proposée au {asOf} (extournée le {exoAddDays(asOf, 1)})</div>
                  <table className="w-full text-xs"><tbody>
                    {plan.lines.map((l, i) => <tr key={i}><td className="py-0.5 tabular pr-2">{l.account}</td><td className="py-0.5 pr-2">{accName(l.account)}</td><td className="py-0.5 text-right tabular">{l.debit ? fmt(l.debit) : ""}</td><td className="py-0.5 text-right tabular">{l.credit ? fmt(l.credit) : ""}</td></tr>)}
                  </tbody></table>
                </div>
              )}
              <div className="flex flex-wrap gap-2 mt-4">
                <button onClick={exportReval} data-testid="reval-export" className="px-3 py-1.5 rounded text-xs" style={{ border: "1px solid #DDD6C4", color: "#152238" }}>Exporter pour l'expert-comptable (Excel/CSV)</button>
              </div>
              {isAdmin ? (
                <div className="mt-4 pt-4" style={{ borderTop: "1px solid #F0EDE3" }}>
                  <div className="text-xs mb-2" style={{ color: "#7A7460" }}>Comptabilisation : réservée aux cas où l'expert-comptable a validé ce traitement.</div>
                  <div className="flex flex-wrap items-end gap-3">
                    <div><label className="text-xs block" style={{ color: "#8A8370" }}>Expert-comptable ayant validé</label><input value={expert} onChange={(e) => setExpert(e.target.value)} className={inp} style={{ ...bd, width: 240 }} placeholder="Nom et prénom" data-testid="reval-expert" /></div>
                    <label className="flex items-center gap-2 text-xs cursor-pointer pb-2" style={{ color: "#152238" }}><input type="checkbox" checked={validated} onChange={(e) => setValidated(e.target.checked)} data-testid="reval-validated" /> Il a validé ce traitement (comptes 476/477, sans effet sur le résultat)</label>
                    <button onClick={bookReval} disabled={already} data-testid="reval-book" className="px-4 py-2 rounded text-sm text-white" style={{ background: "#152238", opacity: already ? 0.5 : 1 }}>Comptabiliser</button>
                  </div>
                  {already && <div className="text-xs mt-2" style={{ color: "#0F6B5C" }}>La réévaluation à cette date est déjà comptabilisée.</div>}
                </div>
              ) : <div className="text-xs mt-4" style={{ color: "#8A8370" }}>Seul un administrateur peut comptabiliser cette écriture.</div>}
            </>
          )}
        </div>
      )}

      {view === "rouvrir" && (
        <div className="bg-white rounded-lg p-5" style={{ border: "1px solid #E4DFD1" }} data-testid="exo-reopen">
          <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Rouvrir le dernier exercice clos</div>
          <p className="text-xs mb-3" style={{ color: "#8A8370" }}>
            À utiliser seulement pour corriger une erreur découverte après la clôture. L'écriture de clôture est annulée à sa date (rien n'est supprimé), les écritures de cet exercice redeviennent modifiables, puis vous clôturez à nouveau. Un point de restauration est créé, et l'opération est inscrite dans l'historique avec son motif. Seul le dernier exercice clos peut être rouvert.
          </p>
          {reopened && (
            <div className="p-3 rounded mb-3 text-xs" style={{ background: "#FBF3DC", color: "#7A5F10" }} data-testid="exo-reopened">
              L'exercice clos le {reopened.closingDate} est rouvert (motif : {reopened.motif}). Après vos corrections, clôturez à nouveau dans « Clôture annuelle ».
            </div>
          )}
          {!lastClosing ? (
            <div className="text-sm py-3" style={{ color: "#A39C87" }} data-testid="reopen-none">Aucun exercice clos : rien à rouvrir.</div>
          ) : !isAdmin ? (
            <div className="text-sm py-3" style={{ color: "#8A8370" }}>Seul un administrateur peut rouvrir un exercice.</div>
          ) : (
            <div>
              <div className="text-sm mb-2" style={{ color: "#152238" }}>Dernier exercice clos : <b data-testid="reopen-date">{lastClosing.to}</b></div>
              <label className="text-xs block" style={{ color: "#8A8370" }}>Motif de la réouverture (obligatoire)</label>
              <textarea value={motif} onChange={(e) => setMotif(e.target.value)} rows={3} className={inp + " w-full mt-1"} style={bd} placeholder="Ex : facture fournisseur oubliée, à enregistrer dans l'exercice clos" data-testid="reopen-motif" />
              <button onClick={doReopen} data-testid="reopen-btn" className="mt-3 px-4 py-2 rounded text-sm text-white" style={{ background: "#A6432F" }}>Rouvrir l'exercice</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
