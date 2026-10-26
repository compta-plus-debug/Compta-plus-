// ═══ MODULE ═══
// @module Facturation abonnements
// @depends FALLBACK_HTG_PER_USD, SECTEURS_CATALOGUE, fetchHtgPerUsd, friendlyError, supabase, todayStr
//   useEffect, useState
// @exports BillingAdminPanel, FB_WA_MODELES, fbEnregistrerContact, fbTelValide, fbWaLien, fbWaTexte
// ═══ FIN DE L'EN-TÊTE ═══
// Facturation des abonnements de Compta+ à ses clients.
//  • À la création d'une entreprise : facture d'inscription à 0 (émise par la base, voir le script SQL) ;
//  • chaque mois : facture du forfait + suppléments de blocs, émise par le Super admin (bouton « Émettre les factures du mois ») ;
//  • première facture payante : prorata du mois en cours à la fin de l'essai ;
//  • changement en cours de mois : facture complémentaire au prorata des jours (une baisse s'applique au mois suivant) ;
//  • prix en dollars, facture établie en gourdes au taux affiché ; TCA en option (taux modifiable).
// Une facture n'est jamais effacée : elle s'annule avec un motif.

const FB_PRIX_DEFAUT = { standard: 20, assisted: 80, group: 350, pack: 12, A: 8, B: 5, C: 3 };
const FB_GRILLE_DEFAUT = { ecoles: "A", import_export: "A", industrie: "A", sante: "B", ong: "B", btp: "C", immobilier: "C", restauration: "C", transport: "C", agriculture: "C" };
const FB_DELAI_JOURS = 15; // une facture non payée après 15 jours est « en retard » (rappel)
const fbR2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fbPad = (n) => String(n).padStart(2, "0");
const fbDateFr = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); return m ? m[3] + "/" + m[2] + "/" + m[1] : String(iso || ""); };
const fbHtg = (n) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " G";
const fbUsd = (n) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " USD";
const fbAjouteJours = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.getFullYear() + "-" + fbPad(d.getMonth() + 1) + "-" + fbPad(d.getDate()); };
const fbEntreJours = (a, b) => Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 86400000);
const fbTier = (t) => (t === "assisted" ? "assisted" : t === "group" ? "group" : "standard");
const fbConfig = (row) => {
  const r = row || {};
  return {
    issuer_name: r.issuer_name || "Compta+", issuer_address: r.issuer_address || "", issuer_phone: r.issuer_phone || "", issuer_email: r.issuer_email || "", issuer_nif: r.issuer_nif || "",
    logo: r.logo || "", thanks: r.thanks || "Merci de votre confiance !", payment_info: r.payment_info || "",
    vat_enabled: !!r.vat_enabled, vat_rate: r.vat_rate != null ? Number(r.vat_rate) : 10, rate_htg_per_usd: Number(r.rate_htg_per_usd) || 0,
    prices: { ...FB_PRIX_DEFAUT, ...(r.prices || {}) }, grid: { ...FB_GRILLE_DEFAUT, ...(r.grid || {}) },
    rem_subject: r.reminder_email_subject || FB_MSG_DEFAUT.subject, rem_body: r.reminder_email_body || FB_MSG_DEFAUT.body, rem_wa: r.reminder_whatsapp_body || FB_MSG_DEFAUT.wa,
  };
};
// ───────── Relances : messages types, numéro WhatsApp, e-mail ─────────
const FB_MSG_DEFAUT = {
  subject: "Rappel : facture {numero} à régler",
  body: "Bonjour {client},\n\nSauf erreur de notre part, la facture {numero} de {montant}, à régler avant le {echeance} ({jours} jour(s) de retard), n'est pas encore payée.\n\n{paiement}\n\nVous la retrouvez dans Compta+ : Administration, Accès, Abonnement et factures.\nSi vous avez déjà payé, ignorez ce message.\n\nMerci,\n{emetteur}",
  wa: "Bonjour {client}, ici {emetteur}. Votre facture {numero} de {montant} était à régler avant le {echeance}. {paiement} Si c'est déjà payé, ignorez ce message. Merci !",
};
const FB_WA_MODELES = {
  contact: "Bonjour {client}, ici {emetteur}. ",
  nouveaute: "Bonjour {client}, ici {emetteur}. Une nouveauté vient d'arriver dans Compta+ : ",
  offre: "Bonjour {client}, ici {emetteur}. Une offre pour vous : ",
};
const fbWaLien = (tel, texte) => "https://wa.me/" + fbTelChiffres(tel) + "?text=" + encodeURIComponent(texte);
const fbWaTexte = (modele, nom, cfg) => String(modele || "").split("{client}").join(nom || "").split("{emetteur}").join((cfg && cfg.issuer_name) || "Compta+");
const FB_RELANCE_PAUSE_JOURS = 3; // pas de nouvelle relance de masse avant 3 jours
// Numéro pour WhatsApp : chiffres seulement, indicatif Haïti (509) ajouté si le numéro a 8 chiffres
const fbTelChiffres = (t) => { let d = String(t || "").replace(/\D/g, ""); if (d.startsWith("00")) d = d.slice(2); if (d.length === 8) d = "509" + d; return d; };
const fbTelValide = (t) => fbTelChiffres(t).length >= 10 && fbTelChiffres(t).length <= 15;
function fbMessage(cfg, inv, today) {
  const jours = inv.due_date ? Math.max(0, fbEntreJours(inv.due_date, today)) : 0;
  const pay = cfg.payment_info ? "Comment payer : " + String(cfg.payment_info).replace(/\s*\n+\s*/g, " ; ") : "";
  const rempl = (t) => String(t || "").split("{client}").join(inv.client_name || "").split("{numero}").join(inv.number || "").split("{montant}").join(fbHtg(inv.total_htg)).split("{echeance}").join(fbDateFr(inv.due_date)).split("{jours}").join(String(jours)).split("{emetteur}").join(cfg.issuer_name || "Compta+").split("{paiement}").join(pay);
  return { subject: rempl(cfg.rem_subject), body: rempl(cfg.rem_body), wa: rempl(cfg.rem_wa).replace(/\s{2,}/g, " ").trim() };
}
const fbEchapper = (t) => String(t || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fbHtmlMail = (texte) => '<div style="font-family:Arial,sans-serif;font-size:14px;color:#152238;max-width:560px;margin:0 auto;padding:20px;border:1px solid #E4DFD1;border-radius:10px">' + fbEchapper(texte).replace(/\n/g, "<br>") + "</div>";
// Coordonnées de contact de l'entreprise (téléphone WhatsApp et accord pour recevoir les nouvelles de Compta+)
async function fbEnregistrerContact(companyId, phone, optin) {
  if (!companyId) return { error: null };
  const row = { phone: String(phone || "").trim(), whatsapp_optin: !!optin, whatsapp_optin_at: optin ? new Date().toISOString() : null };
  try { const { error } = await supabase.from("companies").update(row).eq("id", companyId); return { error: error || null }; } catch (e) { return { error: e }; }
}
// Mois qui contient la date : début, fin, nombre de jours
function fbPeriode(dateIso) {
  const [y, m] = String(dateIso).split("-").map(Number);
  const jours = new Date(y, m, 0).getDate();
  return { start: y + "-" + fbPad(m) + "-01", end: y + "-" + fbPad(m) + "-" + fbPad(jours), jours };
}
// Lignes d'un mois complet pour une entreprise (ou un groupe) : forfait + suppléments de blocs
function fbLignes(entity, cfg) {
  const P = cfg.prices, tier = fbTier(entity.plan_tier);
  const base = { standard: ["Forfait Standard — abonnement mensuel", P.standard], assisted: ["Forfait Assisté — abonnement mensuel", P.assisted], group: ["Forfait Extension (jusqu'à 5 entreprises) — abonnement mensuel", P.group] }[tier];
  const lines = [{ label: base[0], qty: 1, unit_usd: fbR2(base[1]), total_usd: fbR2(base[1]) }];
  if (tier === "standard") {
    if (entity.sector_pack) lines.push({ label: "Pack 3 secteurs d'activité", qty: 1, unit_usd: fbR2(P.pack), total_usd: fbR2(P.pack) });
    else (entity.extra_blocks || []).forEach((id) => {
      const lab = ((typeof SECTEURS_CATALOGUE !== "undefined" ? SECTEURS_CATALOGUE : []).find((s) => s.id === id) || {}).label || id;
      const prix = fbR2(P[cfg.grid[id] || "C"]);
      lines.push({ label: "Bloc « " + lab + " »", qty: 1, unit_usd: prix, total_usd: prix });
    });
  }
  return { lines, full: fbR2(lines.reduce((s, l) => s + l.total_usd, 0)) };
}
// Totaux : sous-total en dollars, converti en gourdes au taux affiché, TCA optionnelle sur le sous-total en gourdes
function fbCalcTotaux(lines, rate, vatEnabled, vatRate) {
  const subUsd = fbR2(lines.reduce((s, l) => s + (Number(l.total_usd) || 0), 0));
  const subHtg = fbR2(subUsd * (Number(rate) || 0));
  const vatHtg = vatEnabled ? fbR2(subHtg * (Number(vatRate) || 0) / 100) : 0;
  return { subtotal_usd: subUsd, subtotal_htg: subHtg, vat_htg: vatHtg, total_htg: fbR2(subHtg + vatHtg) };
}
function fbBrouillon({ company_id, client_name, kind, period, issue_date, lines, full, rate, vatEnabled, vatRate }) {
  const t = fbCalcTotaux(lines, rate, vatEnabled, vatRate);
  return { company_id, client_name, kind, period_start: period.start, period_end: period.end, issue_date, due_date: fbAjouteJours(issue_date, FB_DELAI_JOURS), status: "emise", lines,
    subtotal_usd: t.subtotal_usd, monthly_full_usd: full, rate_htg_per_usd: rate, subtotal_htg: t.subtotal_htg, vat_enabled: !!vatEnabled, vat_rate: vatEnabled ? Number(vatRate) || 0 : 0, vat_htg: t.vat_htg, total_htg: t.total_htg };
}
// Texte ajouté à la ligne du forfait Extension : nom du groupe et entreprises couvertes
function fbNoteGroupe(g, membres) { return " — groupe « " + g.name + " » : " + (membres || []).map((m) => m.name).join(", "); }
// Émission du mois. Renvoie { drafts, inscriptions } : les factures mensuelles à créer et les factures d'inscription (à 0) manquantes.
function fbEmission({ companies, groups, invoices, cfg, date, rate, vatEnabled, vatRate }) {
  const per = fbPeriode(date);
  const actives = (invoices || []).filter((i) => i.status !== "annulee");
  const dejaMensuelle = (cid) => actives.some((i) => i.company_id === cid && i.kind === "mensuelle" && i.period_end === per.end);
  const drafts = [];
  const mensuelle = (co, entity, nom, note) => {
    if (dejaMensuelle(co.id)) return;
    const { lines, full } = fbLignes(entity, cfg);
    let ls = lines, from = per.start;
    if (note) ls = lines.map((l, i) => (i === 0 ? { ...l, label: l.label + note } : l));
    // première facture payante : prorata à partir de la fin de l'essai quand elle tombe dans le mois
    const fin = co.trial_ends_at ? String(co.trial_ends_at).slice(0, 10) : "";
    if (fin && fin >= per.start && fin <= per.end) from = fbAjouteJours(fin, 1);
    if (from > per.end) return; // essai jusqu'à la fin du mois : première facture le mois suivant
    if (from > per.start) {
      const restant = fbEntreJours(from, per.end) + 1;
      ls = lines.map((l) => { const t = fbR2(l.total_usd * restant / per.jours); return { ...l, label: l.label + " (prorata " + restant + "/" + per.jours + " jours)", unit_usd: t, total_usd: t }; });
    }
    drafts.push(fbBrouillon({ company_id: co.id, client_name: nom || co.name, kind: "mensuelle", period: { start: from, end: per.end }, issue_date: date, lines: ls, full, rate, vatEnabled, vatRate }));
    drafts[drafts.length - 1].period_start = from;
  };
  const groupIds = new Set((groups || []).map((g) => g.id));
  (groups || []).filter((g) => g.plan_status === "active").forEach((g) => {
    const membres = (companies || []).filter((c) => c.group_id === g.id).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    // Facturée à l'entreprise principale du groupe (la plus ancienne) : son propre nom, jamais celui d'une autre entreprise ; le groupe et les entreprises couvertes sont rappelés sur la ligne
    if (membres.length) mensuelle({ ...membres[0], trial_ends_at: null }, { plan_tier: "group" }, membres[0].name, fbNoteGroupe(g, membres));
  });
  (companies || []).filter((c) => c.plan_status === "active" && !(c.group_id && groupIds.has(c.group_id)) && !c.group_id).forEach((c) => mensuelle(c, c, c.name));
  const inscriptions = (companies || []).filter((c) => !c.group_id && !actives.some((i) => i.company_id === c.id && i.kind === "inscription")).map((c) => {
    const fin = c.trial_ends_at ? String(c.trial_ends_at).slice(0, 10) : date;
    return { company_id: c.id, client_name: c.name, kind: "inscription", period_start: String(c.created_at || date).slice(0, 10), period_end: fin, issue_date: String(c.created_at || date).slice(0, 10), due_date: null, status: "gratuite",
      lines: [{ label: "Inscription — période d'essai gratuite jusqu'au " + fbDateFr(fin), qty: 1, unit_usd: 0, total_usd: 0 }], subtotal_usd: 0, monthly_full_usd: null, rate_htg_per_usd: rate, subtotal_htg: 0, vat_enabled: false, vat_rate: 0, vat_htg: 0, total_htg: 0 };
  });
  return { drafts, inscriptions };
}
// Facture complémentaire : hausse du forfait ou des blocs en cours de mois, au prorata des jours restants
function fbComplement({ company, group, invoices, cfg, date, rate, vatEnabled, vatRate, membres }) {
  const per = fbPeriode(date);
  const entity = group ? { plan_tier: "group" } : company;
  const nom = company.name;   // toujours le nom de l'entreprise à laquelle la facture est rattachée
  const liste = (invoices || []).filter((i) => i.status !== "annulee" && i.company_id === company.id && (i.kind === "mensuelle" || i.kind === "complement") && String(i.issue_date).slice(0, 7) === per.start.slice(0, 7))
    .sort((a, b) => String(a.number).localeCompare(String(b.number)));
  if (!liste.length) return { error: "Aucune facture mensuelle pour ce mois : utilisez d'abord « Émettre les factures du mois »." };
  const dernier = liste[liste.length - 1];
  const { full } = fbLignes(entity, cfg);
  const ecart = fbR2(full - (Number(dernier.monthly_full_usd) || 0));
  if (ecart <= 0) return { error: "Aucune hausse à facturer : une baisse s'applique au mois suivant (pas d'avoir)." };
  const restant = fbEntreJours(date, per.end) + 1;
  const total = fbR2(ecart * restant / per.jours);
  const lines = [{ label: "Changement d'abonnement" + (group ? " du groupe « " + group.name + " »" : "") + " : + " + fbUsd(ecart) + " par mois, du " + fbDateFr(date) + " au " + fbDateFr(per.end) + " (" + restant + "/" + per.jours + " jours)", qty: 1, unit_usd: total, total_usd: total }];
  return { draft: { ...fbBrouillon({ company_id: company.id, client_name: nom, kind: "complement", period: { start: date, end: per.end }, issue_date: date, lines, full, rate, vatEnabled, vatRate }) } };
}

// ───────── Numérotation : la base attribue FA-AAAA-000001 ; repli local si la fonction n'est pas disponible ─────────
async function fbNumero(date, local) {
  try {
    const { data, error } = await supabase.rpc("billing_next_number", { p_date: date });
    if (!error && typeof data === "string" && data) return data;
  } catch (e) { /* repli */ }
  const yy = String(date).slice(0, 4);
  local.n = Math.max(local.n, ...(local.list || []).filter((i) => String(i.number).startsWith("FA-" + yy + "-")).map((i) => Number(String(i.number).split("-")[2]) || 0)) + 1;
  return "FA-" + yy + "-" + String(local.n).padStart(6, "0");
}

// ───────── Feuille de facture imprimable : du logo au mot de remerciement ─────────
function FbFeuille({ inv, cfg }) {
  const statutNote = inv.status === "annulee" ? "ANNULÉE" : inv.status === "payee" ? "PAYÉE" : inv.status === "gratuite" ? "GRATUITE — période d'essai" : "";
  return (
    <div style={{ color: "#152238", background: "#fff", fontFamily: "'Inter', sans-serif", fontSize: 13, width: "100%", maxWidth: 794, margin: "0 auto", padding: "32px 36px", boxSizing: "border-box" }} data-testid="fb-feuille">
      <div style={{ textAlign: "center", marginBottom: 14 }}>
        {cfg.logo ? <img src={cfg.logo} alt="" style={{ maxWidth: 120, maxHeight: 70, objectFit: "contain", margin: "0 auto 6px", display: "block" }} /> : null}
        <div style={{ fontWeight: 700, fontSize: 20 }}>{cfg.issuer_name}</div>
        {cfg.issuer_address && <div style={{ fontSize: 12 }}>{cfg.issuer_address}</div>}
        {(cfg.issuer_phone || cfg.issuer_email) && <div style={{ fontSize: 12 }}>{[cfg.issuer_phone, cfg.issuer_email].filter(Boolean).join(" · ")}</div>}
        {cfg.issuer_nif && <div style={{ fontSize: 12 }}>NIF : {cfg.issuer_nif}</div>}
      </div>
      <div style={{ fontWeight: 700, fontSize: 18, textAlign: "center", marginBottom: 4 }}>FACTURE</div>
      {statutNote && <div style={{ textAlign: "center", fontWeight: 700, marginBottom: 6 }}>{statutNote}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <div>N° <b data-testid="fb-feuille-numero">{inv.number}</b><br />Date : {fbDateFr(inv.issue_date)}{inv.due_date ? <><br />À payer avant le : {fbDateFr(inv.due_date)}</> : null}</div>
        <div style={{ textAlign: "right" }}>Facturé à :<br /><b>{inv.client_name}</b>{inv.period_start ? <><br />Période : du {fbDateFr(inv.period_start)} au {fbDateFr(inv.period_end)}</> : null}</div>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 8 }}>
        <thead><tr style={{ borderBottom: "1px solid #152238", textAlign: "left" }}><th style={{ padding: "4px 0" }}>Désignation</th><th style={{ textAlign: "right" }}>Quantité</th><th style={{ textAlign: "right" }}>Prix unitaire</th><th style={{ textAlign: "right" }}>Montant</th></tr></thead>
        <tbody>{(inv.lines || []).map((l, i) => (<tr key={i} style={{ borderBottom: "1px dashed #BBB" }}><td style={{ padding: "5px 0" }}>{l.label}</td><td style={{ textAlign: "right" }}>{l.qty}</td><td style={{ textAlign: "right" }}>{fbUsd(l.unit_usd)}</td><td style={{ textAlign: "right" }}>{fbUsd(l.total_usd)}</td></tr>))}</tbody>
      </table>
      <div style={{ textAlign: "right", lineHeight: 1.7 }}>
        <div>Sous-total : {fbUsd(inv.subtotal_usd)}</div>
        <div>Taux de conversion : 1 USD = {fbHtg(inv.rate_htg_per_usd)}</div>
        <div>Sous-total en gourdes : {fbHtg(inv.subtotal_htg)}</div>
        {inv.vat_enabled && <div>TCA ({inv.vat_rate} %) : {fbHtg(inv.vat_htg)}</div>}
        <div style={{ fontWeight: 700, fontSize: 18 }}>Total à payer : <span data-testid="fb-feuille-total">{fbHtg(inv.total_htg)}</span></div>
      </div>
      {inv.status === "payee" && <div style={{ marginTop: 8 }}>Payée le {fbDateFr(inv.paid_at)}{inv.payment_method ? " — " + inv.payment_method : ""}{inv.payment_ref ? " (réf. " + inv.payment_ref + ")" : ""}.</div>}
      {cfg.payment_info && inv.status === "emise" && <div style={{ marginTop: 12, fontSize: 12, whiteSpace: "pre-line" }}><b>Comment payer :</b><br />{cfg.payment_info}</div>}
      <div style={{ marginTop: 16, textAlign: "center", fontSize: 13 }}>{cfg.thanks}</div>
    </div>
  );
}
function FbApercu({ inv, cfg, onClose }) {
  return (
    <>
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto p-3 md:p-8 no-print" style={{ background: "rgba(21,34,56,0.55)" }} onClick={onClose} data-testid="fb-apercu">
        <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 820 }}>
          <div className="flex items-center justify-between mb-2"><div className="text-sm" style={{ color: "#EFE9DD" }}>Facture {inv.number}</div>
            <div className="flex gap-2"><button onClick={() => { try { window.print(); } catch (e) {} }} className="px-3 py-1.5 rounded text-sm" style={{ background: "#C9A24B", color: "#152238", fontWeight: 600 }} data-testid="fb-imprimer">Imprimer</button><button onClick={onClose} className="px-3 py-1.5 rounded text-sm" style={{ background: "#1F3358", color: "#EFE9DD" }}>Fermer</button></div></div>
          <div className="rounded shadow-lg overflow-hidden" style={{ background: "#fff" }}><FbFeuille inv={inv} cfg={cfg} /></div>
        </div>
      </div>
      <div className="print-only"><FbFeuille inv={inv} cfg={cfg} /></div>
    </>
  );
}
const fbEtat = (inv, today) => (inv.status === "annulee" ? ["Annulée", "#8A8370"] : inv.status === "payee" ? ["Payée", "#0F6B5C"] : inv.status === "gratuite" ? ["Gratuite", "#3F4F73"] : inv.due_date && inv.due_date < today ? ["En retard", "#A6432F"] : ["À payer", "#9A7B1E"]);
const fbCell = { border: "1px solid #DDD6C4", borderRadius: 6, padding: "4px 8px", width: "100%", background: "#fff" };
const fbBtn = { background: "#152238", color: "#EFE9DD", borderRadius: 6, padding: "6px 12px", fontSize: 13 };
const fbBtnOr = { background: "#C9A24B", color: "#152238", borderRadius: 6, padding: "6px 12px", fontSize: 13, fontWeight: 600 };

