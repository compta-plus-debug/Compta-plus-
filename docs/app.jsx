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

  let { data: existingRows, error: existingErr } = await supabase
    .from("company_members")
    .select("company_id, role, email")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1);
  if (existingErr) {
    throw new Error(`Impossible de vérifier votre entreprise (${existingErr.message || existingErr.code || "erreur inconnue"}). Une nouvelle entreprise n'a pas été créée pour éviter de dupliquer vos données — contactez le support avec ce message.`);
  }
  const existing = existingRows && existingRows[0];
  if (existing) {
    _membership = { companyId: existing.company_id, role: existing.role, email: existing.email };
    return _membership;
  }

  const { data: inviteRows, error: inviteErr } = await supabase
    .from("company_members")
    .select("id, company_id, role")
    .ilike("email", user.email)
    .is("user_id", null)
    .order("created_at", { ascending: true })
    .limit(1);
  if (inviteErr) {
    throw new Error(`Impossible de vérifier votre invitation (${inviteErr.message || inviteErr.code || "erreur inconnue"}). Une nouvelle entreprise n'a pas été créée pour éviter de dupliquer vos données — contactez le support avec ce message.`);
  }
  const invite = inviteRows && inviteRows[0];
  if (invite) {
    const { data: claimedRows, error: claimErr } = await supabase
      .from("company_members")
      .update({ user_id: user.id })
      .eq("id", invite.id)
      .select("id");
    if (claimErr || !claimedRows || claimedRows.length === 0) {
      throw new Error(
        `Votre invitation a été trouvée mais n'a pas pu être finalisée` +
        (claimErr ? ` (${claimErr.message || claimErr.code})` : " (aucune ligne mise à jour, probablement bloqué par une règle de sécurité)") +
        `. Une nouvelle entreprise n'a pas été créée pour éviter de dupliquer vos données — contactez le support avec ce message.`
      );
    }
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
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href.split(/[?#]/)[0] } });
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

  // --- Synchronisation multi-utilisateurs ---
  // Chaque catégorie de données a sa propre clé kv_store (au lieu d'un seul bloc
  // "compta-data" partagé) : deux utilisateurs qui modifient des modules différents
  // ne s'écrasent plus mutuellement. Pour les catégories qui sont des listes (tableaux
  // avec un "id" par élément), on fusionne avec le serveur avant chaque écriture au lieu
  // d'écraser — ainsi les ajouts faits par l'autre utilisateur entre-temps ne sont pas perdus.
  const settersByCategory = {
    accounts: setAccounts, entries: setEntries, products: setProducts,
    invoices: setInvoices, suppliers: setSuppliers, purchases: setPurchases,
    movements: setMovements, clients: setClients, settings: setSettings, users: setUsers,
  };
  const CATEGORIES = Object.keys(settersByCategory);

  // Instantané de la dernière version connue du serveur, par catégorie. Sert à
  // distinguer une suppression volontaire (l'élément était connu avant, il a disparu
  // localement) d'un élément simplement pas encore vu localement (ajouté ailleurs).
  // Sans ça, la fusion ne pouvait qu'ajouter des éléments, jamais en retirer : toute
  // suppression était annulée dès la sauvegarde suivante (l'élément "ressuscitait").
  const serverSnapshotRef = React.useRef({});

  // Fusionne deux tableaux d'objets par une clé unique en respectant les suppressions :
  // un élément présent dans "baseline" mais absent de "localArr" a été supprimé
  // volontairement et n'est jamais réintroduit, même s'il traîne encore côté serveur.
  // La clé dépend de la catégorie : les comptes n'ont pas de champ "id" (seulement
  // "code"), donc on ne peut pas toujours utiliser "id" — sinon tous les comptes sont
  // traités comme un seul et même élément et la liste s'effondre à un seul compte.
  const mergeByKey = (serverArr, localArr, keyFn, baselineArr) => {
    if (!Array.isArray(serverArr) || !Array.isArray(localArr)) return localArr;
    const baseline = Array.isArray(baselineArr) ? baselineArr : [];
    const keyOf = (item) => item && keyFn(item);
    const baselineKeys = new Set(baseline.map(keyOf).filter((k) => k !== undefined && k !== null));
    const localKeys = new Set(localArr.map(keyOf).filter((k) => k !== undefined && k !== null));
    const deletedKeys = new Set([...baselineKeys].filter((k) => !localKeys.has(k)));
    const map = new Map();
    serverArr.forEach((item) => {
      const k = keyOf(item);
      if (k !== undefined && k !== null && !deletedKeys.has(k)) map.set(k, item);
    });
    localArr.forEach((item) => {
      const k = keyOf(item);
      if (k !== undefined && k !== null) map.set(k, item);
    });
    return Array.from(map.values());
  };

  const MERGE_KEY_BY_CATEGORY = {
    accounts: (item) => item.code,
  };

  // File d'attente par catégorie : si plusieurs sauvegardes sont déclenchées coup sur
  // coup (ex. modifier un article puis en supprimer un autre juste après), chacune fait
  // un GET-fusion-SET qui n'est pas instantané. Sans sérialisation, une sauvegarde plus
  // ancienne peut se terminer APRÈS une plus récente et écraser son résultat — une
  // suppression pouvait ainsi être annulée par une sauvegarde partie juste avant elle.
  // En chaînant chaque sauvegarde après la précédente (pour la même catégorie), chacune
  // ne lit le serveur qu'une fois la précédente totalement terminée.
  const saveQueueRef = React.useRef({});
  // Horodatage de la dernière sauvegarde RÉUSSIE (par nous-mêmes) par catégorie. Sert à
  // ignorer une notification temps réel qui arrive juste après : dans cette fenêtre, on
  // sait que notre état local est déjà le plus à jour, donc une notification (même en
  // retard par rapport à une action encore plus récente comme une suppression) ne doit
  // jamais écraser ce qu'on vient nous-mêmes d'enregistrer.
  const lastLocalSaveAtRef = React.useRef({});

  const saveCategory = (category, value) => {
    const previous = saveQueueRef.current[category] || Promise.resolve();
    const run = previous.then(async () => {
      try {
        let toSave = value;
        if (Array.isArray(value)) {
          const res = await window.storage.get(`compta-${category}`).catch(() => null);
          const serverValue = res && res.value ? JSON.parse(res.value) : [];
          const keyFn = MERGE_KEY_BY_CATEGORY[category] || ((item) => item.id);
          toSave = mergeByKey(serverValue, value, keyFn, serverSnapshotRef.current[category]);
        }
        await window.storage.set(`compta-${category}`, JSON.stringify(toSave));
        if (Array.isArray(toSave)) serverSnapshotRef.current[category] = toSave;
        lastLocalSaveAtRef.current[category] = Date.now();
      } catch (e) {
        console.error(`Erreur d'enregistrement (${category})`, e);
      }
    });
    // On garde la trace de cette exécution pour la suivante, sans jamais laisser une
    // erreur casser la chaîne (sinon toutes les sauvegardes suivantes resteraient bloquées).
    saveQueueRef.current[category] = run.catch(() => {});
    return run;
  };

  useEffect(() => {
    (async () => {
      try {
        const results = await Promise.all(
          CATEGORIES.map((c) => window.storage.get(`compta-${c}`).catch(() => null))
        );
        let anyFound = false;
        results.forEach((res, i) => {
          if (res && res.value !== undefined && res.value !== null) {
            anyFound = true;
            try {
              const parsed = JSON.parse(res.value);
              settersByCategory[CATEGORIES[i]](parsed);
              if (Array.isArray(parsed)) serverSnapshotRef.current[CATEGORIES[i]] = parsed;
            } catch (e) {}
          }
        });
        // Migration : si aucune des nouvelles clés n'existe encore mais l'ancien bloc
        // unique "compta-data" en a, on le lit une seule fois pour ne rien perdre.
        if (!anyFound) {
          try {
            const old = await window.storage.get("compta-data");
            if (old && old.value) {
              const parsed = JSON.parse(old.value);
              CATEGORIES.forEach((c) => { if (parsed[c] !== undefined) settersByCategory[c](parsed[c]); });
            }
          } catch (e) {}
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

  useEffect(() => { if (loaded) saveCategory("accounts", accounts); }, [accounts, loaded]);
  useEffect(() => { if (loaded) saveCategory("entries", entries); }, [entries, loaded]);
  useEffect(() => { if (loaded) saveCategory("products", products); }, [products, loaded]);
  useEffect(() => { if (loaded) saveCategory("invoices", invoices); }, [invoices, loaded]);
  useEffect(() => { if (loaded) saveCategory("suppliers", suppliers); }, [suppliers, loaded]);
  useEffect(() => { if (loaded) saveCategory("purchases", purchases); }, [purchases, loaded]);
  useEffect(() => { if (loaded) saveCategory("movements", movements); }, [movements, loaded]);
  useEffect(() => { if (loaded) saveCategory("clients", clients); }, [clients, loaded]);
  useEffect(() => { if (loaded) saveCategory("settings", settings); }, [settings, loaded]);
  useEffect(() => { if (loaded) saveCategory("users", users); }, [users, loaded]);

  // Synchronisation en temps réel : quand l'autre utilisateur enregistre une donnée,
  // ce navigateur la reçoit immédiatement sans avoir besoin de recharger la page.
  useEffect(() => {
    if (!loaded) return;
    let channel;
    (async () => {
      try {
        const { companyId } = await resolveMembership();
        channel = supabase
          .channel(`kv_store_changes_${companyId}`)
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "kv_store", filter: `company_id=eq.${companyId}` },
            (payload) => {
              const row = payload.new || payload.old;
              if (!row || !row.key || !row.key.startsWith("compta-")) return;
              const category = row.key.replace("compta-", "");
              const setter = settersByCategory[category];
              if (!setter || row.value === undefined || row.value === null) return;
              // On vient nous-mêmes de sauvegarder cette catégorie il y a moins de 4
              // secondes : notre état local est déjà à jour, donc on ignore cette
              // notification pour ne jamais risquer de faire réapparaître un élément
              // qu'on vient de supprimer (notification en retard sur une action plus
              // récente que celle qu'elle décrit).
              if (Date.now() - (lastLocalSaveAtRef.current[category] || 0) < 4000) return;
              try {
                const parsed = JSON.parse(row.value);
                // On adopte directement la valeur reçue comme vérité (c'est l'état
                // réellement enregistré côté serveur au moment de l'évènement), au lieu
                // de la fusionner avec l'état local. Une fusion ici pouvait, si cette
                // notification arrivait un peu en retard par rapport à notre propre
                // suppression, réintroduire par erreur un élément qu'on venait de
                // supprimer (la fusion ne pouvait alors plus distinguer "élément
                // supprimé volontairement" de "élément simplement plus ancien").
                setter(parsed);
                if (Array.isArray(parsed)) serverSnapshotRef.current[category] = parsed;
              } catch (e) {}
            }
          )
          .subscribe();
      } catch (e) {
        // pas de session Supabase, pas de temps réel possible
      }
    })();
    return () => { if (channel) supabase.removeChannel(channel); };
  }, [loaded]);

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
      if (!byMonth[key]) byMonth[key] = { mois: key, produits: 0, charges: 0 };
      (e.lines || []).forEach((l) => {
        const acc = accounts.find((a) => a.code === l.account);
        if (acc?.type === "Produit") byMonth[key].produits += Number(l.credit || 0);
        if (acc?.type === "Charge") byMonth[key].charges += Number(l.debit || 0);
      });
    });
    return Object.values(byMonth);
  }, [entries, accounts]);

  return (
    <div className="min-h-screen flex flex-col md:flex-row" style={{ background: "#F7F5EF", fontFamily: "'Source Sans Pro', 'Inter', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Spectral:wght@500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap');
        .tabular { font-family: 'IBM Plex Mono', monospace; font-variant-numeric: tabular-nums; }
        .display { font-family: 'Spectral', serif; }
        @media print {
          .no-print { display: none !important; }
          main { width: 100% !important; }
          body { background: #fff !important; }
        }
      `}</style>

      {/* Sidebar */}
      {/* Barre mobile */}
      <div className="md:hidden flex items-center gap-3 px-4 py-3 no-print" style={{ background: "#152238" }}>
        <button onClick={() => setMobileMenuOpen(true)} style={{ color: "#EFE9DD" }} aria-label="Ouvrir le menu">
          <Menu size={22} />
        </button>
        <span className="display text-lg" style={{ color: "#EFE9DD" }}>Compta+</span>
      </div>

      {/* Fond assombri derrière le tiroir, sur mobile uniquement */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 md:hidden no-print" style={{ background: "rgba(0,0,0,0.45)" }} onClick={() => setMobileMenuOpen(false)} />
      )}

      <aside
        className={`fixed md:static inset-y-0 left-0 z-50 w-64 shrink-0 flex flex-col no-print transform transition-transform duration-200 md:translate-x-0 ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full"}`}
        style={{ background: "#152238", color: "#EFE9DD" }}
      >
        <div className="px-5 py-6 border-b flex items-center justify-between gap-3" style={{ borderColor: "#28395A" }}>
          <div className="flex items-center gap-3">
          <svg width="34" height="34" viewBox="0 0 512 512" style={{ flexShrink: 0, borderRadius: 8 }}>
            <rect width="512" height="512" rx="112" fill="#14458F" />
            <circle cx="256" cy="256" r="150" fill="#FFFFFF" />
            <path d="M256,256 L429.2,156 A200,200 0 0,1 429.2,356 Z" fill="#14458F" />
            <rect x="341" y="239" width="90" height="34" rx="10" fill="#1FA97A" />
            <rect x="369" y="211" width="34" height="90" rx="10" fill="#1FA97A" />
          </svg>
          <div>
            <div className="display text-xl tracking-wide" style={{ color: "#EFE9DD" }}>Compta+</div>
            <div className="text-xs" style={{ color: "#8A97B5" }}>{settings.companyName || "Centre de contrôle ERP"}</div>
          </div>
          </div>
          <button onClick={() => setMobileMenuOpen(false)} className="md:hidden" style={{ color: "#8A97B5" }} aria-label="Fermer le menu">
            <X size={18} />
          </button>
        </div>
        <nav className="flex-1 py-3">
          <button
            onClick={() => { setActive("dashboard"); setMobileMenuOpen(false); }}
            className="w-full flex items-center gap-3 px-5 py-3 text-sm transition-colors"
            style={{
              background: active === "dashboard" ? "#1F3358" : "transparent",
              color: active === "dashboard" ? "#EFE9DD" : "#AEB8CE",
              borderLeft: active === "dashboard" ? "3px solid #C9A24B" : "3px solid transparent",
            }}
          >
            <LayoutDashboard size={16} />
            Tableau de bord
          </button>
          <div className="mt-2 px-5 pt-3 pb-1 text-[10px] uppercase tracking-widest" style={{ color: "#5C6B8C" }}>
            Modules
          </div>
          {MODULES.map((m) => {
            const Icon = m.icon;
            const isActive = active === m.id;
            return (
              <button
                key={m.id}
                onClick={() => { setActive(m.id); setMobileMenuOpen(false); }}
                className="w-full flex items-center gap-3 px-5 py-3 text-sm transition-colors"
                style={{
                  background: isActive ? "#1F3358" : "transparent",
                  color: isActive ? "#EFE9DD" : m.ready ? "#AEB8CE" : "#5C6B8C",
                  borderLeft: isActive ? "3px solid #C9A24B" : "3px solid transparent",
                }}
              >
                <span className="tabular text-xs w-4" style={{ color: "#6C7A9C" }}>{m.n}</span>
                <Icon size={16} />
                <span className="flex-1 text-left">{m.label}</span>
                {!m.ready && <Lock size={12} style={{ color: "#4A587A" }} />}
              </button>
            );
          })}
        </nav>
        <div className="px-5 py-4 text-[11px] border-t" style={{ borderColor: "#28395A", color: "#5C6B8C" }}>
          {readOnly ? (
            <span style={{ color: "#D9A441" }}>Mode lecture seule — les modifications sont désactivées.</span>
          ) : (
            <>Rôle : {role}</>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0">
        {active === "dashboard" && (
          <Dashboard
            kpis={kpis}
            chartData={chartData}
            entriesCount={entries.length}
            installPrompt={installPrompt}
            onInstallClick={handleInstallClick}
          />
        )}
        <fieldset disabled={readOnly} className="contents">
        {active === "compta" && (
          <ComptaModule
            accounts={accounts}
            setAccounts={setAccounts}
            entries={entries}
            setEntries={setEntries}
            balances={balances}
            showToast={showToast}
          />
        )}
        {active === "caisse" && (
          <CaisseBanqueModule
            accounts={accounts}
            entries={entries}
            setEntries={setEntries}
            balances={balances}
            showToast={showToast}
          />
        )}
        {active === "vente" && (
          <VenteModule
            accounts={accounts}
            entries={entries}
            setEntries={setEntries}
            products={products}
            setProducts={setProducts}
            invoices={invoices}
            setInvoices={setInvoices}
            movements={movements}
            setMovements={setMovements}
            settings={settings}
            showToast={showToast}
          />
        )}
        {active === "achat" && (
          <AchatModule
            accounts={accounts}
            entries={entries}
            setEntries={setEntries}
            suppliers={suppliers}
            setSuppliers={setSuppliers}
            purchases={purchases}
            setPurchases={setPurchases}
            showToast={showToast}
          />
        )}
        {active === "stock" && (
          <StockModule
            products={products}
            setProducts={setProducts}
            movements={movements}
            setMovements={setMovements}
            showToast={showToast}
          />
        )}
        {active === "crm" && (
          <CRMModule
            clients={clients}
            setClients={setClients}
            invoices={invoices}
            showToast={showToast}
          />
        )}
        {active === "rapports" && (
          <RapportsModule
            accounts={accounts}
            balances={balances}
            invoices={invoices}
            purchases={purchases}
            entries={entries}
            settings={settings}
            showToast={showToast}
          />
        )}
        {active === "admin" && role === "Administrateur" && (
          <AdminModule
            settings={settings}
            setSettings={setSettings}
            users={users}
            setUsers={setUsers}
            accounts={accounts}
            entries={entries}
            products={products}
            invoices={invoices}
            suppliers={suppliers}
            purchases={purchases}
            movements={movements}
            clients={clients}
            setAccounts={setAccounts}
            setEntries={setEntries}
            setProducts={setProducts}
            setInvoices={setInvoices}
            setSuppliers={setSuppliers}
            setPurchases={setPurchases}
            setMovements={setMovements}
            setClients={setClients}
            showToast={showToast}
          />
        )}
        {active === "admin" && role !== "Administrateur" && (
          <div className="p-4 md:p-8 max-w-6xl">
            <div className="rounded-lg p-10 text-center bg-white" style={{ border: "1px dashed #DDD6C4" }}>
              <Lock size={24} className="mx-auto mb-3" style={{ color: "#A6432F" }} />
              <div className="display text-xl mb-2" style={{ color: "#152238" }}>Accès restreint</div>
              <p className="text-sm" style={{ color: "#8A8370" }}>Seul un compte avec le rôle Administrateur peut accéder à l'administration et aux paramètres.</p>
            </div>
          </div>
        )}
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
    <div className="rounded-lg p-5 bg-white min-w-0" style={{ border: "1px solid #E4DFD1" }}>
      <div className="text-xs uppercase tracking-widest break-words" style={{ color: "#8A8370" }}>{label}</div>
      <div className="tabular text-2xl mt-2 break-words" style={{ color: accent || "#152238" }}>{fmt(value)}</div>
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8 min-w-0">
        <Card label="Produits" value={kpis.produits} accent="#0F6B5C" />
        <Card label="Charges" value={kpis.charges} accent="#A6432F" />
        <Card label="Résultat" value={kpis.resultat} accent={kpis.resultat >= 0 ? "#0F6B5C" : "#A6432F"} />
        <Card label="Trésorerie (Banque + Caisse)" value={kpis.tresorerie} />
      </div>

      <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
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
    </div>
  );
}

function ComptaModule({ accounts, setAccounts, entries, setEntries, balances, showToast }) {
  const [tab, setTab] = useState("journal");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [label, setLabel] = useState("");
  const [lines, setLines] = useState([
    { account: accounts[0]?.code, debit: "", credit: "" },
    { account: accounts[1]?.code, debit: "", credit: "" },
  ]);
  const [expanded, setExpanded] = useState(null);
  const [newAccount, setNewAccount] = useState({ code: "", name: "", type: "Charge" });

  // Les comptes se chargent de façon asynchrone (stockage/Supabase) après le premier
  // rendu. Si le compte sélectionné dans une ligne n'existe plus dans la liste à jour
  // (ex : encore sur un compte par défaut alors que les vrais comptes viennent d'arriver),
  // on le recale automatiquement sur le premier compte disponible pour éviter un menu
  // déroulant vide et une écriture qui ne peut jamais s'équilibrer.
  useEffect(() => {
    if (!accounts.length) return;
    setLines((prev) => {
      let changed = false;
      const next = prev.map((l) => {
        if (accounts.some((a) => a.code === l.account)) return l;
        changed = true;
        return { ...l, account: accounts[0]?.code };
      });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts]);

  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = totalDebit > 0 && totalDebit === totalCredit;

  const updateLine = (idx, field, value) => {
    setLines(lines.map((l, i) => {
      if (i !== idx) return l;
      // Une ligne est soit débitrice, soit créditrice : renseigner l'une vide l'autre
      if (field === "debit") return { ...l, debit: value, credit: value ? "" : l.credit };
      if (field === "credit") return { ...l, credit: value, debit: value ? "" : l.debit };
      return { ...l, [field]: value };
    }));
  };
  const addLine = () => setLines([...lines, { account: accounts[0]?.code, debit: "", credit: "" }]);
  const removeLine = (idx) => {
    if (lines.length <= 2) return;
    setLines(lines.filter((_, i) => i !== idx));
  };

  const addEntry = () => {
    if (!label) {
      showToast("Renseignez un libellé.");
      return;
    }
    if (!balanced) {
      showToast("L'écriture n'est pas équilibrée : le total débit doit égaler le total crédit.");
      return;
    }
    const cleanLines = lines
      .filter((l) => Number(l.debit) > 0 || Number(l.credit) > 0)
      .map((l) => ({ account: l.account, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 }));
    setEntries([...entries, { id: Date.now(), date, label, lines: cleanLines }]);
    setLabel("");
    setLines([
      { account: accounts[0]?.code, debit: "", credit: "" },
      { account: accounts[1]?.code, debit: "", credit: "" },
    ]);
    showToast("Écriture enregistrée.");
  };

  const removeEntry = (id) => setEntries(entries.filter((e) => e.id !== id));

  const accountName = (code) => accounts.find((a) => a.code === code)?.name || code;

  const addAccount = () => {
    if (!newAccount.code || !newAccount.name) {
      showToast("Code et intitulé requis.");
      return;
    }
    if (accounts.some((a) => a.code === newAccount.code)) {
      showToast("Ce code compte existe déjà.");
      return;
    }
    setAccounts([...accounts, newAccount]);
    setNewAccount({ code: "", name: "", type: "Charge" });
    showToast("Compte ajouté au plan comptable.");
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-widest" style={{ color: "#C9A24B" }}>Module 1</div>
        <div className="display text-3xl" style={{ color: "#152238" }}>Comptabilité</div>
      </header>

      <div className="flex gap-1 mb-6">
        {[
          ["journal", "Journal des écritures"],
          ["plan", "Plan comptable"],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="px-4 py-2 text-sm rounded-t"
            style={{
              background: tab === id ? "#fff" : "transparent",
              borderBottom: tab === id ? "2px solid #C9A24B" : "2px solid transparent",
              color: tab === id ? "#152238" : "#8A8370",
              fontWeight: tab === id ? 600 : 400,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "journal" && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div className="col-span-2">
              <label className="text-xs" style={{ color: "#8A8370" }}>Libellé</label>
              <input value={label} onChange={(e) => setLabel(e.target.value)}
                placeholder="Ex : Vente prestation + matériel, encaissement partiel"
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
          </div>

          <div className="mb-3">
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 text-xs mb-1 px-1" style={{ color: "#8A8370" }}>
              <div className="col-span-6">Compte</div>
              <div className="col-span-3 text-right">Débit</div>
              <div className="col-span-3 text-right">Crédit</div>
            </div>
            {lines.map((l, idx) => (
              <div key={idx} className="grid grid-cols-1 sm:grid-cols-12 gap-2 mb-2 items-center">
                <select value={l.account} onChange={(e) => updateLine(idx, "account", e.target.value)}
                  className="col-span-6 border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }}>
                  {accounts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                </select>
                <input type="number" value={l.debit} onChange={(e) => updateLine(idx, "debit", e.target.value)}
                  placeholder="0" className="col-span-3 border rounded px-2 py-1.5 text-sm text-right tabular" style={{ borderColor: "#DDD6C4" }} />
                <input type="number" value={l.credit} onChange={(e) => updateLine(idx, "credit", e.target.value)}
                  placeholder="0" className="col-span-2 border rounded px-2 py-1.5 text-sm text-right tabular" style={{ borderColor: "#DDD6C4" }} />
                <button onClick={() => removeLine(idx)} disabled={lines.length <= 2}
                  className="col-span-1 flex justify-center" style={{ color: lines.length <= 2 ? "#DDD6C4" : "#A6432F" }}>
                  <X size={14} />
                </button>
              </div>
            ))}
            <button onClick={addLine} className="flex items-center gap-1 text-xs mt-1" style={{ color: "#152238" }}>
              <Plus size={12} /> Ajouter une ligne
            </button>
          </div>

          <div className="flex items-center justify-between mb-5 px-1">
            <div className="flex items-center gap-1 text-xs" style={{ color: balanced ? "#0F6B5C" : "#A6432F" }}>
              {balanced ? <CheckCircle2 size={13} /> : <Circle size={13} />}
              {balanced ? "Écriture équilibrée" : "L'écriture doit être équilibrée pour être enregistrée"}
            </div>
            <div className="tabular text-xs" style={{ color: "#8A8370" }}>
              Total débit {fmt(totalDebit)} · Total crédit {fmt(totalCredit)}
            </div>
          </div>

          <button onClick={addEntry}
            className="flex items-center gap-2 px-4 py-2 rounded text-sm text-white mb-6"
            style={{ background: "#152238" }}>
            <Plus size={14} /> Enregistrer l'écriture
          </button>

          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                <th className="py-2 font-normal">Date</th>
                <th className="py-2 font-normal">Libellé</th>
                <th className="py-2 font-normal text-center">Lignes</th>
                <th className="py-2 font-normal text-right">Montant</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 && (
                <tr><td colSpan={5} className="py-8 text-center" style={{ color: "#A39C87" }}>Aucune écriture. Commencez par en ajouter une ci-dessus.</td></tr>
              )}
              {[...entries].reverse().map((e) => {
                const total = e.lines.reduce((s, l) => s + l.debit, 0);
                const isOpen = expanded === e.id;
                return (
                  <React.Fragment key={e.id}>
                    <tr onClick={() => setExpanded(isOpen ? null : e.id)} className="cursor-pointer" style={{ borderBottom: "1px solid #F3EFE3" }}>
                      <td className="py-2 tabular">{e.date}</td>
                      <td className="py-2">{e.label}</td>
                      <td className="py-2 tabular text-center">{e.lines.length}</td>
                      <td className="py-2 tabular text-right">{fmt(total)}</td>
                      <td className="py-2 text-right">
                        <button onClick={(ev) => { ev.stopPropagation(); removeEntry(e.id); }} style={{ color: "#A6432F" }}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={5} className="py-3 px-3" style={{ background: "#FAF8F1" }}>
                          <div className="overflow-x-auto"><table className="w-full text-xs">
                            <thead>
                              <tr style={{ color: "#8A8370" }}>
                                <th className="text-left font-normal py-1">Compte</th>
                                <th className="text-right font-normal py-1">Débit</th>
                                <th className="text-right font-normal py-1">Crédit</th>
                              </tr>
                            </thead>
                            <tbody>
                              {e.lines.map((l, i) => (
                                <tr key={i}>
                                  <td className="py-1">{l.account} — {accountName(l.account)}</td>
                                  <td className="py-1 tabular text-right">{l.debit > 0 ? fmt(l.debit) : ""}</td>
                                  <td className="py-1 tabular text-right">{l.credit > 0 ? fmt(l.credit) : ""}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table></div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table></div>
        </div>
      )}

      {tab === "plan" && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5 items-end">
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Code</label>
              <input value={newAccount.code} onChange={(e) => setNewAccount({ ...newAccount, code: e.target.value })}
                placeholder="Ex : 613" className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Intitulé</label>
              <input value={newAccount.name} onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })}
                placeholder="Ex : Locations" className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Type</label>
              <select value={newAccount.type} onChange={(e) => setNewAccount({ ...newAccount, type: e.target.value })}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                {["Actif", "Passif", "Capitaux propres", "Charge", "Produit"].map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <button onClick={addAccount}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded text-sm text-white h-[38px]"
              style={{ background: "#152238" }}>
              <Plus size={14} /> Ajouter
            </button>
          </div>

          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                <th className="py-2 font-normal">Code</th>
                <th className="py-2 font-normal">Intitulé</th>
                <th className="py-2 font-normal">Type</th>
                <th className="py-2 font-normal text-right">Solde</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.code} style={{ borderBottom: "1px solid #F3EFE3" }}>
                  <td className="py-2 tabular">{a.code}</td>
                  <td className="py-2">{a.name}</td>
                  <td className="py-2">{a.type}</td>
                  <td className="py-2 tabular text-right">{fmt(balances[a.code] || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}

const COUNTERPART_TYPES = ["Actif", "Passif", "Capitaux propres", "Charge", "Produit"];

function CaisseBanqueModule({ accounts, entries, setEntries, balances, showToast }) {
  const [tab, setTab] = useState("caisse"); // "caisse" | "banque"
  const compteCode = tab === "caisse" ? "530" : "512";
  const counterparts = accounts.filter((a) => a.code !== compteCode);

  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    label: "",
    sens: "entree", // entree = encaissement, sortie = décaissement
    counterpart: counterparts[0]?.code,
    amount: "",
  });

  const ops = useMemo(
    () => entries.filter((e) => e.lines.some((l) => l.account === compteCode)),
    [entries, compteCode]
  );

  const solde = balances[compteCode] || 0;

  const addOp = () => {
    if (!form.label || !form.amount || Number(form.amount) <= 0) {
      showToast("Renseignez un libellé et un montant valide.");
      return;
    }
    const debit = form.sens === "entree" ? compteCode : form.counterpart;
    const credit = form.sens === "entree" ? form.counterpart : compteCode;
    const entry = simpleEntry(form.date, form.label, debit, credit, Number(form.amount));
    entry.reconciled = false;
    setEntries([...entries, entry]);
    setForm({ ...form, label: "", amount: "" });
    showToast(tab === "caisse" ? "Opération de caisse enregistrée." : "Opération bancaire enregistrée.");
  };

  const toggleReconciled = (id) => {
    setEntries(entries.map((e) => (e.id === id ? { ...e, reconciled: !e.reconciled } : e)));
  };

  const removeOp = (id) => setEntries(entries.filter((e) => e.id !== id));

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-widest" style={{ color: "#C9A24B" }}>Module 2</div>
        <div className="display text-3xl" style={{ color: "#152238" }}>Caisse et banque</div>
        <p className="text-sm mt-1" style={{ color: "#7A7460" }}>
          Chaque opération saisie ici est automatiquement enregistrée dans le journal comptable (compte {compteCode}).
        </p>
      </header>

      <div className="flex gap-1 mb-6">
        {[
          ["caisse", "Caisse (530)"],
          ["banque", "Banque (512)"],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="px-4 py-2 text-sm rounded-t"
            style={{
              background: tab === id ? "#fff" : "transparent",
              borderBottom: tab === id ? "2px solid #C9A24B" : "2px solid transparent",
              color: tab === id ? "#152238" : "#8A8370",
              fontWeight: tab === id ? 600 : 400,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mb-6">
        <Card label={tab === "caisse" ? "Solde caisse" : "Solde banque"} value={solde} accent={solde >= 0 ? "#0F6B5C" : "#A6432F"} />
      </div>

      <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5 items-end">
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Date</label>
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
              className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
          </div>
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Sens</label>
            <select value={form.sens} onChange={(e) => setForm({ ...form, sens: e.target.value })}
              className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
              <option value="entree">Encaissement</option>
              <option value="sortie">Décaissement</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="text-xs" style={{ color: "#8A8370" }}>Libellé</label>
            <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="Ex : Règlement client, achat fournitures..."
              className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
          </div>
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Contrepartie</label>
            <select value={form.counterpart} onChange={(e) => setForm({ ...form, counterpart: e.target.value })}
              className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
              {counterparts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Montant</label>
            <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="0"
              className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
          </div>
        </div>
        <button onClick={addOp}
          className="flex items-center gap-2 px-4 py-2 rounded text-sm text-white mb-6"
          style={{ background: "#152238" }}>
          <Plus size={14} /> Enregistrer l'opération
        </button>

        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead>
            <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
              <th className="py-2 font-normal">Date</th>
              <th className="py-2 font-normal">Libellé</th>
              <th className="py-2 font-normal">Sens</th>
              <th className="py-2 font-normal text-right">Montant</th>
              {tab === "banque" && <th className="py-2 font-normal text-center">Pointé</th>}
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {ops.length === 0 && (
              <tr><td colSpan={tab === "banque" ? 6 : 5} className="py-8 text-center" style={{ color: "#A39C87" }}>
                Aucune opération. Enregistrez-en une ci-dessus.
              </td></tr>
            )}
            {[...ops].reverse().map((e) => {
              const line = e.lines.find((l) => l.account === compteCode);
              const isEntree = line.debit > 0;
              const amount = line.debit > 0 ? line.debit : line.credit;
              return (
                <tr key={e.id} style={{ borderBottom: "1px solid #F3EFE3" }}>
                  <td className="py-2 tabular">{e.date}</td>
                  <td className="py-2">{e.label}</td>
                  <td className="py-2">
                    <span className="flex items-center gap-1" style={{ color: isEntree ? "#0F6B5C" : "#A6432F" }}>
                      {isEntree ? <ArrowDownCircle size={14} /> : <ArrowUpCircle size={14} />}
                      {isEntree ? "Encaissement" : "Décaissement"}
                    </span>
                  </td>
                  <td className="py-2 tabular text-right">{fmt(amount)}</td>
                  {tab === "banque" && (
                    <td className="py-2 text-center">
                      <button onClick={() => toggleReconciled(e.id)}>
                        {e.reconciled
                          ? <CheckCircle2 size={16} style={{ color: "#0F6B5C" }} />
                          : <Circle size={16} style={{ color: "#C7C0AD" }} />}
                      </button>
                    </td>
                  )}
                  <td className="py-2 text-right">
                    <button onClick={() => removeOp(e.id)} style={{ color: "#A6432F" }}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}

function VenteModule({ accounts, entries, setEntries, products, setProducts, invoices, setInvoices, movements, setMovements, settings, showToast }) {
  const [tab, setTab] = useState("pos");
  const [cart, setCart] = useState([]); // [{productId, qty}]
  const [client, setClient] = useState("");
  const [paymentMode, setPaymentMode] = useState("caisse"); // caisse | banque | credit
  const [newProduct, setNewProduct] = useState({ code: "", name: "", price: "", tva: settings.taxRate, type: "service", account: "706", stock: "", seuil: "", image: null });
  const [imgLoading, setImgLoading] = useState(false);

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setImgLoading(true);
      const dataUrl = await resizeImage(file);
      setNewProduct((cur) => ({ ...cur, image: dataUrl }));
    } catch (err) {
      showToast("Impossible de charger cette image.");
    } finally {
      setImgLoading(false);
      e.target.value = "";
    }
  };

  const taxLabel = TAX_SYSTEMS[settings.taxSystem]?.label || "Taxe";
  const taxActive = settings.taxSystem !== "aucune";

  const addToCart = (productId) => {
    setCart((c) => {
      const found = c.find((l) => l.productId === productId);
      if (found) return c.map((l) => (l.productId === productId ? { ...l, qty: l.qty + 1 } : l));
      return [...c, { productId, qty: 1 }];
    });
  };
  const changeQty = (productId, delta) => {
    setCart((c) => c.map((l) => (l.productId === productId ? { ...l, qty: Math.max(1, l.qty + delta) } : l)).filter((l) => l.qty > 0));
  };
  const removeLine = (productId) => setCart((c) => c.filter((l) => l.productId !== productId));

  const cartLines = cart.map((l) => {
    const p = products.find((pr) => pr.id === l.productId);
    const subtotal = p ? p.price * l.qty : 0; // montant HT
    const taxAmount = taxActive ? subtotal * ((p?.tva || 0) / 100) : 0;
    return { ...l, product: p, subtotal, taxAmount, subtotalTTC: subtotal + taxAmount };
  });
  const totalHT = cartLines.reduce((s, l) => s + l.subtotal, 0);
  const totalTax = cartLines.reduce((s, l) => s + l.taxAmount, 0);
  const total = totalHT + totalTax; // TTC

  const validateSale = () => {
    if (cartLines.length === 0) {
      showToast("Le panier est vide.");
      return;
    }
    if (paymentMode === "credit" && !client) {
      showToast("Indiquez le nom du client pour une vente à crédit.");
      return;
    }
    const invNumber = "F" + String(invoices.length + 1).padStart(4, "0");
    const date = new Date().toISOString().slice(0, 10);
    const payAccount = paymentMode === "caisse" ? "530" : paymentMode === "banque" ? "512" : "411";

    // Regrouper les lignes de vente par compte pour construire une écriture équilibrée multi-lignes
    const byAccount = {};
    cartLines.forEach((l) => {
      const acc = l.product.account;
      byAccount[acc] = (byAccount[acc] || 0) + l.subtotal;
    });
    const saleEntry = {
      id: Date.now(),
      date,
      label: `Vente ${invNumber}${client ? " — " + client : ""}`,
      lines: [
        { account: payAccount, debit: total, credit: 0 },
        ...Object.entries(byAccount).map(([acc, amount]) => ({ account: acc, debit: 0, credit: amount })),
        ...(totalTax > 0 ? [{ account: settings.taxAccount, debit: 0, credit: totalTax }] : []),
      ],
    };
    setEntries([...entries, saleEntry]);
    setInvoices([...invoices,
      {
        id: Date.now(),
        number: invNumber,
        date,
        client: client || "Client comptant",
        lines: cartLines.map((l) => ({ name: l.product.name, qty: l.qty, price: l.product.price, subtotal: l.subtotal, tva: l.product.tva, taxAmount: l.taxAmount })),
        totalHT,
        totalTax,
        taxLabel,
        total,
        paymentMode,
        status: paymentMode === "credit" ? "impayée" : "payée",
      },
    ]);

    // Décrémenter le stock des marchandises et journaliser les mouvements de sortie
    const stockLines = cartLines.filter((l) => l.product.type === "marchandise");
    if (stockLines.length > 0) {
      setProducts(products.map((p) => {
        const line = stockLines.find((l) => l.productId === p.id);
        return line ? { ...p, stock: Math.max(0, (p.stock || 0) - line.qty) } : p;
      }));
      setMovements([
        ...movements,
        ...stockLines.map((l) => ({
          id: Date.now() + Math.random(),
          date,
          productId: l.productId,
          productName: l.product.name,
          type: "sortie",
          qty: l.qty,
          reason: `Vente ${invNumber}`,
        })),
      ]);
    }

    setCart([]);
    setClient("");
    showToast(`Facture ${invNumber} créée (${paymentMode === "credit" ? "à encaisser" : "payée"}).`);
  };

  const encaisserFacture = (inv, compte) => {
    setEntries([
      ...entries,
      simpleEntry(new Date().toISOString().slice(0, 10), `Encaissement ${inv.number} — ${inv.client}`, compte, "411", inv.total),
    ]);
    setInvoices(invoices.map((i) => (i.id === inv.id ? { ...i, status: "payée" } : i)));
    showToast(`Facture ${inv.number} encaissée.`);
  };

  const [editingProductId, setEditingProductId] = useState(null);

  const addProduct = () => {
    if (!newProduct.code || !newProduct.name || !newProduct.price) {
      showToast("Code, intitulé et prix requis.");
      return;
    }
    const base = { ...newProduct, price: Number(newProduct.price), tva: Number(newProduct.tva) };
    if (base.type === "marchandise") {
      base.stock = Number(newProduct.stock || 0);
      base.seuil = Number(newProduct.seuil || 5);
    } else {
      delete base.stock;
      delete base.seuil;
    }

    if (editingProductId) {
      setProducts(products.map((p) => (p.id === editingProductId ? { ...base, id: editingProductId } : p)));
      showToast("Article modifié.");
      setEditingProductId(null);
    } else {
      setProducts([...products, { ...base, id: Date.now() }]);
      showToast("Article ajouté au catalogue.");
    }
    setNewProduct({ code: "", name: "", price: "", tva: settings.taxRate, type: "service", account: "706", stock: "", seuil: "", image: null });
  };

  const startEditProduct = (p) => {
    setEditingProductId(p.id);
    setNewProduct({
      code: p.code, name: p.name, price: p.price, tva: p.tva, type: p.type, account: p.account,
      stock: p.stock ?? "", seuil: p.seuil ?? "", image: p.image ?? null,
    });
  };

  const cancelEditProduct = () => {
    setEditingProductId(null);
    setNewProduct({ code: "", name: "", price: "", tva: settings.taxRate, type: "service", account: "706", stock: "", seuil: "", image: null });
  };

  const deleteProduct = (id) => {
    if (!window.confirm("Supprimer définitivement cet article du catalogue ?")) return;
    setProducts(products.filter((p) => p.id !== id));
    if (editingProductId === id) cancelEditProduct();
    showToast("Article supprimé.");
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-widest" style={{ color: "#C9A24B" }}>Module 3</div>
        <div className="display text-3xl" style={{ color: "#152238" }}>Vente — POS et facturation</div>
        <p className="text-sm mt-1" style={{ color: "#7A7460" }}>
          Chaque vente génère automatiquement sa facture et son écriture comptable (compte 706/707).
        </p>
      </header>

      <div className="flex gap-1 mb-6">
        {[["pos", "Point de vente"], ["factures", "Factures"], ["catalogue", "Catalogue"]].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="px-4 py-2 text-sm rounded-t"
            style={{
              background: tab === id ? "#fff" : "transparent",
              borderBottom: tab === id ? "2px solid #C9A24B" : "2px solid transparent",
              color: tab === id ? "#152238" : "#8A8370",
              fontWeight: tab === id ? 600 : 400,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "pos" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {products.map((p) => (
              <button key={p.id} onClick={() => addToCart(p.id)}
                className="text-left bg-white rounded-lg p-3 hover:shadow-sm transition-shadow flex gap-3"
                style={{ border: "1px solid #E4DFD1" }}>
                {p.image ? (
                  <img src={p.image} alt="" className="w-12 h-12 rounded object-cover shrink-0" />
                ) : (
                  <div className="w-12 h-12 rounded flex items-center justify-center shrink-0" style={{ background: "#F3EFE3" }}>
                    <ImageIcon size={18} style={{ color: "#C7C0AD" }} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-xs" style={{ color: "#A39C87" }}>{p.code} · {p.type === "service" ? "Service" : "Marchandise"}</div>
                  <div className="text-sm font-medium mt-0.5 truncate" style={{ color: "#152238" }}>{p.name}</div>
                  <div className="flex items-center justify-between mt-1">
                    <div className="tabular text-sm" style={{ color: "#0F6B5C" }}>{fmt(p.price)}</div>
                    {p.type === "marchandise" && (
                      <div className="tabular text-xs" style={{ color: (p.stock || 0) <= (p.seuil || 0) ? "#A6432F" : "#A39C87" }}>
                        stock : {p.stock || 0}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="bg-white rounded-lg p-5 h-fit" style={{ border: "1px solid #E4DFD1" }}>
            <div className="flex items-center gap-2 mb-4" style={{ color: "#152238" }}>
              <Receipt size={16} /><span className="font-medium text-sm">Panier</span>
            </div>
            {cartLines.length === 0 ? (
              <div className="text-xs py-6 text-center" style={{ color: "#A39C87" }}>Sélectionnez un article à gauche.</div>
            ) : (
              <div className="space-y-3 mb-4">
                {cartLines.map((l) => (
                  <div key={l.productId} className="flex items-center justify-between text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="truncate" style={{ color: "#152238" }}>{l.product.name}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <button onClick={() => changeQty(l.productId, -1)} className="w-5 h-5 flex items-center justify-center rounded" style={{ background: "#F3EFE3" }}><Minus size={10} /></button>
                        <span className="tabular text-xs w-4 text-center">{l.qty}</span>
                        <button onClick={() => changeQty(l.productId, 1)} className="w-5 h-5 flex items-center justify-center rounded" style={{ background: "#F3EFE3" }}><Plus size={10} /></button>
                      </div>
                    </div>
                    <div className="tabular text-sm ml-2">{fmt(l.subtotal)}</div>
                    <button onClick={() => removeLine(l.productId)} className="ml-2" style={{ color: "#A6432F" }}><X size={13} /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="border-t pt-3 mb-4" style={{ borderColor: "#EEE9DA" }}>
              {taxActive && (
                <>
                  <div className="flex justify-between tabular text-xs mb-1" style={{ color: "#8A8370" }}>
                    <span>Sous-total HT</span><span>{fmt(totalHT)}</span>
                  </div>
                  <div className="flex justify-between tabular text-xs mb-2" style={{ color: "#8A8370" }}>
                    <span>{taxLabel}</span><span>{fmt(totalTax)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between tabular text-base font-semibold" style={{ color: "#152238" }}>
                <span>Total {taxActive ? "TTC" : ""}</span><span>{fmt(total)}</span>
              </div>
            </div>
            <input value={client} onChange={(e) => setClient(e.target.value)} placeholder="Nom du client (optionnel)"
              className="w-full border rounded px-2 py-1.5 text-sm mb-2" style={{ borderColor: "#DDD6C4" }} />
            <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}
              className="w-full border rounded px-2 py-1.5 text-sm mb-3" style={{ borderColor: "#DDD6C4" }}>
              <option value="caisse">Paiement en caisse</option>
              <option value="banque">Paiement par banque</option>
              <option value="credit">Vente à crédit (client)</option>
            </select>
            <button onClick={validateSale} className="w-full py-2 rounded text-sm text-white" style={{ background: "#152238" }}>
              Valider la vente
            </button>
          </div>
        </div>
      )}

      {tab === "factures" && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                <th className="py-2 font-normal">N°</th>
                <th className="py-2 font-normal">Date</th>
                <th className="py-2 font-normal">Client</th>
                <th className="py-2 font-normal text-right">Montant</th>
                <th className="py-2 font-normal text-center">Statut</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center" style={{ color: "#A39C87" }}>Aucune facture. Réalisez une vente depuis le POS.</td></tr>
              )}
              {[...invoices].reverse().map((inv) => (
                <tr key={inv.id} style={{ borderBottom: "1px solid #F3EFE3" }}>
                  <td className="py-2 tabular">{inv.number}</td>
                  <td className="py-2 tabular">{inv.date}</td>
                  <td className="py-2">{inv.client}</td>
                  <td className="py-2 tabular text-right">{fmt(inv.total)}</td>
                  <td className="py-2 text-center">
                    <span className="text-xs px-2 py-0.5 rounded"
                      style={{
                        background: inv.status === "payée" ? "#E6F1EE" : "#F7E9E3",
                        color: inv.status === "payée" ? "#0F6B5C" : "#A6432F",
                      }}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    {inv.status === "impayée" && (
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => encaisserFacture(inv, "530")} className="text-xs px-2 py-1 rounded" style={{ background: "#152238", color: "#EFE9DD" }}>Encaisser (caisse)</button>
                        <button onClick={() => encaisserFacture(inv, "512")} className="text-xs px-2 py-1 rounded" style={{ background: "#152238", color: "#EFE9DD" }}>Encaisser (banque)</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      {tab === "catalogue" && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <div className="grid grid-cols-2 md:grid-cols-8 gap-3 mb-5 items-end">
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Photo</label>
              <label className="mt-1 flex items-center justify-center rounded cursor-pointer overflow-hidden"
                style={{ width: 38, height: 38, border: "1px dashed #DDD6C4", background: newProduct.image ? "transparent" : "#FAF8F1" }}>
                {imgLoading ? (
                  <span className="text-[9px]" style={{ color: "#A39C87" }}>...</span>
                ) : newProduct.image ? (
                  <img src={newProduct.image} alt="" className="w-full h-full object-cover" />
                ) : (
                  <ImageIcon size={16} style={{ color: "#A39C87" }} />
                )}
                <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
              </label>
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Code</label>
              <input value={newProduct.code} onChange={(e) => setNewProduct({ ...newProduct, code: e.target.value })}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div className="col-span-2">
              <label className="text-xs" style={{ color: "#8A8370" }}>Intitulé</label>
              <input value={newProduct.name} onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Prix HT</label>
              <input type="number" value={newProduct.price} onChange={(e) => setNewProduct({ ...newProduct, price: e.target.value })}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>{taxLabel} %</label>
              <input type="number" value={newProduct.tva} onChange={(e) => setNewProduct({ ...newProduct, tva: e.target.value })}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Type</label>
              <select value={newProduct.type} onChange={(e) => setNewProduct({ ...newProduct, type: e.target.value, account: e.target.value === "service" ? "706" : "707" })}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                <option value="service">Service</option>
                <option value="marchandise">Marchandise</option>
              </select>
            </div>
            <button onClick={addProduct} className="flex items-center justify-center gap-2 px-4 py-2 rounded text-sm text-white h-[38px]" style={{ background: "#152238" }}>
              {editingProductId ? <CheckCircle2 size={14} /> : <Plus size={14} />}
              {editingProductId ? "Enregistrer" : "Ajouter"}
            </button>
          </div>
          {editingProductId && (
            <div className="flex items-center gap-2 mb-4 text-xs" style={{ color: "#A6432F" }}>
              Modification de « {products.find((p) => p.id === editingProductId)?.name} » en cours.
              <button onClick={cancelEditProduct} className="underline">Annuler</button>
            </div>
          )}
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                <th className="py-2 font-normal">Photo</th>
                <th className="py-2 font-normal">Code</th>
                <th className="py-2 font-normal">Intitulé</th>
                <th className="py-2 font-normal">Type</th>
                <th className="py-2 font-normal">Compte de vente</th>
                <th className="py-2 font-normal text-right">Prix HT</th>
                <th className="py-2 font-normal text-right">{taxLabel}</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {products.length === 0 && (
                <tr><td colSpan={8} className="py-8 text-center" style={{ color: "#A39C87" }}>Aucun article. Ajoutez-en un ci-dessus.</td></tr>
              )}
              {products.map((p) => (
                <tr key={p.id} style={{ borderBottom: "1px solid #F3EFE3", background: editingProductId === p.id ? "#FAF8F1" : "transparent" }}>
                  <td className="py-2">
                    {p.image ? (
                      <img src={p.image} alt="" className="w-8 h-8 rounded object-cover" />
                    ) : (
                      <div className="w-8 h-8 rounded flex items-center justify-center" style={{ background: "#F3EFE3" }}>
                        <ImageIcon size={13} style={{ color: "#C7C0AD" }} />
                      </div>
                    )}
                  </td>
                  <td className="py-2 tabular">{p.code}</td>
                  <td className="py-2">{p.name}</td>
                  <td className="py-2">{p.type === "service" ? "Service" : "Marchandise"}</td>
                  <td className="py-2 tabular">{p.account}</td>
                  <td className="py-2 tabular text-right">{fmt(p.price)}</td>
                  <td className="py-2 tabular text-right">{taxActive ? `${p.tva || 0}%` : "—"}</td>
                  <td className="py-2 text-right">
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => startEditProduct(p)} title="Modifier" style={{ color: "#152238" }}><Pencil size={14} /></button>
                      <button onClick={() => deleteProduct(p.id)} title="Supprimer" style={{ color: "#A6432F" }}><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}

function AchatModule({ accounts, entries, setEntries, suppliers, setSuppliers, purchases, setPurchases, showToast }) {
  const [tab, setTab] = useState("achats");
  const chargeAccounts = accounts.filter((a) => a.type === "Charge");
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    supplierId: suppliers[0]?.id,
    label: "",
    account: chargeAccounts[0]?.code,
    amount: "",
    paymentMode: "credit", // caisse | banque | credit
  });
  const [newSupplier, setNewSupplier] = useState({ name: "", contact: "" });
  const [editingPurchaseId, setEditingPurchaseId] = useState(null);
  const [editingSupplierId, setEditingSupplierId] = useState(null);

  const addPurchase = () => {
    if (!form.label || !form.amount || Number(form.amount) <= 0) {
      showToast("Renseignez un libellé et un montant valide.");
      return;
    }
    const supplier = suppliers.find((s) => s.id === Number(form.supplierId));
    const payAccount = form.paymentMode === "caisse" ? "530" : form.paymentMode === "banque" ? "512" : "401";
    const label = `Achat — ${form.label} (${supplier?.name || "Fournisseur"})`;

    if (editingPurchaseId) {
      setEntries(entries.map((e) =>
        e.id === editingPurchaseId
          ? { ...simpleEntry(form.date, label, form.account, payAccount, Number(form.amount)), id: editingPurchaseId }
          : e
      ));
      setPurchases(purchases.map((p) =>
        p.id === editingPurchaseId
          ? { ...p, date: form.date, supplier: supplier?.name || "Fournisseur", label: form.label, amount: Number(form.amount), paymentMode: form.paymentMode, status: form.paymentMode === "credit" ? "à payer" : "payé" }
          : p
      ));
      setEditingPurchaseId(null);
      showToast("Achat modifié.");
    } else {
      const purchaseId = Date.now();
      setEntries([...entries, { ...simpleEntry(form.date, label, form.account, payAccount, Number(form.amount)), id: purchaseId }]);
      setPurchases([
        ...purchases,
        {
          id: purchaseId,
          date: form.date,
          supplier: supplier?.name || "Fournisseur",
          label: form.label,
          amount: Number(form.amount),
          paymentMode: form.paymentMode,
          status: form.paymentMode === "credit" ? "à payer" : "payé",
        },
      ]);
      showToast("Achat enregistré.");
    }
    setForm({ ...form, label: "", amount: "" });
  };

  const startEditPurchase = (p) => {
    const supplier = suppliers.find((s) => s.name === p.supplier);
    setEditingPurchaseId(p.id);
    setForm({
      date: p.date,
      supplierId: supplier?.id ?? suppliers[0]?.id,
      label: p.label,
      account: entries.find((e) => e.id === p.id)?.lines?.find((l) => l.debit > 0)?.account || chargeAccounts[0]?.code,
      amount: p.amount,
      paymentMode: p.paymentMode,
    });
  };

  const cancelEditPurchase = () => {
    setEditingPurchaseId(null);
    setForm({ ...form, label: "", amount: "" });
  };

  const deletePurchase = (p) => {
    const msg = p.status === "payé" && p.paymentMode === "credit"
      ? "Supprimer cet achat ? Son paiement déjà enregistré dans le journal ne sera pas retiré automatiquement — pensez à vérifier le journal comptable."
      : "Supprimer définitivement cet achat ?";
    if (!window.confirm(msg)) return;
    setPurchases(purchases.filter((x) => x.id !== p.id));
    setEntries(entries.filter((e) => e.id !== p.id));
    if (editingPurchaseId === p.id) cancelEditPurchase();
    showToast("Achat supprimé.");
  };

  const addSupplier = () => {
    if (!newSupplier.name) {
      showToast("Le nom du fournisseur est requis.");
      return;
    }
    if (editingSupplierId) {
      const oldName = suppliers.find((s) => s.id === editingSupplierId)?.name;
      setSuppliers(suppliers.map((s) => (s.id === editingSupplierId ? { ...s, ...newSupplier } : s)));
      if (oldName && oldName !== newSupplier.name) {
        setPurchases(purchases.map((p) => (p.supplier === oldName ? { ...p, supplier: newSupplier.name } : p)));
      }
      setEditingSupplierId(null);
      showToast("Fournisseur modifié.");
    } else {
      setSuppliers([...suppliers, { ...newSupplier, id: Date.now() }]);
      showToast("Fournisseur ajouté.");
    }
    setNewSupplier({ name: "", contact: "" });
  };

  const startEditSupplier = (s) => {
    setEditingSupplierId(s.id);
    setNewSupplier({ name: s.name, contact: s.contact || "" });
  };

  const cancelEditSupplier = () => {
    setEditingSupplierId(null);
    setNewSupplier({ name: "", contact: "" });
  };

  const deleteSupplier = (s) => {
    const hasPurchases = purchases.some((p) => p.supplier === s.name);
    const msg = hasPurchases
      ? `Supprimer « ${s.name} » ? Des achats existants restent associés à ce nom de fournisseur.`
      : `Supprimer le fournisseur « ${s.name} » ?`;
    if (!window.confirm(msg)) return;
    setSuppliers(suppliers.filter((x) => x.id !== s.id));
    if (editingSupplierId === s.id) cancelEditSupplier();
    showToast("Fournisseur supprimé.");
  };

  const payerAchat = (p, compte) => {
    setEntries([
      ...entries,
      simpleEntry(new Date().toISOString().slice(0, 10), `Paiement — ${p.label} (${p.supplier})`, "401", compte, p.amount),
    ]);
    setPurchases(purchases.map((x) => (x.id === p.id ? { ...x, status: "payé" } : x)));
    showToast("Achat payé.");
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-widest" style={{ color: "#C9A24B" }}>Module 4</div>
        <div className="display text-3xl" style={{ color: "#152238" }}>Achat et fournisseurs</div>
        <p className="text-sm mt-1" style={{ color: "#7A7460" }}>
          Chaque achat génère automatiquement son écriture comptable (compte de charge ↔ 401/512/530).
        </p>
      </header>

      <div className="flex gap-1 mb-6">
        {[["achats", "Achats"], ["fournisseurs", "Fournisseurs"]].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="px-4 py-2 text-sm rounded-t"
            style={{
              background: tab === id ? "#fff" : "transparent",
              borderBottom: tab === id ? "2px solid #C9A24B" : "2px solid transparent",
              color: tab === id ? "#152238" : "#8A8370",
              fontWeight: tab === id ? 600 : 400,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "achats" && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5 items-end">
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Date</label>
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Fournisseur</label>
              <select value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-xs" style={{ color: "#8A8370" }}>Libellé</label>
              <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="Ex : Achat fournitures de bureau"
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Compte de charge</label>
              <select value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                {chargeAccounts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Montant</label>
              <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="0" className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
            </div>
          </div>
          <div className="mb-5">
            <label className="text-xs" style={{ color: "#8A8370" }}>Règlement</label>
            <select value={form.paymentMode} onChange={(e) => setForm({ ...form, paymentMode: e.target.value })}
              className="border rounded px-2 py-1.5 text-sm mt-1 block" style={{ borderColor: "#DDD6C4" }}>
              <option value="credit">À crédit (fournisseur à payer)</option>
              <option value="caisse">Payé comptant — caisse</option>
              <option value="banque">Payé comptant — banque</option>
            </select>
          </div>
          <button onClick={addPurchase} className="flex items-center gap-2 px-4 py-2 rounded text-sm text-white mb-2" style={{ background: "#152238" }}>
            {editingPurchaseId ? <CheckCircle2 size={14} /> : <Plus size={14} />}
            {editingPurchaseId ? "Enregistrer les modifications" : "Enregistrer l'achat"}
          </button>
          {editingPurchaseId && (
            <div className="flex items-center gap-2 mb-4 text-xs" style={{ color: "#A6432F" }}>
              Modification en cours.
              <button onClick={cancelEditPurchase} className="underline">Annuler</button>
            </div>
          )}
          {!editingPurchaseId && <div className="mb-6" />}

          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                <th className="py-2 font-normal">Date</th>
                <th className="py-2 font-normal">Fournisseur</th>
                <th className="py-2 font-normal">Libellé</th>
                <th className="py-2 font-normal text-right">Montant</th>
                <th className="py-2 font-normal text-center">Statut</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {purchases.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center" style={{ color: "#A39C87" }}>Aucun achat enregistré.</td></tr>
              )}
              {[...purchases].reverse().map((p) => (
                <tr key={p.id} style={{ borderBottom: "1px solid #F3EFE3", background: editingPurchaseId === p.id ? "#FAF8F1" : "transparent" }}>
                  <td className="py-2 tabular">{p.date}</td>
                  <td className="py-2">{p.supplier}</td>
                  <td className="py-2">{p.label}</td>
                  <td className="py-2 tabular text-right">{fmt(p.amount)}</td>
                  <td className="py-2 text-center">
                    <span className="text-xs px-2 py-0.5 rounded"
                      style={{ background: p.status === "payé" ? "#E6F1EE" : "#F7E9E3", color: p.status === "payé" ? "#0F6B5C" : "#A6432F" }}>
                      {p.status}
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    <div className="flex gap-1 justify-end items-center flex-wrap">
                      {p.status === "à payer" && (
                        <>
                          <button onClick={() => payerAchat(p, "530")} className="text-xs px-2 py-1 rounded" style={{ background: "#152238", color: "#EFE9DD" }}>Payer (caisse)</button>
                          <button onClick={() => payerAchat(p, "512")} className="text-xs px-2 py-1 rounded" style={{ background: "#152238", color: "#EFE9DD" }}>Payer (banque)</button>
                        </>
                      )}
                      <button onClick={() => startEditPurchase(p)} title="Modifier" style={{ color: "#152238" }}><Pencil size={14} /></button>
                      <button onClick={() => deletePurchase(p)} title="Supprimer" style={{ color: "#A6432F" }}><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      {tab === "fournisseurs" && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5 items-end">
            <div className="col-span-2">
              <label className="text-xs" style={{ color: "#8A8370" }}>Nom du fournisseur</label>
              <input value={newSupplier.name} onChange={(e) => setNewSupplier({ ...newSupplier, name: e.target.value })}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Contact</label>
              <input value={newSupplier.contact} onChange={(e) => setNewSupplier({ ...newSupplier, contact: e.target.value })}
                placeholder="Email / téléphone" className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <button onClick={addSupplier} className="flex items-center justify-center gap-2 px-4 py-2 rounded text-sm text-white h-[38px]" style={{ background: "#152238" }}>
              {editingSupplierId ? <CheckCircle2 size={14} /> : <Plus size={14} />}
              {editingSupplierId ? "Enregistrer" : "Ajouter"}
            </button>
          </div>
          {editingSupplierId && (
            <div className="flex items-center gap-2 mb-4 text-xs" style={{ color: "#A6432F" }}>
              Modification en cours.
              <button onClick={cancelEditSupplier} className="underline">Annuler</button>
            </div>
          )}
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                <th className="py-2 font-normal">Nom</th>
                <th className="py-2 font-normal">Contact</th>
                <th className="py-2 font-normal text-right">Total achats à payer</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => {
                const due = purchases.filter((p) => p.supplier === s.name && p.status === "à payer").reduce((sum, p) => sum + p.amount, 0);
                return (
                  <tr key={s.id} style={{ borderBottom: "1px solid #F3EFE3", background: editingSupplierId === s.id ? "#FAF8F1" : "transparent" }}>
                    <td className="py-2">{s.name}</td>
                    <td className="py-2">{s.contact || "—"}</td>
                    <td className="py-2 tabular text-right">{fmt(due)}</td>
                    <td className="py-2 text-right">
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => startEditSupplier(s)} title="Modifier" style={{ color: "#152238" }}><Pencil size={14} /></button>
                        <button onClick={() => deleteSupplier(s)} title="Supprimer" style={{ color: "#A6432F" }}><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}

function StockModule({ products, setProducts, movements, setMovements, showToast }) {
  const [tab, setTab] = useState("inventaire");
  const stockProducts = products.filter((p) => p.type === "marchandise");
  const [form, setForm] = useState({
    productId: stockProducts[0]?.id,
    type: "entree",
    qty: "",
    reason: "",
  });

  const addMovement = () => {
    if (!form.qty || Number(form.qty) <= 0) {
      showToast("Renseignez une quantité valide.");
      return;
    }
    const product = products.find((p) => p.id === Number(form.productId));
    if (!product) return;
    const delta = form.type === "sortie" ? -Number(form.qty) : Number(form.qty);
    setProducts(products.map((p) => (p.id === product.id ? { ...p, stock: Math.max(0, (p.stock || 0) + delta) } : p)));
    setMovements([
      ...movements,
      {
        id: Date.now(),
        date: new Date().toISOString().slice(0, 10),
        productId: product.id,
        productName: product.name,
        type: form.type,
        qty: Number(form.qty),
        reason: form.reason || (form.type === "entree" ? "Réception fournisseur" : form.type === "sortie" ? "Sortie manuelle" : "Ajustement d'inventaire"),
      },
    ]);
    setForm({ ...form, qty: "", reason: "" });
    showToast("Mouvement de stock enregistré.");
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-widest" style={{ color: "#C9A24B" }}>Module 5</div>
        <div className="display text-3xl" style={{ color: "#152238" }}>Stock et inventaire</div>
        <p className="text-sm mt-1" style={{ color: "#7A7460" }}>
          Le stock est décrémenté automatiquement à chaque vente de marchandise (Module 3).
        </p>
      </header>

      <div className="flex gap-1 mb-6">
        {[["inventaire", "Inventaire"], ["mouvements", "Mouvements"]].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="px-4 py-2 text-sm rounded-t"
            style={{
              background: tab === id ? "#fff" : "transparent",
              borderBottom: tab === id ? "2px solid #C9A24B" : "2px solid transparent",
              color: tab === id ? "#152238" : "#8A8370",
              fontWeight: tab === id ? 600 : 400,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "inventaire" && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          {stockProducts.length === 0 ? (
            <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>
              Aucune marchandise au catalogue. Ajoutez des articles de type « Marchandise » depuis le Module 3 — Catalogue.
            </div>
          ) : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead>
                <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                  <th className="py-2 font-normal">Code</th>
                  <th className="py-2 font-normal">Article</th>
                  <th className="py-2 font-normal text-right">Stock</th>
                  <th className="py-2 font-normal text-right">Seuil d'alerte</th>
                  <th className="py-2 font-normal text-center">État</th>
                </tr>
              </thead>
              <tbody>
                {stockProducts.map((p) => {
                  const low = (p.stock || 0) <= (p.seuil || 0);
                  return (
                    <tr key={p.id} style={{ borderBottom: "1px solid #F3EFE3" }}>
                      <td className="py-2 tabular">{p.code}</td>
                      <td className="py-2">{p.name}</td>
                      <td className="py-2 tabular text-right">{p.stock || 0}</td>
                      <td className="py-2 tabular text-right">{p.seuil || 0}</td>
                      <td className="py-2 text-center">
                        <span className="text-xs px-2 py-0.5 rounded"
                          style={{ background: low ? "#F7E9E3" : "#E6F1EE", color: low ? "#A6432F" : "#0F6B5C" }}>
                          {low ? "à réapprovisionner" : "suffisant"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          )}
        </div>
      )}

      {tab === "mouvements" && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          {stockProducts.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5 items-end">
              <div className="col-span-2">
                <label className="text-xs" style={{ color: "#8A8370" }}>Article</label>
                <select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}
                  className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                  {stockProducts.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs" style={{ color: "#8A8370" }}>Type</label>
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                  className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                  <option value="entree">Entrée (réception)</option>
                  <option value="sortie">Sortie manuelle</option>
                  <option value="ajustement">Ajustement</option>
                </select>
              </div>
              <div>
                <label className="text-xs" style={{ color: "#8A8370" }}>Quantité</label>
                <input type="number" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })}
                  className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
              </div>
              <button onClick={addMovement} className="flex items-center justify-center gap-2 px-4 py-2 rounded text-sm text-white h-[38px]" style={{ background: "#152238" }}>
                <Plus size={14} /> Enregistrer
              </button>
            </div>
          )}

          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                <th className="py-2 font-normal">Date</th>
                <th className="py-2 font-normal">Article</th>
                <th className="py-2 font-normal">Type</th>
                <th className="py-2 font-normal">Motif</th>
                <th className="py-2 font-normal text-right">Quantité</th>
              </tr>
            </thead>
            <tbody>
              {movements.length === 0 && (
                <tr><td colSpan={5} className="py-8 text-center" style={{ color: "#A39C87" }}>Aucun mouvement pour le moment.</td></tr>
              )}
              {[...movements].reverse().map((m) => (
                <tr key={m.id} style={{ borderBottom: "1px solid #F3EFE3" }}>
                  <td className="py-2 tabular">{m.date}</td>
                  <td className="py-2">{m.productName}</td>
                  <td className="py-2">
                    <span className="flex items-center gap-1" style={{ color: m.type === "sortie" ? "#A6432F" : "#0F6B5C" }}>
                      {m.type === "sortie" ? <ArrowUpCircle size={14} /> : <ArrowDownCircle size={14} />}
                      {m.type === "entree" ? "Entrée" : m.type === "sortie" ? "Sortie" : "Ajustement"}
                    </span>
                  </td>
                  <td className="py-2" style={{ color: "#7A7460" }}>{m.reason}</td>
                  <td className="py-2 tabular text-right">{m.qty}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}

function CRMModule({ clients, setClients, invoices, showToast }) {
  const [newClient, setNewClient] = useState({ name: "", email: "", phone: "" });
  const [selected, setSelected] = useState(null);

  // Fusionne les clients déclarés et les noms de clients apparus dans les factures
  const invoiceNames = [...new Set(invoices.map((i) => i.client).filter((n) => n && n !== "Client comptant"))];
  const rows = invoiceNames.map((name) => {
    const known = clients.find((c) => c.name === name);
    const clientInvoices = invoices.filter((i) => i.client === name);
    const total = clientInvoices.reduce((s, i) => s + i.total, 0);
    const due = clientInvoices.filter((i) => i.status === "impayée").reduce((s, i) => s + i.total, 0);
    const lastDate = clientInvoices.reduce((max, i) => (i.date > max ? i.date : max), "");
    return { name, email: known?.email || "", phone: known?.phone || "", nb: clientInvoices.length, total, due, lastDate, invoices: clientInvoices };
  });

  const addClient = () => {
    if (!newClient.name) {
      showToast("Le nom du client est requis.");
      return;
    }
    if (clients.some((c) => c.name === newClient.name)) {
      showToast("Ce client existe déjà.");
      return;
    }
    setClients([...clients, { ...newClient, id: Date.now() }]);
    setNewClient({ name: "", email: "", phone: "" });
    showToast("Client ajouté.");
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-widest" style={{ color: "#C9A24B" }}>Module 6</div>
        <div className="display text-3xl" style={{ color: "#152238" }}>Comptes clients (CRM)</div>
        <p className="text-sm mt-1" style={{ color: "#7A7460" }}>
          Fiches alimentées automatiquement par les factures du Module 3 — un client apparaît dès sa première vente.
        </p>
      </header>

      <div className="bg-white rounded-lg p-6 mb-6" style={{ border: "1px solid #E4DFD1" }}>
        <div className="text-sm font-medium mb-3" style={{ color: "#152238" }}>Compléter une fiche client</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Nom du client</label>
            <input value={newClient.name} onChange={(e) => setNewClient({ ...newClient, name: e.target.value })}
              placeholder="Doit correspondre au nom saisi en vente"
              className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
          </div>
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Email</label>
            <input value={newClient.email} onChange={(e) => setNewClient({ ...newClient, email: e.target.value })}
              className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
          </div>
          <div>
            <label className="text-xs" style={{ color: "#8A8370" }}>Téléphone</label>
            <input value={newClient.phone} onChange={(e) => setNewClient({ ...newClient, phone: e.target.value })}
              className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
          </div>
          <button onClick={addClient} className="flex items-center justify-center gap-2 px-4 py-2 rounded text-sm text-white h-[38px]" style={{ background: "#152238" }}>
            <Plus size={14} /> Enregistrer
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
        {rows.length === 0 ? (
          <div className="text-sm py-8 text-center" style={{ color: "#A39C87" }}>
            Aucun client pour le moment. Les clients apparaissent ici dès qu'une vente leur est associée dans le Module 3.
          </div>
        ) : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                <th className="py-2 font-normal">Client</th>
                <th className="py-2 font-normal">Contact</th>
                <th className="py-2 font-normal text-right">Factures</th>
                <th className="py-2 font-normal text-right">Total facturé</th>
                <th className="py-2 font-normal text-right">Solde dû</th>
                <th className="py-2 font-normal">Dernier achat</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <React.Fragment key={r.name}>
                  <tr
                    onClick={() => setSelected(selected === r.name ? null : r.name)}
                    className="cursor-pointer"
                    style={{ borderBottom: "1px solid #F3EFE3" }}
                  >
                    <td className="py-2 font-medium" style={{ color: "#152238" }}>{r.name}</td>
                    <td className="py-2" style={{ color: "#7A7460" }}>{r.email || r.phone || "—"}</td>
                    <td className="py-2 tabular text-right">{r.nb}</td>
                    <td className="py-2 tabular text-right">{fmt(r.total)}</td>
                    <td className="py-2 tabular text-right" style={{ color: r.due > 0 ? "#A6432F" : "#0F6B5C" }}>{fmt(r.due)}</td>
                    <td className="py-2 tabular">{r.lastDate}</td>
                  </tr>
                  {selected === r.name && (
                    <tr>
                      <td colSpan={6} className="py-3 px-3" style={{ background: "#FAF8F1" }}>
                        <div className="text-xs uppercase tracking-widest mb-2" style={{ color: "#8A8370" }}>Historique des factures</div>
                        <div className="overflow-x-auto"><table className="w-full text-xs">
                          <tbody>
                            {r.invoices.map((inv) => (
                              <tr key={inv.id}>
                                <td className="py-1 tabular">{inv.number}</td>
                                <td className="py-1 tabular">{inv.date}</td>
                                <td className="py-1 tabular text-right">{fmt(inv.total)}</td>
                                <td className="py-1 text-right">
                                  <span className="px-2 py-0.5 rounded" style={{ background: inv.status === "payée" ? "#E6F1EE" : "#F7E9E3", color: inv.status === "payée" ? "#0F6B5C" : "#A6432F" }}>
                                    {inv.status}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table></div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}

function RapportsModule({ accounts, balances, invoices, purchases, entries, settings, showToast }) {
  const [tab, setTab] = useState("resultat");

  const produitsAccounts = accounts.filter((a) => a.type === "Produit").map((a) => ({ ...a, solde: -(balances[a.code] || 0) }));
  const chargesAccounts = accounts.filter((a) => a.type === "Charge").map((a) => ({ ...a, solde: balances[a.code] || 0 }));
  const totalProduits = produitsAccounts.reduce((s, a) => s + a.solde, 0);
  const totalCharges = chargesAccounts.reduce((s, a) => s + a.solde, 0);
  const resultat = totalProduits - totalCharges;

  const actifAccounts = accounts.filter((a) => a.type === "Actif").map((a) => ({ ...a, solde: balances[a.code] || 0 }));
  const passifAccounts = accounts.filter((a) => a.type === "Passif").map((a) => ({ ...a, solde: -(balances[a.code] || 0) }));
  const capitauxAccounts = accounts.filter((a) => a.type === "Capitaux propres").map((a) => ({ ...a, solde: -(balances[a.code] || 0) }));
  const totalActif = actifAccounts.reduce((s, a) => s + a.solde, 0);
  const totalPassif = passifAccounts.reduce((s, a) => s + a.solde, 0) + capitauxAccounts.reduce((s, a) => s + a.solde, 0) + resultat;

  const salesByMonth = useMemo(() => {
    const byMonth = {};
    invoices.forEach((inv) => {
      const key = monthLabel(inv.date);
      byMonth[key] = (byMonth[key] || 0) + inv.total;
    });
    return Object.entries(byMonth).map(([mois, total]) => ({ mois, total }));
  }, [invoices]);

  const topProducts = useMemo(() => {
    const byProduct = {};
    invoices.forEach((inv) => {
      inv.lines.forEach((l) => {
        if (!byProduct[l.name]) byProduct[l.name] = { name: l.name, qty: 0, revenue: 0 };
        byProduct[l.name].qty += l.qty;
        byProduct[l.name].revenue += l.subtotal;
      });
    });
    return Object.values(byProduct).sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  }, [invoices]);

  const exportFEC = () => {
    const cols = ["JournalCode", "JournalLib", "EcritureNum", "EcritureDate", "CompteNum", "CompteLib", "CompAuxNum", "CompAuxLib", "PieceRef", "PieceDate", "EcritureLib", "Debit", "Credit", "EcritureLet", "DateLet", "ValidDate", "Montantdevise", "Idevise"];
    const rows = [cols.join("\t")];
    const sorted = [...entries].sort((a, b) => (a.date > b.date ? 1 : -1));
    sorted.forEach((e, idx) => {
      const ecritureNum = String(idx + 1).padStart(6, "0");
      const dateFEC = (e.date || "").replaceAll("-", "");
      (e.lines || []).forEach((l) => {
        const acc = accounts.find((a) => a.code === l.account);
        rows.push([
          "OD", "Opérations diverses", ecritureNum, dateFEC,
          l.account, acc?.name || "", "", "",
          ecritureNum, dateFEC, e.label || "",
          l.debit ? l.debit.toFixed(2) : "0.00",
          l.credit ? l.credit.toFixed(2) : "0.00",
          "", "", dateFEC, "", "",
        ].join("\t"));
      });
    });
    const blob = new Blob(["\uFEFF" + rows.join("\r\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `FEC-${(settings?.companyName || "export").replace(/\s+/g, "")}-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Fichier FEC généré.");
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-widest" style={{ color: "#C9A24B" }}>Module 7</div>
        <div className="display text-3xl" style={{ color: "#152238" }}>Rapports et analyse</div>
        <p className="text-sm mt-1" style={{ color: "#7A7460" }}>États calculés en continu à partir du journal comptable et des ventes.</p>
      </header>

      <div className="flex gap-1 mb-6 flex-wrap">
        {[["resultat", "Compte de résultat"], ["bilan", "Bilan simplifié"], ["balance", "Balance des comptes"], ["ventes", "Analyse des ventes"], ["export", "Export"]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className="px-4 py-2 text-sm rounded-t"
            style={{
              background: tab === id ? "#fff" : "transparent",
              borderBottom: tab === id ? "2px solid #C9A24B" : "2px solid transparent",
              color: tab === id ? "#152238" : "#8A8370",
              fontWeight: tab === id ? 600 : 400,
            }}>
            {label}
          </button>
        ))}
      </div>

      {tab === "resultat" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
            <div className="text-sm font-semibold mb-3" style={{ color: "#0F6B5C" }}>Produits</div>
            <div className="overflow-x-auto"><table className="w-full text-sm mb-2">
              <tbody>
                {produitsAccounts.map((a) => (
                  <tr key={a.code} style={{ borderBottom: "1px solid #F3EFE3" }}>
                    <td className="py-1.5 tabular" style={{ color: "#7A7460" }}>{a.code}</td>
                    <td className="py-1.5">{a.name}</td>
                    <td className="py-1.5 tabular text-right">{fmt(a.solde)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <div className="flex justify-between tabular text-sm font-semibold pt-2" style={{ borderTop: "1px solid #EEE9DA" }}>
              <span>Total produits</span><span>{fmt(totalProduits)}</span>
            </div>
          </div>
          <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
            <div className="text-sm font-semibold mb-3" style={{ color: "#A6432F" }}>Charges</div>
            <div className="overflow-x-auto"><table className="w-full text-sm mb-2">
              <tbody>
                {chargesAccounts.map((a) => (
                  <tr key={a.code} style={{ borderBottom: "1px solid #F3EFE3" }}>
                    <td className="py-1.5 tabular" style={{ color: "#7A7460" }}>{a.code}</td>
                    <td className="py-1.5">{a.name}</td>
                    <td className="py-1.5 tabular text-right">{fmt(a.solde)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <div className="flex justify-between tabular text-sm font-semibold pt-2" style={{ borderTop: "1px solid #EEE9DA" }}>
              <span>Total charges</span><span>{fmt(totalCharges)}</span>
            </div>
          </div>
          <div className="col-span-2 bg-white rounded-lg p-6 flex justify-between items-center" style={{ border: "1px solid #E4DFD1" }}>
            <span className="text-sm font-medium" style={{ color: "#152238" }}>Résultat net</span>
            <span className="tabular text-xl font-semibold" style={{ color: resultat >= 0 ? "#0F6B5C" : "#A6432F" }}>{fmt(resultat)}</span>
          </div>
        </div>
      )}

      {tab === "bilan" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
            <div className="text-sm font-semibold mb-3" style={{ color: "#152238" }}>Actif</div>
            <div className="overflow-x-auto"><table className="w-full text-sm mb-2">
              <tbody>
                {actifAccounts.map((a) => (
                  <tr key={a.code} style={{ borderBottom: "1px solid #F3EFE3" }}>
                    <td className="py-1.5 tabular" style={{ color: "#7A7460" }}>{a.code}</td>
                    <td className="py-1.5">{a.name}</td>
                    <td className="py-1.5 tabular text-right">{fmt(a.solde)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <div className="flex justify-between tabular text-sm font-semibold pt-2" style={{ borderTop: "1px solid #EEE9DA" }}>
              <span>Total actif</span><span>{fmt(totalActif)}</span>
            </div>
          </div>
          <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
            <div className="text-sm font-semibold mb-3" style={{ color: "#152238" }}>Passif &amp; capitaux propres</div>
            <div className="overflow-x-auto"><table className="w-full text-sm mb-2">
              <tbody>
                {[...capitauxAccounts, ...passifAccounts].map((a) => (
                  <tr key={a.code} style={{ borderBottom: "1px solid #F3EFE3" }}>
                    <td className="py-1.5 tabular" style={{ color: "#7A7460" }}>{a.code}</td>
                    <td className="py-1.5">{a.name}</td>
                    <td className="py-1.5 tabular text-right">{fmt(a.solde)}</td>
                  </tr>
                ))}
                <tr style={{ borderBottom: "1px solid #F3EFE3" }}>
                  <td className="py-1.5 tabular" style={{ color: "#7A7460" }}>—</td>
                  <td className="py-1.5">Résultat de l'exercice</td>
                  <td className="py-1.5 tabular text-right">{fmt(resultat)}</td>
                </tr>
              </tbody>
            </table></div>
            <div className="flex justify-between tabular text-sm font-semibold pt-2" style={{ borderTop: "1px solid #EEE9DA" }}>
              <span>Total passif + capitaux propres</span><span>{fmt(totalPassif)}</span>
            </div>
          </div>
          {Math.round(totalActif) !== Math.round(totalPassif) && (
            <div className="col-span-2 text-xs px-4 py-2 rounded" style={{ background: "#F7E9E3", color: "#A6432F" }}>
              Écart entre actif et passif : {fmt(totalActif - totalPassif)} — vérifiez les écritures saisies.
            </div>
          )}
        </div>
      )}

      {tab === "balance" && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                <th className="py-2 font-normal">Code</th>
                <th className="py-2 font-normal">Compte</th>
                <th className="py-2 font-normal">Type</th>
                <th className="py-2 font-normal text-right">Solde</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.code} style={{ borderBottom: "1px solid #F3EFE3" }}>
                  <td className="py-2 tabular">{a.code}</td>
                  <td className="py-2">{a.name}</td>
                  <td className="py-2" style={{ color: "#7A7460" }}>{a.type}</td>
                  <td className="py-2 tabular text-right">{fmt(balances[a.code] || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      {tab === "ventes" && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
            <div className="text-sm font-semibold mb-4" style={{ color: "#152238" }}>Chiffre d'affaires par mois</div>
            {salesByMonth.length === 0 ? (
              <div className="text-sm py-10 text-center" style={{ color: "#A39C87" }}>Aucune vente enregistrée.</div>
            ) : (
              <SimpleLineChart data={salesByMonth} xKey="mois" yKey="total" color="#0F6B5C" name="Chiffre d'affaires" />
            )}
          </div>
          <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
            <div className="text-sm font-semibold mb-4" style={{ color: "#152238" }}>Meilleures ventes</div>
            {topProducts.length === 0 ? (
              <div className="text-sm py-10 text-center" style={{ color: "#A39C87" }}>Aucune vente enregistrée.</div>
            ) : (
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead>
                  <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                    <th className="py-2 font-normal">Article</th>
                    <th className="py-2 font-normal text-right">Quantité vendue</th>
                    <th className="py-2 font-normal text-right">Chiffre d'affaires</th>
                  </tr>
                </thead>
                <tbody>
                  {topProducts.map((p) => (
                    <tr key={p.name} style={{ borderBottom: "1px solid #F3EFE3" }}>
                      <td className="py-2">{p.name}</td>
                      <td className="py-2 tabular text-right">{p.qty}</td>
                      <td className="py-2 tabular text-right">{p.revenue !== undefined ? fmt(p.revenue) : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>
        </div>
      )}

      {tab === "export" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white rounded-lg p-5" style={{ border: "1px solid #E4DFD1" }}>
            <FileDown size={18} style={{ color: "#0F6B5C" }} className="mb-2" />
            <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Export FEC</div>
            <p className="text-xs mb-3" style={{ color: "#8A8370" }}>
              Fichier des Écritures Comptables au format normé (18 colonnes, séparateur tabulation) — le format exigé par l'administration fiscale française en cas de contrôle.
            </p>
            <button onClick={exportFEC} className="px-3 py-1.5 rounded text-xs text-white" style={{ background: "#152238" }}>
              Télécharger le FEC (.txt)
            </button>
          </div>
          <div className="bg-white rounded-lg p-5 no-print" style={{ border: "1px solid #E4DFD1" }}>
            <Printer size={18} style={{ color: "#0F6B5C" }} className="mb-2" />
            <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Export PDF</div>
            <p className="text-xs mb-3" style={{ color: "#8A8370" }}>
              Ouvre l'aperçu d'impression du navigateur sur les états ci-dessus (compte de résultat, bilan, balance) — choisissez « Enregistrer au format PDF » comme destination.
            </p>
            <button onClick={() => window.print()} className="px-3 py-1.5 rounded text-xs text-white" style={{ background: "#152238" }}>
              Imprimer / Exporter en PDF
            </button>
          </div>
          <div className="col-span-2 text-xs px-4 py-3 rounded" style={{ background: "#FAF8F1", color: "#7A7460" }}>
            Pour un export PDF ciblé (ex. uniquement le compte de résultat), retournez sur l'onglet souhaité puis utilisez ce même bouton — seul le contenu de la page est imprimé, la barre latérale est masquée automatiquement.
          </div>
        </div>
      )}
    </div>
  );
}

function AdminModule({
  settings, setSettings, users, setUsers,
  accounts, entries, products, invoices, suppliers, purchases, movements, clients,
  setAccounts, setEntries, setProducts, setInvoices, setSuppliers, setPurchases, setMovements, setClients,
  showToast,
}) {
  const [tab, setTab] = useState("entreprise");
  const [companyName, setCompanyName] = useState(settings.companyName);
  const [currency, setCurrency] = useState(settings.currency || "EUR");
  const [taxForm, setTaxForm] = useState({
    taxSystem: settings.taxSystem,
    taxRate: settings.taxRate,
    taxAccount: settings.taxAccount,
    taxDeductibleOnPurchases: settings.taxDeductibleOnPurchases,
  });
  const [newUser, setNewUser] = useState({ email: "", role: "Éditeur" });
  const [members, setMembers] = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const fileInputRef = React.useRef(null);

  const loadMembers = async () => {
    setMembersLoading(true);
    try {
      const { companyId } = await resolveMembership();
      const { data, error } = await supabase
        .from("company_members")
        .select("id, email, role, user_id")
        .eq("company_id", companyId)
        .order("created_at", { ascending: true });
      if (!error) setMembers(data || []);
    } catch (e) {
      // hors mode Supabase, rien à charger
    }
    setMembersLoading(false);
  };

  useEffect(() => {
    if (tab === "utilisateurs") loadMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const saveCompany = () => {
    setSettings({ ...settings, companyName, currency });
    showToast("Paramètres de l'entreprise enregistrés.");
  };

  const saveTax = () => {
    setSettings({ ...settings, ...taxForm, taxRate: Number(taxForm.taxRate) });
    showToast("Système de taxation mis à jour. Les nouveaux articles reprendront ce taux par défaut.");
  };

  const addUser = async () => {
    if (!newUser.email) {
      showToast("L'email de l'utilisateur est requis.");
      return;
    }
    try {
      const { companyId } = await resolveMembership();
      const { error } = await supabase.from("company_members").insert({ company_id: companyId, email: newUser.email.trim().toLowerCase(), role: newUser.role });
      if (error) {
        showToast(error.code === "23505" ? "Cette personne est déjà membre." : "Impossible d'ajouter cette personne.");
        return;
      }
      setNewUser({ email: "", role: "Éditeur" });
      showToast(`Invitation créée pour ${newUser.email}. Elle prend effet dès sa première connexion avec cet email.`);
      loadMembers();
    } catch (e) {
      showToast("Fonction disponible uniquement en mode Supabase.");
    }
  };

  const changeUserRole = async (member, role) => {
    await supabase.from("company_members").update({ role }).eq("id", member.id);
    loadMembers();
    showToast("Rôle mis à jour.");
  };

  const removeUser = async (member) => {
    if (!window.confirm(`Retirer ${member.email} de l'entreprise ?`)) return;
    await supabase.from("company_members").delete().eq("id", member.id);
    loadMembers();
    showToast("Membre retiré.");
  };

  const exportData = () => {
    const data = { accounts, entries, products, invoices, suppliers, purchases, movements, clients, settings, users };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sauvegarde-${settings.companyName || "erp"}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Export généré.");
  };

  const importData = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = JSON.parse(evt.target.result);
        if (data.accounts) setAccounts(data.accounts);
        if (data.entries) setEntries(data.entries);
        if (data.products) setProducts(data.products);
        if (data.invoices) setInvoices(data.invoices);
        if (data.suppliers) setSuppliers(data.suppliers);
        if (data.purchases) setPurchases(data.purchases);
        if (data.movements) setMovements(data.movements);
        if (data.clients) setClients(data.clients);
        if (data.settings) setSettings(data.settings);
        if (data.users) setUsers(data.users);
        showToast("Données importées avec succès.");
      } catch (err) {
        showToast("Fichier invalide, import annulé.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const resetData = () => {
    if (!window.confirm("Réinitialiser toutes les données de l'application ? Cette action est irréversible.")) return;
    setAccounts(DEFAULT_ACCOUNTS);
    setEntries([]);
    setProducts(DEFAULT_PRODUCTS);
    setInvoices([]);
    setSuppliers(DEFAULT_SUPPLIERS);
    setPurchases([]);
    setMovements([]);
    setClients(DEFAULT_CLIENTS);
    showToast("Données réinitialisées.");
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-widest" style={{ color: "#C9A24B" }}>Module 8</div>
        <div className="display text-3xl" style={{ color: "#152238" }}>Administration et paramètres</div>
      </header>

      <div className="flex gap-1 mb-6">
        {[["entreprise", "Entreprise"], ["utilisateurs", "Utilisateurs"], ["donnees", "Données"]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className="px-4 py-2 text-sm rounded-t"
            style={{
              background: tab === id ? "#fff" : "transparent",
              borderBottom: tab === id ? "2px solid #C9A24B" : "2px solid transparent",
              color: tab === id ? "#152238" : "#8A8370",
              fontWeight: tab === id ? 600 : 400,
            }}>
            {label}
          </button>
        ))}
      </div>

      {tab === "entreprise" && (
        <div className="space-y-6 max-w-md">
          <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
            <div className="mb-4">
              <label className="text-xs" style={{ color: "#8A8370" }}>Nom de l'entreprise</label>
              <input value={companyName} onChange={(e) => setCompanyName(e.target.value)}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div className="mb-4">
              <label className="text-xs" style={{ color: "#8A8370" }}>Devise</label>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                {Object.entries(CURRENCIES).map(([code, c]) => (
                  <option key={code} value={code}>{c.label}</option>
                ))}
              </select>
              <p className="text-xs mt-1" style={{ color: "#A39C87" }}>
                S'applique à tous les montants affichés dans l'application. Pour le régime TCA (Haïti), la Gourde (HTG) est généralement la devise attendue.
              </p>
            </div>
            <button onClick={saveCompany} className="px-4 py-2 rounded text-sm text-white" style={{ background: "#152238" }}>
              Enregistrer
            </button>
          </div>

          <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
            <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Système de taxation</div>
            <p className="text-xs mb-4" style={{ color: "#8A8370" }}>
              Choisissez le régime applicable aux ventes du Module 3. Le taux par défaut s'applique aux nouveaux articles du catalogue (modifiable par article).
            </p>

            <div className="mb-4">
              <label className="text-xs" style={{ color: "#8A8370" }}>Régime fiscal</label>
              <select
                value={taxForm.taxSystem}
                onChange={(e) => {
                  const sys = e.target.value;
                  setTaxForm({ ...taxForm, taxSystem: sys, taxRate: TAX_SYSTEMS[sys].defaultRate });
                  if (sys === "tca" && currency === "EUR") setCurrency("HTG");
                }}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                <option value="tva">TVA — Taxe sur la Valeur Ajoutée (déductible sur achats)</option>
                <option value="tca">TCA — Taxe sur le Chiffre d'Affaires (Haïti, 10 %, non déductible)</option>
                <option value="aucune">Aucune taxe</option>
              </select>
              <p className="text-xs mt-1" style={{ color: "#A39C87" }}>{TAX_SYSTEMS[taxForm.taxSystem]?.description}</p>
            </div>

            {taxForm.taxSystem !== "aucune" && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                  <div>
                    <label className="text-xs" style={{ color: "#8A8370" }}>Taux par défaut (%)</label>
                    <input type="number" value={taxForm.taxRate} onChange={(e) => setTaxForm({ ...taxForm, taxRate: e.target.value })}
                      className="w-full border rounded px-2 py-1.5 text-sm mt-1 tabular" style={{ borderColor: "#DDD6C4" }} />
                  </div>
                  <div>
                    <label className="text-xs" style={{ color: "#8A8370" }}>Compte de taxe collectée</label>
                    <select value={taxForm.taxAccount} onChange={(e) => setTaxForm({ ...taxForm, taxAccount: e.target.value })}
                      className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                      {accounts.filter((a) => a.type === "Passif").map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                    </select>
                  </div>
                </div>
                {taxForm.taxSystem === "tva" && (
                  <label className="flex items-center gap-2 text-xs mb-4" style={{ color: "#8A8370" }}>
                    <input type="checkbox" checked={taxForm.taxDeductibleOnPurchases}
                      onChange={(e) => setTaxForm({ ...taxForm, taxDeductibleOnPurchases: e.target.checked })} />
                    TVA déductible sur les achats (mécanisme de crédit de taxe)
                  </label>
                )}
              </>
            )}

            <button onClick={saveTax} className="px-4 py-2 rounded text-sm text-white" style={{ background: "#152238" }}>
              Enregistrer le régime fiscal
            </button>
          </div>
        </div>
      )}

      {tab === "utilisateurs" && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <p className="text-xs mb-4" style={{ color: "#8A8370" }}>
            Invitez une personne par email : dès qu'elle se connecte avec cette adresse, elle rejoint automatiquement cette entreprise avec le rôle choisi. <b>Lecture seule</b> permet de consulter sans rien modifier ; <b>Éditeur</b> permet de saisir et modifier les données ; <b>Administrateur</b> a en plus accès à ce module.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5 items-end">
            <div className="sm:col-span-2">
              <label className="text-xs" style={{ color: "#8A8370" }}>Email</label>
              <input value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                placeholder="collegue@email.com"
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Rôle</label>
              <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                <option>Administrateur</option>
                <option>Éditeur</option>
                <option>Lecture seule</option>
              </select>
            </div>
            <button onClick={addUser} className="flex items-center justify-center gap-2 px-4 py-2 rounded text-sm text-white h-[38px] sm:col-span-3" style={{ background: "#152238" }}>
              <Plus size={14} /> Inviter
            </button>
          </div>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                <th className="py-2 font-normal">Email</th>
                <th className="py-2 font-normal">Rôle</th>
                <th className="py-2 font-normal">Statut</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {membersLoading && (
                <tr><td colSpan={4} className="py-8 text-center" style={{ color: "#A39C87" }}>Chargement…</td></tr>
              )}
              {!membersLoading && members.length === 0 && (
                <tr><td colSpan={4} className="py-8 text-center" style={{ color: "#A39C87" }}>Aucun membre pour le moment.</td></tr>
              )}
              {members.map((m) => (
                <tr key={m.id} style={{ borderBottom: "1px solid #F3EFE3" }}>
                  <td className="py-2" style={{ color: "#7A7460" }}>{m.email}</td>
                  <td className="py-2">
                    <select value={m.role} onChange={(e) => changeUserRole(m, e.target.value)}
                      className="border rounded px-2 py-1 text-xs" style={{ borderColor: "#DDD6C4" }}>
                      <option>Administrateur</option>
                      <option>Éditeur</option>
                      <option>Lecture seule</option>
                    </select>
                  </td>
                  <td className="py-2">
                    <span className="text-xs px-2 py-0.5 rounded" style={{ background: m.user_id ? "#E6F1EE" : "#F7E9E3", color: m.user_id ? "#0F6B5C" : "#A6432F" }}>
                      {m.user_id ? "actif" : "invitation en attente"}
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    {members.length > 1 && (
                      <button onClick={() => removeUser(m)} style={{ color: "#A6432F" }}><Trash2 size={14} /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      {tab === "donnees" && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-lg p-5" style={{ border: "1px solid #E4DFD1" }}>
            <Download size={18} style={{ color: "#0F6B5C" }} className="mb-2" />
            <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Exporter les données</div>
            <p className="text-xs mb-3" style={{ color: "#8A8370" }}>Télécharge une sauvegarde complète au format JSON.</p>
            <button onClick={exportData} className="px-3 py-1.5 rounded text-xs text-white" style={{ background: "#152238" }}>Exporter</button>
          </div>
          <div className="bg-white rounded-lg p-5" style={{ border: "1px solid #E4DFD1" }}>
            <Upload size={18} style={{ color: "#0F6B5C" }} className="mb-2" />
            <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Importer une sauvegarde</div>
            <p className="text-xs mb-3" style={{ color: "#8A8370" }}>Remplace les données actuelles par celles du fichier.</p>
            <input type="file" accept="application/json" ref={fileInputRef} onChange={importData} className="hidden" />
            <button onClick={() => fileInputRef.current?.click()} className="px-3 py-1.5 rounded text-xs text-white" style={{ background: "#152238" }}>Importer</button>
          </div>
          <div className="bg-white rounded-lg p-5" style={{ border: "1px solid #E4DFD1" }}>
            <RotateCcw size={18} style={{ color: "#A6432F" }} className="mb-2" />
            <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Réinitialiser</div>
            <p className="text-xs mb-3" style={{ color: "#8A8370" }}>Efface toutes les données transactionnelles et repart d'un plan comptable vierge.</p>
            <button onClick={resetData} className="px-3 py-1.5 rounded text-xs text-white" style={{ background: "#A6432F" }}>Réinitialiser</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ComingSoon({ module }) {
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

// --- Montage de l'application ---
ReactDOM.createRoot(document.getElementById("root")).render(
  <AuthGate><App /></AuthGate>
);
