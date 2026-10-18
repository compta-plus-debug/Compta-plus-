// ═══ MODULE ═══
// @module Super Admin
// @depends FALLBACK_HTG_PER_USD, NET_MSG, PAYMENT_METHODS, SimpleDonutChart, SimpleLineChart, fetchHtgPerUsd, friendlyError, isFutureDate, monthLabel, periodLabel, supabase, todayStr, useEffect, useState
// @exports SuperAdminModule
function SuperAdminModule({ showToast }) {
  const [tab, setTab] = useState("dashboard"); // dashboard | entreprises | rapports | erreurs
  const [errorLogs, setErrorLogs] = useState(null); // null = pas encore chargé
  const [relAll, setRelAll] = useState(null); // null = pas lancé ; {loading} | {rows} | {error}
  const [relDetail, setRelDetail] = useState({}); // company_id -> lignes de détail
  const [signupFailures, setSignupFailures] = useState(null); // null = pas encore chargé
  const [trialSignups, setTrialSignups] = useState(null); // essais gratuits (anti-abus serveur)
  const [trialOnlyBlocked, setTrialOnlyBlocked] = useState(false);
  const [superLog, setSuperLog] = useState(null); // journal des actions Super Admin
  const [logFilter, setLogFilter] = useState("");
  const [logSearch, setLogSearch] = useState("");
  const [trialActivity, setTrialActivity] = useState(null); // activité réelle par entreprise (suivi des essais)
  const [rapPeriod, setRapPeriod] = useState("annee"); // mois | trimestre | annee | tout
  const [rapGroupBy, setRapGroupBy] = useState("mois"); // mois | trimestre | annee
  const [rapCurrency, setRapCurrency] = useState(""); // "" = toutes
  const [companies, setCompanies] = useState(null); // null = en cours de chargement
  const [openId, setOpenId] = useState(null);
  const [payments, setPayments] = useState({}); // companyId -> liste de paiements (détail par entreprise)
  const [allPayments, setAllPayments] = useState(null); // null = en cours de chargement — tous les paiements, toutes entreprises confondues, pour le tableau de bord
  const [form, setForm] = useState({ method: "moncash", amount: "", currency: "HTG", date: todayStr(), reference: "", note: "", durationDays: 30 });
  // Taux de conversion USD→HTG, même mécanisme que le paiement MonCash du forfait
  // Standard côté client — sert à pré-remplir automatiquement le montant en gourdes
  // pour les deux forfaits (Standard 20 $ / Assisté 80 $), en restant modifiable.
  const [htgRate, setHtgRate] = useState(null);
  useEffect(() => { fetchHtgPerUsd().then((rate) => setHtgRate(rate)); }, []);
  const usdToHtg = (usd) => Math.round((usd * (htgRate || FALLBACK_HTG_PER_USD)) / 10) * 10;
  const [q, setQ] = useState("");
  const [histFrom, setHistFrom] = useState("");
  const [histTo, setHistTo] = useState("");
  const [histCompanyFilter, setHistCompanyFilter] = useState("");

  const [members, setMembers] = useState([]);

  const loadCompanies = async () => {
    let { data, error } = await supabase.from("companies").select("id, name, plan_status, plan_tier, trial_ends_at, created_at, signup_device_id, group_id").order("created_at", { ascending: false });
    if (error && error.code === "42703") {
      // Colonne signup_device_id ou group_id pas encore migrée : repli sans elles
      // plutôt que de casser tout le panneau Super Admin.
      const retry = await supabase.from("companies").select("id, name, plan_status, trial_ends_at, created_at").order("created_at", { ascending: false });
      data = retry.data; error = retry.error;
    }
    if (error) { showToast("Impossible de charger les entreprises."); setCompanies([]); return; }
    setCompanies(data || []);
  };

  // Chargée spécifiquement pour identifier l'administrateur principal de chaque
  // entreprise — nécessaire pour définir le propriétaire d'un nouveau groupe
  // multi-entreprises (voir createGroupForCompany ci-dessous).
  const loadMembers = async () => {
    const { data, error } = await supabase.from("company_members").select("company_id, email, user_id, is_primary_admin");
    if (error) { setMembers([]); return; }
    setMembers(data || []);
  };

  const loadAllPayments = async () => {
    const { data, error } = await supabase.from("payments").select("*").order("date", { ascending: false });
    if (error) { setAllPayments([]); return; }
    setAllPayments(data || []);
  };

  const loadErrorLogs = async () => {
    const { data, error } = await supabase.from("error_logs").select("*").order("created_at", { ascending: false }).limit(200);
    if (error) { setErrorLogs([]); return; }
    setErrorLogs(data || []);
  };

  const runRelCheck = async () => {
    setRelAll({ loading: true });
    try {
      const { data, error } = await supabase.rpc("rel_check_all");
      if (error) { setRelAll({ error: "Le contrôle n'est pas disponible pour le moment." }); return; }
      setRelAll({ rows: data || [] });
    } catch (e) { setRelAll({ error: "Le contrôle n'est pas disponible pour le moment." }); }
  };
  const loadRelDetail = async (cid) => {
    try {
      const { data, error } = await supabase.rpc("rel_check", { cid });
      setRelDetail((d) => ({ ...d, [cid]: error ? [] : (data || []) }));
    } catch (e) { setRelDetail((d) => ({ ...d, [cid]: [] })); }
  };

  const loadSignupFailures = async () => {
    const { data, error } = await supabase.from("signup_failures").select("*").order("created_at", { ascending: false }).limit(200);
    if (error) { setSignupFailures([]); return; }
    setSignupFailures(data || []);
  };

  const loadTrialSignups = async () => {
    const { data, error } = await supabase.from("trial_signups").select("*").order("created_at", { ascending: false }).limit(300);
    if (error) { setTrialSignups([]); return; }
    setTrialSignups(data || []);
  };
  // Journal des actions Super Admin : chaque action sensible laisse une trace
  // (qui, quoi, quelle entreprise, quand). Silencieux si la table n'existe pas encore.
  const logSA = async (actionType, company, details) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const entry = { actor_email: user?.email || null, action_type: actionType, company_id: company?.id || null, target_description: company?.name || null, details: details || null };
      const { data, error } = await supabase.from("superadmin_log").insert(entry).select("*");
      if (error) return;
      const row = { ...entry, id: "tmp" + Date.now(), created_at: new Date().toISOString(), ...((data && data[0]) || {}) };
      setSuperLog((prev) => (prev ? [row, ...prev] : prev));
    } catch (e) { /* le journal ne doit jamais bloquer une action */ }
  };
  const loadSuperLog = async () => {
    const { data, error } = await supabase.from("superadmin_log").select("*").order("created_at", { ascending: false }).limit(500);
    if (error) { setSuperLog([]); return; }
    setSuperLog(data || []);
  };
  const loadTrialActivity = async () => {
    try {
      const r = await supabase.rpc("company_activity_summary");
      if (r.error || !r.data) { setTrialActivity({}); return; }
      setTrialActivity(Object.fromEntries(r.data.map((a) => [a.company_id, a])));
    } catch (e) { setTrialActivity({}); }
  };
  const extendTrial = async (co, days) => {
    if (!window.confirm(`Prolonger l'essai de « ${co.name} » de ${days} jours à partir d'aujourd'hui ?`)) return;
    const end = new Date(); end.setDate(end.getDate() + days);
    const trialEndsAt = end.toISOString().slice(0, 10);
    const { error } = await supabase.from("companies").update({ plan_status: "trial", trial_ends_at: trialEndsAt }).eq("id", co.id);
    if (error) { showToast("Échec de la prolongation."); return; }
    setCompanies((prev) => prev.map((c) => (c.id === co.id ? { ...c, plan_status: "trial", trial_ends_at: trialEndsAt } : c)));
    logSA("essai_prolonge", co, `+${days} jours → jusqu'au ${trialEndsAt}`);
    showToast(`Essai prolongé jusqu'au ${trialEndsAt}.`);
  };
  const forgetTrial = async (t) => {
    if (!window.confirm(`Oublier cet essai (${t.email_raw || t.email_normalized}) ?\n\nIl ne comptera plus dans la limite de 2 essais par adresse email.`)) return;
    const { error } = await supabase.from("trial_signups").delete().eq("id", t.id);
    if (error) { showToast("Action impossible pour le moment."); return; }
    showToast("Essai oublié.");
    logSA("essai_oublie", { id: t.company_id, name: t.company_name }, `${t.email_raw || t.email_normalized} (${t.outcome})`);
    loadTrialSignups();
  };
  useEffect(() => { loadCompanies(); loadAllPayments(); loadMembers(); }, []);
  // Chargé seulement à la première ouverture de l'onglet, pas systématiquement —
  // ces journaux ne sont consultés qu'occasionnellement, contrairement au
  // tableau de bord et aux entreprises.
  useEffect(() => { if (tab === "erreurs" && errorLogs === null) loadErrorLogs(); }, [tab]);
  useEffect(() => { if (tab === "inscriptions" && signupFailures === null) loadSignupFailures(); }, [tab]);
  useEffect(() => { if (tab === "inscriptions" && trialSignups === null) loadTrialSignups(); }, [tab]);
  useEffect(() => { if ((tab === "journal" || tab === "suivi") && superLog === null) loadSuperLog(); }, [tab]);
  useEffect(() => { if (tab === "suivi" && trialActivity === null) loadTrialActivity(); }, [tab]);

  const loadPayments = async (companyId) => {
    const { data } = await supabase.from("payments").select("*").eq("company_id", companyId).order("date", { ascending: false });
    setPayments((p) => ({ ...p, [companyId]: data || [] }));
  };

  const toggleOpen = (co) => {
    if (openId === co.id) { setOpenId(null); return; }
    setOpenId(co.id);
    // Montant pré-rempli automatiquement selon le forfait actif de l'entreprise
    // (80 $ Assisté / 20 $ Standard), converti en gourdes au taux de référence —
    // même mécanisme que le paiement MonCash du forfait Standard côté client.
    // Reste librement modifiable si le montant réellement reçu diffère.
    const priceUSD = co.group_id ? 350 : co.plan_tier === "assisted" ? 80 : 20;
    setForm({ method: "moncash", amount: String(usdToHtg(priceUSD)), currency: "HTG", date: todayStr(), reference: "", note: "", durationDays: 30 });
    if (!payments[co.id]) loadPayments(co.id);
  };

  const setStatus = async (co, status) => {
    const updates = { plan_status: status };
    // "Marquer actif" fixe (ou prolonge) la date de fin d'abonnement à partir
    // d'aujourd'hui + la durée choisie, pour que le décompte de jours restants et la
    // suspension automatique côté client aient une date à laquelle se référer.
    if (status === "active") {
      const days = Number(form.durationDays) || 30;
      const end = new Date();
      end.setDate(end.getDate() + days);
      updates.trial_ends_at = end.toISOString().slice(0, 10);
    }
    const { error } = await supabase.from("companies").update(updates).eq("id", co.id);
    if (error) { showToast("Échec de la mise à jour du statut."); return; }
    setCompanies((prev) => prev.map((c) => (c.id === co.id ? { ...c, ...updates } : c)));
    logSA("statut_modifie", co, `${co.plan_status || "trial"} → ${status}${updates.trial_ends_at ? ` (jusqu'au ${updates.trial_ends_at})` : ""}`);
    showToast(`Statut mis à jour : ${status}.`);
  };

  // Bascule manuelle du forfait Standard/Assisté — en attendant que MonCash
  // (actuellement en pause côté production) gère ce choix directement à la
  // souscription, c'est le Super Admin qui active ce forfait après avoir reçu
  // le paiement, exactement comme "Enregistrer un paiement" ci-dessous.
  const setPlanTierForCompany = async (co, tier) => {
    const { error } = await supabase.from("companies").update({ plan_tier: tier }).eq("id", co.id);
    if (error) { showToast("Échec de la mise à jour du forfait."); return; }
    setCompanies((prev) => prev.map((c) => (c.id === co.id ? { ...c, plan_tier: tier } : c)));
    // Si le panneau de paiement de cette entreprise est déjà ouvert, on rafraîchit
    // aussi le montant pré-rempli pour refléter le nouveau forfait immédiatement.
    if (openId === co.id) {
      setForm((f) => ({ ...f, amount: String(usdToHtg(co.group_id ? 350 : tier === "assisted" ? 80 : 20)), currency: "HTG" }));
    }
    logSA("forfait_modifie", co, `${co.plan_tier || "standard"} → ${tier}`);
    showToast(tier === "assisted" ? `${co.name} passe au forfait Assisté (80 $/mois).` : `${co.name} repasse au forfait Standard.`);
  };

  // Création d'un groupe multi-entreprises pour une entreprise donnée — réservée
  // au Centre de gestion, jamais en libre-service côté entreprise (même logique
  // que le passage au forfait Assisté ci-dessus). Le propriétaire du groupe est
  // l'administrateur principal de cette entreprise.
  const createGroupForCompany = async (co) => {
    const name = window.prompt(`Nom du groupe pour « ${co.name} » :`, `Groupe ${co.name}`);
    if (!name || !name.trim()) return;
    const owner = members.find((m) => m.company_id === co.id && m.is_primary_admin);
    if (!owner || !owner.user_id) { showToast("Administrateur principal introuvable pour cette entreprise — impossible de définir le propriétaire du groupe."); return; }
    const groupEntry = {
      id: crypto.randomUUID(), owner_user_id: owner.user_id, owner_email: owner.email, name: name.trim(),
      plan_status: "active", max_companies: 5,
    };
    const { error: grpErr } = await supabase.from("company_groups").insert(groupEntry);
    if (grpErr) { showToast(friendlyError(grpErr)); return; }
    const { error: linkErr } = await supabase.from("companies").update({ group_id: groupEntry.id }).eq("id", co.id);
    if (linkErr) { showToast("Le groupe a été créé, mais le rattachement a échoué. " + NET_MSG); return; }
    setCompanies((prev) => prev.map((c) => (c.id === co.id ? { ...c, group_id: groupEntry.id } : c)));
    logSA("groupe_cree", co, `Groupe « ${name.trim()} »`);
    showToast(`Groupe « ${name.trim()} » créé pour ${co.name}.`);
  };

  // Suppression complète et irréversible d'une entreprise (données + membres +
  // l'entreprise elle-même) — passe par une fonction RPC dédiée côté serveur
  // (SECURITY DEFINER) plutôt que des suppressions directes multi-tables, pour que
  // toute la logique sensible soit centralisée et vérifiée à un seul endroit côté
  // base de données, réservée aux administrateurs de la plateforme.
  const deleteCompany = async (co) => {
    const typed = window.prompt(
      `Cette action supprime DÉFINITIVEMENT l'entreprise "${co.name}" et TOUTES ses données (écritures, factures, membres, etc.) — irréversible, aucune sauvegarde de secours.\n\nPour confirmer, tapez exactement le nom de l'entreprise : ${co.name}`
    );
    if (typed !== co.name) { showToast("Suppression annulée — le nom saisi ne correspond pas."); return; }
    const { error } = await supabase.rpc("delete_company_and_data", { target_company_id: co.id });
    if (error) { showToast(friendlyError(error)); return; }
    setCompanies((prev) => prev.filter((c) => c.id !== co.id));
    if (openId === co.id) setOpenId(null);
    logSA("entreprise_supprimee", co, "Suppression définitive (données + membres)");
    showToast(`Entreprise "${co.name}" supprimée définitivement.`);
  };

  const recordPayment = async (co) => {
    if (!form.amount || Number(form.amount) <= 0) {
      showToast("Montant invalide.");
      return;
    }
    if (isFutureDate(form.date)) {
      showToast("Impossible d'enregistrer un paiement à une date future.");
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("payments").insert({
      company_id: co.id, method: form.method, amount: Number(form.amount), currency: form.currency,
      date: form.date, reference: form.reference || null, note: form.note || null, recorded_by: user?.email || null,
    });
    if (error) { showToast("Échec de l'enregistrement du paiement."); return; }
    // Le paiement active le compte ET fixe la nouvelle date de fin d'abonnement à
    // partir d'aujourd'hui + la durée choisie (pas depuis l'ancienne date d'essai/
    // d'abonnement, potentiellement déjà expirée).
    const days = Number(form.durationDays) || 30;
    const end = new Date();
    end.setDate(end.getDate() + days);
    const trialEndsAt = end.toISOString().slice(0, 10);
    await supabase.from("companies").update({ plan_status: "active", trial_ends_at: trialEndsAt }).eq("id", co.id);
    setCompanies((prev) => prev.map((c) => (c.id === co.id ? { ...c, plan_status: "active", trial_ends_at: trialEndsAt } : c)));
    setForm({ method: "moncash", amount: "", currency: "HTG", date: todayStr(), reference: "", note: "", durationDays: 30 });
    loadPayments(co.id);
    loadAllPayments();
    logSA("paiement_enregistre", co, `${form.amount} ${form.currency} (${form.method}) — actif jusqu'au ${trialEndsAt}`);
    showToast(`Paiement enregistré — ${co.name} est actif jusqu'au ${trialEndsAt}.`);
  };

  if (companies === null) {
    return <div className="p-8 text-sm" style={{ color: "#8A8370" }}>Chargement des entreprises…</div>;
  }

  const filtered = companies.filter((c) => (c.name || "").toLowerCase().includes(q.toLowerCase()));
  // S'applique aussi bien à un compte en essai qu'à un compte actif : trial_ends_at
  // sert de date de fin générique (fin d'essai OU fin de la période payée en cours).
  const daysLeft = (co) => co.trial_ends_at ? Math.ceil((new Date(co.trial_ends_at) - new Date()) / 86400000) : null;
  // Repère les appareils ayant créé plusieurs entreprises (signe probable d'abus de
  // l'essai gratuit — un même appareil ayant contourné le blocage côté client).
  const deviceCounts = {};
  companies.forEach((c) => { if (c.signup_device_id) deviceCounts[c.signup_device_id] = (deviceCounts[c.signup_device_id] || 0) + 1; });
  const isSuspiciousDevice = (co) => co.signup_device_id && deviceCounts[co.signup_device_id] > 1;

  // --- Statistiques du tableau de bord ---
  const totalCompanies = companies.length;
  const activeCompanies = companies.filter((c) => c.plan_status === "active").length;
  const suspendedCompanies = companies.filter((c) => c.plan_status === "suspended").length;
  const trialCompanies = companies.filter((c) => !c.plan_status || c.plan_status === "trial").length;
  const companyNameById = Object.fromEntries(companies.map((c) => [c.id, c.name || "(sans nom)"]));

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfQuarter = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const sumByCurrency = (list) => {
    const out = {};
    list.forEach((p) => { out[p.currency || "HTG"] = (out[p.currency || "HTG"] || 0) + Number(p.amount || 0); });
    return out;
  };
  const paymentsSince = (start) => (allPayments || []).filter((p) => p.date && new Date(p.date) >= start);
  const revenueMonth = sumByCurrency(paymentsSince(startOfMonth));
  const revenueQuarter = sumByCurrency(paymentsSince(startOfQuarter));
  const revenueYear = sumByCurrency(paymentsSince(startOfYear));
  const currenciesPresent = [...new Set((allPayments || []).map((p) => p.currency || "HTG"))];
  const primaryCurrency = currenciesPresent.includes("HTG") ? "HTG" : (currenciesPresent[0] || "HTG");

  // Revenus mensuels (12 derniers mois, devise principale uniquement — mélanger des
  // devises différentes dans un même total serait trompeur) pour le graphique.
  const monthlyRevenue = (() => {
    const byMonth = {};
    (allPayments || []).filter((p) => (p.currency || "HTG") === primaryCurrency).forEach((p) => {
      const key = monthLabel(p.date);
      byMonth[key] = (byMonth[key] || 0) + Number(p.amount || 0);
    });
    return Object.entries(byMonth).map(([mois, total]) => ({ mois, total }));
  })();

  const filteredHistory = (allPayments || []).filter((p) => {
    if (histFrom && p.date < histFrom) return false;
    if (histTo && p.date > histTo) return false;
    if (histCompanyFilter && p.company_id !== histCompanyFilter) return false;
    return true;
  });

  // --- Rapports et analyse : activité économique liée aux abonnements ---
  const rapPeriodStart = (() => {
    if (rapPeriod === "mois") return startOfMonth;
    if (rapPeriod === "trimestre") return startOfQuarter;
    if (rapPeriod === "annee") return startOfYear;
    return null; // "tout"
  })();
  const rapPayments = (allPayments || []).filter((p) => {
    if (rapPeriodStart && p.date && new Date(p.date) < rapPeriodStart) return false;
    if (rapCurrency && (p.currency || "HTG") !== rapCurrency) return false;
    return true;
  });
  const rapRevenueOverTime = (() => {
    const byPeriod = {};
    rapPayments.forEach((p) => {
      const key = periodLabel(p.date, rapGroupBy);
      byPeriod[key] = (byPeriod[key] || 0) + Number(p.amount || 0);
    });
    return Object.entries(byPeriod).map(([periode, total]) => ({ periode, total }));
  })();
  const rapByMethod = (() => {
    const byMethod = {};
    rapPayments.forEach((p) => {
      const label = PAYMENT_METHODS.find((m) => m.id === p.method)?.label || p.method || "Autre";
      byMethod[label] = (byMethod[label] || 0) + Number(p.amount || 0);
    });
    return Object.entries(byMethod).map(([name, revenue]) => ({ name, revenue }));
  })();
  const rapNewCompaniesOverTime = (() => {
    const byPeriod = {};
    companies.forEach((c) => {
      if (!c.created_at) return;
      const d = c.created_at.slice(0, 10);
      if (rapPeriodStart && new Date(d) < rapPeriodStart) return;
      const key = periodLabel(d, rapGroupBy);
      byPeriod[key] = (byPeriod[key] || 0) + 1;
    });
    return Object.entries(byPeriod).map(([periode, total]) => ({ periode, total }));
  })();
  const rapByCompany = (() => {
    const byCompany = {};
    rapPayments.forEach((p) => {
      const name = companyNameById[p.company_id] || "—";
      byCompany[name] = (byCompany[name] || 0) + Number(p.amount || 0);
    });
    return Object.entries(byCompany).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
  })();
  const rapTotalRevenue = rapPayments.reduce((s, p) => s + Number(p.amount || 0), 0);

  return (
    <div>
      {/* En-tête distinct — pour que cet espace se démarque clairement du reste de
          l'application (c'est un outil de gestion de la plateforme, pas un module
          comptable d'une entreprise cliente). */}
      <div style={{ background: "#152238" }} className="px-4 md:px-8 py-6">
        <div className="text-xs uppercase tracking-widest" style={{ color: "#C9A24B" }}>Espace plateforme — accès réservé</div>
        <div className="display text-3xl" style={{ color: "#EFE9DD" }}>Super Admin</div>
        <p className="text-sm mt-1" style={{ color: "#8A97B5" }}>
          Gestion administrative et financière des abonnements — distincte des données comptables de chaque entreprise cliente.
        </p>
        {(() => {
          const SA_GROUPS = [
            { id: "activite", label: "Activité et finances", tabs: [["dashboard", "Tableau de bord"], ["entreprises", "Entreprises"], ["rapports", "Rapports et analyse"]] },
            { id: "essais", label: "Essais et inscriptions", tabs: [["suivi", "Suivi des essais"], ["inscriptions", "Inscriptions et essais"]] },
            { id: "controle", label: "Contrôle et sécurité", tabs: [["journal", "Journal"], ["erreurs", "Erreurs"], ["integrite", "Intégrité des données"]] },
          ];
          const grp = SA_GROUPS.find((g) => g.tabs.some(([id]) => id === tab)) || SA_GROUPS[0];
          return (
            <>
              <div className="flex gap-1 mt-5 overflow-x-auto" data-testid="sa-groups">
                {SA_GROUPS.map((g) => (
                  <button key={g.id} data-testid={"sa-group-" + g.id} onClick={() => { if (g.id !== grp.id) setTab(g.tabs[0][0]); }}
                    className="px-4 py-2 text-sm rounded-t shrink-0 whitespace-nowrap"
                    style={{ background: grp.id === g.id ? "#EFE9DD" : "transparent", color: grp.id === g.id ? "#152238" : "#8A97B5", fontWeight: grp.id === g.id ? 600 : 400 }}>
                    {g.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 overflow-x-auto mt-3" data-testid="sa-subtabs">
                {grp.tabs.map(([id, label]) => (
                  <button key={id} data-testid={"sa-tab-" + id} onClick={() => setTab(id)}
                    className="px-3 py-1 text-xs rounded-full shrink-0 whitespace-nowrap"
                    style={{ background: tab === id ? "#C9A24B" : "transparent", color: tab === id ? "#152238" : "#EFE9DD", border: "1px solid " + (tab === id ? "#C9A24B" : "#8A97B5"), fontWeight: tab === id ? 600 : 400 }}>
                    {label}
                  </button>
                ))}
              </div>
            </>
          );
        })()}
      </div>

      <div className="p-4 md:p-8 max-w-6xl" style={{ minWidth: 0, maxWidth: "100%", overflowX: "hidden" }}>
        {tab === "dashboard" && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}>
                <div className="text-xs" style={{ color: "#8A8370" }}>Abonnés totaux</div>
                <div className="text-2xl tabular font-medium" style={{ color: "#152238" }}>{totalCompanies}</div>
              </div>
              <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}>
                <div className="text-xs" style={{ color: "#8A8370" }}>Actifs</div>
                <div className="text-2xl tabular font-medium" style={{ color: "#0F6B5C" }}>{activeCompanies}</div>
              </div>
              <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}>
                <div className="text-xs" style={{ color: "#8A8370" }}>Suspendus</div>
                <div className="text-2xl tabular font-medium" style={{ color: "#A6432F" }}>{suspendedCompanies}</div>
              </div>
              <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}>
                <div className="text-xs" style={{ color: "#8A8370" }}>En essai</div>
                <div className="text-2xl tabular font-medium" style={{ color: "#9A7B1E" }}>{trialCompanies}</div>
              </div>
            </div>

            {allPayments === null ? (
              <div className="text-sm py-6 text-center" style={{ color: "#A39C87" }}>Chargement des revenus…</div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[["Ce mois-ci", revenueMonth], ["Ce trimestre", revenueQuarter], ["Cette année", revenueYear]].map(([label, byCcy]) => (
                    <div key={label} className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}>
                      <div className="text-xs mb-1" style={{ color: "#8A8370" }}>Revenus — {label}</div>
                      {Object.keys(byCcy).length === 0 ? (
                        <div className="text-sm" style={{ color: "#A39C87" }}>Aucun paiement</div>
                      ) : (
                        Object.entries(byCcy).map(([ccy, amt]) => (
                          <div key={ccy} className="tabular" style={{ fontSize: 20, fontWeight: 600, color: "#152238" }}>{amt.toLocaleString("fr-FR")} {ccy}</div>
                        ))
                      )}
                    </div>
                  ))}
                </div>

                <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
                  <div className="text-sm font-semibold mb-4" style={{ color: "#152238" }}>Revenus par mois ({primaryCurrency})</div>
                  {monthlyRevenue.length === 0 ? (
                    <div className="text-sm py-10 text-center" style={{ color: "#A39C87" }}>Aucun paiement enregistré.</div>
                  ) : monthlyRevenue.length === 1 ? (
                    <div className="text-center py-6">
                      <div className="text-xs uppercase tracking-wide mb-1" style={{ color: "#8A8370" }}>{monthlyRevenue[0].mois}</div>
                      <div className="tabular" style={{ fontSize: 32, fontWeight: 700, color: "#0F6B5C" }}>{monthlyRevenue[0].total.toLocaleString("fr-FR")} {primaryCurrency}</div>
                    </div>
                  ) : (
                    <SimpleLineChart data={monthlyRevenue} xKey="mois" yKey="total" color="#0F6B5C" name="Revenus" />
                  )}
                </div>

                <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                    <div className="text-sm font-semibold" style={{ color: "#152238" }}>Historique global des paiements</div>
                  </div>
                  <div className="flex flex-wrap gap-2 mb-4">
                    <input type="date" value={histFrom} onChange={(e) => setHistFrom(e.target.value)}
                      className="border rounded px-2 py-1.5 text-xs" style={{ borderColor: "#DDD6C4" }} />
                    <input type="date" value={histTo} onChange={(e) => setHistTo(e.target.value)}
                      className="border rounded px-2 py-1.5 text-xs" style={{ borderColor: "#DDD6C4" }} />
                    <select value={histCompanyFilter} onChange={(e) => setHistCompanyFilter(e.target.value)}
                      className="border rounded px-2 py-1.5 text-xs" style={{ borderColor: "#DDD6C4", width: "min(220px, 100%)", boxSizing: "border-box" }}>
                      <option value="">Toutes les entreprises</option>
                      {companies.map((c) => <option key={c.id} value={c.id}>{c.name || "(sans nom)"}</option>)}
                    </select>
                  </div>
                  {filteredHistory.length === 0 ? (
                    <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>Aucun paiement pour cette sélection.</div>
                  ) : (
                    <div className="overflow-x-auto"><table className="w-full text-xs">
                      <thead>
                        <tr className="text-left" style={{ color: "#8A8370" }}>
                          <th className="py-1 font-normal">Date</th>
                          <th className="py-1 font-normal">Entreprise</th>
                          <th className="py-1 font-normal">Méthode</th>
                          <th className="py-1 font-normal text-right">Montant</th>
                          <th className="py-1 font-normal">Référence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredHistory.map((p) => (
                          <tr key={p.id} style={{ borderTop: "1px solid #F3EFE3" }}>
                            <td className="py-1 tabular">{p.date}</td>
                            <td className="py-1">{companyNameById[p.company_id] || "—"}</td>
                            <td className="py-1">{PAYMENT_METHODS.find((m) => m.id === p.method)?.label || p.method}</td>
                            <td className="py-1 tabular text-right">{Number(p.amount || 0).toLocaleString("fr-FR")} {p.currency}</td>
                            <td className="py-1">{p.reference || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table></div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {tab === "entreprises" && (
          <>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher une entreprise…"
              className="w-full border rounded px-3 py-2 text-sm mb-4" style={{ borderColor: "#DDD6C4" }} />

            <div className="space-y-3">
              {filtered.length === 0 && (
                <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>Aucune entreprise trouvée.</div>
              )}
              {filtered.map((co) => {
                const days = daysLeft(co);
                const isOpen = openId === co.id;
                return (
                  <div key={co.id} className="bg-white rounded-lg" style={{ border: "1px solid #E4DFD1" }}>
                    <button onClick={() => toggleOpen(co)} className="w-full flex items-center justify-between px-4 py-3 text-left">
                      <div>
                        <div className="text-sm font-medium" style={{ color: "#152238" }}>{co.name || "(sans nom)"}</div>
                        <div className="text-xs" style={{ color: "#A39C87" }}>Créée le {(co.created_at || "").slice(0, 10)}</div>
                        {isSuspiciousDevice(co) && (
                          <div className="text-xs mt-0.5 px-1.5 py-0.5 rounded inline-block" style={{ background: "#F7E9E3", color: "#A6432F" }}>
                            ⚠ Même appareil que {deviceCounts[co.signup_device_id] - 1} autre{deviceCounts[co.signup_device_id] > 2 ? "s" : ""} entreprise{deviceCounts[co.signup_device_id] > 2 ? "s" : ""}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {co.plan_tier === "assisted" && (
                          <span className="text-xs px-2 py-1 rounded" style={{ background: "#EAE3F5", color: "#5B3FA0" }}>Assisté</span>
                        )}
                        {co.plan_status === "active" && days !== null && (
                          <span className="text-xs px-2 py-1 rounded" style={{ background: days <= 3 ? "#F7E9E3" : "#F3EFE3", color: days <= 3 ? "#A6432F" : "#7A7460" }}>
                            {days > 0 ? `${days} jour${days > 1 ? "s" : ""} restant${days > 1 ? "s" : ""}` : "Expiré"}
                          </span>
                        )}
                        <span className="text-xs px-2 py-1 rounded"
                          style={{
                            background: co.plan_status === "active" ? "#E6F1EE" : co.plan_status === "suspended" ? "#F7E9E3" : "#FBF1DC",
                            color: co.plan_status === "active" ? "#0F6B5C" : co.plan_status === "suspended" ? "#A6432F" : "#9A7B1E",
                          }}>
                          {co.plan_status === "active" ? "Actif" : co.plan_status === "suspended" ? "Suspendu" : `Essai${days !== null ? ` (${days}j)` : ""}`}
                        </span>
                      </div>
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-4 pt-1" style={{ borderTop: "1px solid #F3EFE3" }}>
                        <div className="flex flex-wrap items-end gap-2 mb-4 mt-3">
                          <div>
                            <label className="text-xs block mb-1" style={{ color: "#8A8370" }}>Durée (jours)</label>
                            <input type="number" min="1" value={form.durationDays}
                              onChange={(e) => setForm({ ...form, durationDays: e.target.value })}
                              className="w-20 border rounded px-2 py-1.5 text-sm tabular" style={{ borderColor: "#DDD6C4" }} />
                          </div>
                          <button onClick={() => setStatus(co, "active")} className="text-xs px-2 py-1.5 rounded" style={{ background: "#152238", color: "#EFE9DD" }}>Marquer actif (+{form.durationDays || 30}j)</button>
                          <button onClick={() => setStatus(co, "suspended")} className="text-xs px-2 py-1.5 rounded" style={{ background: "#A6432F", color: "#fff" }}>Suspendre</button>
                          <button onClick={() => setStatus(co, "trial")} className="text-xs px-2 py-1.5 rounded" style={{ border: "1px solid #DDD6C4", color: "#7A7460" }}>Remettre en essai</button>
                          {co.plan_tier === "assisted" ? (
                            <button onClick={() => setPlanTierForCompany(co, "standard")} className="text-xs px-2 py-1.5 rounded" style={{ border: "1px solid #DDD6C4", color: "#7A7460" }}>Repasser en Standard</button>
                          ) : (
                            <button onClick={() => setPlanTierForCompany(co, "assisted")} className="text-xs px-2 py-1.5 rounded" style={{ background: "#5B3FA0", color: "#fff" }}>Passer en Assisté (80 $/mois)</button>
                          )}
                          {!co.group_id && (
                            <button onClick={() => createGroupForCompany(co)} className="text-xs px-2 py-1.5 rounded" style={{ background: "#0F6B5C", color: "#fff" }}>Créer un groupe multi-entreprises</button>
                          )}
                        </div>
                        {co.group_id && (() => {
                          const siblings = companies.filter((c) => c.group_id === co.group_id && c.id !== co.id);
                          return (
                            <div className="text-xs mb-3 px-2 py-2 rounded" style={{ background: "#E6F1EE", color: "#0F6B5C" }}>
                              <div>Fait partie d'un groupe multi-entreprises (forfait Extension, 350 $/mois pour l'ensemble) — {siblings.length + 1} entreprise{siblings.length + 1 > 1 ? "s" : ""}</div>
                              {siblings.length > 0 && (
                                <ul className="mt-1 ml-3" style={{ listStyle: "disc" }}>
                                  {siblings.map((s) => <li key={s.id}>{s.name || "(sans nom)"}</li>)}
                                </ul>
                              )}
                            </div>
                          );
                        })()}
                        {co.trial_ends_at && (
                          <div className="text-xs mb-3" style={{ color: "#8A8370" }}>
                            Date de fin d'abonnement en cours : <span className="tabular">{co.trial_ends_at ? new Date(co.trial_ends_at).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" }) : "—"}</span>
                          </div>
                        )}

                        <div className="text-xs font-medium mb-2" style={{ color: "#152238" }}>Enregistrer un paiement</div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-2">
                          <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}
                            className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }}>
                            {PAYMENT_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                          </select>
                          <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
                            placeholder="Montant" className="border rounded px-2 py-1.5 text-sm tabular" style={{ borderColor: "#DDD6C4" }} />
                          <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}
                            className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }}>
                            <option value="HTG">HTG</option>
                            <option value="USD">USD</option>
                            <option value="MXN">MXN</option>
                          </select>
                          <input type="date" value={form.date} max={todayStr()} onChange={(e) => setForm({ ...form, date: e.target.value })}
                            className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }} />
                          <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })}
                            placeholder="Référence transaction" className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }} />
                          <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
                            placeholder="Note (optionnel)" className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }} />
                        </div>
                        <button onClick={() => recordPayment(co)} className="text-xs px-3 py-1.5 rounded text-white mb-4" style={{ background: "#0F6B5C" }}>
                          Enregistrer le paiement et activer
                        </button>

                        <div className="text-xs font-medium mb-2" style={{ color: "#152238" }}>Historique des paiements</div>
                        {!payments[co.id] || payments[co.id].length === 0 ? (
                          <div className="text-xs" style={{ color: "#A39C87" }}>Aucun paiement enregistré.</div>
                        ) : (
                          <div className="overflow-x-auto"><table className="w-full text-xs">
                            <thead>
                              <tr className="text-left" style={{ color: "#8A8370" }}>
                                <th className="py-1 font-normal">Date</th>
                                <th className="py-1 font-normal">Méthode</th>
                                <th className="py-1 font-normal text-right">Montant</th>
                                <th className="py-1 font-normal">Référence</th>
                              </tr>
                            </thead>
                            <tbody>
                              {payments[co.id].map((p) => (
                                <tr key={p.id} style={{ borderTop: "1px solid #F3EFE3" }}>
                                  <td className="py-1 tabular">{p.date}</td>
                                  <td className="py-1">{PAYMENT_METHODS.find((m) => m.id === p.method)?.label || p.method}</td>
                                  <td className="py-1 tabular text-right">{p.amount} {p.currency}</td>
                                  <td className="py-1">{p.reference || "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table></div>
                        )}

                        <div className="mt-5 pt-3" style={{ borderTop: "1px dashed #E4DFD1" }}>
                          <button onClick={() => deleteCompany(co)} className="text-xs px-3 py-1.5 rounded" style={{ border: "1px solid #A6432F", color: "#A6432F" }}>
                            🗑 Supprimer définitivement cette entreprise
                          </button>
                          <div className="text-xs mt-1" style={{ color: "#A39C87" }}>Irréversible — supprime aussi toutes les données (écritures, factures, membres, etc.).</div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {tab === "rapports" && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg p-4 flex flex-wrap gap-3" style={{ border: "1px solid #E4DFD1" }}>
              <div>
                <label className="text-xs block mb-1" style={{ color: "#8A8370" }}>Période</label>
                <select value={rapPeriod} onChange={(e) => setRapPeriod(e.target.value)}
                  className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }}>
                  <option value="mois">Ce mois-ci</option>
                  <option value="trimestre">Ce trimestre</option>
                  <option value="annee">Cette année</option>
                  <option value="tout">Tout l'historique</option>
                </select>
              </div>
              <div>
                <label className="text-xs block mb-1" style={{ color: "#8A8370" }}>Regrouper par</label>
                <select value={rapGroupBy} onChange={(e) => setRapGroupBy(e.target.value)}
                  className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }}>
                  <option value="mois">Mois</option>
                  <option value="trimestre">Trimestre</option>
                  <option value="annee">Année</option>
                </select>
              </div>
              <div>
                <label className="text-xs block mb-1" style={{ color: "#8A8370" }}>Devise</label>
                <select value={rapCurrency} onChange={(e) => setRapCurrency(e.target.value)}
                  className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }}>
                  <option value="">Toutes</option>
                  <option value="HTG">HTG</option>
                  <option value="USD">USD</option>
                  <option value="MXN">MXN</option>
                </select>
              </div>
            </div>

            <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}>
              <div className="text-xs" style={{ color: "#8A8370" }}>Revenus sur la sélection</div>
              <div className="text-2xl tabular font-medium" style={{ color: "#0F6B5C" }}>
                {rapTotalRevenue.toLocaleString("fr-FR")} {rapCurrency || ""}
              </div>
              {!rapCurrency && [...new Set(rapPayments.map((p) => p.currency || "HTG"))].length > 1 && (
                <div className="text-xs mt-1" style={{ color: "#9A7B1E" }}>⚠ Plusieurs devises mélangées dans ce total — sélectionnez une devise pour un chiffre exact.</div>
              )}
            </div>

            <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
              <div className="text-sm font-semibold mb-4" style={{ color: "#152238" }}>Revenus dans le temps</div>
              {rapRevenueOverTime.length === 0 ? (
                <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>Aucun paiement pour cette sélection.</div>
              ) : rapRevenueOverTime.length === 1 ? (
                <div className="text-center py-4">
                  <div className="text-xs uppercase tracking-wide mb-1" style={{ color: "#8A8370" }}>{rapRevenueOverTime[0].periode}</div>
                  <div className="tabular" style={{ fontSize: 26, fontWeight: 700, color: "#0F6B5C" }}>{rapRevenueOverTime[0].total.toLocaleString("fr-FR")}</div>
                </div>
              ) : (
                <SimpleLineChart data={rapRevenueOverTime} xKey="periode" yKey="total" color="#0F6B5C" name="Revenus" />
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
                <div className="text-sm font-semibold mb-4" style={{ color: "#152238" }}>Répartition par méthode de paiement</div>
                {rapByMethod.length === 0 ? (
                  <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>Aucun paiement.</div>
                ) : (
                  <SimpleDonutChart data={rapByMethod} nameKey="name" valueKey="revenue" />
                )}
              </div>
              <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
                <div className="text-sm font-semibold mb-4" style={{ color: "#152238" }}>Nouvelles entreprises</div>
                {rapNewCompaniesOverTime.length === 0 ? (
                  <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>Aucune nouvelle entreprise sur cette période.</div>
                ) : rapNewCompaniesOverTime.length === 1 ? (
                  <div className="text-center py-4">
                    <div className="text-xs uppercase tracking-wide mb-1" style={{ color: "#8A8370" }}>{rapNewCompaniesOverTime[0].periode}</div>
                    <div className="tabular" style={{ fontSize: 26, fontWeight: 700, color: "#152238" }}>{rapNewCompaniesOverTime[0].total}</div>
                  </div>
                ) : (
                  <SimpleLineChart data={rapNewCompaniesOverTime} xKey="periode" yKey="total" color="#3F4F73" name="Nouvelles entreprises" />
                )}
              </div>
            </div>

            <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
              <div className="text-sm font-semibold mb-4" style={{ color: "#152238" }}>Classement des entreprises par revenu généré</div>
              {rapByCompany.length === 0 ? (
                <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>Aucun paiement pour cette sélection.</div>
              ) : (
                <div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead>
                    <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                      <th className="py-2 font-normal">Entreprise</th>
                      <th className="py-2 font-normal text-right">Revenu total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rapByCompany.map((c) => (
                      <tr key={c.name} style={{ borderBottom: "1px solid #F3EFE3" }}>
                        <td className="py-2">{c.name}</td>
                        <td className="py-2 tabular text-right">{c.total.toLocaleString("fr-FR")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}
            </div>
          </div>
        )}

        {tab === "integrite" && (
          <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1", minWidth: 0, overflowWrap: "anywhere" }} data-testid="rel-panel">
            <div className="text-sm font-semibold mb-1" style={{ color: "#152238" }}>Intégrité des données</div>
            <p className="text-xs mb-4" style={{ color: "#8A8370" }}>
              Compare, entreprise par entreprise, les données utilisées par l'application avec leur copie structurée. Un écart de 0 partout signifie que la copie est fidèle : c'est la condition pour pouvoir basculer plus tard.
            </p>
            <button onClick={runRelCheck} disabled={relAll && relAll.loading}
              className="text-sm px-4 py-2 rounded" style={{ background: "#152238", color: "#EFE9DD", opacity: relAll && relAll.loading ? 0.6 : 1 }}>
              {relAll && relAll.loading ? "Contrôle en cours…" : "Lancer le contrôle"}
            </button>
            {relAll && relAll.error && <div className="text-sm mt-4" style={{ color: "#B3402F" }}>{relAll.error}</div>}
            {relAll && relAll.rows && (
              <div className="mt-4 space-y-2">
                {relAll.rows.length === 0 && <div className="text-sm" style={{ color: "#A39C87" }}>Aucune entreprise à contrôler.</div>}
                {relAll.rows.map((r) => {
                  const good = Number(r.ecarts) === 0;
                  const det = relDetail[r.company_id];
                  return (
                    <div key={r.company_id} className="rounded px-3 py-2" style={{ border: "1px solid #F3EFE3" }}>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                        <span className="font-medium" style={{ color: "#152238" }}>{r.company_name || "Entreprise sans nom"}</span>
                        <span style={{ color: good ? "#2F7D4F" : "#B3402F" }}>{good ? "✓ Copie fidèle" : `${r.ecarts} écart(s)`}</span>
                        {Number(r.erreurs_recopie) > 0 && <span style={{ color: "#B3402F" }}>{r.erreurs_recopie} recopie(s) en erreur</span>}
                        <button onClick={() => loadRelDetail(r.company_id)} className="text-xs underline ml-auto" style={{ color: "#8A8370" }}>Détail</button>
                      </div>
                      {det && det.length > 0 && (
                        <table className="text-xs mt-2 w-full">
                          <thead><tr style={{ color: "#8A8370" }}><th className="text-left font-normal">Élément</th><th className="text-right font-normal">Application</th><th className="text-right font-normal">Copie</th><th></th></tr></thead>
                          <tbody>
                            {det.map((m) => (
                              <tr key={m.metric}>
                                <td>{m.metric}</td>
                                <td className="text-right tabular">{m.kv === null ? "—" : Number(m.kv).toLocaleString("fr-FR")}</td>
                                <td className="text-right tabular">{Number(m.rel).toLocaleString("fr-FR")}</td>
                                <td className="text-right" style={{ color: m.ok ? "#2F7D4F" : "#B3402F" }}>{m.ok ? "✓" : "≠"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === "erreurs" && (
          <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1", minWidth: 0, overflowWrap: "anywhere" }} data-testid="err-panel">
            <div className="text-sm font-semibold mb-1" style={{ color: "#152238" }}>Erreurs récentes (200 dernières)</div>
            <p className="text-xs mb-4" style={{ color: "#8A8370" }}>
              Erreurs JavaScript non gérées survenues chez les utilisateurs, journalisées automatiquement — utile pour repérer un problème sans attendre qu'on vous le signale.
            </p>
            {errorLogs === null ? (
              <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>Chargement…</div>
            ) : errorLogs.length === 0 ? (
              <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>Aucune erreur journalisée.</div>
            ) : (
              <div className="space-y-2">
                {errorLogs.map((e) => (
                  <details key={e.id} className="rounded" style={{ border: "1px solid #F3EFE3", minWidth: 0, maxWidth: "100%" }}>
                    <summary className="cursor-pointer px-3 py-2 text-xs flex flex-wrap gap-x-3 gap-y-1" style={{ color: "#152238", minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere", wordBreak: "break-word" }}>
                      <span className="tabular" style={{ color: "#8A8370" }}>{e.created_at ? new Date(e.created_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "medium" }) : "—"}</span>
                      <span className="font-medium" style={{ minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere", wordBreak: "break-word" }}>{e.message || "(sans message)"}</span>
                      <span style={{ color: "#A39C87", minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere", wordBreak: "break-word" }}>v{e.app_version || "?"} — {companyNameById[e.company_id] || "—"} — {e.user_email || "anonyme"}</span>
                    </summary>
                    <div className="px-3 pb-3">
                      <div className="text-xs mb-1" style={{ color: "#8A8370", overflowWrap: "anywhere", wordBreak: "break-all" }}>{e.url}</div>
                      {e.stack && <pre className="text-xs whitespace-pre-wrap p-2 rounded overflow-x-auto" style={{ background: "#FAF8F1", color: "#7A7460", maxWidth: "100%", overflowWrap: "anywhere", wordBreak: "break-all" }}>{e.stack}</pre>}
                      <button
                        onClick={(ev) => {
                          ev.preventDefault();
                          // Téléchargement ciblé à CE message précis uniquement — pas
                          // l'ensemble du journal, pour ne pas mélanger une erreur déjà
                          // diagnostiquée avec d'autres qui ne le sont pas encore.
                          const blob = new Blob([JSON.stringify(e, null, 2)], { type: "application/json" });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `compta-plus-erreur-${e.id}.json`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                        className="mt-2 text-xs px-3 py-1.5 rounded" style={{ border: "1px solid #DDD6C4", color: "#152238" }}>
                        ⬇ Télécharger ce message (JSON)
                      </button>
                    </div>
                  </details>
                ))}
              </div>
            )}
          </div>
        )}
        {tab === "suivi" && (() => {
          const act = trialActivity || {};
          const now = new Date();
          const daysSince = (iso) => (iso ? Math.floor((now - new Date(iso)) / 86400000) : null);
          const dataOf = (c) => { const a = act[c.id]; return a ? a.invoices_count + a.entries_count + a.products_count + a.clients_count + a.purchases_count : null; };
          const ownerOf = (c) => { const ms = members.filter((m) => m.company_id === c.id); const m = ms.find((x) => x.is_primary_admin) || ms[0]; return m ? m.email : ""; };
          const isTrial = (c) => !c.plan_status || c.plan_status === "trial";
          const left = (c) => (c.trial_ends_at ? Math.ceil((new Date(c.trial_ends_at) - now) / 86400000) : null);
          const lastRelance = (c) => { const r = (superLog || []).find((l) => l.action_type === "relance" && l.company_id === c.id); return r ? r.created_at : null; };
          const cohort = companies.filter((c) => c.created_at && daysSince(c.created_at) <= 30);
          const funnel = (list) => ({ total: list.length, withData: list.filter((c) => (dataOf(c) || 0) > 0).length, paid: list.filter((c) => c.plan_status === "active").length });
          const fAll = funnel(companies), f30 = funnel(cohort);
          const pct = (a, b) => (b ? Math.round((a / b) * 100) + " %" : "—");
          const sections = [
            { id: "bientot", title: "Essais qui se terminent dans 7 jours", hint: "Le bon moment pour proposer un forfait.", kind: "fin_proche",
              rows: companies.filter((c) => isTrial(c) && left(c) !== null && left(c) >= 0 && left(c) <= 7).sort((a, b) => left(a) - left(b)) },
            { id: "expires", title: "Essais expirés sans paiement", hint: "Compte suspendu ou date dépassée : une relance peut les récupérer.", kind: "expire",
              rows: companies.filter((c) => c.plan_status === "suspended" || (isTrial(c) && left(c) !== null && left(c) < 0)).sort((a, b) => (left(b) ?? -999) - (left(a) ?? -999)) },
            { id: "inactifs", title: "Essais sans aucune activité (depuis 3 jours ou plus)", hint: "Inscrits mais n'ont rien saisi : ils ont besoin d'aide pour démarrer.", kind: "inactif",
              rows: companies.filter((c) => isTrial(c) && daysSince(c.created_at) >= 3 && dataOf(c) === 0) },
            { id: "payantes", title: "Entreprises payantes sans activité depuis 30 jours", hint: "Risque de non-renouvellement : prenez de leurs nouvelles.", kind: "payante_inactive",
              rows: companies.filter((c) => c.plan_status === "active" && act[c.id] && (act[c.id].last_activity ? daysSince(act[c.id].last_activity) >= 30 : true)) },
          ];
          const msg = (c, kind) => {
            const nom = c.name || "votre entreprise";
            const bye = "\n\nL'équipe Compta+\nsupport@comptaplus.app";
            if (kind === "fin_proche") return { subject: `Votre essai Compta+ se termine bientôt`, body: `Bonjour,\n\nVotre essai gratuit de Compta+ pour « ${nom} » se termine dans ${left(c)} jour(s). Pour continuer sans interruption, choisissez votre forfait : nous pouvons vous aider à l'activer dès aujourd'hui.${bye}` };
            if (kind === "expire") return { subject: `Votre essai Compta+ est terminé`, body: `Bonjour,\n\nL'essai de « ${nom} » est terminé, mais vos données sont conservées. Répondez à ce message et nous réactivons votre accès (nous pouvons aussi prolonger votre essai si vous avez besoin de plus de temps).${bye}` };
            if (kind === "inactif") return { subject: `Besoin d'aide pour démarrer avec Compta+ ?`, body: `Bonjour,\n\nNous avons vu que « ${nom} » n'a pas encore commencé à utiliser Compta+. Une question, un blocage ? Répondez à ce message : nous vous guidons pas à pas (facture, stock, comptabilité).${bye}` };
            return { subject: `Des nouvelles de votre Compta+ ?`, body: `Bonjour,\n\nNous avons remarqué peu d'activité récente sur « ${nom} ». Tout va bien ? Dites-nous si quelque chose vous manque ou vous bloque, nous sommes là pour vous aider.${bye}` };
          };
          return (
            <div className="space-y-4" data-testid="suivi-panel">
              <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
                <div className="text-sm font-semibold mb-1" style={{ color: "#152238" }}>Entonnoir essai → payant</div>
                <p className="text-xs mb-3" style={{ color: "#8A8370" }}>Combien d'inscrits utilisent réellement l'application, et combien deviennent payants.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[["30 derniers jours", f30, "funnel-30"], ["Depuis le début", fAll, "funnel-all"]].map(([lab, f, tid]) => (
                    <div key={tid} data-testid={tid} className="p-3 rounded" style={{ background: "#FAF8F1" }}>
                      <div className="text-xs mb-2" style={{ color: "#A39C87" }}>{lab}</div>
                      <div className="flex gap-4 text-sm flex-wrap" style={{ color: "#152238" }}>
                        <div><div className="text-xl font-semibold">{f.total}</div><div className="text-xs" style={{ color: "#8A8370" }}>inscrites</div></div>
                        <div><div className="text-xl font-semibold">{trialActivity === null ? "…" : f.withData}</div><div className="text-xs" style={{ color: "#8A8370" }}>ont saisi des données ({pct(f.withData, f.total)})</div></div>
                        <div><div className="text-xl font-semibold">{f.paid}</div><div className="text-xs" style={{ color: "#8A8370" }}>payantes ({pct(f.paid, f.total)})</div></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {sections.map((sec) => (
                <div key={sec.id} data-testid={"suivi-" + sec.id} className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1", minWidth: 0 }}>
                  <div className="text-sm font-semibold" style={{ color: "#152238" }}>{sec.title} <span data-testid={"suivi-count-" + sec.id} style={{ color: "#8A8370", fontWeight: 400 }}>({sec.rows.length})</span></div>
                  <p className="text-xs mb-3" style={{ color: "#8A8370" }}>{sec.hint}</p>
                  {sec.rows.length === 0 ? <div className="text-xs" style={{ color: "#A39C87" }}>Rien à signaler.</div> : (
                    <div className="space-y-1">
                      {sec.rows.map((c) => {
                        const em = ownerOf(c); const m = msg(c, sec.kind); const lr = lastRelance(c); const d = dataOf(c); const a = act[c.id];
                        return (
                          <div key={c.id} data-testid="suivi-row" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs px-2 py-1.5 rounded" style={{ border: "1px solid #F3EFE3", color: "#152238" }}>
                            <span className="font-medium">{c.name || "(sans nom)"}</span>
                            <span style={{ color: "#8A8370", overflowWrap: "anywhere" }}>{em || "email inconnu"}</span>
                            {left(c) !== null && <span style={{ color: left(c) < 0 ? "#A6432F" : "#8A8370" }}>{left(c) < 0 ? `expiré depuis ${-left(c)} j` : `${left(c)} j restant(s)`}</span>}
                            <span style={{ color: "#8A8370" }}>{d === null ? "activité inconnue" : d === 0 ? "aucune donnée saisie" : `${d} élément(s) saisi(s)`}{a && a.last_activity ? ` · dernière activité il y a ${daysSince(a.last_activity)} j` : ""}</span>
                            {lr && <span style={{ color: "#0F6B5C" }}>relancé il y a {daysSince(lr)} j</span>}
                            <span className="flex-1" />
                            {em && <a data-testid="suivi-relance" href={`mailto:${em}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`} onClick={() => logSA("relance", c, m.subject)} className="underline" style={{ color: "#0F6B5C" }}>Relancer par e-mail</a>}
                            {(sec.kind === "fin_proche" || sec.kind === "expire" || sec.kind === "inactif") && <button data-testid="suivi-prolonger" onClick={() => extendTrial(c, 7)} className="underline" style={{ color: "#5B3FA0" }}>Prolonger de 7 jours</button>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })()}

        {tab === "journal" && (() => {
          const LAB = { statut_modifie: "Statut modifié", forfait_modifie: "Forfait modifié", paiement_enregistre: "Paiement enregistré", groupe_cree: "Groupe créé", entreprise_supprimee: "Entreprise supprimée", essai_prolonge: "Essai prolongé", essai_oublie: "Essai oublié", relance: "Relance préparée" };
          const rows = (superLog || []).filter((l) => (!logFilter || l.action_type === logFilter) && (!logSearch.trim() || `${l.target_description || ""} ${l.details || ""} ${l.actor_email || ""}`.toLowerCase().includes(logSearch.trim().toLowerCase())));
          return (
            <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1", minWidth: 0, overflowWrap: "anywhere" }} data-testid="journal-panel">
              <div className="text-sm font-semibold mb-1" style={{ color: "#152238" }}>Journal des actions Super Admin</div>
              <p className="text-xs mb-3" style={{ color: "#8A8370" }}>Qui a fait quoi, sur quelle entreprise et quand. Les 500 dernières actions sont conservées ici.</p>
              <div className="flex flex-wrap gap-2 mb-3">
                <select value={logFilter} onChange={(e) => setLogFilter(e.target.value)} data-testid="journal-filter" className="border rounded px-2 py-1 text-xs" style={{ borderColor: "#DDD6C4" }}>
                  <option value="">Toutes les actions</option>
                  {Object.entries(LAB).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <input value={logSearch} onChange={(e) => setLogSearch(e.target.value)} data-testid="journal-search" placeholder="Rechercher (entreprise, email, détail)…" className="border rounded px-2 py-1 text-xs flex-1" style={{ borderColor: "#DDD6C4", minWidth: 180 }} />
              </div>
              {superLog === null ? <div className="text-sm py-6 text-center" style={{ color: "#A39C87" }}>Chargement…</div>
                : rows.length === 0 ? <div className="text-sm py-6 text-center" style={{ color: "#A39C87" }}>Aucune action enregistrée.</div>
                : (
                  <div className="space-y-1">
                    {rows.map((l) => (
                      <div key={l.id} data-testid="journal-row" data-action={l.action_type} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs px-2 py-1.5 rounded" style={{ border: "1px solid #F3EFE3", color: "#152238" }}>
                        <span className="tabular" style={{ color: "#8A8370" }}>{l.created_at ? new Date(l.created_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—"}</span>
                        <span className="px-1.5 py-0.5 rounded" style={{ background: l.action_type === "entreprise_supprimee" ? "#F7E9E3" : "#EDEAF7", color: l.action_type === "entreprise_supprimee" ? "#A6432F" : "#5B3FA0" }}>{LAB[l.action_type] || l.action_type}</span>
                        {l.target_description && <span className="font-medium">{l.target_description}</span>}
                        {l.details && <span style={{ color: "#5C6B8C" }}>{l.details}</span>}
                        <span style={{ color: "#A39C87" }}>par {l.actor_email || "?"}</span>
                      </div>
                    ))}
                  </div>
                )}
            </div>
          );
        })()}

        {tab === "inscriptions" && (
          <div className="bg-white rounded-lg p-6 mb-4" style={{ border: "1px solid #E4DFD1", minWidth: 0, overflowWrap: "anywhere" }} data-testid="trials-panel">
            <div className="text-sm font-semibold mb-1" style={{ color: "#152238" }}>Essais gratuits (anti-abus)</div>
            <p className="text-xs mb-3" style={{ color: "#8A8370" }}>
              Règle : 2 essais maximum par adresse email, même si l'entreprise a été supprimée ; le 3e est refusé (sauf emails administrateurs de la plateforme). Si une personne légitime est refusée, cliquez sur « Oublier cet essai » sur l'une de ses lignes « Créé » pour lui rendre un essai.
            </p>
            <label className="text-xs flex items-center gap-2 mb-3" style={{ color: "#5C6B8C" }}>
              <input type="checkbox" checked={trialOnlyBlocked} onChange={(e) => setTrialOnlyBlocked(e.target.checked)} data-testid="trials-only-blocked" /> Afficher seulement les refus
            </label>
            {trialSignups === null ? (
              <div className="text-sm py-6 text-center" style={{ color: "#A39C87" }}>Chargement…</div>
            ) : trialSignups.filter((t) => !trialOnlyBlocked || t.outcome !== "created").length === 0 ? (
              <div className="text-sm py-6 text-center" style={{ color: "#A39C87" }}>Aucun essai enregistré pour le moment.</div>
            ) : (
              <div className="space-y-1">
                {trialSignups.filter((t) => !trialOnlyBlocked || t.outcome !== "created").map((t) => {
                  const n = trialSignups.filter((x) => x.email_normalized === t.email_normalized && x.outcome === "created").length;
                  const lab = { created: "Créé", blocked_email: "Refusé : email", blocked_device: "Refusé : appareil", blocked_ip: "Refusé : réseau", blocked_disposable: "Refusé : email temporaire" }[t.outcome] || t.outcome;
                  return (
                    <div key={t.id} data-testid="trial-row" data-outcome={t.outcome} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs px-2 py-1.5 rounded" style={{ border: "1px solid #F3EFE3", color: "#152238" }}>
                      <span className="tabular" style={{ color: "#8A8370" }}>{t.created_at ? new Date(t.created_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—"}</span>
                      <span className="px-1.5 py-0.5 rounded" style={{ background: t.outcome === "created" ? "#E6F1EE" : "#F7E9E3", color: t.outcome === "created" ? "#0F6B5C" : "#A6432F" }}>{lab}</span>
                      <span className="font-medium" style={{ overflowWrap: "anywhere" }}>{t.email_raw || t.email_normalized}</span>
                      {t.company_name && <span style={{ color: "#8A8370" }}>{t.company_name}</span>}
                      <span style={{ color: "#8A8370" }}>{n} essai(s) pour cet email</span>
                      <span className="flex-1" />
                      <button data-testid="trial-forget" onClick={() => forgetTrial(t)} className="underline" style={{ color: "#8A8370" }}>Oublier cet essai</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {tab === "inscriptions" && (
          <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1", minWidth: 0, overflowWrap: "anywhere" }} data-testid="insc-panel">
            <div className="text-sm font-semibold mb-1" style={{ color: "#152238" }}>Inscriptions échouées (200 dernières)</div>
            <p className="text-xs mb-4" style={{ color: "#8A8370" }}>
              Chaque ligne correspond à une connexion réussie qui s'est déconnectée d'elle-même avant d'atteindre l'écran de bienvenue — le problème de connexion en cours de diagnostic. L'email permet de recontacter la personne directement (via le Centre de gestion, en l'ajoutant comme prospect).
            </p>
            {signupFailures === null ? (
              <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>Chargement…</div>
            ) : signupFailures.length === 0 ? (
              <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>Aucune tentative échouée journalisée.</div>
            ) : (
              <div className="space-y-2">
                {signupFailures.map((f) => (
                  <details key={f.id} className="rounded" style={{ border: "1px solid #F3EFE3", minWidth: 0, maxWidth: "100%" }}>
                    <summary className="cursor-pointer px-3 py-2 text-xs flex flex-wrap gap-x-3 gap-y-1" style={{ color: "#152238", minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere", wordBreak: "break-word" }}>
                      <span className="tabular" style={{ color: "#8A8370" }}>{f.created_at ? new Date(f.created_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "medium" }) : "—"}</span>
                      <span className="font-medium" style={{ minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere", wordBreak: "break-word" }}>{f.email || "(email inconnu)"}</span>
                    </summary>
                    <div className="px-3 pb-3">
                      <div className="text-xs mb-1" style={{ color: "#8A8370", overflowWrap: "anywhere", wordBreak: "break-all" }}>{f.user_agent}</div>
                      <pre className="text-xs whitespace-pre-wrap p-2 rounded overflow-x-auto" style={{ background: "#FAF8F1", color: "#7A7460", maxWidth: "100%", overflowWrap: "anywhere", wordBreak: "break-all" }}>
                        {(f.event_log || []).join("\n")}
                      </pre>
                    </div>
                  </details>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

