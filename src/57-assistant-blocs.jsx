// ═══ MODULE ═══
// @module Assistant blocs
// @depends —
// @exports asstHowToBlocs, asstScanBlocs
// ═══ FIN DE L'EN-TÊTE ═══
// Assistant de contrôle (forfaits Assisté et Extension) — contrôles propres à chaque bloc d'activité.
// Même principe que l'assistant du journal : il DÉTECTE et EXPLIQUE (cause + solution pas à pas) ; il ne modifie jamais rien tout seul.
// Aucun de ces points n'a de correction automatique : chacun demande un jugement humain (pièce, accord du client, décision de gestion).
// Éducation : élève sans frais, impayés anciens. Import-export : marchandise au port, dossier non réglé, taux inhabituel.
// Santé : assureur en retard, lot périmé ou proche de la péremption, honoraires non versés.

const asbR2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const asbG = (n) => asbR2(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " G";
const asbUsd = (n) => asbR2(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " USD";
const asbDays = (a, b) => Math.round((new Date(String(b).slice(0, 10) + "T12:00:00") - new Date(String(a).slice(0, 10) + "T12:00:00")) / 86400000);
const asbAdd = (iso, n) => { const d = new Date(String(iso).slice(0, 10) + "T12:00:00"); d.setDate(d.getDate() + n); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const asbFr = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); return m ? m[3] + "/" + m[2] + "/" + m[1] : String(iso || ""); };
const asbRows = (list, type) => (list || []).filter((r) => r && r.type === type);

function asstScanBlocs({ ecole, impex, sante, actifs, today }) {
  const out = [];
  const A = actifs || [];
  const push = (f) => out.push({ fix: null, ...f });
  if (!today) return out;

  // ───── Éducation ─────
  if (A.includes("ecoles") && (ecole || []).length) {
    const frais = asbRows(ecole, "fee");
    const charges = asbRows(ecole, "charge").filter((c) => c.status !== "annulée");
    const familles = new Map(asbRows(ecole, "family").map((f) => [f.id, f.name]));
    if (frais.length) {
      const avecFrais = new Set(charges.map((c) => c.studentId));
      asbRows(ecole, "student").filter((s) => s.status === "actif" && !avecFrais.has(s.id)).slice(0, 25).forEach((s) => {
        push({ key: "ecole-sansfrais:" + s.id, severity: "medium", category: "ecole", title: "Élève sans aucun frais", detail: `${s.firstName || ""} ${s.lastName || ""} (matricule ${s.matricule || "?"}) est inscrit et actif, mais aucune échéance de frais n'a été créée pour lui : rien ne lui sera facturé.` });
      });
    }
    const limite = asbAdd(today, -60);
    const parFamille = {};
    charges.filter((c) => c.dueDate && c.dueDate < limite && asbR2((Number(c.amount) || 0) - (Number(c.paid) || 0)) > 0.005).forEach((c) => { (parFamille[c.familyId] = parFamille[c.familyId] || []).push(c); });
    Object.entries(parFamille).forEach(([fid, list]) => {
      const total = asbR2(list.reduce((s, c) => s + (Number(c.amount) || 0) - (Number(c.paid) || 0), 0));
      const plus = list.map((c) => c.dueDate).sort()[0];
      const jours = asbDays(plus, today);
      push({ key: "ecole-impaye:" + fid, severity: jours > 90 ? "high" : "medium", category: "ecole", title: "Frais impayés depuis plus de 60 jours",
        detail: `${familles.get(fid) || "Famille"} : ${list.length} échéance(s) impayée(s) pour ${asbG(total)}. La plus ancienne était due le ${asbFr(plus)} (${jours} jours).` });
    });
  }

  // ───── Import-export ─────
  if (A.includes("import_export") && (impex || []).length) {
    const imps = asbRows(impex, "imp"), exps = asbRows(impex, "exp");
    const nom = (d) => d.number || "dossier";
    imps.filter((d) => d.status === "port" && d.portDate).forEach((d) => {
      const j = asbDays(d.portDate, today);
      if (j > 7) push({ key: "impex-port:" + d.id, severity: j > 21 ? "high" : "medium", category: "impex", title: "Marchandise au port depuis longtemps", detail: `Importation ${nom(d)} (${d.supplier || "fournisseur ?"}) : arrivée au port le ${asbFr(d.portDate)}, soit ${j} jours sans dédouanement. Des frais de magasinage et de surestaries s'accumulent.` });
    });
    imps.filter((d) => d.status === "livre" && d.invoiceEntryId && d.date && asbDays(d.date, today) > 60).forEach((d) => {
      const total = asbR2((d.lines || []).reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitUSD) || 0), 0) + (Number(d.freightUSD) || 0) + (Number(d.insuranceUSD) || 0));
      const paye = asbR2((d.payments || []).filter((p) => p.status !== "annulé").reduce((s, p) => s + (Number(p.usd) || 0), 0));
      const reste = asbR2(total - paye);
      if (reste > 0.005) push({ key: "impex-impaye:" + d.id, severity: "medium", category: "impex", title: "Fournisseur non soldé après livraison", detail: `Importation ${nom(d)} (${d.supplier || "fournisseur ?"}) : marchandise livrée en stock, mais il reste ${asbUsd(reste)} à payer sur ${asbUsd(total)}. Dossier ouvert depuis le ${asbFr(d.date)}.` });
    });
    exps.filter((d) => (d.status === "livre" || d.status === "expedie") && d.invoiceEntryId && d.date && asbDays(d.date, today) > 45).forEach((d) => {
      const totalUSD = asbR2((d.lines || []).reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitUSD) || 0), 0));
      const recu = asbR2((d.receipts || []).filter((r) => r.status !== "annulé").reduce((s, r) => s + (Number(r.usd) || 0), 0));
      const reste = asbR2(totalUSD - recu);
      if (reste > 0.005) push({ key: "impex-recev:" + d.id, severity: asbDays(d.date, today) > 90 ? "high" : "medium", category: "impex", title: "Client étranger n'a pas tout payé", detail: `Exportation ${nom(d)} (${d.customer || "client ?"}) : il reste ${asbUsd(reste)} à recevoir. Dossier ouvert depuis le ${asbFr(d.date)} (${asbDays(d.date, today)} jours).` });
    });
    const taux = [...imps, ...exps].map((d) => Number(d.rate) || 0).filter((x) => x > 0).sort((a, b) => a - b);
    const med = taux.length >= 3 ? taux[Math.floor(taux.length / 2)] : 0;
    [...imps, ...exps].forEach((d) => {
      const r = Number(d.rate) || 0;
      if (r <= 0) push({ key: "impex-taux:" + d.id, severity: "high", category: "impex", title: "Taux de change manquant", detail: `Dossier ${nom(d)} : aucun taux dollar → gourde n'est indiqué. Les montants en gourdes sont donc faux.` });
      else if (med > 0 && Math.abs(r - med) / med > 0.15) push({ key: "impex-taux:" + d.id, severity: "medium", category: "impex", title: "Taux de change inhabituel", detail: `Dossier ${nom(d)} : taux ${r} alors que vos dossiers sont le plus souvent autour de ${med} (écart de plus de 15 %). Faute de frappe possible (virgule, chiffre en trop).` });
    });
  }

  // ───── Santé ─────
  if (A.includes("sante") && (sante || []).length) {
    const factures = asbRows(sante, "invoice").filter((i) => i.status !== "annulee");
    const assureurs = new Map(asbRows(sante, "insurer").map((a) => [a.id, a.name]));
    const praticiens = new Map(asbRows(sante, "practitioner").map((p) => [p.id, p.name]));
    const okSum = (arr) => asbR2((arr || []).filter((x) => x.status !== "annulé").reduce((s, x) => s + (Number(x.amount) || 0), 0));
    const parAss = {};
    factures.filter((i) => i.insurerId && Number(i.insurerAmount) > 0 && i.date && asbDays(i.date, today) > 45).forEach((i) => {
      const rejet = asbR2((i.adjusts || []).filter((x) => x.kind === "rejet").reduce((s, x) => s + (Number(x.amount) || 0), 0));
      const report = asbR2((i.adjusts || []).filter((x) => x.kind === "report").reduce((s, x) => s + (Number(x.amount) || 0), 0));
      const reste = asbR2((Number(i.insurerAmount) || 0) - okSum(i.claims) - rejet - report);
      if (reste > 0.5) (parAss[i.insurerId] = parAss[i.insurerId] || []).push({ i, reste });
    });
    Object.entries(parAss).forEach(([id, list]) => {
      const total = asbR2(list.reduce((s, x) => s + x.reste, 0));
      const plus = list.map((x) => x.i.date).sort()[0];
      const jours = asbDays(plus, today);
      push({ key: "sante-assureur:" + id, severity: jours > 90 ? "high" : "medium", category: "sante", title: "Assureur en retard de remboursement", detail: `${assureurs.get(id) || "Assureur"} vous doit ${asbG(total)} sur ${list.length} facture(s) de plus de 45 jours. La plus ancienne date du ${asbFr(plus)} (${jours} jours).` });
    });
    asbRows(sante, "lot").filter((l) => Number(l.qty) > 0 && l.expiry).forEach((l) => {
      const j = asbDays(today, l.expiry);
      if (j < 0) push({ key: "sante-lot-perime:" + l.id, severity: "high", category: "sante", title: "Lot de médicaments périmé", detail: `${l.name || "Produit"} — lot ${l.lot || "?"} : périmé depuis le ${asbFr(l.expiry)} (${-j} jours), ${l.qty} unité(s) enregistrée(s). Ne doit plus être vendu.` });
      else if (j <= 30) push({ key: "sante-lot-proche:" + l.id, severity: "medium", category: "sante", title: "Lot proche de la péremption", detail: `${l.name || "Produit"} — lot ${l.lot || "?"} : expire le ${asbFr(l.expiry)} (dans ${j} jour(s)), ${l.qty} unité(s).` });
    });
    const dus = {};
    factures.filter((i) => i.practitionerId !== undefined && i.practitionerId && Number(i.honoraires) > 0 && i.date).forEach((i) => { const o = dus[i.practitionerId] = dus[i.practitionerId] || { du: 0, plus: i.date }; o.du += Number(i.honoraires) || 0; if (i.date < o.plus) o.plus = i.date; });
    Object.entries(dus).forEach(([id, o]) => {
      const verse = asbR2(asbRows(sante, "payout").filter((p) => p.practitionerId === id && p.status !== "annulé").reduce((s, p) => s + (Number(p.amount) || 0), 0));
      const reste = asbR2(o.du - verse);
      if (reste > 0.5 && asbDays(o.plus, today) > 30) push({ key: "sante-hono:" + id, severity: "medium", category: "sante", title: "Honoraires non versés au praticien", detail: `${praticiens.get(id) || "Praticien"} : ${asbG(reste)} d'honoraires à reverser (total dû ${asbG(o.du)}, déjà versé ${asbG(verse)}). Le plus ancien remonte au ${asbFr(o.plus)}.` });
    });
  }
  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || String(a.key).localeCompare(String(b.key)));
}

