// ═══ MODULE ═══
// @module Declarations fiscales
// @depends HEADER_RGB, fmt, pdfSafe, useState
// @exports ComparatifPanel, DeclarationIRPanel, DeclarationTCAPanel, FISCAL_RULES_VALIDATED
// ═══ FIN DE L'EN-TÊTE ═══
const MOIS_NOMS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

// Reproduit le Formulaire No. 018 de la DGI (Haïti) — "Taxe sur le chiffre
// d'affaires – simplifié". Calcul confirmé par l'entreprise : abattement de
// 500 000 HTG et minimum de 10 000 HTG appliqués MENSUELLEMENT (pas annuellement),
// conformément au formulaire officiel consulté. Le chiffre d'affaires imposable du
// mois est lu directement des factures déjà enregistrées (hors dons et factures
// annulées) — rien à ressaisir manuellement.
// Tant qu'aucun expert-comptable local n'a validé les règles fiscales codées (voir le
// dossier de cas fiscaux), l'application le dit clairement. Passer à true UNIQUEMENT
// après réception de l'attestation écrite de l'expert.
const FISCAL_RULES_VALIDATED = false;
function FiscalValidationNotice() {
  if (FISCAL_RULES_VALIDATED) return null;
  return (
    <div className="text-xs px-3 py-2 rounded mb-4" data-testid="fiscal-notice" style={{ background: "#FBF1DC", color: "#7A5F10" }}>
      Règles fiscales en cours de validation : les calculs reproduisent les règles connues de la DGI mais n'ont pas encore été confirmés par un expert-comptable local. Faites relire la déclaration par votre comptable avant de la transmettre.
    </div>
  );
}

