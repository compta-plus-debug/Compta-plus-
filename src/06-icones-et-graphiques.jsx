// ═══ MODULE ═══
// @module Icones et graphiques
// @depends fmt
// @exports ArrowDownCircle, ArrowUpCircle, BadgeDollar, BarChart3, BluetoothIcon, BookOpen, Boxes
//   CheckCircle2, ChevronRight, Circle, ClipboardIcon, CreditCard, Cross, Download, Eye, EyeOff
//   FileDown, History, Icon, ImageIcon, LayoutDashboard, Lock, Menu, MessageCircle, Minus, Pencil
//   Plus, Printer, Receipt, RotateCcw, ScanLine, Send, Settings, ShoppingCart, SimpleDonutChart
//   SimpleGroupedBarChart, SimpleGrowthBarChart, SimpleLineChart, Smartphone, Trash2, Truck, Users
//   Wallet, X
// ═══ FIN DE L'EN-TÊTE ═══
// --- Icônes (SVG minimalistes, remplacent lucide-react pour un usage sans build) ---
const Icon = ({ children, size = 16, style, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style} className={className}>
    {children}
  </svg>
);
const Plus = (p) => <Icon {...p}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></Icon>;
const Trash2 = (p) => <Icon {...p}><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></Icon>;
const X = (p) => <Icon {...p}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></Icon>;
const ChevronRight = (p) => <Icon {...p}><polyline points="9 18 15 12 9 6" /></Icon>;
const Lock = (p) => <Icon {...p}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></Icon>;
const Eye = (p) => <Icon {...p}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" /><circle cx="12" cy="12" r="3" /></Icon>;
const EyeOff = (p) => <Icon {...p}><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a19.86 19.86 0 0 1 4.22-5.94M9.9 4.24A10.9 10.9 0 0 1 12 4c7 0 11 8 11 8a19.83 19.83 0 0 1-2.16 3.19" /><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></Icon>;
const ArrowDownCircle = (p) => <Icon {...p}><circle cx="12" cy="12" r="10" /><polyline points="8 12 12 16 16 12" /><line x1="12" y1="8" x2="12" y2="16" /></Icon>;
const ArrowUpCircle = (p) => <Icon {...p}><circle cx="12" cy="12" r="10" /><polyline points="16 12 12 8 8 12" /><line x1="12" y1="16" x2="12" y2="8" /></Icon>;
const CheckCircle2 = (p) => <Icon {...p}><circle cx="12" cy="12" r="10" /><polyline points="9 12 12 15 16 9" /></Icon>;
const Circle = (p) => <Icon {...p}><circle cx="12" cy="12" r="10" /></Icon>;
const Minus = (p) => <Icon {...p}><line x1="5" y1="12" x2="19" y2="12" /></Icon>;
const Receipt = (p) => <Icon {...p}><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" /><line x1="8" y1="7" x2="16" y2="7" /><line x1="8" y1="11" x2="16" y2="11" /></Icon>;
const Download = (p) => <Icon {...p}><path d="M12 3v12" /><polyline points="7 10 12 15 17 10" /><line x1="4" y1="21" x2="20" y2="21" /></Icon>;
const Upload = (p) => <Icon {...p}><path d="M12 21V9" /><polyline points="7 14 12 9 17 14" /><line x1="4" y1="3" x2="20" y2="3" /></Icon>;
const RotateCcw = (p) => <Icon {...p}><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 .49-8.49L1 10" /></Icon>;
const FileDown = (p) => <Icon {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="12" x2="12" y2="18" /><polyline points="9 15 12 18 15 15" /></Icon>;
const Printer = (p) => <Icon {...p}><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></Icon>;
const BluetoothIcon = (p) => <Icon {...p}><polygon points="6.5 6.5 17.5 17.5 12 23 12 1 17.5 6.5 6.5 17.5" /></Icon>;
const LayoutDashboard = (p) => <Icon {...p}><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></Icon>;
const BookOpen = (p) => <Icon {...p}><path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z" /><path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z" /></Icon>;
const Wallet = (p) => <Icon {...p}><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" /></Icon>;
const ShoppingCart = (p) => <Icon {...p}><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></Icon>;
const Cross = (p) => <Icon {...p}><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" /></Icon>;
const Truck = (p) => <Icon {...p}><rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></Icon>;
const History = (p) => <Icon {...p}><path d="M3 3v5h5" /><path d="M3.05 13a9 9 0 1 0 2.13-7.36L3 8" /><polyline points="12 7 12 12 16 14" /></Icon>;
const Smartphone = (p) => <Icon {...p}><rect x="5" y="2" width="14" height="20" rx="2" /><line x1="12" y1="18" x2="12.01" y2="18" /></Icon>;
const MessageCircle = (p) => <Icon {...p}><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></Icon>;
const Send = (p) => <Icon {...p}><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></Icon>;
const CreditCard = (p) => <Icon {...p}><rect x="1" y="4" width="22" height="16" rx="2" /><line x1="1" y1="10" x2="23" y2="10" /></Icon>;
const Boxes = (p) => <Icon {...p}><path d="M2.5 7 12 2l9.5 5-9.5 5-9.5-5Z" /><path d="M2.5 7v10L12 22V12" /><path d="M21.5 7v10L12 22" /></Icon>;
const Users = (p) => <Icon {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></Icon>;
const BarChart3 = (p) => <Icon {...p}><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></Icon>;
const Settings = (p) => <Icon {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></Icon>;
const Menu = (p) => <Icon {...p}><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></Icon>;
const Pencil = (p) => <Icon {...p}><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="M15 5l4 4" /></Icon>;
const ImageIcon = (p) => <Icon {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></Icon>;
const ScanLine = (p) => <Icon {...p}><path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" /><path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" /><line x1="3" y1="12" x2="21" y2="12" /></Icon>;
const ClipboardIcon = (p) => <Icon {...p}><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4h6v3H9z" /><path d="M9 12h6M9 16h4" /></Icon>;
const BadgeDollar = (p) => <Icon {...p}><circle cx="12" cy="12" r="8" /><path d="M12 7v10" /><path d="M14.5 9.5c0-1-1-1.5-2.5-1.5s-2.5.6-2.5 1.6c0 2.3 5 1 5 3.3 0 1-1 1.6-2.5 1.6s-2.5-.5-2.5-1.5" /></Icon>;

// --- Graphiques SVG maison (remplacent recharts pour un usage sans build) ---
function SimpleGroupedBarChart({ data, xKey, series }) {
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => d[s.key] || 0)));
  const H = 240, barW = 18, gap = 10;
  // Marge réservée en haut pour que l'étiquette de la barre la plus haute (souvent
  // très proche du sommet du graphique) ne soit jamais coupée par le bord du SVG.
  const topPad = 18;
  const groupW = series.length * barW + (series.length - 1) * gap;
  // Espacement adapté à la longueur réelle des étiquettes de l'axe (ex. des noms
  // d'entreprises peuvent être bien plus longs qu'un mois) — sans effet quand les
  // étiquettes sont courtes, l'espacement minimal (32) reste alors inchangé.
  const estCharWidth = 6.2; // approximation pour une police de 11px
  const longestLabelWidth = Math.max(0, ...data.map((d) => String(d[xKey] ?? "").length * estCharWidth));
  const groupGap = Math.max(32, longestLabelWidth - groupW + 20);
  const W = Math.max(400, data.length * (groupW + groupGap) + groupGap);
  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={W} height={H + 50 + topPad} style={{ minWidth: "100%" }}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={0} x2={W} y1={topPad + H - H * f} y2={topPad + H - H * f} stroke="#EEE9DA" />
        ))}
        {data.map((d, i) => {
          const gx = groupGap + i * (groupW + groupGap);
          return (
            <g key={i}>
              {series.map((s, j) => {
                const val = d[s.key] || 0;
                const h = (val / max) * (H - 10);
                return (
                  <rect key={s.key} x={gx + j * (barW + gap)} y={topPad + H - h} width={barW} height={h} rx={3} fill={s.color}>
                    <title>{s.name}: {fmt(val)}</title>
                  </rect>
                );
              })}
              <text x={gx + groupW / 2} y={topPad + H + 18} fontSize="11" textAnchor="middle" fill="#8A8370">{d[xKey]}</text>
            </g>
          );
        })}
      </svg>
      <div className="flex gap-4 mt-2 justify-center text-xs" style={{ color: "#8A8370" }}>
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1">
            <span style={{ width: 10, height: 10, background: s.color, display: "inline-block", borderRadius: 2 }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

// Barres de croissance : contrairement à SimpleGroupedBarChart (toujours positif), ce
// graphique part d'une ligne zéro centrale et affiche les barres vers le haut (croissance)
// ou vers le bas (baisse), en vert/rouge, avec le montant et le pourcentage en infobulle.
function SimpleGrowthBarChart({ data, xKey, valueKey, pctKey }) {
  const maxAbs = Math.max(1, ...data.map((d) => Math.abs(d[valueKey] || 0)));
  const H = 220, barW = 28, gap = 58;
  const W = Math.max(400, data.length * (barW + gap) + gap);
  // Marge en haut ET en bas : les étiquettes (2 lignes) d'une barre extrême peuvent
  // sinon se faire couper par le bord du SVG, comme pour SimpleGroupedBarChart.
  const topPad = 26;
  const zeroY = topPad + H / 2;
  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={W} height={H + topPad * 2 + 52} style={{ minWidth: "100%" }}>
        <line x1={0} x2={W} y1={zeroY} y2={zeroY} stroke="#DDD6C4" />
        <line x1={0} x2={W} y1={topPad + H + 8} y2={topPad + H + 8} stroke="#EEE9DA" />
        {data.map((d, i) => {
          const val = d[valueKey] || 0;
          const gx = gap + i * (barW + gap);
          const h = (Math.abs(val) / maxAbs) * (H / 2 - 38);
          const color = val >= 0 ? "#0F6B5C" : "#A6432F";
          const pct = d[pctKey];
          return (
            <g key={i}>
              <rect x={gx} y={val >= 0 ? zeroY - h : zeroY} width={barW} height={h} rx={3} fill={color}>
                <title>{d[xKey]} : {val >= 0 ? "+" : ""}{fmt(val)}{pct !== null && pct !== undefined ? ` (${val >= 0 ? "+" : ""}${pct.toFixed(1)}%)` : ""}</title>
              </rect>
              <text x={gx + barW / 2} y={val >= 0 ? zeroY - h - 6 : zeroY + h + 14} fontSize="9" textAnchor="middle" fill={color} className="tabular">
                {pct !== null && pct !== undefined ? `${val >= 0 ? "+" : ""}${pct.toFixed(0)}%` : ""}
              </text>
              <text x={gx + barW / 2} y={val >= 0 ? zeroY - h - 18 : zeroY + h + 26} fontSize="8" textAnchor="middle" fill="#8A8370" className="tabular">
                {val >= 0 ? "+" : ""}{fmt(val)}
              </text>
              <text x={gx + barW / 2} y={topPad + H + 28} fontSize="11" textAnchor="middle" fill="#8A8370">{d[xKey]}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function SimpleLineChart({ data, xKey, yKey, color, name }) {
  const max = Math.max(1, ...data.map((d) => d[yKey] || 0));
  const H = 220, W = Math.max(400, data.length * 90);
  const stepX = data.length > 1 ? (W - 40) / (data.length - 1) : 0;
  const points = data.map((d, i) => {
    const x = 20 + i * stepX;
    const y = H - ((d[yKey] || 0) / max) * (H - 20) - 5;
    return { x, y, val: d[yKey] || 0, label: d[xKey] };
  });
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={W} height={H + 30} style={{ minWidth: "100%" }}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={0} x2={W} y1={H - H * f + 5} y2={H - H * f + 5} stroke="#EEE9DA" />
        ))}
        <path d={path} fill="none" stroke={color} strokeWidth={2} />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={3.5} fill={color}>
              <title>{name} — {p.label}: {fmt(p.val)}</title>
            </circle>
            <text x={p.x} y={H + 20} fontSize="11" textAnchor="middle" fill="#8A8370">{p.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function SimpleDonutChart({ data, nameKey, valueKey, colors }) {
  const total = data.reduce((s, d) => s + (d[valueKey] || 0), 0);
  const palette = colors || ["#0F6B5C", "#9A7B1E", "#3F4F73", "#A6432F", "#7C6BAA", "#5B8A72", "#C9A24B", "#6E8CA0"];
  const size = 220, cx = size / 2, cy = size / 2, rOuter = 100, rInner = 55;
  let angleStart = -Math.PI / 2;
  const arcs = data.map((d, i) => {
    const value = d[valueKey] || 0;
    const frac = total > 0 ? value / total : 0;
    const angleEnd = angleStart + frac * Math.PI * 2;
    const largeArc = angleEnd - angleStart > Math.PI ? 1 : 0;
    const x1 = cx + rOuter * Math.cos(angleStart), y1 = cy + rOuter * Math.sin(angleStart);
    const x2 = cx + rOuter * Math.cos(angleEnd), y2 = cy + rOuter * Math.sin(angleEnd);
    const x3 = cx + rInner * Math.cos(angleEnd), y3 = cy + rInner * Math.sin(angleEnd);
    const x4 = cx + rInner * Math.cos(angleStart), y4 = cy + rInner * Math.sin(angleStart);
    const path = `M${x1},${y1} A${rOuter},${rOuter} 0 ${largeArc} 1 ${x2},${y2} L${x3},${y3} A${rInner},${rInner} 0 ${largeArc} 0 ${x4},${y4} Z`;
    const color = palette[i % palette.length];
    angleStart = angleEnd;
    return { path, color, name: d[nameKey], value, pct: total > 0 ? Math.round((value / total) * 100) : 0 };
  });
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg width={size} height={size} style={{ flexShrink: 0 }}>
        {arcs.map((a, i) => (
          <path key={i} d={a.path} fill={a.color}>
            <title>{a.name} — {fmt(a.value)} ({a.pct}%)</title>
          </path>
        ))}
        <text x={cx} y={cy - 3} textAnchor="middle" fontSize="11" fill="#8A8370">Total</text>
        <text x={cx} y={cy + 13} textAnchor="middle" fontSize="13" fontWeight="700" fill="#152238" className="tabular">{fmt(total)}</text>
      </svg>
      <div className="flex-1 min-w-[160px] space-y-1.5">
        {arcs.map((a, i) => (
          <div key={i} className="flex items-center justify-between text-sm gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span style={{ width: 10, height: 10, borderRadius: 2, background: a.color, flexShrink: 0, display: "inline-block" }} />
              <span className="truncate" style={{ color: "#152238" }}>{a.name}</span>
            </div>
            <span className="tabular flex-shrink-0" style={{ color: "#8A8370" }}>{fmt(a.value)} ({a.pct}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

