// ═══ MODULE ═══
// @module Equipe messagerie procedures
// @depends X, friendlyError, supabase, useEffect, useMemo, useState
// @exports ProceduresPanel, TeamMessagingPanel, useTeamUnread
// ═══ FIN DE L'EN-TÊTE ═══
// Espace de travail commun de l'équipe de la plateforme (Super Admin + collaborateurs du Centre de gestion) :
//  • Messagerie interne : fils de discussion (signalement, consigne, question) entre collaborateurs et administrateur de la plateforme,
//    avec lu / non lu, priorité, destinataire facultatif et clôture. Les messages ne se modifient ni ne se suppriment (traçabilité).
//  • Procédures : récupération de l'accès 2FA, contrôles avant clôture d'une période, réouverture exceptionnelle. Chaque procédure se lit
//    puis s'exécute sur une « fiche » (registre) : étapes cochées avec qui / quand, délai d'attente imposé, résultat.
// Les tables sont team_threads, team_messages, team_thread_reads et procedure_runs (script SQL v320).

const TM_KINDS = { signalement: "Signalement", consigne: "Consigne", question: "Question" };
const TM_ADMIN = "__admin__";

function tmFmt(d) { try { return new Date(d).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } }

// Un fil est « non lu » pour moi si le dernier message n'est pas de moi et qu'il est plus récent que ma dernière lecture.
function teamUnreadCount(threads, reads, me) {
  const mine = String(me || "").toLowerCase();
  const rd = {};
  (reads || []).forEach((r) => { if (String(r.user_email || "").toLowerCase() === mine) rd[r.thread_id] = r.last_read_at; });
  return (threads || []).filter((t) => {
    if (t.status === "clos") return false;
    if (String(t.last_message_by || t.created_by_email || "").toLowerCase() === mine) return false;
    const seen = rd[t.id];
    return !seen || new Date(t.updated_at || t.created_at).getTime() > new Date(seen).getTime();
  }).length;
}

function useTeamUnread(enabled, email) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!enabled || !email) return undefined;
    let stop = false;
    const load = async () => {
      try {
        const a = await supabase.from("team_threads").select("id, status, updated_at, created_at, last_message_by, created_by_email");
        const b = await supabase.from("team_thread_reads").select("thread_id, user_email, last_read_at");
        if (!stop && !a.error && !b.error) setN(teamUnreadCount(a.data || [], b.data || [], email));
      } catch (e) {}
    };
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 45000);
    const h = () => load();
    window.addEventListener("compta-plus-team-read", h);
    return () => { stop = true; clearInterval(t); window.removeEventListener("compta-plus-team-read", h); };
  }, [enabled, email]);
  return n;
}