// Guide « Comment corriger » : cause et étapes pour chaque point des blocs. Renvoie null si le point n'est pas d'un bloc.
function asstHowToBlocs(f) {
  const rule = String((f && f.key) || "").split(":")[0];
  const G = {
    "ecole-sansfrais": { why: "Un élève actif sans échéance ne reçoit aucune facture : la scolarité n'est jamais encaissée ni comptabilisée.", steps: [
      "Ouvrez l'espace Éducation → onglet « Frais » et vérifiez qu'une grille de frais existe pour l'année de cet élève et qu'elle est cochée pour sa classe.",
      "Si la classe n'est pas cochée, cochez-la dans la grille : les échéances se créent pour les élèves concernés.",
      "Si l'élève est vraiment dispensé (bourse, enfant du personnel), enregistrez une bourse dans l'onglet « Bourses et rabais » pour garder la trace de la décision.",
      "S'il n'est plus dans l'établissement, changez son statut (sorti ou renvoyé) pour qu'il ne soit plus compté actif.",
      "Si c'est normal, cliquez sur « Ignorer »."] },
    "ecole-impaye": { why: "Une dette scolaire ancienne a de moins en moins de chances d’être payée, et elle gonfle vos créances (compte 4111).", steps: [
      "Ouvrez l'espace Éducation → onglet « Impayés et relances » et retrouvez la famille indiquée.",
      "Envoyez la relance (message ou lettre) et notez la date.",
      "Si la famille a payé sans que ce soit enregistré, saisissez l'encaissement dans l'onglet « Encaissements » (le reçu sera numéroté).",
      "Si un arrangement est convenu, notez-le et fixez une date ; si le montant est irrécouvrable, parlez-en à votre comptable avant toute décision.",
      "Si c'est normal, cliquez sur « Ignorer »."] },
    "impex-port": { why: "Chaque jour au port coûte (magasinage, surestaries) et ces frais augmentent le coût de revient de la marchandise.", steps: [
      "Ouvrez l'espace Import-export, ouvrez le dossier d'importation indiqué et regardez la section des documents : lesquels manquent ?",
      "Contactez votre transitaire pour savoir ce qui bloque le dédouanement (document, paiement des droits, vérification).",
      "Quand la marchandise est dédouanée, passez l'étape du dossier à « Dédouané », puis ajoutez les frais réels (droits, magasinage, surestaries) dans le dossier.",
      "Si la marchandise est déjà sortie du port, mettez simplement l'étape à jour.",
      "Si le retard est connu et voulu, cliquez sur « Ignorer »."] },
    "impex-impaye": { why: "Une marchandise livrée mais non payée est une dette envers le fournisseur qui peut bloquer vos prochaines commandes.", steps: [
      "Ouvrez le dossier d'importation indiqué et vérifiez la section des règlements.",
      "Si le paiement a été fait, enregistrez-le dans le dossier (date, montant en dollars, taux utilisé) ; l'écart de change sera calculé tout seul.",
      "Sinon, prévoyez le paiement ou convenez d'un délai avec le fournisseur.",
      "Si la facture du fournisseur contenait une erreur, faites corriger la facture avant de payer."] },
    "impex-recev": { why: "Un client étranger qui tarde à payer immobilise votre trésorerie, et le risque d'impayé grandit avec le temps.", steps: [
      "Ouvrez le dossier d'exportation indiqué et vérifiez la section des encaissements.",
      "Si le client a payé, enregistrez l'encaissement (date, montant en dollars, taux) ; sinon, relancez-le avec la facture et le connaissement.",
      "Si la différence vient de frais bancaires prélevés sur le virement, enregistrez-les en frais plutôt que de laisser un reste.",
      "Quand tout est reçu, passez le dossier à « Soldé »."] },
    "impex-taux": { why: "Le taux sert à convertir chaque facture en gourdes : un taux faux fausse le coût de revient, les marges et la comptabilité.", steps: [
      "Ouvrez le dossier indiqué et regardez le champ du taux (gourdes pour 1 dollar).",
      "Comparez avec le taux réellement appliqué par votre banque ou votre fournisseur de change le jour de l'opération.",
      "Si c'est une faute de frappe, corrigez le taux dans le dossier tant qu'aucune écriture n'est passée ; sinon, demandez à votre comptable comment régulariser.",
      "Si le taux est exact (opération à un taux très différent), cliquez sur « Ignorer »."] },
    "sante-assureur": { why: "Tant que l'assureur n'a pas remboursé sa part, vous avancez l'argent ; au-delà de 45 jours, le risque de rejet ou d'oubli augmente.", steps: [
      "Ouvrez l'espace Santé → onglet « Factures » et filtrez les factures de cet assureur : repérez celles dont la part assureur reste à recevoir.",
      "Envoyez-lui le relevé des factures en attente et demandez la date de paiement.",
      "Si l'assureur a payé, enregistrez le remboursement sur la facture concernée (onglet « Assureurs » ou sur la facture).",
      "Si l'assureur refuse une partie, utilisez « Rejet » avec le motif : soit reporté sur le patient, soit constaté en perte.",
      "Parlez-en à votre comptable pour les rejets importants."] },
    "sante-lot-perime": { why: "Un médicament périmé ne doit jamais être délivré : risque pour le patient et responsabilité de la pharmacie.", steps: [
      "Retirez physiquement le lot des rayons dès aujourd'hui et isolez-le.",
      "Contactez votre fournisseur : certains reprennent les produits proches de la péremption ou délivrent un avoir.",
      "Dans l'espace Santé → « Lots et péremptions », notez la mise au rebut ; ajustez le stock dans le module Stock (sortie pour péremption) pour que le stock comptable soit juste.",
      "Pour éviter que cela se reproduise, vérifiez chaque mois les lots qui expirent dans les 90 jours."] },
    "sante-lot-proche": { why: "Un lot qui expire bientôt doit être vendu en priorité ou retourné au fournisseur avant de devenir une perte.", steps: [
      "Placez le lot devant dans les rayons (le plus ancien d'abord).",
      "Proposez-le en priorité à la vente, ou contactez le fournisseur pour un retour ou un échange.",
      "Dans « Lots et péremptions », suivez la quantité restante."] },
    "sante-hono": { why: "Les honoraires sont dus aux praticiens à chaque facture ; un retard crée des tensions et fausse le compte 4678.", steps: [
      "Ouvrez l'espace Santé → onglet « Praticiens » et regardez le montant à reverser pour ce praticien.",
      "Cliquez pour verser les honoraires (date, mode de paiement) : l'écriture comptable est passée automatiquement.",
      "Si un versement a déjà été fait hors de l'application, enregistrez-le de la même façon pour que le solde soit juste.",
      "Si la part (%) du praticien est contestée, corrigez-la avant de verser."] },
  };
  const g = G[rule];
  return g ? { why: g.why, steps: g.steps } : null;
}
