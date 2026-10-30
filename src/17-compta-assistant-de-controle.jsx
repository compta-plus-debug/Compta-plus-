// ═══ MODULE ═══
// @module Compta assistant de controle
// @depends asstHowToBlocs, stockReconcile, todayStr, uid, useState
// @exports AssistantPanel, asstApplyFix, asstScan
// ═══ FIN DE L'EN-TÊTE ═══
// === A:PURE ===
// Assistant de contrôle (forfaits Assisté et Extension) — analyse automatique du journal.
// Principe : il DÉTECTE et PROPOSE ; rien n'est jamais appliqué sans un clic explicite, et toute
// correction se fait par contrepassation (l'écriture d'origine est conservée pour la traçabilité).
function asstLuhn(digits) {
  let s = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    s += n; alt = !alt;
  }
  return s % 10 === 0;
}
// Masque les numéros de carte (13 à 19 chiffres valides Luhn) et les secrets saisis en clair
// (« mot de passe : xxx », « PIN 1234 », « CVV 123 »...). Retourne le texte nettoyé.
function asstMaskSensitive(text) {
  let out = String(text == null ? "" : text);
  let changed = false;
  out = out.replace(/\b(?:\d[ -]?){12,18}\d\b/g, (m) => {
    const d = m.replace(/\D/g, "");
    if (d.length >= 13 && d.length <= 19 && asstLuhn(d)) { changed = true; return "•••• " + d.slice(-4); }
    return m;
  });
  out = out.replace(/(mot de passe|password|passwd|code pin|\bpin\b|cvv|cvc|code secret)\s*[:=]?\s*([^\s,;•:=][^\s,;]*)/gi, (m, k) => { changed = true; return k + " : ••••"; });
  return { text: out, changed };
}
const ASST_NEUTRAL_LABEL = /cl[ôo]ture|exercice|report|affectation|r[ée]gularisation|extourne|avoir|remboursement|retour|rabais|annulation|contrepassation|correction|stock|inventaire/i;
function asstIsNeutralized(e) { return !!e.cancelledBy || !!e.reversalOf; }
function asstAccountType(code) {
  const c = String(code || "");
  if (c.startsWith("1")) return "Capitaux propres";
  if (c.startsWith("6")) return "Charge";
  if (c.startsWith("7")) return "Produit";
  if (c.startsWith("40") || c.startsWith("42") || c.startsWith("43") || c.startsWith("44") || c.startsWith("16")) return "Passif";
  return "Actif";
}
function asstScan({ entries, accounts, settings, today, hasSecurityPin, lastBackupAt, products }) {
  const out = [];
  const E = entries || [], A = accounts || [], st = settings || {};
  const known = new Map(A.map((a) => [a.code, a]));
  const active = E.filter((e) => !asstIsNeutralized(e));
  const locked = (d) => !!(st.lockDate && d && d <= st.lockDate);
  const sum = (e, f) => (e.lines || []).reduce((s, l) => s + Number(l[f] || 0), 0);
  const lab = (e) => `${e.date || "sans date"} — ${e.label || "(sans libellé)"}`;
  const reverseFix = (ids, preview) => {
    const free = ids.filter((id) => { const e = E.find((x) => x.id === id); return e && !locked(e.date); });
    return free.length ? { kind: "reverse", entryIds: free, preview } : null;
  };
  const push = (f) => out.push(f);

  active.forEach((e) => {
    const d = sum(e, "debit"), c = sum(e, "credit");
    const lines = e.lines || [];
    if (Math.abs(d - c) > 0.005) {
      push({ key: "desequilibre:" + e.id, severity: "high", category: "compta", title: "Écriture déséquilibrée", detail: `${lab(e)} : débit ${d.toFixed(2)} / crédit ${c.toFixed(2)} (écart ${Math.abs(d - c).toFixed(2)}).`, entryId: e.id,
        fix: reverseFix([e.id], "Contrepasser cette écriture (l'original reste visible, annulé), puis la ressaisir équilibrée.") });
      return;
    }
    if (lines.length < 2 || (d === 0 && c === 0)) {
      push({ key: "vide:" + e.id, severity: "low", category: "compta", title: "Écriture vide ou incomplète", detail: `${lab(e)} : ${lines.length} ligne(s), montant nul.`, entryId: e.id, fix: reverseFix([e.id], "Contrepasser cette écriture sans effet comptable.") });
      return;
    }
    if (lines.some((l) => (Number(l.debit) > 0 && Number(l.credit) > 0) || Number(l.debit) < 0 || Number(l.credit) < 0)) {
      push({ key: "ligne:" + e.id, severity: "medium", category: "compta", title: "Ligne avec montant incohérent", detail: `${lab(e)} : une ligne est à la fois débitrice et créditrice, ou négative. Ressaisissez-la sur un seul côté.`, entryId: e.id, fix: reverseFix([e.id], "Contrepasser puis ressaisir avec des montants positifs sur un seul côté.") });
    }
    if (lines.length === 2 && e.kind !== "cogs" && !e.fx && !ASST_NEUTRAL_LABEL.test(e.label || "")) {
      const bad = lines.find((l) => {
        const code = String(l.account || "");
        if (/^(603|609|709|666|766)/.test(code)) return false;
        return (code.startsWith("6") && Number(l.credit) > 0) || (code.startsWith("7") && Number(l.debit) > 0);
      });
      if (bad) {
        push({ key: "sens:" + e.id, severity: "medium", category: "compta", title: "Sens débit/crédit probablement inversé", detail: `${lab(e)} : le compte ${bad.account} (${known.get(bad.account)?.name || "?"}) ${String(bad.account).startsWith("6") ? "est crédité alors qu'une charge se débite" : "est débité alors qu'un produit se crédite"}.`, entryId: e.id,
          fix: locked(e.date) ? null : { kind: "swap", entryId: e.id, preview: "Contrepasser l'écriture puis ajouter une écriture corrigée avec les colonnes débit/crédit inversées." } });
      }
    }
    if (!e.date) {
      push({ key: "date:" + e.id, severity: "high", category: "compta", title: "Écriture sans date", detail: `« ${e.label || "(sans libellé)"} » n'a pas de date : elle échappe aux périodes et aux états.`, entryId: e.id, fix: null });
    } else if (e.date < "2000-01-01" || (today && e.date > addDaysIso(today, 31))) {
      push({ key: "date:" + e.id, severity: "medium", category: "compta", title: "Date improbable", detail: `${lab(e)} : date ${e.date < "2000-01-01" ? "très ancienne" : "dans plus d'un mois"}. Probable faute de frappe sur l'année ou le mois.`, entryId: e.id, fix: reverseFix([e.id], "Contrepasser puis ressaisir avec la bonne date.") });
    }
  });

  // Comptes absents du plan comptable
  const unknown = {};
  active.forEach((e) => (e.lines || []).forEach((l) => { if (l.account && !known.has(l.account)) unknown[l.account] = (unknown[l.account] || 0) + 1; }));
  Object.entries(unknown).forEach(([code, n]) => {
    push({ key: "compte:" + code, severity: "medium", category: "compta", title: `Compte ${code} absent du plan comptable`, detail: `${n} ligne(s) utilisent ce compte, qui n'existe pas dans le plan : il n'apparaît pas correctement dans les états.`,
      fix: { kind: "addAccount", code, name: `Compte ${code} (à renommer)`, type: asstAccountType(code), preview: `Ajouter le compte ${code} au plan comptable en tant que « ${asstAccountType(code)} » (à renommer ensuite).` } });
  });

  // Doublons probables (hors ventes liées à une facture : le contrôle de cohérence les traite déjà)
  const groups = {};
  active.filter((e) => !e.invoiceId && sum(e, "debit") > 0).forEach((e) => {
    const k = `${e.date}|${String(e.label || "").trim().toLowerCase()}|${sum(e, "debit").toFixed(2)}`;
    (groups[k] = groups[k] || []).push(e);
  });
  Object.entries(groups).filter(([, l]) => l.length > 1).forEach(([k, list]) => {
    const sorted = [...list].sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
    const extra = sorted.slice(1);
    push({ key: "doublon:" + k, severity: "medium", category: "compta", title: "Doublon probable", detail: `${list.length} écritures identiques (même date, libellé et montant) : ${lab(sorted[0])}.`, entryId: sorted[0].id,
      fix: reverseFix(extra.map((x) => x.id), `Contrepasser ${extra.length} copie(s) en trop et conserver la première.`) });
  });

  // Montants atypiques (≥ 5 fois la moyenne du même compte de charge/produit)
  const byAcc = {};
  active.forEach((e) => (e.lines || []).forEach((l) => {
    const code = String(l.account || "");
    if (!/^[67]/.test(code)) return;
    const amt = Number(l.debit || 0) + Number(l.credit || 0);
    (byAcc[code] = byAcc[code] || []).push({ e, amt });
  }));
  const atyp = [];
  Object.entries(byAcc).forEach(([code, arr]) => {
    if (arr.length < 6) return;
    arr.forEach((x) => {
      const others = arr.filter((y) => y !== x);
      const avg = others.reduce((s, y) => s + y.amt, 0) / others.length;
      if (avg > 0 && x.amt > avg * 5) atyp.push({ code, x, avg });
    });
  });
  atyp.sort((a, b) => b.x.amt - a.x.amt).slice(0, 10).forEach(({ code, x, avg }) => {
    push({ key: "atypique:" + x.e.id + ":" + code, severity: "low", category: "compta", title: "Montant inhabituel", detail: `${lab(x.e)} : ${x.amt.toFixed(2)} sur le compte ${code}, contre une moyenne de ${avg.toFixed(2)}. À vérifier (faute de zéro ?).`, entryId: x.e.id, fix: null });
  });

  // Soldes de trésorerie anormaux (toutes écritures, annulations comprises)
  const bal = {};
  E.forEach((e) => (e.lines || []).forEach((l) => { bal[l.account] = (bal[l.account] || 0) + Number(l.debit || 0) - Number(l.credit || 0); }));
  [["530", "La caisse (530) est négative", "high"], ["571", "La caisse (571) est négative", "high"], ["512", "La banque (512) est créditrice (découvert)", "medium"]].forEach(([code, title, sev]) => {
    if ((bal[code] || 0) < -0.5) push({ key: "solde:" + code, severity: sev, category: "compta", title, detail: `Solde ${(bal[code]).toFixed(2)}. Une sortie a pu être saisie deux fois, ou un encaissement a été oublié.`, fix: null });
  });
  if ((bal["411"] || 0) < -0.5) push({ key: "solde:411", severity: "low", category: "compta", title: "Clients (411) créditeur", detail: `Solde ${bal["411"].toFixed(2)} : un encaissement dépasse les factures, ou un acompte n'est pas lettré. Voir l'onglet Lettrage.`, fix: null });
  if ((bal["401"] || 0) > 0.5) push({ key: "solde:401", severity: "low", category: "compta", title: "Fournisseurs (401) débiteur", detail: `Solde ${bal["401"].toFixed(2)} : un paiement dépasse les achats, ou un avoir n'est pas lettré. Voir l'onglet Lettrage.`, fix: null });

  // Données sensibles dans les libellés
  E.forEach((e) => {
    const m = asstMaskSensitive(e.label);
    if (!m.changed) return;
    push({ key: "sensible:" + e.id, severity: "high", category: "sensibles", title: "Donnée sensible dans un libellé", detail: `${lab(e).replace(e.label || "", "").replace(/ — $/, "")} — un numéro de carte ou un mot de passe semble écrit en clair dans le libellé de l'écriture. Il est visible par tous les utilisateurs et dans les exports.`, entryId: e.id,
      fix: locked(e.date) ? null : { kind: "mask", entryId: e.id, newLabel: m.text, preview: `Remplacer le libellé par « ${m.text} ».` } });
  });

  // Sécurité et prévention
  const oldest = active.map((e) => e.date).filter(Boolean).sort()[0];
  if (!st.lockDate && oldest && today && oldest < addDaysIso(today, -120)) {
    push({ key: "securite:cloture", severity: "low", category: "securite", title: "Aucune période clôturée", detail: `Votre journal remonte au ${oldest} et aucune date de clôture n'est posée : les anciennes écritures restent modifiables. Posez une date de clôture dans Administration.`, fix: null });
  }
  if (hasSecurityPin === false) {
    push({ key: "securite:pin", severity: "low", category: "securite", title: "Pas de code de sécurité d'entreprise", detail: "Aucun code PIN n'protège l'accès à cette entreprise. Recommandé si l'appareil est partagé (Administration → Sécurité).".replace("n'protège", "ne protège"), fix: null });
  }
  if (today && E.length > 0) {
    const days = lastBackupAt ? Math.floor((Date.parse(today) - Date.parse(String(lastBackupAt).slice(0, 10))) / 86400000) : null;
    if (days === null || days > 30) {
      push({ key: "securite:sauvegarde", severity: "low", category: "securite", title: "Aucune sauvegarde téléchargée récemment", detail: days === null ? "Aucun export de sauvegarde n'a été fait depuis cet appareil." : `Dernier export il y a ${days} jours.`, fix: null });
    }
  }
  if (products) {
    const rec = stockReconcile(products, A, E, st);
    if (rec && !rec.ok) {
      push({ key: "stock:rapprochement", severity: "medium", category: "compta", title: "Le stock ne correspond pas à la comptabilité",
        detail: `La valeur du stock en rayon (quantités × coût) est de ${rec.stockValue.toFixed(2)}, mais le compte 370 « Stock de marchandises » affiche ${rec.bal370.toFixed(2)} (écart ${rec.gap.toFixed(2)}). Faites un inventaire physique, ou régularisez dans Administration → Méthode de valorisation du stock.`, fix: null });
    }
  }
  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || String(a.key).localeCompare(String(b.key)));
}
function addDaysIso(iso, n) {
  const d = new Date(String(iso).slice(0, 10) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// Applique une correction proposée. Retourne { entries, accounts, summary } ou { error }.
function asstApplyFix(fix, ctx) {
  const { entries, accounts, settings, mkId, today, nowIso } = ctx;
  const locked = (d) => !!(settings && settings.lockDate && d && d <= settings.lockDate);
  const byId = (id) => entries.find((e) => e.id === id);
  if (!fix) return { error: "Aucune correction automatique pour ce point." };
  if (fix.kind === "addAccount") {
    if (accounts.some((a) => a.code === fix.code)) return { error: "Ce compte existe déjà." };
    return { entries, accounts: [...accounts, { code: fix.code, name: fix.name, type: fix.type }], summary: `Compte ${fix.code} ajouté au plan comptable.` };
  }
  if (fix.kind === "mask") {
    const e = byId(fix.entryId);
    if (!e) return { error: "Écriture introuvable." };
    if (locked(e.date)) return { error: `Période clôturée jusqu'au ${settings.lockDate} : rouvrez-la pour corriger ce libellé.` };
    return { entries: entries.map((x) => (x.id === e.id ? { ...x, label: fix.newLabel } : x)), accounts, summary: "Donnée sensible masquée dans le libellé." };
  }
  if (fix.kind === "reverse" || fix.kind === "swap") {
    const ids = fix.kind === "swap" ? [fix.entryId] : fix.entryIds;
    const targets = ids.map(byId).filter((e) => e && !e.cancelledBy);
    if (targets.length === 0) return { error: "Ces écritures sont déjà annulées ou introuvables." };
    if (targets.some((e) => locked(e.date))) return { error: `Une de ces écritures est dans une période clôturée (jusqu'au ${settings.lockDate}).` };
    const add = [], cancelled = {};
    targets.forEach((e) => {
      const rid = mkId();
      cancelled[e.id] = rid;
      add.push({ id: rid, date: today, createdAt: nowIso, label: `Contrepassation — ${e.label}`, reversalOf: e.id, lines: (e.lines || []).map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })) });
      if (fix.kind === "swap") add.push({ id: mkId(), date: today, createdAt: nowIso, label: `Correction — ${e.label}`, lines: (e.lines || []).map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })) });
    });
    return { entries: [...entries.map((x) => (cancelled[x.id] ? { ...x, cancelledBy: cancelled[x.id] } : x)), ...add], accounts, summary: fix.kind === "swap" ? "Écriture contrepassée et corrigée." : `${targets.length} écriture(s) contrepassée(s).` };
  }
  return { error: "Correction inconnue." };
}
// === /A:PURE ===

