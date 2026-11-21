// ═══ MODULE ═══
// @module Tableau de bord
// @depends Download, SimpleDonutChart, SimpleGroupedBarChart, SimpleGrowthBarChart, balanceDue, fmt, normalizeClientName
//   useState
// @exports Card, Dashboard
// ═══ FIN DE L'EN-TÊTE ═══
function Card({ label, value, accent }) {
  return (
    <div className="rounded-lg p-5 bg-white min-w-0" style={{ border: "1px solid #E4DFD1" }}>
      <div className="text-xs uppercase tracking-widest break-words" style={{ color: "#8A8370" }}>{label}</div>
      <div className="tabular text-2xl mt-2 break-words" style={{ color: accent || "#152238" }}>{fmt(value)}</div>
    </div>
  );
}

// Rappel des échéances fiscales — TCA (mensuelle, le 15 du mois suivant) et Impôt
// sur le Revenu (annuel, le 31 octobre pour le régime forfaitaire). Ces deux dates
// suivent un motif très cohérent observé dans plusieurs textes fiscaux officiels
// haïtiens, mais n'ont pas pu être confirmées mot pour mot pour la TCA
// spécifiquement — d'où l'avertissement affiché, à vérifier auprès de la DGI ou
// d'un comptable en cas de doute avant de s'y fier pour une échéance réelle.
function FiscalDeadlinesCard({ setActive, taxSystem, planTier }) {
  // Ces échéances (TCA, Impôt sur le Revenu Haïti) ne concernent que les
  // entreprises sous le régime TCA — pas IVA (Mexique), ni "aucune" taxe — et,
  // depuis ce chantier, sont réservées au forfait Assisté.
  if (taxSystem !== "tca" || planTier !== "assisted") return null;
  const now = new Date();
  const MOIS_NOMS_D = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

  // TCA : la prochaine échéance est le 15 du mois courant si on n'a pas encore
  // dépassé cette date, sinon le 15 du mois suivant — et couvre toujours le mois
  // précédant cette échéance.
  const day15ThisMonth = new Date(now.getFullYear(), now.getMonth(), 15);
  const tcaDeadline = now <= day15ThisMonth ? day15ThisMonth : new Date(now.getFullYear(), now.getMonth() + 1, 15);
  const tcaCoveredMonth = new Date(tcaDeadline.getFullYear(), tcaDeadline.getMonth() - 1, 1);
  const tcaDaysLeft = Math.ceil((tcaDeadline - now) / 86400000);

  // Impôt sur le Revenu (forfaitaire) : le 31 octobre de l'exercice en cours, ou
  // de l'exercice suivant si cette date est déjà passée cette année.
  const oct31ThisYear = new Date(now.getFullYear(), 9, 31);
  const irDeadline = now <= oct31ThisYear ? oct31ThisYear : new Date(now.getFullYear() + 1, 9, 31);
  const irDaysLeft = Math.ceil((irDeadline - now) / 86400000);

  const urgencyColor = (daysLeft) => (daysLeft <= 3 ? "#A6432F" : daysLeft <= 7 ? "#9A7B1E" : "#0F6B5C");
  const urgencyBg = (daysLeft) => (daysLeft <= 3 ? "#F7E9E3" : daysLeft <= 7 ? "#FBF1DC" : "#E6F1EE");
  const fmtDate = (d) => `${d.getDate()} ${MOIS_NOMS_D[d.getMonth()]} ${d.getFullYear()}`;

  // L'échéance de l'Impôt sur le Revenu n'est affichée que dans les 60 jours qui
  // la précèdent, pour ne pas encombrer le tableau de bord toute l'année avec une
  // échéance annuelle lointaine.
  const showIR = irDaysLeft <= 60;

  return (
    <div className="grid gap-3 mb-6" style={{ gridTemplateColumns: showIR ? "repeat(auto-fit, minmax(260px, 1fr))" : "1fr" }}>
      <div className="rounded-lg p-4 flex items-center justify-between gap-3 flex-wrap cursor-pointer"
        style={{ background: urgencyBg(tcaDaysLeft), border: `1px solid ${urgencyColor(tcaDaysLeft)}22` }}
        onClick={() => setActive?.("rapports")}>
        <div>
          <div className="text-xs font-medium uppercase tracking-wide" style={{ color: urgencyColor(tcaDaysLeft) }}>Déclaration TCA</div>
          <div className="text-sm mt-0.5" style={{ color: "#152238" }}>{MOIS_NOMS_D[tcaCoveredMonth.getMonth()]} {tcaCoveredMonth.getFullYear()} — à déposer avant le {fmtDate(tcaDeadline)}</div>
        </div>
        <div className="text-lg font-semibold shrink-0" style={{ color: urgencyColor(tcaDaysLeft) }}>
          {tcaDaysLeft <= 0 ? "Échéance dépassée" : `${tcaDaysLeft} j`}
        </div>
      </div>
      {showIR && (
        <div className="rounded-lg p-4 flex items-center justify-between gap-3 flex-wrap cursor-pointer"
          style={{ background: urgencyBg(irDaysLeft), border: `1px solid ${urgencyColor(irDaysLeft)}22` }}
          onClick={() => setActive?.("rapports")}>
          <div>
            <div className="text-xs font-medium uppercase tracking-wide" style={{ color: urgencyColor(irDaysLeft) }}>Impôt sur le Revenu</div>
            <div className="text-sm mt-0.5" style={{ color: "#152238" }}>Exercice {irDeadline.getFullYear()} — à déposer avant le {fmtDate(irDeadline)}</div>
          </div>
          <div className="text-lg font-semibold shrink-0" style={{ color: urgencyColor(irDaysLeft) }}>
            {irDaysLeft <= 0 ? "Échéance dépassée" : `${irDaysLeft} j`}
          </div>
        </div>
      )}
      <p className="text-xs" style={{ color: "#A39C87", gridColumn: "1 / -1" }}>
        Dates calculées selon le régime général (15 du mois suivant pour la TCA, 31 octobre pour l'Impôt sur le Revenu forfaitaire) — à vérifier auprès de la DGI ou d'un comptable en cas de doute.
      </p>
    </div>
  );
}

// Alerte de stock bas — fonctionnalité exclusive au forfait Assisté. Le seuil de
// réapprovisionnement existe déjà par produit (Catalogue), mais jusqu'ici seul un
// surlignage discret dans les listes le signalait — rien ne le portait à
// l'attention de l'utilisateur de façon proactive.
function LowStockAlertCard({ setActive, products, planTier }) {
  if (planTier !== "assisted") return null;
  const lowStockProducts = (products || []).filter((p) => p.type === "marchandise" && Number(p.seuil) > 0 && Number(p.stock || 0) <= Number(p.seuil));
  if (lowStockProducts.length === 0) return null;

  const preview = lowStockProducts.slice(0, 3);

  return (
    <div className="rounded-lg p-4 mb-6 cursor-pointer" style={{ background: "#F7E9E3", border: "1px solid #A6432F22" }}
      onClick={() => setActive?.("stock")}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide" style={{ color: "#A6432F" }}>Alerte de stock bas</div>
          <div className="text-sm mt-0.5" style={{ color: "#152238" }}>
            {lowStockProducts.length} produit{lowStockProducts.length > 1 ? "s" : ""} sous le seuil de réapprovisionnement
          </div>
        </div>
        <div className="text-lg font-semibold shrink-0" style={{ color: "#A6432F" }}>{lowStockProducts.length}</div>
      </div>
      <div className="text-xs mt-2" style={{ color: "#8A6A5F" }}>
        {preview.map((p) => p.name).join(", ")}{lowStockProducts.length > preview.length ? "…" : ""}
      </div>
    </div>
  );
}

// Relance de créances vieillissantes — fonctionnalité exclusive au forfait
// Assisté. Regroupe par client (nom normalisé, comme dans Comptes clients) les
// factures encore dues depuis plus de 30 jours, pour signaler proactivement qui
// relancer, sans attendre d'aller consulter Clients dûs soi-même.
function AgingReceivablesCard({ setActive, invoices, planTier }) {
  if (planTier !== "assisted") return null;
  const SEUIL_JOURS = 30;
  const today = new Date();

  const balanceDue = (inv) => Number(inv.total || 0) - (inv.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);

  const overdue = (invoices || []).filter((inv) => {
    if (inv.status === "payée" || inv.status === "annulée" || inv.status === "don" || inv.status === "perte") return false;
    if (balanceDue(inv) <= 0.01) return false;
    const days = Math.floor((today - new Date(inv.date)) / 86400000);
    return days > SEUIL_JOURS;
  });
  if (overdue.length === 0) return null;

  const groups = {};
  overdue.forEach((inv) => {
    const key = normalizeClientName(inv.client);
    if (!groups[key]) groups[key] = { name: inv.client, total: 0, oldestDays: 0 };
    groups[key].total += balanceDue(inv);
    const days = Math.floor((today - new Date(inv.date)) / 86400000);
    if (days > groups[key].oldestDays) groups[key].oldestDays = days;
  });
  const clientList = Object.values(groups).sort((a, b) => b.oldestDays - a.oldestDays);
  const totalDue = clientList.reduce((s, c) => s + c.total, 0);

  return (
    <div className="rounded-lg p-4 mb-6 cursor-pointer" style={{ background: "#FBF1DC", border: "1px solid #9A7B1E22" }}
      onClick={() => setActive?.("crm")}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide" style={{ color: "#9A7B1E" }}>Relance de créances</div>
          <div className="text-sm mt-0.5" style={{ color: "#152238" }}>
            {clientList.length} client{clientList.length > 1 ? "s" : ""} à relancer (plus de {SEUIL_JOURS} jours) — {fmt(totalDue)}
          </div>
        </div>
        <div className="text-lg font-semibold shrink-0" style={{ color: "#9A7B1E" }}>{clientList.length}</div>
      </div>
      <div className="text-xs mt-2" style={{ color: "#8A7A4F" }}>
        {clientList.slice(0, 3).map((c) => c.name).join(", ")}{clientList.length > 3 ? "…" : ""}
      </div>
    </div>
  );
}

// K:ONB:START — Parcours d'accueil : « Premiers pas » (carte du tableau de bord)
function onbSteps({ settings, products, clients, invoices }) {
  const st = settings || {};
  const infoFilled = !!(String(st.companyName || "").trim() && (st.companyVille || st.companyNIF || st.companyEmail || st.companyPhone || st.companyAddress || st.companyLogo));
  return [
    { id: "info", label: "Compléter les informations de votre entreprise", hint: "Ville, email ou logo : ils apparaissent sur vos factures.", module: "admin", done: infoFilled },
    { id: "product", label: "Ajouter votre premier produit ou service", hint: "Le catalogue alimente la caisse et les factures.", module: "vente", done: (products || []).length > 0 },
    { id: "client", label: "Ajouter votre premier client", hint: "Pour suivre ce qu'il vous doit.", module: "crm", done: (clients || []).length > 0 },
    { id: "invoice", label: "Créer votre première facture", hint: "L'écriture comptable se fait toute seule.", module: "vente", done: (invoices || []).filter((i) => i && i.status !== "annulée").length > 0 },
  ];
}
function GettingStartedCard({ setActive, settings, setSettings, products, clients, invoices, role }) {
  if (!(role === "Administrateur" || role === "Éditeur")) return null;
  if (settings && (settings.accountingOnly === true || settings.onboardingHidden === true)) return null;
  const steps = onbSteps({ settings, products, clients, invoices });
  const done = steps.filter((x) => x.done).length;
  if (done === steps.length) return null;
  const next = steps.find((x) => !x.done);
  return (
    <div className="rounded-lg p-4 mb-6" style={{ background: "#F4FBE8", border: "1px solid #C7E296" }} data-testid="onb-card">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide" style={{ color: "#3B5C1F" }}>Premiers pas — {done} sur {steps.length}</div>
          <div className="text-sm mt-1" style={{ color: "#152238" }}>Quelques minutes suffisent pour démarrer. Prochaine étape : <b>{next.label.charAt(0).toLowerCase() + next.label.slice(1)}</b>.</div>
        </div>
        <button onClick={() => setSettings && setSettings((prev) => ({ ...prev, onboardingHidden: true }))} className="text-xs underline" style={{ color: "#8A8370" }} data-testid="onb-hide">Masquer</button>
      </div>
      <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ background: "#DFF0BE" }}><div style={{ width: `${Math.round((done / steps.length) * 100)}%`, height: "100%", background: "#0F6B5C" }} /></div>
      <ul className="mt-3 grid gap-2">
        {steps.map((x) => (
          <li key={x.id} className="flex items-center justify-between gap-3 text-sm" data-testid={"onb-step-" + x.id} data-done={x.done ? "1" : "0"}>
            <span style={{ color: x.done ? "#8A8370" : "#152238", textDecoration: x.done ? "line-through" : "none" }}>
              <span aria-hidden="true">{x.done ? "✓ " : "○ "}</span>{x.label}
              {!x.done && <span className="block text-xs no-underline" style={{ color: "#8A8370", textDecoration: "none" }}>{x.hint}</span>}
            </span>
            {!x.done && <button onClick={() => setActive && setActive(x.module)} className="text-xs px-3 py-1 rounded text-white shrink-0" style={{ background: "#152238" }} data-testid={"onb-go-" + x.id}>Commencer</button>}
          </li>
        ))}
      </ul>
    </div>
  );
}
// K:ONB:END

