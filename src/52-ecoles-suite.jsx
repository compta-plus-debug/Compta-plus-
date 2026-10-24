// ═══ MODULE ═══
// @module Ecoles suite
// @depends EC_VOCAB, Plus, ecBorder, ecBtn, ecBtnGold, ecDateFr, ecId, ecInput, ecPastille, ecR2, ecReste
//   ecRows, fmt, isLocked, todayStr, uid, useBrouillon, useState
// @exports EcolesRapports, EcolesRelances, EcolesRemises, ecAppliquerRemisesAuxNouvelles, ecTelecharger
// ═══ FIN DE L'EN-TÊTE ═══
// Bloc Écoles — suite : bourses et rabais, impayés et relances, rapports de l'école.
// Les remises réduisent le montant des échéances de l'élève. Sur une échéance déjà constatée en comptabilité, la réduction est
// inscrite par une écriture : Débit 709 (rabais et bourses accordés) [et 445 si l'échéance portait de la TCA] / Crédit 4111.
// Une remise ne peut jamais faire passer une échéance sous ce qui a déjà été payé dessus.

const EC_COMPTE_REMISE = { code: "709", name: "Rabais, remises et bourses accordés (scolarité)", type: "Produit" };

const ecBrut = (c) => (Number(c.gross) > 0 ? Number(c.gross) : ecR2((Number(c.amount) || 0) + (c.remises || []).reduce((s, r) => s + (Number(r.amount) || 0), 0)));

// Une remise concerne-t-elle ce frais ?
const ecRemiseVise = (d, feeId) => !d.feeIds || d.feeIds.length === 0 || d.feeIds.includes(feeId);

// Réductions à appliquer aux échéances données (déjà filtrées sur l'élève et le frais), plafonnées à ce qui reste à payer.
function ecReductions(d, charges) {
  const out = [];
  const valeur = Number(d.value) || 0;
  if (d.kind === "pct") {
    charges.forEach((c) => out.push({ chargeId: c.id, red: ecR2(ecBrut(c) * Math.min(100, valeur) / 100) }));
  } else {
    const totalBrut = charges.reduce((s, c) => s + ecBrut(c), 0);
    let reste = ecR2(valeur);
    charges.forEach((c, i) => {
      const red = i === charges.length - 1 ? reste : ecR2(Math.min(reste, valeur * (totalBrut > 0 ? ecBrut(c) / totalBrut : 0)));
      out.push({ chargeId: c.id, red }); reste = ecR2(reste - red);
    });
  }
  return out.map((o) => {
    const c = charges.find((x) => x.id === o.chargeId);
    const plafond = Math.max(0, ecR2((Number(c.amount) || 0) - (Number(c.paid) || 0)));
    return { chargeId: o.chargeId, red: ecR2(Math.min(o.red, plafond)), voulu: o.red };
  }).filter((o) => o.red > 0);
}

// Applique d'office les remises permanentes d'un élève aux échéances nouvellement créées (jamais encore constatées ni payées).
function ecAppliquerRemisesAuxNouvelles(charges, discounts) {
  return charges.map((c) => {
    let cur = { ...c, gross: ecR2(c.amount), remises: [] };
    (discounts || []).filter((d) => d.studentId === c.studentId && ecRemiseVise(d, c.feeId) && d.status !== "retirée").forEach((d) => {
      const fraisCharges = charges.filter((x) => x.studentId === d.studentId && x.feeId === c.feeId);
      const red = (ecReductions(d, fraisCharges.map((x) => ({ ...x, gross: ecR2(x.amount), remises: [] }))).find((r) => r.chargeId === c.id) || {}).red || 0;
      if (red > 0) cur = { ...cur, amount: ecR2(cur.amount - red), remises: [...cur.remises, { id: d.id, amount: red }] };
    });
    return cur;
  });
}

