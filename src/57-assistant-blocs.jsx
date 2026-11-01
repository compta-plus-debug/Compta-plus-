// ═══ MODULE ═══
// @module Assistant blocs
// @depends Plus
// @exports asstHowToBlocs, asstScanBlocs
// ═══ FIN DE L'EN-TÊTE ═══
// Assistant de contrôle (forfaits Assisté et Extension) — contrôles propres à chaque bloc d'activité.
// Même principe que l'assistant du journal : il DÉTECTE et EXPLIQUE (cause + solution pas à pas) ; il ne modifie jamais rien tout seul.
// Aucun de ces points n'a de correction automatique : chacun demande un jugement humain (pièce, accord du client, décision de gestion).
// Éducation : élève sans frais, impayés anciens, échéances échues jamais constatées. Import-export : marchandise au port, dossier non réglé, taux inhabituel.
// Restauration : plat sans recette, plat peu rentable, commande restée ouverte, service non reversé.
// Hôtellerie : client attendu ni arrivé ni annulé, séjour dépassé sans départ.
// Santé : assureur en retard, lot périmé ou proche de la péremption, honoraires non versés.

const asbR2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const asbG = (n) => asbR2(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " G";
const asbUsd = (n) => asbR2(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " USD";
const asbDays = (a, b) => Math.round((new Date(String(b).slice(0, 10) + "T12:00:00") - new Date(String(a).slice(0, 10) + "T12:00:00")) / 86400000);
const asbAdd = (iso, n) => { const d = new Date(String(iso).slice(0, 10) + "T12:00:00"); d.setDate(d.getDate() + n); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const asbFr = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); return m ? m[3] + "/" + m[2] + "/" + m[1] : String(iso || ""); };
const asbRows = (list, type) => (list || []).filter((r) => r && r.type === type);

function asstScanBlocs({ ecole, impex, sante, resto, hotel, transport, immo, btp, indus, agri, products, actifs, today }) {
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
    const nonConst = charges.filter((c) => !c.recognized && c.dueDate && c.dueDate < asbAdd(today, -30));
    if (nonConst.length) push({ key: "ecole-constater:all", severity: "medium", category: "ecole", title: "Échéances échues jamais constatées en comptabilité", detail: `${nonConst.length} échéance(s) (${asbG(nonConst.reduce((s, c) => s + (Number(c.amount) || 0), 0))}) sont échues depuis plus de 30 jours sans avoir été constatées : les frais scolaires ne figurent pas encore dans vos comptes (compte 4111 et produits).` });
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

  // ───── Restauration ─────
  if (A.includes("restauration") && (resto || []).length) {
    const plats = asbRows(resto, "dish").filter((d) => d.active !== false);
    const march = (products || []).filter((p) => p.type === "marchandise");
    plats.forEach((d) => {
      const rec = d.recipe || [];
      if (!rec.length) { push({ key: "resto-recette:" + d.id, severity: "low", category: "resto", title: "Plat sans fiche recette", detail: `« ${d.name} » est au menu à ${asbG(d.price)}, mais sans recette : son coût et sa marge sont inconnus, et ses ingrédients ne sortent pas du stock quand il est vendu.` }); return; }
      const cout = asbR2(rec.reduce((sum, r) => sum + (Number(r.qty) || 0) * (Number((march.find((p) => String(p.id) === String(r.productId)) || {}).costPrice) || 0), 0));
      if (cout > 0 && Number(d.price) > 0 && cout / Number(d.price) > 0.7) push({ key: "resto-marge:" + d.id, severity: "medium", category: "resto", title: "Plat peu rentable", detail: `« ${d.name} » : coût ${asbG(cout)} pour un prix de ${asbG(d.price)}, soit ${Math.round(cout / d.price * 100)} % du prix (marge de ${Math.round((1 - cout / d.price) * 100)} %). Au-delà de 70 %, il reste très peu pour couvrir salaires, loyer et charges.` });
    });
    asbRows(resto, "order").filter((o) => o.status === "ouverte" && o.date && asbDays(o.date, today) >= 1).slice(0, 25).forEach((o) => {
      push({ key: "resto-ouverte:" + o.id, severity: "medium", category: "resto", title: "Commande restée ouverte", detail: `La commande ${o.number} ouverte le ${asbFr(o.date)} n'a jamais été encaissée ni annulée (${asbDays(o.date, today)} jour(s)) : elle n'est pas comptabilisée.` });
    });
    const payees = asbRows(resto, "order").filter((o) => o.status === "payee" && ((Number(o.service) || 0) + (Number(o.tip) || 0)) > 0);
    const paiements = asbRows(resto, "payout").filter((p) => p.status !== "annulé");
    const reparties = new Set(paiements.flatMap((p) => p.orderIds || []));
    const attente = payees.filter((o) => !reparties.has(o.id));
    const du = asbR2(attente.reduce((sum, o) => sum + (Number(o.service) || 0) + (Number(o.tip) || 0), 0));
    if (du > 0.5) {
      const plus = attente.map((o) => o.paidDate).filter(Boolean).sort()[0];
      if (plus && asbDays(plus, today) > 30) push({ key: "resto-service:pool", severity: "medium", category: "resto", title: "Service non reversé au personnel", detail: `${asbG(du)} de service et de pourboires encaissés attendent d'être répartis. Le plus ancien remonte au ${asbFr(plus)} (${asbDays(plus, today)} jours). Cet argent appartient au personnel, pas au restaurant.` });
    }
  }
  // ───── Hôtellerie ─────
  if (A.includes("restauration") && (hotel || []).length) {
    const gens = new Map(asbRows(hotel, "guest").map((g) => [g.id, g.name]));
    const chs = new Map(asbRows(hotel, "room").map((r) => [r.id, r.number]));
    asbRows(hotel, "booking").filter((b) => b.status === "reservee" && b.from && b.from < today).slice(0, 25).forEach((b) => {
      push({ key: "hotel-arrivee:" + b.id, severity: "medium", category: "hotel", title: "Client attendu qui n'est ni arrivé ni annulé", detail: `${gens.get(b.guestId) || "Client"} devait arriver le ${asbFr(b.from)} (chambre ${chs.get(b.roomId) || "?"}, réservation ${b.number}) : la réservation est restée « Réservée », la chambre est bloquée sur le planning.` });
    });
    asbRows(hotel, "booking").filter((b) => b.status === "arrivee" && b.to && b.to < today).slice(0, 25).forEach((b) => {
      push({ key: "hotel-depart:" + b.id, severity: "medium", category: "hotel", title: "Séjour dépassé sans départ enregistré", detail: `${gens.get(b.guestId) || "Client"} (chambre ${chs.get(b.roomId) || "?"}, réservation ${b.number}) devait partir le ${asbFr(b.to)} : aucun départ n'est enregistré, donc aucune facture ni aucune écriture (${asbDays(b.to, today)} jour(s)).` });
    });
  }
  if (A.includes("transport") && (transport || []).length) {
    asbRows(transport, "vehicle").filter((v) => v.active !== false).forEach((v) => (v.docs || []).filter((d) => d.date && d.date < today).slice(0, 10).forEach((d) => {
      push({ key: "transport-echeance:" + v.id + ":" + d.id, severity: "high", category: "transport", title: "Document de véhicule échu", detail: `${v.plate} : « ${d.label} » est échu depuis le ${asbFr(d.date)} (${asbDays(d.date, today)} jour(s)). Le véhicule roule peut-être sans document valable.` });
    }));
    asbRows(transport, "driver").filter((d) => d.active !== false && d.licenseExpiry && d.licenseExpiry < today).slice(0, 25).forEach((d) => {
      push({ key: "transport-permis:" + d.id, severity: "high", category: "transport", title: "Permis de conduire échu", detail: `${d.name} : permis échu depuis le ${asbFr(d.licenseExpiry)} (${asbDays(d.licenseExpiry, today)} jour(s)).` });
    });
    const cls = new Map(asbRows(transport, "client").map((c) => [c.id, c.name]));
    asbRows(transport, "invoice").filter((i) => i.status !== "annulee").forEach((i) => {
      const reste = Math.round(((i.total || 0) - (i.payments || []).filter((p) => p.status !== "annulé").reduce((s, p) => s + p.amount, 0)) * 100) / 100;
      const j = asbDays(i.date, today);
      if (reste > 0.004 && j > 30) push({ key: "transport-impaye:" + i.id, severity: j > 60 ? "high" : "medium", category: "transport", title: "Facture de transport impayée", detail: `${cls.get(i.clientId) || "Client"} : la facture ${i.number} du ${asbFr(i.date)} n'est pas soldée (reste ${asbG(reste)}, ${j} jours).` });
    });
  }
  if (A.includes("immobilier") && (immo || []).length) {
    const locs = new Map(asbRows(immo, "tenant").map((c) => [c.id, c.name]));
    const biens = new Map(asbRows(immo, "property").map((c) => [c.id, c.name]));
    asbRows(immo, "rent").filter((r) => r.status !== "annulee").forEach((r) => {
      const reste = Math.round(((r.total || 0) - (r.payments || []).filter((p) => p.status !== "annulé").reduce((s, p) => s + p.amount, 0)) * 100) / 100;
      const j = asbDays(r.dueDate, today);
      if (reste > 0.004 && j > 30) push({ key: "immo-impaye:" + r.id, severity: j > 60 ? "high" : "medium", category: "immo", title: "Loyer impayé", detail: `${locs.get(r.tenantId) || "Locataire"} (${biens.get(r.propertyId) || "bien"}) : le loyer ${r.number} est en retard de ${j} jour(s) ; reste ${reste.toFixed(2)} gourdes.` });
    });
    asbRows(immo, "lease").filter((b) => b.status !== "termine" && b.end && b.end < today).slice(0, 25).forEach((b) => {
      push({ key: "immo-bail-echu:" + b.id, severity: "medium", category: "immo", title: "Bail arrivé à échéance", detail: `${b.number} (${biens.get(b.propertyId) || "bien"}, ${locs.get(b.tenantId) || "locataire"}) : la date de fin prévue (${asbFr(b.end)}) est dépassée et le bail est toujours en cours.` });
    });
    asbRows(immo, "lease").filter((b) => b.status === "termine" && b.depositStatus === "recu").slice(0, 25).forEach((b) => {
      push({ key: "immo-depot:" + b.id, severity: "medium", category: "immo", title: "Dépôt de garantie à restituer", detail: `${b.number} (${locs.get(b.tenantId) || "locataire"}) : le bail est terminé mais le dépôt de garantie n'a pas été restitué.` });
    });
  }
  if (A.includes("btp") && (btp || []).length) {
    const cli = new Map(asbRows(btp, "client").map((c) => [c.id, c.name]));
    const chs = new Map(asbRows(btp, "site").map((c) => [c.id, c.name]));
    asbRows(btp, "sit").filter((x) => x.status !== "annulee").forEach((x) => {
      const reste = Math.round(((x.net || 0) - (x.payments || []).filter((p) => p.status !== "annulé").reduce((s, p) => s + p.amount, 0)) * 100) / 100;
      const j = asbDays(x.date, today);
      if (reste > 0.004 && j > 30) push({ key: "btp-impaye:" + x.id, severity: j > 60 ? "high" : "medium", category: "btp", title: "Situation de travaux impayée", detail: `${cli.get(x.clientId) || "Client"} : la situation ${x.number} (${chs.get(x.siteId) || "chantier"}) est impayée depuis ${j} jour(s) ; reste ${reste.toFixed(2)} gourdes.` });
    });
    asbRows(btp, "site").filter((s) => s.budget > 0).forEach((s) => {
      const dep = asbRows(btp, "dep").filter((d) => d.siteId === s.id && d.status !== "annulé").reduce((t, d) => t + d.amount, 0);
      if (dep > s.budget) push({ key: "btp-budget:" + s.id, severity: "medium", category: "btp", title: "Budget de chantier dépassé", detail: `${s.name} : dépenses de ${dep.toFixed(2)} gourdes pour un budget de ${Number(s.budget).toFixed(2)}.` });
    });
    asbRows(btp, "site").filter((s) => (s.status === "encours" || s.status === "preparation") && s.end && s.end < today).slice(0, 25).forEach((s) => {
      push({ key: "btp-retard:" + s.id, severity: "medium", category: "btp", title: "Chantier en retard sur la date de fin prévue", detail: `${s.name} : la fin prévue (${asbFr(s.end)}) est dépassée de ${asbDays(s.end, today)} jour(s) et le chantier n'est pas terminé.` });
    });
  }
  if (A.includes("industrie") && (indus || []).length) {
    const cli = new Map(asbRows(indus, "client").map((c) => [c.id, c.name]));
    const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
    asbRows(indus, "fact").filter((x) => x.status !== "annulee").forEach((x) => {
      const reste = r2((x.net || 0) - (x.payments || []).filter((p) => p.status !== "annulé").reduce((s, p) => s + p.amount, 0));
      const j = asbDays(x.date, today);
      if (reste > 0.004 && j > 30) push({ key: "indus-impaye:" + x.id, severity: j > 60 ? "high" : "medium", category: "indus", title: "Facture de vente impayée", detail: `${cli.get(x.clientId) || "Client de passage"} : la facture ${x.number} du ${asbFr(x.date)} reste due à hauteur de ${reste.toFixed(2)} gourdes (${j} jours).` });
    });
    const lots = asbRows(indus, "lot").filter((l) => l.status !== "annulé");
    const achats = asbRows(indus, "achat").filter((a) => a.status !== "annulé");
    const ajs = asbRows(indus, "ajust").filter((a) => a.status !== "annulé");
    asbRows(indus, "mat").filter((m) => m.active !== false && Number(m.min) > 0).forEach((m) => {
      const st = achats.filter((a) => a.matId === m.id).reduce((t, a) => t + a.qty, 0) - lots.reduce((t, l) => t + (l.lines || []).filter((x) => x.matId === m.id).reduce((u, x) => u + x.qty, 0), 0) + ajs.filter((a) => a.target === "mat" && a.refId === m.id).reduce((t, a) => t + a.qty, 0);
      if (st <= m.min) push({ key: "indus-stock:" + m.id, severity: "medium", category: "indus", title: "Matière première presque épuisée", detail: `${m.name} : ${Math.round(st * 1000) / 1000} ${m.unit} en stock pour un seuil d'alerte de ${m.min}.` });
    });
    asbRows(indus, "cmd").filter((c) => (c.status === "confirmee" || c.status === "enprod" || c.status === "prete") && c.due && c.due < today).slice(0, 25).forEach((c) => {
      push({ key: "indus-retard:" + c.id, severity: "medium", category: "indus", title: "Commande en retard de livraison", detail: `${cli.get(c.clientId) || "Client"} : la commande ${c.number} devait être livrée le ${asbFr(c.due)} (${asbDays(c.due, today)} jour(s) de retard).` });
    });
  }
  // ───── Agriculture et élevage ─────
  if (A.includes("agriculture") && (agri || []).length) {
    const cli = new Map(asbRows(agri, "client").map((c) => [c.id, c.name]));
    const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
    asbRows(agri, "fact").filter((x) => x.status !== "annulee").forEach((x) => {
      const reste = r2((x.net || 0) - (x.payments || []).filter((p) => p.status !== "annulé").reduce((s, p) => s + p.amount, 0));
      const j = asbDays(x.date, today);
      if (reste > 0.004 && j > 30) push({ key: "agri-impaye:" + x.id, severity: j > 60 ? "high" : "medium", category: "agri", title: "Facture de vente impayée", detail: `${cli.get(x.clientId) || "Client de passage"} : la facture ${x.number} du ${asbFr(x.date)} reste due à hauteur de ${reste.toFixed(2)} gourdes (${j} jours).` });
    });
    const achats = asbRows(agri, "achat").filter((a) => a.status !== "annulé");
    const usages = asbRows(agri, "usage").filter((u) => u.status !== "annulé");
    const lots = asbRows(agri, "lot").filter((l) => l.status !== "annulé");
    const ajs = asbRows(agri, "ajust").filter((a) => a.status !== "annulé");
    asbRows(agri, "mat").filter((m) => m.active !== false && Number(m.min) > 0).forEach((m) => {
      const st = achats.filter((a) => a.matId === m.id).reduce((t, a) => t + a.qty, 0) - usages.filter((u) => u.matId === m.id).reduce((t, u) => t + u.qty, 0) - lots.reduce((t, l) => t + (l.lines || []).filter((x) => x.matId === m.id).reduce((u, x) => u + x.qty, 0), 0) + ajs.filter((a) => a.target === "mat" && a.refId === m.id).reduce((t, a) => t + a.qty, 0);
      if (st <= m.min) push({ key: "agri-stock:" + m.id, severity: "medium", category: "agri", title: "Intrant presque épuisé", detail: `${m.name} : ${Math.round(st * 1000) / 1000} ${m.unit} en stock pour un seuil d'alerte de ${m.min}.` });
    });
    const bandes = asbRows(agri, "bande").filter((b) => b.status === "encours");
    const mouvs = asbRows(agri, "mouv").filter((m) => m.status !== "annulé");
    asbRows(agri, "soin").filter((x) => x.status !== "annulé" && x.next && !x.nextDone && x.next < today).slice(0, 25).forEach((x) => {
      const b = bandes.find((y) => y.id === x.bandeId);
      if (b) push({ key: "agri-soin:" + x.id, severity: "medium", category: "agri", title: "Soin ou vaccin en retard", detail: `${b.name} : « ${x.label || "pesée"} » devait être refait le ${asbFr(x.next)} (${asbDays(x.next, today)} jour(s) de retard).` });
    });
    bandes.filter((b) => b.mode === "lot").forEach((b) => {
      const base = (b.count0 || 0) + mouvs.filter((m) => m.bandeId === b.id && (m.kind === "naissance" || m.kind === "achat")).reduce((t, m) => t + m.qty, 0);
      const morts = mouvs.filter((m) => m.bandeId === b.id && m.kind === "mortalite").reduce((t, m) => t + m.qty, 0);
      if (base > 0 && morts * 100 / base > 10) push({ key: "agri-mortalite:" + b.id, severity: "high", category: "agri", title: "Mortalité élevée dans une bande", detail: `${b.name} : ${morts} animal(aux) morts sur ${base}, soit ${Math.round(morts * 1000 / base) / 10} %.` });
    });
    const recoltes = asbRows(agri, "recolte").filter((r) => r.status !== "annulé");
    asbRows(agri, "camp").filter((c) => c.status === "encours" && c.start && asbDays(c.start, today) > 180 && !recoltes.some((r) => r.campId === c.id)).forEach((c) => {
      push({ key: "agri-camp:" + c.id, severity: "medium", category: "agri", title: "Campagne ouverte depuis plus de 6 mois sans récolte", detail: `${c.name} (${c.number}) est ouverte depuis le ${asbFr(c.start)} sans aucune récolte enregistrée.` });
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
    "ecole-constater": { why: "Tant qu'une échéance échue n'est pas constatée, elle n'existe pas en comptabilité : les produits de scolarité et les sommes dues par les familles sont sous-estimés.", steps: [
      "Ouvrez l'espace Éducation → onglet « Échéances ».",
      "Cliquez sur « Constater les échéances échues » (réservé à l'administrateur ou au gestionnaire) : une écriture est passée automatiquement (Familles / Produit).",
      "Si la période comptable est clôturée, demandez à votre comptable la marche à suivre.",
      "Faites-le chaque mois, avant d'établir vos états."] },
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
    "resto-recette": { why: "Sans recette, le coût du plat est inconnu : impossible de savoir si vous gagnez de l'argent dessus, et le stock ne baisse pas quand il est vendu.", steps: [
      "Ouvrez l'espace Restauration → onglet « Recettes et coûts » et cliquez sur « Recette » à côté du plat.",
      "Ajoutez chaque ingrédient (produit du stock) avec la quantité utilisée pour UNE portion.",
      "Si l'ingrédient n'existe pas encore, créez-le dans le module Stock avec son prix de revient, puis revenez.",
      "Si le plat n'est plus servi, cliquez sur « Retirer du menu ».",
      "Si c'est normal (boisson servie sans préparation, par exemple), cliquez sur « Ignorer »."] },
    "resto-marge": { why: "Quand les ingrédients coûtent plus de 70 % du prix, il ne reste presque rien pour payer le personnel, le loyer, l'électricité et les taxes.", steps: [
      "Ouvrez l'espace Restauration → « Recettes et coûts » → « Recette » du plat et vérifiez les quantités : une portion est-elle trop généreuse ?",
      "Vérifiez le prix de revient des ingrédients dans le module Stock (une erreur de prix fausse le coût).",
      "Si les coûts sont exacts, augmentez le prix du plat ou réduisez la portion.",
      "Si c'est un plat d'appel voulu à marge faible, cliquez sur « Ignorer »."] },
    "resto-ouverte": { why: "Tant qu'une commande n'est pas encaissée, aucune écriture n'est passée : le chiffre d'affaires et l'argent en caisse ne concordent pas.", steps: [
      "Ouvrez l'espace Restauration → « Salle et commandes » et touchez la table (ou la commande sans table) à côté de la commande indiquée.",
      "Si le client a payé, cliquez sur « Encaisser l'addition » (la date sera celle d'aujourd'hui : notez-le si le paiement date d'un autre jour).",
      "Si le client n'a jamais consommé ou est parti sans payer, cliquez sur « Annuler la commande » ; une perte réelle se traite avec votre comptable.",
      "Prenez l'habitude de clôturer les commandes avant la fermeture."] },
    "resto-service": { why: "Le service et les pourboires sont encaissés pour le personnel : ils restent en compte 4677 (dette envers les employés) tant qu'ils ne sont pas reversés.", steps: [
      "Ouvrez l'espace Restauration → onglet « Service et pourboires ».",
      "Vérifiez la liste des employés et leurs points (leur part), puis le montant prévu pour chacun.",
      "Choisissez espèces ou banque et cliquez sur « Répartir » : l'écriture est passée toute seule.",
      "Faites-le régulièrement (chaque semaine ou chaque quinzaine) et remettez à chaque employé sa part."] },
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
    "hotel-arrivee": { why: "Une réservation restée « Réservée » après la date d'arrivée bloque la chambre sur le planning et fausse les arrivées du jour.", steps: [
      "Ouvrez l'espace Hôtellerie → onglet « Réservations » et ouvrez la réservation indiquée.",
      "Si le client est arrivé, cliquez sur « Enregistrer l'arrivée » (la chambre doit être marquée « Propre »).",
      "S'il ne viendra plus, choisissez « Annulation par le client » ou « Client absent », décidez du sort de l'acompte (rembourser ou conserver) puis cliquez sur « Annuler la réservation ».",
      "Si c'est normal (arrivée tardive confirmée), cliquez sur « Ignorer »."] },
    "immo-impaye": { why: "Un loyer impayé depuis plus de 30 jours fragilise votre trésorerie ; plus on attend, plus le recouvrement est difficile.", steps: [
      "Ouvrez l'espace Immobilier → onglet « Loyers » et ouvrez le loyer indiqué.",
      "Contactez le locataire avec le numéro du loyer et le reste à payer.",
      "Dès qu'il paie, enregistrez l'encaissement (date, mode) puis imprimez la quittance.",
      "Rapports → « Loyers impayés par locataire » donne les retards par ancienneté."] },
    "immo-bail-echu": { why: "Un bail dont la date de fin est dépassée continue de produire des loyers sans cadre clair : renouvellement ou départ à confirmer.", steps: [
      "Ouvrez l'espace Immobilier → onglet « Baux » et ouvrez le bail indiqué.",
      "Si le locataire reste, prolongez la date de fin prévue (nouveau contrat signé).",
      "S'il part, cliquez sur « Mettre fin à ce bail » : le bien redevient libre."] },
    "immo-depot": { why: "Un dépôt de garantie non restitué après le départ du locataire est une dette envers lui, à régler dans les délais prévus au contrat.", steps: [
      "Ouvrez l'espace Immobilier → onglet « Baux » et ouvrez le bail terminé.",
      "Vérifiez l'état des lieux de sortie et les loyers restants dus.",
      "Saisissez le montant rendu (si une retenue est justifiée) puis cliquez sur « Restituer le dépôt »."] },
    "indus-impaye": { why: "Une facture impayée depuis plus de 30 jours immobilise votre trésorerie alors que les matières et le travail sont déjà payés.", steps: [
      "Ouvrez l'espace Industries artisanales → onglet « Ventes » et ouvrez la facture indiquée.",
      "Relancez le client avec le numéro de facture et le reste à payer.",
      "Dès qu'il paie, cliquez sur « Encaisser » (date, mode).",
      "Pour les commandes sur mesure, pensez à demander un acompte à la confirmation."] },
    "indus-stock": { why: "Sans matière première, la fabrication s'arrête et les commandes prennent du retard.", steps: [
      "Ouvrez l'espace Industries artisanales → onglet « Matières et achats ».",
      "Vérifiez le stock réel (inventaire) ; en cas d'écart, utilisez « Ajuster » avec un motif.",
      "Achetez la matière dans le formulaire « Acheter des matières » : le stock et le prix moyen se mettent à jour.",
      "Adaptez le seuil d'alerte dans la fiche de la matière si besoin."] },
    "indus-retard": { why: "Une commande livrée en retard abîme la confiance du client et peut le conduire à annuler.", steps: [
      "Ouvrez l'espace Industries artisanales → onglet « Commandes » et ouvrez la commande indiquée.",
      "Vérifiez qu'une fabrication existe (onglet Production) et que les matières sont en stock.",
      "Prévenez le client et, s'il l'accepte, indiquez une nouvelle date en créant une commande à jour ; sinon livrez et facturez dès que prête."] },
    "agri-impaye": { why: "Une facture impayée depuis plus de 30 jours immobilise votre trésorerie alors que les semences, l'aliment et le travail sont déjà payés.", steps: [
      "Ouvrez l'espace Agriculture et élevage → onglet « Ventes » et ouvrez la facture indiquée.",
      "Relancez le client avec le numéro de facture et le reste à payer.",
      "Dès qu'il paie, cliquez sur « Encaisser » (date, mode).",
      "Pour les gros clients, pensez à demander un acompte à la commande (précommande avant récolte)."] },
    "agri-stock": { why: "Sans semences, engrais ou aliment, le travail de la ferme s'arrête ou les animaux souffrent.", steps: [
      "Ouvrez l'espace Agriculture et élevage → onglet « Intrants et achats ».",
      "Vérifiez le stock réel ; en cas d'écart, utilisez « Ajuster » avec un motif.",
      "Achetez l'intrant dans le formulaire « Acheter des intrants » : le stock et le prix moyen se mettent à jour.",
      "Adaptez le seuil d'alerte dans la fiche de l'intrant si besoin."] },
    "agri-soin": { why: "Un vaccin ou un traitement oublié expose toute la bande à la maladie, avec un risque de mortalité.", steps: [
      "Ouvrez l'espace Agriculture et élevage → onglet « Élevage » et ouvrez la bande indiquée.",
      "Faites le soin ou le vaccin prévu, puis cliquez sur « Fait » dans la ligne du soin.",
      "Enregistrez un nouveau soin avec la date du prochain rappel pour ne plus l'oublier."] },
    "agri-mortalite": { why: "Plus de 10 % de mortalité signale un problème (eau, aliment, maladie, chaleur, densité) qui peut vider la bande et rendre la vente déficitaire.", steps: [
      "Ouvrez l'espace Agriculture et élevage → onglet « Élevage » et ouvrez la bande indiquée.",
      "Relisez les mouvements et les causes notées ; appelez un vétérinaire ou un technicien si la cause n'est pas claire.",
      "Vérifiez les soins et vaccins faits, puis corrigez la cause avant de racheter des animaux.",
      "Notez la cause dans la remarque de chaque mortalité pour garder une trace."] },
    "agri-camp": { why: "Une campagne ouverte depuis plus de six mois sans récolte fausse le coût de revient et signale souvent un oubli de saisie ou une culture perdue.", steps: [
      "Ouvrez l'espace Agriculture et élevage → onglet « Cultures » et ouvrez la campagne indiquée.",
      "Si la récolte a eu lieu, enregistrez-la avec sa vraie date.",
      "Si la culture est perdue, cliquez sur « Clôturer la campagne » : les frais restent comptés, le coût de revient n'est pas calculé."] },
    "btp-impaye": { why: "Une situation de travaux impayée depuis plus de 30 jours pèse sur votre trésorerie alors que vos dépenses de chantier, elles, sont déjà payées.", steps: [
      "Ouvrez l'espace BTP → onglet « Situations » et ouvrez la situation indiquée.",
      "Relancez le client avec le numéro de la situation et le net à payer.",
      "Dès qu'il paie, enregistrez l'encaissement (date, mode).",
      "Si le chantier avance sans paiement, envisagez de suspendre le chantier (onglet Chantiers → état « Suspendu») selon votre contrat."] },
    "btp-budget": { why: "Quand les dépenses dépassent le budget prévu, la marge du chantier fond : mieux vaut le savoir avant la prochaine situation.", steps: [
      "Ouvrez l'espace BTP → onglet « Rapports » → « Rentabilité par chantier » pour voir la marge.",
      "Vérifiez les dépenses du chantier (onglet Dépenses, filtre par chantier) : doublons, erreurs de chantier ?",
      "Si le dépassement est réel, discutez d'un avenant avec le client (travaux supplémentaires) ou ajustez le budget dans la fiche du chantier."] },
    "btp-retard": { why: "Un chantier dont la date de fin prévue est dépassée peut entraîner des pénalités de retard et immobilise vos équipes.", steps: [
      "Ouvrez l'espace BTP → onglet « Chantiers » et ouvrez le chantier indiqué.",
      "Si les travaux sont finis, passez l'état à « Terminé » ; la retenue de garantie pourra alors être réclamée.",
      "Sinon, mettez à jour la date de fin prévue (après accord du client)."] },
    "transport-echeance": { why: "Un véhicule dont un document est échu (assurance, contrôle technique, vignette…) expose l'entreprise à des amendes et à un refus de prise en charge en cas d'accident.", steps: [
      "Ouvrez l'espace Transport → onglet « Véhicules » et ouvrez le véhicule indiqué.",
      "Renouvelez le document auprès de l'organisme concerné.",
      "Dans la liste des échéances, retirez l'ancienne ligne puis ajoutez la nouvelle date d'échéance.",
      "Si le véhicule est à l'arrêt, décochez « En service » : l'alerte disparaît."] },
    "transport-permis": { why: "Faire conduire un chauffeur dont le permis est échu est un risque légal et d'assurance.", steps: [
      "Ouvrez l'espace Transport → onglet « Chauffeurs ».",
      "Si le permis a été renouvelé, saisissez la nouvelle date de validité.",
      "Sinon, décochez « Actif » tant que le permis n'est pas renouvelé : le chauffeur n'apparaît plus dans les voyages."] },
    "transport-impaye": { why: "Une facture de transport impayée depuis plus de 30 jours immobilise votre trésorerie : plus on attend, plus le recouvrement est difficile.", steps: [
      "Ouvrez l'espace Transport → onglet « Factures » et ouvrez la facture indiquée.",
      "Contactez le client avec le numéro de facture et le reste à payer.",
      "Dès qu'il paie, enregistrez l'encaissement (date, mode) : la comptabilité se met à jour toute seule.",
      "Consultez Rapports → « Clients » pour voir les retards par ancienneté."] },
    "hotel-depart": { why: "Tant que le départ n'est pas enregistré, le séjour n'est ni facturé ni comptabilisé : l'argent encaissé et les ventes ne concordent pas.", steps: [
      "Ouvrez l'espace Hôtellerie → onglet « Réservations » et ouvrez le séjour indiqué.",
      "Si le client est parti, vérifiez la date de départ réelle, ajoutez les services oubliés, puis cliquez sur « Enregistrer le départ et facturer ».",
      "Si le client prolonge son séjour, prévenez la réception : créez une nouvelle réservation pour les nuits suivantes si la chambre est libre.",
      "Si c'est normal, cliquez sur « Ignorer »."] },
  };
  const g = G[rule];
  return g ? { why: g.why, steps: g.steps } : null;
}