async function fbChargerConfig() {
  try { const { data } = await supabase.from("billing_settings").select("*").eq("id", 1).maybeSingle(); return fbConfig(data); } catch (e) { return fbConfig(null); }
}

// ───────── Cartes graphiques (même présentation que le reste de l'application) ─────────
const fbCarte = { background: "#fff", border: "1px solid #E4DFD1", borderRadius: 14, padding: "18px 20px", boxShadow: "0 1px 3px rgba(21,34,56,0.06)", boxSizing: "border-box", maxWidth: "100%", minWidth: 0 };
function FbTitre({ couleur, titre, sous, droite }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "stretch", minWidth: 0 }}>
        <div style={{ width: 4, borderRadius: 4, background: couleur || "#C9A24B", flex: "0 0 4px" }} />
        <div style={{ minWidth: 0 }}><div className="display text-base" style={{ color: "#152238" }}>{titre}</div>{sous && <div className="text-xs" style={{ color: "#8A8370", marginTop: 2 }}>{sous}</div>}</div>
      </div>
      {droite}
    </div>
  );
}
const FB_BADGES = { "Annulée": ["#EEE9DA", "#6F6A5A"], "Payée": ["#E1F1EC", "#0F6B5C"], "Gratuite": ["#E4E9F5", "#3F4F73"], "En retard": ["#F7E3DD", "#A6432F"], "À payer": ["#FBF1DC", "#9A7B1E"] };
function FbBadge({ texte }) { const [bg, fg] = FB_BADGES[texte] || ["#EEE9DA", "#6F6A5A"]; return <span style={{ background: bg, color: fg, borderRadius: 999, padding: "2px 10px", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>{texte}</span>; }
// ───────── Écran client : « Abonnement et factures » (administrateur de l'entreprise) ─────────
function BillingClientPanel({ companyId, showToast }) {
  const [rows, setRows] = useState(null);
  const [cfg, setCfg] = useState(fbConfig(null));
  const [voir, setVoir] = useState(null);
  const [tel, setTel] = useState("");
  const [optin, setOptin] = useState(false);
  const [contactOk, setContactOk] = useState(null);
  const today = todayStr();
  useEffect(() => {
    let vivant = true;
    (async () => {
      const c = await fbChargerConfig();
      const { data, error } = await supabase.from("billing_invoices").select("*").eq("company_id", companyId).order("issue_date", { ascending: false });
      let ct = null;
      try { const r = await supabase.from("companies").select("phone, whatsapp_optin").eq("id", companyId).maybeSingle(); ct = r && r.data ? r.data : null; } catch (e) { ct = null; }
      if (!vivant) return;
      setCfg(c); setRows(error ? [] : (data || []).slice().sort((a, b) => String(b.number).localeCompare(String(a.number))));
      if (ct && ct.phone) { setTel(ct.phone); setOptin(!!ct.whatsapp_optin); }
      else { try { const pend = JSON.parse(localStorage.getItem("compta-plus-pending-phone") || "null"); if (pend && pend.phone) { setTel(pend.phone); setOptin(!!pend.optin); } } catch (e) { /* rien */ } }
    })();
    return () => { vivant = false; };
  }, [companyId]);
  const enregistrerContact = async () => {
    if (!fbTelValide(tel)) { setContactOk("Numéro invalide : saisissez-le avec l'indicatif du pays (exemple 509 3712 3456) ou les 8 chiffres d'Haïti."); return; }
    const { error } = await fbEnregistrerContact(companyId, tel, optin);
    if (error) { setContactOk("Enregistrement impossible pour le moment. Réessayez plus tard."); return; }
    setContactOk("Coordonnées enregistrées."); if (showToast) showToast("Coordonnées de contact enregistrées.");
  };
  if (rows === null) return <div className="text-sm" style={{ color: "#8A8370" }}>Chargement…</div>;
  const dues = rows.filter((i) => i.status === "emise");
  const enRetard = dues.filter((i) => i.due_date && i.due_date < today);
  const resteDu = fbR2(dues.reduce((s, i) => s + (Number(i.total_htg) || 0), 0));
  return (
    <div style={{ width: "100%", maxWidth: 900, boxSizing: "border-box", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }} data-testid="fb-client">
      <div style={fbCarte}>
        <FbTitre couleur="#C9A24B" titre="Abonnement et factures" sous="Vos factures Compta+ : inscription (gratuite pendant l'essai), puis une facture par mois selon votre forfait et vos blocs d'activité. Montants en gourdes au taux indiqué sur chaque facture." />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <div style={{ flex: "1 1 160px", background: "#FBF7EC", borderRadius: 10, padding: "10px 14px" }}><div className="text-xs" style={{ color: "#8A8370" }}>Factures</div><div className="display text-lg">{rows.length}</div></div>
          <div style={{ flex: "1 1 160px", background: "#FBF1DC", borderRadius: 10, padding: "10px 14px" }}><div className="text-xs" style={{ color: "#8A8370" }}>Reste à payer</div><div className="display text-lg tabular" data-testid="fb-client-du">{fbHtg(resteDu)}</div></div>
          <div style={{ flex: "1 1 160px", background: enRetard.length ? "#F7E3DD" : "#E1F1EC", borderRadius: 10, padding: "10px 14px" }}><div className="text-xs" style={{ color: "#8A8370" }}>En retard</div><div className="display text-lg">{enRetard.length}</div></div>
        </div>
        {enRetard.length > 0 && <div className="p-3 rounded text-sm mt-3" style={{ background: "#F7E9E3", color: "#A6432F" }} data-testid="fb-client-retard">{enRetard.length} facture(s) en retard de paiement. Merci de régulariser.</div>}
      </div>
      <div style={fbCarte}>
        <FbTitre couleur="#3F4F73" titre="Historique des factures" />
        {rows.length === 0 ? <div className="text-sm" style={{ color: "#8A8370" }} data-testid="fb-client-vide">Aucune facture pour le moment.</div> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{rows.map((i) => { const [l] = fbEtat(i, today); return (
            <div key={i.id || i.number} data-testid="fb-client-ligne" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 16px", border: "1px solid #EEE9DA", borderRadius: 10, padding: "10px 12px", background: "#FFFDF8", boxSizing: "border-box", maxWidth: "100%" }}>
              <div style={{ flex: "1 1 150px", minWidth: 0 }}><div className="text-xs tabular" style={{ color: "#8A8370" }}>{i.number}</div><div className="text-sm">{fbDateFr(i.issue_date)}</div></div>
              <div style={{ flex: "1 1 190px", minWidth: 0 }} className="text-xs"><span style={{ color: "#8A8370" }}>Période</span><br />{i.period_start ? fbDateFr(i.period_start) + " → " + fbDateFr(i.period_end) : "—"}</div>
              <div style={{ flex: "1 1 130px", minWidth: 0, textAlign: "right" }} className="tabular"><b>{fbHtg(i.total_htg)}</b><div><FbBadge texte={l} /></div></div>
              <div style={{ flex: "0 0 auto" }}><button onClick={() => setVoir(i)} className="text-xs underline" data-testid="fb-client-ouvrir">Voir / Imprimer</button></div>
            </div>); })}</div>
        )}
      </div>
      <div style={fbCarte} data-testid="fb-contact">
        <FbTitre couleur="#0F6B5C" titre="Vos coordonnées de contact" sous="Pour vous prévenir d'une facture à régler (e-mail et WhatsApp)." />
        <label className="text-xs" style={{ color: "#8A8370" }}>Téléphone WhatsApp de l'entreprise (avec l'indicatif du pays)</label>
        <input value={tel} onChange={(e) => { setTel(e.target.value); setContactOk(null); }} placeholder="509 3712 3456" data-testid="fb-contact-tel" style={fbCell} />
        <label className="flex items-start gap-2 text-sm mt-3"><input type="checkbox" checked={optin} onChange={(e) => { setOptin(e.target.checked); setContactOk(null); }} data-testid="fb-contact-optin" style={{ marginTop: 3 }} /> J'accepte de recevoir les nouveautés et offres de Compta+ sur WhatsApp. (Les rappels de facture sont envoyés dans tous les cas.)</label>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, flexWrap: "wrap" }}><button onClick={enregistrerContact} style={fbBtnOr} data-testid="fb-contact-save">Enregistrer</button>{contactOk && <span className="text-xs" style={{ color: "#6F6A5A" }} data-testid="fb-contact-msg">{contactOk}</span>}</div>
      </div>
      {voir && <FbApercu inv={voir} cfg={cfg} onClose={() => setVoir(null)} />}
    </div>
  );
}

