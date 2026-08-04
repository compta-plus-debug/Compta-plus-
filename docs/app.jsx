// Version "sans build" : pas d'imports ES module — React, ainsi que les icônes et
// graphiques ci-dessous (remplaçant lucide-react et recharts), sont des variables
// globales chargées directement par <script> dans index.html.
const { useState, useEffect, useMemo } = React;

// --- Supabase (chargé via CDN dans index.html, expose window.supabase.createClient) ---
const SUPABASE_URL = "https://cnmmxpwlgovzbcfqaxqm.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Ba1KJd2YY-eLaCy1FRECIA_C1DoyAjL";
let _supabaseClient = null;
function supabaseClient() {
  if (!_supabaseClient) {
    if (!window.supabase || !window.supabase.createClient) {
      throw new Error("Supabase n'est pas encore chargé — rechargez la page dans quelques secondes.");
    }
    _supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        fetch: (url, options = {}) => fetch(url, { ...options, cache: "no-store" }),
      },
    });
  }
  return _supabaseClient;
}
const supabase = new Proxy({}, {
  get(_target, prop) {
    const client = supabaseClient();
    const value = client[prop];
    return typeof value === "function" ? value.bind(client) : value;
  },
});

let _membership = null; // { companyId, role, email } — mis en cache après résolution

async function resolveMembership() {
  if (_membership) return _membership;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Utilisateur non connecté");

  let { data: existing } = await supabase
    .from("company_members")
    .select("company_id, role, email")
    .eq("user_id", user.id)
    .maybeSingle();
  if (existing) {
    _membership = { companyId: existing.company_id, role: existing.role, email: existing.email };
    return _membership;
  }

  const { data: invite } = await supabase
    .from("company_members")
    .select("id, company_id, role")
    .ilike("email", user.email)
    .is("user_id", null)
    .maybeSingle();
  if (invite) {
    await supabase.from("company_members").update({ user_id: user.id }).eq("id", invite.id);
    _membership = { companyId: invite.company_id, role: invite.role, email: user.email };
    return _membership;
  }

  const { data: company, error: companyErr } = await supabase
    .from("companies")
    .insert({ name: "Mon Entreprise" })
    .select()
    .single();
  if (companyErr) throw companyErr;

  await supabase.from("company_members").insert({
    company_id: company.id, email: user.email, user_id: user.id, role: "Administrateur",
  });

  _membership = { companyId: company.id, role: "Administrateur", email: user.email };
  return _membership;
}

function clearMembershipCache() {
  _membership = null;
}

window.storage = {
  async get(key) {
    const { companyId } = await resolveMembership();
    const { data, error } = await supabase.from("kv_store").select("value").eq("company_id", companyId).eq("key", key).maybeSingle();
    if (error || !data) return null;
    return { key, value: data.value, shared: false };
  },
  async set(key, value) {
    const { companyId } = await resolveMembership();
    const { error } = await supabase.from("kv_store").upsert({ company_id: companyId, key, value, updated_at: new Date().toISOString() }, { onConflict: "company_id,key" });
    if (error) throw error;
    return { key, value, shared: false };
  },
  async delete(key) {
    const { companyId } = await resolveMembership();
    const { error } = await supabase.from("kv_store").delete().eq("company_id", companyId).eq("key", key);
    return { key, deleted: !error, shared: false };
  },
  async list(prefix = "") {
    const { companyId } = await resolveMembership();
    const { data, error } = await supabase.from("kv_store").select("key").eq("company_id", companyId).like("key", `${prefix}%`);
    if (error) return { keys: [], prefix, shared: false };
    return { keys: (data || []).map((d) => d.key), prefix, shared: false };
  },
};