// ───────────────────────── Bourses et rabais ─────────────────────────
function EcolesRemises({ ecole, setEcole, year, students, fees, charges, canEdit, accounts, setAccounts, setEntries, settings, showToast, logAudit, currentUserEmail, V: Vp }) {
  const V = Vp || EC_VOCAB.ecole;
  const discounts = ecRows(ecole, "discount").filter((d) => !year || d.yearId === year.id);
  const [f, setF] = useBrouillon("ecole-remise", { studentId: "", label: "Bourse", kind: "pct", value: "", feeId: "", reason: "" });
  const stuName = (id) => { const s = students.find((x) => x.id === id); return s ? (s.firstName + " " + s.lastName).trim() : "—"; };
  const feesAnnee = year ? fees.filter((x) => x.yearId === year.id) : [];
  const effet = (d) => ecR2(charges.reduce((s, c) => s + (c.remises || []).filter((r) => r.id === d.id).reduce((t, r) => t + r.amount, 0), 0));

  const appliquer = () => {
    if (!canEdit || !year) return;
    const value = Number(f.value);
    if (!f.studentId || !students.some((s) => s.id === f.studentId)) { showToast("Choisissez " + V.eleveDet + "."); return; }
    if (!f.label.trim()) { showToast("Indiquez le nom de la remise (Bourse, Rabais fratrie…)."); return; }
    if (!(value > 0)) { showToast("Indiquez une valeur supérieure à zéro."); return; }
    if (f.kind === "pct" && value > 100) { showToast("Un pourcentage ne peut pas dépasser 100."); return; }
    if (f.kind === "montant" && !f.feeId) { showToast("Pour un montant fixe, choisissez le frais concerné."); return; }
    if (isLocked(todayStr(), settings)) { showToast("La période comptable est clôturée jusqu'au " + settings.lockDate + " inclus : impossible d'enregistrer une remise."); return; }
    const d = { type: "discount", id: ecId(), studentId: f.studentId, yearId: year.id, label: f.label.trim(), kind: f.kind, value, feeIds: f.feeId ? [f.feeId] : [], reason: f.reason.trim(), createdAt: new Date().toISOString(), by: currentUserEmail || "", status: "active" };
    // échéances déjà créées de cet élève, concernées par la remise
    const cibles = charges.filter((c) => c.studentId === d.studentId && c.yearId === year.id && c.status !== "annulée" && ecRemiseVise(d, c.feeId));
    // le montant fixe se répartit par frais ; le pourcentage s'applique à chaque échéance
    const reds = [];
    if (d.kind === "pct") reds.push(...ecReductions(d, cibles));
    else reds.push(...ecReductions(d, cibles));
    const totalRed = ecR2(reds.reduce((s, r) => s + r.red, 0));
    const voulu = ecR2(reds.reduce((s, r) => s + r.voulu, 0));
    // écriture pour la part déjà constatée en comptabilité
    const parCompte = {}; let tva = 0, total4111 = 0;
    reds.forEach((r) => {
      const c = cibles.find((x) => x.id === r.chargeId);
      if (!c.recognized) return;
      const rate = Number(c.tcaRate) || 0;
      const ht = rate > 0 ? ecR2(r.red / (1 + rate / 100)) : r.red;
      parCompte[c.account] = ecR2((parCompte[c.account] || 0) + ht);
      tva = ecR2(tva + (r.red - ht)); total4111 = ecR2(total4111 + r.red);
    });
    if (total4111 > 0) {
      const lines = [{ account: "709", debit: ecR2(total4111 - tva), credit: 0 }];
      if (tva > 0) lines.push({ account: "445", debit: tva, credit: 0 });
      lines.push({ account: "4111", debit: 0, credit: total4111 });
      if (typeof setAccounts === "function" && !accounts.some((a) => a.code === "709")) setAccounts((prev) => (prev.some((a) => a.code === "709") ? prev : [...prev, EC_COMPTE_REMISE]));
      setEntries((prev) => [...prev, { id: uid(), date: todayStr(), createdAt: new Date().toISOString(), label: (V.slug === "ecole" ? "Remise scolaire « " : "Remise « ") + d.label + " » — " + stuName(d.studentId), lines, kind: "ecole" }]);
    }
    const parCharge = {}; reds.forEach((r) => { parCharge[r.chargeId] = r.red; });
    setEcole((prev) => [...(prev || []).map((x) => (x.type === "charge" && parCharge[x.id] ? { ...x, gross: ecBrut(x), amount: ecR2(x.amount - parCharge[x.id]), remises: [...(x.remises || []), { id: d.id, amount: parCharge[x.id] }] } : x)), d]);
    setF({ ...f, studentId: "", value: "", reason: "" });
    showToast("Remise enregistrée : " + fmt(totalRed) + " de moins à payer" + (voulu > totalRed ? " (limitée à ce qui n'est pas encore payé : " + fmt(voulu) + " demandés)" : "") + ". Elle s'appliquera aussi aux frais ajoutés plus tard.");
    logAudit("Écoles", "Remise accordée", d.label + " — " + stuName(d.studentId) + " — " + fmt(totalRed));
  };

  return (
    <div>
      <div className="text-xs p-2 rounded mb-4" style={{ background: "#F4F1E6", color: "#5B563F" }}>Une bourse ou un rabais (fratrie, personnel, mérite…) réduit ce que {V.eleveDet} doit. Il s'applique aux échéances déjà créées et à celles qui seront créées plus tard. Une remise ne peut pas réduire une échéance en dessous de ce qui a déjà été payé dessus. Elle ne peut pas être retirée : vérifiez avant d'enregistrer.</div>
      {canEdit && year && (
        <div className="ec-card p-4 mb-5">
          <div className="grid md:grid-cols-6 gap-2 items-end">
            <div className="md:col-span-2"><label className="text-xs" style={{ color: "#8A8370" }}>{V.Eleve}</label>
              <select value={f.studentId} onChange={(e) => setF({ ...f, studentId: e.target.value })} data-testid="ecole-remise-eleve" className={ecInput} style={ecBorder}>
                <option value="">— choisir —</option>{students.filter((s) => s.yearId === year.id).map((s) => <option key={s.id} value={s.id}>{(s.firstName + " " + s.lastName).trim()}</option>)}</select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Nom de la remise</label><input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} data-testid="ecole-remise-nom" className={ecInput} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Forme</label>
              <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} data-testid="ecole-remise-forme" className={ecInput} style={ecBorder}><option value="pct">Pourcentage (%)</option><option value="montant">Montant fixe</option></select></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>{f.kind === "pct" ? "Pourcentage" : "Montant"}</label><input type="number" min="0" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} data-testid="ecole-remise-valeur" className={ecInput + " tabular"} style={ecBorder} /></div>
            <div><label className="text-xs" style={{ color: "#8A8370" }}>Frais concerné</label>
              <select value={f.feeId} onChange={(e) => setF({ ...f, feeId: e.target.value })} data-testid="ecole-remise-frais" className={ecInput} style={ecBorder}><option value="">Tous les frais</option>{feesAnnee.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></div>
          </div>
          <div className="flex flex-wrap items-end gap-3 mt-2">
            <div className="flex-1 min-w-[220px]"><label className="text-xs" style={{ color: "#8A8370" }}>Motif (facultatif)</label><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} className={ecInput} style={ecBorder} /></div>
            <button onClick={appliquer} className="px-3 py-2 rounded text-sm" style={ecBtnGold} data-testid="ecole-remise-valider">Accorder la remise</button>
          </div>
        </div>
      )}
      <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">{V.Eleve}</th><th>Remise</th><th>Forme</th><th>Motif</th><th className="text-right">Réduction accordée</th></tr></thead>
        <tbody>{discounts.map((d) => (
          <tr key={d.id} style={{ borderTop: "1px solid #EEE9DA" }} data-testid="ecole-remise-ligne"><td className="py-1.5">{stuName(d.studentId)}</td><td>{d.label}</td><td>{d.kind === "pct" ? d.value + " %" : fmt(d.value)}{d.feeIds && d.feeIds.length ? " sur " + ((fees.find((x) => x.id === d.feeIds[0]) || {}).label || "un frais") : " sur tous les frais"}</td><td className="text-xs">{d.reason || "—"}</td><td className="text-right tabular">{fmt(effet(d))}</td></tr>))}</tbody></table></div>
      {discounts.length === 0 && <div className="text-sm mt-2" style={{ color: "#8A8370" }}>Aucune remise pour cette année.</div>}
    </div>
  );
}

