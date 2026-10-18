// ═══ MODULE ═══
// @module Composants et utilitaires
// @depends __uidCounter, supabase, useState
// @exports FALLBACK_HTG_PER_USD, GENESIS_HASH, GroupedTabNav, NET_MSG, PLAN_TIER_INFO
//   canonicalEntryContent, friendlyError, genInviteToken, isFutureDate, normalizeClientName
//   sanitizeUserMessage, sealEntries, sha256Hex, todayStr, uid, verifyChain, verifyChainFull
// ═══ FIN DE L'EN-TÊTE ═══
// Normalise un nom de client pour le regroupement (espaces superflus et casse
// ignorés) — sans ça, deux saisies légèrement différentes du même nom ("Guerline"
// vs "Guerline " ou une casse différente) créent deux fiches distinctes au lieu
// d'une seule, faussant le solde dû total du client.
// Navigation à deux niveaux (catégorie puis onglet) — utilisée par les modules
// ayant trop d'onglets pour tenir sur une seule ligne (Comptabilité, Rapports).
// `groups` : [{ label, tabs: [[id, label], ...] }, ...]. La catégorie active se
// déduit automatiquement de l'onglet courant, pour rester cohérente si l'onglet
// est changé par un autre moyen (ex. lien direct).
function GroupedTabNav({ groups, tab, setTab, className }) {
  const activeGroupIdx = groups.findIndex((g) => g.tabs.some(([id]) => id === tab));
  const [openGroupIdx, setOpenGroupIdx] = useState(activeGroupIdx >= 0 ? activeGroupIdx : 0);
  const currentGroupIdx = activeGroupIdx >= 0 ? activeGroupIdx : openGroupIdx;
  const currentColor = groups[currentGroupIdx].color || { bg: "#152238", text: "#fff", light: "#F3EFE3", lightText: "#7A7460" };

  return (
    <div className={`mb-6 ${className || ""}`}>
      <div className="flex gap-1 flex-wrap" style={{ borderBottom: "1px solid #EEE9DA" }}>
        {groups.map((g, i) => {
          const c = g.color || { bg: "#152238", text: "#fff" };
          return (
          <button
            key={g.label}
            onClick={() => { setOpenGroupIdx(i); if (!g.tabs.some(([id]) => id === tab)) setTab(g.tabs[0][0]); }}
            className="px-4 py-2 text-sm rounded-t shrink-0 whitespace-nowrap"
            style={{
              background: currentGroupIdx === i ? c.light : "transparent",
              borderBottom: currentGroupIdx === i ? `2px solid ${c.bg}` : "2px solid transparent",
              color: currentGroupIdx === i ? c.bg : "#8A8370",
              fontWeight: currentGroupIdx === i ? 600 : 400,
            }}
          >
            {g.label}
          </button>
          );
        })}
      </div>
      <div className="flex gap-1 flex-wrap mt-2">
        {groups[currentGroupIdx].tabs.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="px-3 py-1.5 rounded-full text-xs shrink-0 whitespace-nowrap"
            style={{
              background: tab === id ? currentColor.bg : currentColor.light,
              color: tab === id ? (currentColor.text || "#fff") : currentColor.bg,
              fontWeight: tab === id ? 600 : 400,
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function normalizeClientName(n) {
  return (n || "").trim().replace(/\s+/g, " ").toLowerCase();
}

// --- Messages d'erreur : jamais de détail technique à l'écran ---
// Toute erreur technique (base de données, réseau, code interne…) est remplacée par un message
// courant : le détail reste réservé à la console du navigateur et à l'Historique.
const NET_MSG = "Un problème de connexion internet empêche cette opération. Vérifiez votre réseau, puis réessayez.";
const TECH_RE = /TypeError|SyntaxError|ReferenceError|RangeError|Failed to fetch|NetworkError|Network request|Load failed|PGRST|row-level|violates|duplicate key|kv_store|compta-[a-z]|\bundefined\b|\bnull\b|\[object|\bJWT\b|schema|relation "|column "|\bRPC\b|\brpc\b|supabase|\bSQL\b|\b(42|23|22|40|53|57|P0)\d{3}\b|\bHTTP\b|status \d{3}|Edge Function|Invalid |not found|permission denied|\b(the|is|are|was|were|cannot|unable|expected|unexpected|denied|exceeded|missing|required|already|exists|failed|error|could not|did not)\b/i;
function isTechnicalMessage(m) { return typeof m === "string" && TECH_RE.test(m); }
function friendlyError(e, fallback) {
  const raw = e && typeof e === "object" ? (e.message || "") : String(e == null ? "" : e);
  const hasCode = !!(e && typeof e === "object" && (e.code || e.details || e.hint || e.status));
  if (!raw && !hasCode) return fallback || NET_MSG;
  if (hasCode || isTechnicalMessage(raw)) {
    const net = (typeof navigator !== "undefined" && navigator.onLine === false) || /fetch|network|load failed|timeout|timed out|internet|abort/i.test(raw);
    return net ? NET_MSG : (fallback || NET_MSG);
  }
  return raw;
}
function sanitizeUserMessage(m) { return isTechnicalMessage(m) ? NET_MSG : m; }

function uid() {
  __uidCounter = (__uidCounter + 1) % 1000;
  return Date.now() * 1000 + __uidCounter;
}

// Génère un jeton d'invitation aléatoire (format UUID). Utilise crypto.randomUUID()
// quand disponible (navigateurs modernes, contexte HTTPS) ; repli manuel sinon.
function genInviteToken() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// --- Scellement cryptographique du journal (chaînage à la SHA-256) ---
// Implémentation SHA-256 pure JS, synchrone (pas de dépendance externe), pour pouvoir
// sceller chaque écriture au moment même où elle est ajoutée, sans réécrire tous les
// points d'ajout en code asynchrone. Chaque écriture porte le hash de la précédente :
// toute modification rétroactive d'une écriture déjà scellée casse la chaîne à partir
// de ce point, ce qui est détectable par vérifyChain().
const sha256Hex = (() => {
  const K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ];
  const rrot = (x, n) => (x >>> n) | (x << (32 - n));
  return (str) => {
    const bytes = new TextEncoder().encode(str);
    const bitLen = bytes.length * 8;
    const withOne = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
    withOne.set(bytes);
    withOne[bytes.length] = 0x80;
    const view = new DataView(withOne.buffer);
    view.setUint32(withOne.length - 4, bitLen >>> 0);
    view.setUint32(withOne.length - 8, Math.floor(bitLen / 4294967296));
    let h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const w = new Array(64);
    for (let chunk = 0; chunk < withOne.length; chunk += 64) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(chunk + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rrot(w[i - 15], 7) ^ rrot(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rrot(w[i - 2], 17) ^ rrot(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, hh] = h;
      for (let i = 0; i < 64; i++) {
        const S1 = rrot(e, 6) ^ rrot(e, 11) ^ rrot(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
        const S0 = rrot(a, 2) ^ rrot(a, 13) ^ rrot(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0;
        d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h = [h[0]+a|0, h[1]+b|0, h[2]+c|0, h[3]+d|0, h[4]+e|0, h[5]+f|0, h[6]+g|0, h[7]+hh|0];
    }
    return h.map((x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
  };
})();

const GENESIS_HASH = "0".repeat(64);
// Contenu canonique et immuable d'une écriture : seuls id/date/label/lines entrent dans
// le hash. Des métadonnées ajoutées après coup (cancelledBy, reconciled...) ne cassent
// pas le scellement, seule une altération du contenu comptable lui-même le casse.
const canonicalEntryContent = (e) => `${e.id}|${e.date}|${e.label}|${JSON.stringify(e.lines)}`;

// Parcourt les écritures dans leur ordre d'enregistrement et scelle (ajoute hash/prevHash)
// toute écriture qui n'en a pas encore. Retourne le tableau (inchangé par référence si rien
// à sceller) — à utiliser après tout ajout d'écriture, quel que soit le module d'origine.
const sealEntries = (list) => {
  let prevHash = GENESIS_HASH;
  let changed = false;
  const next = list.map((e) => {
    if (e.hash) {
      prevHash = e.hash;
      return e;
    }
    changed = true;
    const hash = sha256Hex(prevHash + "|" + canonicalEntryContent(e));
    prevHash = hash;
    return { ...e, prevHash: (e.prevHash !== undefined ? e.prevHash : list[list.indexOf(e) - 1]?.hash) ?? GENESIS_HASH, hash };
  });
  return changed ? next : list;
};

// Revérifie l'intégralité de la chaîne à partir de zéro (indépendamment des hash stockés)
// et compare : détecte toute altération rétroactive du contenu d'une écriture déjà scellée.
const verifyChain = (list) => {
  let prevHash = GENESIS_HASH;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const expected = sha256Hex(prevHash + "|" + canonicalEntryContent(e));
    if (!e.hash) return { ok: false, brokenAt: i, entry: e, reason: "non scellée" };
    if (e.hash !== expected) return { ok: false, brokenAt: i, entry: e, reason: "contenu modifié après scellement" };
    prevHash = e.hash;
  }
  return { ok: true, count: list.length, lastHash: prevHash };
};

// Variante qui ne s'arrête pas à la première anomalie : utile pour savoir si UNE
// seule écriture est concernée (probable ancien format de scellement, ou altération
// isolée) ou si le problème touche massivement le journal (bien plus grave). Utilise
// le hash STOCKÉ (pas recalculé) comme référence pour la suite de la chaîne, pour
// qu'une seule anomalie ne déclenche pas un effet domino de faux positifs sur toutes
// les écritures suivantes.
const verifyChainFull = (list) => {
  let prevHash = GENESIS_HASH;
  const broken = [];
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const expected = sha256Hex(prevHash + "|" + canonicalEntryContent(e));
    if (!e.hash) broken.push({ index: i, entry: e, reason: "non scellée" });
    else if (e.hash !== expected) broken.push({ index: i, entry: e, reason: "contenu modifié après scellement" });
    prevHash = e.hash || expected;
  }
  return { ok: broken.length === 0, count: list.length, brokenCount: broken.length, broken };
};

// Taux de change USD → HTG en temps réel (API gratuite, sans clé), avec repli sur
// un taux fixe si la requête échoue (hors ligne, service indisponible...). Utilisé
// pour afficher/facturer un montant en gourdes cohérent avec le marché du jour,
// sans avoir à mettre à jour le site manuellement à chaque variation du taux BRH.
// --- Règles de blocage universelles (tous forfaits, tous modules de saisie) ---
// Une date de transaction dans le futur, ou un montant à zéro, n'a aucun sens
// comptable et ne peut jamais être corrigé proprement par contrepassation (on
// contrepasse une erreur de catégorie ou de montant, pas une opération qui
// n'a techniquement pas encore eu lieu, ou qui ne représente aucune valeur
// réelle) — le blocage est donc réel et non contournable, pas une simple alerte.
function todayStr() {
  // Date LOCALE de l'appareil, pas UTC — toISOString() bascule au jour suivant dès
  // que l'heure locale dépasse le décalage UTC du fuseau (ex. 22h55 heure d'Haïti,
  // UTC-4, correspond déjà à 02h55 UTC le lendemain), ce qui bloquait à tort la
  // vraie date du jour sur les calendriers en soirée.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function isFutureDate(dateStr) {
  if (!dateStr) return false;
  return dateStr > todayStr();
}

const FALLBACK_HTG_PER_USD = 130.53; // taux de référence BRH du 07/08/2026, en dernier recours

// Progression des forfaits — "next" pour la mise à niveau, "prev" pour la
// rétrogradation. Le forfait Groupe s'ajoute à la capacité de l'entreprise
// (tableau de bord consolidé, jusqu'à 5 entreprises) sans remplacer son propre
// niveau Standard/Assisté.
const PLAN_TIER_INFO = {
  standard: { label: "Standard", priceUSD: 20, next: "assisted", prev: null },
  assisted: { label: "Assisté", priceUSD: 80, next: "group", prev: "standard" },
  group: { label: "Extension (jusqu'à 5 entreprises)", priceUSD: 350, next: null, prev: "assisted" },
};

