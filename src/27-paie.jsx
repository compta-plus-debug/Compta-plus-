// ═══ MODULE ═══
// @module Paie
// @depends AssistedPrincipleReminder, FISCAL_RULES_VALIDATED, Pencil, PendingRecommendationsBanner
//   RecordedStamp, RotateCcw, _membership, detectAmountAnomaly, downloadTablePDF, fmt
//   isFutureDate, isLocked, todayStr, uid, useAssistedAnomalyGate, useBackNav, useEffect, useState
// @exports PayrollModule
// ═══ FIN DE L'EN-TÊTE ═══
// ── Chantier C : cotisations de paie à taux paramétrables ───────────────────
// Aucun taux n'est livré par défaut : les taux légaux (part salariale / patronale,
// plafonds) doivent être saisis par l'entreprise et validés avec l'expert-comptable.
// Chaque rubrique : { id, label, part: "salarie"|"employeur", rate (en %), ceiling (base plafonnée, facultatif), active }.
// Retenue d'impôt sur le salaire (articles 100 et 132 du Code fiscal, en vigueur depuis le 1er octobre 2026) :
// l'employeur retient chaque mois 1/12 de l'impôt annuel calculé sur le salaire annuel (salaire mensuel x 12).
const HL_IR_BAREME = [[0, 360000, 0], [360000, 540000, 0.12], [540000, 1080000, 0.18], [1080000, 2160000, 0.25], [2160000, Infinity, 0.30]];
function retenueIRSalaireMensuelle(salaireMensuel) {
  const annuel = Math.max(0, Number(salaireMensuel) || 0) * 12;
  let impot = 0;
  HL_IR_BAREME.forEach(([min, max, taux]) => { if (annuel > min) impot += (Math.min(annuel, max) - min) * taux; });
  return Math.round((impot / 12) * 100) / 100;
}
const PAYROLL_PARTS = { salarie: "Part salariale (retenue)", employeur: "Part patronale (charge)" };
const prR2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
function payrollCompute(gross, rubriques) {
  const out = { employee: [], employer: [], employeeTotal: 0, employerTotal: 0 };
  (rubriques || []).forEach((r) => {
    const rate = Number(r.rate);
    if (!r.active || !(rate > 0) || !(gross > 0)) return;
    const ceil = Number(r.ceiling);
    const base = ceil > 0 ? Math.min(gross, ceil) : gross;
    const amount = prR2(base * rate / 100);
    if (!(amount > 0)) return;
    const item = { id: r.id, label: r.label, part: r.part === "employeur" ? "employeur" : "salarie", rate, base: prR2(base), amount };
    if (item.part === "employeur") { out.employer.push(item); out.employerTotal = prR2(out.employerTotal + amount); }
    else { out.employee.push(item); out.employeeTotal = prR2(out.employeeTotal + amount); }
  });
  return out;
}
function PayrollRatesPanel({ settings, setSettings, role, showToast, logAudit }) {
  const canEdit = role === "Administrateur" || role === "Éditeur";
  const list = settings.payrollRubriques || [];
  const [form, setForm] = useState({ label: "", part: "salarie", rate: "", ceiling: "" });
  const save = (next, msg) => { setSettings({ ...settings, payrollRubriques: next }); if (msg) logAudit("Salaires (RH)", "Cotisations paramétrées", msg); };
  const add = () => {
    const rate = Number(form.rate);
    if (!form.label.trim()) { showToast("Donnez un nom à la cotisation (ex. : ONA)."); return; }
    if (!(rate > 0) || rate > 100) { showToast("Le taux doit être compris entre 0 et 100 %."); return; }
    const ceiling = form.ceiling === "" ? 0 : Number(form.ceiling);
    if (!(ceiling >= 0)) { showToast("Le plafond doit être positif (ou vide)."); return; }
    save([...list, { id: uid(), label: form.label.trim(), part: form.part, rate, ceiling, active: true }], `${form.label.trim()} ${rate} % (${form.part})`);
    setForm({ label: "", part: form.part, rate: "", ceiling: "" });
    showToast("Cotisation ajoutée.");
  };
  const toggle = (id) => save(list.map((r) => (r.id === id ? { ...r, active: !r.active } : r)), "Activation / désactivation d'une cotisation");
  const remove = (id) => { if (!window.confirm("Supprimer cette cotisation ? Les bulletins déjà enregistrés ne changent pas.")) return; save(list.filter((r) => r.id !== id), "Suppression d'une cotisation"); };
  const inputCls = "w-full border rounded px-2 py-1.5 text-sm mt-1";
  const inputStyle = { borderColor: "#DDD6C4" };
  return (
    <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }} data-testid="payroll-rates-panel">
      <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Cotisations sociales et retenues (taux paramétrables)</div>
      <div className="text-xs px-3 py-2 rounded mb-4" style={{ background: "#FBF1DC", color: "#7A5F10" }} data-testid="payroll-rates-notice">
        Aucun taux n'est préchargé : saisissez les taux en vigueur (ONA, OFATMA, etc.) et faites-les valider par votre expert-comptable. Taux à valider avant usage en production.
      </div>
      {list.length === 0 ? (
        <div className="text-xs mb-4" style={{ color: "#A39C87" }} data-testid="payroll-rates-empty">Aucune cotisation paramétrée : les retenues restent saisies à la main sur chaque bulletin.</div>
      ) : (
        <div className="overflow-x-auto mb-4"><table className="w-full text-sm" data-testid="payroll-rates-table">
          <thead><tr style={{ background: "#C7CCDA" }}>
            {["Cotisation", "Part", "Taux", "Plafond", "Actif", ""].map((h, i) => <th key={i} className="py-2 px-3 text-left font-medium" style={{ color: "#152238", fontSize: 11, textTransform: "uppercase" }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} data-testid="payroll-rate-row" style={{ borderTop: "1px solid #EEE9DA", opacity: r.active ? 1 : 0.55 }}>
                <td className="py-2 px-3">{r.label}</td>
                <td className="py-2 px-3 text-xs">{r.part === "employeur" ? "Patronale" : "Salariale"}</td>
                <td className="py-2 px-3 tabular">{r.rate} %</td>
                <td className="py-2 px-3 tabular">{r.ceiling > 0 ? fmt(r.ceiling) : "—"}</td>
                <td className="py-2 px-3">{canEdit ? <button onClick={() => toggle(r.id)} className="text-xs underline" data-testid="payroll-rate-toggle">{r.active ? "Oui" : "Non"}</button> : (r.active ? "Oui" : "Non")}</td>
                <td className="py-2 px-3 text-right">{canEdit && <button onClick={() => remove(r.id)} className="text-xs" style={{ color: "#A6432F" }}>Supprimer</button>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {canEdit && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Nom de la cotisation</label>
            <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} className={inputCls} style={inputStyle} data-testid="payroll-rate-label" />
          </div>
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Part</label>
            <select value={form.part} onChange={(e) => setForm({ ...form, part: e.target.value })} className={inputCls} style={inputStyle} data-testid="payroll-rate-part">
              <option value="salarie">{PAYROLL_PARTS.salarie}</option>
              <option value="employeur">{PAYROLL_PARTS.employeur}</option>
            </select>
          </div>
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Taux (%) sur le brut</label>
            <input type="number" step="any" min="0" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} className={inputCls + " tabular"} style={inputStyle} data-testid="payroll-rate-rate" />
          </div>
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Plafond de la base (facultatif)</label>
            <input type="number" step="any" min="0" value={form.ceiling} onChange={(e) => setForm({ ...form, ceiling: e.target.value })} className={inputCls + " tabular"} style={inputStyle} data-testid="payroll-rate-ceiling" />
          </div>
          <div className="sm:col-span-2"><button onClick={add} className="px-4 py-2 rounded text-sm text-white" style={{ background: "#152238" }} data-testid="payroll-rate-add">Ajouter la cotisation</button></div>
        </div>
      )}
      <p className="text-xs mt-4" style={{ color: "#8A8370" }}>Les retenues salariales vont au compte 431 (à payer) ; la part patronale est inscrite en charge sociale (645) avec le même compte 431. Le montant est calculé sur le total brut de chaque bulletin, et reste modifiable à la main bulletin par bulletin.</p>
    </div>
  );
}

