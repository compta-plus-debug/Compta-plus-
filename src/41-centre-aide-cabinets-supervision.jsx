// --- Boîte de réception du Centre d'aide (côté support, dans le Centre de gestion) ---
// Les messages sont regroupés par utilisateur (une conversation par personne),
// puis découpés en « échanges » : un échange = une ou plusieurs questions de
// l'utilisateur suivies de la ou des réponses du support. Chaque conversation
// affiche l'email, le forfait actif, le statut et la date de début d'utilisation
// de l'entreprise, pour savoir tout de suite à qui l'on parle.
function SupportInbox({ companies, currentUserEmail, logActivity, onUnreadChange }) {
  const [msgs, setMsgs] = useState(null); // null = chargement
  const [loadError, setLoadError] = useState("");
  const [openKey, setOpenKey] = useState(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [search, setSearch] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);

  // Une conversation = une personne DANS une entreprise donnée : la même personne
  // qui écrit depuis deux entreprises produit deux conversations distinctes, chacune
  // avec le forfait et la date de début de SON entreprise.
  const threadKey = (m) => `${m.user_id}|${m.company_id || ""}`;

  const load = async () => {
    const { data, error } = await supabase.from("support_messages").select("*").order("created_at", { ascending: false }).limit(1500);
    if (error) {
      setLoadError(friendlyError(error));
      setMsgs((prev) => prev || []);
      return;
    }
    setLoadError("");
    setMsgs((data || []).slice().reverse());
  };

  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 15000);
    return () => clearInterval(t);
  }, []);

  // Une conversation ouverte est automatiquement marquée comme lue — y compris
  // lorsqu'un nouveau message arrive pendant qu'elle est affichée.
  useEffect(() => {
    if (!openKey || !msgs) return;
    if (!msgs.some((m) => threadKey(m) === openKey && m.sender === "user" && !m.read_by_support)) return;
    const [uid, co] = openKey.split("|");
    supabase.rpc("support_mark_read_support", { p_user_id: uid, p_company_id: co || null }).then(({ error }) => {
      if (error) return;
      setMsgs((prev) => (prev || []).map((m) => (threadKey(m) === openKey && m.sender === "user" ? { ...m, read_by_support: true } : m)));
      if (onUnreadChange) onUnreadChange();
    });
  }, [msgs, openKey]);

  const threads = useMemo(() => {
    const map = new Map();
    (msgs || []).forEach((m) => {
      const key = threadKey(m);
      let t = map.get(key);
      if (!t) { t = { key, userId: m.user_id, email: m.user_email, companyId: m.company_id || null, msgs: [], unread: 0, lastAt: m.created_at }; map.set(key, t); }
      t.msgs.push(m);
      if (m.sender === "user") t.email = m.user_email;
      t.lastAt = m.created_at;
      if (m.sender === "user" && !m.read_by_support) t.unread += 1;
    });
    return [...map.values()].sort((a, b) => ((b.unread > 0) - (a.unread > 0)) || (a.lastAt < b.lastAt ? 1 : -1));
  }, [msgs]);

  const companyOf = (t) => (companies || []).find((c) => c.id === t.companyId) || null;
  const visibleThreads = threads.filter((t) => {
    if (unreadOnly && t.unread === 0) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const co = companyOf(t);
    return (t.email || "").toLowerCase().includes(q) || ((co && co.name) || "").toLowerCase().includes(q);
  });
  const totalUnread = threads.reduce((n, t) => n + t.unread, 0);

  const fmtDateTime = (iso) => {
    try { return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }); } catch (e) { return ""; }
  };
  const fmtDate = (iso) => {
    try { return new Date(iso).toLocaleDateString("fr-FR"); } catch (e) { return "—"; }
  };

  const groupExchanges = (list) => {
    const groups = [];
    let cur = null;
    list.forEach((m) => {
      // Un nouvel échange commence à chaque message de l'utilisateur qui suit une réponse du support.
      if (!cur || (m.sender === "user" && cur.hasSupport)) { cur = { start: m.created_at, msgs: [], hasSupport: false }; groups.push(cur); }
      cur.msgs.push(m);
      if (m.sender === "support") cur.hasSupport = true;
    });
    return groups;
  };

  const sendReply = async (t) => {
    const body = reply.trim();
    if (!body || sending) return;
    setSending(true);
    setSendError("");
    const row = {
      id: crypto.randomUUID(),
      user_id: t.userId,
      company_id: t.companyId || null,
      user_email: t.email,
      sender: "support",
      body,
      read_by_user: false,
      read_by_support: true,
    };
    const { error } = await supabase.from("support_messages").insert(row);
    setSending(false);
    if (error) { setSendError("Réponse non envoyée. " + NET_MSG); return; }
    setReply("");
    setMsgs((prev) => [...(prev || []), { ...row, created_at: new Date().toISOString() }]);
    if (logActivity) logActivity("support_reponse", `À ${t.email}`);
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <div className="text-sm" style={{ color: "#152238" }}>
          <span className="font-medium">{threads.length}</span> conversation{threads.length > 1 ? "s" : ""}
          {totalUnread > 0 && <span className="ml-2 text-xs px-2 py-0.5 rounded-full text-white" style={{ background: "#D9756B" }}>{totalUnread} non lu{totalUnread > 1 ? "s" : ""}</span>}
        </div>
        <button onClick={load} className="text-xs underline" style={{ color: "#8A8370" }}>Actualiser</button>
      </div>
      <div className="flex gap-3 items-center flex-wrap mb-4">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher un email ou une entreprise..."
          className="flex-1 border rounded px-3 py-2 text-sm" style={{ borderColor: "#DDD6C4", minWidth: 200 }} />
        <label className="flex items-center gap-1.5 text-xs" style={{ color: "#7A7460" }}>
          <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
          Non lus seulement
        </label>
      </div>

      {loadError && (
        <div className="text-xs p-3 rounded mb-3" style={{ background: "#F7E9E3", color: "#A6432F" }}>
          Impossible de charger les messages : {loadError}. Si le message parle d'une table introuvable, la migration SQL du Centre d'aide n'a pas encore été exécutée sur ce projet.
        </div>
      )}
      {msgs === null ? (
        <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>Chargement…</div>
      ) : visibleThreads.length === 0 ? (
        <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>
          {threads.length === 0 ? "Aucun message reçu pour le moment." : "Aucune conversation ne correspond."}
        </div>
      ) : (
        <div className="space-y-2">
          {visibleThreads.map((t) => {
            const co = companyOf(t);
            const isOpen = openKey === t.key;
            const last = t.msgs[t.msgs.length - 1];
            const planLabel = co ? (co.plan_tier === "assisted" ? "Assisté" : "Standard") : "—";
            const statusLabel = co ? (co.plan_status === "active" ? "Payant" : co.plan_status === "trial" ? "Essai" : "Suspendu") : "—";
            const trialDaysLeft = co && co.plan_status === "trial" && co.trial_ends_at ? Math.ceil((new Date(co.trial_ends_at) - new Date()) / 86400000) : null;
            return (
              <div key={t.key} className="bg-white rounded-lg overflow-hidden" style={{ border: t.unread > 0 ? "1px solid #D9756B" : "1px solid #E4DFD1" }}>
                <div className="p-3 flex items-start justify-between gap-3 cursor-pointer" onClick={() => { setOpenKey(isOpen ? null : t.key); setReply(""); setSendError(""); }}>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate" style={{ color: "#152238" }}>{t.email}</div>
                    <div className="text-xs truncate" style={{ color: "#A39C87" }}>{co ? co.name : "Pas encore d'entreprise"}</div>
                    <div className="text-xs mt-1 truncate" style={{ color: "#7A7460" }}>
                      {last.sender === "support" ? "Vous : " : ""}{last.body}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {t.unread > 0 && <span className="text-xs px-2 py-0.5 rounded-full text-white" style={{ background: "#D9756B" }}>{t.unread}</span>}
                    <div className="text-xs mt-1" style={{ color: "#A39C87" }}>{fmtDateTime(t.lastAt)}</div>
                  </div>
                </div>

                {isOpen && (
                  <div className="px-3 pb-3" style={{ borderTop: "1px solid #F0EDE3" }}>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-3 mb-3 text-xs">
                      <div className="p-2 rounded" style={{ background: "#FAF8F1" }}>
                        <div style={{ color: "#A39C87" }}>Email</div>
                        <div className="truncate" style={{ color: "#152238", fontWeight: 500 }}>{t.email}</div>
                      </div>
                      <div className="p-2 rounded" style={{ background: "#FAF8F1" }}>
                        <div style={{ color: "#A39C87" }}>Forfait actif</div>
                        <div style={{ color: "#152238", fontWeight: 500 }}>{planLabel}</div>
                      </div>
                      <div className="p-2 rounded" style={{ background: "#FAF8F1" }}>
                        <div style={{ color: "#A39C87" }}>Statut</div>
                        <div style={{ color: "#152238", fontWeight: 500 }}>
                          {statusLabel}{trialDaysLeft !== null ? ` (${trialDaysLeft > 0 ? trialDaysLeft + " j restants" : "terminé"})` : ""}
                        </div>
                      </div>
                      <div className="p-2 rounded" style={{ background: "#FAF8F1" }}>
                        <div style={{ color: "#A39C87" }}>Début d'utilisation</div>
                        <div style={{ color: "#152238", fontWeight: 500 }}>{co && co.created_at ? fmtDate(co.created_at) : "—"}</div>
                      </div>
                      <div className="p-2 rounded md:col-span-2" style={{ background: "#FAF8F1" }}>
                        <div style={{ color: "#A39C87" }}>Entreprise</div>
                        <div className="truncate" style={{ color: "#152238", fontWeight: 500 }}>{co ? co.name : "Pas encore d'entreprise"}</div>
                      </div>
                    </div>

                    <div className="space-y-3 mb-3">
                      {groupExchanges(t.msgs).map((g, gi) => (
                        <div key={gi} className="rounded-lg p-2.5" style={{ background: "#FAF8F1", border: "1px solid #F0EDE3" }}>
                          <div className="text-xs mb-2" style={{ color: "#A39C87" }}>Échange du {fmtDateTime(g.start)}</div>
                          <div className="space-y-2">
                            {g.msgs.map((m) => {
                              const fromSupport = m.sender === "support";
                              return (
                                <div key={m.id} className="flex flex-col" style={{ alignItems: fromSupport ? "flex-end" : "flex-start" }}>
                                  <div className="text-xs mb-0.5" style={{ color: fromSupport ? "#9A7B1E" : "#5B3FA0", fontWeight: 600 }}>
                                    {fromSupport ? "Support" : t.email}
                                  </div>
                                  <div className="text-sm px-3 py-2 rounded-xl" style={{ maxWidth: "88%", whiteSpace: "pre-wrap", wordBreak: "break-word", background: fromSupport ? "#152238" : "#fff", color: fromSupport ? "#fff" : "#152238", border: fromSupport ? "none" : "1px solid #E4DFD1" }}>
                                    {m.body}
                                  </div>
                                  <div className="text-xs mt-0.5" style={{ color: "#A39C87" }}>{fmtDateTime(m.created_at)}</div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>

                    {sendError && <div className="text-xs mb-2" style={{ color: "#A6432F" }}>{sendError}</div>}
                    <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={3} maxLength={2000} placeholder={`Répondre à ${t.email}…`}
                      className="w-full border rounded px-3 py-2 text-sm" style={{ borderColor: "#DDD6C4", resize: "none" }} />
                    <div className="flex justify-between items-center mt-2">
                      <span className="text-xs" style={{ color: "#A39C87" }}>{reply.length}/2000</span>
                      <button onClick={() => sendReply(t)} disabled={sending || !reply.trim()}
                        className="text-sm px-4 py-2 rounded text-white flex items-center gap-2" style={{ background: "#152238", opacity: (sending || !reply.trim()) ? 0.5 : 1 }}>
                        <Send size={13} /> {sending ? "Envoi…" : "Répondre"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// K:CAB:START — Espace Cabinet : logique pure (résumé d'un dossier client, tri) 
function cabSummarize(entries, settings, openComments, today) {
  const list = Array.isArray(entries) ? entries : [];
  const month = String(today || "").slice(0, 7);
  let last = "", monthCount = 0;
  list.forEach((e) => {
    const d = String((e && e.date) || "").slice(0, 10);
    if (!d) return;
    if (d > last) last = d;
    if (d.slice(0, 7) === month) monthCount++;
  });
  const daysSince = last ? Math.max(0, Math.round((Date.parse(today) - Date.parse(last)) / 86400000)) : null;
  return {
    count: list.length, monthCount, lastDate: last, daysSince,
    lockDate: (settings && settings.lockDate) || "",
    openComments: openComments || 0,
    stale: daysSince !== null && daysSince > 30,
  };
}
function cabAttention(r) { return (r.openComments > 0 ? 10 + r.openComments : 0) + (r.stale ? 5 : 0) + (r.failed ? 3 : 0) + (r.count === 0 ? 1 : 0); }
function cabSort(rows) {
  return rows.slice().sort((a, b) => (cabAttention(b) - cabAttention(a)) || String(a.name || "").localeCompare(String(b.name || ""), "fr"));
}
// K:CAB:END
// K:SUP:START — Supervision : logique pure (parcours d'inscription, pièces justificatives)
const SUP_ATT_MAX_COUNT = 40, SUP_ATT_MAX_BYTES = 8 * 1024 * 1024;
function supAttStatus(count, bytes) {
  const c = Number(count) || 0, b = Number(bytes) || 0;
  if (c >= SUP_ATT_MAX_COUNT || b >= SUP_ATT_MAX_BYTES) return "plein";
  if (c >= Math.ceil(SUP_ATT_MAX_COUNT * 0.75) || b >= SUP_ATT_MAX_BYTES * 0.75) return "proche";
  return "ok";
}
function funnelStats(companies, activity, payments, nowMs) {
  const DAY = 86400000, act = activity || {};
  const firstPay = {};
  (payments || []).forEach((p) => {
    if (!p || !p.company_id || !p.date) return;
    const t = Date.parse(p.date);
    if (isNaN(t)) return;
    if (!(p.company_id in firstPay) || t < firstPay[p.company_id]) firstPay[p.company_id] = t;
  });
  const rows = (companies || []).map((c) => {
    const a = act[c.id] || {};
    const created = Date.parse(c.created_at);
    const age = isNaN(created) ? null : Math.floor((nowMs - created) / DAY);
    const invoiced = (a.invoices_count || 0) > 0;
    const started = invoiced || (a.purchases_count || 0) > 0 || (a.entries_count || 0) > 0;
    const last = a.last_activity ? Date.parse(a.last_activity) : NaN;
    const matured = age !== null && age >= 30;
    const retained = matured ? (!isNaN(last) && last >= created + 30 * DAY) : null;
    const payAt = firstPay[c.id];
    const paid = payAt !== undefined;
    const payDays = paid && !isNaN(created) ? Math.max(0, Math.round((payAt - created) / DAY)) : null;
    return { id: c.id, month: String(c.created_at || "").slice(0, 7), started, invoiced, matured, retained, paid, payDays };
  });
  const n = rows.length;
  const count = (f) => rows.filter(f).length;
  const maturedRows = rows.filter((r) => r.matured);
  const payDays = rows.filter((r) => r.payDays !== null).map((r) => r.payDays).sort((x, y) => x - y);
  const median = payDays.length ? (payDays.length % 2 ? payDays[(payDays.length - 1) / 2] : Math.round((payDays[payDays.length / 2 - 1] + payDays[payDays.length / 2]) / 2)) : null;
  const byMonth = {};
  rows.forEach((r) => {
    if (!r.month) return;
    const m = byMonth[r.month] || (byMonth[r.month] = { month: r.month, signups: 0, invoiced: 0, paid: 0 });
    m.signups++; if (r.invoiced) m.invoiced++; if (r.paid) m.paid++;
  });
  const cohorts = Object.values(byMonth).sort((x, y) => (x.month < y.month ? 1 : -1)).slice(0, 6);
  return {
    signups: n, started: count((r) => r.started), invoiced: count((r) => r.invoiced),
    matured: maturedRows.length, retained: maturedRows.filter((r) => r.retained).length,
    paid: count((r) => r.paid), medianPayDays: median, cohorts,
  };
}
// K:SUP:END
function CabinetRemarks({ onChange, rows, showToast }) {
  const [items, setItems] = useState(null);
  const [filter, setFilter] = useState("ouvert");
  const [who, setWho] = useState("");
  const [form, setForm] = useState({ companyId: "", body: "" });
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState("");
  const ids = rows.map((r) => r.companyId);
  const nameOf = (id) => (rows.find((r) => r.companyId === id) || {}).name || "(dossier)";
  const load = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      setMe(((user && user.email) || "").toLowerCase());
      const r = await supabase.from("compta_comments").select("*").in("company_id", ids).order("created_at", { ascending: false }).limit(500);
      setItems(r.error ? [] : (r.data || []));
    } catch (e) { setItems([]); }
  };
  useEffect(() => { load(); }, []);
  const add = async () => {
    const body = form.body.trim();
    if (!form.companyId) { showToast("Choisissez d'abord le dossier concerné."); return; }
    if (!body) { showToast("Écrivez d'abord votre remarque."); return; }
    setBusy(true);
    try {
      const { error } = await supabase.from("compta_comments").insert({ company_id: form.companyId, author_email: me || "inconnu", body, target_type: "general", target_ref: null });
      if (error) showToast(/compta_comments|schema cache|does not exist/i.test(String(error.message)) ? "Les remarques ne sont pas encore disponibles sur votre compte. Contactez le support." : "La remarque n'a pas pu être enregistrée. Réessayez.");
      else { setForm({ companyId: form.companyId, body: "" }); showToast("Remarque enregistrée."); await load(); if (onChange) onChange(); }
    } catch (e) { showToast("La remarque n'a pas pu être enregistrée. Réessayez."); }
    setBusy(false);
  };
  const setStatus = async (c, status) => {
    const upd = status === "résolu" ? { status, resolved_at: new Date().toISOString(), resolved_by: me || null } : { status, resolved_at: null, resolved_by: null };
    const { error } = await supabase.from("compta_comments").update(upd).eq("id", c.id);
    if (error) { showToast("Action impossible pour le moment."); return; }
    await load(); if (onChange) onChange();
  };
  const shown = (items || []).filter((c) => (filter === "tous" || c.status === filter) && (!who || c.company_id === who));
  const openCount = (items || []).filter((c) => c.status === "ouvert").length;
  return (
    <div data-testid="cab-remarks" data-ro-ok="1">
      <div className="rounded-lg p-4 mb-3" style={{ background: "#EFE9DD" }}>
        <div className="text-sm font-medium mb-2" style={{ color: "#152238" }}>Nouvelle remarque pour un client</div>
        <select value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })} data-testid="cab-rem-dossier" className="w-full rounded px-2 py-1.5 text-sm mb-2" style={{ border: "1px solid #DDD6C4", background: "#fff" }}>
          <option value="">Choisir le dossier…</option>
          {rows.map((r) => <option key={r.companyId} value={r.companyId}>{r.name}</option>)}
        </select>
        <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={3} data-testid="cab-rem-body" placeholder="Votre remarque, visible par l'entreprise cliente…" className="w-full rounded px-2 py-1.5 text-sm mb-2" style={{ border: "1px solid #DDD6C4", background: "#fff" }} />
        <button onClick={add} disabled={busy} data-testid="cab-rem-add" className="px-3 py-1.5 rounded text-sm" style={{ background: "#152238", color: "#EFE9DD" }}>{busy ? "Envoi…" : "Ajouter la remarque"}</button>
      </div>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        {["ouvert", "résolu", "tous"].map((f) => (
          <button key={f} onClick={() => setFilter(f)} data-testid={"cab-rem-filter-" + f} className="px-2.5 py-1 rounded text-xs" style={{ background: filter === f ? "#C9A24B" : "rgba(239,233,221,0.15)", color: filter === f ? "#152238" : "#EFE9DD" }}>{f === "ouvert" ? `Ouvertes${items ? ` (${openCount})` : ""}` : f === "résolu" ? "Résolues" : "Toutes"}</button>
        ))}
        <select value={who} onChange={(e) => setWho(e.target.value)} className="rounded px-2 py-1 text-xs" style={{ border: "1px solid #DDD6C4", maxWidth: "100%" }}>
          <option value="">Tous les dossiers</option>
          {rows.map((r) => <option key={r.companyId} value={r.companyId}>{r.name}</option>)}
        </select>
      </div>
      {items === null ? <div className="text-sm py-6 text-center" style={{ color: "#8A97B5" }}>Chargement…</div> : shown.length === 0 ? (
        <div className="text-sm py-6 text-center" style={{ color: "#8A97B5" }} data-testid="cab-rem-empty">Aucune remarque à afficher.</div>
      ) : (
        <div className="grid gap-2">
          {shown.map((c) => (
            <div key={c.id} className="rounded-lg p-3" style={{ background: "#EFE9DD" }} data-testid="cab-rem-item">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs" style={{ color: "#7A7460" }}><b style={{ color: "#152238" }}>{nameOf(c.company_id)}</b> · {String(c.created_at || "").slice(0, 10)} · {c.author_email}</div>
                  <div className="text-sm mt-1" style={{ color: "#152238", overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{c.body}</div>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full shrink-0" style={c.status === "ouvert" ? { background: "#F7E9E3", color: "#A6432F" } : { background: "#E6F1EE", color: "#0F6B5C" }}>{c.status === "ouvert" ? "Ouverte" : "Résolue"}</span>
              </div>
              <div className="mt-2 flex gap-2">
                {c.status === "ouvert"
                  ? <button onClick={() => setStatus(c, "résolu")} data-testid="cab-rem-resolve" className="text-xs px-2 py-1 rounded" style={{ background: "#152238", color: "#EFE9DD" }}>Marquer résolue</button>
                  : <button onClick={() => setStatus(c, "ouvert")} className="text-xs px-2 py-1 rounded" style={{ border: "1px solid #DDD6C4", color: "#152238" }}>Rouvrir</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
// ===== K:CBILL — Forfait Cabinet : forfait par cabinet, relevés mensuels =====
const CBILL_STATUS = { pilote: "Pilote", actif: "Actif", suspendu: "Suspendu" };
const CBILL_INV_STATUS = { a_payer: "À payer", payee: "Payé", annulee: "Annulé" };
const cbillNum = (v) => { if (v === null || v === undefined || v === "") return null; const n = Number(v); return isFinite(n) && n >= 0 ? n : null; };
// Montant mensuel estimé en USD ; null si aucun tarif n'est fixé. Pilote en cours = 0.
function cbillEstimate(b, n, todayIso) {
  if (!b) return null;
  const unit = cbillNum(b.price_per_company_usd), flat = cbillNum(b.monthly_flat_usd);
  if (unit === null && flat === null) return null;
  if (b.status === "pilote" && b.pilot_ends_at && String(b.pilot_ends_at) >= String(todayIso).slice(0, 10)) return 0;
  return Math.round(((flat || 0) + (unit || 0) * (n || 0)) * 100) / 100;
}
const cbillMoney = (v) => (v === null || v === undefined ? "—" : Number(v).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " USD");
const cbillMissing = (e) => !!e && (e.code === "42P01" || e.code === "42883" || e.code === "PGRST205" || e.code === "PGRST202" || /does not exist|schema cache/i.test(e.message || ""));

function CabinetPlan({ count }) {
  const [st, setSt] = useState({ loading: true });
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const b = await supabase.from("cabinet_billing").select("*").maybeSingle();
        if (b.error) { if (!dead) setSt({ missing: true }); return; }
        const i = await supabase.from("cabinet_invoices").select("*").order("period", { ascending: false }).limit(24);
        if (!dead) setSt({ billing: b.data || null, invoices: (i && i.data) || [] });
      } catch (e) { if (!dead) setSt({ missing: true }); }
    })();
    return () => { dead = true; };
  }, []);
  const card = { background: "#EFE9DD", color: "#152238" };
  if (st.loading) return <div className="text-sm py-6 text-center" style={{ color: "#8A97B5" }}>Chargement…</div>;
  if (st.missing) return <div className="rounded-lg p-4 text-sm" style={card} data-testid="cab-plan-missing">Le forfait Cabinet n'est pas encore disponible sur votre compte. Contactez le support.</div>;
  const b = st.billing;
  if (!b) return <div className="rounded-lg p-4 text-sm" style={card} data-testid="cab-plan-none">Votre forfait n'est pas encore configuré. L'équipe Compta+ vous contactera pour convenir des conditions de votre cabinet.</div>;
  const today = new Date().toISOString().slice(0, 10);
  const est = cbillEstimate(b, count, today);
  const unit = cbillNum(b.price_per_company_usd), flat = cbillNum(b.monthly_flat_usd);
  const pilotOn = b.status === "pilote" && b.pilot_ends_at && String(b.pilot_ends_at) >= today;
  return (
    <div className="space-y-3" data-testid="cab-plan">
      <div className="rounded-lg p-4" style={card}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="font-semibold">Forfait Cabinet</div>
          <span className="text-xs px-2 py-0.5 rounded-full" data-testid="cab-plan-status" style={b.status === "suspendu" ? { background: "#F7E9E3", color: "#A6432F" } : { background: "#E6F1EE", color: "#0F6B5C" }}>{CBILL_STATUS[b.status] || b.status}</span>
        </div>
        <div className="text-sm mt-2 space-y-1" style={{ color: "#4A4636" }}>
          {pilotOn && <div data-testid="cab-plan-pilot">Période pilote : gratuite jusqu'au {b.pilot_ends_at}.</div>}
          <div>Dossiers suivis : <b data-testid="cab-plan-count">{count}</b></div>
          <div data-testid="cab-plan-tarif">{unit === null && flat === null ? "Tarif à convenir avec l'équipe." : `Tarif : ${flat !== null ? cbillMoney(flat) + " par mois" : ""}${flat !== null && unit !== null ? " + " : ""}${unit !== null ? cbillMoney(unit) + " par dossier suivi" : ""}.`}</div>
          {est !== null && <div>Estimation du mois : <b data-testid="cab-plan-est">{cbillMoney(est)}</b></div>}
        </div>
      </div>
      <div className="rounded-lg p-4" style={card}>
        <div className="font-semibold mb-2">Relevés mensuels</div>
        {st.invoices.length === 0 ? <div className="text-sm" style={{ color: "#7A7460" }} data-testid="cab-plan-noinv">Aucun relevé pour le moment.</div> : (
          <div className="space-y-1" data-testid="cab-plan-invoices">
            {st.invoices.map((r) => (
              <div key={r.id || r.period} className="flex items-center justify-between gap-2 text-sm" data-testid="cab-plan-inv">
                <span>{r.period} · {r.companies_count} dossier{r.companies_count > 1 ? "s" : ""}</span>
                <span>{cbillMoney(r.amount_usd)} · {CBILL_INV_STATUS[r.status] || r.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CabinetRequestsPanel({ currentUserEmail, logActivity }) {
  const [rows, setRows] = useState(null); // null = chargement ; "missing" = table absente
  const [msg, setMsg] = useState("");
  const load = async () => {
    try {
      const { data, error } = await supabase.from("cabinets").select("*").order("created_at", { ascending: false });
      if (error) { setRows(/cabinets|schema cache|does not exist/i.test(String(error.message || "")) || error.code === "42P01" ? "missing" : []); return; }
      setRows(data || []);
    } catch (e) { setRows([]); }
  };
  useEffect(() => { load(); }, []);
  const decide = async (c, status) => {
    const label = { active: "valider", refused: "refuser", suspended: "suspendre" }[status];
    if (!window.confirm(`${label.charAt(0).toUpperCase() + label.slice(1)} le cabinet « ${c.name} » (${c.owner_email}) ?`)) return;
    const { error } = await supabase.from("cabinets").update({ status, decided_at: new Date().toISOString(), decided_by: currentUserEmail || null }).eq("id", c.id);
    if (error) { setMsg("Action impossible pour l'instant."); return; }
    if (status === "active") {
      // Forfait en pilote créé d'office (ignoré s'il existe déjà ou si la facturation n'est pas activée).
      try { await supabase.from("cabinet_billing").insert({ cabinet_email: String(c.owner_email).toLowerCase(), cabinet_name: c.name, status: "pilote" }); } catch (e) {}
    }
    try { logActivity && logActivity("cabinet_" + status, `${c.name} — ${c.owner_email}`); } catch (e) {}
    setMsg(status === "active" ? "Cabinet validé." : status === "refused" ? "Demande refusée." : "Cabinet suspendu.");
    load();
  };
  if (rows === null) return null;
  if (rows === "missing") return <div className="bg-white rounded-lg p-4 text-xs" style={{ border: "1px solid #E4DFD1", color: "#7A7460" }} data-testid="cabreq-missing">L'inscription autonome des cabinets n'est pas encore activée : exécutez le script cabinets-autonomes-migration.sql.</div>;
  const pending = rows.filter((r) => r.status === "pending");
  const others = rows.filter((r) => r.status !== "pending");
  const ST = { active: ["Validé", "#E6F1EE", "#0F6B5C"], refused: ["Refusé", "#F7E9E3", "#A6432F"], suspended: ["Suspendu", "#FBF1DC", "#9A7B1E"] };
  const line = (c, withActions) => (
    <div key={c.id} data-testid="cabreq-row" data-status={c.status} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs px-2 py-1.5 rounded" style={{ border: "1px solid #F3EFE3", color: "#152238" }}>
      <span className="font-medium">{c.name}</span>
      <span style={{ color: "#8A8370", overflowWrap: "anywhere" }}>{c.owner_email}</span>
      {c.phone && <span style={{ color: "#8A8370" }}>{c.phone}</span>}
      {c.city && <span style={{ color: "#8A8370" }}>{c.city}</span>}
      <span style={{ color: "#A39C87" }}>{c.created_at ? new Date(c.created_at).toLocaleDateString("fr-FR") : ""}</span>
      {!withActions && ST[c.status] && <span className="px-1.5 py-0.5 rounded" style={{ background: ST[c.status][1], color: ST[c.status][2] }}>{ST[c.status][0]}</span>}
      <span className="flex-1" />
      {withActions && <button data-testid="cabreq-valider" onClick={() => decide(c, "active")} className="underline" style={{ color: "#0F6B5C" }}>Valider</button>}
      {withActions && <button data-testid="cabreq-refuser" onClick={() => decide(c, "refused")} className="underline" style={{ color: "#A6432F" }}>Refuser</button>}
      {!withActions && c.status === "active" && <button onClick={() => decide(c, "suspended")} className="underline" style={{ color: "#9A7B1E" }}>Suspendre</button>}
      {!withActions && c.status !== "active" && <button onClick={() => decide(c, "active")} className="underline" style={{ color: "#0F6B5C" }}>Réactiver</button>}
    </div>
  );
  return (
    <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #C9A24B" }} data-testid="cabreq-panel">
      <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Inscriptions de cabinets <span data-testid="cabreq-pending-count" style={{ color: "#8A8370", fontWeight: 400 }}>({pending.length} à valider)</span></div>
      <p className="text-xs mb-3" style={{ color: "#7A7460" }}>Les cabinets qui s'inscrivent seuls arrivent ici. À la validation, un forfait « pilote » est créé automatiquement.</p>
      {msg && <div className="text-xs mb-2" style={{ color: "#0F6B5C" }}>{msg}</div>}
      {pending.length === 0 ? <div className="text-xs mb-2" style={{ color: "#A39C87" }}>Aucune demande en attente.</div> : <div className="space-y-1 mb-3">{pending.map((c) => line(c, true))}</div>}
      {others.length > 0 && <div className="space-y-1">{others.map((c) => line(c, false))}</div>}
    </div>
  );
}

function CabinetBillingPanel() {
  const [st, setSt] = useState({ loading: true });
  const [edit, setEdit] = useState(null);
  const [msg, setMsg] = useState("");
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const load = async () => {
    try {
      const o = await supabase.rpc("cabinet_overview");
      if (o.error) { setSt(cbillMissing(o.error) ? { missing: true } : { error: true }); return; }
      const b = await supabase.from("cabinet_billing").select("*");
      const i = await supabase.from("cabinet_invoices").select("*").order("period", { ascending: false }).limit(200);
      if (b.error || i.error) { setSt(cbillMissing(b.error || i.error) ? { missing: true } : { error: true }); return; }
      setSt({ overview: o.data || [], billing: b.data || [], invoices: i.data || [] });
    } catch (e) { setSt({ error: true }); }
  };
  useEffect(() => { load(); }, []);
  const flashT = React.useRef(null);
  const flash = (m) => { setMsg(m); clearTimeout(flashT.current); flashT.current = setTimeout(() => setMsg(""), 3500); };
  if (st.loading) return <div className="text-sm py-6" style={{ color: "#7A7460" }}>Chargement…</div>;
  if (st.missing) return <div className="bg-white rounded-lg p-6 text-sm" style={{ border: "1px solid #E4DFD1", color: "#152238" }} data-testid="cbill-missing">La facturation des cabinets n'est pas encore activée. Exécutez le script forfait-cabinet-migration.sql dans Supabase, puis rechargez cette page.</div>;
  if (st.error) return <div className="bg-white rounded-lg p-6 text-sm" style={{ border: "1px solid #E4DFD1", color: "#A6432F" }}>Impossible de charger les cabinets pour l'instant. Réessayez dans un instant.</div>;
  const byEmail = {};
  st.overview.forEach((o) => { byEmail[String(o.cabinet_email).toLowerCase()] = { email: String(o.cabinet_email).toLowerCase(), count: o.companies_count }; });
  st.billing.forEach((r) => { const k = String(r.cabinet_email).toLowerCase(); byEmail[k] = { ...(byEmail[k] || { email: k, count: 0 }), b: r }; });
  const list = Object.values(byEmail).sort((a, b) => a.email.localeCompare(b.email));
  const today = new Date().toISOString().slice(0, 10);
  const save = async () => {
    const f = edit; if (!f) return;
    const unit = f.unit === "" ? null : Number(f.unit), flat = f.flat === "" ? null : Number(f.flat);
    if ((unit !== null && !(unit >= 0)) || (flat !== null && !(flat >= 0))) { flash("Les montants doivent être des nombres positifs."); return; }
    const row = { cabinet_name: f.name || null, status: f.status, pilot_ends_at: f.pilot || null, price_per_company_usd: unit, monthly_flat_usd: flat, updated_at: new Date().toISOString() };
    try {
      const ex = await supabase.from("cabinet_billing").select("cabinet_email").eq("cabinet_email", f.email).maybeSingle();
      const r = ex.data ? await supabase.from("cabinet_billing").update(row).eq("cabinet_email", f.email) : await supabase.from("cabinet_billing").insert({ cabinet_email: f.email, ...row });
      if (r.error) { flash("Enregistrement impossible pour l'instant."); return; }
      setEdit(null); flash("Forfait enregistré."); load();
    } catch (e) { flash("Enregistrement impossible pour l'instant."); }
  };
  const generate = async (email) => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) { flash("Mois invalide (format AAAA-MM)."); return; }
    try {
      const r = await supabase.rpc("cabinet_generate_statement", { p_email: email, p_period: period });
      if (r.error) { flash(/déjà payé/i.test(r.error.message || "") ? "Ce relevé est déjà payé." : /non configuré/i.test(r.error.message || "") ? "Configurez d'abord le forfait de ce cabinet." : "Relevé impossible pour l'instant."); return; }
      flash("Relevé généré."); load();
    } catch (e) { flash("Relevé impossible pour l'instant."); }
  };
  const setInv = async (inv, status) => {
    try {
      const r = await supabase.from("cabinet_invoices").update({ status, paid_at: status === "payee" ? new Date().toISOString() : null }).eq("id", inv.id);
      if (r.error) { flash("Mise à jour impossible pour l'instant."); return; }
      load();
    } catch (e) { flash("Mise à jour impossible pour l'instant."); }
  };
  const inp = "rounded px-2 py-1 text-sm w-full";
  const bd = { border: "1px solid #DDD6C4" };
  return (
    <div className="space-y-4" data-testid="cbill">
      <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
        <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Cabinets d'expertise comptable</div>
        <p className="text-xs mb-3" style={{ color: "#7A7460" }}>Un cabinet est reconnu à l'email de son compte. Le montant d'un relevé = forfait mensuel fixe + prix par dossier suivi × nombre de dossiers. Pendant le pilote, le relevé est à 0.</p>
        <div className="flex items-center gap-2 mb-3 text-xs" style={{ color: "#7A7460" }}>
          Mois des relevés :
          <input value={period} onChange={(e) => setPeriod(e.target.value)} data-testid="cbill-period" className="rounded px-2 py-1 text-sm" style={{ ...bd, width: 110 }} placeholder="AAAA-MM" />
        </div>
        {list.length === 0 ? <div className="text-xs" style={{ color: "#A39C87" }} data-testid="cbill-empty">Aucun cabinet pour le moment.</div> : (
          <div className="space-y-2">
            {list.map((c) => {
              const est = cbillEstimate(c.b, c.count, today);
              return (
                <div key={c.email} className="p-3 rounded" style={{ border: "1px solid #F0EDE3" }} data-testid={"cbill-row-" + c.email}>
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <div className="text-sm truncate" style={{ color: "#152238" }}>{(c.b && c.b.cabinet_name) || c.email}</div>
                      <div className="text-xs" style={{ color: "#A39C87" }}>{c.email} · {c.count} dossier{c.count > 1 ? "s" : ""} · {c.b ? (CBILL_STATUS[c.b.status] || c.b.status) : "Non configuré"}{est !== null ? ` · ${cbillMoney(est)} / mois` : ""}</div>
                    </div>
                    <div className="flex gap-3 shrink-0">
                      <button onClick={() => setEdit({ email: c.email, name: (c.b && c.b.cabinet_name) || "", status: (c.b && c.b.status) || "pilote", pilot: (c.b && c.b.pilot_ends_at) || "", unit: c.b && c.b.price_per_company_usd !== null && c.b.price_per_company_usd !== undefined ? String(c.b.price_per_company_usd) : "", flat: c.b && c.b.monthly_flat_usd !== null && c.b.monthly_flat_usd !== undefined ? String(c.b.monthly_flat_usd) : "" })} data-testid={"cbill-edit-" + c.email} className="text-xs underline" style={{ color: "#152238" }}>Forfait</button>
                      <button onClick={() => generate(c.email)} data-testid={"cbill-gen-" + c.email} className="text-xs underline" style={{ color: "#0F6B5C" }}>Générer le relevé</button>
                    </div>
                  </div>
                  {st.invoices.filter((r) => String(r.cabinet_email).toLowerCase() === c.email).slice(0, 6).map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-2 text-xs mt-1" data-testid="cbill-inv" style={{ color: "#4A4636" }}>
                      <span>{r.period} · {r.companies_count} dossier{r.companies_count > 1 ? "s" : ""} · {cbillMoney(r.amount_usd)} · <b>{CBILL_INV_STATUS[r.status] || r.status}</b></span>
                      <span className="flex gap-2">
                        {r.status === "a_payer" && <button onClick={() => setInv(r, "payee")} data-testid="cbill-paid" className="underline" style={{ color: "#0F6B5C" }}>Marquer payé</button>}
                        {r.status === "a_payer" && <button onClick={() => setInv(r, "annulee")} className="underline" style={{ color: "#A6432F" }}>Annuler</button>}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {edit && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #C9A24B" }} data-testid="cbill-form">
          <div className="text-sm font-medium mb-3" style={{ color: "#152238" }}>Forfait de {edit.email}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs" style={{ color: "#7A7460" }}>Nom du cabinet<input className={inp} style={bd} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} data-testid="cbill-f-name" /></label>
            <label className="text-xs" style={{ color: "#7A7460" }}>Statut
              <select className={inp} style={bd} value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })} data-testid="cbill-f-status">
                <option value="pilote">Pilote</option><option value="actif">Actif</option><option value="suspendu">Suspendu</option>
              </select></label>
            <label className="text-xs" style={{ color: "#7A7460" }}>Fin du pilote<input type="date" className={inp} style={bd} value={edit.pilot} onChange={(e) => setEdit({ ...edit, pilot: e.target.value })} data-testid="cbill-f-pilot" /></label>
            <label className="text-xs" style={{ color: "#7A7460" }}>Forfait mensuel fixe (USD)<input inputMode="decimal" className={inp} style={bd} value={edit.flat} onChange={(e) => setEdit({ ...edit, flat: e.target.value })} data-testid="cbill-f-flat" /></label>
            <label className="text-xs" style={{ color: "#7A7460" }}>Prix par dossier suivi (USD)<input inputMode="decimal" className={inp} style={bd} value={edit.unit} onChange={(e) => setEdit({ ...edit, unit: e.target.value })} data-testid="cbill-f-unit" /></label>
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={save} data-testid="cbill-save" className="px-3 py-1.5 rounded text-sm" style={{ background: "#152238", color: "#fff" }}>Enregistrer</button>
            <button onClick={() => setEdit(null)} className="text-sm underline" style={{ color: "#7A7460" }}>Annuler</button>
          </div>
        </div>
      )}
      {msg && <div className="text-sm" style={{ color: "#0F6B5C" }} data-testid="cbill-msg">{msg}</div>}
    </div>
  );
}
// ===== fin K:CBILL =====

function CabinetSpace({ options, onOpen, onSignOut, showToast }) {
  const [baseRows, setRows] = useState(null);
  const [openMap, setOpenMap] = useState(null); // remarques ouvertes par dossier, rafraîchi après chaque ajout / résolution
  const refreshCounts = async () => {
    try {
      const r = await supabase.from("compta_comments").select("company_id, status").in("company_id", options.map((o) => o.companyId)).eq("status", "ouvert");
      if (r.error || !r.data) return;
      const m = {}; r.data.forEach((c) => { m[c.company_id] = (m[c.company_id] || 0) + 1; });
      setOpenMap(m);
    } catch (e) { /* ignoré */ }
  };
  const rows = baseRows === null ? null : (openMap ? cabSort(baseRows.map((r) => ({ ...r, openComments: openMap[r.companyId] || 0 }))) : baseRows);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("dossiers");
  const dataRef = React.useRef({});
  const [flash, setFlash] = useState("");
  const toast = (m) => { setFlash(m); setTimeout(() => setFlash(""), 3500); };
  useEffect(() => {
    let dead = false;
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const ids = options.map((o) => o.companyId);
      let comments = [];
      try { const r = await supabase.from("compta_comments").select("company_id, status").in("company_id", ids).eq("status", "ouvert"); if (!r.error && r.data) comments = r.data; } catch (e) { /* table absente : pas de remarques */ }
      const plans = {};
      try { const r = await supabase.from("companies").select("id, plan_status").in("id", ids); (r.data || []).forEach((c) => { plans[c.id] = c.plan_status; }); } catch (e) { /* ignoré */ }
      const out = await Promise.all(options.map(async (o) => {
        let entries = [], accounts = [], settings = {}, failed = false;
        try {
          const { data, error } = await supabase.from("kv_store").select("key, value").eq("company_id", o.companyId).in("key", ["compta-entries", "compta-accounts", "compta-settings"]);
          if (error) failed = true;
          (data || []).forEach((r) => {
            try {
              const d = unwrapVersioned(JSON.parse(r.value)).data;
              if (r.key === "compta-entries" && Array.isArray(d)) entries = d;
              if (r.key === "compta-accounts" && Array.isArray(d)) accounts = d;
              if (r.key === "compta-settings" && d && typeof d === "object") settings = d;
            } catch (e) { failed = true; }
          });
        } catch (e) { failed = true; }
        dataRef.current[o.companyId] = { entries, accounts, settings };
        const s = cabSummarize(entries, settings, comments.filter((c) => c.company_id === o.companyId).length, today);
        return { ...o, ...s, failed, checks: ecChecks(accounts, entries), planStatus: plans[o.companyId] };
      }));
      if (!dead) setRows(cabSort(out));
    })();
    return () => { dead = true; };
  }, []);
  const exportCsv = (r, kind) => {
    const d = dataRef.current[r.companyId] || { entries: [], accounts: [], settings: {} };
    const co = String(r.name || "dossier").replace(/\s+/g, "");
    const day = new Date().toISOString().slice(0, 10);
    if (kind === "journal") ecDownloadCsv(`journal-normalise-${co}-${day}.csv`, ecCsv(EC_JOURNAL_COLS, ecJournalRows(d.entries, d.accounts, d.settings && d.settings.currency)));
    else if (kind === "balance") ecDownloadCsv(`balance-${co}-${day}.csv`, ecCsv(EC_BALANCE_COLS, ecBalanceRows(d.accounts, d.entries)));
    else ecDownloadCsv(`plan-comptable-${co}-${day}.csv`, ecCsv(EC_PLAN_COLS, ecPlanRows(d.accounts)));
    toast("Export généré.");
  };
  const shown = (rows || []).filter((r) => String(r.name || "").toLowerCase().includes(q.toLowerCase()));
  const totalComments = (rows || []).reduce((t, r) => t + r.openComments, 0);
  const staleCount = (rows || []).filter((r) => r.stale).length;
  const anomalies = (c) => (c.balanced ? 0 : 1) + c.unbalancedEntries + c.unknownAccounts.length + c.noDate;
  const tabBtn = (id, label) => (
    <button key={id} onClick={() => setTab(id)} data-testid={"cab-tab-" + id} className="px-3 py-1.5 rounded text-sm" style={{ background: tab === id ? "#C9A24B" : "rgba(239,233,221,0.12)", color: tab === id ? "#152238" : "#EFE9DD" }}>{label}</button>
  );
  return (
    <div className="min-h-screen p-4 md:p-8" style={{ background: "#152238", fontFamily: "'Source Sans Pro', 'Inter', sans-serif" }}>
      <div className="max-w-3xl mx-auto" data-testid="cabinet-space">
        <div className="text-xs uppercase tracking-widest mb-1" style={{ color: "#C9A24B" }}>Compta+ — Espace Cabinet</div>
        <div className="display text-3xl mb-1" style={{ color: "#EFE9DD" }}>Vos dossiers clients</div>
        <p className="text-sm mb-4" style={{ color: "#8A97B5" }}>Consultation en lecture seule : vous contrôlez les comptes de vos clients, vous exportez leurs états et vous leur laissez vos remarques, sans jamais rien modifier chez eux.</p>
        {rows === null ? (
          <div className="text-sm py-8 text-center" style={{ color: "#8A97B5" }}>Chargement des dossiers…</div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="rounded-lg p-3 text-center" style={{ background: "#EFE9DD" }}><div className="text-xl tabular font-semibold" style={{ color: "#152238" }} data-testid="cab-total">{rows.length}</div><div className="text-xs" style={{ color: "#7A7460" }}>Dossiers</div></div>
              <div className="rounded-lg p-3 text-center" style={{ background: "#EFE9DD" }}><div className="text-xl tabular font-semibold" style={{ color: totalComments ? "#A6432F" : "#0F6B5C" }} data-testid="cab-comments">{totalComments}</div><div className="text-xs" style={{ color: "#7A7460" }}>Remarques ouvertes</div></div>
              <div className="rounded-lg p-3 text-center" style={{ background: "#EFE9DD" }}><div className="text-xl tabular font-semibold" style={{ color: staleCount ? "#A6432F" : "#0F6B5C" }} data-testid="cab-stale">{staleCount}</div><div className="text-xs" style={{ color: "#7A7460" }}>Sans saisie depuis 30 j</div></div>
            </div>
            <div className="flex gap-2 mb-4">{tabBtn("dossiers", "Dossiers")}{tabBtn("remarques", "Remarques")}{tabBtn("forfait", "Mon forfait")}</div>
            {tab === "remarques" ? <CabinetRemarks rows={rows} showToast={toast} onChange={refreshCounts} /> : tab === "forfait" ? <CabinetPlan count={rows.length} /> : (
              <>
                {rows.length > 6 && (
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un dossier…" className="w-full rounded px-3 py-2 text-sm mb-3" style={{ border: "1px solid #DDD6C4" }} />
                )}
                <div className="grid gap-3">
                  {shown.map((r) => {
                    const an = anomalies(r.checks);
                    return (
                      <div key={r.companyId} className="rounded-lg p-4" style={{ background: "#EFE9DD" }} data-testid={"cab-row-" + r.companyId}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-semibold" style={{ color: "#152238", overflowWrap: "anywhere" }}>{r.name}</div>
                            <div className="text-xs mt-1 flex flex-wrap gap-x-3 gap-y-1" style={{ color: "#7A7460" }}>
                              <span>{r.count} écriture{r.count > 1 ? "s" : ""}</span>
                              <span>{r.monthCount} ce mois-ci</span>
                              <span>{r.lastDate ? `dernière saisie le ${r.lastDate}` : "aucune écriture"}</span>
                              <span>{r.lockDate ? `clôturé jusqu'au ${r.lockDate}` : "aucune clôture"}</span>
                            </div>
                            <div className="flex flex-wrap gap-2 mt-2">
                              {!r.failed && <span className="text-xs px-2 py-0.5 rounded-full" data-testid={"cab-chk-" + r.companyId} style={an ? { background: "#F7E9E3", color: "#A6432F" } : { background: "#E6F1EE", color: "#0F6B5C" }}>{an ? `${an} anomalie${an > 1 ? "s" : ""} à contrôler` : "Contrôles OK"}</span>}
                              {r.openComments > 0 && <span className="text-xs px-2 py-0.5 rounded-full text-white" style={{ background: "#D9756B" }}>{r.openComments} remarque{r.openComments > 1 ? "s" : ""} ouverte{r.openComments > 1 ? "s" : ""}</span>}
                              {r.stale && <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "#F7E9E3", color: "#A6432F" }}>Pas de saisie depuis {r.daysSince} jours</span>}
                              {r.failed && <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "#F3EFE3", color: "#7A7460" }}>Données indisponibles pour l'instant</span>}
                              {r.planStatus === "suspended" && <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "#F3EFE3", color: "#7A7460" }}>Abonnement du client suspendu</span>}
                            </div>
                            {!r.failed && (
                              <div className="flex flex-wrap gap-2 mt-3" data-ro-ok="1">
                                <button onClick={() => exportCsv(r, "journal")} data-testid={"cab-exp-journal-" + r.companyId} className="text-xs px-2 py-1 rounded" style={{ border: "1px solid #C9BFA4", color: "#152238" }}>Journal (CSV)</button>
                                <button onClick={() => exportCsv(r, "balance")} data-testid={"cab-exp-balance-" + r.companyId} className="text-xs px-2 py-1 rounded" style={{ border: "1px solid #C9BFA4", color: "#152238" }}>Balance (CSV)</button>
                                <button onClick={() => exportCsv(r, "plan")} className="text-xs px-2 py-1 rounded" style={{ border: "1px solid #C9BFA4", color: "#152238" }}>Plan comptable (CSV)</button>
                              </div>
                            )}
                          </div>
                          <button onClick={() => onOpen(r.companyId)} data-testid={"cab-open-" + r.companyId} className="px-3 py-1.5 rounded text-sm shrink-0" style={{ background: "#152238", color: "#EFE9DD" }}>Ouvrir</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
        <button onClick={onSignOut} className="mt-6 text-xs underline block" style={{ color: "#8A97B5" }}>Se déconnecter</button>
        {flash && <div className="fixed bottom-6 right-6 px-4 py-3 rounded shadow-lg text-sm" data-testid="cab-flash" style={{ background: "#EFE9DD", color: "#152238", border: "1px solid #C9A24B" }}>{flash}</div>}
      </div>
    </div>
  );
}

function SupervisionPanel({ companies, activity, payments }) {
  const [errs, setErrs] = useState(null); // null = chargement ; {rows} | {error}
  const [fails, setFails] = useState(null);
  const [att, setAtt] = useState(null);
  const [integ, setInteg] = useState(null); // null = pas lancé
  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - 7 * 86400000).toISOString();
      try {
        const r = await supabase.from("error_logs").select("message, created_at, company_id").gte("created_at", since).order("created_at", { ascending: false }).limit(300);
        setErrs(r.error ? { error: true } : { rows: r.data || [] });
      } catch (e) { setErrs({ error: true }); }
      try {
        const r = await supabase.from("signup_failures").select("created_at").gte("created_at", since).limit(200);
        setFails(r.error ? { error: true } : { rows: r.data || [] });
      } catch (e) { setFails({ error: true }); }
      try {
        const r = await supabase.rpc("attachments_usage");
        setAtt(r.error ? { error: true } : { rows: r.data || [] });
      } catch (e) { setAtt({ error: true }); }
    })();
  }, []);
  const runIntegrity = async () => {
    setInteg({ loading: true });
    try {
      const r = await supabase.rpc("rel_check_all");
      setInteg(r.error ? { error: true } : { rows: r.data || [] });
    } catch (e) { setInteg({ error: true }); }
  };
  const nameOf = (id) => ((companies || []).find((c) => c.id === id) || {}).name || "(entreprise)";
  const f = funnelStats(companies || [], activity || {}, payments || [], Date.now());
  const pct = (a, b) => (b ? Math.round((a * 100) / b) + " %" : "—");
  const steps = [
    ["Inscriptions", f.signups, "100 %"],
    ["Ont commencé à saisir (facture, achat ou écriture)", f.started, pct(f.started, f.signups)],
    ["Ont émis au moins une facture", f.invoiced, pct(f.invoiced, f.signups)],
    ["Données encore modifiées après 30 jours (comptes de plus d'un mois : " + f.matured + ")", f.retained, pct(f.retained, f.matured)],
    ["Ont réglé au moins un abonnement", f.paid, pct(f.paid, f.signups)],
  ];
  const errCount24 = errs && errs.rows ? errs.rows.filter((e) => Date.now() - Date.parse(e.created_at) < 86400000).length : null;
  const topErrs = (() => {
    if (!errs || !errs.rows) return [];
    const m = {};
    errs.rows.forEach((e) => { const k = String(e.message || "").slice(0, 120); m[k] = (m[k] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 5);
  })();
  const attRows = att && att.rows ? att.rows.map((r) => ({ ...r, status: supAttStatus(r.att_count, r.att_bytes) })).filter((r) => r.status !== "ok").sort((a, b) => b.att_count - a.att_count) : [];
  const box = { background: "#fff", border: "1px solid #E4DFD1" };
  const Unavail = () => <div className="text-xs" style={{ color: "#8A8370" }}>Mesure non activée : exécutez le script supervision-migration.sql.</div>;
  return (
    <div className="space-y-4" data-testid="supervision">
      <div className="rounded-lg p-5" style={box} data-testid="sup-funnel">
        <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Parcours d'inscription</div>
        <p className="text-xs mb-3" style={{ color: "#8A8370" }}>Calculé sur toutes les entreprises, à partir des données déjà présentes. Les entreprises de démonstration y sont comptées.</p>
        <table className="w-full text-sm">
          <tbody>
            {steps.map(([label, n, p]) => (
              <tr key={label} style={{ borderTop: "1px solid #F3EFE3" }}>
                <td className="py-1.5" style={{ color: "#152238" }}>{label}</td>
                <td className="py-1.5 tabular text-right" data-testid={"fun-" + label.slice(0, 6)}>{n}</td>
                <td className="py-1.5 tabular text-right" style={{ color: "#8A8370", width: 64 }}>{p}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {f.medianPayDays !== null && <div className="text-xs mt-2" style={{ color: "#8A8370" }}>Délai médian entre l'inscription et le premier paiement : {f.medianPayDays} jour{f.medianPayDays > 1 ? "s" : ""}.</div>}
        {f.cohorts.length > 0 && (
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-xs">
              <thead><tr className="text-left" style={{ color: "#8A8370" }}><th className="py-1 font-normal">Mois d'inscription</th><th className="py-1 font-normal text-right">Inscrits</th><th className="py-1 font-normal text-right">Ont facturé</th><th className="py-1 font-normal text-right">Ont payé</th></tr></thead>
              <tbody>
                {f.cohorts.map((c) => (
                  <tr key={c.month} style={{ borderTop: "1px solid #F3EFE3" }}><td className="py-1 tabular">{c.month}</td><td className="py-1 tabular text-right">{c.signups}</td><td className="py-1 tabular text-right">{c.invoiced}</td><td className="py-1 tabular text-right">{c.paid}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-lg p-5" style={box} data-testid="sup-health">
        <div className="text-sm font-medium mb-3" style={{ color: "#152238" }}>Santé de la plateforme (7 derniers jours)</div>
        <div className="grid sm:grid-cols-3 gap-3 mb-3">
          <div className="rounded p-3" style={{ background: "#FAF8F1" }}>
            <div className="text-xl tabular font-semibold" style={{ color: errCount24 ? "#A6432F" : "#0F6B5C" }} data-testid="sup-err24">{errs === null ? "…" : errs.error ? "—" : errCount24}</div>
            <div className="text-xs" style={{ color: "#7A7460" }}>Erreurs en 24 h{errs && errs.rows ? ` (${errs.rows.length} sur 7 jours)` : ""}</div>
          </div>
          <div className="rounded p-3" style={{ background: "#FAF8F1" }}>
            <div className="text-xl tabular font-semibold" style={{ color: fails && fails.rows && fails.rows.length ? "#A6432F" : "#0F6B5C" }} data-testid="sup-fails">{fails === null ? "…" : fails.error ? "—" : fails.rows.length}</div>
            <div className="text-xs" style={{ color: "#7A7460" }}>Inscriptions échouées</div>
          </div>
          <div className="rounded p-3" style={{ background: "#FAF8F1" }}>
            {integ === null ? (
              <button onClick={runIntegrity} data-testid="sup-integ-run" className="text-xs px-2 py-1 rounded" style={{ background: "#152238", color: "#EFE9DD" }}>Lancer le contrôle</button>
            ) : integ.loading ? <div className="text-xs" style={{ color: "#8A8370" }}>Contrôle en cours…</div> : integ.error ? <div className="text-xs" style={{ color: "#8A8370" }}>Contrôle indisponible.</div> : (
              <div className="text-xl tabular font-semibold" style={{ color: integ.rows.some((r) => r.ecarts > 0 || Number(r.erreurs_recopie) > 0) ? "#A6432F" : "#0F6B5C" }} data-testid="sup-integ-result">{integ.rows.filter((r) => r.ecarts > 0 || Number(r.erreurs_recopie) > 0).length}</div>
            )}
            <div className="text-xs" style={{ color: "#7A7460" }}>{integ && integ.rows ? "Entreprises avec écart" : "Intégrité des données"}</div>
          </div>
        </div>
        {errs && errs.error && <Unavail />}
        {topErrs.length > 0 && (
          <div className="text-xs" style={{ color: "#152238" }}>
            <div className="mb-1" style={{ color: "#8A8370" }}>Erreurs les plus fréquentes</div>
            {topErrs.map(([m, n]) => <div key={m} className="py-0.5" style={{ overflowWrap: "anywhere" }}><span className="tabular" style={{ color: "#A6432F" }}>{n}×</span> {m}</div>)}
          </div>
        )}
      </div>

      <div className="rounded-lg p-5" style={box} data-testid="sup-att">
        <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Pièces justificatives</div>
        <p className="text-xs mb-3" style={{ color: "#8A8370" }}>Plafond du stockage intégré : {SUP_ATT_MAX_COUNT} pièces et 8 Mo par entreprise. Au-delà, les nouvelles pièces partent automatiquement dans le stockage de fichiers dédié ; ces entreprises restent listées ici tant que leur stockage intégré est plein.</p>
        {att === null ? <div className="text-xs" style={{ color: "#8A8370" }}>Chargement…</div> : att.error ? <Unavail /> : attRows.length === 0 ? (
          <div className="text-sm" style={{ color: "#0F6B5C" }} data-testid="sup-att-none">Aucune entreprise proche du plafond ({att.rows.length} entreprise{att.rows.length > 1 ? "s" : ""} avec des pièces).</div>
        ) : (
          <table className="w-full text-xs">
            <thead><tr className="text-left" style={{ color: "#8A8370" }}><th className="py-1 font-normal">Entreprise</th><th className="py-1 font-normal text-right">Pièces</th><th className="py-1 font-normal text-right">Taille</th><th className="py-1 font-normal text-right">État</th></tr></thead>
            <tbody>
              {attRows.map((r) => (
                <tr key={r.company_id} style={{ borderTop: "1px solid #F3EFE3" }} data-testid="sup-att-row">
                  <td className="py-1">{nameOf(r.company_id)}</td>
                  <td className="py-1 tabular text-right">{r.att_count}</td>
                  <td className="py-1 tabular text-right">{(Number(r.att_bytes) / 1048576).toFixed(1)} Mo</td>
                  <td className="py-1 text-right" style={{ color: r.status === "plein" ? "#A6432F" : "#9A7B1E" }}>{r.status === "plein" ? "Plafond atteint" : "Proche du plafond"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

