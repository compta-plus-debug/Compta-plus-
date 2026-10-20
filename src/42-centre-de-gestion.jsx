// ═══ MODULE ═══
// @module Centre de gestion
// @depends AnnouncementsAdminPanel, BadgeDollar, CabinetBillingPanel, CabinetRequestsPanel, GroupedTabNav
//   SimpleGroupedBarChart, SupervisionPanel, SupportInbox, X, friendlyError, invokeEdgeFunction
//   logClientError, roleLabel, supabase, useEffect, useState
// @exports CentreDeGestionModule
// ═══ FIN DE L'EN-TÊTE ═══
function CentreDeGestionModule({ showToast, currentUserEmail, isPlatformAdmin }) {
  const [tab, setTab] = useState("entreprises");
  const [companies, setCompanies] = useState([]);
  const [members, setMembers] = useState([]);
  const [onlyWithAccountant, setOnlyWithAccountant] = useState(false);
  const [notes, setNotes] = useState([]);
  const [tags, setTags] = useState([]);
  const [collaborators, setCollaborators] = useState([]);
  const [activityLog, setActivityLog] = useState([]);
  const [payments, setPayments] = useState([]);
  const [offers, setOffers] = useState([]);
  const [offerTargets, setOfferTargets] = useState([]);
  const [prospects, setProspects] = useState([]);
  const [newProspectEmail, setNewProspectEmail] = useState("");
  const [newProspectName, setNewProspectName] = useState("");
  const [newProspectNote, setNewProspectNote] = useState("");
  const [includeShowcase, setIncludeShowcase] = useState(false);
  const [newOfferPalette, setNewOfferPalette] = useState("or");
  const [newOfferImageUrls, setNewOfferImageUrls] = useState([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [editOfferImageUrls, setEditOfferImageUrls] = useState([]);

  // Palettes de couleurs disponibles pour la présentation visuelle d'une
  // offre — pensées pour donner un effet "flyer" simple, sans surcharger,
  // réutilisées à l'identique dans l'aperçu de l'application et dans l'email
  // envoyé, pour que ce qui est vu avant l'envoi corresponde exactement.
  const OFFER_PALETTES = {
    or: { name: "Doré", bg: "linear-gradient(135deg, #9A7B1E 0%, #C9A24B 100%)", text: "#fff", accent: "#FBF1DC", accentText: "#9A7B1E" },
    nature: { name: "Nature", bg: "linear-gradient(135deg, #0F6B5C 0%, #3FA085 100%)", text: "#fff", accent: "#E6F1EE", accentText: "#0F6B5C" },
    ocean: { name: "Océan", bg: "linear-gradient(135deg, #152238 0%, #3F4F73 100%)", text: "#fff", accent: "#E8EAF0", accentText: "#152238" },
    rouge: { name: "Passion", bg: "linear-gradient(135deg, #A6432F 0%, #D8674E 100%)", text: "#fff", accent: "#F7E9E3", accentText: "#A6432F" },
    violet: { name: "Violet", bg: "linear-gradient(135deg, #5B3FA0 0%, #8A6FD1 100%)", text: "#fff", accent: "#EDEAF7", accentText: "#5B3FA0" },
  };
  const [loading, setLoading] = useState(true);
  const [activity, setActivity] = useState(null); // null = pas encore chargée ; { [companyId]: {...} } une fois chargée
  const [expandedCompanyId, setExpandedCompanyId] = useState(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [search, setSearch] = useState("");
  const [newCollabEmail, setNewCollabEmail] = useState("");
  const [newCollabRole, setNewCollabRole] = useState("gestionnaire");
  const [historyForCollab, setHistoryForCollab] = useState(null);
  const [newOfferTitle, setNewOfferTitle] = useState("");
  const [newOfferDesc, setNewOfferDesc] = useState("");
  const [newOfferDiscount, setNewOfferDiscount] = useState("");
  const [expandedOfferId, setExpandedOfferId] = useState(null);
  const [editingOfferId, setEditingOfferId] = useState(null);
  const [editOfferTitle, setEditOfferTitle] = useState("");
  const [editOfferDesc, setEditOfferDesc] = useState("");
  const [editOfferDiscount, setEditOfferDiscount] = useState("");
  const [editOfferShowcase, setEditOfferShowcase] = useState(false);
  const [editOfferPalette, setEditOfferPalette] = useState("or");

  // Permissions : un administrateur de plateforme a toujours accès à tout.
  // Un collaborateur ordinaire est limité à ce que le propriétaire lui a
  // explicitement accordé (par défaut : Entreprises, Offres, Statistiques —
  // jamais Collaborateurs, réservé au propriétaire).
  const myRecord = collaborators.find((c) => c.email.toLowerCase() === (currentUserEmail || "").toLowerCase());
  // « aide » (Centre d'aide) est accordé par défaut, y compris aux collaborateurs
  // déjà enregistrés avant l'existence de cette permission : répondre aux clients
  // est le cœur du rôle Support. Le propriétaire peut le retirer en le décochant.
  const basePerms = isPlatformAdmin
    ? { entreprises: true, offres: true, statistiques: true, collaborateurs: true, supervision: true }
    : (myRecord?.permissions || { entreprises: true, offres: true, statistiques: true, collaborateurs: false });
  const perms = { ...basePerms, aide: isPlatformAdmin ? true : basePerms.aide !== false, cabinets: isPlatformAdmin ? true : !!basePerms.offres, annonces: isPlatformAdmin ? true : !!basePerms.offres };

  // Nombre de messages d'utilisateurs pas encore lus — affiché sur l'onglet
  // et rafraîchi régulièrement pour ne jamais manquer une demande d'aide.
  const [inboxUnread, setInboxUnread] = useState(0);
  const refreshInboxUnread = async () => {
    try {
      const { count, error } = await supabase.from("support_messages").select("id", { count: "exact", head: true }).eq("sender", "user").eq("read_by_support", false);
      if (!error) setInboxUnread(count || 0);
    } catch (e) {}
  };
  useEffect(() => {
    if (!perms.aide) return undefined;
    refreshInboxUnread();
    const t = setInterval(() => { if (!document.hidden) refreshInboxUnread(); }, 45000);
    return () => clearInterval(t);
  }, [perms.aide]);

  // Étiquettes courantes proposées par défaut, avec une couleur selon leur
  // nature — rouge/alerte pour ce qui presse, vert pour ce qui est positif,
  // neutre pour le reste. Une étiquette tapée librement (hors de cette liste)
  // reçoit une couleur neutre par défaut.
  const DEFAULT_TAGS = [
    { label: "VIP", bg: "#FBF1DC", color: "#9A7B1E" },
    { label: "À relancer", bg: "#F7E9E3", color: "#A6432F" },
    { label: "Risque de départ", bg: "#F7E9E3", color: "#A6432F" },
    { label: "Offre envoyée", bg: "#E8EAF0", color: "#152238" },
    { label: "Sans réponse", bg: "#F3EFE3", color: "#7A7460" },
    { label: "Fidèle", bg: "#E6F1EE", color: "#0F6B5C" },
  ];
  const tagStyleFor = (tagText) => DEFAULT_TAGS.find((t) => t.label === tagText) || { bg: "#EDEAF7", color: "#5B3FA0" };

  const load = async () => {
    setLoading(true);
    const [{ data: cos }, { data: mems }, { data: nts }, { data: tgs }, { data: cols }, { data: log }, { data: pmts }, { data: offs }, { data: offTgts }, { data: prosp }, actRes] = await Promise.all([
      supabase.from("companies").select("id, name, plan_status, plan_tier, trial_ends_at, created_at, group_id"),
      supabase.from("company_members").select("id, company_id, email, role, user_id, is_primary_admin, created_at").order("created_at", { ascending: true }),
      supabase.from("company_notes").select("*").order("created_at", { ascending: false }),
      supabase.from("company_tags").select("*").order("created_at", { ascending: false }),
      supabase.from("management_collaborators").select("*").order("created_at", { ascending: true }),
      supabase.from("management_activity_log").select("*").order("created_at", { ascending: false }).limit(300),
      supabase.from("payments").select("company_id, date, amount").order("date", { ascending: false }),
      supabase.from("special_offers").select("*").order("created_at", { ascending: false }),
      supabase.from("special_offer_targets").select("*"),
      supabase.from("prospects").select("*").order("created_at", { ascending: false }),
      supabase.rpc("company_activity_summary"),
    ]);
    setCompanies(cos || []);
    // Marqueur « expert-comptable » (colonne is_accountant) : lu à part, sans bloquer
    // le chargement si la colonne n'existe pas encore sur ce projet. Lecture par pages de
    // 1000 pour ne jamais perdre de lignes, et croisement sur l'identifiant de la ligne.
    let memsFull = mems || [];
    try {
      const flagById = {};
      const flagByKey = {};
      let okAll = true;
      for (let from = 0; from < 20000; from += 1000) {
        const acc = await supabase.from("company_members").select("id, company_id, email, is_accountant").order("created_at", { ascending: true }).range(from, from + 999);
        if (acc.error || !acc.data) { okAll = false; break; }
        acc.data.forEach((r) => {
          if (r.id !== undefined && r.id !== null) flagById[r.id] = !!r.is_accountant;
          flagByKey[r.company_id + "|" + String(r.email || "").trim().toLowerCase()] = !!r.is_accountant;
        });
        if (acc.data.length < 1000) break;
      }
      if (okAll) {
        memsFull = memsFull.map((m) => ({ ...m, is_accountant: m.id !== undefined && flagById[m.id] !== undefined ? flagById[m.id] : !!flagByKey[m.company_id + "|" + String(m.email || "").trim().toLowerCase()] }));
      }
    } catch (e) { /* colonne absente : affichage inchangé */ }
    // Droit de régularisation (colonne facultative ajoutée en v235) : lecture à part, sans effet si absente.
    try {
      const adjById = {};
      for (let from = 0; from < 20000; from += 1000) {
        const r2 = await supabase.from("company_members").select("id, can_adjust").order("created_at", { ascending: true }).range(from, from + 999);
        if (r2.error || !r2.data) { break; }
        r2.data.forEach((r) => { adjById[r.id] = !!r.can_adjust; });
        if (r2.data.length < 1000) break;
      }
      memsFull = memsFull.map((m) => ({ ...m, can_adjust: !!adjById[m.id] }));
    } catch (e) { /* colonne absente */ }
    setMembers(memsFull);
    setNotes(nts || []);
    setTags(tgs || []);
    setCollaborators(cols || []);
    setPayments(pmts || []);
    setOffers(offs || []);
    setOfferTargets(offTgts || []);
    setProspects(prosp || []);
    setActivityLog(log || []);
    // Activité réelle par entreprise (factures, écritures, produits, clients,
    // achats saisis + date de dernière activité) — sert uniquement à repérer les
    // comptes qui exploitent réellement l'application, jamais le détail de leurs
    // données. La fonction n'existe pas tant que la migration correspondante n'a
    // pas été exécutée : on continue alors sans bloquer le reste du chargement.
    if (!actRes.error && actRes.data) {
      setActivity(Object.fromEntries(actRes.data.map((a) => [a.company_id, a])));
    } else {
      setActivity({});
      if (actRes.error) {
        const detail = actRes.error.message || actRes.error.code || "erreur inconnue";
        showToast(friendlyError(actRes.error));
        logClientError("company_activity_summary: " + detail, JSON.stringify(actRes.error), window.location.href);
      }
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Journalise une action pour le suivi de travail par collaborateur — en
  // tâche de fond, sans jamais bloquer ni faire échouer l'action elle-même
  // si cette écriture rate pour une raison quelconque.
  const logActivity = (actionType, targetDescription) => {
    const entry = { id: crypto.randomUUID(), actor_email: currentUserEmail, action_type: actionType, target_description: targetDescription, created_at: new Date().toISOString() };
    setActivityLog((prev) => [entry, ...prev]);
    supabase.from("management_activity_log").insert(entry).then(({ error }) => { if (error) console.error("log activité :", error.message); });
  };

  const membersFor = (companyId) => members.filter((m) => m.company_id === companyId);
  const renewalEstimateFor = (companyId) => {
    const lastPayment = payments.find((p) => p.company_id === companyId);
    if (!lastPayment) return null;
    const estimate = new Date(lastPayment.date);
    estimate.setDate(estimate.getDate() + 30);
    return estimate;
  };
  const creatorFor = (companyId) => (membersFor(companyId).find((m) => !m.is_accountant) || membersFor(companyId)[0])?.email || "—";
  const accountantsFor = (companyId) => membersFor(companyId).filter((m) => m.is_accountant);
  // Nombre de dossiers suivis par chaque adresse d'expert-comptable (= cabinet).
  const cabinetCount = (email) => members.filter((m) => m.is_accountant && String(m.email || "").toLowerCase() === String(email || "").toLowerCase()).length;
  const notesFor = (companyId) => notes.filter((n) => n.company_id === companyId);
  const tagsFor = (companyId) => tags.filter((t) => t.company_id === companyId);

  // Génère l'identifiant nous-mêmes plutôt que de nous fier à .select() juste
  // après l'insertion (source connue de comportements RLS peu fiables dans ce
  // projet) — la ligne locale est donc garantie cohérente avec ce qui a été
  // réellement envoyé, même si le retour de la requête est ignoré.
  const addNote = async (companyId, companyName) => {
    if (!noteDraft.trim()) return;
    const entry = { id: crypto.randomUUID(), company_id: companyId, author_email: currentUserEmail, content: noteDraft.trim(), created_at: new Date().toISOString() };
    const { error } = await supabase.from("company_notes").insert(entry);
    if (error) { showToast(friendlyError(error)); return; }
    setNotes((prev) => [entry, ...prev]);
    setNoteDraft("");
    logActivity("note_ajoutee", companyName);
  };

  const addTag = async (companyId, tagText, companyName) => {
    const value = (tagText ?? tagDraft).trim();
    if (!value) return;
    const entry = { id: crypto.randomUUID(), company_id: companyId, tag: value, created_at: new Date().toISOString() };
    const { error } = await supabase.from("company_tags").insert(entry);
    if (error) { showToast(friendlyError(error)); return; }
    setTags((prev) => [entry, ...prev]);
    setTagDraft("");
    logActivity("etiquette_ajoutee", `${companyName} — ${value}`);
  };

  const removeTag = async (tagId, companyName, tagText) => {
    const { error } = await supabase.from("company_tags").delete().eq("id", tagId);
    if (error) { showToast(friendlyError(error)); return; }
    setTags((prev) => prev.filter((t) => t.id !== tagId));
    logActivity("etiquette_retiree", `${companyName} — ${tagText}`);
  };

  const inviteCollaborator = async () => {
    if (!newCollabEmail.trim()) return;
    const entry = { id: crypto.randomUUID(), email: newCollabEmail.trim().toLowerCase(), role: newCollabRole, invited_by: currentUserEmail, created_at: new Date().toISOString() };
    const { error } = await supabase.from("management_collaborators").insert(entry);
    if (error) { showToast(friendlyError(error)); return; }
    setCollaborators((prev) => [...prev, entry]);
    setNewCollabEmail("");
    showToast("Collaborateur ajouté.");
    logActivity("collaborateur_ajoute", entry.email);
  };

  const removeCollaborator = async (id, email) => {
    if (!window.confirm(`Retirer l'accès de ${email} au Centre de gestion ?`)) return;
    const { error } = await supabase.from("management_collaborators").delete().eq("id", id);
    if (error) { showToast(friendlyError(error)); return; }
    setCollaborators((prev) => prev.filter((c) => c.id !== id));
    logActivity("collaborateur_retire", email);
  };

  const updatePermission = async (collabId, key, value) => {
    const collab = collaborators.find((c) => c.id === collabId);
    const newPerms = { ...(collab.permissions || {}), [key]: value };
    const { error } = await supabase.from("management_collaborators").update({ permissions: newPerms }).eq("id", collabId);
    if (error) { showToast(friendlyError(error)); return; }
    setCollaborators((prev) => prev.map((c) => (c.id === collabId ? { ...c, permissions: newPerms } : c)));
  };

  // Téléverse une image (flyer, capture d'écran, photo) vers le stockage
  // dédié aux offres, et renvoie son adresse publique — utilisable
  // directement dans l'email envoyé, même par un destinataire qui n'est
  // jamais connecté à l'application.
  const uploadOfferImage = async (file, setImages) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { showToast("Image trop lourde (5 Mo maximum)."); return; }
    setUploadingImage(true);
    const path = `${crypto.randomUUID()}-${file.name}`;
    const { error } = await supabase.storage.from("offer-images").upload(path, file);
    setUploadingImage(false);
    if (error) { showToast(friendlyError(error)); return; }
    const { data } = supabase.storage.from("offer-images").getPublicUrl(path);
    setImages((prev) => [...prev, { url: data.publicUrl, caption: "" }]);
  };
  // Une image enregistrée avant cet ajout est encore une simple chaîne (l'URL
  // seule, sans texte) — normalisée ici pour toujours manipuler {url, caption}
  // partout ailleurs, sans avoir à distinguer l'ancien et le nouveau format.
  const normalizeImages = (arr) => (arr || []).map((img) => (typeof img === "string" ? { url: img, caption: "" } : img));

  const createOffer = async () => {
    if (!newOfferTitle.trim()) return;
    const entry = { id: crypto.randomUUID(), title: newOfferTitle.trim(), description: newOfferDesc.trim() || null, discount_pct: newOfferDiscount ? Number(newOfferDiscount) : null, include_showcase: includeShowcase, palette: newOfferPalette, image_urls: newOfferImageUrls, created_by: currentUserEmail, created_at: new Date().toISOString() };
    const { error } = await supabase.from("special_offers").insert(entry);
    if (error) { showToast(friendlyError(error)); return; }
    setOffers((prev) => [entry, ...prev]);
    setNewOfferTitle(""); setNewOfferDesc(""); setNewOfferDiscount(""); setIncludeShowcase(false); setNewOfferPalette("or"); setNewOfferImageUrls([]);
    logActivity("offre_creee", entry.title);
    showToast("Offre créée.");
  };

  const startEditOffer = (offer) => {
    setEditingOfferId(offer.id);
    setEditOfferTitle(offer.title);
    setEditOfferDesc(offer.description || "");
    setEditOfferDiscount(offer.discount_pct != null ? String(offer.discount_pct) : "");
    setEditOfferShowcase(!!offer.include_showcase);
    setEditOfferPalette(offer.palette || "or");
    setEditOfferImageUrls((offer.image_urls && offer.image_urls.length > 0) ? offer.image_urls : (offer.image_url ? [offer.image_url] : []));
  };

  const saveOfferEdit = async () => {
    if (!editOfferTitle.trim()) return;
    const patch = { title: editOfferTitle.trim(), description: editOfferDesc.trim() || null, discount_pct: editOfferDiscount ? Number(editOfferDiscount) : null, include_showcase: editOfferShowcase, palette: editOfferPalette, image_urls: editOfferImageUrls };
    const { error } = await supabase.from("special_offers").update(patch).eq("id", editingOfferId);
    if (error) { showToast(friendlyError(error)); return; }
    setOffers((prev) => prev.map((o) => (o.id === editingOfferId ? { ...o, ...patch } : o)));
    logActivity("offre_modifiee", editOfferTitle.trim());
    setEditingOfferId(null);
    showToast("Offre modifiée.");
  };

  const deleteOffer = async (offer) => {
    if (!window.confirm(`Supprimer définitivement l'offre « ${offer.title} » ? Son historique de ciblage sera aussi supprimé.`)) return;
    const { error } = await supabase.from("special_offers").delete().eq("id", offer.id);
    if (error) { showToast(friendlyError(error)); return; }
    setOffers((prev) => prev.filter((o) => o.id !== offer.id));
    setOfferTargets((prev) => prev.filter((t) => t.offer_id !== offer.id));
    logActivity("offre_supprimee", offer.title);
    showToast("Offre supprimée.");
  };


  // de l'application et dans l'email réellement envoyé.
  // Bannière façon flyer, générée en HTML pour être identique dans l'aperçu
  // de l'application et dans l'email réellement envoyé.
  const buildOfferBannerHtml = (offer) => {
    const images = normalizeImages(offer.image_urls && offer.image_urls.length > 0 ? offer.image_urls : (offer.image_url ? [offer.image_url] : []));
    if (images.length > 0) {
      return images.map((img) => `<img src="${img.url}" alt="${offer.title}" style="width:100%;max-width:100%;border-radius:12px;display:block;margin-bottom:${img.caption ? "4px" : "10px"};" />${img.caption ? `<p style="text-align:center;font-size:13px;color:#7A7460;margin:0 0 10px;">${img.caption}</p>` : ""}`).join("");
    }
    const p = OFFER_PALETTES[offer.palette] || OFFER_PALETTES.or;
    return `
      <div style="background:${p.bg};border-radius:12px;padding:28px 24px;text-align:center;color:${p.text};">
        ${offer.discount_pct ? `<div style="font-size:40px;font-weight:800;line-height:1;">-${offer.discount_pct}%</div>` : ""}
        <div style="font-size:20px;font-weight:700;margin-top:${offer.discount_pct ? "8px" : "0"};">${offer.title}</div>
      </div>`;
  };

  // Bouton d'appel à l'action — ramène directement sur l'écran de connexion
  // de l'application (pas seulement la page marketing), pour ne pas faire
  // perdre une étape à un prospect déjà convaincu par l'email.
  const OFFER_CTA_URL = "https://comptaplus.app/?login=1";
  const buildOfferCtaHtml = (offer) => {
    const p = OFFER_PALETTES[offer.palette] || OFFER_PALETTES.or;
    return `
      <table cellpadding="0" cellspacing="0" style="margin:20px auto;"><tr><td style="border-radius:8px;background:${p.bg};">
        <a href="${OFFER_CTA_URL}" style="display:inline-block;padding:14px 32px;color:${p.text};font-weight:700;text-decoration:none;font-size:15px;">Cliquez ici pour créer votre entreprise</a>
      </td></tr></table>`;
  };

  const addProspect = async () => {
    if (!newProspectEmail.trim()) return;
    const entry = { id: crypto.randomUUID(), email: newProspectEmail.trim().toLowerCase(), name: newProspectName.trim() || null, note: newProspectNote.trim() || null, created_by: currentUserEmail, created_at: new Date().toISOString() };
    const { error } = await supabase.from("prospects").insert(entry);
    if (error) { showToast(friendlyError(error)); return; }
    setProspects((prev) => [entry, ...prev]);
    setNewProspectEmail(""); setNewProspectName(""); setNewProspectNote("");
    showToast("Prospect ajouté.");
    return entry;
  };

  // Résout l'email et le nom d'affichage d'une cible d'offre, qu'elle pointe
  // vers une entreprise déjà cliente ou vers un simple prospect.
  const emailForTarget = (t) => t.company_id ? creatorFor(t.company_id) : (prospects.find((p) => p.id === t.prospect_id)?.email || "—");
  const nameForTarget = (t) => {
    if (t.company_id) return companies.find((c) => c.id === t.company_id)?.name || "?";
    const p = prospects.find((pr) => pr.id === t.prospect_id);
    return p ? (p.name || p.email) + " (prospect)" : "?";
  };

  const toggleOfferTarget = async (offerId, companyId) => {
    const existing = offerTargets.find((t) => t.offer_id === offerId && t.company_id === companyId);
    if (existing) {
      await supabase.from("special_offer_targets").delete().eq("id", existing.id);
      setOfferTargets((prev) => prev.filter((t) => t.id !== existing.id));
    } else {
      const entry = { id: crypto.randomUUID(), offer_id: offerId, company_id: companyId, prospect_id: null, status: "a_envoyer" };
      const { error } = await supabase.from("special_offer_targets").insert(entry);
      if (error) { showToast(friendlyError(error)); return; }
      setOfferTargets((prev) => [...prev, entry]);
    }
  };

  const addProspectAsTarget = async (offerId, prospectId) => {
    const existing = offerTargets.find((t) => t.offer_id === offerId && t.prospect_id === prospectId);
    if (existing) return;
    const entry = { id: crypto.randomUUID(), offer_id: offerId, company_id: null, prospect_id: prospectId, status: "a_envoyer" };
    const { error } = await supabase.from("special_offer_targets").insert(entry);
    if (error) { showToast(friendlyError(error)); return; }
    setOfferTargets((prev) => [...prev, entry]);
  };

  const removeTarget = async (target) => {
    if (!window.confirm(`Retirer « ${nameForTarget(target)} » de cette offre ?`)) return;
    const { error } = await supabase.from("special_offer_targets").delete().eq("id", target.id);
    if (error) { showToast(friendlyError(error)); return; }
    setOfferTargets((prev) => prev.filter((t) => t.id !== target.id));
  };

  const setTargetStatus = async (targetId, status) => {
    const patch = { status };
    if (status === "envoyee") patch.sent_at = new Date().toISOString();
    if (status === "acceptee" || status === "refusee") patch.responded_at = new Date().toISOString();
    const { error } = await supabase.from("special_offer_targets").update(patch).eq("id", targetId);
    if (error) { showToast(friendlyError(error)); return; }
    setOfferTargets((prev) => prev.map((t) => (t.id === targetId ? { ...t, ...patch } : t)));
  };

  // Bloc HTML léger de présentation des fonctionnalités — utile pour un
  // prospect qui ne connaît pas encore Compta+, en complément du texte de
  // l'offre elle-même. Conçu pour rester lisible dans un client email
  // classique (pas de JS, mise en forme simple par tableau/couleurs).
  const FEATURE_SHOWCASE_HTML = `
    <table cellpadding="0" cellspacing="0" style="width:100%;margin:20px 0;border-collapse:separate;border-spacing:8px;">
      <tr>
        <td style="background:#F3EFE3;border-radius:8px;padding:14px;width:50%;"><strong style="color:#152238;">📊 Comptabilité en partie double</strong><br><span style="color:#7A7460;font-size:13px;">Journal, bilan et compte de résultat générés automatiquement.</span></td>
        <td style="background:#F3EFE3;border-radius:8px;padding:14px;width:50%;"><strong style="color:#152238;">🧾 Point de vente & facturation</strong><br><span style="color:#7A7460;font-size:13px;">Encaissez et facturez en quelques secondes.</span></td>
      </tr>
      <tr>
        <td style="background:#F3EFE3;border-radius:8px;padding:14px;"><strong style="color:#152238;">📦 Stock & inventaire</strong><br><span style="color:#7A7460;font-size:13px;">Suivi en temps réel, alertes de réapprovisionnement.</span></td>
        <td style="background:#F3EFE3;border-radius:8px;padding:14px;"><strong style="color:#152238;">📈 Rapports en continu</strong><br><span style="color:#7A7460;font-size:13px;">Bilan et analyse des ventes toujours à jour.</span></td>
      </tr>
    </table>`;

  const [sendingOfferId, setSendingOfferId] = useState(null);
  // Envoi réel par email, via la fonction serveur send-offer-email (Resend) —
  // n'envoie qu'aux cibles encore au statut "à envoyer" pour cette offre,
  // pour ne jamais renvoyer deux fois le même email à quelqu'un.
  const sendOfferEmails = async (offer) => {
    const targets = offerTargets.filter((t) => t.offer_id === offer.id && t.status === "a_envoyer");
    const emails = targets.map((t) => emailForTarget(t)).filter((e) => e && e !== "—");
    if (emails.length === 0) { showToast("Aucune entreprise à contacter pour cette offre."); return; }
    setSendingOfferId(offer.id);
    const html = `${buildOfferBannerHtml(offer)}<p style="margin-top:16px;">${(offer.description || "").replace(/\n/g, "<br>")}</p>${offer.include_showcase ? FEATURE_SHOWCASE_HTML : ""}${buildOfferCtaHtml(offer)}`;
    const { error } = await invokeEdgeFunction("send-offer-email", { to: emails, subject: offer.title, html });
    setSendingOfferId(null);
    if (error) { showToast(friendlyError(error)); return; }
    for (const t of targets) await setTargetStatus(t.id, "envoyee");
    logActivity("offre_envoyee", `${offer.title} — ${emails.length} destinataire(s)`);
    showToast(`Offre envoyée à ${emails.length} destinataire(s).`);
  };

  const filteredCompanies = companies.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return c.name.toLowerCase().includes(q) || membersFor(c.id).some((m) => m.email.toLowerCase().includes(q));
  }).filter((c) => !onlyWithAccountant || accountantsFor(c.id).length > 0);

  const ACTION_LABELS = {
    note_ajoutee: "Note ajoutée", etiquette_ajoutee: "Étiquette ajoutée", etiquette_retiree: "Étiquette retirée",
    collaborateur_ajoute: "Collaborateur ajouté", collaborateur_retire: "Collaborateur retiré", offre_creee: "Offre créée", offre_envoyee: "Offre envoyée par email", offre_modifiee: "Offre modifiée", offre_supprimee: "Offre supprimée", support_reponse: "Réponse au Centre d'aide", groupe_cree_pour_entreprise: "Groupe multi-entreprises créé",
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-widest" style={{ color: "#5B3FA0" }}>Centre de gestion</div>
        <div className="display text-3xl" style={{ color: "#152238" }}>Gestion commerciale</div>
      </header>

      <GroupedTabNav
        tab={tab}
        setTab={setTab}
        groups={[
          ...(perms.entreprises ? [{ label: "Entreprises", color: { bg: "#5B3FA0", text: "#fff", light: "#EDEAF7", lightText: "#5B3FA0" }, tabs: [["entreprises", "Entreprises"]] }] : []),
          ...(perms.offres ? [{ label: "Campagnes", color: { bg: "#9A7B1E", text: "#fff", light: "#FBF1DC", lightText: "#9A7B1E" }, tabs: [["offres", "Offres spéciales"], ["annonces", "Annonces"], ["cabinets", "Cabinets"]] }] : []),
          ...(perms.statistiques ? [{ label: "Statistiques", color: { bg: "#0F6B5C", text: "#fff", light: "#E6F1EE", lightText: "#0F6B5C" }, tabs: [["statistiques", "Statistiques"]] }] : []),
          ...(perms.supervision ? [{ label: "Supervision", color: { bg: "#3B5C1F", text: "#fff", light: "#EEF4E2", lightText: "#3B5C1F" }, tabs: [["supervision", "Supervision"]] }] : []),
          ...(perms.aide ? [{ label: "Centre d'aide", color: { bg: "#A6432F", text: "#fff", light: "#F7E9E3", lightText: "#A6432F" }, tabs: [["aide", `Messages${inboxUnread ? ` (${inboxUnread})` : ""}`]] }] : []),
          ...(perms.collaborateurs ? [{ label: "Équipe", color: { bg: "#152238", text: "#fff", light: "#E8EAF0", lightText: "#152238" }, tabs: [["collaborateurs", "Collaborateurs"]] }] : []),
        ]}
      />

      {!perms[tab] && tab !== "entreprises" && (() => { setTab("entreprises"); return null; })()}

      {loading ? (
        <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>Chargement…</div>
      ) : tab === "entreprises" ? (
        <div>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher une entreprise ou un email..."
            className="w-full border rounded px-3 py-2 text-sm mb-2" style={{ borderColor: "#DDD6C4" }} />
          <label className="text-xs flex items-center gap-2 mb-4" style={{ color: "#5C6B8C" }}>
            <input type="checkbox" checked={onlyWithAccountant} onChange={(e) => setOnlyWithAccountant(e.target.checked)} data-testid="only-accountant" />
            Afficher seulement les entreprises suivies par un expert-comptable ({companies.filter((c) => accountantsFor(c.id).length > 0).length})
          </label>
          {filteredCompanies.length === 0 ? (
            <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>Aucune entreprise ne correspond.</div>
          ) : (
          <div className="space-y-2">
            {filteredCompanies.map((c) => {
              const isExpanded = expandedCompanyId === c.id;
              const compMembers = membersFor(c.id);
              const daysLeft = c.trial_ends_at ? Math.ceil((new Date(c.trial_ends_at) - new Date()) / 86400000) : null;
              const renewal = c.plan_status === "active" ? renewalEstimateFor(c.id) : null;
              const compTags = tagsFor(c.id);
              const act = activity ? activity[c.id] : null;
              const dataCount = act ? (act.invoices_count + act.entries_count + act.products_count + act.clients_count + act.purchases_count) : null;
              return (
                <div key={c.id} style={{ background: "#fff", borderRadius: 8, overflow: "hidden", boxShadow: "0 1px 2px rgba(21,34,56,0.06)" }}>
                  <div className="flex items-center justify-between gap-2 px-4 py-3 cursor-pointer" onClick={() => setExpandedCompanyId(isExpanded ? null : c.id)}>
                    <div className="min-w-0">
                      <div className="font-medium truncate" style={{ color: "#152238" }}>{c.name}</div>
                      <div className="text-xs truncate" style={{ color: "#A39C87" }}>{creatorFor(c.id)}</div>
                      {accountantsFor(c.id).length > 0 && (
                        <div className="mt-1"><span data-testid="badge-accountant" className="text-xs px-2 py-0.5 rounded-full" style={{ background: "#EDEAF7", color: "#5B3FA0" }}>Rôle Expert-comptable : {accountantsFor(c.id).map((a) => a.email).join(", ")}</span></div>
                      )}
                      {compTags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {compTags.map((t) => {
                            const style = tagStyleFor(t.tag);
                            return <span key={t.id} className="text-xs px-2 py-0.5 rounded-full" style={{ background: style.bg, color: style.color }}>{t.tag}</span>;
                          })}
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-xs px-2 py-0.5 rounded" style={{
                        background: c.plan_status === "active" ? "#E6F1EE" : c.plan_status === "trial" ? "#FBF1DC" : "#F7E9E3",
                        color: c.plan_status === "active" ? "#0F6B5C" : c.plan_status === "trial" ? "#9A7B1E" : "#A6432F",
                      }}>{c.plan_status === "active" ? "Payant" : c.plan_status === "trial" ? "Essai" : "Suspendu"}</span>
                      {dataCount !== null && (
                        <div className="mt-1">
                          <span className="text-xs px-2 py-0.5 rounded" style={{ background: dataCount > 0 ? "#E8EAF0" : "#F3EFE3", color: dataCount > 0 ? "#152238" : "#A39C87" }}>
                            {dataCount > 0 ? `${dataCount} donnée${dataCount > 1 ? "s" : ""}` : "Sans activité"}
                          </span>
                        </div>
                      )}
                      {renewal && (
                        <div className="text-xs mt-1" style={{ color: "#A39C87" }}>Renouv. ~{renewal.toLocaleDateString("fr-FR")}</div>
                      )}
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="px-4 pb-4" style={{ borderTop: "1px solid #F0EDE3" }}>
                      <div className="grid grid-cols-2 gap-2 mt-3 mb-3 text-xs">
                        <div className="p-2 rounded" style={{ background: "#FAF8F1" }}>
                          <div style={{ color: "#A39C87" }}>Forfait</div>
                          <div style={{ color: "#152238", fontWeight: 500 }}>{c.group_id ? "Extension" : c.plan_tier === "assisted" ? "Assisté" : "Standard"}</div>
                        </div>
                        <div className="p-2 rounded" style={{ background: "#FAF8F1" }}>
                          <div style={{ color: "#A39C87" }}>{c.plan_status === "trial" ? "Fin d'essai" : "Statut"}</div>
                          <div style={{ color: "#152238", fontWeight: 500 }}>
                            {c.plan_status === "trial" && c.trial_ends_at ? `${c.trial_ends_at.slice(0, 10)} (${daysLeft}j)` : (c.plan_status === "active" ? "Payant" : "Suspendu")}
                          </div>
                        </div>
                      </div>
                      {c.group_id && (() => {
                        const siblings = companies.filter((s) => s.group_id === c.group_id && s.id !== c.id);
                        return (
                          <div className="text-xs mb-3 px-2 py-2 rounded" style={{ background: "#E6F1EE", color: "#0F6B5C" }}>
                            <div>Fait partie d'un groupe multi-entreprises — {siblings.length + 1} entreprise{siblings.length + 1 > 1 ? "s" : ""}</div>
                            {siblings.length > 0 && (
                              <ul className="mt-1 ml-3" style={{ listStyle: "disc" }}>
                                {siblings.map((s) => <li key={s.id}>{s.name || "(sans nom)"}</li>)}
                              </ul>
                            )}
                          </div>
                        );
                      })()}
                      {act && (
                        <div className="p-2.5 rounded mb-3 text-xs" style={{ background: dataCount > 0 ? "#FAF8F1" : "#F3EFE3" }}>
                          <div className="flex items-center justify-between mb-1.5">
                            <span style={{ color: "#A39C87" }}>Activité réelle</span>
                            <span style={{ color: "#A39C87" }}>
                              {act.last_activity ? `Dernière activité : ${new Date(act.last_activity).toLocaleDateString("fr-FR")}` : "Aucune activité enregistrée"}
                            </span>
                          </div>
                          {dataCount > 0 ? (
                            <div className="flex flex-wrap gap-x-3 gap-y-1" style={{ color: "#152238" }}>
                              {act.invoices_count > 0 && <span>{act.invoices_count} facture{act.invoices_count > 1 ? "s" : ""}</span>}
                              {act.entries_count > 0 && <span>{act.entries_count} écriture{act.entries_count > 1 ? "s" : ""}</span>}
                              {act.products_count > 0 && <span>{act.products_count} produit{act.products_count > 1 ? "s" : ""}</span>}
                              {act.clients_count > 0 && <span>{act.clients_count} client{act.clients_count > 1 ? "s" : ""}</span>}
                              {act.purchases_count > 0 && <span>{act.purchases_count} achat{act.purchases_count > 1 ? "s" : ""}</span>}
                            </div>
                          ) : (
                            <div style={{ color: "#A6432F" }}>Aucune donnée saisie depuis l'inscription — compte probablement inactif ou de test.</div>
                          )}
                        </div>
                      )}
                      <div className="text-xs mb-3">
                        <div style={{ color: "#A39C87" }} className="mb-1">Membres ({compMembers.length})</div>
                        <div className="space-y-0.5">
                          {compMembers.map((m) => (
                            <div key={m.email} data-testid="member-row" style={{ color: "#152238" }}>{m.email} <span data-testid="member-role" style={{ color: m.is_accountant ? "#5B3FA0" : "#A39C87", fontWeight: m.is_accountant ? 600 : 400 }}>— {m.is_accountant ? "Rôle : Expert-comptable" : roleLabel(m.role)}</span>{!m.user_id && <span className="ml-1 text-xs" style={{ color: "#9A7B1E" }}>(invitation en attente)</span>}
                              {m.is_accountant && <span data-testid="badge-cabinet" className="ml-2 text-xs px-1.5 py-0.5 rounded" style={{ background: "#EDEAF7", color: "#5B3FA0" }}>Cabinet · {cabinetCount(m.email)} dossier{cabinetCount(m.email) > 1 ? "s" : ""}</span>}
                              {m.is_accountant && <span className="ml-1 text-xs" style={{ color: "#A39C87" }}>{m.can_adjust ? "(consultation + écritures de régularisation autorisées)" : "(consultation seule, par conception)"}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5 mb-2 items-center">
                        {tagsFor(c.id).map((t) => {
                          const style = tagStyleFor(t.tag);
                          return (
                            <span key={t.id} className="flex items-center gap-1 rounded-full text-xs pl-3 pr-1.5 py-1" style={{ background: style.bg, color: style.color }}>
                              {t.tag}
                              <button onClick={() => removeTag(t.id, c.name, t.tag)} style={{ color: style.color, opacity: 0.6 }}><X size={11} /></button>
                            </span>
                          );
                        })}
                      </div>
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {DEFAULT_TAGS.filter((dt) => !tagsFor(c.id).some((t) => t.tag === dt.label)).map((dt) => (
                          <button key={dt.label} onClick={() => addTag(c.id, dt.label, c.name)} className="text-xs px-2.5 py-1 rounded-full" style={{ background: dt.bg, color: dt.color }}>+ {dt.label}</button>
                        ))}
                      </div>
                      <div className="flex gap-2 mb-4">
                        <input value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} placeholder="Autre étiquette..."
                          onKeyDown={(e) => e.key === "Enter" && addTag(c.id, null, c.name)}
                          className="flex-1 border rounded px-2 py-1.5 text-xs" style={{ borderColor: "#DDD6C4" }} />
                        <button onClick={() => addTag(c.id, null, c.name)} className="text-xs px-3 py-1.5 rounded shrink-0" style={{ background: "#F3EFE3", color: "#7A7460" }}>Ajouter</button>
                      </div>
                      <div className="space-y-2 mb-3">
                        {notesFor(c.id).length === 0 ? (
                          <div className="text-xs" style={{ color: "#A39C87" }}>Aucune note pour le moment.</div>
                        ) : notesFor(c.id).map((n) => (
                          <div key={n.id} className="text-xs p-2 rounded" style={{ background: "#FAF8F1" }}>
                            <div style={{ color: "#152238" }}>{n.content}</div>
                            <div style={{ color: "#A39C87" }} className="mt-1">{n.author_email} · {new Date(n.created_at).toLocaleDateString("fr-FR")}</div>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <input value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="Ajouter une note..."
                          onKeyDown={(e) => e.key === "Enter" && addNote(c.id, c.name)}
                          className="flex-1 border rounded px-2 py-1.5 text-xs" style={{ borderColor: "#DDD6C4" }} />
                        <button onClick={() => addNote(c.id, c.name)} className="text-xs px-3 py-1.5 rounded text-white shrink-0" style={{ background: "#152238" }}>Ajouter</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          )}
        </div>
      ) : tab === "annonces" ? (
        <AnnouncementsAdminPanel showToast={showToast} currentUserEmail={currentUserEmail} />
      ) : tab === "offres" ? (
        <div>
          <div className="bg-white rounded-lg p-6 mb-4" style={{ border: "1px solid #E4DFD1" }}>
            <div className="text-sm font-medium mb-3" style={{ color: "#152238" }}>Nouvelle offre</div>
            <div className="grid gap-2 mb-2">
              <input value={newOfferTitle} onChange={(e) => setNewOfferTitle(e.target.value)} placeholder="Titre (ex. Promo de fin d'année)"
                className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }} />
              <textarea value={newOfferDesc} onChange={(e) => setNewOfferDesc(e.target.value)} placeholder="Description (texte à réutiliser dans l'email)"
                rows={2} className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }} />
              <input value={newOfferDiscount} onChange={(e) => setNewOfferDiscount(e.target.value)} type="number" placeholder="% de réduction (optionnel)"
                className="border rounded px-2 py-1.5 text-sm w-40" style={{ borderColor: "#DDD6C4" }} />
              <label className="flex items-center gap-2 text-xs" style={{ color: "#7A7460" }}>
                <input type="checkbox" checked={includeShowcase} onChange={(e) => setIncludeShowcase(e.target.checked)} />
                Inclure une présentation visuelle des fonctionnalités (utile pour un prospect qui ne connaît pas encore Compta+)
              </label>
              <div>
                <div className="text-xs mb-1.5" style={{ color: "#A39C87" }}>Images / flyers (optionnel — remplacent le bandeau de couleur si fournis)</div>
                {newOfferImageUrls.length > 0 && (
                  <div className="space-y-2 mb-2">
                    {normalizeImages(newOfferImageUrls).map((img, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <div className="relative shrink-0">
                          <img src={img.url} alt="Aperçu" style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 8 }} />
                          <button onClick={() => setNewOfferImageUrls((prev) => prev.filter((_, j) => j !== i))} type="button"
                            className="absolute flex items-center justify-center" style={{ top: -6, right: -6, width: 18, height: 18, borderRadius: "50%", background: "#A6432F", color: "#fff" }}><X size={11} /></button>
                        </div>
                        <input value={img.caption || ""} placeholder="Texte facultatif sous cette image..."
                          onChange={(e) => setNewOfferImageUrls((prev) => normalizeImages(prev).map((im, j) => (j === i ? { ...im, caption: e.target.value } : im)))}
                          className="flex-1 border rounded px-2 py-1.5 text-xs" style={{ borderColor: "#DDD6C4" }} />
                      </div>
                    ))}
                  </div>
                )}
                <input type="file" accept="image/*" disabled={uploadingImage} key={newOfferImageUrls.length}
                  onChange={(e) => uploadOfferImage(e.target.files[0], setNewOfferImageUrls)}
                  className="text-xs" />
                {uploadingImage && <div className="text-xs mt-1" style={{ color: "#A39C87" }}>Envoi en cours...</div>}
              </div>
              {newOfferImageUrls.length === 0 && (
                <div>
                  <div className="text-xs mb-1.5" style={{ color: "#A39C87" }}>Palette de couleurs</div>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(OFFER_PALETTES).map(([key, p]) => (
                      <button key={key} onClick={() => setNewOfferPalette(key)} type="button"
                        className="text-xs px-3 py-1.5 rounded-full flex items-center gap-1.5"
                        style={{ background: p.bg, color: p.text, border: newOfferPalette === key ? "2px solid #152238" : "2px solid transparent" }}>
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {(newOfferTitle.trim() || newOfferDiscount || newOfferImageUrls.length > 0) && (
                <div>
                  <div className="text-xs mb-1.5" style={{ color: "#A39C87" }}>Aperçu (façon flyer)</div>
                  <div dangerouslySetInnerHTML={{ __html: buildOfferBannerHtml({ title: newOfferTitle.trim() || "Titre de l'offre", discount_pct: newOfferDiscount || null, palette: newOfferPalette, image_urls: newOfferImageUrls }) + buildOfferCtaHtml({ palette: newOfferPalette }) }} />
                </div>
              )}
            </div>
            <button onClick={createOffer} className="text-xs px-3 py-1.5 rounded text-white" style={{ background: "#152238" }}>Créer l'offre</button>
          </div>

          <div className="bg-white rounded-lg p-6 mb-4" style={{ border: "1px solid #E4DFD1" }}>
            <div className="text-sm font-medium mb-3" style={{ color: "#152238" }}>Prospects (contacts sans entreprise enregistrée)</div>
            <div className="space-y-1 mb-3">
              {prospects.length === 0 ? (
                <div className="text-xs" style={{ color: "#A39C87" }}>Aucun prospect ajouté pour le moment.</div>
              ) : prospects.map((p) => (
                <div key={p.id} className="text-xs p-2 rounded" style={{ background: "#FAF8F1" }}>
                  <div style={{ color: "#152238" }}>{p.name ? `${p.name} — ` : ""}{p.email}</div>
                  {p.note && <div style={{ color: "#A39C87" }} className="mt-0.5">{p.note}</div>}
                </div>
              ))}
            </div>
            <div className="grid gap-2 mb-2">
              <input value={newProspectEmail} onChange={(e) => setNewProspectEmail(e.target.value)} placeholder="Email du prospect"
                className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }} />
              <input value={newProspectName} onChange={(e) => setNewProspectName(e.target.value)} placeholder="Nom ou entreprise (optionnel)"
                className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }} />
              <input value={newProspectNote} onChange={(e) => setNewProspectNote(e.target.value)} placeholder="Note (ex. où vous l'avez identifié)"
                className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <button onClick={addProspect} className="text-xs px-3 py-1.5 rounded text-white" style={{ background: "#152238" }}>Ajouter le prospect</button>
          </div>

          {(() => {
            const historyRows = offerTargets
              .filter((t) => t.status !== "a_envoyer")
              .map((t) => {
                const offer = offers.find((o) => o.id === t.offer_id);
                return { ...t, offerTitle: offer?.title || "?", companyName: nameForTarget(t), email: emailForTarget(t), when: t.responded_at || t.sent_at };
              })
              .sort((a, b) => new Date(b.when || 0) - new Date(a.when || 0));
            if (historyRows.length === 0) return null;
            const STATUS_LABELS = { envoyee: "Envoyée", acceptee: "Acceptée", refusee: "Refusée" };
            const STATUS_COLORS = { envoyee: { bg: "#E8EAF0", color: "#152238" }, acceptee: { bg: "#E6F1EE", color: "#0F6B5C" }, refusee: { bg: "#F7E9E3", color: "#A6432F" } };
            return (
              <div className="bg-white rounded-lg p-4 mb-4" style={{ border: "1px solid #E4DFD1" }}>
                <div className="text-sm font-medium mb-3" style={{ color: "#152238" }}>Historique des promotions attribuées</div>
                <div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: "#FBF1DC" }}>
                      <th className="py-2 px-3 text-left font-medium" style={{ color: "#9A7B1E", fontSize: 11, textTransform: "uppercase" }}>Offre</th>
                      <th className="py-2 px-3 text-left font-medium" style={{ color: "#9A7B1E", fontSize: 11, textTransform: "uppercase" }}>Entreprise</th>
                      <th className="py-2 px-3 text-left font-medium" style={{ color: "#9A7B1E", fontSize: 11, textTransform: "uppercase" }}>Email</th>
                      <th className="py-2 px-3 text-left font-medium" style={{ color: "#9A7B1E", fontSize: 11, textTransform: "uppercase" }}>Statut</th>
                      <th className="py-2 px-3 text-left font-medium" style={{ color: "#9A7B1E", fontSize: 11, textTransform: "uppercase" }}>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyRows.map((r) => (
                      <tr key={r.id} style={{ borderTop: "1px solid #F3EFE3" }}>
                        <td className="py-1.5 px-3" style={{ color: "#152238" }}>{r.offerTitle}</td>
                        <td className="py-1.5 px-3" style={{ color: "#152238" }}>{r.companyName}</td>
                        <td className="py-1.5 px-3" style={{ color: "#7A7460" }}>{r.email}</td>
                        <td className="py-1.5 px-3"><span className="text-xs px-2 py-0.5 rounded-full" style={{ background: STATUS_COLORS[r.status]?.bg, color: STATUS_COLORS[r.status]?.color }}>{STATUS_LABELS[r.status] || r.status}</span></td>
                        <td className="py-1.5 px-3 tabular" style={{ color: "#A39C87" }}>{r.when ? new Date(r.when).toLocaleDateString("fr-FR") : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              </div>
            );
          })()}

          {offers.length === 0 ? (
            <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>Aucune offre créée pour le moment.</div>
          ) : offers.map((o) => {
            const isExpandedOffer = expandedOfferId === o.id;
            const targets = offerTargets.filter((t) => t.offer_id === o.id);
            const emailsToSend = targets.filter((t) => t.status === "a_envoyer").map((t) => emailForTarget(t)).filter((e) => e !== "—");
            const countByStatus = { a_envoyer: 0, envoyee: 0, acceptee: 0, refusee: 0 };
            targets.forEach((t) => { countByStatus[t.status] = (countByStatus[t.status] || 0) + 1; });
            return (
              <div key={o.id} className="mb-3" style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 2px 6px rgba(21,34,56,0.10)", border: "1px solid #F0EDE3" }}>
                <div className="flex items-stretch cursor-pointer" onClick={() => setExpandedOfferId(isExpandedOffer ? null : o.id)}>
                  {(normalizeImages(o.image_urls)[0]?.url || o.image_url) ? (
                    <div className="shrink-0" style={{ width: 84, overflow: "hidden" }}>
                      <img src={normalizeImages(o.image_urls)[0]?.url || o.image_url} alt={o.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    </div>
                  ) : o.discount_pct ? (
                    <div className="flex flex-col items-center justify-center shrink-0 px-4" style={{ background: (OFFER_PALETTES[o.palette] || OFFER_PALETTES.or).bg, color: (OFFER_PALETTES[o.palette] || OFFER_PALETTES.or).text, minWidth: 84 }}>
                      <div className="text-2xl font-bold leading-none">-{o.discount_pct}%</div>
                      <div className="text-xs uppercase tracking-wide mt-0.5" style={{ opacity: 0.9 }}>réduction</div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center shrink-0 px-4" style={{ background: (OFFER_PALETTES[o.palette] || OFFER_PALETTES.or).accent, minWidth: 60 }}>
                      <span style={{ color: (OFFER_PALETTES[o.palette] || OFFER_PALETTES.or).accentText }}><BadgeDollar size={22} /></span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0 px-4 py-3">
                    <div className="font-semibold truncate" style={{ color: "#152238" }}>{o.title}</div>
                    <div className="text-xs mt-0.5" style={{ color: "#A39C87" }}>
                      {new Date(o.created_at).toLocaleDateString("fr-FR")} · {o.created_by}
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {countByStatus.a_envoyer > 0 && <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "#F3EFE3", color: "#7A7460" }}>{countByStatus.a_envoyer} à envoyer</span>}
                      {countByStatus.envoyee > 0 && <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "#E8EAF0", color: "#152238" }}>{countByStatus.envoyee} envoyée{countByStatus.envoyee > 1 ? "s" : ""}</span>}
                      {countByStatus.acceptee > 0 && <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "#E6F1EE", color: "#0F6B5C" }}>{countByStatus.acceptee} acceptée{countByStatus.acceptee > 1 ? "s" : ""}</span>}
                      {countByStatus.refusee > 0 && <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "#F7E9E3", color: "#A6432F" }}>{countByStatus.refusee} refusée{countByStatus.refusee > 1 ? "s" : ""}</span>}
                      {targets.length === 0 && <span className="text-xs" style={{ color: "#A39C87" }}>Aucun destinataire ciblé</span>}
                    </div>
                  </div>
                </div>
                {isExpandedOffer && editingOfferId === o.id && (
                  <div className="px-4 pb-4" style={{ borderTop: "1px solid #F0EDE3" }}>
                    <div className="grid gap-2 mt-3 mb-2">
                      <input value={editOfferTitle} onChange={(e) => setEditOfferTitle(e.target.value)} placeholder="Titre"
                        className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }} />
                      <textarea value={editOfferDesc} onChange={(e) => setEditOfferDesc(e.target.value)} rows={2}
                        className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }} />
                      <input value={editOfferDiscount} onChange={(e) => setEditOfferDiscount(e.target.value)} type="number" placeholder="% de réduction (optionnel)"
                        className="border rounded px-2 py-1.5 text-sm w-40" style={{ borderColor: "#DDD6C4" }} />
                      <label className="flex items-center gap-2 text-xs" style={{ color: "#7A7460" }}>
                        <input type="checkbox" checked={editOfferShowcase} onChange={(e) => setEditOfferShowcase(e.target.checked)} />
                        Inclure une présentation visuelle des fonctionnalités
                      </label>
                      <div>
                        <div className="text-xs mb-1.5" style={{ color: "#A39C87" }}>Palette de couleurs</div>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(OFFER_PALETTES).map(([key, p]) => (
                            <button key={key} onClick={() => setEditOfferPalette(key)} type="button"
                              className="text-xs px-3 py-1.5 rounded-full flex items-center gap-1.5"
                              style={{ background: p.bg, color: p.text, border: editOfferPalette === key ? "2px solid #152238" : "2px solid transparent" }}>
                              {p.name}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs mb-1.5" style={{ color: "#A39C87" }}>Images / flyers (optionnel — remplacent le bandeau de couleur si fournis)</div>
                        {editOfferImageUrls.length > 0 && (
                          <div className="space-y-2 mb-2">
                            {normalizeImages(editOfferImageUrls).map((img, i) => (
                              <div key={i} className="flex items-start gap-2">
                                <div className="relative shrink-0">
                                  <img src={img.url} alt="Aperçu" style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 8 }} />
                                  <button onClick={() => setEditOfferImageUrls((prev) => prev.filter((_, j) => j !== i))} type="button"
                                    className="absolute flex items-center justify-center" style={{ top: -6, right: -6, width: 18, height: 18, borderRadius: "50%", background: "#A6432F", color: "#fff" }}><X size={11} /></button>
                                </div>
                                <input value={img.caption || ""} placeholder="Texte facultatif sous cette image..."
                                  onChange={(e) => setEditOfferImageUrls((prev) => normalizeImages(prev).map((im, j) => (j === i ? { ...im, caption: e.target.value } : im)))}
                                  className="flex-1 border rounded px-2 py-1.5 text-xs" style={{ borderColor: "#DDD6C4" }} />
                              </div>
                            ))}
                          </div>
                        )}
                        <input type="file" accept="image/*" disabled={uploadingImage} key={editOfferImageUrls.length}
                          onChange={(e) => uploadOfferImage(e.target.files[0], setEditOfferImageUrls)}
                          className="text-xs" />
                        {uploadingImage && <div className="text-xs mt-1" style={{ color: "#A39C87" }}>Envoi en cours...</div>}
                      </div>
                      {editOfferImageUrls.length === 0 && (
                        <div>
                          <div className="text-xs mb-1.5" style={{ color: "#A39C87" }}>Palette de couleurs</div>
                          <div className="flex flex-wrap gap-2">
                            {Object.entries(OFFER_PALETTES).map(([key, p]) => (
                              <button key={key} onClick={() => setEditOfferPalette(key)} type="button"
                                className="text-xs px-3 py-1.5 rounded-full flex items-center gap-1.5"
                                style={{ background: p.bg, color: p.text, border: editOfferPalette === key ? "2px solid #152238" : "2px solid transparent" }}>
                                {p.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      <div>
                        <div className="text-xs mb-1.5" style={{ color: "#A39C87" }}>Aperçu</div>
                        <div dangerouslySetInnerHTML={{ __html: buildOfferBannerHtml({ title: editOfferTitle.trim() || "Titre de l'offre", discount_pct: editOfferDiscount || null, palette: editOfferPalette, image_urls: editOfferImageUrls }) + buildOfferCtaHtml({ palette: editOfferPalette }) }} />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={saveOfferEdit} className="text-xs px-3 py-1.5 rounded text-white" style={{ background: "#152238" }}>Enregistrer</button>
                      <button onClick={() => setEditingOfferId(null)} className="text-xs px-3 py-1.5 rounded" style={{ background: "#F3EFE3", color: "#7A7460" }}>Annuler</button>
                    </div>
                  </div>
                )}
                {isExpandedOffer && editingOfferId !== o.id && (
                  <div className="px-4 pb-4" style={{ borderTop: "1px solid #F0EDE3" }}>
                    <div className="flex gap-3 mt-3 mb-1">
                      <button onClick={() => startEditOffer(o)} className="text-xs underline" style={{ color: "#152238" }}>Éditer</button>
                      <button onClick={() => deleteOffer(o)} className="text-xs underline" style={{ color: "#A6432F" }}>Supprimer</button>
                    </div>
                    {o.description && <p className="text-sm mt-3 mb-3 p-3 rounded" style={{ color: "#152238", background: "#FAF8F1" }}>{o.description}</p>}
                    {(() => {
                      const awaitingTargets = targets.filter((t) => t.status === "a_envoyer");
                      if (awaitingTargets.length === 0) {
                        return (
                          <div className="mb-3 p-3 rounded text-xs" style={{ background: "#FAF8F1", color: "#A39C87" }}>
                            {targets.length === 0 ? "Ajoutez au moins une entreprise ou un prospect ci-dessous pour pouvoir envoyer cette offre." : "Tous les destinataires ciblés ont déjà été traités (envoyée, acceptée ou refusée)."}
                          </div>
                        );
                      }
                      if (emailsToSend.length === 0) {
                        return (
                          <div className="mb-3 p-3 rounded text-xs" style={{ background: "#F7E9E3", color: "#A6432F" }}>
                            {awaitingTargets.length} destinataire{awaitingTargets.length > 1 ? "s" : ""} à envoyer, mais aucun email n'a pu être retrouvé (voir la liste plus bas).
                          </div>
                        );
                      }
                      return (
                        <div className="mb-3 p-3 rounded text-xs" style={{ background: "#FBF1DC" }}>
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <div className="font-medium" style={{ color: "#9A7B1E" }}>Emails à contacter ({emailsToSend.length})</div>
                            <button onClick={() => sendOfferEmails(o)} disabled={sendingOfferId === o.id}
                              className="text-xs px-3 py-1 rounded text-white shrink-0" style={{ background: "#9A7B1E", opacity: sendingOfferId === o.id ? 0.6 : 1 }}>
                              {sendingOfferId === o.id ? "Envoi..." : "Envoyer par email"}
                            </button>
                          </div>
                          <div style={{ color: "#152238", wordBreak: "break-all" }}>{emailsToSend.join(", ")}</div>
                        </div>
                      );
                    })()}
                    <div className="text-xs mb-2" style={{ color: "#A39C87" }}>Destinataires ciblés</div>
                    <div className="space-y-1 mb-3">
                      {targets.length === 0 ? (
                        <div className="text-xs" style={{ color: "#A39C87" }}>Aucun destinataire ciblé — ajoutez-en ci-dessous.</div>
                      ) : targets.map((t) => (
                          <div key={t.id} className="flex items-center justify-between gap-2 text-xs p-1.5 rounded" style={{ background: "#FAF8F1" }}>
                            <span style={{ color: "#152238" }}>{nameForTarget(t)}</span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <select value={t.status} onChange={(e) => setTargetStatus(t.id, e.target.value)} className="border rounded px-1 py-0.5 text-xs" style={{ borderColor: "#DDD6C4" }}>
                                <option value="a_envoyer">À envoyer</option>
                                <option value="envoyee">Envoyée</option>
                                <option value="acceptee">Acceptée</option>
                                <option value="refusee">Refusée</option>
                              </select>
                              <button onClick={() => removeTarget(t)} style={{ color: "#A6432F" }}><X size={13} /></button>
                            </div>
                          </div>
                      ))}
                    </div>
                    <div className="text-xs mb-1" style={{ color: "#A39C87" }}>Ajouter une entreprise à cette offre</div>
                    <select onChange={(e) => { if (e.target.value) { toggleOfferTarget(o.id, e.target.value); e.target.value = ""; } }} defaultValue=""
                      className="w-full border rounded px-2 py-1.5 text-xs mb-2" style={{ borderColor: "#DDD6C4" }}>
                      <option value="">Choisir une entreprise...</option>
                      {companies.filter((c) => !targets.some((t) => t.company_id === c.id)).map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    <div className="text-xs mb-1" style={{ color: "#A39C87" }}>Ou ajouter un prospect à cette offre</div>
                    <select onChange={(e) => { if (e.target.value) { addProspectAsTarget(o.id, e.target.value); e.target.value = ""; } }} defaultValue=""
                      className="w-full border rounded px-2 py-1.5 text-xs" style={{ borderColor: "#DDD6C4" }}>
                      <option value="">Choisir un prospect...</option>
                      {prospects.filter((p) => !targets.some((t) => t.prospect_id === p.id)).map((p) => (
                        <option key={p.id} value={p.id}>{p.name ? `${p.name} — ` : ""}{p.email}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : tab === "statistiques" ? (() => {
        const total = companies.length;
        const active = companies.filter((c) => c.plan_status === "active").length;
        const trial = companies.filter((c) => c.plan_status === "trial").length;
        const suspended = companies.filter((c) => c.plan_status === "suspended").length;
        const assisted = companies.filter((c) => c.plan_tier === "assisted").length;
        const standard = total - assisted;
        // Estimation en USD, à titre indicatif seulement (les vrais tarifs varient
        // par pays/devise) : Standard ≈ 20 USD/mois, Assisté ≈ 80 USD/mois.
        const mrrEstimate = companies.filter((c) => c.plan_status === "active").reduce((s, c) => s + (c.plan_tier === "assisted" ? 80 : 20), 0);
        const now = new Date();
        const monthLabels = [];
        for (let i = 5; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          monthLabels.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleDateString("fr-FR", { month: "short" }) });
        }
        const newPerMonth = monthLabels.map((m) => ({
          ...m,
          count: companies.filter((c) => {
            const firstMember = membersFor(c.id)[0];
            return firstMember && firstMember.created_at && firstMember.created_at.startsWith(m.key);
          }).length,
        }));
        const revenuePerMonth = monthLabels.map((m) => ({
          ...m,
          montant: payments.filter((p) => p.date && p.date.startsWith(m.key)).reduce((s, p) => s + (Number(p.amount) || 0), 0),
        }));
        const statusBreakdown = [
          { name: "Payant", value: active },
          { name: "Essai", value: trial },
          { name: "Suspendu", value: suspended },
        ].filter((d) => d.value > 0);
        const tierBreakdown = [
          { name: "Standard", value: standard },
          { name: "Assisté", value: assisted },
        ].filter((d) => d.value > 0);
        const trialCompanies = companies.filter((c) => c.plan_status === "trial");
        const trialWithActivity = activity ? trialCompanies.filter((c) => {
          const a = activity[c.id];
          return a && (a.invoices_count + a.entries_count + a.products_count + a.clients_count + a.purchases_count) > 0;
        }).length : null;
        const activityByCollab = {};
        activityLog.forEach((a) => { activityByCollab[a.actor_email] = (activityByCollab[a.actor_email] || 0) + 1; });
        const topCollabs = Object.entries(activityByCollab).sort((a, b) => b[1] - a[1]).slice(0, 5);

        return (
          <div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="rounded-lg p-3 text-center" style={{ background: "#FAF8F1" }}>
                <div className="text-xl tabular font-semibold" style={{ color: "#152238" }}>{total}</div>
                <div className="text-xs" style={{ color: "#7A7460" }}>Entreprises au total</div>
              </div>
              <div className="rounded-lg p-3 text-center" style={{ background: "#E6F1EE" }}>
                <div className="text-xl tabular font-semibold" style={{ color: "#0F6B5C" }}>{active}</div>
                <div className="text-xs" style={{ color: "#5C6B4A" }}>Payantes</div>
              </div>
              <div className="rounded-lg p-3 text-center" style={{ background: "#FBF1DC" }}>
                <div className="text-xl tabular font-semibold" style={{ color: "#9A7B1E" }}>{trial}</div>
                <div className="text-xs" style={{ color: "#7A7460" }}>En essai</div>
              </div>
              <div className="rounded-lg p-3 text-center" style={{ background: "#F7E9E3" }}>
                <div className="text-xl tabular font-semibold" style={{ color: "#A6432F" }}>{suspended}</div>
                <div className="text-xs" style={{ color: "#7A7460" }}>Suspendues</div>
              </div>
            </div>

            <div className="bg-white rounded-lg p-4 mb-4" style={{ border: "1px solid #E4DFD1" }}>
              <div className="text-xs mb-2" style={{ color: "#A39C87" }}>Revenu mensuel estimé (approximatif, USD)</div>
              <div className="text-2xl tabular font-semibold" style={{ color: "#0F6B5C" }}>${mrrEstimate}</div>
              <div className="text-xs mt-1" style={{ color: "#A39C87" }}>{standard} Standard (~20$) · {assisted} Assisté (~80$) — tarif réel variable selon pays/devise</div>
            </div>

            {trialWithActivity !== null && trialCompanies.length > 0 && (
              <div className="bg-white rounded-lg p-4 mb-4" style={{ border: "1px solid #E4DFD1" }}>
                <div className="text-xs mb-2" style={{ color: "#A39C87" }}>Essais gratuits réellement exploités</div>
                <div className="text-2xl tabular font-semibold" style={{ color: "#152238" }}>{trialWithActivity} / {trialCompanies.length}</div>
                <div className="text-xs mt-1" style={{ color: "#A39C87" }}>
                  Entreprises en essai ayant saisi au moins une facture, écriture, produit, client ou achat — un indicateur plus fiable du potentiel de conversion que le simple nombre d'inscriptions.
                </div>
              </div>
            )}

            <div className="bg-white rounded-lg p-4 mb-4" style={{ border: "1px solid #E4DFD1" }}>
              <div className="text-xs mb-3" style={{ color: "#A39C87" }}>Nouvelles entreprises par mois</div>
              <div className="flex items-end gap-3" style={{ height: 100 }}>
                {newPerMonth.map((m) => {
                  const maxNew = Math.max(1, ...newPerMonth.map((x) => x.count));
                  return (
                    <div key={m.key} className="flex flex-col items-center justify-end flex-1">
                      <div style={{ width: "100%", maxWidth: 28, height: `${Math.max(4, (m.count / maxNew) * 70)}px`, background: "#5B3FA0", borderRadius: "3px 3px 0 0" }}></div>
                      <div className="text-xs mt-1" style={{ color: "#A39C87" }}>{m.label}</div>
                      <div className="text-xs tabular" style={{ color: "#152238" }}>{m.count}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="bg-white rounded-lg p-4 mb-4" style={{ border: "1px solid #E4DFD1" }}>
              <div className="text-xs mb-2" style={{ color: "#A39C87" }}>Revenu encaissé par mois (HTG/MXN confondus, paiements réels)</div>
              <SimpleGroupedBarChart data={revenuePerMonth} xKey="label" series={[{ key: "montant", name: "Revenu encaissé", color: "#0F6B5C" }]} />
            </div>

            <div className="grid gap-4 mb-4">
              {statusBreakdown.length > 0 && (
                <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}>
                  <div className="text-xs mb-3" style={{ color: "#A39C87" }}>Répartition par statut</div>
                  {statusBreakdown.map((d, i) => {
                    const pct = Math.round((d.value / total) * 100);
                    const color = ["#0F6B5C", "#9A7B1E", "#A6432F"][i % 3];
                    return (
                      <div key={d.name} className="mb-2 last:mb-0">
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span style={{ color: "#152238" }}>{d.name}</span>
                          <span className="tabular" style={{ color: "#7A7460" }}>{d.value} ({pct}%)</span>
                        </div>
                        <div style={{ background: "#F3EFE3", borderRadius: 4, height: 6 }}>
                          <div style={{ width: `${pct}%`, background: color, height: 6, borderRadius: 4 }}></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {tierBreakdown.length > 0 && (
                <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}>
                  <div className="text-xs mb-3" style={{ color: "#A39C87" }}>Répartition par forfait</div>
                  {tierBreakdown.map((d, i) => {
                    const pct = Math.round((d.value / total) * 100);
                    const color = ["#3F4F73", "#C9A24B"][i % 2];
                    return (
                      <div key={d.name} className="mb-2 last:mb-0">
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span style={{ color: "#152238" }}>{d.name}</span>
                          <span className="tabular" style={{ color: "#7A7460" }}>{d.value} ({pct}%)</span>
                        </div>
                        <div style={{ background: "#F3EFE3", borderRadius: 4, height: 6 }}>
                          <div style={{ width: `${pct}%`, background: color, height: 6, borderRadius: 4 }}></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}>
              <div className="text-xs mb-3" style={{ color: "#A39C87" }}>Collaborateurs les plus actifs</div>
              {topCollabs.length === 0 ? (
                <div className="text-xs" style={{ color: "#A39C87" }}>Aucune activité enregistrée pour le moment.</div>
              ) : topCollabs.map(([email, count]) => (
                <div key={email} className="flex items-center justify-between text-sm py-1">
                  <span style={{ color: "#152238" }}>{email}</span>
                  <span className="tabular" style={{ color: "#0F6B5C" }}>{count}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })() : tab === "cabinets" ? (
        <div className="space-y-4">
          <CabinetRequestsPanel currentUserEmail={currentUserEmail} logActivity={logActivity} />
          <CabinetBillingPanel />
        </div>
      ) : tab === "supervision" ? (
        <SupervisionPanel companies={companies} activity={activity} payments={payments} />
      ) : tab === "aide" ? (
        <SupportInbox companies={companies} currentUserEmail={currentUserEmail} logActivity={logActivity} onUnreadChange={refreshInboxUnread} />
      ) : tab === "collaborateurs" ? (
        <div>
          <div className="bg-white rounded-lg p-6 mb-4" style={{ border: "1px solid #E4DFD1" }}>
            <div className="text-sm font-medium mb-4" style={{ color: "#152238" }}>Collaborateurs du Centre de gestion</div>
            <div className="space-y-2 mb-4">
              {collaborators.length === 0 ? (
                <div className="text-xs" style={{ color: "#A39C87" }}>Aucun collaborateur ajouté pour le moment — vous seul y avez accès en tant qu'administrateur de plateforme.</div>
              ) : collaborators.map((c) => {
                const cPerms = c.permissions || { entreprises: true, offres: true, statistiques: true, collaborateurs: false };
                return (
                <div key={c.id} className="p-2 rounded" style={{ border: "1px solid #F0EDE3" }}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <div className="text-sm truncate" style={{ color: "#152238" }}>{c.email}</div>
                      <div className="text-xs" style={{ color: "#A39C87" }}>{roleLabel(c.role)}</div>
                    </div>
                    <div className="flex gap-2 shrink-0 flex-wrap">
                      <button onClick={() => setHistoryForCollab(c.email)} className="text-xs underline" style={{ color: "#152238" }}>Historique</button>
                      <button onClick={() => removeCollaborator(c.id, c.email)} className="text-xs underline" style={{ color: "#A6432F" }}>Retirer</button>
                    </div>
                  </div>
                  {isPlatformAdmin && (
                    <div className="flex flex-wrap gap-3 mt-2 pt-2" style={{ borderTop: "1px solid #F3EFE3" }}>
                      {[["entreprises", "Entreprises"], ["offres", "Offres"], ["statistiques", "Statistiques"], ["supervision", "Supervision"], ["aide", "Centre d'aide"], ["collaborateurs", "Collaborateurs"]].map(([key, label]) => (
                        <label key={key} className="flex items-center gap-1.5 text-xs" style={{ color: "#7A7460" }}>
                          <input type="checkbox" checked={key === "aide" ? cPerms.aide !== false : !!cPerms[key]} onChange={(e) => updatePermission(c.id, key, e.target.checked)} />
                          {label}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                );
              })}
            </div>
            <div className="flex gap-2 flex-wrap p-3 rounded" style={{ background: "#FAF8F1" }}>
              <input value={newCollabEmail} onChange={(e) => setNewCollabEmail(e.target.value)} placeholder="email@exemple.com"
                className="flex-1 border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4", minWidth: 180 }} />
              <select value={newCollabRole} onChange={(e) => setNewCollabRole(e.target.value)} className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }}>
                <option value="gestionnaire">Gestionnaire</option>
                <option value="support">Support</option>
              </select>
              <button onClick={inviteCollaborator} className="text-xs px-3 py-1.5 rounded text-white shrink-0" style={{ background: "#152238" }}>Ajouter</button>
            </div>
          </div>

          {historyForCollab && (() => {
            const entries = activityLog.filter((a) => a.actor_email === historyForCollab);
            return (
              <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
                <div className="flex items-center justify-between mb-4">
                  <div className="text-sm font-medium" style={{ color: "#152238" }}>Historique — {historyForCollab}</div>
                  <button onClick={() => setHistoryForCollab(null)} style={{ color: "#8A8370" }}><X size={16} /></button>
                </div>
                {entries.length === 0 ? (
                  <div className="text-xs py-4 text-center" style={{ color: "#A39C87" }}>Aucune intervention enregistrée pour ce collaborateur.</div>
                ) : (
                  <div style={{ background: "#fff", borderRadius: 8, overflow: "hidden", border: "1px solid #F0EDE3" }}>
                    <div className="overflow-x-auto"><table className="w-full text-sm">
                      <thead>
                        <tr style={{ background: "#F3EFE3" }}>
                          <th className="py-2 px-3 text-left font-medium" style={{ color: "#7A7460", fontSize: 11, textTransform: "uppercase" }}>Date</th>
                          <th className="py-2 px-3 text-left font-medium" style={{ color: "#7A7460", fontSize: 11, textTransform: "uppercase" }}>Heure</th>
                          <th className="py-2 px-3 text-left font-medium" style={{ color: "#7A7460", fontSize: 11, textTransform: "uppercase" }}>Intervention</th>
                          <th className="py-2 px-3 text-left font-medium" style={{ color: "#7A7460", fontSize: 11, textTransform: "uppercase" }}>Détail</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entries.map((a) => {
                          const d = new Date(a.created_at);
                          return (
                            <tr key={a.id} style={{ borderTop: "1px solid #F3EFE3" }}>
                              <td className="py-1.5 px-3 tabular" style={{ color: "#152238" }}>{d.toLocaleDateString("fr-FR")}</td>
                              <td className="py-1.5 px-3 tabular" style={{ color: "#152238" }}>{d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</td>
                              <td className="py-1.5 px-3" style={{ color: "#152238" }}>{ACTION_LABELS[a.action_type] || a.action_type}</td>
                              <td className="py-1.5 px-3" style={{ color: "#7A7460" }}>{a.target_description || "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table></div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      ) : null}
    </div>
  );
}


