// ═══ MODULE ═══
// @module Offres aide et paiement
// @depends ChevronRight, FALLBACK_HTG_PER_USD, Icon, NET_MSG, PLAN_TIER_INFO, SUPABASE_URL, Send
//   _membership, clearMembershipCache, fetchHtgPerUsd, fmt, friendlyError, resolveMembership
//   sanitizeUserMessage, supabase, uid, useEffect, useState
// @exports ComingSoon, HelpCenterChat, PAYMENT_METHODS, UpgradeModal
// ═══ FIN DE L'EN-TÊTE ═══
function ComingSoon({ module }) {
  if (!module) {
    return (
      <div className="p-8 max-w-3xl">
        <div className="rounded-lg p-10 text-center bg-white" style={{ border: "1px dashed #DDD6C4" }}>
          <p className="text-sm" style={{ color: "#8A8370" }}>Cette section n'est pas disponible pour le moment.</p>
        </div>
      </div>
    );
  }
  const Icon = module.icon;
  return (
    <div className="p-8 max-w-3xl">
      <div className="rounded-lg p-10 text-center bg-white" style={{ border: "1px dashed #DDD6C4" }}>
        <Icon size={28} className="mx-auto mb-3" style={{ color: "#C9A24B" }} />
        <div className="text-xs uppercase tracking-widest mb-1" style={{ color: "#C9A24B" }}>Module {module.n}</div>
        <div className="display text-2xl mb-2" style={{ color: "#152238" }}>{module.label}</div>
        <p className="text-sm" style={{ color: "#8A8370" }}>
          Ce module sera développé à l'étape suivante, une fois le module Comptabilité validé, en respectant l'ordre défini.
        </p>
        <div className="flex items-center justify-center gap-1 mt-4 text-xs" style={{ color: "#A39C87" }}>
          <span>Comptabilité</span><ChevronRight size={12} /><span>...</span><ChevronRight size={12} /><span>{module.label}</span>
        </div>
      </div>
    </div>
  );
}

// --- Super Admin (toi seul) : gestion des abonnements et paiements manuels de tous
// les clients (MonCash, NatCash, virement...). Séparé de l'AdminModule habituel, qui
// lui reste cantonné à une seule entreprise. Aucun accès aux données comptables des
// clients (kv_store) — uniquement au statut d'abonnement et à l'historique de paiement.
const PAYMENT_METHODS = [
  { id: "moncash", label: "MonCash" },
  { id: "natcash", label: "NatCash" },
  { id: "virement", label: "Virement bancaire" },
  { id: "stripe", label: "Stripe" },
  { id: "autre", label: "Autre" },
];