function TeamMessagingPanel({ showToast, currentUserEmail, isPlatformAdmin }) {
  const me = String(currentUserEmail || "").toLowerCase();
  const [threads, setThreads] = useState(null);
  const [reads, setReads] = useState([]);
  const [team, setTeam] = useState([]);
  const [filter, setFilter] = useState("ouverts");
  const [openId, setOpenId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [reply, setReply] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [nf, setNf] = useState({ subject: "", kind: "signalement", priority: "normale", assigned: "", body: "" });
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);

  const load = async () => {
    const a = await supabase.from("team_threads").select("*");
    if (a.error) { if (/does not exist|42P01/.test((a.error.message || "") + (a.error.code || ""))) setMissing(true); else showToast(friendlyError(a.error)); setThreads([]); return; }
    const b = await supabase.from("team_thread_reads").select("*");
    setThreads(a.data || []);
    setReads(b.data || []);
  };
  useEffect(() => {
    load();
    (async () => { const { data } = await supabase.from("management_collaborators").select("email, role"); setTeam(data || []); })();
    const t = setInterval(() => { if (!document.hidden) load(); }, 30000);
    return () => clearInterval(t);
  }, []);

  const loadMessages = async (id) => {
    const { data, error } = await supabase.from("team_messages").select("*").eq("thread_id", id);
    if (error) { showToast(friendlyError(error)); return; }
    setMessages((data || []).slice().sort((x, y) => new Date(x.created_at) - new Date(y.created_at)));
  };
  const markRead = async (id) => {
    const row = { thread_id: id, user_email: me, last_read_at: new Date().toISOString() };
    await supabase.from("team_thread_reads").upsert(row, { onConflict: "thread_id,user_email" });
    setReads((prev) => prev.filter((r) => !(r.thread_id === id && String(r.user_email).toLowerCase() === me)).concat([row]));
    try { window.dispatchEvent(new Event("compta-plus-team-read")); } catch (e) {}
  };
  const openThread = async (id) => { setOpenId(id); setReply(""); await loadMessages(id); await markRead(id); };

  const labelFor = (e) => (e === TM_ADMIN ? "Administrateur de la plateforme" : e ? e : "Toute l'équipe");
  const forMe = (t) => t.status !== "clos" && (t.assigned_email === TM_ADMIN ? !!isPlatformAdmin : String(t.assigned_email || "").toLowerCase() === me);

  const createThread = async () => {
    const subject = nf.subject.trim(), body = nf.body.trim();
    if (!subject) { showToast("Indiquez un sujet."); return; }
    if (!body) { showToast("Écrivez le message."); return; }
    setBusy(true);
    const now = new Date().toISOString();
    const row = { id: crypto.randomUUID(), subject, kind: nf.kind, priority: nf.priority, status: "ouvert", assigned_email: nf.assigned || null, created_by_email: me, created_at: now, updated_at: now, last_message_by: me };
    const ins = await supabase.from("team_threads").insert(row);
    if (ins.error) { setBusy(false); showToast(friendlyError(ins.error)); return; }
    const m = await supabase.from("team_messages").insert({ id: crypto.randomUUID(), thread_id: row.id, author_email: me, body, created_at: now });
    setBusy(false);
    if (m.error) { showToast(friendlyError(m.error)); return; }
    setShowNew(false); setNf({ subject: "", kind: "signalement", priority: "normale", assigned: "", body: "" });
    showToast("Fil créé.");
    await load(); await openThread(row.id);
  };

  const sendReply = async () => {
    const body = reply.trim();
    if (!body || !openId) return;
    setBusy(true);
    const now = new Date().toISOString();
    const m = await supabase.from("team_messages").insert({ id: crypto.randomUUID(), thread_id: openId, author_email: me, body, created_at: now });
    if (m.error) { setBusy(false); showToast(friendlyError(m.error)); return; }
    await supabase.from("team_threads").update({ updated_at: now, last_message_by: me }).eq("id", openId);
    setBusy(false); setReply("");
    await loadMessages(openId); await load(); await markRead(openId);
  };

  const setStatus = async (status) => {
    const patch = status === "clos" ? { status, closed_at: new Date().toISOString(), closed_by_email: me } : { status, closed_at: null, closed_by_email: null };
    const { error } = await supabase.from("team_threads").update(patch).eq("id", openId);
    if (error) { showToast(friendlyError(error)); return; }
    showToast(status === "clos" ? "Fil clos." : "Fil rouvert.");
    await load();
  };

  const rows = useMemo(() => {
    const rd = {};
    reads.forEach((r) => { if (String(r.user_email || "").toLowerCase() === me) rd[r.thread_id] = r.last_read_at; });
    const list = (threads || []).filter((t) => filter === "tous" ? true : filter === "clos" ? t.status === "clos" : t.status !== "clos");
    return list.slice().sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at)).map((t) => ({
      t, unread: teamUnreadCount([t], reads, me) > 0,
    }));
  }, [threads, reads, filter, me]);

  if (missing) return (
    <div className="bg-white rounded-lg p-6 text-sm" style={{ border: "1px solid #E4DFD1", color: "#7A7460" }} data-testid="tm-missing">
      La messagerie interne n'est pas encore activée : le script SQL « v320 » doit d'abord être exécuté dans Supabase.
    </div>
  );
  const open = (threads || []).find((t) => t.id === openId);

  return (
    <div data-testid="tm-panel">
      <div className="bg-white rounded-lg p-4 md:p-6 mb-4" style={{ border: "1px solid #E4DFD1" }}>
        <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
          <div>
            <div className="text-sm font-medium" style={{ color: "#152238" }}>Messagerie interne de l'équipe</div>
            <div className="text-xs" style={{ color: "#8A8370" }}>Signaler un point, donner une consigne ou poser une question à l'équipe, sans passer par un canal extérieur. Les messages restent consignés et ne se modifient pas.</div>
          </div>
          <button data-testid="tm-nouveau" onClick={() => setShowNew((v) => !v)} className="text-xs px-3 py-1.5 rounded text-white" style={{ background: "#152238" }}>{showNew ? "Fermer" : "Nouveau fil"}</button>
        </div>
        {showNew && (
          <div className="p-3 rounded mb-3 space-y-2" style={{ background: "#FAF8F1" }} data-testid="tm-form">
            <input data-testid="tm-sujet" value={nf.subject} maxLength={200} onChange={(e) => setNf({ ...nf, subject: e.target.value })} placeholder="Sujet (ex. : Client X ne reçoit pas son lien d'invitation)"
              className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }} />
            <div className="flex gap-2 flex-wrap">
              <select data-testid="tm-type" value={nf.kind} onChange={(e) => setNf({ ...nf, kind: e.target.value })} className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }}>
                {Object.entries(TM_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <select data-testid="tm-priorite" value={nf.priority} onChange={(e) => setNf({ ...nf, priority: e.target.value })} className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }}>
                <option value="normale">Priorité normale</option>
                <option value="haute">Priorité haute</option>
              </select>
              <select data-testid="tm-dest" value={nf.assigned} onChange={(e) => setNf({ ...nf, assigned: e.target.value })} className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }}>
                <option value="">À toute l'équipe</option>
                <option value={TM_ADMIN}>À l'administrateur de la plateforme</option>
                {team.filter((c) => String(c.email).toLowerCase() !== me).map((c) => <option key={c.email} value={c.email}>À {c.email}</option>)}
              </select>
            </div>
            <textarea data-testid="tm-corps" value={nf.body} maxLength={4000} rows={4} onChange={(e) => setNf({ ...nf, body: e.target.value })} placeholder="Votre message…"
              className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }} />
            <div className="text-xs" style={{ color: "#A6432F" }}>N'écrivez jamais de mot de passe, de code de secours ni de pièce d'identité dans un message.</div>
            <button data-testid="tm-creer" disabled={busy} onClick={createThread} className="text-xs px-3 py-1.5 rounded text-white" style={{ background: "#0F6B5C" }}>Envoyer</button>
          </div>
        )}
        <div className="flex gap-2 mb-3 flex-wrap">
          {[["ouverts", "Ouverts"], ["clos", "Clos"], ["tous", "Tous"]].map(([k, l]) => (
            <button key={k} data-testid={"tm-filtre-" + k} onClick={() => setFilter(k)} className="px-3 py-1 text-xs rounded-full"
              style={{ background: filter === k ? "#152238" : "transparent", color: filter === k ? "#fff" : "#152238", border: "1px solid #152238" }}>{l}</button>
          ))}
        </div>
        {threads === null ? <div className="text-xs" style={{ color: "#A39C87" }}>Chargement…</div> : rows.length === 0 ? (
          <div className="text-xs py-4 text-center" style={{ color: "#A39C87" }} data-testid="tm-vide">Aucun fil dans cette vue.</div>
        ) : (
          <div className="space-y-1" data-testid="tm-liste">
            {rows.map(({ t, unread }) => (
              <button key={t.id} data-testid="tm-fil" onClick={() => openThread(t.id)} className="w-full text-left p-2 rounded flex items-start gap-2"
                style={{ border: "1px solid " + (openId === t.id ? "#152238" : "#F0EDE3"), background: unread ? "#FBF7EA" : "#fff" }}>
                <span style={{ width: 8, height: 8, borderRadius: 4, marginTop: 6, background: unread ? "#C9A24B" : "transparent", flexShrink: 0 }} data-testid={unread ? "tm-nonlu" : undefined} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm truncate" style={{ color: "#152238", fontWeight: unread ? 600 : 400 }}>{t.subject}</span>
                  <span className="block text-xs" style={{ color: "#8A8370" }}>
                    {TM_KINDS[t.kind] || t.kind} · de {t.created_by_email} · pour {labelFor(t.assigned_email)} · {tmFmt(t.updated_at || t.created_at)}
                  </span>
                </span>
                {t.priority === "haute" && t.status !== "clos" && <span className="text-xs px-2 py-0.5 rounded shrink-0" style={{ background: "#F7E9E3", color: "#A6432F" }}>Haute</span>}
                {forMe(t) && <span className="text-xs px-2 py-0.5 rounded shrink-0" style={{ background: "#E8EAF0", color: "#152238" }} data-testid="tm-pourmoi">À mon attention</span>}
                {t.status === "clos" && <span className="text-xs px-2 py-0.5 rounded shrink-0" style={{ background: "#F3EFE3", color: "#7A7460" }}>Clos</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {open && (
        <div className="bg-white rounded-lg p-4 md:p-6" style={{ border: "1px solid #E4DFD1" }} data-testid="tm-detail">
          <div className="flex items-start justify-between gap-2 flex-wrap mb-3">
            <div className="min-w-0">
              <div className="text-sm font-medium" style={{ color: "#152238" }}>{open.subject}</div>
              <div className="text-xs" style={{ color: "#8A8370" }}>{TM_KINDS[open.kind]} · pour {labelFor(open.assigned_email)}{open.status === "clos" ? ` · clos par ${open.closed_by_email || "?"}` : ""}</div>
            </div>
            <div className="flex gap-2 shrink-0">
              {open.status === "clos"
                ? <button data-testid="tm-rouvrir" onClick={() => setStatus("ouvert")} className="text-xs underline" style={{ color: "#152238" }}>Rouvrir</button>
                : <button data-testid="tm-clore" onClick={() => setStatus("clos")} className="text-xs underline" style={{ color: "#0F6B5C" }}>Marquer comme traité (clore)</button>}
              <button onClick={() => setOpenId(null)} className="text-xs underline" style={{ color: "#8A8370" }}>Fermer</button>
            </div>
          </div>
          <div className="space-y-2 mb-3" data-testid="tm-messages">
            {messages.map((m) => {
              const mine = String(m.author_email).toLowerCase() === me;
              return (
                <div key={m.id} data-testid="tm-message" className="p-2 rounded text-sm" style={{ background: mine ? "#EEF4E2" : "#F7F4EA", color: "#152238", marginLeft: mine ? 24 : 0, marginRight: mine ? 0 : 24 }}>
                  <div className="text-xs mb-1" style={{ color: "#8A8370" }}>{mine ? "Vous" : m.author_email} · {tmFmt(m.created_at)}</div>
                  <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.body}</div>
                </div>
              );
            })}
          </div>
          {open.status !== "clos" && (
            <div className="flex gap-2 items-end">
              <textarea data-testid="tm-reponse" value={reply} rows={2} maxLength={4000} onChange={(e) => setReply(e.target.value)} placeholder="Répondre…"
                className="flex-1 border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }} />
              <button data-testid="tm-envoyer" disabled={busy || !reply.trim()} onClick={sendReply} className="text-xs px-3 py-2 rounded text-white shrink-0" style={{ background: "#152238", opacity: reply.trim() ? 1 : 0.5 }}>Envoyer</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── Procédures ─────────────────────────

const PR_2FA_ALERTS = [
  ["urgence", "Urgence, pression ou menace de résiliation"],
  ["autre_email", "Demande venant d'une autre adresse e-mail que celle du compte, ou adresse récemment modifiée"],
  ["chg_email", "Demande de changer l'adresse e-mail en même temps que le 2FA"],
  ["tiers", "Personne qui se présente comme proche, employé ou comptable du titulaire"],
  ["hesitant", "Réponses hésitantes ou approximatives aux questions de vérification"],
  ["serie", "Plusieurs demandes pour des comptes différents venant de la même source"],
];

const PR_DEFS = {
  "2fa": {
    title: "Récupération de l'accès 2FA (téléphone et codes de secours perdus)",
    short: "Une seule règle pour tous : demande écrite, deux preuves, délai de 24 heures avec alerte, tout est consigné.",
    intro: [
      "Le code d'authentification (2FA) protège les données comptables d'un client. Une réinitialisation faite trop vite ou sur la foi d'un simple appel annule cette protection : cette procédure la rend lente, vérifiable et tracée.",
      "Le client a perdu son téléphone mais possède ses codes de secours : aucune intervention de l'équipe, il se connecte avec un code de secours et reconfigure son 2FA.",
      "Le client est administrateur d'une entreprise qui a d'autres utilisateurs : l'autre administrateur peut d'abord réinitialiser lui-même ; sinon cette procédure s'applique.",
      "Compte du Super Admin (éditeur) : jamais réinitialisé par e-mail. Les codes de secours se gardent en deux exemplaires papier dans deux lieux sûrs distincts ; s'ils sont tous perdus, la récupération passe par les voies officielles de l'hébergeur (Supabase), avec justificatifs du titulaire du projet.",
    ],
    rules: ["Aucune exception, ni pour un client pressé, ni pour un client important, ni pour une connaissance.", "Demande écrite uniquement, depuis l'adresse e-mail du compte : jamais par téléphone, message vocal ou réseau social.", "Deux preuves que seul le titulaire connaît. Une seule erreur : refus, nouvelle tentative possible après 48 heures.", "Délai d'attente de 24 heures (72 heures si un signal d'alerte est coché), avec alerte envoyée à l'adresse du compte.", "En cas de doute, on refuse et on demande plus de preuves : un client retardé vaut mieux qu'un compte volé."],
    forbidden: ["Réinitialiser sur simple appel, message vocal ou message d'un réseau social.", "Donner par téléphone ou par message une information du compte (même « juste le nom d'un client »).", "Accepter une pièce d'identité comme preuve : elle ne prouve pas la propriété du compte et crée un risque de fuite de données personnelles.", "Raccourcir le délai parce que le client est pressé.", "Réinitialiser sans fiche au registre.", "Envoyer un mot de passe dans un message."],
    steps: [
      ["s1", "Demande écrite reçue par e-mail depuis l'adresse du compte", "Une demande reçue par un autre canal est refusée : on répond « écrivez-nous depuis l'adresse de votre compte »."],
      ["s2", "Fiche ouverte au registre", "Date, heure, canal et adresse d'origine : renseignés à l'ouverture de cette fiche."],
      ["s3", "Deux preuves vérifiées (réponses exactes)", "Par exemple : numéro de la dernière facture émise, montant approximatif de la dernière vente, nom d'un client enregistré, date de création du compte, moyen et date du dernier paiement d'abonnement."],
      ["s4", "Alerte envoyée à l'adresse du compte", "Utilisez le bouton « Alerte envoyée » ci-dessous : il démarre le délai d'attente."],
      ["s5", "Délai d'attente écoulé sans réponse STOP", "Coché automatiquement à la fin du délai. Si le client répond STOP : tentative suspecte (voir plus bas)."],
      ["s6", "Second validateur : relecture et confirmation écrite", "Obligatoire pour les comptes à forts enjeux (entreprise avec plusieurs utilisateurs ou données de paie)."],
      ["s7", "Ancien facteur 2FA supprimé dans l'administration", "Aucun mot de passe temporaire n'est envoyé : le titulaire utilise son mot de passe habituel ou « mot de passe oublié »."],
      ["s8", "Client informé par e-mail et fiche close", "Rappeler de conserver les nouveaux codes de secours sur papier, hors du téléphone."],
    ],
    templates: [
      ["Réponse à une demande reçue par téléphone ou réseau social", "Pour la sécurité de vos données, toute demande de réinitialisation de la double authentification doit nous parvenir par e-mail depuis l'adresse de votre compte. Nous ne pouvons pas la traiter par téléphone ni par message."],
      ["Alerte à envoyer à l'étape 4", "Objet : Demande de réinitialisation de votre double authentification Compta+\n\nUne réinitialisation de la double authentification de votre compte a été demandée. Elle sera effectuée dans 24 heures. Si vous n'êtes pas à l'origine de cette demande, répondez STOP immédiatement à ce message."],
      ["Confirmation à envoyer à l'étape 8", "Votre double authentification a été réinitialisée. Reconfigurez-la à votre prochaine connexion et conservez vos nouveaux codes de secours sur papier, hors de votre téléphone."],
    ],
  },
  cloture: {
    title: "Clôture d'une période comptable : contrôles avant clôture",
    short: "Une période clôturée est figée. Aucune clôture tant que la liste n'est pas entièrement cochée.",
    intro: [
      "Principes : intangibilité (une écriture d'une période clôturée ne se modifie ni ne se supprime), traçabilité (qui, quand, pourquoi), indépendance des exercices, séparation des tâches (celui qui saisit n'est pas, quand c'est possible, celui qui clôture), pièce justificative pour chaque écriture.",
      "Calendrier recommandé : mensuelle au plus tard le 10 du mois suivant (responsable comptable ou gestionnaire) ; trimestrielle au plus tard 15 jours après la fin du trimestre ; annuelle dans les 3 mois après la fin de l'exercice, ou avant la date légale si elle est plus courte (dirigeant et expert-comptable). Les échéances fiscales officielles priment toujours.",
      "Effets : plus aucune vente, dépense, encaissement, opération de caisse ou écriture ne peut être créée, modifiée ou annulée avec une date égale ou antérieure à la date de clôture ; les rapports de la période ne changent plus ; un point de restauration est créé automatiquement juste avant la clôture annuelle.",
      "Correction après clôture : on ne rouvre pas. On passe une écriture de correction (annulation par écriture inverse, puis écriture correcte) datée du jour, avec la référence de l'écriture corrigée dans le libellé et la pièce justificative conservée.",
    ],
    rules: [], forbidden: [],
    steps: [
      ["c1", "Toutes les ventes, achats, dépenses et encaissements de la période sont saisis, avec pièce justificative", ""],
      ["c2", "La caisse est comptée et l'écart est justifié ou comptabilisé", ""],
      ["c3", "Les comptes de banque et de mobile money sont rapprochés des relevés", ""],
      ["c4", "Les comptes clients et fournisseurs sont revus ; les impayés douteux sont identifiés", ""],
      ["c5", "Les stocks sont comptés (inventaire physique) et valorisés ; les différences sont comptabilisées", ""],
      ["c6", "Les salaires, retenues et charges sociales de la période sont enregistrés", ""],
      ["c7", "Les amortissements, charges à payer et produits à recevoir de la période sont constatés", ""],
      ["c8", "La balance est équilibrée (total débits = total crédits)", ""],
      ["c9", "Les déclarations de la période (TCA, retenues) sont préparées", ""],
      ["c10", "Une sauvegarde (export complet) est faite avant la clôture", ""],
      ["c11", "La personne qui clôture est identifiée, et la date est notée", ""],
    ],
    templates: [],
  },
  reouverture: {
    title: "Réouverture exceptionnelle d'un exercice clôturé",
    short: "Seulement si la correction ne peut pas se faire dans la période ouverte. Conditions cumulatives, motif obligatoire.",
    intro: [
      "Voie normale : on ne rouvre pas, on corrige dans la période ouverte. La réouverture n'est admise que si la correction est impossible autrement, par exemple une déclaration fiscale déjà déposée à rectifier ou une erreur matérielle découverte lors d'un contrôle.",
      "Le journal d'audit conserve la trace de toute réouverture.",
    ],
    rules: [], forbidden: [],
    steps: [
      ["r1", "La correction est impossible dans la période ouverte (voie normale écartée)", ""],
      ["r2", "Réouverture limitée au dernier exercice clôturé, jamais plus loin", ""],
      ["r3", "Décision écrite du dirigeant, idéalement après avis de l'expert-comptable", ""],
      ["r4", "Motif enregistré avec le nom de la personne et la date (champ « Motif » ci-dessous)", ""],
      ["r5", "Point de restauration créé avant la réouverture", ""],
      ["r6", "Corrections limitées à ce qui a été justifié ; nouvelle clôture prévue dans les 7 jours", ""],
      ["r7", "Si des déclarations ont été déposées sur les chiffres initiaux : déclaration rectificative à faire avec l'expert-comptable", ""],
    ],
    templates: [],
  },
};

const PR_STATUS = { en_cours: ["En cours", "#9A7B1E", "#FBF1DC"], termine: ["Terminée", "#0F6B5C", "#E6F1EE"], refuse: ["Refusée", "#A6432F", "#F7E9E3"], suspect: ["Tentative suspecte", "#A6432F", "#F7E9E3"] };

function prWaitHours(run) { return ((run.data && run.data.alerts) || []).length > 0 ? 72 : 24; }
function prReadyAt(run) { const a = run.data && run.data.alert_sent_at; return a ? new Date(a).getTime() + prWaitHours(run) * 3600000 : null; }
function prRemaining(run, now) { const r = prReadyAt(run); return r === null ? null : Math.max(0, r - now); }
function prFmtDuration(ms) { const m = Math.ceil(ms / 60000); const h = Math.floor(m / 60); return h > 0 ? `${h} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`; }

function ProceduresPanel({ showToast, currentUserEmail }) {
  const me = String(currentUserEmail || "").toLowerCase();
  const [runs, setRuns] = useState(null);
  const [missing, setMissing] = useState(false);
  const [readKey, setReadKey] = useState(null);
  const [runId, setRunId] = useState(null);
  const [form, setForm] = useState(null);
  const [filter, setFilter] = useState("en_cours");
  const [now, setNow] = useState(Date.now());

  const load = async () => {
    const { data, error } = await supabase.from("procedure_runs").select("*");
    if (error) { if (/does not exist|42P01/.test((error.message || "") + (error.code || ""))) setMissing(true); else showToast(friendlyError(error)); setRuns([]); return; }
    setRuns(data || []);
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);

  const run = (runs || []).find((r) => r.id === runId);

  const nextRef = (proc) => {
    const y = new Date().getFullYear();
    const n = (runs || []).filter((r) => r.procedure === proc && String(r.reference).startsWith(y + "-")).length + 1;
    return `${y}-${String(n).padStart(3, "0")}`;
  };

  const create = async () => {
    const f = form;
    if (!f.company.trim()) { showToast("Indiquez l'entreprise concernée."); return; }
    if (f.proc === "2fa" && !/^\S+@\S+\.\S+$/.test(f.email.trim())) { showToast("Indiquez l'adresse e-mail d'origine de la demande."); return; }
    const now0 = new Date().toISOString();
    const data = { steps: {}, flags: {}, alerts: [], note: "", period: f.period || "", motif: "" };
    if (f.proc === "2fa") { data.steps.s1 = { by: me, at: now0 }; data.steps.s2 = { by: me, at: now0 }; data.channel = f.channel; }
    const row = { id: crypto.randomUUID(), procedure: f.proc, reference: nextRef(f.proc), company_name: f.company.trim(), contact_email: f.email.trim() || null, status: "en_cours", opened_by: me, opened_at: now0, closed_by: null, closed_at: null, data };
    const { error } = await supabase.from("procedure_runs").insert(row);
    if (error) { showToast(friendlyError(error)); return; }
    setForm(null); showToast("Fiche " + row.reference + " ouverte.");
    await load(); setRunId(row.id);
  };

  const save = async (r, patch) => {
    const next = { ...r, ...patch };
    const { error } = await supabase.from("procedure_runs").update(patch).eq("id", r.id);
    if (error) { showToast(friendlyError(error)); return false; }
    setRuns((prev) => prev.map((x) => (x.id === r.id ? next : x)));
    return true;
  };
  const patchData = (r, d) => save(r, { data: { ...(r.data || {}), ...d } });

  const toggleStep = (r, id) => {
    if (r.status !== "en_cours") return;
    const steps = { ...((r.data && r.data.steps) || {}) };
    if (steps[id]) delete steps[id]; else steps[id] = { by: me, at: new Date().toISOString() };
    patchData(r, { steps });
  };
  const markAlert = async (r) => {
    if (!(r.data.steps || {}).s3) { showToast("Vérifiez d'abord les deux preuves (étape 3)."); return; }
    const steps = { ...(r.data.steps || {}), s4: { by: me, at: new Date().toISOString() } };
    await patchData(r, { steps, alert_sent_at: new Date().toISOString() });
  };
  const toggleAlertSignal = (r, k) => {
    const cur = new Set(r.data.alerts || []);
    if (cur.has(k)) cur.delete(k); else cur.add(k);
    patchData(r, { alerts: [...cur] });
  };
  const finish = async (r, status) => {
    const d = r.data || {};
    const def = PR_DEFS[r.procedure];
    if (status === "termine") {
      if (r.procedure === "2fa") {
        const rem = prRemaining(r, Date.now());
        const needed = ["s3", "s4", "s7", "s8"].concat(d.highStakes ? ["s6"] : []);
        if (d.stop) { showToast("Une réponse STOP a été reçue : clôturez la fiche comme tentative suspecte."); return; }
        if (rem === null || rem > 0) { showToast("Le délai d'attente n'est pas écoulé : impossible de réinitialiser maintenant."); return; }
        const miss = needed.filter((k) => !(d.steps || {})[k]);
        if (miss.length) { showToast("Étapes manquantes : " + miss.map((k) => def.steps.find((s) => s[0] === k)[1]).join(" ; ")); return; }
      } else {
        const miss = def.steps.filter(([k]) => !(d.steps || {})[k]);
        if (miss.length) { showToast(`Il reste ${miss.length} point(s) à cocher avant de terminer.`); return; }
        if (r.procedure === "reouverture" && !String(d.motif || "").trim()) { showToast("Le motif de la réouverture est obligatoire."); return; }
      }
    }
    if ((status === "refuse" || status === "suspect") && !String(d.note || "").trim()) { showToast("Notez la raison dans le champ « Résultat / remarques »."); return; }
    await save(r, { status, closed_by: me, closed_at: new Date().toISOString() });
    showToast("Fiche " + r.reference + " close.");
  };
  const reopen = (r) => save(r, { status: "en_cours", closed_by: null, closed_at: null });
  const copy = async (txt) => { try { await navigator.clipboard.writeText(txt); showToast("Texte copié."); } catch (e) { showToast("Copie impossible : sélectionnez le texte à la main."); } };

  if (missing) return (
    <div className="bg-white rounded-lg p-6 text-sm" style={{ border: "1px solid #E4DFD1", color: "#7A7460" }} data-testid="pr-missing">
      Les procédures ne sont pas encore activées : le script SQL « v320 » doit d'abord être exécuté dans Supabase.
    </div>
  );

  const list = (runs || []).filter((r) => filter === "toutes" ? true : filter === "en_cours" ? r.status === "en_cours" : r.status !== "en_cours")
    .slice().sort((a, b) => new Date(b.opened_at) - new Date(a.opened_at));

  // ─── Vue d'une fiche ───
  if (run) {
    const def = PR_DEFS[run.procedure];
    const d = run.data || {};
    const steps = d.steps || {};
    const editable = run.status === "en_cours";
    const rem = run.procedure === "2fa" ? prRemaining(run, now) : null;
    const delayDone = rem !== null && rem === 0;
    return (
      <div className="bg-white rounded-lg p-4 md:p-6" style={{ border: "1px solid #E4DFD1" }} data-testid="pr-fiche">
        <div className="flex items-start justify-between gap-2 flex-wrap mb-3">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide" style={{ color: "#8A8370" }}>Fiche {run.reference}</div>
            <div className="text-sm font-medium" style={{ color: "#152238" }}>{def.title}</div>
            <div className="text-xs" style={{ color: "#8A8370" }}>{run.company_name}{run.contact_email ? " · " + run.contact_email : ""}{d.period ? " · " + d.period : ""} · ouverte par {run.opened_by} le {tmFmt(run.opened_at)}</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs px-2 py-0.5 rounded" data-testid="pr-statut" style={{ background: PR_STATUS[run.status][2], color: PR_STATUS[run.status][1] }}>{PR_STATUS[run.status][0]}</span>
            <button onClick={() => setRunId(null)} className="text-xs underline" style={{ color: "#8A8370" }}>Retour</button>
          </div>
        </div>

        {run.procedure === "2fa" && editable && (
          <div className="p-3 rounded mb-3" style={{ background: "#FAF8F1" }}>
            <div className="text-xs font-medium mb-1" style={{ color: "#152238" }}>Signaux d'alerte (cochez ce qui s'applique : le délai passe à 72 heures)</div>
            {PR_2FA_ALERTS.map(([k, l]) => (
              <label key={k} className="flex items-start gap-2 text-xs py-0.5" style={{ color: "#7A7460" }}>
                <input type="checkbox" data-testid={"pr-sig-" + k} disabled={!!d.alert_sent_at} checked={(d.alerts || []).includes(k)} onChange={() => toggleAlertSignal(run, k)} />
                {l}
              </label>
            ))}
            {d.alert_sent_at && <div className="text-xs mt-1" style={{ color: "#8A8370" }}>Les signaux ne se modifient plus une fois l'alerte envoyée.</div>}
            <label className="flex items-start gap-2 text-xs pt-2" style={{ color: "#7A7460" }}>
              <input type="checkbox" data-testid="pr-forts-enjeux" checked={!!d.highStakes} onChange={(e) => patchData(run, { highStakes: e.target.checked })} />
              Compte à forts enjeux (plusieurs utilisateurs ou données de paie) : second validateur obligatoire
            </label>
          </div>
        )}

        {run.procedure === "cloture" && (
          <div className="flex gap-2 flex-wrap mb-3">
            <input data-testid="pr-periode" disabled={!editable} value={d.period || ""} onChange={(e) => setRuns((p) => p.map((x) => x.id === run.id ? { ...x, data: { ...x.data, period: e.target.value } } : x))}
              onBlur={(e) => patchData(run, { period: e.target.value })} placeholder="Période à clôturer (ex. : Mensuelle — octobre 2026)"
              className="flex-1 border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4", minWidth: 220 }} />
          </div>
        )}
        {run.procedure === "reouverture" && (
          <textarea data-testid="pr-motif" disabled={!editable} rows={2} value={d.motif || ""} onChange={(e) => setRuns((p) => p.map((x) => x.id === run.id ? { ...x, data: { ...x.data, motif: e.target.value } } : x))}
            onBlur={(e) => patchData(run, { motif: e.target.value })} placeholder="Motif de la réouverture (obligatoire)" className="w-full border rounded px-2 py-1.5 text-sm mb-3" style={{ borderColor: "#DDD6C4" }} />
        )}

        <div className="space-y-1 mb-3" data-testid="pr-etapes">
          {def.steps.map(([id, label, help], i) => {
            const st = steps[id];
            const auto = run.procedure === "2fa" && (id === "s5");
            const checked = auto ? (delayDone && !d.stop) : !!st;
            const isAlertStep = run.procedure === "2fa" && id === "s4";
            const skipSecond = run.procedure === "2fa" && id === "s6" && !d.highStakes;
            return (
              <div key={id} className="p-2 rounded" style={{ border: "1px solid #F0EDE3", opacity: skipSecond ? 0.6 : 1 }}>
                <label className="flex items-start gap-2 text-sm" style={{ color: "#152238" }}>
                  <input type="checkbox" data-testid={"pr-etape-" + id} checked={checked} disabled={!editable || auto || isAlertStep} onChange={() => toggleStep(run, id)} style={{ marginTop: 3 }} />
                  <span><b>{i + 1}.</b> {label}{skipSecond ? " (non requis pour ce compte)" : ""}</span>
                </label>
                {help && <div className="text-xs ml-6" style={{ color: "#8A8370" }}>{help}</div>}
                {st && !auto && <div className="text-xs ml-6" style={{ color: "#0F6B5C" }}>Fait par {st.by} le {tmFmt(st.at)}</div>}
                {isAlertStep && editable && !d.alert_sent_at && (
                  <button data-testid="pr-alerte" onClick={() => markAlert(run)} className="ml-6 mt-1 text-xs px-3 py-1 rounded text-white" style={{ background: "#152238" }}>Alerte envoyée (démarrer le délai)</button>
                )}
                {auto && d.alert_sent_at && (
                  <div className="text-xs ml-6" data-testid="pr-delai" style={{ color: delayDone ? "#0F6B5C" : "#9A7B1E" }}>
                    {delayDone ? "Délai écoulé." : `Délai en cours : encore ${prFmtDuration(rem)} (sur ${prWaitHours(run)} h).`}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {run.procedure === "2fa" && editable && (
          <div className="p-3 rounded mb-3" style={{ background: "#FBF1DC" }}>
            <label className="flex items-start gap-2 text-xs" style={{ color: "#7A5C12" }}>
              <input type="checkbox" data-testid="pr-stop" checked={!!d.stop} onChange={(e) => patchData(run, { stop: e.target.checked })} />
              Le titulaire a répondu STOP (la réinitialisation est alors interdite : clôturer comme tentative suspecte, surveiller le compte et réinitialiser son mot de passe)
            </label>
          </div>
        )}

        <textarea data-testid="pr-note" disabled={!editable} rows={2} value={d.note || ""} onChange={(e) => setRuns((p) => p.map((x) => x.id === run.id ? { ...x, data: { ...x.data, note: e.target.value } } : x))}
          onBlur={(e) => patchData(run, { note: e.target.value })} placeholder="Résultat / remarques (jamais de mot de passe, de code ni de pièce d'identité)" className="w-full border rounded px-2 py-1.5 text-sm mb-3" style={{ borderColor: "#DDD6C4" }} />

        {editable ? (
          <div className="flex gap-2 flex-wrap">
            <button data-testid="pr-terminer" onClick={() => finish(run, "termine")} className="text-xs px-3 py-1.5 rounded text-white" style={{ background: "#0F6B5C" }}>{run.procedure === "2fa" ? "Terminer : 2FA réinitialisé" : "Terminer la fiche"}</button>
            {run.procedure === "2fa" && <button data-testid="pr-refuser" onClick={() => finish(run, "refuse")} className="text-xs px-3 py-1.5 rounded" style={{ border: "1px solid #A6432F", color: "#A6432F" }}>Refuser (preuves insuffisantes)</button>}
            {run.procedure === "2fa" && <button data-testid="pr-suspect" onClick={() => finish(run, "suspect")} className="text-xs px-3 py-1.5 rounded" style={{ border: "1px solid #A6432F", color: "#A6432F" }}>Tentative suspecte</button>}
          </div>
        ) : (
          <div className="text-xs" style={{ color: "#8A8370" }}>
            Close par {run.closed_by} le {tmFmt(run.closed_at)}. <button data-testid="pr-rouvrir" onClick={() => reopen(run)} className="underline" style={{ color: "#152238" }}>Rouvrir la fiche</button>
          </div>
        )}
      </div>
    );
  }

  // ─── Vue principale : règles + registre ───
  return (
    <div data-testid="pr-panel">
      <div className="bg-white rounded-lg p-4 md:p-6 mb-4" style={{ border: "1px solid #E4DFD1" }}>
        <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Procédures de l'équipe</div>
        <div className="text-xs mb-3" style={{ color: "#8A8370" }}>Lisez la règle, puis ouvrez une fiche pour l'exécuter étape par étape : chaque étape cochée garde le nom de la personne et l'heure.</div>
        <div className="space-y-2">
          {Object.entries(PR_DEFS).map(([key, def]) => (
            <div key={key} className="p-3 rounded" style={{ border: "1px solid #F0EDE3" }}>
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <div className="text-sm" style={{ color: "#152238", fontWeight: 600 }}>{def.title}</div>
                  <div className="text-xs" style={{ color: "#8A8370" }}>{def.short}</div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button data-testid={"pr-lire-" + key} onClick={() => setReadKey(readKey === key ? null : key)} className="text-xs underline" style={{ color: "#152238" }}>{readKey === key ? "Masquer la règle" : "Lire la règle"}</button>
                  <button data-testid={"pr-ouvrir-" + key} onClick={() => setForm({ proc: key, company: "", email: "", period: "", channel: "e-mail" })} className="text-xs px-3 py-1 rounded text-white" style={{ background: "#152238" }}>Ouvrir une fiche</button>
                </div>
              </div>
              {readKey === key && (
                <div className="mt-3 text-sm space-y-3" style={{ color: "#3D3A2F" }} data-testid={"pr-regle-" + key}>
                  {def.intro.map((t, i) => <p key={i}>{t}</p>)}
                  {def.rules.length > 0 && <div><div className="text-xs font-medium mb-1" style={{ color: "#152238" }}>Principes</div><ul className="list-disc ml-5 text-xs space-y-0.5">{def.rules.map((t, i) => <li key={i}>{t}</li>)}</ul></div>}
                  <div><div className="text-xs font-medium mb-1" style={{ color: "#152238" }}>Étapes</div><ol className="list-decimal ml-5 text-xs space-y-1">{def.steps.map(([id, l, h]) => <li key={id}>{l}{h ? <span style={{ color: "#8A8370" }}> — {h}</span> : null}</li>)}</ol></div>
                  {def.forbidden.length > 0 && <div><div className="text-xs font-medium mb-1" style={{ color: "#A6432F" }}>Interdits, quelles que soient les circonstances</div><ul className="list-disc ml-5 text-xs space-y-0.5">{def.forbidden.map((t, i) => <li key={i}>{t}</li>)}</ul></div>}
                  {key === "2fa" && <div><div className="text-xs font-medium mb-1" style={{ color: "#A6432F" }}>Signaux d'alerte (délai porté à 72 heures)</div><ul className="list-disc ml-5 text-xs space-y-0.5">{PR_2FA_ALERTS.map(([k, l]) => <li key={k}>{l}</li>)}</ul></div>}
                  {def.templates.map(([t, txt]) => (
                    <div key={t} className="p-2 rounded" style={{ background: "#FAF8F1" }}>
                      <div className="flex items-center justify-between gap-2"><div className="text-xs font-medium" style={{ color: "#152238" }}>{t}</div><button onClick={() => copy(txt)} className="text-xs underline" style={{ color: "#152238" }}>Copier</button></div>
                      <div className="text-xs mt-1" style={{ whiteSpace: "pre-wrap" }}>{txt}</div>
                    </div>
                  ))}
                  <p className="text-xs" style={{ color: "#8A8370" }}>Ces règles sont des bonnes pratiques internes : à faire relire par votre juriste et, pour la comptabilité, par l'expert-comptable. Elles ne remplacent pas les textes légaux applicables.</p>
                </div>
              )}
            </div>
          ))}
        </div>
        {form && (
          <div className="mt-3 p-3 rounded space-y-2" style={{ background: "#FAF8F1" }} data-testid="pr-form">
            <div className="text-xs font-medium" style={{ color: "#152238" }}>Nouvelle fiche — {PR_DEFS[form.proc].title}</div>
            <input data-testid="pr-f-entreprise" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Entreprise concernée" className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }} />
            {form.proc === "2fa" && <input data-testid="pr-f-email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Adresse e-mail d'origine de la demande (celle du compte)" className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }} />}
            {form.proc === "2fa" && <div className="text-xs" style={{ color: "#A6432F" }}>Si la demande n'est pas arrivée par e-mail depuis l'adresse du compte, ne créez pas de fiche : répondez avec le modèle « demande reçue par téléphone ou réseau social ».</div>}
            <div className="flex gap-2"><button data-testid="pr-f-creer" onClick={create} className="text-xs px-3 py-1.5 rounded text-white" style={{ background: "#0F6B5C" }}>Ouvrir la fiche</button><button onClick={() => setForm(null)} className="text-xs underline" style={{ color: "#8A8370" }}>Annuler</button></div>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg p-4 md:p-6" style={{ border: "1px solid #E4DFD1" }}>
        <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
          <div className="text-sm font-medium" style={{ color: "#152238" }}>Registre des fiches</div>
          <div className="flex gap-2">
            {[["en_cours", "En cours"], ["closes", "Closes"], ["toutes", "Toutes"]].map(([k, l]) => (
              <button key={k} data-testid={"pr-filtre-" + k} onClick={() => setFilter(k)} className="px-3 py-1 text-xs rounded-full" style={{ background: filter === k ? "#152238" : "transparent", color: filter === k ? "#fff" : "#152238", border: "1px solid #152238" }}>{l}</button>
            ))}
          </div>
        </div>
        {runs === null ? <div className="text-xs" style={{ color: "#A39C87" }}>Chargement…</div> : list.length === 0 ? (
          <div className="text-xs py-4 text-center" style={{ color: "#A39C87" }} data-testid="pr-vide">Aucune fiche dans cette vue.</div>
        ) : (
          <div className="space-y-1" data-testid="pr-registre">
            {list.map((r) => (
              <button key={r.id} data-testid="pr-ligne" onClick={() => setRunId(r.id)} className="w-full text-left p-2 rounded flex items-center gap-2 flex-wrap" style={{ border: "1px solid #F0EDE3" }}>
                <span className="text-xs shrink-0" style={{ color: "#8A8370", width: 110 }}>{r.reference} · {r.procedure === "2fa" ? "2FA" : r.procedure === "cloture" ? "Clôture" : "Réouverture"}</span>
                <span className="text-sm flex-1 min-w-0 truncate" style={{ color: "#152238" }}>{r.company_name}</span>
                <span className="text-xs px-2 py-0.5 rounded shrink-0" style={{ background: PR_STATUS[r.status][2], color: PR_STATUS[r.status][1] }}>{PR_STATUS[r.status][0]}</span>
                <span className="text-xs shrink-0" style={{ color: "#A39C87" }}>{tmFmt(r.opened_at)}</span>
              </button>
            ))}
          </div>
        )}
        <div className="text-xs mt-3" style={{ color: "#A39C87" }}>Le registre se conserve (aucune suppression possible). Durée de conservation à confirmer avec votre juriste.</div>
      </div>
    </div>
  );
}
