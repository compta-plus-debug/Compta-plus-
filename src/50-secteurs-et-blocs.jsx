// ═══ MODULE ═══
// @module Secteurs et blocs
// @depends Plus, friendlyError, supabase, useEffect, useState
// @exports SecteursChoixModal, SecteursGestionPanel, loadSecteursInfo, secteursDroits
// ═══ FIN DE L'EN-TÊTE ═══
// Blocs par secteur d'activité (étape 1 : le socle).
// Chaque entreprise choisit UNE SEULE FOIS jusqu'à 3 secteurs ; le choix est ensuite verrouillé, et seule une demande
// acceptée par le centre de gestion peut le changer. Les forfaits Assisté et Extension incluent les 3 secteurs ; le forfait
// Standard les obtient avec le supplément « 3 secteurs » (champ sector_pack), ou bloc par bloc (extra_blocks) selon la grille.
// Pendant l'essai gratuit, les secteurs choisis sont utilisables. La règle est aussi appliquée en base (voir le script SQL).

const SECTEURS_MAX = 3;
// grille : A = plus important, B, C = moins important (prix mensuels du scénario « Équilibré », à confirmer)
const SECTEURS_PRIX = { pack: 12, A: 8, B: 5, C: 3 };
const SECTEURS_CATALOGUE = [
  { id: "ecoles", label: "Écoles", desc: "Élèves, frais de scolarité, échéances, reçus, impayés", grille: "A", dispo: false },
  { id: "import_export", label: "Import-export", desc: "Dossiers d'importation, coût de revient, TCA à l'importation, exportations", grille: "A", dispo: false },
  { id: "industrie", label: "Industries artisanales", desc: "Fiches de fabrication, coût de revient, matières premières", grille: "A", dispo: false },
  { id: "sante", label: "Santé (cabinets, cliniques, hôpitaux)", desc: "Facturation par acte, assureurs, pharmacie", grille: "B", dispo: false },
  { id: "ong", label: "ONG, associations, églises", desc: "Fonds affectés, bailleurs, reçus de dons", grille: "B", dispo: false },
  { id: "btp", label: "BTP et construction", desc: "Chantiers, situations de travaux, sous-traitants", grille: "C", dispo: false },
  { id: "immobilier", label: "Immobilier et location", desc: "Biens, baux, loyers, quittances", grille: "C", dispo: false },
  { id: "restauration", label: "Restauration et hôtellerie", desc: "Coût des plats, tables, chambres", grille: "C", dispo: false },
  { id: "transport", label: "Transport et logistique", desc: "Véhicules, carburant, tournées", grille: "C", dispo: false },
  { id: "agriculture", label: "Agriculture et élevage", desc: "Campagnes agricoles, récoltes, intrants", grille: "C", dispo: false },
];
const secteurLabel = (id) => { const s = SECTEURS_CATALOGUE.find((x) => x.id === id); return s ? s.label : id; };

// Lit les secteurs de l'entreprise. Lecture à part, tolérante : si les colonnes n'existent pas encore (script SQL pas
// encore exécuté) ou en cas de coupure réseau, on renvoie un état « non chargé » et l'application fonctionne comme avant.
async function loadSecteursInfo(companyId) {
  const vide = { sectors: [], locked: false, pack: false, extra: [], ok: false, companyId: companyId || null };
  if (!companyId) return vide;
  try {
    const { data, error } = await supabase.from("companies").select("sectors, sectors_locked, sector_pack, extra_blocks").eq("id", companyId).single();
    if (error || !data) return vide;
    return { sectors: data.sectors || [], locked: !!data.sectors_locked, pack: !!data.sector_pack, extra: data.extra_blocks || [], ok: true, companyId };
  } catch (e) { return vide; }
}

// Quels blocs l'entreprise peut-elle utiliser ? inclus = les 3 secteurs sont couverts par son forfait (ou son essai).
function secteursDroits(info, ctx) {
  const i = info || { sectors: [], extra: [], pack: false };
  const c = ctx || {};
  const inclus = c.planTier === "assisted" || !!c.groupId || !!i.pack || c.planStatus === "trial";
  const actifs = Array.from(new Set([...(inclus ? (i.sectors || []) : []), ...(i.extra || [])]));
  return { inclus, actifs };
}

