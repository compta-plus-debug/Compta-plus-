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
  const impotNet = Math.max(0, impot - retenuesNum);

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