function DeclarationTCAPanel({ invoices, settings, defaultYear, defaultMonth, entries, accounts, planTier }) {
  const [year, setYear] = useState(defaultYear);
  const [month, setMonth] = useState(defaultMonth);
  const [declType, setDeclType] = useState("originale");
  const [interetRetard, setInteretRetard] = useState("");
  const [amende, setAmende] = useState("");

  const monthStr = String(month).padStart(2, "0");
  const periodPrefix = `${year}-${monthStr}`;
  const chiffreAffaires = invoices
    .filter((inv) => inv.date && inv.date.startsWith(periodPrefix) && inv.status !== "don" && inv.status !== "annulée")
    .reduce((s, inv) => s + (Number(inv.totalHT) || 0), 0);

  const ABATTEMENT = 500000;
  const TAUX = 0.10;
  const MINIMUM = 10000;
  const baseImposable = Math.max(0, chiffreAffaires - ABATTEMENT);
  const montantTCA = baseImposable > 0 ? Math.max(Math.round(baseImposable * TAUX), MINIMUM) : 0;
  const interet = Number(interetRetard) || 0;
  const amendeNum = Number(amende) || 0;
  const montantAPayer = montantTCA + interet + amendeNum;

  const missingInfo = [];
  if (!settings.companyNIF) missingInfo.push("NIF");
  if (!settings.companyVille) missingInfo.push("Ville");
  if (!settings.companySecteurNom) missingInfo.push("Secteur d'activité");

  // Contrôle de cohérence avant dépôt (forfait Assisté) — compare le chiffre
  // d'affaires calculé depuis les factures au solde réel des comptes de vente
  // (706/707) sur la même période : un écart peut signaler une écriture
  // manuelle qui ne correspond à aucune facture, ou une facture non comptabilisée.
  const ventesAccounts = (accounts || []).filter((a) => a.type === "Produit").map((a) => a.code);
  const dateFrom = `${periodPrefix}-01`;
  const lastDayOfMonth = new Date(year, month, 0).getDate();
  const dateTo = `${periodPrefix}-${String(lastDayOfMonth).padStart(2, "0")}`;
  const soldeVentesLedger = (entries || [])
    .filter((e) => e.date >= dateFrom && e.date <= dateTo)
    .reduce((s, e) => s + (e.lines || []).reduce((s2, l) => s2 + (ventesAccounts.includes(l.account) ? Number(l.credit || 0) - Number(l.debit || 0) : 0), 0), 0);
  const ecartCoherence = Math.round((chiffreAffaires - soldeVentesLedger) * 100) / 100;
  const coherenceChecks = [
    { ok: missingInfo.length === 0, label: missingInfo.length === 0 ? "Identification de l'entreprise complète" : `Informations manquantes : ${missingInfo.join(", ")}` },
    { ok: Math.abs(ecartCoherence) < 1, label: Math.abs(ecartCoherence) < 1 ? "Chiffre d'affaires cohérent avec le journal comptable" : `Écart de ${fmt(Math.abs(ecartCoherence))} entre les factures et le journal comptable sur cette période — à vérifier avant dépôt` },
  ];
  const hasWarnings = coherenceChecks.some((c) => !c.ok);

  const downloadPdf = () => {
    if (!window.jspdf) { alert("Le générateur de PDF n'a pas fini de charger — réessayez dans quelques secondes."); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    let y = 14;
    doc.setFontSize(10);
    doc.text("REPUBLIQUE D'HAITI", 105, y, { align: "center" }); y += 5;
    doc.text("MINISTERE DE L'ECONOMIE ET DES FINANCES", 105, y, { align: "center" }); y += 5;
    doc.text("DIRECTION GENERALE DES IMPOTS", 105, y, { align: "center" }); y += 5;
    doc.setFontSize(8);
    doc.text("No. Formulaire : 018", 105, y, { align: "center" }); y += 8;
    doc.setFontSize(12);
    doc.text("Taxe sur le chiffre d'affaires – simplifié", 105, y, { align: "center" }); y += 10;

    doc.setFontSize(9);
    doc.text(pdfSafe(`I. Période d'imposition : ${MOIS_NOMS[month - 1]} ${year}`), 14, y); y += 6;
    doc.text(pdfSafe(`II. Type de déclaration : ${declType === "originale" ? "Originale" : "Rectificative"}`), 14, y); y += 8;

    doc.setFontSize(10);
    doc.text("III. Identification", 14, y); y += 2;
    doc.autoTable({
      startY: y + 2,
      body: [
        ["Nom ou raison sociale", pdfSafe(settings.companyName || "")],
        ["NIF", pdfSafe(settings.companyNIF || "")],
        ["Adresse", pdfSafe(settings.companyAddress || "")],
        ["Ville", pdfSafe(settings.companyVille || "")],
        ["Téléphone", pdfSafe(settings.companyPhone || "")],
        ["Email", pdfSafe(settings.companyEmail || "")],
        ["Code secteur d'activité", pdfSafe(settings.companySecteurCode || "")],
        ["Nom du secteur d'activité", pdfSafe(settings.companySecteurNom || "")],
      ],
      styles: { fontSize: 8 },
      theme: "plain",
    });
    y = doc.lastAutoTable.finalY + 8;

    doc.setFontSize(10);
    doc.text("IV. Détermination de la base imposable et calcul de la taxe", 14, y); y += 2;
    doc.autoTable({
      startY: y + 2,
      head: [["", "Description", "Taux", "Montant (HTG)"]],
      body: [
        ["L1", "Montant des recettes globales ou chiffre d'affaires", "", fmt(chiffreAffaires)],
        ["L2", "Abattement", "", fmt(ABATTEMENT)],
        ["L3", "Montant de la base imposable", "", fmt(baseImposable)],
        ["L4", "Montant de la TCA (minimum 10 000 HTG)", "10%", fmt(montantTCA)],
        ["", "Intérêt de retard", "", fmt(interet)],
        ["", "Amende", "", fmt(amendeNum)],
        ["", "MONTANT A PAYER", "", fmt(montantAPayer)],
      ].map((r) => r.map(pdfSafe)),
      styles: { fontSize: 8 },
      headStyles: { fillColor: HEADER_RGB },
    });
    y = doc.lastAutoTable.finalY + 10;

    doc.setFontSize(9);
    doc.text(pdfSafe("(Montant en Gourdes, arrondi à la Gourde près)"), 14, y); y += 10;
    doc.text("V. Signature des déclarants", 14, y); y += 8;
    doc.text("Nom & Prénom : ______________________________", 14, y); y += 8;
    doc.text("NIF : ______________________________", 14, y); y += 8;
    doc.text("Signature : ______________________________    Date : _____ / _____ / _______", 14, y);

    doc.save(`Declaration-TCA-${year}-${monthStr}.pdf`);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
        <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Déclaration TCA — Formulaire DGI No. 018</div>
        <p className="text-xs mb-4" style={{ color: "#8A8370" }}>
          Reproduit le formulaire simplifié de la DGI (Haïti). Le chiffre d'affaires du mois est lu directement de vos factures — vérifiez-le avant de transmettre la déclaration.
        </p>
        <FiscalValidationNotice />
        {missingInfo.length > 0 && (
          <div className="text-xs px-3 py-2 rounded mb-4" style={{ background: "#F7E9E3", color: "#A6432F" }}>
            Informations manquantes pour l'identification : {missingInfo.join(", ")} — à renseigner dans Administration → Entreprise.
          </div>
        )}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Année</label>
            <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))}
              className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
          </div>
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Mois</label>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))}
              className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
              {MOIS_NOMS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Type</label>
            <select value={declType} onChange={(e) => setDeclType(e.target.value)}
              className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
              <option value="originale">Originale</option>
              <option value="rectificative">Rectificative</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto mb-4"><table className="w-full text-sm">
          <tbody>
            <tr style={{ borderBottom: "1px solid #F3EFE3" }}>
              <td className="py-1.5" style={{ color: "#7A7460" }}>L1 — Montant des recettes globales (chiffre d'affaires du mois)</td>
              <td className="py-1.5 tabular text-right">{fmt(chiffreAffaires)}</td>
            </tr>
            <tr style={{ borderBottom: "1px solid #F3EFE3" }}>
              <td className="py-1.5" style={{ color: "#7A7460" }}>L2 — Abattement</td>
              <td className="py-1.5 tabular text-right">{fmt(ABATTEMENT)}</td>
            </tr>
            <tr style={{ borderBottom: "1px solid #F3EFE3" }}>
              <td className="py-1.5" style={{ color: "#7A7460" }}>L3 — Montant de la base imposable</td>
              <td className="py-1.5 tabular text-right">{fmt(baseImposable)}</td>
            </tr>
            <tr style={{ borderBottom: "1px solid #F3EFE3" }}>
              <td className="py-1.5" style={{ color: "#7A7460" }}>L4 — Montant de la TCA (10%, minimum 10 000 HTG)</td>
              <td className="py-1.5 tabular text-right font-medium">{fmt(montantTCA)}</td>
            </tr>
            <tr style={{ borderBottom: "1px solid #F3EFE3" }}>
              <td className="py-1.5">Intérêt de retard</td>
              <td className="py-1.5 text-right">
                <input type="number" min="0" value={interetRetard} onChange={(e) => setInteretRetard(e.target.value)} placeholder="0"
                  className="w-28 border rounded px-2 py-1 text-xs tabular text-right" style={{ borderColor: "#DDD6C4" }} />
              </td>
            </tr>
            <tr style={{ borderBottom: "1px solid #F3EFE3" }}>
              <td className="py-1.5">Amende</td>
              <td className="py-1.5 text-right">
                <input type="number" min="0" value={amende} onChange={(e) => setAmende(e.target.value)} placeholder="0"
                  className="w-28 border rounded px-2 py-1 text-xs tabular text-right" style={{ borderColor: "#DDD6C4" }} />
              </td>
            </tr>
            <tr>
              <td className="py-2 font-semibold" style={{ color: "#152238" }}>MONTANT A PAYER</td>
              <td className="py-2 tabular text-right font-semibold px-3 rounded" style={{ background: "#F7E9E3", color: "#A6432F" }}>{fmt(montantAPayer)}</td>
            </tr>
          </tbody>
        </table></div>

        {planTier === "assisted" && (
          <div className="mb-4 p-3 rounded" style={{ background: hasWarnings ? "#FBF1DC" : "#E6F1EE" }}>
            <div className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: hasWarnings ? "#9A7B1E" : "#0F6B5C" }}>Vérifications avant dépôt</div>
            <div className="space-y-1.5">
              {coherenceChecks.map((c, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <span style={{ color: c.ok ? "#0F6B5C" : "#9A7B1E" }}>{c.ok ? "✓" : "⚠"}</span>
                  <span style={{ color: "#152238" }}>{c.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <button onClick={downloadPdf} className="px-4 py-2 rounded text-sm text-white" style={{ background: "#152238" }}>Télécharger la déclaration (.pdf)</button>
      </div>
    </div>
  );
}

// Barème progressif de l'Impôt sur le Revenu (Haïti) — cinq tranches, chacune
// s'appliquant uniquement à la portion du revenu qui s'y trouve (calcul cumulatif,
// pas un taux unique appliqué à tout le revenu).
const IR_TRANCHES = [
  { min: 0, max: 60000, taux: 0 },
  { min: 60000, max: 240000, taux: 0.10 },
  { min: 240000, max: 480000, taux: 0.15 },
  { min: 480000, max: 1000000, taux: 0.25 },
  { min: 1000000, max: Infinity, taux: 0.30 },
];

function calculerIR(revenuImposable) {
  let impot = 0;
  const detail = [];
  IR_TRANCHES.forEach((t) => {
    if (revenuImposable > t.min) {
      const portion = Math.min(revenuImposable, t.max) - t.min;
      const montant = portion * t.taux;
      impot += montant;
      if (portion > 0) detail.push({ ...t, portion, montant });
    }
  });
  return { impot: Math.round(impot), detail };
}

// Reproduit le calcul de l'Impôt sur le Revenu (Haïti) — barème progressif à cinq
// tranches, communiqué par l'entreprise. Le résultat annuel de l'exercice est
// suggéré comme point de départ pour le revenu global, mais reste entièrement
// modifiable : le revenu fiscalement imposable (après déductions légales,
// exonérations éventuelles...) ne correspond pas toujours exactement au résultat
// comptable, que l'app ne peut pas déterminer seule.
function DeclarationIRPanel({ entries, accounts, invoices, settings, defaultYear, planTier }) {
  const [regime, setRegime] = useState("reel"); // "reel" | "forfaitaire"
  const [year, setYear] = useState(defaultYear);
  const [revenuGlobal, setRevenuGlobal] = useState("");
  const [deductions, setDeductions] = useState("");
  const [retenuesVersees, setRetenuesVersees] = useState("");
  const [caForfaitaire, setCaForfaitaire] = useState("");

  const yearEntries = entries.filter((e) => e.date && e.date.startsWith(String(year)));
  const produitsAccounts = accounts.filter((a) => a.type === "Produit");
  const chargesAccounts = accounts.filter((a) => a.type === "Charge");
  const balY = {};
  yearEntries.forEach((e) => (e.lines || []).forEach((l) => { balY[l.account] = (balY[l.account] || 0) + Number(l.debit || 0) - Number(l.credit || 0); }));
  const produitsY = produitsAccounts.reduce((s, a) => s - (balY[a.code] || 0), 0);
  const chargesY = chargesAccounts.reduce((s, a) => s + (balY[a.code] || 0), 0);
  const resultatSuggere = produitsY - chargesY;

  const revenu = revenuGlobal !== "" ? Number(revenuGlobal) : resultatSuggere;
  const deductionsNum = Number(deductions) || 0;
  const revenuImposable = Math.max(0, revenu - deductionsNum);
  const { impot, detail } = calculerIR(revenuImposable);
  const retenuesNum = Number(retenuesVersees) || 0;
  const impotNet = Math.max(0, impot - retenuesNum);

  // Régime forfaitaire — réservé aux entreprises individuelles dont le chiffre
  // d'affaires annuel (ou le total actif) est inférieur à 2 500 000 HTG. Même
  // structure que la TCA (abattement + taux + minimum), mais annuelle et à 1%.
  const caAnnuelSuggere = invoices
    .filter((inv) => inv.date && inv.date.startsWith(String(year)) && inv.status !== "don" && inv.status !== "annulée")
    .reduce((s, inv) => s + (Number(inv.totalHT) || 0), 0);
  const caUtilise = caForfaitaire !== "" ? Number(caForfaitaire) : caAnnuelSuggere;
  const ABATTEMENT_FORFAITAIRE = 500000;
  const TAUX_FORFAITAIRE = 0.01;
  const MINIMUM_FORFAITAIRE = 10000;
  const baseForfaitaire = Math.max(0, caUtilise - ABATTEMENT_FORFAITAIRE);
  const impotForfaitaire = baseForfaitaire > 0 ? Math.max(Math.round(baseForfaitaire * TAUX_FORFAITAIRE), MINIMUM_FORFAITAIRE) : 0;
  const eligibleForfaitaire = caUtilise < 2500000;

  // Contrôles de cohérence avant dépôt (forfait Assisté) — signale un écart
  // important entre une valeur saisie manuellement et la suggestion automatique,
  // sans jamais empêcher la saisie : l'utilisateur reste libre de corriger une
  // suggestion imparfaite, mais un écart important mérite d'être vérifié.
  const missingInfoIR = [];
  if (!settings.companyNIF) missingInfoIR.push("NIF");
  const ecartRevenu = resultatSuggere !== 0 ? Math.abs((revenu - resultatSuggere) / resultatSuggere) : (revenu !== 0 ? 1 : 0);
  const ecartCA = caAnnuelSuggere !== 0 ? Math.abs((caUtilise - caAnnuelSuggere) / caAnnuelSuggere) : (caUtilise !== 0 ? 1 : 0);
  const coherenceChecksReel = [
    { ok: missingInfoIR.length === 0, label: missingInfoIR.length === 0 ? "Identification de l'entreprise complète" : `Informations manquantes : ${missingInfoIR.join(", ")}` },
    { ok: revenuGlobal === "" || ecartRevenu < 0.2, label: (revenuGlobal === "" || ecartRevenu < 0.2) ? "Revenu global cohérent avec le résultat comptable" : `Le revenu global saisi s'écarte de plus de 20% du résultat comptable (${fmt(resultatSuggere)}) — à vérifier avant dépôt` },
  ];
  const coherenceChecksForfaitaire = [
    { ok: missingInfoIR.length === 0, label: missingInfoIR.length === 0 ? "Identification de l'entreprise complète" : `Informations manquantes : ${missingInfoIR.join(", ")}` },
    { ok: caForfaitaire === "" || ecartCA < 0.2, label: (caForfaitaire === "" || ecartCA < 0.2) ? "Chiffre d'affaires cohérent avec les factures" : `Le chiffre d'affaires saisi s'écarte de plus de 20% des factures enregistrées (${fmt(caAnnuelSuggere)}) — à vérifier avant dépôt` },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
        <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Impôt sur le Revenu</div>
        <p className="text-xs mb-4" style={{ color: "#8A8370" }}>
          Deux régimes existent : le <strong>Forfaitaire</strong>, réservé aux entreprises individuelles dont le chiffre d'affaires annuel est inférieur à 2 500 000 HTG ; le <strong>Réel</strong> (barème progressif), pour les sociétés et les entreprises individuelles au-delà de ce seuil.
        </p>
        <FiscalValidationNotice />
        <div className="flex gap-2 mb-4">
          <button onClick={() => setRegime("forfaitaire")}
            className="px-3 py-1.5 rounded text-xs" style={{ background: regime === "forfaitaire" ? "#152238" : "#F3EFE3", color: regime === "forfaitaire" ? "#fff" : "#7A7460" }}>
            Forfaitaire (entreprise individuelle, CA &lt; 2,5M)
          </button>
          <button onClick={() => setRegime("reel")}
            className="px-3 py-1.5 rounded text-xs" style={{ background: regime === "reel" ? "#152238" : "#F3EFE3", color: regime === "reel" ? "#fff" : "#7A7460" }}>
            Réel (barème progressif)
          </button>
        </div>
        <div className="mb-4">
          <label className="text-xs" style={{ color: "#8A8370" }}>Année</label>
          <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))}
            className="block border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
        </div>

        {regime === "forfaitaire" ? (
          <>
            {!eligibleForfaitaire ? (
              <div className="text-xs px-3 py-2 rounded mb-4" style={{ background: "#F7E9E3", color: "#A6432F" }}>
                Le chiffre d'affaires utilisé ({fmt(caUtilise)}) dépasse le seuil de 2 500 000 HTG — cette entreprise n'est pas éligible au régime forfaitaire. Utilisez le régime "Réel" ci-dessus.
              </div>
            ) : (
              <>
            <div className="mb-4">
              <label className="text-xs" style={{ color: "#8A8370" }}>Chiffre d'affaires annuel (recettes globales)</label>
              <input type="number" value={caForfaitaire} onChange={(e) => setCaForfaitaire(e.target.value)} placeholder={String(Math.round(caAnnuelSuggere))}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
              <p className="text-xs mt-1" style={{ color: "#A39C87" }}>Suggestion (factures {year}, hors dons/annulées) : {fmt(caAnnuelSuggere)}</p>
            </div>
            <div className="overflow-x-auto mb-4"><table className="w-full text-sm">
              <tbody>
                <tr style={{ borderBottom: "1px solid #F3EFE3" }}>
                  <td className="py-1.5" style={{ color: "#7A7460" }}>Chiffre d'affaires annuel</td>
                  <td className="py-1.5 tabular text-right">{fmt(caUtilise)}</td>
                </tr>
                <tr style={{ borderBottom: "1px solid #F3EFE3" }}>
                  <td className="py-1.5" style={{ color: "#7A7460" }}>Abattement</td>
                  <td className="py-1.5 tabular text-right">{fmt(ABATTEMENT_FORFAITAIRE)}</td>
                </tr>
                <tr style={{ borderBottom: "1px solid #F3EFE3" }}>
                  <td className="py-1.5" style={{ color: "#7A7460" }}>Base (CA − abattement)</td>
                  <td className="py-1.5 tabular text-right">{fmt(baseForfaitaire)}</td>
                </tr>
                <tr>
                  <td className="py-2 font-semibold" style={{ color: "#152238" }}>IMPÔT FORFAITAIRE À PAYER (1%, minimum 10 000 HTG)</td>
                  <td className="py-2 tabular text-right font-semibold px-3 rounded" style={{ background: "#F7E9E3", color: "#A6432F" }}>{fmt(impotForfaitaire)}</td>
                </tr>
              </tbody>
            </table></div>
            {planTier === "assisted" && (
              <div className="mb-4 p-3 rounded" style={{ background: coherenceChecksForfaitaire.some((c) => !c.ok) ? "#FBF1DC" : "#E6F1EE" }}>
                <div className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: coherenceChecksForfaitaire.some((c) => !c.ok) ? "#9A7B1E" : "#0F6B5C" }}>Vérifications avant dépôt</div>
                <div className="space-y-1.5">
                  {coherenceChecksForfaitaire.map((c, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <span style={{ color: c.ok ? "#0F6B5C" : "#9A7B1E" }}>{c.ok ? "✓" : "⚠"}</span>
                      <span style={{ color: "#152238" }}>{c.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <p className="text-xs" style={{ color: "#A39C87" }}>À déposer et payer au plus tard le 31 octobre de chaque exercice fiscal.</p>
              </>
            )}
          </>
        ) : (
          <>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Revenu global</label>
            <input type="number" value={revenuGlobal} onChange={(e) => setRevenuGlobal(e.target.value)} placeholder={String(Math.round(resultatSuggere))}
              className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
            <p className="text-xs mt-1" style={{ color: "#A39C87" }}>Suggestion (résultat de l'exercice {year}) : {fmt(resultatSuggere)}</p>
          </div>
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Déductions légales</label>
            <input type="number" min="0" value={deductions} onChange={(e) => setDeductions(e.target.value)} placeholder="0"
              className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
          </div>
        </div>

        <div className="p-3 rounded mb-4" style={{ background: "#FAF8F1" }}>
          <div className="text-xs" style={{ color: "#8A8370" }}>Revenu net imposable</div>
          <div className="text-lg font-medium tabular" style={{ color: "#152238" }}>{fmt(revenuImposable)}</div>
        </div>

        <div className="overflow-x-auto mb-4"><table className="w-full text-sm">
          <thead>
            <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
              <th className="py-1.5 font-normal">Tranche</th>
              <th className="py-1.5 font-normal text-right">Taux</th>
              <th className="py-1.5 font-normal text-right">Portion imposée</th>
              <th className="py-1.5 font-normal text-right">Montant</th>
            </tr>
          </thead>
          <tbody>
            {detail.map((t, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #F3EFE3" }}>
                <td className="py-1.5" style={{ color: "#7A7460" }}>{fmt(t.min)} — {t.max === Infinity ? "et plus" : fmt(t.max)}</td>
                <td className="py-1.5 tabular text-right">{(t.taux * 100).toFixed(0)}%</td>
                <td className="py-1.5 tabular text-right">{fmt(t.portion)}</td>
                <td className="py-1.5 tabular text-right">{fmt(t.montant)}</td>
              </tr>
            ))}
            <tr style={{ borderBottom: "1px solid #F3EFE3" }}>
              <td className="py-1.5 font-medium" colSpan={3} style={{ color: "#152238" }}>Impôt brut</td>
              <td className="py-1.5 tabular text-right font-medium">{fmt(impot)}</td>
            </tr>
            <tr style={{ borderBottom: "1px solid #F3EFE3" }}>
              <td colSpan={3}>
                <label className="text-xs" style={{ color: "#8A8370" }}>Retenues déjà versées à la DGI (hors retenues libératoires)</label>
              </td>
              <td className="py-1.5 text-right">
                <input type="number" min="0" value={retenuesVersees} onChange={(e) => setRetenuesVersees(e.target.value)} placeholder="0"
                  className="w-28 border rounded px-2 py-1 text-xs tabular text-right" style={{ borderColor: "#DDD6C4" }} />
              </td>
            </tr>
            <tr>
              <td className="py-2 font-semibold" colSpan={3} style={{ color: "#152238" }}>IMPÔT NET À PAYER</td>
              <td className="py-2 tabular text-right font-semibold px-3 rounded" style={{ background: "#F7E9E3", color: "#A6432F" }}>{fmt(impotNet)}</td>
            </tr>
          </tbody>
        </table></div>
            {planTier === "assisted" && (
              <div className="mt-4 p-3 rounded" style={{ background: coherenceChecksReel.some((c) => !c.ok) ? "#FBF1DC" : "#E6F1EE" }}>
                <div className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: coherenceChecksReel.some((c) => !c.ok) ? "#9A7B1E" : "#0F6B5C" }}>Vérifications avant dépôt</div>
                <div className="space-y-1.5">
                  {coherenceChecksReel.map((c, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <span style={{ color: c.ok ? "#0F6B5C" : "#9A7B1E" }}>{c.ok ? "✓" : "⚠"}</span>
                      <span style={{ color: "#152238" }}>{c.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Comparatif mois par mois / année par année — fonctionnalité exclusive au
// forfait Assisté. Calcule produits, charges et résultat pour chaque période à
// partir des écritures déjà enregistrées, sans rien modifier ni ajouter au
// journal — un rapport de lecture, comme les autres écrans de Rapports et analyse.
function ComparatifPanel({ entries, accounts, planTier }) {
  const [mode, setMode] = useState("mois"); // "mois" | "annee"

  if (planTier !== "assisted") {
    return (
      <div className="bg-white rounded-lg p-6 text-sm" style={{ border: "1px solid #E4DFD1", color: "#8A8370" }}>
        Le comparatif mois par mois / année par année est réservé au forfait Assisté.
      </div>
    );
  }

  const produitsAccounts = accounts.filter((a) => a.type === "Produit").map((a) => a.code);
  const chargesAccounts = accounts.filter((a) => a.type === "Charge").map((a) => a.code);

  const computeFor = (fromDate, toDate) => {
    const bal = {};
    entries.forEach((e) => {
      if (e.date < fromDate || e.date > toDate) return;
      (e.lines || []).forEach((l) => { bal[l.account] = (bal[l.account] || 0) + Number(l.debit || 0) - Number(l.credit || 0); });
    });
    const produits = produitsAccounts.reduce((s, c) => s - (bal[c] || 0), 0);
    const charges = chargesAccounts.reduce((s, c) => s + (bal[c] || 0), 0);
    return { produits, charges, resultat: produits - charges };
  };

  const now = new Date();
  const MOIS_COURTS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Jun", "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc"];
  let periods = [];
  if (mode === "mois") {
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      const to = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      periods.push({ label: `${MOIS_COURTS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, ...computeFor(from, to) });
    }
  } else {
    for (let i = 4; i >= 0; i--) {
      const y = now.getFullYear() - i;
      periods.push({ label: String(y), ...computeFor(`${y}-01-01`, `${y}-12-31`) });
    }
  }

  const maxAbs = Math.max(1, ...periods.map((p) => Math.max(Math.abs(p.produits), Math.abs(p.charges))));

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div className="text-sm font-medium" style={{ color: "#152238" }}>Comparatif {mode === "mois" ? "mois par mois" : "année par année"}</div>
          <div className="flex gap-2">
            <button onClick={() => setMode("mois")} className="px-3 py-1.5 rounded text-xs" style={{ background: mode === "mois" ? "#152238" : "#F3EFE3", color: mode === "mois" ? "#fff" : "#7A7460" }}>Par mois</button>
            <button onClick={() => setMode("annee")} className="px-3 py-1.5 rounded text-xs" style={{ background: mode === "annee" ? "#152238" : "#F3EFE3", color: mode === "annee" ? "#fff" : "#7A7460" }}>Par année</button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="flex items-end gap-3" style={{ minWidth: periods.length * 70, height: 180 }}>
            {periods.map((p, i) => (
              <div key={i} className="flex flex-col items-center justify-end" style={{ width: 56, height: "100%" }}>
                <div className="flex items-end gap-1" style={{ height: 130 }}>
                  <div style={{ width: 18, height: `${Math.max(2, (Math.abs(p.produits) / maxAbs) * 130)}px`, background: "#639922", borderRadius: "3px 3px 0 0" }} title={`Produits : ${fmt(p.produits)}`}></div>
                  <div style={{ width: 18, height: `${Math.max(2, (Math.abs(p.charges) / maxAbs) * 130)}px`, background: "#D85A30", borderRadius: "3px 3px 0 0" }} title={`Charges : ${fmt(p.charges)}`}></div>
                </div>
                <div className="text-xs mt-1.5 whitespace-nowrap" style={{ color: "#8A8370" }}>{p.label}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex gap-4 mt-3 text-xs" style={{ color: "#8A8370" }}>
          <div className="flex items-center gap-1.5"><span style={{ width: 10, height: 10, background: "#639922", borderRadius: 2, display: "inline-block" }}></span>Produits</div>
          <div className="flex items-center gap-1.5"><span style={{ width: 10, height: 10, background: "#D85A30", borderRadius: 2, display: "inline-block" }}></span>Charges</div>
        </div>
      </div>

      <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(21,34,56,0.08)" }}>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead>
            <tr style={{ background: "#C7CCDA" }}>
              <th className="py-2 px-3 text-left font-medium" style={{ color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Période</th>
              <th className="py-2 px-3 text-right font-medium" style={{ color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Produits</th>
              <th className="py-2 px-3 text-right font-medium" style={{ color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Charges</th>
              <th className="py-2 px-3 text-right font-medium" style={{ color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Résultat</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p, i) => (
              <tr key={i}>
                <td className="py-2 pl-3 pr-1" style={{ color: "#152238" }}>{p.label}</td>
                <td className="py-2 px-3 tabular text-right" style={{ color: "#0F6B5C" }}>{fmt(p.produits)}</td>
                <td className="py-2 px-3 tabular text-right" style={{ color: "#A6432F" }}>{fmt(p.charges)}</td>
                <td className="py-2 px-3 tabular text-right font-medium" style={{ color: p.resultat >= 0 ? "#0F6B5C" : "#A6432F" }}>{fmt(p.resultat)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}