function SecteursListe({ sel, onToggle, disabled }) {
  return (
    <div className="space-y-2">
      {SECTEURS_CATALOGUE.map((s) => {
        const on = sel.includes(s.id);
        const bloque = !on && sel.length >= SECTEURS_MAX;
        return (
          <label key={s.id} className="flex items-start gap-3 p-3 rounded cursor-pointer"
            style={{ border: "1px solid " + (on ? "#0F6B5C" : "#E4DFD1"), background: on ? "#E6F1EE" : "#fff", opacity: bloque || disabled ? 0.55 : 1 }}>
            <input type="checkbox" checked={on} disabled={bloque || disabled} onChange={() => onToggle(s.id)} data-testid={"secteur-" + s.id} className="mt-1" />
            <span className="text-sm" style={{ color: "#152238" }}>
              <span className="font-medium">{s.label}</span>
              <span className="block text-xs" style={{ color: "#7A7460" }}>{s.desc}{s.dispo ? "" : " — bloc en préparation"}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

// Premier choix (définitif) des secteurs, par un administrateur de l'entreprise.
function SecteursChoixModal({ companyId, onSaved, onClose, showToast }) {
  const [sel, setSel] = useState([]);
  const [saving, setSaving] = useState(false);
  const toggle = (id) => setSel((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < SECTEURS_MAX ? [...p, id] : p));
  const save = async () => {
    if (saving) return;
    if (sel.length === 0) { showToast("Choisissez au moins un secteur."); return; }
    if (!window.confirm("Ce choix est définitif : seul le centre de gestion pourra le modifier, sur demande. Confirmer ces secteurs ?")) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.from("companies").update({ sectors: sel, sectors_locked: true }).eq("id", companyId).select("sectors").maybeSingle();
      if (error || !data) { showToast(friendlyError(error, "Ce choix n'a pas pu être enregistré. Réessayez ; si le problème continue, contactez le support.")); setSaving(false); return; }
      showToast("Vos secteurs sont enregistrés.");
      onSaved && onSaved();
    } catch (e) { showToast(friendlyError(e)); setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(21,34,56,0.55)" }} data-testid="secteurs-modal">
      <div className="bg-white rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" style={{ border: "1px solid #E4DFD1" }}>
        <div className="text-lg font-medium mb-1" style={{ color: "#152238" }}>Choisissez vos secteurs d'activité</div>
        <p className="text-xs mb-4" style={{ color: "#7A7460" }}>
          Jusqu'à {SECTEURS_MAX} secteurs, choisis une seule fois. Chaque secteur ajoute à Compta+ des écrans et des états propres à votre métier.
          Votre activité de commerce et de services est toujours couverte par le socle de base.
        </p>
        <SecteursListe sel={sel} onToggle={toggle} disabled={saving} />
        <div className="text-xs mt-3" style={{ color: "#7A7460" }} data-testid="secteurs-compte">{sel.length} sur {SECTEURS_MAX} choisis</div>
        <div className="flex gap-2 mt-4">
          <button onClick={save} disabled={saving || sel.length === 0} className="px-4 py-2 rounded text-sm text-white" style={{ background: "#152238", opacity: saving || sel.length === 0 ? 0.5 : 1 }} data-testid="secteurs-confirmer">Confirmer (définitif)</button>
          <button onClick={onClose} disabled={saving} className="px-4 py-2 rounded text-sm" style={{ border: "1px solid #DDD6C4", color: "#7A7460" }} data-testid="secteurs-plus-tard">Plus tard</button>
        </div>
      </div>
    </div>
  );
}

// Carte « Mes secteurs » (Administration → Entreprise) : état, choix initial, demande de changement.
function SecteursCard({ companyId, info, droits, showToast, onChanged, currentUserEmail }) {
  const [choisir, setChoisir] = useState(false);
  const [demande, setDemande] = useState(null); // demande en attente
  const [formOuvert, setFormOuvert] = useState(false);
  const [sel, setSel] = useState([]);
  const [motif, setMotif] = useState("");
  const [busy, setBusy] = useState(false);
  const charger = async () => {
    if (!companyId) return;
    try {
      const { data } = await supabase.from("sector_change_requests").select("*").eq("company_id", companyId).eq("status", "pending").maybeSingle();
      setDemande(data || null);
    } catch (e) { /* table pas encore migrée : pas de demande affichée */ }
  };
  useEffect(() => { charger(); }, [companyId, info && info.locked]);
  if (!info || !info.ok) return null;
  const toggle = (id) => setSel((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < SECTEURS_MAX ? [...p, id] : p));
  const envoyer = async () => {
    if (busy) return;
    if (sel.length === 0) { showToast("Choisissez au moins un secteur."); return; }
    if (!motif.trim()) { showToast("Indiquez le motif de votre demande."); return; }
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: co } = await supabase.from("companies").select("name").eq("id", companyId).maybeSingle();
      const { error } = await supabase.from("sector_change_requests").insert({
        company_id: companyId, company_name: (co && co.name) || "", requested_by_user_id: user && user.id,
        requested_by_email: (user && user.email) || currentUserEmail || "", current_sectors: info.sectors, requested_sectors: sel, reason: motif.trim(), status: "pending",
      });
      if (error) { showToast(friendlyError(error, "La demande n'a pas pu être envoyée. Réessayez ; si le problème continue, contactez le support.")); setBusy(false); return; }
      showToast("Demande envoyée au centre de gestion.");
      setFormOuvert(false); setSel([]); setMotif(""); setBusy(false);
      charger();
    } catch (e) { showToast(friendlyError(e)); setBusy(false); }
  };
  const annuler = async () => {
    if (!demande || busy) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("sector_change_requests").update({ status: "cancelled" }).eq("id", demande.id);
      if (error) { showToast(friendlyError(error)); setBusy(false); return; }
      showToast("Demande annulée."); setBusy(false); charger();
    } catch (e) { showToast(friendlyError(e)); setBusy(false); }
  };
  return (
    <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }} data-testid="secteurs-card">
      <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Mes secteurs d'activité</div>
      {!info.locked ? (
        <>
          <p className="text-xs mb-3" style={{ color: "#7A7460" }}>Vous n'avez pas encore choisi vos secteurs. Le choix se fait une seule fois, jusqu'à {SECTEURS_MAX} secteurs.</p>
          {droits && !droits.inclus ? (
            <p className="text-xs" style={{ color: "#9A7B1E" }} data-testid="secteurs-supplement">Votre forfait Standard n'inclut pas les blocs par secteur : demandez le supplément « 3 secteurs » au support pour pouvoir choisir.</p>
          ) : (
            <button onClick={() => setChoisir(true)} className="px-4 py-2 rounded text-sm text-white" style={{ background: "#152238" }} data-testid="secteurs-choisir">Choisir mes secteurs</button>
          )}
        </>
      ) : (
        <>
          <ul className="text-sm mb-2" style={{ color: "#152238" }} data-testid="secteurs-liste">
            {info.sectors.map((id) => <li key={id}>• {secteurLabel(id)}</li>)}
          </ul>
          {info.extra.length > 0 && <p className="text-xs mb-2" style={{ color: "#7A7460" }}>Blocs supplémentaires : {info.extra.map(secteurLabel).join(", ")}.</p>}
          {droits && !droits.inclus && <p className="text-xs mb-2" style={{ color: "#9A7B1E" }} data-testid="secteurs-inactifs">Vos blocs sont en consultation seule : le supplément « 3 secteurs » n'est pas actif sur votre forfait Standard.</p>}
          <p className="text-xs mb-3" style={{ color: "#A39C87" }}>Ce choix est verrouillé. Pour le modifier, envoyez une demande au centre de gestion.</p>
          {demande ? (
            <div className="text-xs p-3 rounded" style={{ background: "#FBF1DC", color: "#9A7B1E" }} data-testid="secteurs-demande-attente">
              Demande en attente : {(demande.requested_sectors || []).map(secteurLabel).join(", ")}.
              <button onClick={annuler} disabled={busy} className="ml-3 underline">Annuler la demande</button>
            </div>
          ) : formOuvert ? (
            <div className="mt-2">
              <SecteursListe sel={sel} onToggle={toggle} disabled={busy} />
              <textarea value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="Motif de la demande" rows={2} data-testid="secteurs-motif"
                className="w-full border rounded px-2 py-1.5 text-sm mt-3" style={{ borderColor: "#DDD6C4" }} />
              <div className="flex gap-2 mt-3">
                <button onClick={envoyer} disabled={busy} className="px-4 py-2 rounded text-sm text-white" style={{ background: "#152238", opacity: busy ? 0.5 : 1 }} data-testid="secteurs-envoyer">Envoyer la demande</button>
                <button onClick={() => setFormOuvert(false)} className="px-4 py-2 rounded text-sm" style={{ border: "1px solid #DDD6C4", color: "#7A7460" }}>Fermer</button>
              </div>
            </div>
          ) : (
            <button onClick={() => { setSel(info.sectors.slice()); setFormOuvert(true); }} className="px-4 py-2 rounded text-sm" style={{ border: "1px solid #DDD6C4", color: "#152238" }} data-testid="secteurs-demander">Demander un changement</button>
          )}
        </>
      )}
      {choisir && <SecteursChoixModal companyId={companyId} showToast={showToast} onClose={() => setChoisir(false)} onSaved={() => { setChoisir(false); onChanged && onChanged(); }} />}
    </div>
  );
}

// Centre de gestion → « Secteurs et blocs » : demandes de changement + réglage par entreprise
// (supplément « 3 secteurs » du forfait Standard, blocs achetés hors des 3 secteurs, remplacement des secteurs).
function SecteursGestionPanel({ showToast, currentUserEmail, logActivity }) {
  const [lignes, setLignes] = useState(null);
  const [demandes, setDemandes] = useState([]);
  const [choix, setChoix] = useState(null); // entreprise en cours de réglage
  const [edit, setEdit] = useState({ sectors: [], pack: false, extra: [] });
  const [filtre, setFiltre] = useState("");
  const [busy, setBusy] = useState(false);
  const [indispo, setIndispo] = useState(false);
  const charger = async () => {
    try {
      const { data: cos, error } = await supabase.from("companies").select("id, name, plan_tier, group_id, sectors, sectors_locked, sector_pack, extra_blocks").order("name");
      if (error) { setIndispo(true); setLignes([]); return; }
      setLignes(cos || []);
      const { data: dem } = await supabase.from("sector_change_requests").select("*").eq("status", "pending").order("created_at");
      setDemandes(dem || []);
    } catch (e) { setIndispo(true); setLignes([]); }
  };
  useEffect(() => { charger(); }, []);
  const tier = (c) => (c.group_id ? "Extension" : c.plan_tier === "assisted" ? "Assisté" : "Standard");
  const ouvrir = (c) => { setChoix(c); setEdit({ sectors: (c.sectors || []).slice(), pack: !!c.sector_pack, extra: (c.extra_blocks || []).slice() }); };
  const tg = (key, id, max) => setEdit((p) => ({ ...p, [key]: p[key].includes(id) ? p[key].filter((x) => x !== id) : (max && p[key].length >= max ? p[key] : [...p[key], id]) }));
  const enregistrer = async () => {
    if (!choix || busy) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.from("companies").update({ sectors: edit.sectors, sectors_locked: edit.sectors.length > 0, sector_pack: edit.pack, extra_blocks: edit.extra }).eq("id", choix.id).select("id").maybeSingle();
      if (error || !data) { showToast(friendlyError(error, "L'enregistrement n'a pas abouti. Réessayez.")); setBusy(false); return; }
      logActivity && logActivity("secteurs_modifies", `${choix.name} : ${edit.sectors.map(secteurLabel).join(", ") || "aucun"} — supplément ${edit.pack ? "oui" : "non"} — blocs ${edit.extra.map(secteurLabel).join(", ") || "aucun"}`);
      showToast("Secteurs et blocs enregistrés."); setChoix(null); setBusy(false); charger();
    } catch (e) { showToast(friendlyError(e)); setBusy(false); }
  };
  const decider = async (d, accepter) => {
    if (busy) return;
    if (!window.confirm(accepter ? `Accepter le changement de secteurs de « ${d.company_name} » ?` : `Refuser la demande de « ${d.company_name} » ?`)) return;
    setBusy(true);
    try {
      if (accepter) {
        const { data, error } = await supabase.from("companies").update({ sectors: d.requested_sectors, sectors_locked: true }).eq("id", d.company_id).select("id").maybeSingle();
        if (error || !data) { showToast(friendlyError(error, "Le changement n'a pas pu être appliqué. Réessayez.")); setBusy(false); return; }
      }
      const { error: e2 } = await supabase.from("sector_change_requests").update({ status: accepter ? "accepted" : "declined", decided_at: new Date().toISOString(), decided_by_email: currentUserEmail || "" }).eq("id", d.id);
      if (e2) { showToast(friendlyError(e2)); setBusy(false); return; }
      logActivity && logActivity(accepter ? "secteurs_demande_acceptee" : "secteurs_demande_refusee", d.company_name);
      showToast(accepter ? "Changement appliqué." : "Demande refusée."); setBusy(false); charger();
    } catch (e) { showToast(friendlyError(e)); setBusy(false); }
  };
  if (lignes === null) return <div className="text-sm" style={{ color: "#A39C87" }}>Chargement…</div>;
  if (indispo) return <div className="text-sm p-4 rounded" style={{ background: "#FBF1DC", color: "#9A7B1E" }} data-testid="secteurs-gestion-indispo">Les secteurs ne sont pas encore activés sur cette base (script SQL « secteurs et blocs » à exécuter).</div>;
  const vues = lignes.filter((c) => !filtre || String(c.name || "").toLowerCase().includes(filtre.toLowerCase()));
  return (
    <div className="space-y-6" data-testid="secteurs-gestion">
      <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
        <div className="text-sm font-medium mb-3" style={{ color: "#152238" }}>Demandes de changement de secteurs ({demandes.length})</div>
        {demandes.length === 0 ? <div className="text-xs" style={{ color: "#A39C87" }} data-testid="secteurs-aucune-demande">Aucune demande en attente.</div> : demandes.map((d) => (
          <div key={d.id} className="py-3" style={{ borderBottom: "1px solid #F3EFE3" }} data-testid="secteurs-demande">
            <div className="text-sm" style={{ color: "#152238" }}>{d.company_name} <span className="text-xs" style={{ color: "#8A8370" }}>— {d.requested_by_email}</span></div>
            <div className="text-xs mt-1" style={{ color: "#7A7460" }}>Actuels : {(d.current_sectors || []).map(secteurLabel).join(", ") || "aucun"} → Demandés : {(d.requested_sectors || []).map(secteurLabel).join(", ")}</div>
            <div className="text-xs mt-1" style={{ color: "#7A7460" }}>Motif : {d.reason}</div>
            <div className="flex gap-2 mt-2">
              <button onClick={() => decider(d, true)} disabled={busy} className="px-3 py-1.5 rounded text-xs text-white" style={{ background: "#0F6B5C" }} data-testid="secteurs-accepter">Accepter</button>
              <button onClick={() => decider(d, false)} disabled={busy} className="px-3 py-1.5 rounded text-xs" style={{ border: "1px solid #DDD6C4", color: "#A6432F" }} data-testid="secteurs-refuser">Refuser</button>
            </div>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
        <div className="text-sm font-medium mb-3" style={{ color: "#152238" }}>Réglage par entreprise</div>
        <input value={filtre} onChange={(e) => setFiltre(e.target.value)} placeholder="Rechercher une entreprise" className="w-full border rounded px-2 py-1.5 text-sm mb-3" style={{ borderColor: "#DDD6C4" }} data-testid="secteurs-filtre" />
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-left text-xs" style={{ color: "#8A8370", borderBottom: "1px solid #E4DFD1" }}>
            <th className="py-2 font-normal">Entreprise</th><th className="py-2 font-normal">Forfait</th><th className="py-2 font-normal">Secteurs</th><th className="py-2 font-normal">Supplément</th><th className="py-2 font-normal"></th>
          </tr></thead>
          <tbody>{vues.map((c) => (
            <tr key={c.id} style={{ borderBottom: "1px solid #F3EFE3" }} data-testid="secteurs-entreprise">
              <td className="py-1.5">{c.name}</td><td className="py-1.5 text-xs">{tier(c)}</td>
              <td className="py-1.5 text-xs">{(c.sectors || []).map(secteurLabel).join(", ") || <span style={{ color: "#A39C87" }}>non choisis</span>}{(c.extra_blocks || []).length ? " + " + c.extra_blocks.map(secteurLabel).join(", ") : ""}</td>
              <td className="py-1.5 text-xs">{c.group_id || c.plan_tier === "assisted" ? "inclus" : c.sector_pack ? "oui" : "non"}</td>
              <td className="py-1.5 text-right"><button onClick={() => ouvrir(c)} className="px-3 py-1 rounded text-xs" style={{ border: "1px solid #DDD6C4", color: "#152238" }} data-testid="secteurs-regler">Régler</button></td>
            </tr>))}</tbody>
        </table></div>
      </div>
      {choix && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(21,34,56,0.55)" }} data-testid="secteurs-reglage">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" style={{ border: "1px solid #E4DFD1" }}>
            <div className="text-base font-medium mb-3" style={{ color: "#152238" }}>{choix.name} — {tier(choix)}</div>
            <div className="text-xs mb-2" style={{ color: "#8A8370" }}>Les 3 secteurs de l'entreprise (au plus {SECTEURS_MAX})</div>
            <SecteursListe sel={edit.sectors} onToggle={(id) => tg("sectors", id, SECTEURS_MAX)} disabled={busy} />
            {tier(choix) === "Standard" && (
              <label className="flex items-center gap-2 text-sm mt-4" style={{ color: "#152238" }}>
                <input type="checkbox" checked={edit.pack} onChange={() => setEdit((p) => ({ ...p, pack: !p.pack }))} data-testid="secteurs-pack" />
                Supplément « 3 secteurs » payé ({SECTEURS_PRIX.pack} $ par mois)
              </label>
            )}
            <div className="text-xs mt-4 mb-2" style={{ color: "#8A8370" }}>Blocs supplémentaires achetés hors des 3 secteurs (grille : A {SECTEURS_PRIX.A} $, B {SECTEURS_PRIX.B} $, C {SECTEURS_PRIX.C} $)</div>
            <div className="flex flex-wrap gap-2">
              {SECTEURS_CATALOGUE.filter((s) => !edit.sectors.includes(s.id)).map((s) => (
                <label key={s.id} className="text-xs px-2 py-1 rounded cursor-pointer" style={{ border: "1px solid " + (edit.extra.includes(s.id) ? "#0F6B5C" : "#DDD6C4"), background: edit.extra.includes(s.id) ? "#E6F1EE" : "#fff" }}>
                  <input type="checkbox" className="mr-1" checked={edit.extra.includes(s.id)} onChange={() => tg("extra", s.id)} data-testid={"secteurs-extra-" + s.id} />{s.label} ({s.grille})
                </label>
              ))}
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={enregistrer} disabled={busy} className="px-4 py-2 rounded text-sm text-white" style={{ background: "#152238", opacity: busy ? 0.5 : 1 }} data-testid="secteurs-enregistrer">Enregistrer</button>
              <button onClick={() => setChoix(null)} disabled={busy} className="px-4 py-2 rounded text-sm" style={{ border: "1px solid #DDD6C4", color: "#7A7460" }}>Fermer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