// --- Mise à niveau / rétrogradation de forfait ---
// Une entreprise membre d'un groupe multi-entreprises est déjà au sommet de la
// progression (Groupe) quelle que soit la valeur de son propre plan_tier — ce
// champ ne décrit que le niveau de fonctionnalités de CETTE entreprise
// (Standard/Assisté), indépendant de son appartenance à un groupe.
function UpgradeModal({ onClose, planTier, groupId, groupName, showToast }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [htgRate, setHtgRate] = useState(null);
  useEffect(() => { fetchHtgPerUsd().then((r) => setHtgRate(r)); }, []);
  const rate = htgRate || FALLBACK_HTG_PER_USD;
  const toHtg = (usd) => Math.round((usd * rate) / 10) * 10;

  const currentInfo = PLAN_TIER_INFO[planTier] || PLAN_TIER_INFO.standard;
  const inGroup = !!groupId;
  const nextTier = !inGroup ? currentInfo.next : null;
  const nextInfo = nextTier ? PLAN_TIER_INFO[nextTier] : null;
  const prevTier = !inGroup ? currentInfo.prev : null;
  const prevInfo = prevTier ? PLAN_TIER_INFO[prevTier] : null;

  const upgrade = async () => {
    if (!nextTier) return;
    setLoading(true);
    setError("");
    try {
      const { companyId } = await resolveMembership();
      const amount = toHtg(nextInfo.priceUSD);
      try { sessionStorage.setItem("compta-plus-upgrade-target", nextTier); } catch (e) {}
      const { data: { session: s } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/moncash?action=create`, {
        method: "POST",
        headers: { Authorization: `Bearer ${s.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, amount, targetTier: nextTier }),
      });
      const data = await res.json();
      if (!res.ok || !data.redirectUrl) throw new Error(data.error || "Réponse invalide du service de paiement");
      window.location.href = data.redirectUrl;
    } catch (e) {
      setError(friendlyError(e));
      setLoading(false);
    }
  };

  const downgrade = async () => {
    if (!window.confirm(`Repasser au forfait ${prevInfo.label} ? Vous perdrez l'accès aux fonctionnalités réservées au forfait ${currentInfo.label}.`)) return;
    setLoading(true);
    setError("");
    try {
      const { companyId } = await resolveMembership();
      const { data: { session: s } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/moncash?action=downgrade`, {
        method: "POST",
        headers: { Authorization: `Bearer ${s.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, targetTier: "standard" }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Échec de la rétrogradation");
      showToast("Forfait repassé en Standard.");
      clearMembershipCache();
      window.location.reload();
    } catch (e) {
      setError(friendlyError(e));
      setLoading(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(21,34,56,0.5)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 10, width: 480, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ background: "#152238", color: "#fff", padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Mise à niveau de forfait</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#fff", fontSize: 22, cursor: "pointer" }}>×</button>
        </div>
        <div style={{ padding: 20 }}>
          <div style={{ fontSize: 13, color: "#7A7460", marginBottom: 16 }}>
            Forfait actuel : <b style={{ color: "#152238" }}>{inGroup ? PLAN_TIER_INFO.group.label : currentInfo.label}</b>
            {inGroup && <span> — « {groupName} »</span>}
          </div>

          {error && <div style={{ background: "#F7E9E3", color: "#A6432F", padding: "8px 12px", borderRadius: 6, fontSize: 13, marginBottom: 14 }}>{sanitizeUserMessage(error)}</div>}

          {inGroup ? (
            <div style={{ border: "1px solid #E4DFD1", borderRadius: 8, padding: 16 }}>
              <p style={{ fontSize: 13, color: "#7A7460", marginBottom: 10 }}>
                Vous êtes déjà au forfait {PLAN_TIER_INFO.group.label} — il n'existe pas de forfait supérieur pour l'instant. Pour toute question (ajuster votre abonnement, quitter le groupe...), contactez le support via <b>Centre d'aide</b>, dans la barre latérale.
              </p>
              <button onClick={() => { onClose(); showToast("Ouvrez « Centre d'aide » dans la barre latérale pour nous écrire."); }}
                style={{ background: "none", border: "1px solid #DDD6C4", color: "#7A7460", borderRadius: 6, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>
                Fermer
              </button>
            </div>
          ) : (
            <>
              {nextInfo && (
                <div style={{ border: "1px solid #E4DFD1", borderRadius: 8, padding: 16, marginBottom: 14 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#152238", marginBottom: 4 }}>Passer au forfait {nextInfo.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#0F6B5C", marginBottom: 8 }}>{nextInfo.priceUSD} $/mois</div>
                  {nextTier === "group" && (
                    <p style={{ fontSize: 12, color: "#7A7460", marginBottom: 10 }}>
                      Regroupez jusqu'à 5 entreprises sous un seul abonnement — tableau de bord consolidé et comparatifs, chacune gardant sa propre gestion séparée.
                    </p>
                  )}
                  <button onClick={upgrade} disabled={loading}
                    style={{ background: "#152238", color: "#fff", border: "none", borderRadius: 6, padding: "10px 18px", fontSize: 13, cursor: "pointer", opacity: loading ? 0.5 : 1, width: "100%" }}>
                    {loading ? "Redirection en cours…" : `Payer ${toHtg(nextInfo.priceUSD).toLocaleString("fr-FR")} HTG avec MonCash`}
                  </button>
                </div>
              )}

              {prevInfo && (
                <div style={{ border: "1px solid #E4DFD1", borderRadius: 8, padding: 16 }}>
                  <div style={{ fontSize: 13, color: "#7A7460", marginBottom: 8 }}>Repasser au forfait {prevInfo.label}</div>
                  <button onClick={downgrade} disabled={loading}
                    style={{ background: "none", border: "1px solid #DDD6C4", color: "#7A7460", borderRadius: 6, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>
                    Repasser en {prevInfo.label}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Centre d'aide : discussion directe entre un utilisateur et le support ---
// Un seul fil de discussion par utilisateur, du plus ancien au plus récent,
// chaque message portant sa date et son heure. Le support répond depuis le
// Centre de gestion (onglet « Centre d'aide »). La fenêtre interroge le serveur
// toutes les 10 secondes tant qu'elle est ouverte — plus simple et plus robuste
// qu'un canal temps réel, et largement suffisant pour de l'assistance. Les
// erreurs s'affichent dans la fenêtre elle-même (pas en notification volante,
// qui passerait derrière ce panneau).
function HelpCenterChat({ onClose }) {
  const [me, setMe] = useState(null);
  const [messages, setMessages] = useState(null); // null = chargement
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = React.useRef(null);
  // Sur téléphone, le clavier réduit la zone visible : on cale la hauteur de la
  // fenêtre sur la zone réellement visible pour que la saisie reste toujours
  // au-dessus du clavier.
  const [viewH, setViewH] = useState(() => (window.visualViewport ? window.visualViewport.height : window.innerHeight));
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined;
    const onResize = () => setViewH(vv.height);
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  // Une discussion par entreprise : une même personne (administrateur gérant
  // plusieurs entreprises, collaborateur invité dans plusieurs...) ne doit jamais
  // retrouver dans l'entreprise B les échanges de l'entreprise A. Le cache de
  // résolution d'entreprise est déjà rempli à ce stade — aucun appel réseau ici.
  const companyId = (_membership && _membership.companyId) || null;
  const load = async (uid) => {
    let query = supabase.from("support_messages").select("id, sender, body, created_at, read_by_user").eq("user_id", uid);
    query = companyId ? query.eq("company_id", companyId) : query.is("company_id", null);
    const { data, error: loadErr } = await query.order("created_at", { ascending: true }).limit(500);
    if (loadErr) {
      setError("Impossible de charger la discussion pour l'instant. Réessayez dans un moment.");
      setMessages((prev) => prev || []);
      return;
    }
    setError("");
    setMessages(data || []);
    // Les réponses du support sont marquées comme lues dès qu'elles sont affichées.
    if ((data || []).some((m) => m.sender === "support" && !m.read_by_user)) {
      supabase.rpc("support_mark_read_user", { p_company_id: companyId }).then(() => {});
    }
  };

  useEffect(() => {
    let timer = null;
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session && session.user;
      if (!user) { if (!cancelled) setMessages([]); return; }
      if (cancelled) return;
      setMe({ id: user.id, email: user.email });
      await load(user.id);
      if (cancelled) return;
      timer = setInterval(() => { if (!document.hidden) load(user.id); }, 10000);
    })();
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (bottomRef.current) bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages ? messages.length : 0]);

  const send = async () => {
    const body = draft.trim();
    if (!body || !me || sending) return;
    setSending(true);
    setError("");
    const row = {
      id: crypto.randomUUID(),
      user_id: me.id,
      company_id: companyId,
      user_email: me.email,
      sender: "user",
      body,
      read_by_user: true,
      read_by_support: false,
    };
    const { error: sendErr } = await supabase.from("support_messages").insert(row);
    setSending(false);
    if (sendErr) {
      setError(sendErr.message && sendErr.message.includes("Trop de messages")
        ? sendErr.message
        : "Message non envoyé. " + NET_MSG);
      return;
    }
    setDraft("");
    setMessages((prev) => [...(prev || []), { ...row, created_at: new Date().toISOString() }]);
  };

  const fmt = (iso) => {
    try { return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }); } catch (e) { return ""; }
  };

  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: viewH, background: "rgba(21,34,56,0.5)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 10, width: 440, maxWidth: "100%", height: Math.min(640, viewH - 24), display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ background: "#152238", color: "#fff", padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Centre d'aide</div>
            <div style={{ fontSize: 11, color: "#C9A24B" }}>Discutez directement avec notre équipe</div>
          </div>
          <button onClick={onClose} aria-label="Fermer" style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: 24, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 14, background: "#FAF8F1" }}>
          <div style={{ background: "#FBF1DC", border: "1px solid #E8D9A8", borderRadius: 8, padding: "9px 11px", fontSize: 12, color: "#7A6A2E", marginBottom: 12 }}>
            Décrivez votre problème (abonnement, connexion, facture…). Notre équipe vous répond ici même — une pastille rouge sur « Centre d'aide » vous prévient dès qu'une réponse arrive. Ne communiquez jamais ici de code PIN ni de numéro de carte bancaire.
          </div>
          {messages === null && <div style={{ textAlign: "center", fontSize: 12, color: "#A39C87", padding: "20px 0" }}>Chargement…</div>}
          {messages && messages.length === 0 && !error && (
            <div style={{ textAlign: "center", fontSize: 12, color: "#A39C87", padding: "20px 0" }}>Aucun message pour le moment. Écrivez-nous ci-dessous.</div>
          )}
          {(messages || []).map((m) => {
            const mine = m.sender === "user";
            return (
              <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start", marginBottom: 10 }}>
                {!mine && <div style={{ fontSize: 10, color: "#9A7B1E", fontWeight: 600, marginBottom: 2 }}>Support Compta+</div>}
                <div style={{ maxWidth: "84%", background: mine ? "#152238" : "#fff", color: mine ? "#fff" : "#152238", border: mine ? "none" : "1px solid #E4DFD1", borderRadius: 12, padding: "8px 11px", fontSize: 13, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {m.body}
                </div>
                <div style={{ fontSize: 10, color: "#A39C87", marginTop: 2 }}>{fmt(m.created_at)}</div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        <div style={{ borderTop: "1px solid #E4DFD1", padding: 10, background: "#fff", flexShrink: 0 }}>
          {error && <div style={{ color: "#A6432F", fontSize: 12, marginBottom: 6 }}>{sanitizeUserMessage(error)}</div>}
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={2000} rows={2} placeholder="Écrivez votre message…"
            style={{ width: "100%", boxSizing: "border-box", border: "1px solid #DDD6C4", borderRadius: 6, padding: 8, fontSize: 13, resize: "none", fontFamily: "inherit" }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
            <span style={{ fontSize: 10, color: "#A39C87" }}>{draft.length}/2000</span>
            <button onClick={send} disabled={sending || !draft.trim()}
              style={{ background: "#152238", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", fontSize: 13, cursor: "pointer", opacity: (sending || !draft.trim()) ? 0.5 : 1, display: "flex", alignItems: "center", gap: 6 }}>
              <Send size={13} /> {sending ? "Envoi…" : "Envoyer"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