function Dashboard({ kpis, chartData, growthData, latestGrowth, entriesCount, installPrompt, onInstallClick, setActive, settings, setSettings, products, clients, planTier, invoices, role, recentEntries = [], chargesRepartition = [], tresorerieJour = [], ventesJour = [] }) {
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [periode, setPeriode] = useState("mois");
  // Lot 2c : courbe de trésorerie. Mois = 30 jours (pas d'un jour), Trimestre = 90 jours (pas d'une semaine),
  // Année = 12 mois (pas de 30 jours). Le solde affiché à une date est le dernier solde connu à cette date.
  const PERIODES = { mois: { jours: 30, pas: 1, libelle: "30 derniers jours" }, trimestre: { jours: 90, pas: 7, libelle: "3 derniers mois" }, annee: { jours: 360, pas: 30, libelle: "12 derniers mois" } };
  const pad2 = (n) => String(n).padStart(2, "0");
  const isoLocal = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const aujourdhuiIso = isoLocal(new Date());
  const serieTreso = (() => {
    const cfg = PERIODES[periode] || PERIODES.mois;
    const points = [];
    for (let i = cfg.jours; i >= 0; i -= cfg.pas) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const iso = isoLocal(d);
      let solde = 0;
      for (const p of tresorerieJour) { if (p.jour <= iso) solde = p.solde; else break; }
      points.push({ iso, label: cfg.pas >= 30 ? `${pad2(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}` : `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`, solde });
    }
    return points;
  })();
  const soldeMin = Math.min(0, ...serieTreso.map((p) => p.solde));
  const soldeMax = Math.max(0, ...serieTreso.map((p) => p.solde));
  const plage = soldeMax - soldeMin || 1;
  // Courbe lissée, même style que la maquette « Market » (aire en dégradé, trait ardoise, point or).
  const pts = serieTreso.map((p, i) => [
    serieTreso.length > 1 ? (i / (serieTreso.length - 1)) * 594 : 0,
    170 - ((p.solde - soldeMin) / plage) * 150,
  ]);
  const cheminLisse = (q) => {
    if (q.length < 2) return "";
    let d = `M${q[0][0].toFixed(1)},${q[0][1].toFixed(1)}`;
    for (let i = 0; i < q.length - 1; i++) {
      const p0 = q[i - 1] || q[i], p1 = q[i], p2 = q[i + 1], p3 = q[i + 2] || p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      const borne = (y) => Math.min(170, Math.max(10, y)); // le lissage ne doit pas dépasser les bornes du graphique
      d += ` C${c1x.toFixed(1)},${borne(c1y).toFixed(1)} ${c2x.toFixed(1)},${borne(c2y).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return d;
  };
  const traitTreso = cheminLisse(pts);
  const aireTreso = pts.length > 1 ? `${traitTreso} L600,180 L0,180 Z` : "";
  const repereTreso = [0, 1, 2, 3, 4].map((k) => serieTreso[Math.round((k * (serieTreso.length - 1)) / 4)]).filter(Boolean);
  const dernierPoint = pts[pts.length - 1];
  // Une couleur par jour de la semaine (palette de la maquette, distincte d'un jour à l'autre).
  const COULEURS_JOURS = ["#152238", "#3F5A85", "#7F94B6", "#C9A24B", "#1FA97A", "#A9BFE3", "#A6432F"];
  const ventes30 = (() => {
    const out = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const iso = isoLocal(d);
      const hit = ventesJour.find((v) => v.jour === iso);
      out.push({ mois: `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`, produits: hit ? hit.produits : 0, jourSem: d.getDay() });
    }
    return out;
  })();
  const alreadyInstalled = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;
  return (
    <div className="p-4 md:p-8 max-w-6xl compta-accueil">
      <header className="mb-8 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="display text-3xl" style={{ color: "#152238" }}>Centre de contrôle</div>
          <p className="text-sm mt-1" style={{ color: "#7A7460" }}>
            Vue d'ensemble consolidée — {entriesCount} écriture{entriesCount > 1 ? "s" : ""} enregistrée{entriesCount > 1 ? "s" : ""} dans le journal.
          </p>
        </div>

        {!alreadyInstalled && (
          <div className="relative shrink-0">
            {installPrompt ? (
              <button onClick={onInstallClick}
                className="flex items-center gap-2 px-4 py-2 rounded text-sm text-white"
                style={{ background: "#152238" }}>
                <Download size={15} /> Installer l'application
              </button>
            ) : (
              <button onClick={() => setShowIosHelp((v) => !v)}
                className="flex items-center gap-2 px-4 py-2 rounded text-sm"
                style={{ background: "#fff", border: "1px solid #DDD6C4", color: "#152238" }}>
                <Download size={15} /> Installer l'application
              </button>
            )}
            {showIosHelp && !installPrompt && (
              <div className="absolute right-0 mt-2 w-72 rounded-lg p-4 text-xs z-10 shadow-lg"
                style={{ background: "#fff", border: "1px solid #E4DFD1", color: "#5F5A4C" }}>
                <div className="font-medium mb-2" style={{ color: "#152238" }}>Comment installer :</div>
                <p className="mb-2"><b>Android (Chrome)</b> : menu ⋮ en haut à droite. Si deux options distinctes apparaissent, choisissez bien <b>« Installer l'application »</b> — pas « Ajouter à l'écran d'accueil », qui ne crée qu'un simple raccourci vers le site, pas une vraie application autonome. S'il n'y a qu'une seule option, elle convient.</p>
                <p className="mb-2"><b>iPhone/iPad (Safari)</b> : bouton Partager (carré avec flèche) → « Sur l'écran d'accueil ».</p>
                <p><b>Windows/Mac (Chrome ou Edge)</b> : icône d'installation dans la barre d'adresse, à droite de l'URL.</p>
                <button onClick={() => setShowIosHelp(false)} className="mt-3 underline" style={{ color: "#152238" }}>Fermer</button>
              </div>
            )}
          </div>
        )}
      </header>

      <div className="rounded-2xl p-6 mb-6 flex items-center justify-between gap-4 flex-wrap" style={{ background: "linear-gradient(120deg,#152238,#1F4E9A)" }} data-testid="accueil-une">
          <div>
            <div className="text-xs uppercase tracking-widest" style={{ color: "#E8C97A" }}>À la une{latestGrowth ? " · " + latestGrowth.mois : ""}</div>
            <div className="display text-2xl mt-1" style={{ color: "#fff" }}>
              {!latestGrowth || latestGrowth.pct === null
                ? `Votre journal compte ${entriesCount} écriture${entriesCount > 1 ? "s" : ""} enregistrée${entriesCount > 1 ? "s" : ""}.`
                : latestGrowth.croissance >= 0
                  ? `Votre activité du mois est en avance de ${latestGrowth.pct.toFixed(1)} %`
                  : `Votre activité du mois est en retrait de ${Math.abs(latestGrowth.pct).toFixed(1)} %`}
            </div>
          </div>
          <button onClick={() => setActive?.("compta")} className="px-5 py-2 rounded-lg text-sm font-semibold" style={{ background: "#C9A24B", color: "#152238" }}>Voir le détail</button>
      </div>

      <GettingStartedCard setActive={setActive} settings={settings} setSettings={setSettings} products={products} clients={clients} invoices={invoices} role={role} />
      <FiscalDeadlinesCard setActive={setActive} taxSystem={settings.taxSystem} planTier={planTier} />
      <LowStockAlertCard setActive={setActive} products={products} planTier={planTier} />
      <AgingReceivablesCard setActive={setActive} invoices={invoices} planTier={planTier} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8 min-w-0">
        <Card label="Produits" value={kpis.produits} accent="#0F6B5C" />
        <Card label="Charges" value={kpis.charges} accent="#A6432F" />
        <Card label="Résultat" value={kpis.resultat} accent={kpis.resultat >= 0 ? "#0F6B5C" : "#A6432F"} />
        <Card label="Trésorerie (Banque + Caisse)" value={kpis.tresorerie} />
      </div>

      {latestGrowth && (
        <div className="bg-white rounded-lg p-4 mb-8" style={{ border: "1px solid #E4DFD1" }}>
          <div className="text-xs uppercase tracking-widest mb-1" style={{ color: "#8A8370" }}>
            Croissance du chiffre d'affaires — {latestGrowth.mois}
          </div>
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-2xl font-semibold" style={{ color: latestGrowth.croissance >= 0 ? "#0F6B5C" : "#A6432F" }}>
              {latestGrowth.croissance >= 0 ? "+" : ""}{fmt(latestGrowth.croissance)}
            </span>
            {latestGrowth.pct !== null && (
              <span className="text-sm" style={{ color: latestGrowth.croissance >= 0 ? "#0F6B5C" : "#A6432F" }}>
                ({latestGrowth.croissance >= 0 ? "+" : ""}{latestGrowth.pct.toFixed(1)}%)
              </span>
            )}
            <span className="text-xs" style={{ color: "#A39C87" }}>vs mois précédent</span>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg p-6 mb-8 min-w-0" style={{ border: "1px solid #E4DFD1" }} data-testid="accueil-tresorerie">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div>
            <div className="text-sm font-semibold" style={{ color: "#152238" }}>Évolution de la trésorerie</div>
            <div className="text-xs" style={{ color: "#A39C87" }}>Banque + caisse, solde cumulé · {PERIODES[periode].libelle}</div>
          </div>
          <div className="inline-flex rounded-lg overflow-hidden" style={{ border: "1px solid #DDD6C4" }} data-testid="accueil-periode" role="group" aria-label="Période">
            {[["mois", "Mois"], ["trimestre", "Trimestre"], ["annee", "Année"]].map(([k, lib]) => (
              <button key={k} onClick={() => setPeriode(k)} aria-pressed={periode === k}
                className="px-3 py-1.5 text-xs"
                style={{ background: periode === k ? "#152238" : "#fff", color: periode === k ? "#EFE9DD" : "#152238" }}>{lib}</button>
            ))}
          </div>
        </div>
        {tresorerieJour.length === 0 ? (
          <div className="text-sm py-16 text-center" style={{ color: "#A39C87" }}>Aucun mouvement de banque ou de caisse pour le moment.</div>
        ) : (
          <svg viewBox="0 0 600 180" preserveAspectRatio="none" className="w-full h-48" role="img" aria-label="Courbe du solde de trésorerie" style={{ display: "block", overflow: "visible" }}>
            <defs>
              <linearGradient id="grad-tresorerie" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="#152238" stopOpacity=".34" />
                <stop offset="1" stopColor="#152238" stopOpacity="0" />
              </linearGradient>
            </defs>
            <line x1="0" x2="600" y1="45" y2="45" stroke="#E6EDF7" />
            <line x1="0" x2="600" y1="90" y2="90" stroke="#E6EDF7" />
            <line x1="0" x2="600" y1="135" y2="135" stroke="#E6EDF7" />
            <path d={aireTreso} fill="url(#grad-tresorerie)" />
            <path d={traitTreso} fill="none" stroke="#3F5A85" strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            {dernierPoint && <circle cx={dernierPoint[0]} cy={dernierPoint[1]} r="6" fill="#C9A24B" stroke="#fff" strokeWidth="3" />}
          </svg>
        )}
        <div className="text-xs mt-1 tabular" style={{ color: "#152238" }}>Solde actuel : {fmt(serieTreso.length ? serieTreso[serieTreso.length - 1].solde : 0)}</div>
        <div className="flex justify-between text-xs mt-1" style={{ color: "#5B6B7F" }}>
          {repereTreso.map((r, i) => <span key={i}>{r.label}</span>)}
        </div>
      </div>

      <div className="bg-white rounded-lg p-6 mb-8" style={{ border: "1px solid #E4DFD1" }}>
        <div className="text-sm font-semibold mb-4" style={{ color: "#152238" }}>Produits vs Charges par mois</div>
        {chartData.length === 0 ? (
          <div className="text-sm py-16 text-center" style={{ color: "#A39C87" }}>
            Aucune écriture pour le moment. Ajoutez des écritures dans le module Comptabilité pour voir apparaître le graphique.
          </div>
        ) : (
          <SimpleGroupedBarChart
            data={chartData}
            xKey="mois"
            series={[
              { key: "produits", name: "Produits", color: "#3F5A85" },
              { key: "charges", name: "Charges", color: "#C9A24B" },
            ]}
          />
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-lg p-6 min-w-0" style={{ border: "1px solid #E4DFD1" }} data-testid="accueil-repartition">
          <div className="text-sm font-semibold mb-4" style={{ color: "#152238" }}>Répartition des charges</div>
          {chargesRepartition.length === 0 ? (
            <div className="text-sm py-10 text-center" style={{ color: "#A39C87" }}>Aucune charge enregistrée.</div>
          ) : (
            <SimpleDonutChart data={chargesRepartition} nameKey="name" valueKey="value" colors={["#152238", "#7F94B6", "#C9A24B", "#3F5A85", "#A9BFE3"]} />
          )}
        </div>
        <div className="bg-white rounded-lg p-6 min-w-0 md:col-span-2 overflow-x-auto" style={{ border: "1px solid #E4DFD1" }} data-testid="accueil-ecritures">
          <div className="text-sm font-semibold mb-3" style={{ color: "#152238" }}>Dernières écritures</div>
          {recentEntries.length === 0 ? (
            <div className="text-sm py-10 text-center" style={{ color: "#A39C87" }}>Aucune écriture pour le moment.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: "#152238", background: "#EEF2F8" }} className="text-left">
                  <th className="px-3 py-2" style={{ color: "#152238" }}>Date</th><th className="px-3 py-2" style={{ color: "#152238" }}>Libellé</th><th className="px-3 py-2" style={{ color: "#152238" }}>Statut</th><th className="px-3 py-2 text-right" style={{ color: "#152238" }}>Montant</th>
                </tr>
              </thead>
              <tbody>
                {recentEntries.map((e) => (
                  <tr key={e.id} style={{ borderTop: "1px solid #EEE9DA" }}>
                    <td className="px-3 py-2 whitespace-nowrap">{/^\d{4}-\d{2}-\d{2}$/.test(e.date || "") ? e.date.split("-").reverse().join("/") : (e.date || "")}</td>
                    <td className="px-3 py-2">{e.label}</td>
                    <td className="px-3 py-2">{e.corrigee ? "Corrigée" : "Enregistrée"}</td>
                    <td className="px-3 py-2 text-right tabular">{fmt(e.montant)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {(() => {
        const aujourdhui = new Date();
        const retards = (invoices || []).filter((inv) => {
          if (["payée", "annulée", "don", "perte"].includes(inv.status)) return false;
          if (balanceDue(inv) <= 0.01) return false;
          return Math.floor((aujourdhui - new Date(inv.date)) / 86400000) > 30;
        }).length;
        const stockBas = (products || []).filter((p) => p.type === "marchandise" && Number(p.seuil) > 0 && Number(p.stock || 0) <= Number(p.seuil)).length;
        const items = [];
        if (retards > 0) items.push({ texte: `Relancer ${retards} facture${retards > 1 ? "s" : ""} en retard`, module: "crm" });
        if (stockBas > 0) items.push({ texte: `Stock bas : ${stockBas} produit${stockBas > 1 ? "s" : ""} à réapprovisionner`, module: "stock" });
        return (
          <div className="bg-white rounded-lg p-6 mb-8" style={{ border: "1px solid #E4DFD1" }} data-testid="accueil-a-traiter">
            <div className="text-sm font-semibold mb-3" style={{ color: "#152238" }}>À traiter</div>
            {items.length === 0 ? (
              <div className="text-sm" style={{ color: "#A39C87" }}>Rien à traiter pour le moment.</div>
            ) : (
              <div className="flex flex-col gap-2">
                {items.map((it) => (
                  <button key={it.texte} onClick={() => setActive?.(it.module)} className="text-left text-sm px-3 py-2 rounded-lg" style={{ background: "#FBF1DC", color: "#152238" }}>{it.texte}</button>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      <div className="bg-white rounded-lg p-6 mb-8 min-w-0" style={{ border: "1px solid #E4DFD1" }} data-testid="accueil-ventes-jour">
        <div className="text-sm font-semibold mb-1" style={{ color: "#152238" }}>Ventes par jour</div>
        <p className="text-xs mb-4" style={{ color: "#A39C87" }}>Produits du journal, 30 derniers jours (aujourd'hui : {aujourdhuiIso.split("-").reverse().join("/")}).</p>
        {ventesJour.length === 0 ? (
          <div className="text-sm py-12 text-center" style={{ color: "#A39C87" }}>Aucune vente enregistrée.</div>
        ) : (
          <>
          <svg viewBox="0 0 600 220" preserveAspectRatio="none" className="w-full h-56" role="img" aria-label="Ventes par jour">
            <line x1="0" x2="600" y1="200" y2="200" stroke="#E4DFD1" strokeWidth="1" />
            {(() => {
              const max = Math.max(1, ...ventes30.map((v) => v.produits));
              const step = 600 / ventes30.length;
              return ventes30.map((v, i) => {
                const h = (v.produits / max) * 180;
                return <rect key={i} x={i * step + step * 0.2} y={200 - h} width={step * 0.6} height={h} fill={COULEURS_JOURS[v.jourSem]}><title>{v.mois} : {fmt(v.produits)}</title></rect>;
              });
            })()}
          </svg>
          <div className="flex justify-between text-xs mt-1" style={{ color: "#A39C87" }}>
            <span>{ventes30[0].mois}</span><span>{ventes30[15].mois}</span><span>{ventes30[29].mois}</span>
          </div>
          </>
        )}
      </div>

      <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
        <div className="text-sm font-semibold mb-1" style={{ color: "#152238" }}>Croissance du chiffre d'affaires par mois</div>
        <p className="text-xs mb-4" style={{ color: "#A39C87" }}>Variation des Produits en montant, comparé au mois précédent.</p>
        {growthData.length === 0 ? (
          <div className="text-sm py-16 text-center" style={{ color: "#A39C87" }}>
            Au moins deux mois d'écritures sont nécessaires pour calculer une croissance.
          </div>
        ) : (
          <SimpleGrowthBarChart data={growthData} xKey="mois" valueKey="croissance" pctKey="pct" />
        )}
      </div>
    </div>
  );
}

