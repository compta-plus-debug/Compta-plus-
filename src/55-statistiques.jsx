// ═══ MODULE ═══
// @module Statistiques
// @depends SimpleDonutChart, SimpleGroupedBarChart
// @exports StatsBloc, statMois, statSomme
// ═══ FIN DE L'EN-TÊTE ═══
// Onglet « Statistiques » commun aux blocs par secteur (Éducation, Import-export, Santé) :
// indicateurs, évolution sur les 6 derniers mois et répartitions. Aucune donnée n'est écrite ici : lecture seule.

const STAT_MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
// Les n derniers mois, du plus ancien au mois courant : [{ key: "2026-10", label: "oct. 26" }]
function statMois(n, today) {
  const [y, m] = String(today || "").split("-").map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date((y || 2000), (m || 1) - 1 - i, 1);
    out.push({ key: d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"), label: STAT_MOIS[d.getMonth()] + " " + String(d.getFullYear()).slice(2) });
  }
  return out;
}
// Somme de valeur(x) pour les éléments dont la date commence par la clé de mois
const statSomme = (items, dateKey, mois, valeur) => Math.round(items.filter((x) => String(x[dateKey] || "").startsWith(mois)).reduce((s, x) => s + (Number(valeur(x)) || 0), 0) * 100) / 100;

// kpis : [[libellé, texte, testid]] — evolution : { titre, data, series } (clé « mois ») — repartitions : [{ titre, data: [{ name, value }] }]
function StatsBloc({ kpis, evolution, repartitions, vide }) {
  return (
    <div data-testid="stats-bloc">
      {vide && <div className="p-3 rounded text-sm mb-4" style={{ background: "#FFF6E0", color: "#152238" }} data-testid="stats-vide">{vide}</div>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {kpis.map(([l, v, t]) => (<div key={t} className="ec-kpi"><div className="text-xs" style={{ color: "#8A8370" }}>{l}</div><div className="display text-lg tabular" data-testid={t} style={{ color: "#152238" }}>{v}</div></div>))}
      </div>
      {evolution && (
        <div className="ec-card p-4 mb-5" data-testid="stats-evolution">
          <div className="display text-base mb-2" style={{ color: "#152238" }}>{evolution.titre}</div>
          <div style={{ overflowX: "auto" }}><SimpleGroupedBarChart data={evolution.data} xKey="mois" series={evolution.series} /></div>
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-4">
        {(repartitions || []).map((r, i) => {
          const data = (r.data || []).filter((d) => d.value > 0);
          return (
            <div key={i} className="ec-card p-4" data-testid="stats-repartition">
              <div className="display text-base mb-2" style={{ color: "#152238" }}>{r.titre}</div>
              {data.length === 0 ? <div className="text-sm" style={{ color: "#8A8370" }}>Rien à afficher pour le moment.</div> : <SimpleDonutChart data={data} nameKey="name" valueKey="value" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
