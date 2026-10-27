// ═══ MODULE ═══
// @module Ecoles socle
// @depends —
// @exports EC_CSS, ecBorder, ecBtn, ecBtnGold, ecDateFr, ecInput, ecPastille, ecTelecharger
// ═══ FIN DE L'EN-TÊTE ═══
// Éléments d'interface partagés par les blocs par secteur (Éducation, Import-export, Santé, Restauration, Hôtellerie) :
// pastilles, feuille de style des tableaux, champs, boutons, export CSV. Restent dans l'application de départ (les écrans, eux, se chargent à la demande).

const ecDateFr = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); return m ? m[3] + "/" + m[2] + "/" + m[1] : String(iso || ""); };

// Pastille d'état (couleurs douces) et feuille de style des tableaux de l'école
const ecPastille = (txt, kind) => {
  const c = { ok: ["#E3F2EE", "#0F6B5C"], alerte: ["#F9E4DF", "#A6432F"], info: ["#E8EEF8", "#2B4C8C"], neutre: ["#F0EEE6", "#6B6552"], attente: ["#FFF3D6", "#8A6A12"] }[kind] || ["#F0EEE6", "#6B6552"];
  return <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 999, background: c[0], color: c[1], fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap" }}>{txt}</span>;
};
const EC_CSS = `
.grid>*{min-width:0}.ec-wrap{max-width:100%;-webkit-overflow-scrolling:touch;background:#fff;border:1px solid #E4DFD1;border-radius:12px;overflow-x:auto;box-shadow:0 1px 3px rgba(21,34,56,.07);margin-bottom:22px}
.ec-table{width:100%;font-size:14px;border-collapse:collapse;min-width:540px}
.ec-table thead tr{background:#152238}
.ec-table thead th{color:#EFE9DD !important;font-weight:600;font-size:11.5px;letter-spacing:.04em;text-transform:uppercase;padding:11px 12px !important;white-space:nowrap}
.ec-table tbody td{padding:10px 12px;vertical-align:middle}
.ec-table tbody tr{border-top:1px solid #EEE9DA !important}
.ec-table tbody tr:nth-child(even){background:#FAF8F1}
.ec-table tbody tr:hover{background:#F3EFE0}
[data-testid="ecoles-module"] .display.text-base{border-left:3px solid #C9A24B;padding-left:10px;margin-bottom:12px}
[data-testid="ecoles-module"] input,[data-testid="ecoles-module"] select,[data-testid="ecoles-module"] textarea{background:#fff}
[data-testid="ecoles-module"] input:focus,[data-testid="ecoles-module"] select:focus,[data-testid="ecoles-module"] textarea:focus{outline:2px solid #C9A24B55;border-color:#C9A24B}
.ec-kpi{background:#fff;border:1px solid #EEE9DA;border-top:3px solid #C9A24B;border-radius:10px;box-shadow:0 1px 3px rgba(21,34,56,.07);padding:12px 14px}
.ec-card{background:#fff;border:1px solid #E4DFD1;border-radius:12px;box-shadow:0 1px 3px rgba(21,34,56,.06)}
.ec-tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:20px;padding:6px;background:#EFEBDD;border-radius:12px}
`;
const ecInput = "w-full border rounded px-2 py-1.5 text-sm mt-1";
const ecBorder = { borderColor: "#DDD6C4" };
const ecBtn = { background: "#152238", color: "#EFE9DD" };
const ecBtnGold = { background: "#C9A24B", color: "#152238" };


function ecTelecharger(nom, lignes) {
  const csv = "﻿" + lignes.map((r) => r.map((v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"').join(";")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = nom; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

