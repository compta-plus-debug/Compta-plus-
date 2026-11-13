// ═══ MODULE ═══
// @module Annonces et rappels
// @depends supabase, useEffect, useState
// @exports AnnouncementsAdminPanel, AnnouncementsBanner, EmailRemindersPanel
// ═══ FIN DE L'EN-TÊTE ═══
// --- Annonces de la plateforme -------------------------------------------------
// Les annonces sont écrites par l'équipe dans le Centre de gestion (onglet Annonces). Elles
// s'affichent à chaque ouverture de l'application et à chaque rechargement de la page, tant que
// l'équipe ne les a pas retirées et que leur période n'est pas terminée : une annonce longue
// reste ainsi un rappel. « J'ai lu » la masque seulement jusqu'au prochain rechargement ou à la
// prochaine session de travail. Sans connexion, rien ne s'affiche et rien ne bloque.
const _announcementsDismissed = new Set(); // masquées pour cette session de travail (mémoire de la page seulement)
function AnnouncementsBanner() {
  const [items, setItems] = useState([]);
  const [, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (typeof navigator !== "undefined" && navigator.onLine === false) return;
        const { data: u } = await supabase.auth.getUser();
        if (!(u && u.user && u.user.id)) return;
        const { data: ann, error } = await supabase.from("announcements").select("id, title, body, level, ends_at, active, created_at").eq("active", true).order("created_at", { ascending: false });
        if (error || !Array.isArray(ann) || ann.length === 0) return;
        const now = Date.now();
        const list = ann
          .filter((a) => a.active !== false && (!a.ends_at || Date.parse(a.ends_at) > now))
          .sort((x, y) => String(y.created_at || "").localeCompare(String(x.created_at || "")));
        if (!cancelled) setItems(list);
      } catch (e) { /* silencieux : une annonce manquée n'empêche jamais de travailler */ }
    })();
    return () => { cancelled = true; };
  }, []);
  const dismiss = (a) => { _announcementsDismissed.add(a.id); setTick((t) => t + 1); };
  const visible = items.filter((a) => !_announcementsDismissed.has(a.id)).slice(0, 3);
  if (visible.length === 0) return null;
  return (
    <div data-testid="announcements" style={{ position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 65, width: "min(92vw, 560px)", display: "flex", flexDirection: "column", gap: 8 }}>
      {visible.map((a) => (
        <div key={a.id} data-testid="announcement" role="status" style={{ background: a.level === "important" ? "#FBF1DC" : "#FFFFFF", border: "1px solid " + (a.level === "important" ? "#E0B94F" : "#DDD6C4"), borderRadius: 8, padding: 14, boxShadow: "0 4px 16px rgba(21,34,56,0.15)" }}>
          <div style={{ fontWeight: 600, color: "#152238", marginBottom: 4 }}>{a.level === "important" ? "Important · " : ""}{a.title}</div>
          <div style={{ fontSize: 14, color: "#4A4636", whiteSpace: "pre-wrap" }}>{a.body}</div>
          <div style={{ textAlign: "right", marginTop: 8 }}>
            <button data-testid="announcement-read" onClick={() => dismiss(a)} style={{ background: "#152238", color: "#fff", border: "none", borderRadius: 4, padding: "6px 14px", cursor: "pointer", fontSize: 13 }}>J'ai lu</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// Écran de l'équipe (Centre de gestion → Campagnes → Annonces) : créer, retirer, remettre une annonce.
function AnnouncementsAdminPanel({ showToast, currentUserEmail }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [level, setLevel] = useState("info");
  const [endsAt, setEndsAt] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from("announcements").select("id, title, body, level, ends_at, active, created_at").order("created_at", { ascending: false });
      if (error) { setMissing(true); setList([]); } else { setMissing(false); setList(data || []); }
    } catch (e) { setMissing(true); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);
  const publish = async () => {
    const t = title.trim(), b = body.trim();
    if (!t || !b) { showToast("Écrivez un titre et un message."); return; }
    setBusy(true);
    const row = { title: t, body: b, level, active: true, created_by: currentUserEmail || null };
    if (endsAt) row.ends_at = new Date(endsAt + "T23:59:59").toISOString();
    const { error } = await supabase.from("announcements").insert(row);
    setBusy(false);
    if (error) { showToast("L'annonce n'a pas pu être publiée. Réessayez dans un instant."); return; }
    setTitle(""); setBody(""); setLevel("info"); setEndsAt("");
    showToast("Annonce publiée : chaque utilisateur la verra à sa prochaine ouverture.");
    load();
  };
  const [reviveId, setReviveId] = useState(null);   // annonce en cours de remise en ligne
  const [reviveDate, setReviveDate] = useState("");   // nouvelle date de fin (facultative)
  const [confirmDelId, setConfirmDelId] = useState(null); // annonce dont la suppression attend confirmation
  // Modifier : change le titre, le message, l'importance et la date de fin SANS retirer ni supprimer l'annonce
  // (son état « affichée / retirée » et sa date de création ne changent pas).
  const [editId, setEditId] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editLevel, setEditLevel] = useState("info");
  const [editEnds, setEditEnds] = useState("");
  const toDateInput = (s) => { try { const d = new Date(s); const p = (n) => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); } catch (e) { return ""; } };
  const startEdit = (a) => { setConfirmDelId(null); setReviveId(null); setEditId(a.id); setEditTitle(a.title || ""); setEditBody(a.body || ""); setEditLevel(a.level === "important" ? "important" : "info"); setEditEnds(a.ends_at ? toDateInput(a.ends_at) : ""); };
  const cancelEdit = () => { setEditId(null); };
  const saveEdit = async (a) => {
    const t = editTitle.trim(), b = editBody.trim();
    if (!t || !b) { showToast("Écrivez un titre et un message."); return; }
    const patch = { title: t, body: b, level: editLevel, ends_at: editEnds ? new Date(editEnds + "T23:59:59").toISOString() : null };
    if (editEnds && Date.parse(patch.ends_at) <= Date.now() && a.active !== false && !isExpired(a)) { showToast("Choisissez une date de fin dans le futur, ou laissez vide."); return; }
    const { data, error } = await supabase.from("announcements").update(patch).eq("id", a.id).select("id");
    if (error || !Array.isArray(data) || data.length === 0) { showToast("La modification n'a pas pu être enregistrée."); return; }
    setEditId(null);
    showToast("Annonce modifiée.");
    load();
  };
  const isExpired = (a) => !!a.ends_at && Date.parse(a.ends_at) <= Date.now();
  // Retirer : l'annonce disparaît chez les utilisateurs mais reste dans la liste (on peut la remettre).
  const withdraw = async (a) => {
    const { error } = await supabase.from("announcements").update({ active: false }).eq("id", a.id);
    if (error) { showToast("La modification n'a pas pu être enregistrée."); return; }
    load();
  };
  // Remettre en ligne : active l'annonce ET remplace sa date de fin (vide = sans date de fin),
  // sinon une annonce expirée resterait invisible même « remise ».
  const revive = async (a) => {
    const patch = { active: true, ends_at: reviveDate ? new Date(reviveDate + "T23:59:59").toISOString() : null };
    if (reviveDate && Date.parse(patch.ends_at) <= Date.now()) { showToast("Choisissez une date de fin dans le futur, ou laissez vide."); return; }
    const { error } = await supabase.from("announcements").update(patch).eq("id", a.id);
    if (error) { showToast("La modification n'a pas pu être enregistrée."); return; }
    setReviveId(null); setReviveDate("");
    showToast("Annonce remise en ligne.");
    load();
  };
  // Supprimer : définitif, après une confirmation dans la page.
  const remove = async (a) => {
    const { data, error } = await supabase.from("announcements").delete().eq("id", a.id).select("id");
    if (error || !Array.isArray(data) || data.length === 0) { showToast("L'annonce n'a pas pu être supprimée."); setConfirmDelId(null); return; }
    setConfirmDelId(null);
    showToast("Annonce supprimée définitivement.");
    load();
  };
  const fmtD = (s) => { try { return new Date(s).toLocaleDateString("fr-FR"); } catch (e) { return ""; } };
  return (
    <div data-testid="announcements-admin">
      <div className="bg-white rounded-lg p-6 mb-4" style={{ border: "1px solid #E4DFD1" }}>
        <div className="text-sm font-medium mb-3" style={{ color: "#152238" }}>Nouvelle annonce</div>
        {missing && <p className="text-xs mb-3" style={{ color: "#A6432F" }}>Les annonces ne sont pas encore activées sur cette base de données.</p>}
        <input data-testid="ann-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titre (ex. Nouveauté : double authentification)" className="w-full border rounded px-3 py-2 text-sm mb-2" style={{ borderColor: "#DDD6C4" }} />
        <textarea data-testid="ann-body" value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="Message affiché aux utilisateurs" className="w-full border rounded px-3 py-2 text-sm mb-2" style={{ borderColor: "#DDD6C4" }} />
        <div className="flex flex-wrap gap-3 items-center mb-3 text-sm">
          <label>Importance :{" "}
            <select data-testid="ann-level" value={level} onChange={(e) => setLevel(e.target.value)} className="border rounded px-2 py-1" style={{ borderColor: "#DDD6C4" }}>
              <option value="info">Information</option>
              <option value="important">Important</option>
            </select>
          </label>
          <label>Afficher jusqu'au (facultatif) :{" "}
            <input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="border rounded px-2 py-1" style={{ borderColor: "#DDD6C4" }} />
          </label>
        </div>
        <button data-testid="ann-publish" onClick={publish} disabled={busy || missing} className="text-sm px-4 py-2 rounded text-white" style={{ background: "#152238", opacity: busy || missing ? 0.6 : 1 }}>Publier l'annonce</button>
      </div>
      <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
        <div className="text-sm font-medium mb-3" style={{ color: "#152238" }}>Annonces publiées</div>
        {loading ? <div className="text-sm" style={{ color: "#A39C87" }}>Chargement…</div> : list.length === 0 ? <div className="text-sm" style={{ color: "#A39C87" }}>Aucune annonce pour le moment.</div> : (
          <div className="space-y-3">
            {list.map((a) => (
              <div key={a.id} data-testid="ann-row" className="flex flex-col gap-2 text-sm" style={{ borderBottom: "1px solid #EEE9DA", paddingBottom: 8 }}>
                <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                  <div style={{ color: "#152238", fontWeight: 600 }}>{a.title} {a.level === "important" && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "#FBF1DC", color: "#9A7B1E" }}>Important</span>}</div>
                  <div className="text-xs" style={{ color: "#8A8370" }}>{fmtD(a.created_at)}{a.ends_at ? " · jusqu'au " + fmtD(a.ends_at) : ""} · {!a.active ? "retirée" : isExpired(a) ? "expirée" : "affichée"}</div>
                  <div style={{ color: "#4A4636", whiteSpace: "pre-wrap" }}>{a.body}</div>
                </div>
                <div className="flex flex-col items-start gap-2" style={{ maxWidth: "100%" }}>
                  {editId === a.id ? (
                    <div data-testid="ann-edit-box" className="w-full text-xs" style={{ color: "#152238" }}>
                      <input data-testid="ann-edit-title" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="w-full border rounded px-3 py-2 text-sm mb-2" style={{ borderColor: "#DDD6C4" }} />
                      <textarea data-testid="ann-edit-body" value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={4} className="w-full border rounded px-3 py-2 text-sm mb-2" style={{ borderColor: "#DDD6C4" }} />
                      <div className="flex flex-wrap gap-3 items-center mb-2">
                        <label>Importance :{" "}
                          <select data-testid="ann-edit-level" value={editLevel} onChange={(e) => setEditLevel(e.target.value)} className="border rounded px-2 py-1" style={{ borderColor: "#DDD6C4" }}>
                            <option value="info">Information</option>
                            <option value="important">Important</option>
                          </select>
                        </label>
                        <label>Afficher jusqu'au (facultatif) :{" "}
                          <input data-testid="ann-edit-date" type="date" value={editEnds} onChange={(e) => setEditEnds(e.target.value)} className="border rounded px-2 py-1" style={{ borderColor: "#DDD6C4" }} />
                        </label>
                      </div>
                      <button data-testid="ann-edit-save" onClick={() => saveEdit(a)} className="text-xs px-3 py-1.5 rounded text-white mr-2 mb-1" style={{ background: "#152238" }}>Enregistrer les modifications</button>
                      <button data-testid="ann-edit-cancel" onClick={cancelEdit} className="text-xs px-3 py-1.5 rounded border" style={{ borderColor: "#DDD6C4" }}>Annuler</button>
                    </div>
                  ) : confirmDelId === a.id ? (
                    <div data-testid="ann-delete-confirm" className="text-xs" style={{ color: "#A6432F" }}>
                      <div className="mb-1">Supprimer définitivement cette annonce ?</div>
                      <button data-testid="ann-delete-yes" onClick={() => remove(a)} className="text-xs px-3 py-1.5 rounded text-white mr-2 mb-1" style={{ background: "#A6432F" }}>Oui, supprimer</button>
                      <button data-testid="ann-delete-no" onClick={() => setConfirmDelId(null)} className="text-xs px-3 py-1.5 rounded border" style={{ borderColor: "#DDD6C4", color: "#152238" }}>Annuler</button>
                    </div>
                  ) : reviveId === a.id ? (
                    <div data-testid="ann-revive-box" className="text-xs" style={{ color: "#152238" }}>
                      <label className="block mb-2">Afficher jusqu'au (facultatif) :{" "}
                        <input data-testid="ann-revive-date" type="date" value={reviveDate} onChange={(e) => setReviveDate(e.target.value)} className="border rounded px-2 py-1" style={{ borderColor: "#DDD6C4" }} />
                      </label>
                      <button data-testid="ann-revive-ok" onClick={() => revive(a)} className="text-xs px-3 py-1.5 rounded text-white mr-2 mb-1" style={{ background: "#152238" }}>Remettre en ligne</button>
                      <button data-testid="ann-revive-cancel" onClick={() => { setReviveId(null); setReviveDate(""); }} className="text-xs px-3 py-1.5 rounded border" style={{ borderColor: "#DDD6C4" }}>Annuler</button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {a.active && !isExpired(a)
                        ? <button data-testid="ann-toggle" onClick={() => withdraw(a)} className="text-xs px-3 py-1.5 rounded border" style={{ borderColor: "#DDD6C4", color: "#152238" }}>Retirer</button>
                        : <button data-testid="ann-toggle" onClick={() => { setReviveId(a.id); setReviveDate(""); }} className="text-xs px-3 py-1.5 rounded border" style={{ borderColor: "#DDD6C4", color: "#152238" }}>Remettre en ligne</button>}
                      <button data-testid="ann-edit" onClick={() => startEdit(a)} className="text-xs px-3 py-1.5 rounded border" style={{ borderColor: "#DDD6C4", color: "#152238" }}>Modifier</button>
                      <button data-testid="ann-delete" onClick={() => setConfirmDelId(a.id)} className="text-xs px-3 py-1.5 rounded border" style={{ borderColor: "#E0B0A5", color: "#A6432F" }}>Supprimer</button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Rappels automatiques par email (réglage de l'entreprise) -------------------
// Chaque jour, le serveur peut écrire aux administrateurs de l'entreprise : fin proche de
// l'abonnement (7, 3 et 1 jour avant) et, chaque lundi, résumé des factures clients en retard.
// Ce réglage permet à l'administrateur principal de les couper.
function EmailRemindersPanel({ settings, setSettings, showToast, logAudit }) {
  const on = !(settings && settings.emailReminders === false);
  const toggle = () => {
    const next = !on;
    setSettings({ ...settings, emailReminders: next });
    try { logAudit && logAudit("Administration", next ? "Rappels par email activés" : "Rappels par email désactivés", ""); } catch (e) { /* ignoré */ }
    showToast(next ? "Les rappels par email sont activés." : "Les rappels par email sont désactivés.");
  };
  return (
    <div className="mt-6 p-4 rounded-lg" data-testid="email-reminders-panel" style={{ background: "#FAF8F1", border: "1px solid #EEE9DA" }}>
      <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Rappels par email aux administrateurs</div>
      <p className="text-xs mb-3" style={{ color: "#8A8370" }}>
        Chaque administrateur reçoit un email quand l'abonnement approche de sa fin (7, 3 et 1 jour avant), et chaque lundi un résumé des factures clients en retard de paiement. Aucun email n'est envoyé à vos clients.
      </p>
      <button data-testid="email-reminders-toggle" onClick={toggle} className="text-xs px-3 py-1.5 rounded text-white" style={{ background: on ? "#A6432F" : "#152238" }}>
        {on ? "Désactiver les rappels" : "Activer les rappels"}
      </button>
      <span className="text-xs ml-3" style={{ color: on ? "#0F6B5C" : "#8A8370" }}>{on ? "✓ Activés" : "Désactivés"}</span>
    </div>
  );
}
