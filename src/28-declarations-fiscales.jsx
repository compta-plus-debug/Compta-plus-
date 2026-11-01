// ═══ MODULE ═══
// @module Declarations fiscales
// @depends HEADER_RGB, downloadTablePDF, fmt, pdfSafe, useState
// @exports CalendrierFiscalPanel, ComparatifPanel, DeclarationIRPanel, DeclarationTCAPanel
//   FISCAL_RULES_VALIDATED, RetenuesPrestationsPanel, VersementsAnnuelsPanel
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

function DeclarationTCAPanel({ invoices, settings, defaultYear, defaultMonth, entries, accounts, planTier, purchases }) {
  const [year, setYear] = useState(defaultYear);
  const [month, setMonth] = useState(defaultMonth);
  const [declType, setDeclType] = useState("originale");
  const [interetRetard, setInteretRetard] = useState("");
  const [amende, setAmende] = useState("");
  const [abattementSaisi, setAbattementSaisi] = useState("");
  const [minimumSaisi, setMinimumSaisi] = useState("");

  const monthStr = String(month).padStart(2, "0");
  const periodPrefix = `${year}-${monthStr}`;
  const chiffreAffaires = invoices
    .filter((inv) => inv.date && inv.date.startsWith(periodPrefix) && inv.status !== "don" && inv.status !== "annulée")
    .reduce((s, inv) => s + (Number(inv.totalHT) || 0), 0);

  // Code fiscal en vigueur depuis le 1er octobre 2026 : taux de 10 % (article 186) appliqué à l'assiette (article 184),
  // sans abattement ni minimum de perception. Les deux champs restent modifiables au cas où le formulaire de la DGI
  // en vigueur en prévoirait un (à confirmer auprès de la DGI).
  const ABATTEMENT = Math.max(0, Number(abattementSaisi) || 0);
  const TAUX = 0.10;
  const MINIMUM = Math.max(0, Number(minimumSaisi) || 0);
  const baseImposable = Math.max(0, chiffreAffaires - ABATTEMENT);
  const montantTCA = baseImposable > 0 ? Math.max(Math.round(baseImposable * TAUX), MINIMUM) : 0;
  // TCA déductible sur les achats (articles 187 à 190) : solde du compte 4456 sur le mois (achats moins retours et
  // annulations). Si elle dépasse la TCA due, l'excédent est reporté sur les mois suivants, sans remboursement (art. 188).
  const tcaMois = (y, m) => {
    const pre = `${y}-${String(m).padStart(2, "0")}`;
    const ca = invoices.filter((inv) => inv.date && inv.date.startsWith(pre) && inv.status !== "don" && inv.status !== "annulée").reduce((t, inv) => t + (Number(inv.totalHT) || 0), 0);
    const due = Math.max(0, ca) > 0 ? Math.max(Math.round(Math.max(0, ca - (pre === periodPrefix ? ABATTEMENT : 0)) * TAUX), pre === periodPrefix ? MINIMUM : 0) : 0;
    const ded = Math.round((entries || []).filter((e) => e.date && e.date.startsWith(pre)).reduce((t, e) => t + (e.lines || []).reduce((t2, l) => t2 + (l.account === "4456" ? Number(l.debit || 0) - Number(l.credit || 0) : 0), 0), 0) * 100) / 100;
    return { due, ded };
  };
  const datesAvecTaxe = (entries || []).filter((e) => (e.lines || []).some((l) => l.account === "4456") && e.date && e.date.slice(0, 7) < periodPrefix).map((e) => e.date.slice(0, 7)).sort();
  let creditReporte = 0;
  if (datesAvecTaxe.length) {
    let [cy, cm] = datesAvecTaxe[0].split("-").map(Number);
    let guard = 0;
    while (`${cy}-${String(cm).padStart(2, "0")}` < periodPrefix && guard++ < 120) {
      const r = tcaMois(cy, cm);
      creditReporte = Math.max(0, Math.round((r.ded + creditReporte - r.due) * 100) / 100);
      cm += 1; if (cm > 12) { cm = 1; cy += 1; }
    }
  }
  const tcaDeductibleMois = tcaMois(year, month).ded;
  const tcaNette = Math.max(0, Math.round((montantTCA - tcaDeductibleMois - creditReporte) * 100) / 100);
  const creditAReporter = Math.max(0, Math.round((tcaDeductibleMois + creditReporte - montantTCA) * 100) / 100);
  const achatsTaxe = (purchases || []).filter((p) => p.date && p.date.startsWith(periodPrefix) && p.tcaDeductible > 0 && p.status !== "annulé");
  const interet = Number(interetRetard) || 0;
  const amendeNum = Number(amende) || 0;
  const montantAPayer = tcaNette + interet + amendeNum;
  

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
        ["L4", MINIMUM > 0 ? `Montant de la TCA (minimum ${fmt(MINIMUM)} HTG)` : "Montant de la TCA", "10%", fmt(montantTCA)],
        ["L5", "TCA déductible sur achats du mois (art. 187)", "", fmt(tcaDeductibleMois)],
        ["L6", "Crédit de TCA reporté des mois précédents (art. 188)", "", fmt(creditReporte)],
        ["L7", "TCA nette due (L4 - L5 - L6)", "", fmt(tcaNette)],
        ["", "Crédit à reporter sur le mois suivant", "", fmt(creditAReporter)],
        ["", "Intérêt de retard", "", fmt(interet)],
        ["", "Amende", "", fmt(amendeNum)],
        ["", "MONTANT A PAYER", "", fmt(montantAPayer)],
      ].map((r) => r.map(pdfSafe)),
      styles: { fontSize: 8 },
      headStyles: { fillColor: HEADER_RGB },
    });
    y = doc.lastAutoTable.finalY + 10;

    if (achatsTaxe.length) {
      doc.setFontSize(10);
      doc.text(pdfSafe("Liste des factures d'achat ouvrant droit à déduction (art. 190)"), 14, y); y += 2;
      doc.autoTable({
        startY: y + 2,
        head: [["Date", "Fournisseur", "N° facture", "Hors taxe", "TCA"]],
        body: achatsTaxe.map((p) => [p.date, p.supplier || "", p.supplierInvoiceNo || "", fmt(p.amountHT), fmt(p.tcaDeductible)]).map((r) => r.map(pdfSafe)),
        styles: { fontSize: 8 }, headStyles: { fillColor: HEADER_RGB },
      });
      y = doc.lastAutoTable.finalY + 8;
    }
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
          Reproduit le formulaire simplifié de la DGI (Haïti). Le chiffre d'affaires du mois est lu directement de vos factures. Le Code fiscal (articles 186 et 190) fixe la TCA à 10 % et la déclaration mensuelle entre le 1er et le 15 du mois suivant ; la TCA déductible sur vos achats (articles 187 et 188), saisie dans Achats, est déduite ci-dessous ; l'excédent éventuel est reporté sur les mois suivants sans remboursement. Les entreprises de moins de 10 millions de HTG de chiffre d'affaires sont en franchise (article 193), sans TCA.
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
              <td className="py-1.5" style={{ color: "#7A7460" }}>L2 — Abattement (aucun dans le Code ; à saisir seulement si la DGI l'exige)</td>
              <td className="py-1.5 text-right">
                <input type="number" min="0" value={abattementSaisi} onChange={(e) => setAbattementSaisi(e.target.value)} placeholder="0" data-testid="tca-abattement"
                  className="w-28 border rounded px-2 py-1 text-xs tabular text-right" style={{ borderColor: "#DDD6C4" }} />
              </td>
            </tr>
            <tr style={{ borderBottom: "1px solid #F3EFE3" }}>
              <td className="py-1.5" style={{ color: "#7A7460" }}>L3 — Montant de la base imposable</td>
              <td className="py-1.5 tabular text-right">{fmt(baseImposable)}</td>
            </tr>
            <tr style={{ borderBottom: "1px solid #F3EFE3" }}>
              <td className="py-1.5" style={{ color: "#7A7460" }}>L4 — Montant de la TCA (10 %, article 186)
                <span className="block text-xs" style={{ color: "#A39C87" }}>Minimum de perception (aucun dans le Code) : <input type="number" min="0" value={minimumSaisi} onChange={(e) => setMinimumSaisi(e.target.value)} placeholder="0" data-testid="tca-minimum" className="w-24 border rounded px-1 py-0.5 text-xs tabular text-right" style={{ borderColor: "#DDD6C4" }} /></span></td>
              <td className="py-1.5 tabular text-right font-medium">{fmt(montantTCA)}</td>
            </tr>
            <tr style={{ borderBottom: "1px solid #F3EFE3" }}>
              <td className="py-1.5" style={{ color: "#7A7460" }}>L5 — TCA déductible sur les achats du mois</td>
              <td className="py-1.5 tabular text-right" data-testid="tca-deductible">{fmt(tcaDeductibleMois)}</td>
            </tr>
            <tr style={{ borderBottom: "1px solid #F3EFE3" }}>
              <td className="py-1.5" style={{ color: "#7A7460" }}>L6 — Crédit de TCA reporté des mois précédents</td>
              <td className="py-1.5 tabular text-right" data-testid="tca-credit">{fmt(creditReporte)}</td>
            </tr>
            <tr style={{ borderBottom: "1px solid #F3EFE3" }}>
              <td className="py-1.5" style={{ color: "#7A7460" }}>L7 — TCA nette due (L4 − L5 − L6)
                {creditAReporter > 0 && <span className="block text-xs" style={{ color: "#0F6B5C" }}>Crédit à reporter sur le mois suivant : {fmt(creditAReporter)} (non remboursable)</span>}</td>
              <td className="py-1.5 tabular text-right font-medium" data-testid="tca-nette">{fmt(tcaNette)}</td>
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

        {achatsTaxe.length > 0 && (
          <div className="mb-4 overflow-x-auto" data-testid="tca-liste-achats">
            <div className="text-xs font-medium mb-1" style={{ color: "#152238" }}>Factures d'achat avec TCA déductible ce mois (à conserver, art. 190)</div>
            <table className="w-full text-xs"><tbody>
              {achatsTaxe.map((p) => (
                <tr key={p.id} style={{ borderBottom: "1px solid #F3EFE3" }}>
                  <td className="py-1">{p.date}</td><td>{p.supplier}</td><td>{p.supplierInvoiceNo || "—"}</td>
                  <td className="tabular text-right">{fmt(p.amountHT)}</td><td className="tabular text-right">{fmt(p.tcaDeductible)}</td>
                </tr>
              ))}
            </tbody></table>
          </div>
        )}

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
// Deux barèmes coexistent : l'ancien (décret de 2005) et celui du nouveau Code fiscal, en vigueur depuis le
// 1er octobre 2026 (barème annuel, par tranche). Sources : presse haïtienne et note du ministère des Finances ;
// à confirmer dans le texte officiel (Moniteur, numéro spécial 48-A). Le choix par défaut dépend de l'année.
const IR_BAREMES = {
  ancien: { label: "Ancien barème (décret de 2005)", tranches: [
    { min: 0, max: 60000, taux: 0 },
    { min: 60000, max: 240000, taux: 0.10 },
    { min: 240000, max: 480000, taux: 0.15 },
    { min: 480000, max: 1000000, taux: 0.25 },
    { min: 1000000, max: Infinity, taux: 0.30 },
  ] },
  nouveau: { label: "Nouveau Code fiscal (depuis le 1er octobre 2026)", tranches: [
    { min: 0, max: 360000, taux: 0 },
    { min: 360000, max: 540000, taux: 0.12 },
    { min: 540000, max: 1080000, taux: 0.18 },
    { min: 1080000, max: 2160000, taux: 0.25 },
    { min: 2160000, max: Infinity, taux: 0.30 },
  ] },
};
function baremeParDefaut(annee) { return Number(annee) >= 2026 ? "nouveau" : "ancien"; }
const IR_TRANCHES = IR_BAREMES.ancien.tranches;

function calculerIR(revenuImposable, bareme) {
  const tranches = (IR_BAREMES[bareme] || IR_BAREMES.nouveau).tranches;
  let impot = 0;
  const detail = [];
  tranches.forEach((t) => {
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
// tranches. Le résultat annuel de l'exercice est suggéré comme point de départ pour
// le revenu global, mais reste entièrement modifiable : le revenu fiscalement
// imposable (après déductions légales, exonérations éventuelles...) ne correspond
// pas toujours exactement au résultat comptable, que l'app ne peut pas déterminer seule.
function DeclarationIRPanel({ entries, accounts, invoices, settings, defaultYear, planTier }) {
  const [regime, setRegime] = useState("reel"); // "reel" | "forfaitaire"
  const [year, setYear] = useState(defaultYear);
  const [revenuGlobal, setRevenuGlobal] = useState("");
  const [deductions, setDeductions] = useState("");
  const [retenuesVersees, setRetenuesVersees] = useState("");
  const [baremeChoisi, setBaremeChoisi] = useState("");
  const [entite, setEntite] = useState("physique"); // physique | societe | cooperative (article 137)
  const [forfType, setForfType] = useState("services"); // services (5 %) | autres (2 %) (article 65)
  const [caForfaitaire, setCaForfaitaire] = useState("");
  const [impotN2, setImpotN2] = useState("");            // impôt établi sur le bénéfice réel de l'avant-dernier exercice (article 81)
  const [acomptesVerses, setAcomptesVerses] = useState(""); // acomptes provisionnels déjà versés pour l'exercice déclaré

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
  const bareme = baremeChoisi || baremeParDefaut(year);
  // Personnes morales (article 137) : impôt sur les sociétés au taux unique de 30 % (10 % pour les coopératives
  // d'épargne et de crédit) ; personnes physiques : barème progressif de l'article 132.
  const tauxSociete = entite === "cooperative" ? 0.10 : 0.30;
  const { impot, detail } = entite === "physique"
    ? calculerIR(revenuImposable, bareme)
    : { impot: Math.round(revenuImposable * tauxSociete), detail: revenuImposable > 0 ? [{ min: 0, max: Infinity, taux: tauxSociete, portion: revenuImposable, montant: revenuImposable * tauxSociete }] : [] };
  const retenuesNum = Number(retenuesVersees) || 0;
  const acomptesNum = Math.max(0, Number(acomptesVerses) || 0);
  const impotNet = Math.max(0, impot - retenuesNum - acomptesNum);
  // Acomptes provisionnels (article 81) : 60 % de l'impôt de l'avant-dernier exercice, en deux tranches égales,
  // versées entre le 1er et le 15 octobre puis entre le 1er et le 15 décembre. L'excédent éventuel sur l'impôt de
  // l'exercice se déduit des acomptes suivants.
  const acompteAnnuel = Math.round((Math.max(0, Number(impotN2) || 0)) * 0.60);
  const tranche1 = Math.round(acompteAnnuel / 2);
  const tranche2 = acompteAnnuel - tranche1;
  const creditAcomptes = Math.max(0, Math.round((acomptesNum - Math.max(0, impot - retenuesNum)) * 100) / 100);

  // Régime forfaitaire (articles 62 à 66 du Code fiscal en vigueur depuis le 1er octobre 2026) : entreprises dont le
  // chiffre d'affaires de l'exercice précédent est inférieur à 10 000 000 HTG ; base = chiffre d'affaires après un
  // abattement de 1 000 000 HTG ; taux 5 % (prestations de services) ou 2 % (autres) ; impôt minimum 25 000 HTG ;
  // déclaration entre le 1er et le 31 octobre pour l'exercice précédent, paiement au plus tard le 31 octobre.
  const caAnnuelSuggere = invoices
    .filter((inv) => inv.date && inv.date.startsWith(String(year)) && inv.status !== "don" && inv.status !== "annulée")
    .reduce((s, inv) => s + (Number(inv.totalHT) || 0), 0);
  const caUtilise = caForfaitaire !== "" ? Number(caForfaitaire) : caAnnuelSuggere;
  const ABATTEMENT_FORFAITAIRE = 1000000;
  const TAUX_FORFAITAIRE = forfType === "services" ? 0.05 : 0.02;
  const MINIMUM_FORFAITAIRE = 25000;
  const SEUIL_FORFAITAIRE = 10000000;
  const baseForfaitaire = Math.max(0, caUtilise - ABATTEMENT_FORFAITAIRE);
  const impotForfaitaire = baseForfaitaire > 0 ? Math.max(Math.round(baseForfaitaire * TAUX_FORFAITAIRE), MINIMUM_FORFAITAIRE) : 0;
  const eligibleForfaitaire = caUtilise < SEUIL_FORFAITAIRE;

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
          Deux régimes existent (Code fiscal en vigueur depuis le 1er octobre 2026) : le <strong>Forfaitaire</strong> (articles 62 à 66), pour les entreprises dont le chiffre d'affaires de l'exercice précédent est inférieur à 10 000 000 HTG ; le <strong>Réel</strong> (article 68), à partir de 10 000 000 HTG, avec le barème progressif pour les personnes physiques (article 132) et l'impôt sur les sociétés à 30 % pour les personnes morales (article 137).
        </p>
        <FiscalValidationNotice />
        <div className="flex gap-2 mb-4">
          <button onClick={() => setRegime("forfaitaire")}
            className="px-3 py-1.5 rounded text-xs" style={{ background: regime === "forfaitaire" ? "#152238" : "#F3EFE3", color: regime === "forfaitaire" ? "#fff" : "#7A7460" }}>
            Forfaitaire (CA &lt; 10 M)
          </button>
          <button onClick={() => setRegime("reel")}
            className="px-3 py-1.5 rounded text-xs" style={{ background: regime === "reel" ? "#152238" : "#F3EFE3", color: regime === "reel" ? "#fff" : "#7A7460" }}>
            Réel (bénéfice réel)
          </button>
        </div>
        <div className="mb-4">
          <label className="text-xs" style={{ color: "#8A8370" }}>Année</label>
          <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))}
            className="block border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
        </div>
        {regime !== "forfaitaire" && (
          <div className="mb-4">
            <label className="text-xs" style={{ color: "#8A8370" }}>Type de contribuable</label>
            <select value={entite} onChange={(e) => setEntite(e.target.value)} data-testid="ir-entite"
              className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
              <option value="physique">Personne physique / entreprise individuelle (barème progressif, article 132)</option>
              <option value="societe">Société (impôt sur les sociétés 30 %, article 137)</option>
              <option value="cooperative">Coopérative d'épargne et de crédit (10 %, article 137)</option>
            </select>
          </div>
        )}
        {regime !== "forfaitaire" && entite === "physique" && (
          <div className="mb-4">
            <label className="text-xs" style={{ color: "#8A8370" }}>Barème appliqué</label>
            <select value={bareme} onChange={(e) => setBaremeChoisi(e.target.value)} data-testid="ir-bareme"
              className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
              {Object.keys(IR_BAREMES).map((k) => <option key={k} value={k}>{IR_BAREMES[k].label}</option>)}
            </select>
            <p className="text-xs mt-1" style={{ color: "#A39C87" }}>Le nouveau Code fiscal est en vigueur depuis le 1er octobre 2026. Barème de l'article 132, en vigueur depuis le 1er octobre 2026. L'exercice fiscal court du 1er octobre au 30 septembre : pour un revenu qui chevauche le 1er octobre 2026, faites confirmer par votre expert-comptable le barème applicable.</p>
          </div>
        )}

        {regime === "forfaitaire" ? (
          <>
            {!eligibleForfaitaire ? (
              <div className="text-xs px-3 py-2 rounded mb-4" style={{ background: "#F7E9E3", color: "#A6432F" }}>
                Le chiffre d'affaires utilisé ({fmt(caUtilise)}) atteint le seuil de 10 000 000 HTG — cette entreprise n'est pas éligible au régime forfaitaire (article 62). Utilisez le régime "Réel" ci-dessus.
              </div>
            ) : (
              <>
            <div className="mb-4">
              <label className="text-xs" style={{ color: "#8A8370" }}>Nature de l'activité (article 65)</label>
              <select value={forfType} onChange={(e) => setForfType(e.target.value)} data-testid="forf-type"
                className="block w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                <option value="services">Prestations de services — 5 %</option>
                <option value="autres">Autres activités (vente de biens…) — 2 %</option>
              </select>
            </div>
            <div className="mb-4">
              <label className="text-xs" style={{ color: "#8A8370" }}>Chiffre d'affaires de l'exercice précédent (recettes globales)</label>
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
                  <td className="py-2 font-semibold" style={{ color: "#152238" }}>IMPÔT FORFAITAIRE À PAYER ({forfType === "services" ? "5" : "2"} %, minimum 25 000 HTG)</td>
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
            <p className="text-xs" style={{ color: "#A39C87" }}>Déclaration entre le 1er et le 31 octobre pour l'exercice précédent, et paiement au plus tard le 31 octobre (articles 64 et 66).</p>
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
            <tr style={{ borderBottom: "1px solid #F3EFE3" }}>
              <td colSpan={3}>
                <label className="text-xs" style={{ color: "#8A8370" }}>Acomptes provisionnels déjà versés pour cet exercice (article 81)</label>
              </td>
              <td className="py-1.5 text-right">
                <input type="number" min="0" value={acomptesVerses} onChange={(e) => setAcomptesVerses(e.target.value)} placeholder="0" data-testid="ir-acomptes-verses"
                  className="w-28 border rounded px-2 py-1 text-xs tabular text-right" style={{ borderColor: "#DDD6C4" }} />
              </td>
            </tr>
            <tr>
              <td className="py-2 font-semibold" colSpan={3} style={{ color: "#152238" }}>IMPÔT NET À PAYER</td>
              <td className="py-2 tabular text-right font-semibold px-3 rounded" style={{ background: "#F7E9E3", color: "#A6432F" }}>{fmt(impotNet)}</td>
            </tr>
          </tbody>
        </table></div>
            {creditAcomptes > 0 && (
              <div className="text-xs px-3 py-2 rounded mb-4" style={{ background: "#E6F1EE", color: "#0F6B5C" }} data-testid="ir-credit-acomptes">
                Les acomptes versés dépassent l'impôt de l'exercice : crédit de {fmt(creditAcomptes)} à déduire des prochains acomptes (article 81).
              </div>
            )}
            <div className="p-3 rounded mb-4" style={{ background: "#FAF8F1", border: "1px solid #EEE9DA" }} data-testid="ir-acomptes">
              <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Acomptes provisionnels à verser (article 81)</div>
              <p className="text-xs mb-2" style={{ color: "#8A8370" }}>Entreprises au bénéfice réel : 60 % de l'impôt établi pour l'avant-dernier exercice, en deux tranches égales, versées entre le 1er et le 15 octobre et entre le 1er et le 15 décembre de l'exercice qui commence le 1er octobre {year}. Cette valeur n'est pas déduite de vos écritures : saisissez l'impôt de l'avant-dernier exercice tel qu'il figure sur votre déclaration.</p>
              <label className="text-xs" style={{ color: "#8A8370" }}>Impôt établi sur le bénéfice réel de l'avant-dernier exercice</label>
              <input type="number" min="0" value={impotN2} onChange={(e) => setImpotN2(e.target.value)} placeholder="0" data-testid="ir-impot-n2"
                className="block w-48 border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
              <div className="mt-3 text-sm tabular space-y-1">
                <div className="flex justify-between"><span>Acompte annuel (60 %)</span><span data-testid="ir-acompte-annuel">{fmt(acompteAnnuel)}</span></div>
                <div className="flex justify-between"><span>Tranche 1 — du 1er au 15 octobre {year}</span><span data-testid="ir-acompte-t1">{fmt(tranche1)}</span></div>
                <div className="flex justify-between"><span>Tranche 2 — du 1er au 15 décembre {year}</span><span data-testid="ir-acompte-t2">{fmt(tranche2)}</span></div>
              </div>
            </div>
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


// Liste annuelle des versements (article 95 du Code fiscal) : chaque entreprise déclare, entre le 1er et le 31 octobre,
// les sommes versées au cours de l'exercice précédent (salaires, boni, primes, loyers, honoraires, prestations,
// intérêts…) avec les retenues à la source, en identifiant chaque bénéficiaire (nom et NIF). L'exercice fiscal va du
// 1er octobre au 30 septembre (article 69). Les salaires et primes sont lus des bulletins de paie ; les loyers,
// honoraires, prestations et intérêts sont lus des achats, selon le compte de charge utilisé.
function versementNatureDuCompte(code) {
  const c = String(code || "");
  if (c.startsWith("613")) return "Loyers";
  if (c.startsWith("622")) return "Honoraires et prestations de services";
  if (c.startsWith("66")) return "Intérêts";
  return "";
}
function VersementsAnnuelsPanel({ payslips, employees, purchases, suppliers, entries, settings }) {
  const now = new Date();
  const [mode, setMode] = useState("exercice"); // exercice (1er oct. – 30 sept.) | civile
  const [endYear, setEndYear] = useState(now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1);
  const from = mode === "exercice" ? `${endYear - 1}-10-01` : `${endYear}-01-01`;
  const to = mode === "exercice" ? `${endYear}-09-30` : `${endYear}-12-31`;
  const r2 = (x) => Math.round(x * 100) / 100;
  const rows = [];
  // Salaires, primes, boni : bulletins non annulés payés dans la période
  const parEmp = {};
  (payslips || []).filter((p) => p.status !== "annulé" && p.date && p.date >= from && p.date <= to).forEach((p) => {
    const k = String(p.employeeId);
    const emp = (employees || []).find((e) => String(e.id) === k);
    if (!parEmp[k]) parEmp[k] = { name: p.employeeName, nif: (emp && emp.nif) || "", salaire: 0, prime: 0, boni: 0, retSal: 0, retPrime: 0, retBoni: 0 };
    const bonus = Number(p.bonusAmount) || 0;
    parEmp[k].salaire += (Number(p.grossTotal) || 0) - bonus;
    if (p.bonusKind === "boni") { parEmp[k].boni += bonus; parEmp[k].retBoni += Number(p.bonusWithholding) || 0; }
    else { parEmp[k].prime += bonus; parEmp[k].retPrime += Number(p.bonusWithholding) || 0; }
    parEmp[k].retSal += Number(p.salaryWithholding) || 0;
  });
  Object.values(parEmp).forEach((e) => {
    if (e.salaire > 0) rows.push({ name: e.name, nif: e.nif, nature: "Salaires", montant: r2(e.salaire), retenue: r2(e.retSal), source: "paie" });
    if (e.prime > 0) rows.push({ name: e.name, nif: e.nif, nature: "Primes", montant: r2(e.prime), retenue: r2(e.retPrime), source: "paie" });
    if (e.boni > 0) rows.push({ name: e.name, nif: e.nif, nature: "Boni", montant: r2(e.boni), retenue: r2(e.retBoni), source: "paie" });
  });
  // Loyers, honoraires et prestations, intérêts : achats non annulés, selon le compte de charge
  const parFour = {};
  (purchases || []).filter((p) => p.status !== "annulé" && p.date && p.date >= from && p.date <= to).forEach((p) => {
    const e = (entries || []).find((x) => x.id === p.id);
    const debit = e && (e.lines || []).find((l) => Number(l.debit) > 0 && l.account !== "4456");
    const avecRet = Number(p.retenueSource) > 0;
    const nature = avecRet ? (p.retenueType === "licence" ? "Redevances (licences, marques, brevets)" : p.retenueType === "etranger" ? "Prestations payées hors d'Haïti" : "Honoraires et prestations de services") : versementNatureDuCompte(debit && debit.account);
    if (!nature) return;
    const sup = (suppliers || []).find((s) => s.name === p.supplier);
    const k = `${p.supplier}|${nature}`;
    if (!parFour[k]) parFour[k] = { name: p.supplier, nif: (sup && sup.nif) || "", nature, montant: 0, retenue: 0 };
    // Avec retenue, la fiche porte le net payé : la somme versée au sens de l'article 95 est la rémunération brute (hors taxe).
    parFour[k].montant += avecRet ? Number(p.amountHT) || 0 : Number(p.amount) || 0;
    if (avecRet) parFour[k].retenue += Number(p.retenueSource) || 0;
  });
  Object.values(parFour).forEach((f) => rows.push({ name: f.name, nif: f.nif, nature: f.nature, montant: r2(f.montant), retenue: r2(f.retenue), source: "achats" }));
  rows.sort((a, b) => a.name.localeCompare(b.name) || a.nature.localeCompare(b.nature));
  const total = r2(rows.reduce((t, r) => t + r.montant, 0));
  const totalRet = r2(rows.reduce((t, r) => t + r.retenue, 0));
  const sansNif = rows.filter((r) => !String(r.nif || "").trim()).length;
  const libelle = mode === "exercice" ? `exercice du 1er octobre ${endYear - 1} au 30 septembre ${endYear}` : `année ${endYear}`;
  const echeance = mode === "exercice" ? `1er au 31 octobre ${endYear}` : "1er au 31 octobre suivant";
  const csv = () => {
    const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const lignes = [["Bénéficiaire", "NIF", "Nature", "Montant versé", "Retenue à la source"].map(esc).join(";")]
      .concat(rows.map((r) => [r.name, r.nif, r.nature, r.montant, r.retenue].map(esc).join(";")));
    const blob = new Blob(["﻿" + lignes.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `Liste-annuelle-des-versements-${mode === "exercice" ? endYear : "civile-" + endYear}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };
  const pdf = () => {
    downloadTablePDF({
      title: `Liste annuelle des versements ${mode === "exercice" ? "exercice " + endYear : "annee " + endYear}`,
      settings,
      columns: ["Bénéficiaire", "NIF", "Nature", "Montant versé", "Retenue"],
      rows: rows.map((r) => [r.name, r.nif || "NIF manquant", r.nature, fmt(r.montant), fmt(r.retenue)]),
      footerLines: [
        `Période : ${libelle}`,
        `Total des sommes versées : ${fmt(total)} — Total des retenues : ${fmt(totalRet)}`,
        `A déposer entre le ${echeance} (article 95).`,
        settings.companyNIF ? `NIF de l'entreprise : ${settings.companyNIF}` : "NIF de l'entreprise : à renseigner dans Administration",
      ],
    });
  };
  return (
    <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
      <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Liste annuelle des versements (article 95)</div>
      <p className="text-xs mb-4" style={{ color: "#8A8370" }}>
        Chaque entreprise déclare, entre le 1er et le 31 octobre, les sommes versées durant l'exercice précédent (salaires, boni, primes, loyers, honoraires, prestations, intérêts…) avec les retenues à la source, en identifiant chaque bénéficiaire (nom et NIF). Salaires et primes viennent des bulletins de paie ; loyers, honoraires et prestations, intérêts viennent des achats d'après le compte de charge (613, 622, 66). Les dividendes, commissions, jetons de présence et autres versements ne sont pas calculés : ajoutez-les à la main sur le formulaire. Les retenues des articles 96 et 97 saisies dans Achats sont reprises avec leur retenue.
      </p>
      <FiscalValidationNotice />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <div>
          <label className="text-xs" style={{ color: "#8A8370" }}>Période</label>
          <select value={mode} onChange={(e) => setMode(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} data-testid="versements-mode">
            <option value="exercice">Exercice fiscal (1er octobre – 30 septembre, article 69)</option>
            <option value="civile">Année civile</option>
          </select>
        </div>
        <div>
          <label className="text-xs" style={{ color: "#8A8370" }}>{mode === "exercice" ? "Exercice se terminant le 30 septembre" : "Année"}</label>
          <input type="number" value={endYear} onChange={(e) => setEndYear(Number(e.target.value))} className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} data-testid="versements-annee" />
        </div>
      </div>
      <div className="text-xs mb-3" style={{ color: "#7A7460" }}>Période couverte : {libelle}. À déposer entre le {echeance}.</div>
      {sansNif > 0 && (
        <div className="text-xs px-3 py-2 rounded mb-3" style={{ background: "#FBF1DC", color: "#9A7B1E" }} data-testid="versements-sans-nif">
          {sansNif} ligne{sansNif > 1 ? "s" : ""} sans NIF : l'article 95 exige d'identifier chaque bénéficiaire. Renseignez le NIF dans la fiche employé (Salaires) ou la fiche fournisseur (Achats).
        </div>
      )}
      {rows.length === 0 ? (
        <div className="text-sm py-6 text-center" style={{ color: "#A39C87" }} data-testid="versements-vide">Aucun versement à déclarer sur cette période.</div>
      ) : (
        <div className="overflow-x-auto mb-4"><table className="w-full text-sm">
          <thead><tr className="text-left text-xs" style={{ color: "#8A8370", borderBottom: "1px solid #E4DFD1" }}>
            <th className="py-2 font-normal">Bénéficiaire</th><th className="py-2 font-normal">NIF</th><th className="py-2 font-normal">Nature</th>
            <th className="py-2 font-normal text-right">Montant versé</th><th className="py-2 font-normal text-right">Retenue</th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} data-testid="versements-ligne" style={{ borderBottom: "1px solid #F3EFE3" }}>
                <td className="py-1.5">{r.name}</td>
                <td className="py-1.5 text-xs">{r.nif || <span style={{ color: "#A6432F" }}>manquant</span>}</td>
                <td className="py-1.5 text-xs">{r.nature}</td>
                <td className="py-1.5 tabular text-right">{fmt(r.montant)}</td>
                <td className="py-1.5 tabular text-right">{fmt(r.retenue)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      <div className="p-3 rounded mb-4" style={{ background: "#F7E9E3" }}>
        <div className="flex justify-between text-sm tabular"><span>Total des sommes versées</span><span data-testid="versements-total">{fmt(total)}</span></div>
        <div className="flex justify-between text-sm tabular"><span>Total des retenues à la source</span><span data-testid="versements-retenues">{fmt(totalRet)}</span></div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={pdf} disabled={rows.length === 0} className="px-4 py-2 rounded text-sm text-white" style={{ background: "#152238", opacity: rows.length === 0 ? 0.5 : 1 }} data-testid="versements-pdf">Télécharger (.pdf)</button>
        <button onClick={csv} disabled={rows.length === 0} className="px-4 py-2 rounded text-sm" style={{ background: "#EFE9DD", color: "#152238", opacity: rows.length === 0 ? 0.5 : 1 }} data-testid="versements-csv">Télécharger (.csv)</button>
      </div>
    </div>
  );
}

// Calendrier fiscal : toutes les échéances au même endroit, avec leur source. Lecture seule (aucun calcul, aucune écriture).
// Les dates « Code fiscal » sont celles déjà utilisées par les autres écrans de l'application (nouveau Code fiscal en vigueur
// depuis le 1er octobre 2026). Les dates « site DGI » viennent de pages publiques parfois antérieures au nouveau Code : à confirmer.
function CalendrierFiscalPanel({ today }) {
  const t = String(today || new Date().toISOString().slice(0, 10));
  const y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
  const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const iso = (an, mo, jo) => an + "-" + String(mo).padStart(2, "0") + "-" + String(jo).padStart(2, "0");
  const fr = (d) => { const [a, b, c] = d.split("-"); return Number(c) + (Number(c) === 1 ? "er " : " ") + MOIS[Number(b) - 1] + " " + a; };
  const suivant = m === 12 ? [y + 1, 1] : [y, m + 1];
  const mensuelles = [
    ["Retenues sur salaires, primes et boni (état explicatif mensuel)", "Du 1er au 15 " + MOIS[suivant[1] - 1] + " " + suivant[0], iso(suivant[0], suivant[1], 15), "Code fiscal, art. 100 et 103 · Salaires RH", "code"],
    ["Retenues sur prestataires (honoraires, loyers, prestations)", "Du 1er au 15 " + MOIS[suivant[1] - 1] + " " + suivant[0], iso(suivant[0], suivant[1], 15), "Code fiscal, art. 96 et 97 · Retenues sur prestations", "code"],
    ["Déclaration de la TCA du mois (hors franchise)", "Du 1er au 15 " + MOIS[suivant[1] - 1] + " " + suivant[0], iso(suivant[0], suivant[1], 15), "Code fiscal, art. 186 et 190 · Déclaration TCA", "code"],
  ];
  const an = (mo, jo) => { const d = iso(y, mo, jo); return d >= t ? d : iso(y + 1, mo, jo); };
  const annuelles = [
    ["Liste des employés assujettis aux retenues sur salaires", "30 septembre", an(9, 30), "Site DGI (« Les retenues à la source ») : à confirmer avec le nouveau Code", "dgi"],
    ["Liste annuelle des versements (bénéficiaires et sommes versées)", "Du 1er au 31 octobre", an(10, 31), "Code fiscal, art. 95 · Liste annuelle des versements", "code"],
    ["Impôt des entreprises : déclaration et paiement", "Du 1er au 31 octobre", an(10, 31), "Code fiscal, art. 64 et 66 · Impôt sur le Revenu", "code"],
    ["Acomptes provisionnels, 1re tranche", "Du 1er au 15 octobre", an(10, 15), "Code fiscal, art. 81 · Impôt sur le Revenu", "code"],
    ["Acomptes provisionnels, 2e tranche", "Du 1er au 15 décembre", an(12, 15), "Code fiscal, art. 81 · Impôt sur le Revenu", "code"],
    ["Déclaration définitive de l'impôt sur le revenu des personnes (salariés, professionnels)", "Du 1er octobre au 31 janvier", an(1, 31), "Site DGI et avis de la DGI : à confirmer avec votre expert-comptable", "dgi"],
  ].sort((a, b) => a[2].localeCompare(b[2]));
  const jours = (d) => Math.round((new Date(d + "T12:00:00") - new Date(t + "T12:00:00")) / 86400000);
  const ligne = (r, i) => (<div key={i} data-testid="cal-ligne" className="py-2" style={{ borderTop: i > 0 ? "1px solid #F3EFE3" : "none" }}>
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
      <div className="text-sm" style={{ color: "#152238", flex: "1 1 220px", minWidth: 0, overflowWrap: "anywhere" }}>{r[0]}</div>
      <div className="text-xs" style={{ color: jours(r[2]) <= 7 ? "#A6432F" : "#152238", fontWeight: jours(r[2]) <= 7 ? 700 : 500 }}>{jours(r[2]) === 0 ? "aujourd'hui" : "dans " + jours(r[2]) + " j"}</div>
    </div>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
      <span className="text-xs" style={{ color: "#5B563F" }}>{r[1]}</span>
      <span className="text-xs" style={{ color: r[4] === "code" ? "#0F6B5C" : "#9A7B1E", fontWeight: 600 }}>{r[4] === "code" ? "Code fiscal" : "À confirmer"}</span>
    </div>
    <div className="text-xs mt-0.5" style={{ color: "#8A8370", overflowWrap: "anywhere" }}>{r[3]}</div></div>);
  const prochaines = annuelles.filter((r) => jours(r[2]) <= 45);
  return (
    <div data-testid="calendrier-fiscal">
      <div className="ec-card p-4 mb-4">
        <div className="display text-base mb-1" style={{ color: "#152238" }}>Calendrier fiscal</div>
        <p className="text-xs" style={{ color: "#8A8370" }}>Toutes les échéances au même endroit. Les lignes « Code fiscal » suivent le nouveau Code en vigueur depuis le 1er octobre 2026 (celui que l'application applique déjà). Les lignes « À confirmer » viennent de pages publiques de la DGI qui peuvent dater de l'ancien Code : vérifiez-les avec votre expert-comptable avant de vous y fier. Cet écran ne calcule rien et ne modifie rien.</p>
        {prochaines.length > 0 && (<div className="px-3 py-2 rounded mt-3 text-sm" style={{ background: "#FBF1DC", color: "#152238", overflowWrap: "anywhere" }} data-testid="cal-proches"><b>À venir dans les 45 jours :</b> {prochaines.map((r) => r[0].split(" (")[0] + " (" + r[1].toLowerCase() + ")").join(" · ")}</div>)}
      </div>
      <div className="ec-card p-4 mb-4">
        <div className="display text-base mb-1" style={{ color: "#152238" }}>Chaque mois</div>
        <div>{mensuelles.map(ligne)}</div>
      </div>
      <div className="ec-card p-4 mb-4">
        <div className="display text-base mb-1" style={{ color: "#152238" }}>Chaque année</div>
        <div data-testid="cal-annuelles">{annuelles.map(ligne)}</div>
      </div>
      <div className="ec-card p-4 text-xs" style={{ color: "#5B563F", overflowWrap: "anywhere" }} data-testid="cal-rappels">
        <b>À savoir.</b> Les documents de paiement (versements, états explicatifs, registre du personnel) se gardent 5 ans et se présentent à tout contrôle. L'employeur remet à chaque employé une attestation des retenues faites. Un retard de plus de 30 jours entraîne des intérêts, et le retard de la liste annuelle des versements une pénalité par mois : les montants exacts du nouveau Code sont à demander à votre expert-comptable.
      </div>
    </div>
  );
}

// Retenues à la source sur les rémunérations de prestataires (articles 96 et 97) : état mensuel à verser à la DGI,
// entre le 1er et le 15 du mois qui suit celui du paiement. Lu des achats enregistrés avec une retenue.
function RetenuesPrestationsPanel({ purchases, suppliers, settings }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const mm = String(month).padStart(2, "0");
  const pref = `${year}-${mm}`;
  const rows = (purchases || []).filter((p) => p.status !== "annulé" && Number(p.retenueSource) > 0 && String(p.date || "").startsWith(pref))
    .map((p) => {
      const sup = (suppliers || []).find((s) => s.name === p.supplier);
      const nature = p.retenueType === "licence" ? "Licence / marque / brevet (art. 96-2)" : p.retenueType === "etranger" ? "Bénéficiaire hors d'Haïti (art. 97)" : "Prestation de services (art. 96)";
      return { date: p.date, name: p.supplier, nif: (sup && sup.nif) || "", nature, base: Number(p.amountHT) || 0, rate: p.retenueRate, retenue: Number(p.retenueSource) || 0, libre: p.retenueType === "etranger" };
    }).sort((a, b) => a.date.localeCompare(b.date));
  const total = Math.round(rows.reduce((t, r) => t + r.retenue, 0) * 100) / 100;
  const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const nextM = month === 12 ? 0 : month, nextY = month === 12 ? year + 1 : year;
  const echeance = `1er au 15 ${MOIS[nextM]} ${nextY}`;
  const pdf = () => downloadTablePDF({
    title: `Retenues sur prestations ${MOIS[month - 1]} ${year}`,
    settings,
    columns: ["Date", "Bénéficiaire", "NIF", "Nature", "Base", "Taux", "Retenue"],
    rows: rows.map((r) => [r.date, r.name, r.nif || "NIF manquant", r.nature, fmt(r.base), `${r.rate} %`, fmt(r.retenue)]),
    footerLines: [`Total à verser à la DGI : ${fmt(total)}`, `A verser entre le ${echeance} (articles 96 et 97).`, settings.companyNIF ? `NIF de l'entreprise : ${settings.companyNIF}` : "NIF de l'entreprise : à renseigner dans Administration"],
  });
  return (
    <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
      <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Retenues sur prestations de services (articles 96 et 97)</div>
      <p className="text-xs mb-4" style={{ color: "#8A8370" }}>
        Retenues prélevées sur la rémunération de prestataires non soumis aux états financiers (10 %, ou 20 % pour licences, marques et brevets) et de bénéficiaires hors d'Haïti (20 %, retenue libératoire). Elles se saisissent dans Achats et sont reprises ici pour le versement à la DGI.
      </p>
      <FiscalValidationNotice />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div>
          <label className="text-xs" style={{ color: "#8A8370" }}>Mois du paiement</label>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} data-testid="retprest-mois">
            {MOIS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs" style={{ color: "#8A8370" }}>Année</label>
          <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} data-testid="retprest-annee" />
        </div>
      </div>
      <div className="text-xs mb-3" style={{ color: "#7A7460" }}>À verser entre le {echeance}.</div>
      {rows.length === 0 ? (
        <div className="text-sm py-6 text-center" style={{ color: "#A39C87" }} data-testid="retprest-vide">Aucune retenue sur prestation ce mois-ci.</div>
      ) : (
        <div className="overflow-x-auto mb-4"><table className="w-full text-sm">
          <thead><tr className="text-left text-xs" style={{ color: "#8A8370", borderBottom: "1px solid #E4DFD1" }}>
            <th className="py-2 font-normal">Date</th><th className="py-2 font-normal">Bénéficiaire</th><th className="py-2 font-normal">Nature</th>
            <th className="py-2 font-normal text-right">Base</th><th className="py-2 font-normal text-right">Taux</th><th className="py-2 font-normal text-right">Retenue</th>
          </tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i} data-testid="retprest-ligne" style={{ borderBottom: "1px solid #F3EFE3" }}>
              <td className="py-1.5 text-xs">{r.date}</td><td className="py-1.5">{r.name}</td><td className="py-1.5 text-xs">{r.nature}</td>
              <td className="py-1.5 tabular text-right">{fmt(r.base)}</td><td className="py-1.5 tabular text-right">{r.rate} %</td><td className="py-1.5 tabular text-right">{fmt(r.retenue)}</td>
            </tr>))}</tbody>
        </table></div>
      )}
      <div className="p-3 rounded mb-4" style={{ background: "#F7E9E3" }}>
        <div className="flex justify-between text-sm tabular"><span>Total à verser à la DGI</span><span data-testid="retprest-total">{fmt(total)}</span></div>
      </div>
      <button onClick={pdf} disabled={rows.length === 0} className="px-4 py-2 rounded text-sm text-white" style={{ background: "#152238", opacity: rows.length === 0 ? 0.5 : 1 }} data-testid="retprest-pdf">Télécharger l'état (.pdf)</button>
    </div>
  );
}