// --- Module 9 : Salaires (RH) ---
// État mensuel des retenues à la source à verser à la DGI (articles 100 et 103 du Code fiscal) : retenue sur salaire
// (1/12 de l'impôt annuel) et retenue sur primes / boni. Versement entre le 1er et le 15 du mois suivant, avec cet
// état explicatif. Lu directement des bulletins de paie enregistrés (les bulletins annulés sont exclus).
function RetenuesDGIPanel({ payslips, settings }) {
  const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const pre = `${year}-${String(month).padStart(2, "0")}`;
  const rows = (payslips || [])
    .filter((p) => p.status !== "annulé" && p.date && p.date.startsWith(pre) && ((Number(p.salaryWithholding) || 0) + (Number(p.bonusWithholding) || 0)) > 0)
    .map((p) => ({
      id: p.id, name: p.employeeName, periode: `${p.periodStart || ""} au ${p.periodEnd || ""}`, brut: Number(p.grossTotal) || 0,
      sal: Number(p.salaryWithholding) || 0, prime: Number(p.bonusAmount) || 0, taux: Number(p.bonusWithholdingRate) || 0,
      kind: p.bonusKind === "boni" ? "Boni" : "Prime / autre", pw: Number(p.bonusWithholding) || 0,
    }));
  const r2 = (x) => Math.round(x * 100) / 100;
  const totSal = r2(rows.reduce((t, r) => t + r.sal, 0));
  const totPrime = r2(rows.reduce((t, r) => t + r.pw, 0));
  const total = r2(totSal + totPrime);
  const nextM = month === 12 ? 1 : month + 1, nextY = month === 12 ? year + 1 : year;
  const echeance = `15 ${MOIS[nextM - 1]} ${nextY}`;
  const sansRetenue = (payslips || []).filter((p) => p.status !== "annulé" && p.date && p.date.startsWith(pre) && ((Number(p.salaryWithholding) || 0) + (Number(p.bonusWithholding) || 0)) === 0).length;
  const downloadPdf = () => {
    downloadTablePDF({
      title: `Etat des retenues ${MOIS[month - 1]} ${year}`,
      settings,
      columns: ["Employé", "Période", "Brut", "Retenue salaire (art. 100)", "Prime / boni", "Taux", "Retenue prime (art. 103)"],
      rows: rows.map((r) => [r.name, r.periode, fmt(r.brut), fmt(r.sal), r.prime > 0 ? `${fmt(r.prime)} (${r.kind})` : "—", r.taux > 0 ? `${r.taux} %` : "—", fmt(r.pw)]),
      footerLines: [
        `Total retenue sur salaires : ${fmt(totSal)}`,
        `Total retenue sur primes et boni : ${fmt(totPrime)}`,
        `TOTAL A VERSER A LA DGI : ${fmt(total)}`,
        `Versement entre le 1er et le 15 ${MOIS[nextM - 1]} ${nextY} (art. 100 et 103).`,
        settings.companyNIF ? `NIF : ${settings.companyNIF}` : "NIF : à renseigner dans Administration",
      ],
    });
  };
  return (
    <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
      <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>État mensuel des retenues à verser à la DGI</div>
      <p className="text-xs mb-4" style={{ color: "#8A8370" }}>
        Retenue sur salaire (articles 100 et 132) et retenue sur primes ou boni (article 103), lues de vos bulletins de paie enregistrés (bulletins annulés exclus). Le versement se fait entre le 1er et le 15 du mois suivant, accompagné de cet état. Les taux restent à valider avec votre expert-comptable.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div>
          <label className="text-xs" style={{ color: "#8A8370" }}>Année</label>
          <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
        </div>
        <div>
          <label className="text-xs" style={{ color: "#8A8370" }}>Mois des paies</label>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} data-testid="retenues-mois">
            {MOIS.map((m, i) => <option key={m} value={i + 1}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>)}
          </select>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="text-sm py-6 text-center" style={{ color: "#A39C87" }} data-testid="retenues-vide">Aucune retenue sur les bulletins de ce mois.{sansRetenue > 0 ? ` (${sansRetenue} bulletin${sansRetenue > 1 ? "s" : ""} sans retenue.)` : ""}</div>
      ) : (
        <div className="overflow-x-auto mb-4"><table className="w-full text-sm">
          <thead><tr className="text-left text-xs" style={{ color: "#8A8370", borderBottom: "1px solid #E4DFD1" }}>
            <th className="py-2 font-normal">Employé</th><th className="py-2 font-normal">Période</th><th className="py-2 font-normal text-right">Brut</th>
            <th className="py-2 font-normal text-right">Retenue salaire</th><th className="py-2 font-normal text-right">Prime / boni</th><th className="py-2 font-normal text-right">Retenue prime</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-testid="retenues-ligne" style={{ borderBottom: "1px solid #F3EFE3" }}>
                <td className="py-1.5">{r.name}</td><td className="py-1.5 text-xs tabular">{r.periode}</td><td className="py-1.5 tabular text-right">{fmt(r.brut)}</td>
                <td className="py-1.5 tabular text-right">{fmt(r.sal)}</td>
                <td className="py-1.5 tabular text-right text-xs">{r.prime > 0 ? `${fmt(r.prime)} · ${r.kind} ${r.taux} %` : "—"}</td>
                <td className="py-1.5 tabular text-right">{fmt(r.pw)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      <div className="p-3 rounded mb-4" style={{ background: "#F7E9E3" }}>
        <div className="flex justify-between text-sm tabular"><span>Retenue sur salaires</span><span data-testid="retenues-sal">{fmt(totSal)}</span></div>
        <div className="flex justify-between text-sm tabular"><span>Retenue sur primes et boni</span><span data-testid="retenues-prime">{fmt(totPrime)}</span></div>
        <div className="flex justify-between text-sm font-semibold tabular mt-1" style={{ color: "#A6432F" }}><span>Total à verser à la DGI</span><span data-testid="retenues-total">{fmt(total)}</span></div>
        <div className="text-xs mt-1" style={{ color: "#7A7460" }}>À verser entre le 1er et le 15 {MOIS[nextM - 1]} {nextY} (échéance : {echeance}).</div>
      </div>
      <button onClick={downloadPdf} disabled={rows.length === 0} className="px-4 py-2 rounded text-sm text-white" style={{ background: "#152238", opacity: rows.length === 0 ? 0.5 : 1 }} data-testid="retenues-pdf">Télécharger l'état (.pdf)</button>
    </div>
  );
}