// --- Écran de connexion (lien magique par email) ---
function AuthGate({ children }) {
  const [session, setSession] = useState(undefined);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  const sendLink = async (e) => {
    e.preventDefault();
    setError("");
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
    if (error) setError(error.message);
    else setSent(true);
  };

  const signOut = () => {
    clearMembershipCache();
    supabase.auth.signOut();
  };

  if (session === undefined) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "sans-serif", color: "#152238" }}>
        Chargement…
      </div>
    );
  }

  if (!session) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#F7F5EF", fontFamily: "sans-serif" }}>
        <form onSubmit={sendLink} style={{ background: "#fff", padding: 32, borderRadius: 8, border: "1px solid #E4DFD1", width: 320 }}>
          <h1 style={{ fontSize: 20, marginBottom: 4, color: "#152238" }}>Compta+</h1>
          <p style={{ fontSize: 13, color: "#8A8370", marginBottom: 16 }}>
            Connectez-vous pour retrouver vos données sur tous vos appareils.
          </p>
          {sent ? (
            <p style={{ fontSize: 13, color: "#0F6B5C" }}>
              Lien de connexion envoyé à <strong>{email}</strong>. Vérifiez votre boîte mail et cliquez sur le lien.
            </p>
          ) : (
            <>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="votre@email.com"
                style={{ width: "100%", padding: 8, marginBottom: 12, border: "1px solid #DDD6C4", borderRadius: 4, boxSizing: "border-box" }} />
              <button type="submit" style={{ width: "100%", padding: 10, background: "#152238", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>
                Recevoir le lien de connexion
              </button>
              {error && <p style={{ color: "#A6432F", fontSize: 12, marginTop: 8 }}>{error}</p>}
            </>
          )}
        </form>
      </div>
    );
  }

  return (
    <>
      <button onClick={signOut} title="Se déconnecter"
        style={{ position: "fixed", bottom: 12, left: 12, zIndex: 50, fontSize: 11, padding: "4px 8px", background: "#fff", border: "1px solid #E4DFD1", borderRadius: 4, color: "#8A8370", cursor: "pointer" }}>
        Déconnexion ({session.user.email})
      </button>
      {children}
    </>
  );
}

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
const LayoutDashboard = (p) => <Icon {...p}><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></Icon>;
const BookOpen = (p) => <Icon {...p}><path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z" /><path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z" /></Icon>;
const Wallet = (p) => <Icon {...p}><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" /></Icon>;
const ShoppingCart = (p) => <Icon {...p}><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></Icon>;
const Truck = (p) => <Icon {...p}><rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></Icon>;
const Boxes = (p) => <Icon {...p}><path d="M2.5 7 12 2l9.5 5-9.5 5-9.5-5Z" /><path d="M2.5 7v10L12 22V12" /><path d="M21.5 7v10L12 22" /></Icon>;
const Users = (p) => <Icon {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></Icon>;
const BarChart3 = (p) => <Icon {...p}><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></Icon>;
const Settings = (p) => <Icon {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></Icon>;
const Menu = (p) => <Icon {...p}><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></Icon>;
const Pencil = (p) => <Icon {...p}><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="M15 5l4 4" /></Icon>;
const ImageIcon = (p) => <Icon {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></Icon>;

// --- Graphiques SVG maison (remplacent recharts pour un usage sans build) ---
function SimpleGroupedBarChart({ data, xKey, series }) {
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => d[s.key] || 0)));
  const H = 240, barW = 18, gap = 10, groupGap = 32;
  const groupW = series.length * barW + (series.length - 1) * gap;
  const W = Math.max(400, data.length * (groupW + groupGap) + groupGap);
  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={W} height={H + 50} style={{ minWidth: "100%" }}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={0} x2={W} y1={H - H * f} y2={H - H * f} stroke="#EEE9DA" />
        ))}
        {data.map((d, i) => {
          const gx = groupGap + i * (groupW + groupGap);
          return (
            <g key={i}>
              {series.map((s, j) => {
                const val = d[s.key] || 0;
                const h = (val / max) * (H - 10);
                return (
                  <rect key={s.key} x={gx + j * (barW + gap)} y={H - h} width={barW} height={h} rx={3} fill={s.color}>
                    <title>{s.name}: {fmt(val)}</title>
                  </rect>
                );
              })}
              <text x={gx + groupW / 2} y={H + 18} fontSize="11" textAnchor="middle" fill="#8A8370">{d[xKey]}</text>
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

const MODULES = [
  { id: "compta", n: 1, label: "Comptabilité", icon: BookOpen, ready: true },
  { id: "caisse", n: 2, label: "Caisse et banque", icon: Wallet, ready: true },
  { id: "vente", n: 3, label: "Vente (POS / Facturation)", icon: ShoppingCart, ready: true },
  { id: "achat", n: 4, label: "Achat et fournisseurs", icon: Truck, ready: true },
  { id: "stock", n: 5, label: "Stock et inventaire", icon: Boxes, ready: true },
  { id: "crm", n: 6, label: "Comptes clients (CRM)", icon: Users, ready: true },
  { id: "rapports", n: 7, label: "Rapports et analyse", icon: BarChart3, ready: true },
  { id: "admin", n: 8, label: "Administration", icon: Settings, ready: true },
];

const DEFAULT_ACCOUNTS = [
  { code: "101", name: "Capital", type: "Capitaux propres" },
  { code: "411", name: "Clients", type: "Actif" },
  { code: "401", name: "Fournisseurs", type: "Passif" },
  { code: "445", name: "Taxe collectée sur ventes (TVA/TCA)", type: "Passif" },
  { code: "512", name: "Banque", type: "Actif" },
  { code: "530", name: "Caisse", type: "Actif" },
  { code: "606", name: "Achats non stockés", type: "Charge" },
  { code: "607", name: "Achats de marchandises", type: "Charge" },
  { code: "641", name: "Charges de personnel", type: "Charge" },
  { code: "706", name: "Prestations de services", type: "Produit" },
  { code: "707", name: "Ventes de marchandises", type: "Produit" },
];

const DEFAULT_PRODUCTS = [
  { id: 1, code: "P001", name: "Prestation de conseil (h)", price: 60, tva: 20, type: "service", account: "706" },
  { id: 2, code: "P002", name: "Pack démarrage", price: 250, tva: 20, type: "service", account: "706" },
  { id: 3, code: "M001", name: "Article standard", price: 25, tva: 20, type: "marchandise", account: "707", stock: 40, seuil: 10 },
];

const DEFAULT_SUPPLIERS = [
  { id: 1, name: "Fournisseur Général SARL", contact: "" },
];

const DEFAULT_CLIENTS = [];

const TAX_SYSTEMS = {
  tva: { label: "TVA", defaultRate: 20, description: "Taxe sur la Valeur Ajoutée — déductible sur les achats" },
  tca: { label: "TCA", defaultRate: 10, description: "Taxe sur le Chiffre d'Affaires (Haïti) — taxe sur ventes/services, supportée par le consommateur final, non déductible" },
  aucune: { label: "Aucune taxe", defaultRate: 0, description: "Aucune taxe appliquée aux ventes" },
};

const DEFAULT_SETTINGS = {
  companyName: "Mon Entreprise",
  currency: "EUR",
  fiscalYearStart: "01-01",
  taxSystem: "tva", // "tva" | "tca" | "aucune"
  taxRate: 20,
  taxAccount: "445",
  taxDeductibleOnPurchases: true,
};
const DEFAULT_USERS = [{ id: 1, name: "Administrateur", email: "", role: "Administrateur" }];

const CURRENCIES = {
  EUR: { label: "Euro (EUR)", locale: "fr-FR" },
  USD: { label: "Dollar américain (USD)", locale: "en-US" },
  HTG: { label: "Gourde haïtienne (HTG)", locale: "fr-HT" },
};

// Devise active pour le formatage — mise à jour en direct par App() selon les paramètres.
// (variable de module plutôt que prop, car fmt() est appelée dans des dizaines d'endroits)
let CURRENT_CURRENCY = "EUR";

const fmt = (n) => {
  const code = CURRENT_CURRENCY;
  const locale = CURRENCIES[code]?.locale || "fr-FR";
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: code, maximumFractionDigits: 0 }).format(n || 0);
  } catch (e) {
    return `${Math.round(n || 0)} ${code}`;
  }
};

const monthLabel = (d) => {
  const dt = new Date(d);
  return dt.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
};

// Redimensionne et compresse une image uploadée (produit/service) avant stockage,
// pour éviter que le catalogue ne devienne trop lourd (limite de stockage par clé).
function resizeImage(file, maxSize = 160, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height) {
          if (width > maxSize) { height = Math.round(height * (maxSize / width)); width = maxSize; }
        } else {
          if (height > maxSize) { width = Math.round(width * (maxSize / height)); height = maxSize; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Construit une écriture équilibrée à 2 lignes (compte débité / compte crédité)
const simpleEntry = (date, label, debitAccount, creditAccount, amount) => ({
  id: Date.now() + Math.random(),
  date,
  label,
  lines: [
    { account: debitAccount, debit: amount, credit: 0 },
    { account: creditAccount, debit: 0, credit: amount },
  ],
});

function App() {
  const [active, setActive] = useState("dashboard");
  const [accounts, setAccounts] = useState(DEFAULT_ACCOUNTS);
  const [entries, setEntries] = useState([]);
  const [products, setProducts] = useState(DEFAULT_PRODUCTS);
  const [invoices, setInvoices] = useState([]);
  const [suppliers, setSuppliers] = useState(DEFAULT_SUPPLIERS);
  const [purchases, setPurchases] = useState([]);
  const [movements, setMovements] = useState([]);
  const [clients, setClients] = useState(DEFAULT_CLIENTS);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [users, setUsers] = useState(DEFAULT_USERS);
  const [loaded, setLoaded] = useState(false);
  const [role, setRole] = useState("Administrateur");
  const readOnly = role === "Lecture seule";
  const [toast, setToast] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);

  useEffect(() => {
    const onPrompt = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    const onInstalled = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get("compta-data");
        if (res && res.value) {
          const parsed = JSON.parse(res.value);
          if (parsed.accounts) setAccounts(parsed.accounts);
          if (parsed.entries) setEntries(parsed.entries);
          if (parsed.products) setProducts(parsed.products);
          if (parsed.invoices) setInvoices(parsed.invoices);
          if (parsed.suppliers) setSuppliers(parsed.suppliers);
          if (parsed.purchases) setPurchases(parsed.purchases);
          if (parsed.movements) setMovements(parsed.movements);
          if (parsed.clients) setClients(parsed.clients);
          if (parsed.settings) setSettings(parsed.settings);
          if (parsed.users) setUsers(parsed.users);
        }
      } catch (e) {
        // pas de données existantes
      }
      try {
        const membership = await resolveMembership();
        setRole(membership.role);
      } catch (e) {
        // pas de session Supabase
      }
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    (async () => {
      try {
        await window.storage.set("compta-data", JSON.stringify({ accounts, entries, products, invoices, suppliers, purchases, movements, clients, settings, users }));
      } catch (e) {
        console.error("Erreur d'enregistrement", e);
      }
    })();
  }, [accounts, entries, products, invoices, suppliers, purchases, movements, clients, settings, users, loaded]);

  // Applique la devise choisie dans les paramètres à toutes les mises en forme monétaires
  CURRENT_CURRENCY = settings.currency || "EUR";

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const balances = useMemo(() => {
    const b = {};
    accounts.forEach((a) => (b[a.code] = 0));
    entries.forEach((e) => {
      (e.lines || []).forEach((l) => {
        b[l.account] = (b[l.account] || 0) + Number(l.debit || 0) - Number(l.credit || 0);
      });
    });
    return b;
  }, [accounts, entries]);

  const kpis = useMemo(() => {
    const sumType = (type, sign = 1) =>
      accounts
        .filter((a) => a.type === type)
        .reduce((s, a) => s + sign * (balances[a.code] || 0), 0);
    const produits = sumType("Produit", -1);
    const charges = sumType("Charge", 1);
    const tresorerie = (balances["512"] || 0) + (balances["530"] || 0);
    return {
      produits,
      charges,
      resultat: produits - charges,
      tresorerie,
    };
  }, [accounts, balances]);

  const chartData = useMemo(() => {
    const byMonth = {};
    entries.forEach((e) => {
      const key = monthLabel(e.date);
      if (!byMonth[key]) byMonth[key] = { mo
{active !== "dashboard" && active !== "compta" && active !== "caisse" && active !== "vente" && active !== "achat" && active !== "stock" && active !== "crm" && active !== "rapports" && active !== "admin" && (
          <ComingSoon module={MODULES.find((m) => m.id === active)} />
        )}
        </fieldset>
      </main>

      {toast && (
        <div
          className="fixed bottom-6 right-6 px-4 py-3 rounded shadow-lg text-sm no-print"
          style={{ background: "#152238", color: "#EFE9DD", border: "1px solid #C9A24B" }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

function Card({ label, value, accent }) {
  return (
    <div className="rounded-lg p-5 bg-white" style={{ border: "1px solid #E4DFD1" }}>
      <div className="text-xs uppercase tracking-widest" style={{ color: "#8A8370" }}>{label}</div>
      <div className="tabular text-2xl mt-2" style={{ color: accent || "#152238" }}>{fmt(value)}</div>
    </div>
  );
}

function Dashboard({ kpis, chartData, entriesCount, installPrompt, onInstallClick }) {
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
                <p className="mb-2"><b>Android (Chrome)</b> : menu ⋮ en haut à droite → « Installer l'application » ou « Ajouter à l'écran d'accueil ».</p>
                <p className="mb-2"><b>iPhone/iPad (Safari)</b> : bouton Partager (carré avec flèche) → « Sur l'écran d'accueil ».</p>
                <p><b>Windows/Mac (Chrome ou Edge)</b> : icône d'installation dans la barre d'adresse, à droite de l'URL.</p>
                <button onClick={() => setShowIosHelp(false)} className="mt-3 underline" style={{ color: "#152238" }}>Fermer</button>
              </div>
            )}
          </div>
        )}
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <Card label="Produits" value={kpis.produits} accent="#0F6B5C" />
        <Card label="Charges" value={kpis.charges} accent="#A6432F" />
        <Card label="Résultat" value={kpis.resultat} accent={kpis.resultat >= 0 ? "#0F6B5C" : "#A6432F"} />
        <Card label="Trésorerie (Banque + Caisse)" value={kpis.tresorerie} />
      </div>

      <div className="bg