// Guide « Comment corriger » : pour chaque type de constat, des étapes simples (où cliquer, quoi faire)
// destinées à un utilisateur non spécialiste. Retourne { why, steps[] }.
function asstHowTo(f) {
  const bloc = asstHowToBlocs(f);
  if (bloc) return bloc;
  const rule = String((f && f.key) || "").split(":")[0];
  const code = String((f && f.key) || "").split(":")[1] || "";
  const auto = f && f.fix ? "Le plus simple : cliquez sur « Appliquer la correction » ci-dessous (l'écriture d'origine reste visible, annulée, pour la traçabilité)." : null;
  const G = {
    desequilibre: { why: "Chaque écriture doit avoir autant au débit qu'au crédit. Sinon vos états (bilan, balance) sont faux.", steps: [auto, "Sinon, ouvrez Comptabilité → Journal et repérez l'écriture indiquée (date et libellé ci-dessus).", "Annulez-la (bouton d'annulation / contrepassation), puis ressaisissez-la avec le même total au débit et au crédit.", "Revenez ici : le point disparaît tout seul quand l'écriture est équilibrée."] },
    vide: { why: "Une écriture sans montant ne sert à rien et encombre le journal.", steps: [auto, "Sinon, ouvrez Comptabilité → Journal, repérez l'écriture et annulez-la.", "Si elle devait contenir un montant, ressaisissez-la correctement."] },
    ligne: { why: "Une ligne ne peut être que au débit ou au crédit, jamais les deux, et jamais négative.", steps: [auto, "Sinon, annulez l'écriture dans Comptabilité → Journal.", "Ressaisissez-la : un montant positif, placé d'un seul côté (débit OU crédit) par ligne."] },
    sens: { why: "Une charge (compte 6) se débite et un produit (compte 7) se crédite. Ici c'est l'inverse : le résultat est probablement faussé.", steps: [auto, "Sinon, annulez l'écriture dans Comptabilité → Journal.", "Ressaisissez-la en mettant les montants dans les bonnes colonnes (dépense = débit du compte 6 ; vente = crédit du compte 7).", "S'il s'agit volontairement d'un avoir ou d'une correction, cliquez sur « Ignorer »."] },
    date: { why: "Une date absente ou fausse place l'écriture dans la mauvaise période.", steps: [auto, "Sinon, ouvrez Comptabilité → Journal et trouvez l'écriture.", "Annulez-la puis ressaisissez-la avec la bonne date (vérifiez bien l'année).", "Si la période est clôturée, demandez à un administrateur de rouvrir la date de clôture (Administration) avant de corriger."] },
    compte: { why: `Le compte ${code} est utilisé dans vos écritures mais n'existe pas dans votre plan comptable : il manque dans les états.`, steps: [auto, `Sinon, ouvrez Comptabilité → Plan comptable et ajoutez le compte ${code} avec un nom clair et le bon type.`, "Vérifiez ensuite qu'il apparaît dans la balance."] },
    doublon: { why: "Plusieurs écritures identiques (même date, libellé et montant) comptent la même opération plusieurs fois.", steps: ["Vérifiez d'abord que c'est bien une erreur : deux vraies dépenses identiques le même jour sont possibles. Si c'est normal, cliquez sur « Ignorer ».", auto, "Sinon, ouvrez Comptabilité → Journal et annulez les copies en trop en gardant une seule écriture."] },
    atypique: { why: "Ce montant est très supérieur à vos montants habituels sur ce compte : c'est souvent une faute de frappe (zéro en trop).", steps: ["Ouvrez Comptabilité → Journal et retrouvez l'écriture indiquée.", "Comparez avec la pièce justificative (facture, reçu).", "Si le montant est faux : annulez l'écriture et ressaisissez-la avec le bon montant. Si c'est correct, cliquez sur « Ignorer »."] },
    solde: code === "411" ? { why: "Un client a versé plus que ce qu'il devait, ou un acompte n'est pas rattaché à une facture.", steps: ["Ouvrez Comptabilité → Lettrage, onglet Clients.", "Rattachez chaque encaissement à la facture correspondante.", "S'il reste un vrai excédent, remboursez-le ou conservez-le comme avance client."] }
      : code === "401" ? { why: "Vous avez payé un fournisseur plus que ses achats, ou un avoir fournisseur n'est pas rattaché.", steps: ["Ouvrez Comptabilité → Lettrage, onglet Fournisseurs.", "Rattachez chaque paiement ou avoir à la bonne facture d'achat.", "S'il reste un excédent, demandez un remboursement ou un avoir."] }
      : { why: "La caisse ou la banque ne peut pas être négative sans cause : une sortie est probablement saisie en double ou une entrée est oubliée.", steps: ["Comptez l'argent réellement en caisse (ou lisez le relevé bancaire) et comparez au solde affiché.", "Ouvrez Comptabilité → Journal, filtrez ce compte et cherchez une dépense saisie deux fois ou un encaissement manquant.", "Annulez le doublon ou saisissez l'encaissement oublié. Pour la banque, utilisez aussi Rapprochement bancaire."] },
    sensible: { why: "Un numéro de carte ou un mot de passe écrit dans un libellé est visible de tous et dans les exports : c'est un risque de fraude.", steps: [auto, "Sinon, ouvrez Comptabilité → Journal, repérez l'écriture et remplacez le libellé par un texte neutre.", "Si ce numéro est un vrai mot de passe ou une vraie carte, changez-le immédiatement chez la banque ou le service concerné."] },
    securite: code === "cloture" ? { why: "Sans date de clôture, n'importe quelle ancienne écriture peut être modifiée par erreur.", steps: ["Ouvrez Administration.", "Dans la section de clôture, choisissez la date de fin de la dernière période déjà vérifiée (par exemple la fin du dernier mois ou exercice contrôlé).", "Enregistrez : les écritures jusqu'à cette date ne seront plus modifiables."] }
      : code === "pin" ? { why: "Un code protège l'entreprise si un téléphone ou un ordinateur est partagé ou perdu.", steps: ["Ouvrez Administration → Sécurité.", "Choisissez un code PIN facile à retenir pour vous mais difficile à deviner (pas 1234).", "Enregistrez, puis testez en rouvrant l'entreprise."] }
      : { why: "Une sauvegarde récente vous permet de tout retrouver en cas de problème d'appareil ou d'erreur.", steps: ["Ouvrez Administration et cherchez la section des sauvegardes (export de vos données).", "Cliquez sur le bouton qui télécharge la sauvegarde sur votre appareil.", "Conservez le fichier à un endroit sûr (clé USB, e-mail à vous-même, Drive). Recommencez chaque mois."] },
    stock: { why: "La valeur du stock en rayon (quantités × coût) doit être égale au compte 370 de la comptabilité.", steps: ["Ouvrez Stock → Inventaire et comparez le rapprochement affiché.", "Faites un inventaire physique : comptez les produits et corrigez les quantités qui diffèrent.", "Vérifiez que chaque achat et chaque vente de marchandise est bien passé par les modules Achats / Vente (et non saisi à la main en comptabilité).", "Si l'écart vient d'une ancienne méthode, voir Administration → Méthode de valorisation du stock, puis passez une écriture de régularisation avec votre comptable."] },
  };
  const g = G[rule] || { why: "", steps: ["Ouvrez l'élément concerné dans Comptabilité → Journal et corrigez-le, ou cliquez sur « Ignorer » si c'est normal."] };
  return { why: g.why, steps: g.steps.filter(Boolean) };
}

