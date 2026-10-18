const monthLabel = (d) => {
  // Construit la date à partir des composants AAAA-MM-JJ directement en heure locale,
  // sans passer par l'interprétation UTC de `new Date(chaîne)` — celle-ci décale les
  // dates proches du début du mois (ex. le 1er août affiché comme "juillet") pour tout
  // fuseau horaire en retard sur UTC, ce qui est le cas d'Haïti (UTC-5/-4).
  const [y, m] = (d || "").split("-");
  if (!y || !m) return "";
  const dt = new Date(Number(y), Number(m) - 1, 1);
  return dt.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
};

// Regroupe une date AAAA-MM-JJ selon la granularité voulue — utilisé par le
// tableau de bord Super Admin (Rapports et analyse) pour permettre à l'utilisateur
// de choisir librement mois / trimestre / année comme unité de regroupement.
const periodLabel = (d, groupBy) => {
  const [y, m] = (d || "").split("-");
  if (!y || !m) return "";
  if (groupBy === "annee") return y;
  if (groupBy === "trimestre") return `${y}-T${Math.floor((Number(m) - 1) / 3) + 1}`;
  return monthLabel(d);
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

// Solde restant dû sur une facture, compte tenu des paiements partiels déjà enregistrés
const balanceDue = (inv) => Math.max(0, (inv?.total || 0) - (inv?.payments || []).reduce((s, p) => s + p.amount, 0));

// Construit une écriture équilibrée à 2 lignes (compte débité / compte crédité)
const simpleEntry = (date, label, debitAccount, creditAccount, amount) => ({
  id: uid(),
  date,
  createdAt: new Date().toISOString(),
  label,
  lines: [
    { account: debitAccount, debit: amount, credit: 0 },
    { account: creditAccount, debit: 0, credit: amount },
  ],
});

// Soldes de chaque compte (débit - crédit), à partir du plan comptable et du
// journal — fonction pure, réutilisée telle quelle pour une entreprise seule
// et pour agréger plusieurs entreprises d'un même groupe.
// Contrôle de rapprochement stock ↔ comptabilité (méthode « stock en actif » uniquement) :
// la valeur du stock en rayon (quantités × coût moyen) doit égaler le solde du compte 370.
// Renvoie null si la méthode n'est pas « actif » ; sinon { stockValue, bal370, gap, ok }.
function stockReconcile(products, accounts, entries, settings) {
  if (!settings || settings.stockValuationMethod !== "actif") return null;
  const r2 = (n) => Math.round(n * 100) / 100;
  const bal370 = r2(computeBalances(accounts || [], entries || [])["370"] || 0);
  const stockValue = r2((products || []).filter((p) => p.type === "marchandise").reduce((t, p) => t + (Number(p.stock) || 0) * (Number(p.costPrice) || 0), 0));
  const gap = r2(stockValue - bal370);
  const tol = Math.max(1, Math.abs(bal370) * 0.002);
  return { stockValue, bal370, gap, ok: Math.abs(gap) <= tol };
}
function computeBalances(accounts, entries) {
  const b = {};
  accounts.forEach((a) => (b[a.code] = 0));
  entries.forEach((e) => {
    (e.lines || []).forEach((l) => {
      b[l.account] = (b[l.account] || 0) + Number(l.debit || 0) - Number(l.credit || 0);
    });
  });
  return b;
}

function computeKpis(accounts, balances) {
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
}

// Les catégories sont enregistrées sous la forme {"v": <version>, "data": [...]}
// (gestion des conflits d'écriture) — extrait le tableau ou objet réel, quel
// que soit l'état de la donnée (déjà enveloppée, ou brute pour d'anciennes
// entrées antérieures à cette convention).
function unwrapVersioned(parsed) {
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "v" in parsed && "data" in parsed) {
    return { v: Number(parsed.v) || 0, data: parsed.data };
  }
  return { v: 0, data: parsed };
}

