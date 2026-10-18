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

function Dashboard({ kpis, chartData, growthData, latestGrowth, entriesCount, installPrompt, onInstallClick, setActive, settings, setSettings, products, clients, planTier, invoices, role }) {
  const [showIosHelp, setShowIosHelp] = useState(false);
  const alreadyInstalled = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;
  return (
    <div className="p-4 md:p-8 max-w-6xl">
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
              { key: "produits", name: "Produits", color: "#0F6B5C" },
              { key: "charges", name: "Charges", color: "#A6432F" },
            ]}
          />
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