function AssistantPanel({ findings, ignored, entries, accounts, setEntries, setAccounts, settings, setSettings, role, showToast, logAudit }) {
  const canEdit = role === "Administrateur" || role === "Éditeur";
  const [cat, setCat] = useState("tous");
  const [showIgnored, setShowIgnored] = useState(false);
  const ign = ignored || {};
  const visible = (findings || []).filter((f) => !ign[f.key]);
  const hidden = (findings || []).filter((f) => ign[f.key]);
  const shown = (showIgnored ? hidden : visible).filter((f) => cat === "tous" || f.category === cat);
  const count = (sev) => visible.filter((f) => f.severity === sev).length;
  const sevStyle = { high: { bg: "#F7E9E3", fg: "#A6432F", label: "Important" }, medium: { bg: "#FBF1DC", fg: "#9A7B1E", label: "À vérifier" }, low: { bg: "#EEF1F7", fg: "#5C6B8C", label: "Conseil" } };
  const catLabel = { compta: "Comptabilité", sensibles: "Données sensibles", securite: "Sécurité", ecole: "Éducation", impex: "Import-export", sante: "Santé", resto: "Restauration", hotel: "Hôtellerie", transport: "Transport", immo: "Immobilier", btp: "BTP" };

  const apply = (f) => {
    if (!f.fix) return;
    const needAdmin = f.fix.kind === "reverse" || f.fix.kind === "swap";
    if (needAdmin ? role !== "Administrateur" : !canEdit) { showToast(needAdmin ? "Seul un administrateur peut appliquer cette correction." : "Votre rôle ne permet pas cette correction."); return; }
    if (!window.confirm(`${f.title}\n\n${f.fix.preview}\n\nL'écriture d'origine est conservée pour la traçabilité. Appliquer ?`)) return;
    const r = asstApplyFix(f.fix, { entries, accounts, settings, mkId: uid, today: todayStr(), nowIso: new Date().toISOString() });
    if (r.error) { showToast(r.error); return; }
    if (r.entries !== entries) setEntries(r.entries);
    if (r.accounts !== accounts) setAccounts(r.accounts);
    showToast(r.summary);
    try { logAudit("Assistant", "Correction appliquée : " + f.title, f.detail.slice(0, 90)); } catch (e) {}
  };
  const ignore = (f, on) => {
    if (!canEdit) { showToast("Votre rôle ne permet pas de modifier cette liste."); return; }
    const next = { ...(settings.assistantIgnored || {}) };
    if (on) next[f.key] = todayStr(); else delete next[f.key];
    setSettings({ ...settings, assistantIgnored: next });
  };

  return (
    <div data-as="panel" className="grid gap-4" style={{ minWidth: 0 }}>
      <div className="rounded-lg p-4 text-sm" style={{ background: "#F1ECFA", border: "1px solid #DDD3F0", color: "#152238" }}>
        <b>Assistant de contrôle — actif</b> (forfait Assisté / Extension). Il relit automatiquement tout votre journal à chaque modification, repère les erreurs et les données sensibles, et vous propose une correction. <b>Rien n'est modifié sans votre accord</b> : chaque correction passe par une contrepassation, l'écriture d'origine reste visible.
      </div>
      <div className="flex gap-2 flex-wrap items-center">
        <span data-as="count-high" className="text-xs px-2 py-1 rounded" style={{ background: sevStyle.high.bg, color: sevStyle.high.fg }}>{count("high")} important(s)</span>
        <span data-as="count-medium" className="text-xs px-2 py-1 rounded" style={{ background: sevStyle.medium.bg, color: sevStyle.medium.fg }}>{count("medium")} à vérifier</span>
        <span data-as="count-low" className="text-xs px-2 py-1 rounded" style={{ background: sevStyle.low.bg, color: sevStyle.low.fg }}>{count("low")} conseil(s)</span>
        <span className="flex-1" />
        {["tous", "compta", "sensibles", "securite", "ecole", "impex", "sante", "resto", "hotel", "transport", "immo", "btp"].filter((c) => c === "tous" || ["compta", "sensibles", "securite"].includes(c) || (findings || []).some((f) => f.category === c)).map((c) => (
          <button key={c} data-as={`cat-${c}`} onClick={() => setCat(c)} className="px-2 py-1 rounded text-xs" style={{ background: cat === c ? "#152238" : "#F3EFE3", color: cat === c ? "#fff" : "#5C6B8C" }}>{c === "tous" ? "Tout" : catLabel[c]}</button>
        ))}
      </div>
      {visible.length === 0 && !showIgnored && (
        <div data-as="clean" className="bg-white rounded-lg p-6 text-sm text-center" style={{ border: "1px solid #E4DFD1", color: "#0F6B5C" }}>✓ Aucun problème détecté dans votre journal.</div>
      )}
      <div className="grid gap-2">
        {shown.map((f) => (
          <div key={f.key} data-as="finding" data-sev={f.severity} data-rule={f.key.split(":")[0]} className="bg-white rounded-lg p-3" style={{ border: "1px solid #E4DFD1", borderLeft: `4px solid ${sevStyle[f.severity].fg}`, minWidth: 0 }}>
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: sevStyle[f.severity].bg, color: sevStyle[f.severity].fg }}>{sevStyle[f.severity].label}</span>
              <span className="text-xs" style={{ color: "#8A8370" }}>{catLabel[f.category]}</span>
              <span className="text-sm font-medium" style={{ color: "#152238" }}>{f.title}</span>
            </div>
            <div className="text-xs" style={{ color: "#5C6B8C", wordBreak: "break-word" }}>{f.detail}</div>
            {f.fix && <div className="text-xs mt-1" style={{ color: "#0F6B5C", wordBreak: "break-word" }}>Correction proposée : {f.fix.preview}</div>}
            {(() => { const h = asstHowTo(f); return (
              <details data-as="howto" open={f.severity === "high"} className="mt-2 rounded p-2 text-xs" style={{ background: "#F6F9F7", border: "1px solid #D5E6DF", color: "#152238" }}>
                <summary className="cursor-pointer font-medium" style={{ color: "#0F6B5C" }}>Comment corriger ?</summary>
                {h.why && <div className="mt-1" style={{ color: "#5C6B8C" }}><b>Pourquoi c'est un problème :</b> {h.why}</div>}
                <ol className="mt-1 pl-4" style={{ listStyle: "decimal" }}>{h.steps.map((st, i) => <li key={i} className="mb-0.5" style={{ wordBreak: "break-word" }}>{st}</li>)}</ol>
              </details>
            ); })()}
            <div className="flex gap-3 mt-2 text-xs">
              {f.fix && !showIgnored && <button data-as="apply" onClick={() => apply(f)} className="px-2.5 py-1 rounded text-white" style={{ background: "#0F6B5C" }}>Appliquer la correction</button>}
              {!showIgnored ? <button data-as="ignore" onClick={() => ignore(f, true)} className="underline" style={{ color: "#8A8370" }}>Ignorer</button> : <button data-as="unignore" onClick={() => ignore(f, false)} className="underline" style={{ color: "#8A8370" }}>Ne plus ignorer</button>}
            </div>
          </div>
        ))}
      </div>
      {hidden.length > 0 && (
        <button data-as="toggle-ignored" onClick={() => setShowIgnored(!showIgnored)} className="text-xs underline text-left" style={{ color: "#8A8370" }}>{showIgnored ? "← Retour aux points à traiter" : `Voir les ${hidden.length} point(s) ignoré(s)`}</button>
      )}
    </div>
  );
}