// ───────── Super admin : réglages, factures et relances (view = "factures" | "reglages" | "relances") ─────────
function BillingAdminPanel({ view, showToast, currentUserEmail }) {
  const today = todayStr();
  const [cfg, setCfg] = useState(null);
  const [edit, setEdit] = useState(null);
  const [rows, setRows] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [groups, setGroups] = useState([]);
  const [filtre, setFiltre] = useState("toutes");
  const [voir, setVoir] = useState(null);
  const [busy, setBusy] = useState(false);
  const [em, setEm] = useState({ date: todayStr(), rate: "", vat: null, companyId: "" });
  const [pay, setPay] = useState(null);
  const [comp, setComp] = useState({ companyId: "" });
  const [members, setMembers] = useState([]);
  const [relFiltre, setRelFiltre] = useState("retard");
  const [wm, setWm] = useState({ companyId: "", type: "contact", text: FB_WA_MODELES.contact });
  const [promoText, setPromoText] = useState(FB_WA_MODELES.offre);
  const [promoVus, setPromoVus] = useState({});
  const charger = async () => {
    const c = await fbChargerConfig();
    const [inv, co0, gr, mb] = await Promise.all([
      supabase.from("billing_invoices").select("*").order("issue_date", { ascending: false }),
      supabase.from("companies").select("id, name, plan_tier, plan_status, trial_ends_at, created_at, group_id, sectors, sector_pack, extra_blocks, phone, whatsapp_optin"),
      supabase.from("company_groups").select("id, name, plan_status"),
      supabase.from("company_members").select("company_id, email, is_primary_admin"),
    ]);
    let co = co0;
    if (co0.error) co = await supabase.from("companies").select("id, name, plan_tier, plan_status, trial_ends_at, created_at, group_id, sectors, sector_pack, extra_blocks"); // colonnes téléphone pas encore créées (script SQL)
    setMembers(mb && mb.data ? mb.data : []);
    setCfg(c); setEdit((e) => e || c);
    setRows(inv.error ? [] : (inv.data || []).slice().sort((a, b) => String(b.number).localeCompare(String(a.number))));
    setCompanies(co.data || []); setGroups(gr.data || []);
    setEm((e) => ({ ...e, rate: e.rate || (c.rate_htg_per_usd ? String(c.rate_htg_per_usd) : ""), vat: e.vat === null ? c.vat_enabled : e.vat }));
  };
  useEffect(() => { charger(); }, []);
  if (!cfg || rows === null) return <div className="text-sm" style={{ color: "#8A8370" }}>Chargement…</div>;

  // ── Réglages ──
  const champ = (k, label, type) => (<div><label className="text-xs" style={{ color: "#8A8370" }}>{label}</label><input type={type || "text"} value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: type === "number" ? e.target.value : e.target.value })} data-testid={"fb-reg-" + k} style={fbCell} /></div>);
  const prixChamp = (k, label) => (<div><label className="text-xs" style={{ color: "#8A8370" }}>{label}</label><input type="number" min="0" value={edit.prices[k]} onChange={(e) => setEdit({ ...edit, prices: { ...edit.prices, [k]: e.target.value } })} data-testid={"fb-prix-" + k} style={fbCell} /></div>);
  const choisirLogo = (file) => {
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => { const img = new Image(); img.onload = () => {
      const k = Math.min(1, 240 / Math.max(img.width, img.height)); const cv = document.createElement("canvas"); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height); setEdit((e) => ({ ...e, logo: cv.toDataURL("image/png") }));
    }; img.src = rd.result; };
    rd.readAsDataURL(file);
  };
  const actualiserTaux = async () => { const r = await fetchHtgPerUsd(); if (r) { setEdit((e) => ({ ...e, rate_htg_per_usd: String(Math.round(r * 100) / 100) })); showToast("Taux du jour : 1 USD = " + (Math.round(r * 100) / 100) + " G."); } else { setEdit((e) => ({ ...e, rate_htg_per_usd: e.rate_htg_per_usd || String(FALLBACK_HTG_PER_USD) })); showToast("Service de taux indisponible : saisissez le taux manuellement."); } };
  const enregistrerReglages = async () => {
    const prices = {}; Object.keys(FB_PRIX_DEFAUT).forEach((k) => { prices[k] = Math.max(0, Number(edit.prices[k]) || 0); });
    const vr = Number(edit.vat_rate);
    if (!(vr >= 0 && vr <= 100)) { showToast("Le taux de TCA doit être entre 0 et 100 %."); return; }
    const row = { id: 1, issuer_name: String(edit.issuer_name || "Compta+").trim(), issuer_address: edit.issuer_address || "", issuer_phone: edit.issuer_phone || "", issuer_email: edit.issuer_email || "", issuer_nif: edit.issuer_nif || "", logo: edit.logo || "", thanks: edit.thanks || "Merci de votre confiance !", payment_info: edit.payment_info || "",
      reminder_email_subject: edit.rem_subject || "", reminder_email_body: edit.rem_body || "", reminder_whatsapp_body: edit.rem_wa || "",
      vat_enabled: !!edit.vat_enabled, vat_rate: vr, rate_htg_per_usd: Number(edit.rate_htg_per_usd) || 0, prices, grid: cfg.grid, updated_at: new Date().toISOString() };
    setBusy(true);
    const { error } = await supabase.from("billing_settings").upsert(row);
    setBusy(false);
    if (error) { showToast(friendlyError(error)); return; }
    setCfg(fbConfig(row)); setEdit(fbConfig(row)); setEm((e) => ({ ...e, rate: row.rate_htg_per_usd ? String(row.rate_htg_per_usd) : e.rate }));
    showToast("Réglages de facturation enregistrés.");
  };
  if (view === "reglages") {
    return (
      <div className="max-w-3xl space-y-5" data-testid="fb-reglages">
        <div style={fbCarte}>
          <FbTitre couleur="#152238" titre="Émetteur (en-tête de la facture)" sous="Logo, coordonnées et mot de remerciement imprimés sur chaque facture." />
          <div className="mb-3 flex items-center gap-3">{edit.logo ? <img src={edit.logo} alt="" style={{ maxHeight: 60, maxWidth: 120 }} /> : <div className="text-xs" style={{ color: "#8A8370" }}>Aucun logo</div>}
            <input type="file" accept="image/*" onChange={(e) => choisirLogo(e.target.files && e.target.files[0])} data-testid="fb-reg-logo" className="text-xs" />{edit.logo && <button onClick={() => setEdit({ ...edit, logo: "" })} className="text-xs underline">Retirer</button>}</div>
          <div className="grid md:grid-cols-2 gap-3">{champ("issuer_name", "Nom")}{champ("issuer_nif", "NIF")}{champ("issuer_address", "Adresse")}{champ("issuer_phone", "Téléphone")}{champ("issuer_email", "E-mail")}</div>
          <div className="mt-3"><label className="text-xs" style={{ color: "#8A8370" }}>Mot de remerciement (dernière ligne de la facture)</label><input value={edit.thanks} onChange={(e) => setEdit({ ...edit, thanks: e.target.value })} data-testid="fb-reg-thanks" style={fbCell} /></div>
          <div className="mt-3"><label className="text-xs" style={{ color: "#8A8370" }}>Comment payer (MonCash, carte, virement… — affiché sur les factures à payer)</label><textarea rows={3} value={edit.payment_info} onChange={(e) => setEdit({ ...edit, payment_info: e.target.value })} data-testid="fb-reg-payment_info" style={fbCell} /></div>
        </div>
        <div style={fbCarte}>
          <FbTitre couleur="#C9A24B" titre="Prix mensuels et taux de change" sous="Prix en dollars ; la facture est établie en gourdes au taux affiché. TCA en option." />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{prixChamp("standard", "Forfait Standard")}{prixChamp("assisted", "Forfait Assisté")}{prixChamp("group", "Forfait Extension")}{prixChamp("pack", "Pack 3 secteurs")}{prixChamp("A", "Bloc grille A")}{prixChamp("B", "Bloc grille B")}{prixChamp("C", "Bloc grille C")}</div>
          <div className="grid md:grid-cols-3 gap-3 mt-3 items-end">{champ("rate_htg_per_usd", "Taux affiché : gourdes pour 1 USD", "number")}<button onClick={actualiserTaux} style={fbBtn} data-testid="fb-reg-taux-auto">Taux du jour</button></div>
          <label className="flex items-center gap-2 text-sm mt-4"><input type="checkbox" checked={!!edit.vat_enabled} onChange={(e) => setEdit({ ...edit, vat_enabled: e.target.checked })} data-testid="fb-reg-vat_enabled" /> Appliquer la TCA sur les factures (option)</label>
          <div className="grid md:grid-cols-3 gap-3 mt-2">{champ("vat_rate", "Taux de TCA (%)", "number")}</div>
          <div className="text-xs mt-2" style={{ color: "#7A7460" }}>La TCA sur les abonnements est à confirmer avec l'expert-comptable. Elle reste désactivée tant que vous ne cochez pas la case ; vous pouvez aussi la décider à chaque émission.</div>
        </div>
        <div style={fbCarte}>
          <FbTitre couleur="#0F6B5C" titre="Messages de relance" sous="Modèles utilisés par l'onglet Relances. Mots remplacés automatiquement : {client} {numero} {montant} {echeance} {jours} {emetteur} {paiement}." />
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Objet de l'e-mail</label><input value={edit.rem_subject} onChange={(e) => setEdit({ ...edit, rem_subject: e.target.value })} data-testid="fb-reg-rem_subject" style={fbCell} /></div>
          <div className="mt-3"><label className="text-xs" style={{ color: "#8A8370" }}>Texte de l'e-mail</label><textarea rows={8} value={edit.rem_body} onChange={(e) => setEdit({ ...edit, rem_body: e.target.value })} data-testid="fb-reg-rem_body" style={fbCell} /></div>
          <div className="mt-3"><label className="text-xs" style={{ color: "#8A8370" }}>Message WhatsApp (court)</label><textarea rows={4} value={edit.rem_wa} onChange={(e) => setEdit({ ...edit, rem_wa: e.target.value })} data-testid="fb-reg-rem_wa" style={fbCell} /></div>
          <button onClick={() => setEdit({ ...edit, rem_subject: FB_MSG_DEFAUT.subject, rem_body: FB_MSG_DEFAUT.body, rem_wa: FB_MSG_DEFAUT.wa })} className="text-xs underline mt-2">Remettre les messages d'origine</button>
        </div>
        <button onClick={enregistrerReglages} disabled={busy} style={fbBtnOr} data-testid="fb-reg-enregistrer">Enregistrer les réglages</button>
      </div>
    );
  }

  // ── Factures ──
  const rate = Number(em.rate) || 0;
  const vatOn = !!em.vat;
  const local = { n: 0, list: rows };
  const inserer = async (draft) => {
    const number = await fbNumero(draft.issue_date, local);
    const row = { id: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2), ...draft, number, created_by: currentUserEmail || "" };
    const { error } = await supabase.from("billing_invoices").insert(row);
    if (error) throw error;
    local.list = [...local.list, row];
    return row;
  };
  const emettre = async () => {
    if (!(rate > 0)) { showToast("Indiquez le taux de change (gourdes pour 1 USD)."); return; }
    if (!em.date) { showToast("Indiquez la date d'émission."); return; }
    const tout = fbEmission({ companies, groups, invoices: rows, cfg, date: em.date, rate, vatEnabled: vatOn, vatRate: cfg.vat_rate });
    let { drafts, inscriptions } = tout;
    const cible = em.companyId ? companies.find((c) => c.id === em.companyId) : null;
    if (cible) {
      // une seule entreprise : sa facture mensuelle (ou celle de son groupe, facturée à l'entreprise la plus ancienne du groupe) et sa facture d'inscription si elle manque
      const ids = new Set([cible.id]);
      if (cible.group_id) { const premier = companies.filter((c) => c.group_id === cible.group_id).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0]; if (premier) ids.add(premier.id); }
      drafts = drafts.filter((d) => ids.has(d.company_id)); inscriptions = inscriptions.filter((i) => i.company_id === cible.id);
      if (!drafts.length && !inscriptions.length) {
        showToast(cible.plan_status !== "active" ? "« " + cible.name + " » n'est pas encore en forfait payant (essai ou suspendue) : pas de facture mensuelle. La première facture sera émise à son passage en forfait payant." : "Rien à émettre pour « " + cible.name + " » : sa facture de ce mois existe déjà.");
        return;
      }
    }
    if (!drafts.length && !inscriptions.length) { showToast("Rien à émettre : toutes les factures de ce mois existent déjà."); return; }
    const total = fbR2(drafts.reduce((s, d) => s + d.total_htg, 0));
    if (typeof window !== "undefined" && window.confirm && !window.confirm((cible ? "Entreprise : « " + cible.name + " ». " : "") + "Émettre " + drafts.length + " facture(s) mensuelle(s) pour " + fbHtg(total) + (inscriptions.length ? " et " + inscriptions.length + " facture(s) d'inscription à 0" : "") + " ?")) return;
    setBusy(true);
    try { for (const d of [...inscriptions, ...drafts]) await inserer(d); showToast(drafts.length + " facture(s) émise(s)."); }
    catch (e) { showToast(friendlyError(e)); }
    setBusy(false); charger();
  };
  const complement = async () => {
    const co = companies.find((c) => c.id === comp.companyId);
    if (!co) { showToast("Choisissez l'entreprise."); return; }
    if (!(rate > 0)) { showToast("Indiquez le taux de change."); return; }
    const gr = co.group_id ? groups.find((g) => g.id === co.group_id) : null;
    const base = gr ? companies.filter((c) => c.group_id === gr.id).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0] : co;
    const r = fbComplement({ company: base, group: gr, invoices: rows, cfg, date: em.date, rate, vatEnabled: vatOn, vatRate: cfg.vat_rate });
    if (r.error) { showToast(r.error); return; }
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Émettre une facture complémentaire de " + fbHtg(r.draft.total_htg) + " pour « " + r.draft.client_name + " » ?")) return;
    setBusy(true);
    try { await inserer(r.draft); showToast("Facture complémentaire émise."); } catch (e) { showToast(friendlyError(e)); }
    setBusy(false); charger();
  };
  const enregistrerPaiement = async () => {
    if (!pay) return;
    const montant = fbR2(pay.amount);
    if (!(montant > 0)) { showToast("Indiquez le montant reçu."); return; }
    if (!pay.date || pay.date > today) { showToast("La date de paiement ne peut pas être dans le futur."); return; }
    const { error } = await supabase.from("billing_invoices").update({ status: "payee", paid_at: pay.date, paid_amount_htg: montant, payment_method: pay.method, payment_ref: pay.ref || "" }).eq("id", pay.inv.id);
    if (error) { showToast(friendlyError(error)); return; }
    setPay(null); showToast("Paiement enregistré."); charger();
  };
  const annuler = async (inv) => {
    if (inv.status === "payee") { showToast("Une facture payée ne s'annule pas ici : contactez le support comptable."); return; }
    if (inv.status === "annulee") return;
    const motif = typeof window !== "undefined" && window.prompt ? window.prompt("Motif de l'annulation de " + inv.number + " (obligatoire) :", "") : "";
    if (!motif || motif.trim().length < 3) { showToast("Annulation refusée : motif obligatoire."); return; }
    const { error } = await supabase.from("billing_invoices").update({ status: "annulee", cancel_reason: motif.trim() }).eq("id", inv.id);
    if (error) { showToast(friendlyError(error)); return; }
    showToast(inv.number + " annulée."); charger();
  };
  // ── Relances (e-mail et WhatsApp) ──
  const contactDe = (inv) => {
    const co = companies.find((c) => c.id === inv.company_id) || {};
    const ms = members.filter((m) => m.company_id === inv.company_id);
    const adm = ms.find((m) => m.is_primary_admin) || ms[0] || {};
    return { email: adm.email || "", phone: co.phone || "", optin: !!co.whatsapp_optin };
  };
  const marquerRelance = async (inv, canal) => {
    const { error } = await supabase.from("billing_invoices").update({ reminder_count: (Number(inv.reminder_count) || 0) + 1, last_reminder_at: new Date().toISOString(), last_reminder_channel: canal }).eq("id", inv.id);
    return error;
  };
  const relancerEmail = async (inv, silencieux) => {
    const c = contactDe(inv);
    if (!c.email) { if (!silencieux) showToast("Aucune adresse e-mail trouvée pour " + inv.client_name + "."); return false; }
    const m = fbMessage(cfg, inv, today);
    const r = await invokeEdgeFunction("send-offer-email", { to: [c.email], subject: m.subject, html: fbHtmlMail(m.body) });
    if (r.error) { if (!silencieux) showToast("E-mail non envoyé : " + String(r.error)); return false; }
    const e = await marquerRelance(inv, "email");
    if (!silencieux) { showToast(e ? "E-mail envoyé, mais la relance n'a pas pu être notée (script SQL de la v274 exécuté ?)." : "E-mail envoyé à " + c.email + "."); charger(); }
    return true;
  };
  const relancerWhatsApp = async (inv) => {
    const c = contactDe(inv);
    if (!fbTelValide(c.phone)) { showToast("Aucun numéro WhatsApp valide pour " + inv.client_name + ". Demandez-le au client (Administration, Abonnement et factures)."); return; }
    const m = fbMessage(cfg, inv, today);
    const url = fbWaLien(c.phone, m.wa);
    try { window.open(url, "_blank", "noopener"); } catch (e) { /* bloqué par le navigateur */ }
    await marquerRelance(inv, "whatsapp"); charger();
  };
  const relancerMasse = async (liste) => {
    const cibles = liste.filter((i) => !i.last_reminder_at || fbEntreJours(String(i.last_reminder_at).slice(0, 10), today) >= FB_RELANCE_PAUSE_JOURS);
    if (!cibles.length) { showToast("Rien à relancer : toutes les factures en retard ont déjà été relancées depuis moins de " + FB_RELANCE_PAUSE_JOURS + " jours."); return; }
    if (typeof window !== "undefined" && window.confirm && !window.confirm("Envoyer " + cibles.length + " e-mail(s) de relance ?")) return;
    setBusy(true); let ok = 0, ko = 0;
    for (const i of cibles) { if (await relancerEmail(i, true)) ok++; else ko++; }
    setBusy(false); showToast(ok + " e-mail(s) envoyé(s)" + (ko ? " ; " + ko + " sans adresse ou en échec" : "") + "."); charger();
  };
  const mois = today.slice(0, 7);
  const actives = rows.filter((i) => i.status !== "annulee");
  const emisMois = fbR2(actives.filter((i) => String(i.issue_date).startsWith(mois)).reduce((s, i) => s + (Number(i.total_htg) || 0), 0));
  const encaisse = fbR2(actives.filter((i) => i.status === "payee").reduce((s, i) => s + (Number(i.paid_amount_htg) || Number(i.total_htg) || 0), 0));
  const aEncaisser = fbR2(actives.filter((i) => i.status === "emise").reduce((s, i) => s + (Number(i.total_htg) || 0), 0));
  const enRetardListe = actives.filter((i) => i.status === "emise" && i.due_date && i.due_date < today);
  const retards = enRetardListe.length;
  const liste = rows.filter((i) => filtre === "toutes" || (filtre === "retard" ? (i.status === "emise" && i.due_date && i.due_date < today) : i.status === filtre));
  const Kpi = ({ l, v, t, bg, fg }) => (<div style={{ flex: "1 1 200px", minWidth: 0, background: bg, borderRadius: 14, padding: "14px 16px", border: "1px solid rgba(21,34,56,0.06)" }}><div className="text-xs" style={{ color: fg, opacity: 0.8 }}>{l}</div><div className="display text-xl tabular" data-testid={t} style={{ color: fg, marginTop: 2 }}>{v}</div></div>);

  // ── Écran Relances ──
  if (view === "relances") {
    const dues = actives.filter((i) => i.status === "emise");
    const aff = (relFiltre === "retard" ? enRetardListe : dues).slice().sort((a, b) => String(a.due_date || "").localeCompare(String(b.due_date || "")));
    const montantRetard = fbR2(enRetardListe.reduce((s, i) => s + (Number(i.total_htg) || 0), 0));
    const relancees = dues.filter((i) => Number(i.reminder_count) > 0).length;
    return (
      <div style={{ maxWidth: 1000, display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }} data-testid="fb-relances">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <Kpi l="Factures en retard" v={String(retards)} t="fb-rel-kpi-retard" bg="#F7E3DD" fg="#A6432F" />
          <Kpi l="Montant en retard" v={fbHtg(montantRetard)} t="fb-rel-kpi-montant" bg="#FBF1DC" fg="#9A7B1E" />
          <Kpi l="Déjà relancées" v={String(relancees)} t="fb-rel-kpi-relancees" bg="#E1F1EC" fg="#0F6B5C" />
        </div>
        <div style={fbCarte}>
          <FbTitre couleur="#0F6B5C" titre="Relancer les factures impayées" sous="Un clic sur « E-mail » envoie le message tout de suite. Un clic sur « WhatsApp » ouvre WhatsApp avec le message déjà écrit : il ne reste qu'à appuyer sur envoyer (vous pouvez aussi joindre une image, un audio ou une vidéo). Les messages se modifient dans Réglages de facturation."
            droite={<button onClick={() => relancerMasse(enRetardListe)} disabled={busy || !retards} style={fbBtnOr} data-testid="fb-rel-masse">E-mail à tous les retards ({retards})</button>} />
          <div className="flex items-center gap-2 mb-3"><label className="text-xs" style={{ color: "#8A8370" }}>Afficher</label>
            <select value={relFiltre} onChange={(e) => setRelFiltre(e.target.value)} data-testid="fb-rel-filtre" style={{ ...fbCell, width: "auto" }}><option value="retard">En retard</option><option value="dues">Toutes les factures à payer</option></select></div>
          {aff.length === 0 ? <div className="text-sm" style={{ color: "#8A8370" }} data-testid="fb-rel-vide">Aucune facture à relancer pour le moment. Les boutons E-mail et WhatsApp apparaissent sur chaque facture en retard. Pour écrire à un client sans facture, utilisez la carte « Écrire à un client sur WhatsApp » plus bas.</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{aff.map((i) => { const c = contactDe(i); const jours = i.due_date ? Math.max(0, fbEntreJours(i.due_date, today)) : 0; return (
              <div key={i.id || i.number} data-testid="fb-rel-ligne" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 16px", border: "1px solid #EEE9DA", borderRadius: 10, padding: "12px 14px", background: "#FFFDF8", boxSizing: "border-box" }}>
                <div style={{ flex: "2 1 220px", minWidth: 0 }}><div style={{ fontWeight: 600, color: "#152238" }}>{i.client_name}</div><div className="text-xs tabular" style={{ color: "#8A8370" }}>{i.number} · à payer avant le {fbDateFr(i.due_date)}</div>
                  <div className="text-xs" style={{ color: "#6F6A5A", marginTop: 2 }}>{c.email || "pas d'e-mail"} · {c.phone || "pas de numéro WhatsApp"}{c.optin ? " · accepte les offres WhatsApp" : ""}</div></div>
                <div style={{ flex: "1 1 130px", textAlign: "right" }} className="tabular"><b>{fbHtg(i.total_htg)}</b><div>{jours > 0 ? <FbBadge texte="En retard" /> : <FbBadge texte="À payer" />}{jours > 0 && <span className="text-xs" style={{ color: "#A6432F", marginLeft: 6 }}>{jours} j</span>}</div></div>
                <div style={{ flex: "1 1 150px" }} className="text-xs"><span style={{ color: "#8A8370" }}>Relances</span><br />{Number(i.reminder_count) > 0 ? i.reminder_count + " — dernière : " + (i.last_reminder_channel === "whatsapp" ? "WhatsApp" : "e-mail") + " le " + fbDateFr(String(i.last_reminder_at).slice(0, 10)) : "aucune"}</div>
                <div style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
                  <button onClick={() => relancerEmail(i)} disabled={busy} style={fbBtn} data-testid="fb-rel-email">E-mail</button>
                  <button onClick={() => relancerWhatsApp(i)} disabled={busy} style={{ ...fbBtn, background: "#1F9D55", color: "#fff" }} data-testid="fb-rel-wa">WhatsApp</button>
                </div>
              </div>); })}</div>
          )}
        </div>
        <div style={fbCarte} data-testid="fb-wa-libre">
          <FbTitre couleur="#1F9D55" titre="Écrire à un client sur WhatsApp" sous="Pour prendre contact, annoncer une nouveauté ou faire une offre, sans lien avec une facture. WhatsApp s'ouvre avec le message ; vous pouvez joindre une image, un audio ou une vidéo avant d'envoyer." />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <div style={{ flex: "2 1 240px" }}><label className="text-xs" style={{ color: "#8A8370" }}>Entreprise</label>
              <select value={wm.companyId} onChange={(e) => setWm({ ...wm, companyId: e.target.value })} data-testid="fb-wa-societe" style={fbCell}><option value="">— choisir —</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}{fbTelValide(c.phone) ? "" : " (pas de numéro)"}</option>)}</select></div>
            <div style={{ flex: "1 1 180px" }}><label className="text-xs" style={{ color: "#8A8370" }}>Modèle de message</label>
              <select value={wm.type} onChange={(e) => setWm({ ...wm, type: e.target.value, text: FB_WA_MODELES[e.target.value] })} data-testid="fb-wa-modele" style={fbCell}><option value="contact">Prendre contact</option><option value="nouveaute">Nouveauté</option><option value="offre">Offre</option></select></div>
          </div>
          <div className="mt-3"><label className="text-xs" style={{ color: "#8A8370" }}>Message ({"{client}"} et {"{emetteur}"} sont remplacés)</label><textarea rows={4} value={wm.text} onChange={(e) => setWm({ ...wm, text: e.target.value })} data-testid="fb-wa-texte" style={fbCell} /></div>
          <button onClick={() => {
            const co = companies.find((c) => c.id === wm.companyId);
            if (!co) { showToast("Choisissez l'entreprise."); return; }
            if (!fbTelValide(co.phone)) { showToast("Aucun numéro WhatsApp valide pour " + co.name + ". Demandez-le au client (Administration, Abonnement et factures)."); return; }
            try { window.open(fbWaLien(co.phone, fbWaTexte(wm.text, co.name, cfg)), "_blank", "noopener"); } catch (e) { /* bloqué */ }
          }} style={{ ...fbBtn, background: "#1F9D55", color: "#fff", marginTop: 12 }} data-testid="fb-wa-ouvrir">Ouvrir WhatsApp</button>
        </div>
        {(() => {
          const optins = companies.filter((c) => c.whatsapp_optin && fbTelValide(c.phone));
          const restants = optins.filter((c) => !promoVus[c.id]).length;
          return (
            <div style={fbCarte} data-testid="fb-promo">
              <FbTitre couleur="#5B3FA0" titre="Promotions : clients qui ont accepté WhatsApp" sous="Seules les entreprises qui ont coché l'accord (inscription ou « Vos coordonnées de contact ») apparaissent ici. Un clic ouvre WhatsApp pour chacune ; la ligne se coche après l'ouverture."
                droite={<span className="text-xs" style={{ color: "#6F6A5A" }} data-testid="fb-promo-reste">{restants} restant(s) sur {optins.length}</span>} />
              <label className="text-xs" style={{ color: "#8A8370" }}>Message de la promotion</label>
              <textarea rows={3} value={promoText} onChange={(e) => setPromoText(e.target.value)} data-testid="fb-promo-texte" style={fbCell} />
              {optins.length === 0 ? <div className="text-sm mt-3" style={{ color: "#8A8370" }} data-testid="fb-promo-vide">Aucun client n'a encore donné son accord pour les promotions WhatsApp.</div> : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>{optins.map((c) => (
                  <div key={c.id} data-testid="fb-promo-ligne" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 16px", border: "1px solid #EEE9DA", borderRadius: 10, padding: "10px 14px", background: promoVus[c.id] ? "#F3F8F5" : "#FFFDF8" }}>
                    <div style={{ flex: "2 1 200px", minWidth: 0 }}><div style={{ fontWeight: 600, color: "#152238" }}>{c.name}</div><div className="text-xs" style={{ color: "#6F6A5A" }}>{c.phone}</div></div>
                    <button onClick={() => { try { window.open(fbWaLien(c.phone, fbWaTexte(promoText, c.name, cfg)), "_blank", "noopener"); } catch (e) { /* bloqué */ } setPromoVus((v) => ({ ...v, [c.id]: true })); }} style={{ ...fbBtn, background: promoVus[c.id] ? "#8AA597" : "#1F9D55", color: "#fff" }} data-testid="fb-promo-wa">{promoVus[c.id] ? "Ouvert ✓ — rouvrir" : "WhatsApp"}</button>
                  </div>))}</div>
              )}
            </div>);
        })()}
      </div>
    );
  }

  // ── Écran Factures ──
  return (
    <div style={{ maxWidth: 1000, display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }} data-testid="fb-factures">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <Kpi l="Émis ce mois" v={fbHtg(emisMois)} t="fb-kpi-mois" bg="#E4E9F5" fg="#3F4F73" />
        <Kpi l="Encaissé" v={fbHtg(encaisse)} t="fb-kpi-encaisse" bg="#E1F1EC" fg="#0F6B5C" />
        <Kpi l="À encaisser" v={fbHtg(aEncaisser)} t="fb-kpi-a-encaisser" bg="#FBF1DC" fg="#9A7B1E" />
        <Kpi l="Factures en retard" v={String(retards)} t="fb-kpi-retards" bg="#F7E3DD" fg="#A6432F" />
      </div>
      <div style={fbCarte}>
        <FbTitre couleur="#C9A24B" titre="Émettre les factures du mois" sous="Une facture par entreprise payante (et par groupe), jamais en double pour le même mois. Première facture payante : prorata dès la fin de l'essai. Les factures d'inscription à 0 manquantes sont aussi créées." />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <div style={{ flex: "2 1 240px" }}><label className="text-xs" style={{ color: "#8A8370" }}>Entreprise à facturer</label><select value={em.companyId} onChange={(e) => setEm({ ...em, companyId: e.target.value })} data-testid="fb-em-societe" style={fbCell}><option value="">Toutes les entreprises payantes</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}{c.plan_status === "active" ? "" : " (essai)"}</option>)}</select></div>
          <div style={{ flex: "1 1 160px" }}><label className="text-xs" style={{ color: "#8A8370" }}>Date d'émission</label><input type="date" value={em.date} max={today} onChange={(e) => setEm({ ...em, date: e.target.value })} data-testid="fb-em-date" style={fbCell} /></div>
          <div style={{ flex: "1 1 160px" }}><label className="text-xs" style={{ color: "#8A8370" }}>Taux (gourdes pour 1 USD)</label><input type="number" min="0" value={em.rate} onChange={(e) => setEm({ ...em, rate: e.target.value })} data-testid="fb-em-taux" style={fbCell} /></div>
          <label className="flex items-center gap-2 text-sm" style={{ paddingBottom: 6 }}><input type="checkbox" checked={vatOn} onChange={(e) => setEm({ ...em, vat: e.target.checked })} data-testid="fb-em-vat" /> TCA ({cfg.vat_rate} %)</label>
          <button onClick={emettre} disabled={busy} style={fbBtnOr} data-testid="fb-em-emettre">{em.companyId ? "Émettre la facture de cette entreprise" : "Émettre les factures du mois"}</button>
        </div>
      </div>
      <div style={fbCarte}>
        <FbTitre couleur="#5B3FA0" titre="Facture complémentaire" sous="Hausse de forfait ou de blocs en cours de mois, facturée au prorata des jours restants." />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <div style={{ flex: "3 1 240px" }}><select value={comp.companyId} onChange={(e) => setComp({ companyId: e.target.value })} data-testid="fb-comp-societe" style={fbCell}><option value="">— entreprise —</option>{companies.filter((c) => c.plan_status === "active").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <button onClick={complement} disabled={busy} style={fbBtn} data-testid="fb-comp-emettre">Facture complémentaire</button>
        </div>
      </div>
      {pay && (
        <div style={{ ...fbCarte, border: "2px solid #C9A24B" }} data-testid="fb-paiement">
          <FbTitre couleur="#C9A24B" titre={"Paiement de " + pay.inv.number} sous={pay.inv.client_name} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
            <div style={{ flex: "1 1 140px" }}><label className="text-xs" style={{ color: "#8A8370" }}>Montant reçu (gourdes)</label><input type="number" min="0" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} data-testid="fb-pay-montant" style={fbCell} /></div>
            <div style={{ flex: "1 1 130px" }}><label className="text-xs" style={{ color: "#8A8370" }}>Mode</label><select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })} data-testid="fb-pay-mode" style={fbCell}><option>MonCash</option><option>Carte</option><option>Virement</option><option>Espèces</option></select></div>
            <div style={{ flex: "1 1 140px" }}><label className="text-xs" style={{ color: "#8A8370" }}>Référence</label><input value={pay.ref} onChange={(e) => setPay({ ...pay, ref: e.target.value })} data-testid="fb-pay-ref" style={fbCell} /></div>
            <div style={{ flex: "1 1 140px" }}><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" value={pay.date} max={today} onChange={(e) => setPay({ ...pay, date: e.target.value })} style={fbCell} /></div>
            <div className="flex gap-2"><button onClick={enregistrerPaiement} style={fbBtnOr} data-testid="fb-pay-valider">Valider</button><button onClick={() => setPay(null)} style={fbBtn}>Fermer</button></div>
          </div>
        </div>
      )}
      <div style={fbCarte}>
        <FbTitre couleur="#3F4F73" titre="Historique des factures" sous="Toutes les factures émises, du plus récent au plus ancien."
          droite={<select value={filtre} onChange={(e) => setFiltre(e.target.value)} data-testid="fb-filtre" style={{ ...fbCell, width: "auto" }}><option value="toutes">Toutes</option><option value="emise">À payer</option><option value="retard">En retard</option><option value="payee">Payées</option><option value="gratuite">Gratuites (inscriptions)</option><option value="annulee">Annulées</option></select>} />
        {liste.length === 0 ? <div className="text-sm" style={{ color: "#8A8370" }}>Aucune facture.</div> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{liste.map((i) => { const [l] = fbEtat(i, today); return (
            <div key={i.id || i.number} data-testid="fb-ligne" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 16px", border: "1px solid #EEE9DA", borderRadius: 10, padding: "10px 14px", background: "#FFFDF8", opacity: i.status === "annulee" ? 0.6 : 1, boxSizing: "border-box" }}>
              <div style={{ flex: "2 1 200px", minWidth: 0 }}><div style={{ fontWeight: 600, color: "#152238" }}>{i.client_name}</div><div className="text-xs tabular" style={{ color: "#8A8370" }}>{i.number} · {i.kind === "inscription" ? "Inscription" : i.kind === "complement" ? "Complément" : "Mensuelle"} · {fbDateFr(i.issue_date)}</div></div>
              <div style={{ flex: "1 1 130px", textAlign: "right" }} className="tabular"><b>{fbHtg(i.total_htg)}</b><div><FbBadge texte={l} /></div></div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", flex: "1 1 200px", justifyContent: "flex-end" }}>
                <button onClick={() => setVoir(i)} className="text-xs underline" data-testid="fb-ouvrir">Voir / Imprimer</button>
                {i.status === "emise" && <button onClick={() => setPay({ inv: i, amount: String(i.total_htg), method: "MonCash", ref: "", date: today })} className="text-xs underline" data-testid="fb-payer">Enregistrer le paiement</button>}
                {(i.status === "emise" || i.status === "gratuite") && <button onClick={() => annuler(i)} className="text-xs" style={{ color: "#A6432F" }} data-testid="fb-annuler">Annuler</button>}
              </div>
            </div>); })}</div>
        )}
      </div>
      {voir && <FbApercu inv={voir} cfg={cfg} onClose={() => setVoir(null)} />}
    </div>
  );
}