function PayrollModule({ accounts, setAccounts, entries, setEntries, employees, setEmployees, payslips, setPayslips, salaryAdvances, setSalaryAdvances, settings, setSettings, role, showToast, logAudit, verifyTransactionSaved, planTier, recordPendingRecommendation, currentUserEmail, pendingRecommendations, resolvePendingRecommendation }) {
  const anomalyGate = useAssistedAnomalyGate();
  const hasPendingRH = (pendingRecommendations || []).some((r) => r.module === "salaires");
  const today = todayStr();
  const lastAdvanceSubmitRef = React.useRef(0);
  const lastPayslipSubmitRef = React.useRef(0);
  const [tab, setTab] = useState("employes");
  useBackNav(tab, setTab, "employes");

  // S'assure que les comptes nécessaires au module (avances au personnel, charges
  // sociales à payer) existent dans le plan comptable de l'entreprise, sans jamais
  // toucher aux comptes déjà là — ajout silencieux et sans risque au premier accès
  // au module, y compris pour une entreprise créée avant son existence.
  useEffect(() => {
    const missing = [];
    if (!accounts.some((a) => a.code === "425")) missing.push({ code: "425", name: "Avances et acomptes au personnel", type: "Actif" });
    if (!accounts.some((a) => a.code === "431")) missing.push({ code: "431", name: "Charges sociales et fiscales à payer", type: "Passif" });
    if (!accounts.some((a) => a.code === "645")) missing.push({ code: "645", name: "Charges sociales", type: "Charge" });
    if (missing.length) setAccounts((prev) => [...prev, ...missing]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const accountName = (code) => accounts.find((a) => a.code === code)?.name || code;
  const activeEmployees = employees.filter((e) => e.active);

  // --- Employés ---
  const emptyEmpForm = { name: "", position: "", nif: "", baseSalary: "", payFrequency: "mensuelle", overtimeRate: "" };
  const [empForm, setEmpForm] = useState(emptyEmpForm);
  const [editingEmployeeId, setEditingEmployeeId] = useState(null);

  const saveEmployee = () => {
    if (!empForm.name.trim() || !empForm.baseSalary || Number(empForm.baseSalary) <= 0) {
      showToast("Nom et salaire de base (positif) requis.");
      return;
    }
    if (editingEmployeeId) {
      setEmployees((prev) => prev.map((e) =>
        e.id === editingEmployeeId
          ? { ...e, name: empForm.name.trim(), position: empForm.position, nif: empForm.nif.trim(), baseSalary: Number(empForm.baseSalary), payFrequency: empForm.payFrequency, overtimeRate: Number(empForm.overtimeRate) || 0 }
          : e
      ));
      showToast("Employé modifié.");
      logAudit("Salaires (RH)", "Modification employé", empForm.name);
    } else {
      setEmployees((prev) => [...prev, {
        id: uid(), createdAt: new Date().toISOString(), name: empForm.name.trim(), position: empForm.position, nif: empForm.nif.trim(), baseSalary: Number(empForm.baseSalary),
        payFrequency: empForm.payFrequency, overtimeRate: Number(empForm.overtimeRate) || 0, active: true, hireDate: today,
      }]);
      showToast("Employé ajouté.");
      logAudit("Salaires (RH)", "Ajout employé", empForm.name);
    }
    setEditingEmployeeId(null);
    setEmpForm(emptyEmpForm);
  };

  const startEditEmployee = (emp) => {
    setEditingEmployeeId(emp.id);
    setEmpForm({ name: emp.name, position: emp.position || "", nif: emp.nif || "", baseSalary: emp.baseSalary, payFrequency: emp.payFrequency, overtimeRate: emp.overtimeRate || "" });
  };

  const cancelEditEmployee = () => { setEditingEmployeeId(null); setEmpForm(emptyEmpForm); };

  // Pas de suppression réelle d'un employé (il peut être lié à des bulletins de paie
  // passés) : seulement une désactivation, qui le retire des listes de sélection pour
  // les nouvelles avances/bulletins sans jamais toucher à son historique.
  const toggleEmployeeActive = (emp) => {
    setEmployees((prev) => prev.map((e) => (e.id === emp.id ? { ...e, active: !e.active } : e)));
    logAudit("Salaires (RH)", emp.active ? "Désactivation employé" : "Réactivation employé", emp.name);
  };

  // --- Avances sur salaire ---
  const emptyAdvForm = { employeeId: "", date: today, amount: "", reason: "", paymentMode: "caisse" };
  const [advForm, setAdvForm] = useState(emptyAdvForm);
  const [advFrom, setAdvFrom] = useState("");
  const [advTo, setAdvTo] = useState("");
  const [advEmployee, setAdvEmployee] = useState("");
  const [advStatus, setAdvStatus] = useState("");
  const advancesFiltered = salaryAdvances.filter((a) =>
    (!advFrom || a.date >= advFrom) &&
    (!advTo || a.date <= advTo) &&
    (!advEmployee || String(a.employeeId) === advEmployee) &&
    (!advStatus || a.status === advStatus)
  );

  const giveAdvance = () => {
    if (Date.now() - lastAdvanceSubmitRef.current < 800) return;
    lastAdvanceSubmitRef.current = Date.now();
    if (hasPendingRH) { showToast("Traitez d'abord la recommandation en attente ci-dessus avant d'enregistrer une nouvelle avance."); return; }
    if (!advForm.employeeId) { showToast("Sélectionnez un employé."); return; }
    if (!advForm.amount || Number(advForm.amount) <= 0) { showToast("Montant invalide."); return; }
    if (isFutureDate(advForm.date)) { showToast("Impossible d'enregistrer une avance à une date future."); return; }
    if (isLocked(advForm.date, settings)) { showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus.`); return; }
    const emp = employees.find((e) => String(e.id) === String(advForm.employeeId));
    if (!emp) { showToast("Employé introuvable."); return; }
    // Règle stricte, non contournable (comme montant zéro/date future) : le
    // cumul des avances en cours ne doit jamais dépasser 60% du salaire de base
    // de l'employé — une avance n'a pas vocation à représenter l'essentiel d'un
    // salaire, quel que soit le forfait de l'entreprise.
    const openAdvancesTotal = salaryAdvances
      .filter((a) => a.employeeId === emp.id && a.status === "en cours")
      .reduce((s, a) => s + (Number(a.amount) - Number(a.repaidAmount || 0)), 0);
    const advanceCap = Number(emp.baseSalary) * 0.6;
    if (openAdvancesTotal + Number(advForm.amount) > advanceCap + 0.01) {
      showToast(`Le cumul des avances en cours pour ${emp.name} ne peut pas dépasser 60% de son salaire de base (plafond : ${fmt(advanceCap)}). Cumul actuel : ${fmt(openAdvancesTotal)}.`);
      return;
    }
    const commitAdvance = () => {
    const payAccount = advForm.paymentMode === "banque" ? "512" : "530";
    const advanceId = uid();
    const advanceEntry = {
      id: advanceId, date: advForm.date, createdAt: new Date().toISOString(), label: `Avance sur salaire — ${emp.name}`,
      lines: [{ account: "425", debit: Number(advForm.amount), credit: 0 }, { account: payAccount, debit: 0, credit: Number(advForm.amount) }],
    };
    const newAdvance = {
      id: advanceId, employeeId: emp.id, employeeName: emp.name, date: advForm.date, createdAt: new Date().toISOString(),
      amount: Number(advForm.amount), reason: advForm.reason, paymentMode: advForm.paymentMode,
      repaidAmount: 0, status: "en cours",
    };
    setEntries((prev) => [...prev, advanceEntry]);
    setSalaryAdvances((prev) => [...prev, newAdvance]);
    showToast("Avance enregistrée.");
    logAudit("Salaires (RH)", "Avance sur salaire", `${emp.name} — ${fmt(Number(advForm.amount))}`);
    setAdvForm(emptyAdvForm);
    verifyTransactionSaved(`Avance ${emp.name}`, [
      { category: "entries", label: "écriture d'avance", isPresent: (arr) => arr.some((e) => e.id === advanceId), buildNext: () => [...entries, advanceEntry] },
      { category: "salaryAdvances", label: "fiche d'avance", isPresent: (arr) => arr.some((a) => a.id === advanceId), buildNext: () => [...salaryAdvances, newAdvance] },
    ], { showToast, logAudit });
    };
    if (planTier !== "assisted") { commitAdvance(); return; }
    const anomalies = [];
    const corrections = [];
    const historyForEmployee = salaryAdvances.filter((a) => a.employeeId === emp.id).map((a) => Number(a.amount));
    const amt = detectAmountAnomaly(Number(advForm.amount), historyForEmployee, emp.name);
    if (amt) { anomalies.push(amt); corrections.push("Si le montant est erroné : annulez cette avance puis ressaisissez-la avec le montant correct."); }
    const isDup = salaryAdvances.slice(-30).some((a) => a.employeeId === emp.id && Number(a.amount) === Number(advForm.amount) && a.status !== "annulée");
    if (isDup) { anomalies.push(`Une avance identique existe déjà récemment pour ${emp.name} — vérifiez qu'il ne s'agit pas d'un doublon.`); corrections.push("Vérifiez les avances déjà enregistrées : si celle-ci est bien un doublon, annulez-la."); }
    const signature = `advance:${advForm.employeeId}:${advForm.amount}:${advForm.date}`;
    anomalyGate(signature, [...new Set(anomalies)], commitAdvance, showToast, () => {
      recordPendingRecommendation?.({
        companyId: _membership?.companyId,
        module: "salaires",
        anomalyText: anomalies.join(" "),
        correctionText: [...new Set(corrections)].join(" "),
        entryRef: emp.name,
        createdByEmail: currentUserEmail,
      });
    });
  };

  const cancelAdvance = (adv) => {
    if (role !== "Administrateur") { showToast("Seul un administrateur peut annuler une avance."); return; }
    if (adv.status === "annulée") { showToast("Cette avance est déjà annulée."); return; }
    if (adv.repaidAmount > 0) { showToast("Cette avance a déjà été partiellement remboursée sur un bulletin — annulez d'abord ce bulletin."); return; }
    if (isLocked(adv.date, settings)) { showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus.`); return; }
    if (!window.confirm(`Annuler l'avance de ${fmt(adv.amount)} pour ${adv.employeeName} ? Une écriture de contrepassation sera générée.`)) return;
    const original = entries.find((e) => e.id === adv.id);
    let reversal = null;
    if (original) {
      reversal = {
        id: uid(), date: today, createdAt: new Date().toISOString(), label: `Annulation avance — ${adv.employeeName}`,
        lines: original.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })),
      };
      setEntries((prev) => [...prev, reversal]);
    }
    setSalaryAdvances((prev) => prev.map((x) => (x.id === adv.id ? { ...x, status: "annulée" } : x)));
    showToast("Avance annulée par contrepassation.");
    logAudit("Salaires (RH)", "Annulation avance (contrepassation)", `${adv.employeeName} — ${fmt(adv.amount)}`);
    verifyTransactionSaved(`Annulation avance ${adv.employeeName}`, [
      { category: "salaryAdvances", label: "statut annulé", isPresent: (arr) => { const x = arr.find((y) => y.id === adv.id); return x && x.status === "annulée"; }, buildNext: () => salaryAdvances.map((x) => (x.id === adv.id ? { ...x, status: "annulée" } : x)) },
      ...(reversal ? [{ category: "entries", label: "écriture de contrepassation", isPresent: (arr) => arr.some((e) => e.id === reversal.id), buildNext: () => [...entries, reversal] }] : []),
    ], { showToast, logAudit });
  };

  // --- Bulletins de paie ---
  const emptyPayForm = {
    employeeId: "", periodStart: "", periodEnd: "", date: today,
    overtimeHours: "", bonusAmount: "", bonusNote: "",
    deductionCSSONA: "", autoRates: true, primeWh: true, primeRate: "15", bonusKind: "prime", salaryWh: false, advanceId: "", advanceRepayment: "", paymentMode: "caisse",
  };
  const [payForm, setPayForm] = useState(emptyPayForm);
  const selectedEmployee = employees.find((e) => String(e.id) === String(payForm.employeeId));
  const overtimeAmount = (Number(payForm.overtimeHours) || 0) * (selectedEmployee?.overtimeRate || 0);
  const baseSalaryAmount = selectedEmployee?.baseSalary || 0;
  const grossTotal = baseSalaryAmount + overtimeAmount + (Number(payForm.bonusAmount) || 0);
  const rubriquesActives = (settings.payrollRubriques || []).filter((r) => r.active && Number(r.rate) > 0);
  const autoOn = rubriquesActives.length > 0 && payForm.autoRates !== false;
  const payCalc = payrollCompute(grossTotal, autoOn ? rubriquesActives : []);
  // Retenue d'impôt sur les primes (15 % depuis le 1er octobre 2026 ; 10 % avant) : avance sur l'impôt de l'employé,
  // versée à la DGI avant le 15 du mois suivant. Taux modifiable, à faire valider par l'expert-comptable.
  const primeBrute = Number(payForm.bonusAmount) || 0;
  const primeRateNum = Math.max(0, Math.min(100, Number(payForm.primeRate) || 0));
  const primeTax = payForm.primeWh !== false && primeBrute > 0 ? prR2(primeBrute * primeRateNum / 100) : 0;
  const salaryTax = payForm.salaryWh === true ? retenueIRSalaireMensuelle(baseSalaryAmount) : 0;
  const salaryTaxEstimate = retenueIRSalaireMensuelle(baseSalaryAmount);
  const effectiveDeduction = prR2((autoOn ? payCalc.employeeTotal : (Number(payForm.deductionCSSONA) || 0)) + primeTax + salaryTax);
  const employerCharges = autoOn ? payCalc.employerTotal : 0;
  const netTotal = prR2(grossTotal - effectiveDeduction - (Number(payForm.advanceRepayment) || 0));
  const employeeOpenAdvances = salaryAdvances.filter((a) => String(a.employeeId) === String(payForm.employeeId) && a.status === "en cours" && a.repaidAmount < a.amount - 0.001);
  const selectedAdvance = employeeOpenAdvances.find((a) => a.id === payForm.advanceId);
  const selectedAdvanceRemaining = selectedAdvance ? selectedAdvance.amount - selectedAdvance.repaidAmount : 0;

  const processPayslip = () => {
    if (Date.now() - lastPayslipSubmitRef.current < 800) return;
    lastPayslipSubmitRef.current = Date.now();
    if (hasPendingRH) { showToast("Traitez d'abord la recommandation en attente ci-dessus avant d'enregistrer un nouveau bulletin."); return; }
    if (!selectedEmployee) { showToast("Sélectionnez un employé."); return; }
    if (!payForm.periodStart || !payForm.periodEnd) { showToast("La période (du / au) est requise."); return; }
    if (isFutureDate(payForm.periodStart) || isFutureDate(payForm.periodEnd) || isFutureDate(payForm.date)) {
      showToast("Impossible d'enregistrer un bulletin de paie à une date future.");
      return;
    }
    if (grossTotal <= 0) { showToast("Le montant brut doit être positif."); return; }
    if (isLocked(payForm.date, settings)) { showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus.`); return; }
    const advanceRepayment = Number(payForm.advanceRepayment) || 0;
    if (selectedAdvance && advanceRepayment > selectedAdvanceRemaining + 0.001) {
      showToast(`Le remboursement dépasse le solde restant de l'avance (${fmt(selectedAdvanceRemaining)}).`);
      return;
    }
    if (netTotal < -0.001) { showToast("Le net à payer est négatif — réduisez les déductions ou le remboursement d'avance."); return; }

    const commitPayslip = () => {
    const payAccount = payForm.paymentMode === "banque" ? "512" : "530";
    const deduction = effectiveDeduction;
    const lines = [{ account: "641", debit: grossTotal, credit: 0 }];
    if (employerCharges > 0) lines.push({ account: "645", debit: employerCharges, credit: 0 });
    if (deduction + employerCharges > 0) lines.push({ account: "431", debit: 0, credit: prR2(deduction + employerCharges) });
    if (advanceRepayment > 0) lines.push({ account: "425", debit: 0, credit: advanceRepayment });
    lines.push({ account: payAccount, debit: 0, credit: Math.max(0, netTotal) });

    const payslipId = uid();
    const payslipEntry = {
      id: payslipId, date: payForm.date, createdAt: new Date().toISOString(),
      label: `Paie — ${selectedEmployee.name} (${payForm.periodStart} au ${payForm.periodEnd})`,
      lines,
    };
    const newPayslip = {
      id: payslipId, employeeId: selectedEmployee.id, employeeName: selectedEmployee.name,
      periodStart: payForm.periodStart, periodEnd: payForm.periodEnd, date: payForm.date, createdAt: new Date().toISOString(),
      baseSalary: baseSalaryAmount, overtimeHours: Number(payForm.overtimeHours) || 0, overtimeRate: selectedEmployee.overtimeRate || 0, overtimeAmount,
      bonusAmount: Number(payForm.bonusAmount) || 0, bonusNote: payForm.bonusNote,
      deductionCSSONA: deduction, bonusWithholding: primeTax, bonusWithholdingRate: primeTax > 0 ? primeRateNum : 0, bonusKind: payForm.bonusKind || "prime", salaryWithholding: salaryTax, advanceId: selectedAdvance ? selectedAdvance.id : null, advanceRepayment,
      paymentMode: payForm.paymentMode, grossTotal, netTotal, status: "payé",
      ...(autoOn ? { employerTotal: employerCharges, rubriques: [...payCalc.employee, ...payCalc.employer], ratesToValidate: !FISCAL_RULES_VALIDATED } : {}),
    };
    setEntries((prev) => [...prev, payslipEntry]);
    setPayslips((prev) => [...prev, newPayslip]);
    let updatedAdvance = null;
    if (selectedAdvance && advanceRepayment > 0) {
      const advId = selectedAdvance.id;
      const newRepaid = selectedAdvance.repaidAmount + advanceRepayment;
      updatedAdvance = { ...selectedAdvance, repaidAmount: newRepaid, status: newRepaid >= selectedAdvance.amount - 0.001 ? "remboursée" : "en cours" };
      setSalaryAdvances((prev) => prev.map((a) => (a.id === advId ? updatedAdvance : a)));
    }
    showToast(`Bulletin de paie enregistré — net à payer ${fmt(netTotal)}.`);
    logAudit("Salaires (RH)", "Bulletin de paie", `${selectedEmployee.name} — net ${fmt(netTotal)}`);
    setPayForm(emptyPayForm);
    verifyTransactionSaved(`Bulletin de paie ${selectedEmployee.name}`, [
      { category: "entries", label: "écriture de paie", isPresent: (arr) => arr.some((e) => e.id === payslipId), buildNext: () => [...entries, payslipEntry] },
      { category: "payslips", label: "bulletin de paie", isPresent: (arr) => arr.some((p) => p.id === payslipId), buildNext: () => [...payslips, newPayslip] },
      ...(updatedAdvance ? [{ category: "salaryAdvances", label: "remboursement d'avance", isPresent: (arr) => { const a = arr.find((x) => x.id === updatedAdvance.id); return a && a.repaidAmount === updatedAdvance.repaidAmount; }, buildNext: () => salaryAdvances.map((a) => (a.id === updatedAdvance.id ? updatedAdvance : a)) }] : []),
    ], { showToast, logAudit });
    };
    if (planTier !== "assisted") { commitPayslip(); return; }
    const anomalies = [];
    const corrections = [];
    const historyForEmployee = payslips.filter((p) => p.employeeId === selectedEmployee.id).map((p) => Number(p.grossTotal));
    const amt = detectAmountAnomaly(grossTotal, historyForEmployee, selectedEmployee.name);
    if (amt) { anomalies.push(amt); corrections.push("Si le montant brut est erroné : annulez ce bulletin puis ressaisissez-le avec le montant correct."); }
    const isDup = payslips.slice(-30).some((p) => p.employeeId === selectedEmployee.id && p.periodStart === payForm.periodStart && p.periodEnd === payForm.periodEnd && p.status !== "annulé");
    if (isDup) { anomalies.push(`Un bulletin existe déjà pour ${selectedEmployee.name} sur cette même période — vérifiez qu'il ne s'agit pas d'un doublon.`); corrections.push("Vérifiez les bulletins déjà enregistrés pour cette période : si c'est bien un doublon, annulez-le."); }
    const signature = `payslip:${selectedEmployee.id}:${payForm.periodStart}:${payForm.periodEnd}:${grossTotal}`;
    anomalyGate(signature, [...new Set(anomalies)], commitPayslip, showToast, () => {
      recordPendingRecommendation?.({
        companyId: _membership?.companyId,
        module: "salaires",
        anomalyText: anomalies.join(" "),
        correctionText: [...new Set(corrections)].join(" "),
        entryRef: selectedEmployee.name,
        createdByEmail: currentUserEmail,
      });
    });
  };

  const cancelPayslip = (p) => {
    if (role !== "Administrateur") { showToast("Seul un administrateur peut annuler un bulletin de paie."); return; }
    if (p.status === "annulé") { showToast("Ce bulletin est déjà annulé."); return; }
    if (isLocked(p.date, settings)) { showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus.`); return; }
    if (!window.confirm(`Annuler le bulletin de paie de ${p.employeeName} (net ${fmt(p.netTotal)}) ? Une écriture de contrepassation sera générée.`)) return;
    const original = entries.find((e) => e.id === p.id);
    let reversal = null;
    if (original) {
      reversal = {
        id: uid(), date: today, createdAt: new Date().toISOString(), label: `Annulation paie — ${p.employeeName} (${p.periodStart} au ${p.periodEnd})`,
        lines: original.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })),
      };
      setEntries((prev) => [...prev, reversal]);
    }
    setPayslips((prev) => prev.map((x) => (x.id === p.id ? { ...x, status: "annulé" } : x)));
    let revertedAdvance = null;
    if (p.advanceId && p.advanceRepayment > 0) {
      setSalaryAdvances((prev) => prev.map((a) => {
        if (a.id !== p.advanceId) return a;
        revertedAdvance = { ...a, repaidAmount: Math.max(0, a.repaidAmount - p.advanceRepayment), status: "en cours" };
        return revertedAdvance;
      }));
    }
    showToast("Bulletin annulé par contrepassation.");
    logAudit("Salaires (RH)", "Annulation bulletin (contrepassation)", `${p.employeeName} — ${fmt(p.netTotal)}`);
    verifyTransactionSaved(`Annulation paie ${p.employeeName}`, [
      { category: "payslips", label: "statut annulé", isPresent: (arr) => { const x = arr.find((y) => y.id === p.id); return x && x.status === "annulé"; }, buildNext: () => payslips.map((x) => (x.id === p.id ? { ...x, status: "annulé" } : x)) },
      ...(reversal ? [{ category: "entries", label: "écriture de contrepassation", isPresent: (arr) => arr.some((e) => e.id === reversal.id), buildNext: () => [...entries, reversal] }] : []),
      ...(revertedAdvance ? [{ category: "salaryAdvances", label: "réouverture de l'avance", isPresent: (arr) => { const a = arr.find((x) => x.id === revertedAdvance.id); return a && a.repaidAmount === revertedAdvance.repaidAmount; }, buildNext: () => salaryAdvances.map((a) => (a.id === revertedAdvance.id ? revertedAdvance : a)) }] : []),
    ], { showToast, logAudit });
  };

  const [payFrom, setPayFrom] = useState("");
  const [payTo, setPayTo] = useState("");
  const [payEmployee, setPayEmployee] = useState("");
  const [payStatus, setPayStatus] = useState("");
  const payslipsFiltered = payslips.filter((p) =>
    (!payFrom || p.date >= payFrom) &&
    (!payTo || p.date <= payTo) &&
    (!payEmployee || String(p.employeeId) === payEmployee) &&
    (!payStatus || p.status === payStatus)
  );
  const allEmployeeOptions = [...new Map(payslips.map((p) => [String(p.employeeId), p.employeeName])).entries()];

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-widest" style={{ color: "#C9A24B" }}>Module 9</div>
        <div className="display text-3xl" style={{ color: "#152238" }}>Salaires (RH)</div>
      </header>

      <div className="flex gap-1 mb-6 overflow-x-auto">
        {[["employes", "Employés"], ["avances", "Avances sur salaire"], ["bulletins", "Bulletins de paie"], ["cotisations", "Cotisations"], ["retenues", "Retenues DGI"]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className="px-4 py-2 text-sm rounded-t shrink-0 whitespace-nowrap"
            style={{
              background: tab === id ? "#fff" : "transparent",
              borderBottom: tab === id ? "2px solid #C9A24B" : "2px solid transparent",
              color: tab === id ? "#152238" : "#8A8370",
              fontWeight: tab === id ? 600 : 400,
            }}>
            {label}
          </button>
        ))}
      </div>

      {tab === "employes" && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <div className="grid md:grid-cols-2 gap-3 mb-4">
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Nom complet</label>
              <input value={empForm.name} onChange={(e) => setEmpForm({ ...empForm, name: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Poste</label>
              <input value={empForm.position} onChange={(e) => setEmpForm({ ...empForm, position: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>NIF ou CIN (liste annuelle des versements)</label>
              <input value={empForm.nif} onChange={(e) => setEmpForm({ ...empForm, nif: e.target.value })} data-testid="employe-nif"
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Salaire de base ({settings.currency || "HTG"})</label>
              <input type="number" min="0" value={empForm.baseSalary} onChange={(e) => setEmpForm({ ...empForm, baseSalary: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Fréquence de paie</label>
              <select value={empForm.payFrequency} onChange={(e) => setEmpForm({ ...empForm, payFrequency: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                <option value="mensuelle">Mensuelle</option>
                <option value="bimensuelle">Bimensuelle (2×/mois)</option>
                <option value="hebdomadaire">Hebdomadaire</option>
              </select>
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Taux horaire supplémentaire ({settings.currency || "HTG"}/h)</label>
              <input type="number" min="0" value={empForm.overtimeRate} onChange={(e) => setEmpForm({ ...empForm, overtimeRate: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
              <div className="text-xs mt-1" style={{ color: "#A39C87" }}>Utilisé pour calculer les heures supplémentaires sur les bulletins de paie.</div>
            </div>
          </div>
          <div className="flex gap-2 mb-6">
            <button onClick={saveEmployee} className="px-4 py-2 rounded text-sm text-white" style={{ background: "#152238" }}>
              {editingEmployeeId ? "Enregistrer les modifications" : "+ Ajouter l'employé"}
            </button>
            {editingEmployeeId && (
              <button onClick={cancelEditEmployee} className="px-4 py-2 rounded text-sm" style={{ border: "1px solid #DDD6C4", color: "#7A7460" }}>Annuler</button>
            )}
          </div>

          {employees.length === 0 ? (
            <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>Aucun employé enregistré pour le moment.</div>
          ) : (
            <div className="overflow-x-auto border rounded" style={{ borderColor: "#EEE9DA" }}><table className="w-full text-sm">
              <thead>
                <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                  <th className="py-2 px-2 font-normal">Nom</th>
                  <th className="py-2 font-normal">Poste</th>
                  <th className="py-2 font-normal">Fréquence</th>
                  <th className="py-2 font-normal text-right">Salaire de base</th>
                  <th className="py-2 font-normal text-center">Statut</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {[...employees].reverse().map((emp) => (
                  <tr key={emp.id} style={{ borderBottom: "1px solid #F3EFE3", opacity: emp.active ? 1 : 0.55 }}>
                    <td className="py-2 px-2">{emp.name}<RecordedStamp createdAt={emp.createdAt} /></td>
                    <td className="py-2" style={{ color: "#7A7460" }}>{emp.position || "—"}</td>
                    <td className="py-2" style={{ color: "#7A7460" }}>{emp.payFrequency}</td>
                    <td className="py-2 tabular text-right">{fmt(emp.baseSalary)}</td>
                    <td className="py-2 text-center">
                      <span className="text-xs px-2 py-0.5 rounded" style={{ background: emp.active ? "#E6F1EE" : "#F3EFE3", color: emp.active ? "#0F6B5C" : "#8A8370" }}>
                        {emp.active ? "Actif" : "Inactif"}
                      </span>
                    </td>
                    <td className="py-2 text-right pr-2">
                      <button onClick={() => startEditEmployee(emp)} className="mr-2" title="Modifier" style={{ color: "#5C6B8C" }}><Pencil size={14} /></button>
                      <button onClick={() => toggleEmployeeActive(emp)} className="text-xs underline" style={{ color: "#8A8370" }}>
                        {emp.active ? "Désactiver" : "Réactiver"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      )}

      {tab === "avances" && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <div className="grid md:grid-cols-3 gap-3 mb-4">
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Employé</label>
              <select value={advForm.employeeId} onChange={(e) => setAdvForm({ ...advForm, employeeId: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                <option value="">— Sélectionner —</option>
                {activeEmployees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Date</label>
              <input type="date" value={advForm.date} max={todayStr()} onChange={(e) => setAdvForm({ ...advForm, date: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Montant</label>
              <input type="number" min="0" value={advForm.amount} onChange={(e) => setAdvForm({ ...advForm, amount: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs" style={{ color: "#8A8370" }}>Motif (facultatif)</label>
              <input value={advForm.reason} onChange={(e) => setAdvForm({ ...advForm, reason: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Versée depuis</label>
              <select value={advForm.paymentMode} onChange={(e) => setAdvForm({ ...advForm, paymentMode: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                <option value="caisse">Caisse</option>
                <option value="banque">Banque</option>
              </select>
            </div>
          </div>
          <PendingRecommendationsBanner recommendations={pendingRecommendations} module="salaires" onDismiss={resolvePendingRecommendation} />
          <AssistedPrincipleReminder planTier={planTier} text="Une avance sur salaire est une créance envers l'employé (compte 425), pas une charge de salaire — elle sera déduite de son prochain bulletin de paie." />
          <button onClick={giveAdvance} disabled={hasPendingRH} className="px-4 py-2 rounded text-sm text-white mb-6" style={{ background: "#152238", opacity: hasPendingRH ? 0.5 : 1 }}>+ Enregistrer l'avance</button>

          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Du</label>
              <input type="date" value={advFrom} onChange={(e) => setAdvFrom(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Au</label>
              <input type="date" value={advTo} onChange={(e) => setAdvTo(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Employé</label>
              <select value={advEmployee} onChange={(e) => setAdvEmployee(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }}>
                <option value="">Tous</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Statut</label>
              <select value={advStatus} onChange={(e) => setAdvStatus(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }}>
                <option value="">Tous</option>
                <option value="en cours">En cours</option>
                <option value="remboursée">Remboursée</option>
                <option value="annulée">Annulée</option>
              </select>
            </div>
            {(advFrom || advTo || advEmployee || advStatus) && (
              <button onClick={() => { setAdvFrom(""); setAdvTo(""); setAdvEmployee(""); setAdvStatus(""); }} className="text-xs underline mb-1.5" style={{ color: "#8A8370" }}>Réinitialiser</button>
            )}
            {(advFrom || advTo || advEmployee || advStatus) && (
              <div className="tabular text-xs mb-1.5 ml-auto" style={{ color: "#152238" }}>
                {advancesFiltered.length} avance{advancesFiltered.length > 1 ? "s" : ""} · Total {fmt(advancesFiltered.reduce((s, a) => s + a.amount, 0))}
              </div>
            )}
          </div>

          {advancesFiltered.length === 0 ? (
            <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>{salaryAdvances.length === 0 ? "Aucune avance enregistrée." : "Aucune avance ne correspond à ces filtres."}</div>
          ) : (
            <div className="overflow-x-auto border rounded" style={{ borderColor: "#EEE9DA" }}><table className="w-full text-sm">
              <thead>
                <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                  <th className="py-2 px-2 font-normal">Date</th>
                  <th className="py-2 font-normal">Employé</th>
                  <th className="py-2 font-normal text-right">Montant</th>
                  <th className="py-2 font-normal text-right">Remboursé</th>
                  <th className="py-2 font-normal text-center">Statut</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {[...advancesFiltered].reverse().map((a) => (
                  <tr key={a.id} style={{ borderBottom: "1px solid #F3EFE3" }}>
                    <td className="py-2 px-2 tabular">{a.date}<RecordedStamp createdAt={a.createdAt} /></td>
                    <td className="py-2">{a.employeeName}{a.reason ? <span style={{ color: "#A39C87" }}> — {a.reason}</span> : null}</td>
                    <td className="py-2 tabular text-right">{fmt(a.amount)}</td>
                    <td className="py-2 tabular text-right" style={{ color: "#7A7460" }}>{fmt(a.repaidAmount)}</td>
                    <td className="py-2 text-center">
                      <span className="text-xs px-2 py-0.5 rounded" style={{
                        background: a.status === "en cours" ? "#FBF1DC" : a.status === "remboursée" ? "#E6F1EE" : "#F3EFE3",
                        color: a.status === "en cours" ? "#9A7B1E" : a.status === "remboursée" ? "#0F6B5C" : "#8A8370",
                      }}>{a.status}</span>
                    </td>
                    <td className="py-2 text-right pr-2">
                      {role === "Administrateur" && a.status === "en cours" && a.repaidAmount === 0 && (
                        <button onClick={() => cancelAdvance(a)} title="Annuler (contrepassation)" style={{ color: "#A6432F" }}><RotateCcw size={14} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      )}

      {tab === "retenues" && <RetenuesDGIPanel payslips={payslips} settings={settings} />}
      {tab === "cotisations" && <PayrollRatesPanel settings={settings} setSettings={setSettings} role={role} showToast={showToast} logAudit={logAudit} />}

      {tab === "bulletins" && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <div className="grid md:grid-cols-3 gap-3 mb-3">
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Employé</label>
              <select value={payForm.employeeId} onChange={(e) => setPayForm({ ...payForm, employeeId: e.target.value, advanceId: "", advanceRepayment: "" })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                <option value="">— Sélectionner —</option>
                {activeEmployees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Période du</label>
              <input type="date" value={payForm.periodStart} max={todayStr()} onChange={(e) => setPayForm({ ...payForm, periodStart: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Période au</label>
              <input type="date" value={payForm.periodEnd} max={todayStr()} onChange={(e) => setPayForm({ ...payForm, periodEnd: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Date de paiement</label>
              <input type="date" value={payForm.date} max={todayStr()} onChange={(e) => setPayForm({ ...payForm, date: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Heures supplémentaires</label>
              <input type="number" min="0" value={payForm.overtimeHours} onChange={(e) => setPayForm({ ...payForm, overtimeHours: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
              {selectedEmployee && <div className="text-xs mt-1" style={{ color: "#A39C87" }}>Taux : {fmt(selectedEmployee.overtimeRate || 0)}/h → {fmt(overtimeAmount)}</div>}
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Prime / bonus</label>
              <input type="number" min="0" value={payForm.bonusAmount} onChange={(e) => setPayForm({ ...payForm, bonusAmount: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs" style={{ color: "#8A8370" }}>Motif de la prime (facultatif)</label>
              <input value={payForm.bonusNote} onChange={(e) => setPayForm({ ...payForm, bonusNote: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>{rubriquesActives.length > 0 ? "Retenues salariales" : "Retenues (CSS/ONA, etc.) — montant saisi à la main : aucune cotisation n'est paramétrée (onglet « Cotisations »)"}</label>
              {rubriquesActives.length > 0 && (
                <label className="flex items-center gap-2 text-xs mt-1" style={{ color: "#152238" }}>
                  <input type="checkbox" checked={autoOn} onChange={(e) => setPayForm({ ...payForm, autoRates: e.target.checked })} data-testid="pay-auto-rates" />
                  Calcul automatique selon les taux paramétrés
                </label>
              )}
              {primeBrute > 0 && (
                <div className="mt-1 p-2 rounded text-xs" style={{ background: "#FBF1DC", color: "#7A5F10" }}>
                  <label className="flex items-center gap-2" style={{ color: "#152238" }}>
                    <input type="checkbox" checked={payForm.primeWh !== false} onChange={(e) => setPayForm({ ...payForm, primeWh: e.target.checked })} data-testid="pay-prime-wh" />
                    <select value={payForm.bonusKind || "prime"} onChange={(e) => setPayForm({ ...payForm, bonusKind: e.target.value, primeRate: e.target.value === "boni" ? "10" : "15" })} data-testid="pay-bonus-kind"
                      className="border rounded px-1 py-0.5" style={{ borderColor: "#DDD6C4" }}>
                      <option value="prime">Prime ou autre rémunération (15 %)</option>
                      <option value="boni">Boni (10 %)</option>
                    </select>
                    Retenir l'impôt
                    <input type="number" min="0" max="100" value={payForm.primeRate} onChange={(e) => setPayForm({ ...payForm, primeRate: e.target.value })} disabled={payForm.primeWh === false}
                      className="border rounded px-1 py-0.5 w-14 tabular" style={{ borderColor: "#DDD6C4" }} data-testid="pay-prime-rate" /> %
                  </label>
                  <div className="mt-1">Article 103 du Code fiscal : 15 % sur les rémunérations en numéraire additionnelles au salaire de base, 10 % sur le boni. Montant retenu : {fmt(primeTax)}, à verser à la DGI entre le 1er et le 15 du mois suivant, avec un état explicatif. Taux à valider avec votre expert-comptable.</div>
                </div>
              )}
              {selectedEmployee && salaryTaxEstimate > 0 && (
                <label className="flex items-center gap-2 text-xs mt-1" style={{ color: "#152238" }}>
                  <input type="checkbox" checked={payForm.salaryWh === true} onChange={(e) => setPayForm({ ...payForm, salaryWh: e.target.checked })} data-testid="pay-salary-wh" />
                  Retenir l'impôt sur le salaire (1/12 de l'impôt annuel, articles 100 et 132) : {fmt(salaryTaxEstimate)}
                </label>
              )}
              <input type="number" min="0" value={autoOn ? effectiveDeduction : (Number(payForm.deductionCSSONA) || 0) + primeTax + salaryTax} disabled={autoOn || primeTax > 0 || salaryTax > 0} onChange={(e) => setPayForm({ ...payForm, deductionCSSONA: e.target.value })} data-testid="pay-deduction"
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
            </div>
            {employeeOpenAdvances.length > 0 && (
              <>
                <div>
                  <label className="text-xs" style={{ color: "#8A8370" }}>Rembourser une avance</label>
                  <select value={payForm.advanceId} onChange={(e) => setPayForm({ ...payForm, advanceId: e.target.value, advanceRepayment: "" })}
                    className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                    <option value="">Aucune</option>
                    {employeeOpenAdvances.map((a) => <option key={a.id} value={a.id}>{a.date} — solde {fmt(a.amount - a.repaidAmount)}</option>)}
                  </select>
                </div>
                {selectedAdvance && (
                  <div>
                    <label className="text-xs" style={{ color: "#8A8370" }}>Montant à déduire (solde {fmt(selectedAdvanceRemaining)})</label>
                    <input type="number" min="0" max={selectedAdvanceRemaining} value={payForm.advanceRepayment} onChange={(e) => setPayForm({ ...payForm, advanceRepayment: e.target.value })}
                      className="block w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
                  </div>
                )}
              </>
            )}
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Payé depuis</label>
              <select value={payForm.paymentMode} onChange={(e) => setPayForm({ ...payForm, paymentMode: e.target.value })}
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                <option value="caisse">Caisse</option>
                <option value="banque">Banque</option>
              </select>
            </div>
          </div>

          {selectedEmployee && (
            <div className="mb-4 p-3 rounded text-sm tabular" style={{ background: "#FAF8F1", border: "1px solid #EEE9DA" }}>
              <div>Salaire de base : {fmt(baseSalaryAmount)}</div>
              {overtimeAmount > 0 && <div>Heures supplémentaires : {fmt(overtimeAmount)}</div>}
              {Number(payForm.bonusAmount) > 0 && <div>Prime : {fmt(Number(payForm.bonusAmount))}</div>}
              <div className="font-medium" style={{ color: "#152238" }}>Total brut : {fmt(grossTotal)}</div>
              {autoOn && payCalc.employee.map((r) => <div key={r.id} style={{ color: "#A6432F" }} data-testid="pay-line-employee">{r.label} ({r.rate} %) : − {fmt(r.amount)}</div>)}
              {salaryTax > 0 && <div style={{ color: "#A6432F" }} data-testid="pay-line-salary-wh">Impôt retenu sur le salaire (1/12) : − {fmt(salaryTax)}</div>}
              {primeTax > 0 && <div style={{ color: "#A6432F" }} data-testid="pay-line-prime-wh">Impôt retenu sur la prime ({primeRateNum} %) : − {fmt(primeTax)}</div>}
              {!autoOn && Number(payForm.deductionCSSONA) > 0 && <div style={{ color: "#A6432F" }}>Retenues : − {fmt(Number(payForm.deductionCSSONA))}</div>}
              {Number(payForm.advanceRepayment) > 0 && <div style={{ color: "#A6432F" }}>Remboursement d'avance : − {fmt(Number(payForm.advanceRepayment))}</div>}
              <div className="font-medium mt-1" style={{ color: netTotal < 0 ? "#A6432F" : "#0F6B5C" }} data-testid="pay-net">Net à payer : {fmt(netTotal)}</div>
              {autoOn && payCalc.employer.map((r) => <div key={r.id} className="text-xs" style={{ color: "#8A8370" }} data-testid="pay-line-employer">Charge patronale — {r.label} ({r.rate} %) : {fmt(r.amount)}</div>)}
              {autoOn && <div className="text-xs mt-1" style={{ color: "#7A5F10" }}>Taux paramétrés, à valider avec votre expert-comptable.</div>}
            </div>
          )}

          <PendingRecommendationsBanner recommendations={pendingRecommendations} module="salaires" onDismiss={resolvePendingRecommendation} />
          <AssistedPrincipleReminder planTier={planTier} text="Le bulletin de paie enregistre le salaire brut en charge, les déductions et l'avance remboursée séparément — le net à payer est ce qui sort réellement de la caisse ou banque." />
          <button onClick={processPayslip} disabled={hasPendingRH} className="px-4 py-2 rounded text-sm text-white mb-6" style={{ background: "#152238", opacity: hasPendingRH ? 0.5 : 1 }}>+ Enregistrer le bulletin de paie</button>

          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Du</label>
              <input type="date" value={payFrom} onChange={(e) => setPayFrom(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Au</label>
              <input type="date" value={payTo} onChange={(e) => setPayTo(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Employé</label>
              <select value={payEmployee} onChange={(e) => setPayEmployee(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }}>
                <option value="">Tous</option>
                {allEmployeeOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Statut</label>
              <select value={payStatus} onChange={(e) => setPayStatus(e.target.value)}
                className="block border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4", maxWidth: "100%", boxSizing: "border-box" }}>
                <option value="">Tous</option>
                <option value="payé">Payé</option>
                <option value="annulé">Annulé</option>
              </select>
            </div>
            {(payFrom || payTo || payEmployee || payStatus) && (
              <button onClick={() => { setPayFrom(""); setPayTo(""); setPayEmployee(""); setPayStatus(""); }} className="text-xs underline mb-1.5" style={{ color: "#8A8370" }}>Réinitialiser</button>
            )}
            {(payFrom || payTo || payEmployee || payStatus) && (
              <div className="tabular text-xs mb-1.5 ml-auto" style={{ color: "#152238" }}>
                {payslipsFiltered.length} bulletin{payslipsFiltered.length > 1 ? "s" : ""} · Net total {fmt(payslipsFiltered.filter((p) => p.status !== "annulé").reduce((s, p) => s + p.netTotal, 0))}
              </div>
            )}
          </div>

          {payslipsFiltered.length === 0 ? (
            <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>{payslips.length === 0 ? "Aucun bulletin de paie enregistré." : "Aucun bulletin ne correspond à ces filtres."}</div>
          ) : (
            <div className="overflow-x-auto border rounded" style={{ borderColor: "#EEE9DA" }}><table className="w-full text-sm">
              <thead>
                <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                  <th className="py-2 px-2 font-normal">Date</th>
                  <th className="py-2 font-normal">Employé</th>
                  <th className="py-2 font-normal">Période</th>
                  <th className="py-2 font-normal text-right">Brut</th>
                  <th className="py-2 font-normal text-right">Net</th>
                  <th className="py-2 font-normal text-center">Statut</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {[...payslipsFiltered].reverse().map((p) => (
                  <tr key={p.id} style={{ borderBottom: "1px solid #F3EFE3" }}>
                    <td className="py-2 px-2 tabular">{p.date}<RecordedStamp createdAt={p.createdAt} /></td>
                    <td className="py-2">{p.employeeName}</td>
                    <td className="py-2 tabular" style={{ color: "#7A7460" }}>{p.periodStart} → {p.periodEnd}</td>
                    <td className="py-2 tabular text-right">{fmt(p.grossTotal)}</td>
                    <td className="py-2 tabular text-right font-medium">{fmt(p.netTotal)}</td>
                    <td className="py-2 text-center">
                      <span className="text-xs px-2 py-0.5 rounded" style={{ background: p.status === "payé" ? "#E6F1EE" : "#F3EFE3", color: p.status === "payé" ? "#0F6B5C" : "#8A8370" }}>{p.status}</span>
                    </td>
                    <td className="py-2 text-right pr-2">
                      {role === "Administrateur" && p.status === "payé" && (
                        <button onClick={() => cancelPayslip(p)} title="Annuler (contrepassation)" style={{ color: "#A6432F" }}><RotateCcw size={14} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      )}
    </div>
  );
}