// ───────────────────────── Impayés et relances ─────────────────────────
const EC_RELANCE_DEFAUT = "Bonjour {famille}, l'école vous rappelle que {montant} restent à payer pour la scolarité (échéance la plus ancienne : {depuis}). Merci de passer régler à la caisse. Si vous avez déjà payé, veuillez ignorer ce message.";
const ecRelanceDefaut = (V) => (V && V.etabDet !== "l'école" ? "Bonjour {famille}, " + V.etabDet + " vous rappelle que {montant} restent à payer pour les frais de " + (V.slug === "univ" ? "scolarité" : "formation") + " (échéance la plus ancienne : {depuis}). Merci de passer régler à la caisse. Si vous avez déjà payé, veuillez ignorer ce message." : EC_RELANCE_DEFAUT);
const EC_TRANCHES = [["0-30 jours", 0, 30], ["31-60 jours", 31, 60], ["61-90 jours", 61, 90], ["Plus de 90 jours", 91, 99999]];
const ecJoursEntre = (a, b) => Math.max(0, Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000));

function ecImpayes(charges, today) {
  const par = {};
  charges.filter((c) => c.status !== "annulée" && c.dueDate && c.dueDate <= today && ecReste(c) > 0).forEach((c) => {
    const f = par[c.familyId] || (par[c.familyId] = { familyId: c.familyId, total: 0, plusAncien: c.dueDate, items: [] });
    f.total = ecR2(f.total + ecReste(c)); if (c.dueDate < f.plusAncien) f.plusAncien = c.dueDate; f.items.push(c);
  });
  return Object.values(par).map((f) => ({ ...f, jours: ecJoursEntre(f.plusAncien, today) })).sort((a, b) => b.total - a.total);
}

