// ═══ MODULE ═══
// @module Gestion module
// @depends ACCOUNTING_ONLY_HIDDEN_GESTION_TABS, BzAcomptes, BzAvoirs, BzBudget, BzDocs, BzEcheances
//   BzImportPos, BzInventaire, BzJustificatifs, BzPilotage, BzRapportBanque, BzRecurrent
//   BzReprise, bzAlerts, rangModule, todayStr, useState
// @exports GestionModule
// ═══ FIN DE L'EN-TÊTE ═══
// ---------------------------------------------------------------- Module principal
function GestionModule(props) {
  const { premium, bizdocs, invoices, purchases, settings } = props;
  const [tab, setTab] = useState("echeances");
  const al = bzAlerts({ invoices, purchases, bizdocs, settings, today: todayStr() });
  const accOnly = settings && settings.accountingOnly === true;
  // Dans les espaces de métier qui ont leurs propres devis et leurs propres ventes (hors commerce, import-export et santé),
  // les outils du commerce « Devis & commandes » et « Import POS » ne servent pas : on ne les propose pas.
  const espaceSansCommerce = ["ecole", "resto", "hotel", "transport", "immo", "btp", "indus", "agri"].includes(props.espace);
  const hideTab = (id) => (accOnly && ACCOUNTING_ONLY_HIDDEN_GESTION_TABS.includes(id)) || (espaceSansCommerce && (id === "docs" || id === "importpos"));
  const groups = [
    { label: "Suivi", tabs: [["echeances", `Échéances${al.total ? ` (${al.total})` : ""}`], ["docs", "Devis & commandes"], ["avoirs", "Avoirs & retours"], ["acomptes", "Acomptes & frais"], ["inventaire", "Inventaire"], ["importpos", "Import POS"], ["reprise", "Reprise comptable"], ["rapportbanque", "Ventes ↔ banque"], ["justificatifs", "Pièces justificatives"]].filter(([id]) => !hideTab(id)) },
    ...(premium ? [{ label: "Pilotage (Assisté / Extension)", tabs: [["recurrent", "Récurrence & projets"], ["budget", "Budget & prévisionnel"], ["pilotage", "Pilotage"]].filter(([id]) => !hideTab(id)) }] : []),
  ];
  const P = props;
  return (
    <div className="p-3 sm:p-4 md:p-8 max-w-6xl min-w-0" style={{ overflowX: "hidden" }} data-bz-module="gestion">
      <header className="mb-4">
        <div className="text-xs uppercase tracking-widest" style={{ color: "#C9A24B" }}>Module {rangModule("gestion")}</div>
        <div className="display text-3xl" style={{ color: "#152238" }}>Gestion avancée</div>
        {!premium && <div className="text-xs mt-1" style={{ color: "#A39C87" }}>Récurrence, projets, budget, prévisionnel et pilotage sont réservés aux forfaits Assisté et Extension.</div>}
      </header>
      <div className="flex flex-wrap gap-1.5 mb-5" data-bz="tabs">
        {groups.flatMap((g) => g.tabs).map(([id, label]) => (
          <button key={id} data-bz-tab={id} onClick={() => setTab(id)} className="text-sm px-3 py-1.5 rounded-full" style={tab === id ? { background: "#152238", color: "#fff" } : { border: "1px solid #DDD6C4", color: "#152238", background: "#fff" }}>{label}</button>
        ))}
      </div>
      {tab === "echeances" && <BzEcheances P={P} />}
      {tab === "docs" && !hideTab("docs") && <BzDocs P={P} />}
      {tab === "avoirs" && <BzAvoirs P={P} />}
      {tab === "acomptes" && <BzAcomptes P={P} />}
      {tab === "inventaire" && !hideTab("inventaire") && <BzInventaire P={P} />}
      {tab === "importpos" && <BzImportPos P={P} />}
      {tab === "reprise" && <BzReprise P={P} />}
      {tab === "rapportbanque" && <BzRapportBanque P={P} />}
      {tab === "justificatifs" && <BzJustificatifs P={P} />}
      {premium && tab === "recurrent" && !hideTab("recurrent") && <BzRecurrent P={P} />}
      {premium && tab === "budget" && <BzBudget P={P} />}
      {premium && tab === "pilotage" && <BzPilotage P={P} />}
    </div>
  );
}