function ecTelecharger(nom, lignes) {
  const csv = "﻿" + lignes.map((r) => r.map((v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"').join(";")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = nom; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function EcolesRelances({ ecole, setEcole, year, families, students, charges, canAct, today, showToast, logAudit, currentUserEmail, settings, V: Vp, kind: kp }) {
  const V = Vp || EC_VOCAB.ecole, kd = kp || "ecole", cfgId = kd === "ecole" ? "config" : "config-" + kd;
  const reminders = ecRows(ecole, "reminder");
  const cfg = ecRows(ecole, "config")[0] || { id: cfgId, type: "config", relanceMsg: ecRelanceDefaut(V) };
  const [msg, setMsg] = useState(cfg.relanceMsg || ecRelanceDefaut(V));
  const lignes = ecImpayes(year ? charges.filter((c) => c.yearId === year.id) : [], today);
  const fam = (id) => families.find((x) => x.id === id) || {};
  const stuName = (id) => { const s = students.find((x) => x.id === id); return s ? (s.firstName + " " + s.lastName).trim() : "—"; };
  const texte = (l) => msg.replace(/\{famille\}/g, fam(l.familyId).name || "").replace(/\{montant\}/g, fmt(l.total)).replace(/\{depuis\}/g, ecDateFr(l.plusAncien)).replace(/\{ecole\}/g, settings.companyName || V.etabDet);
  const derniere = (id) => reminders.filter((r) => r.familyId === id).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  const nb = (id) => reminders.filter((r) => r.familyId === id).length;
  const chiffres = (t) => String(t || "").replace(/[^\d]/g, "");
  const noter = (l, canal) => {
    setEcole((prev) => [...(prev || []), { type: "reminder", id: ecId(), familyId: l.familyId, date: today, channel: canal, amount: l.total, by: currentUserEmail || "", createdAt: new Date().toISOString() }]);
    logAudit("Écoles", "Relance", (fam(l.familyId).name || "") + " — " + canal + " — " + fmt(l.total));
  };
  const copier = async (l) => {
    try { await navigator.clipboard.writeText(texte(l)); showToast("Message copié : collez-le dans WhatsApp, un SMS ou un e-mail."); } catch (e) { showToast("Copie impossible sur cet appareil : sélectionnez le texte du message ci-dessous."); }
    noter(l, "message copié");
  };
  const sauverMessage = () => {
    setEcole((prev) => { const rest = (prev || []).filter((r) => !(r.type === "config" && (r.etab || "ecole") === kd)); return [...rest, { type: "config", id: cfgId, relanceMsg: msg }]; });
    showToast("Message de relance enregistré.");
  };
  const exporter = () => {
    ecTelecharger("impayes-" + (V.slug === "ecole" ? "ecole" : V.slug) + "-" + today + ".csv", [[V.Famille, "Téléphone", V.Eleves, "Échéance la plus ancienne", "Jours de retard", "Reste à payer"], ...lignes.map((l) => [fam(l.familyId).name || "", fam(l.familyId).phone || "", [...new Set(l.items.map((c) => stuName(c.studentId)))].join(" ; "), ecDateFr(l.plusAncien), l.jours, l.total])]);
  };
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="text-sm" style={{ color: "#152238" }}><span data-testid="ecole-relance-nb">{lignes.length}</span> {V.famille}(s) avec des impayés échus{year ? " — " + year.label : ""}</div>
        <button onClick={exporter} disabled={!lignes.length} className="px-3 py-1.5 rounded text-sm" style={{ ...ecBtn, opacity: lignes.length ? 1 : 0.5 }} data-testid="ecole-relance-export">Exporter la liste (tableur)</button>
      </div>
      {canAct && (
        <div className="ec-card p-4 mb-4">
          <label className="text-xs" style={{ color: "#8A8370" }}>Message de relance (mots remplacés automatiquement : {"{famille}"}, {"{montant}"}, {"{depuis}"}, {"{ecole}"})</label>
          <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={3} data-testid="ecole-relance-message" className={ecInput} style={ecBorder} />
          <button onClick={sauverMessage} className="mt-2 px-3 py-1.5 rounded text-xs" style={ecBtn} data-testid="ecole-relance-enregistrer">Enregistrer ce message</button>
        </div>
      )}
      {lignes.length === 0 ? <div className="text-sm" style={{ color: "#8A8370" }}>Aucun impayé échu : rien à relancer.</div> : (
        <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">{V.Famille}</th><th>Retard</th><th className="text-right">Reste à payer</th><th>Dernière relance</th><th></th></tr></thead>
          <tbody>{lignes.map((l) => { const f = fam(l.familyId); const d = derniere(l.familyId); const wa = chiffres(f.phone); return (
            <tr key={l.familyId} style={{ borderTop: "1px solid #EEE9DA" }} data-testid="ecole-relance-ligne">
              <td className="py-1.5">{f.name || "—"}<div className="text-xs" style={{ color: "#8A8370" }}>{[...new Set(l.items.map((c) => stuName(c.studentId)))].join(", ")}</div></td>
              <td className="text-xs">{ecPastille(l.jours + " j de retard", l.jours > 60 ? "alerte" : l.jours > 30 ? "attente" : "neutre")}<div style={{ color: "#8A8370", marginTop: 2 }}>depuis le {ecDateFr(l.plusAncien)}</div></td>
              <td className="text-right tabular">{fmt(l.total)}</td>
              <td className="text-xs">{d ? ecDateFr(d.date) + " (" + nb(l.familyId) + " relance" + (nb(l.familyId) > 1 ? "s" : "") + ")" : "Jamais relancée"}</td>
              <td className="text-right whitespace-nowrap">
                {f.phone && <a href={"tel:" + f.phone} onClick={() => canAct && noter(l, "appel")} className="text-xs underline mr-3" style={{ color: "#0F6B5C" }} data-testid="ecole-relance-appel">Appeler</a>}
                {wa.length >= 8 && <a href={"https://wa.me/" + wa + "?text=" + encodeURIComponent(texte(l))} target="_blank" rel="noopener noreferrer" onClick={() => canAct && noter(l, "WhatsApp")} className="text-xs underline mr-3" style={{ color: "#0F6B5C" }} data-testid="ecole-relance-wa">WhatsApp</a>}
                <button onClick={() => copier(l)} className="text-xs underline" data-testid="ecole-relance-copier">Copier le message</button>
              </td></tr>); })}</tbody></table></div>
      )}
    </div>
  );
}

// ───────────────────────── Rapports ─────────────────────────
function EcolesRapports({ year, classes, students, families, charges, receipts, today, showToast, V: Vp }) {
  const V = Vp || EC_VOCAB.ecole;
  const [du, setDu] = useBrouillon("ecole-rapport-journal", { du: today.slice(0, 8) + "01", au: today });
  const yCharges = year ? charges.filter((c) => c.yearId === year.id && c.status !== "annulée") : [];
  const parClasse = (year ? classes.filter((c) => c.yearId === year.id) : []).map((c) => {
    const ids = new Set(students.filter((s) => s.classId === c.id).map((s) => s.id));
    const cc = yCharges.filter((x) => ids.has(x.studentId));
    const attendu = ecR2(cc.reduce((s, x) => s + x.amount, 0)), paye = ecR2(cc.reduce((s, x) => s + (x.paid || 0), 0));
    const echu = ecR2(cc.filter((x) => x.dueDate <= today).reduce((s, x) => s + x.amount, 0));
    const impaye = ecR2(cc.filter((x) => x.dueDate <= today).reduce((s, x) => s + ecReste(x), 0));
    return { id: c.id, nom: c.name, eleves: students.filter((s) => s.classId === c.id && s.status !== "sorti").length, attendu, paye, impaye, taux: echu > 0 ? Math.round(((echu - impaye) / echu) * 100) : null };
  });
  const tranches = EC_TRANCHES.map(([lib, a, b]) => {
    const l = yCharges.filter((c) => c.dueDate <= today && ecReste(c) > 0 && ecJoursEntre(c.dueDate, today) >= a && ecJoursEntre(c.dueDate, today) <= b);
    return { lib, nb: new Set(l.map((c) => c.familyId)).size, total: ecR2(l.reduce((s, c) => s + ecReste(c), 0)) };
  });
  const jr = receipts.filter((r) => r.status !== "annulé" && r.date >= du.du && r.date <= du.au).sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.number).localeCompare(String(b.number)));
  const totalMode = (m) => ecR2(jr.filter((r) => r.mode === m).reduce((s, r) => s + r.amount, 0));
  const parAuteur = {}; jr.forEach((r) => { const k = r.by || "—"; parAuteur[k] = ecR2((parAuteur[k] || 0) + r.amount); });
  const famName = (id) => (families.find((f) => f.id === id) || {}).name || "—";
  const exporterJournal = () => ecTelecharger("journal-caisse-" + V.slug + "-" + du.du + "_" + du.au + ".csv", [["Reçu", "Date", V.Famille, "Mode", "Montant", "Encaissé par"], ...jr.map((r) => [r.number, ecDateFr(r.date), famName(r.familyId), r.mode === "banque" ? "Banque" : "Espèces", r.amount, r.by || ""])]);
  const exporterClasses = () => ecTelecharger("situation-par-" + V.classe + "-" + today + ".csv", [[V.Classe, V.Eleves, "Frais attendus", "Encaissé", "Impayés échus", "Taux de recouvrement (%)"], ...parClasse.map((c) => [c.nom, c.eleves, c.attendu, c.paye, c.impaye, c.taux == null ? "" : c.taux])]);
  return (
    <div>
      <div className="flex items-center justify-between mb-2"><div className="display text-base" style={{ color: "#152238" }}>Situation par {V.classe}{year ? " — " + year.label : ""}</div><button onClick={exporterClasses} className="text-xs underline" data-testid="ecole-rapport-export-classes">Exporter</button></div>
      <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">{V.Classe}</th><th className="text-right">{V.Eleves}</th><th className="text-right">Frais attendus</th><th className="text-right">Encaissé</th><th className="text-right">Impayés échus</th><th className="text-right">Recouvrement</th></tr></thead>
        <tbody>{parClasse.map((c) => (<tr key={c.id} style={{ borderTop: "1px solid #EEE9DA" }} data-testid="ecole-rapport-classe"><td className="py-1.5">{c.nom}</td><td className="text-right">{c.eleves}</td><td className="text-right tabular">{fmt(c.attendu)}</td><td className="text-right tabular">{fmt(c.paye)}</td><td className="text-right tabular">{fmt(c.impaye)}</td><td className="text-right">{c.taux == null ? "—" : c.taux + " %"}</td></tr>))}</tbody></table></div>
      <div className="display text-base mb-2" style={{ color: "#152238" }}>Âge des impayés</div>
      <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Ancienneté</th><th className="text-right">{V.Familles}</th><th className="text-right">Montant</th></tr></thead>
        <tbody>{tranches.map((t) => (<tr key={t.lib} style={{ borderTop: "1px solid #EEE9DA" }} data-testid="ecole-rapport-tranche"><td className="py-1.5">{t.lib}</td><td className="text-right">{t.nb}</td><td className="text-right tabular">{fmt(t.total)}</td></tr>))}</tbody></table></div>
      <div className="flex flex-wrap items-end gap-3 mb-2">
        <div className="display text-base mr-3" style={{ color: "#152238" }}>Journal de caisse</div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Du</label><input type="date" value={du.du} onChange={(e) => setDu({ ...du, du: e.target.value })} data-testid="ecole-journal-du" className="block border rounded px-2 py-1 text-sm" style={ecBorder} /></div>
        <div><label className="text-xs" style={{ color: "#8A8370" }}>Au</label><input type="date" value={du.au} onChange={(e) => setDu({ ...du, au: e.target.value })} data-testid="ecole-journal-au" className="block border rounded px-2 py-1 text-sm" style={ecBorder} /></div>
        <button onClick={exporterJournal} disabled={!jr.length} className="px-3 py-1.5 rounded text-sm" style={{ ...ecBtn, opacity: jr.length ? 1 : 0.5 }} data-testid="ecole-journal-export">Exporter</button>
      </div>
      <div className="text-sm mb-2" style={{ color: "#152238" }}>{jr.length} reçu(s) · espèces <b className="tabular" data-testid="ecole-journal-especes">{fmt(totalMode("caisse"))}</b> · banque <b className="tabular" data-testid="ecole-journal-banque">{fmt(totalMode("banque"))}</b> · total <b className="tabular" data-testid="ecole-journal-total">{fmt(ecR2(jr.reduce((s, r) => s + r.amount, 0)))}</b></div>
      {Object.keys(parAuteur).length > 0 && <div className="text-xs mb-2" style={{ color: "#7A7460" }}>Par personne : {Object.keys(parAuteur).map((k) => k + " " + fmt(parAuteur[k])).join(" · ")}</div>}
      <div className="ec-wrap"><table className="ec-table"><thead><tr className="text-left text-xs" style={{ color: "#8A8370" }}><th className="py-1">Reçu</th><th>Date</th><th>{V.Famille}</th><th>Mode</th><th className="text-right">Montant</th><th>Encaissé par</th></tr></thead>
        <tbody>{jr.map((r) => (<tr key={r.id} style={{ borderTop: "1px solid #EEE9DA" }} data-testid="ecole-journal-ligne"><td className="py-1.5 tabular text-xs">{r.number}</td><td>{ecDateFr(r.date)}</td><td>{famName(r.familyId)}</td><td>{r.mode === "banque" ? "Banque" : "Espèces"}</td><td className="text-right tabular">{fmt(r.amount)}</td><td className="text-xs">{r.by || "—"}</td></tr>))}</tbody></table></div>
    </div>
  );
}
