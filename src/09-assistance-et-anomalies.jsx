// --- Rappel du principe comptable (forfait Assisté uniquement) ---
// Affiché systématiquement à chaque saisie (pas seulement la première fois),
// sur les modules impliquant un principe comptable — jugé fondamental par
// l'éditeur pour que l'assistance automatisée soit perçue comme réelle, pas
// cosmétique. Purement informatif : n'importe/ne valide/ne bloque jamais rien
// par lui-même (voir isFutureDate/montant zéro pour les vrais blocages).
function AssistedPrincipleReminder({ planTier, text }) {
  if (planTier !== "assisted") return null;
  return (
    <div className="text-xs px-3 py-2 rounded mb-3 flex items-start gap-2" style={{ background: "#F3EEFB", color: "#5B3FA0", border: "1px solid #DDD0F5" }}>
      <span>💡</span>
      <span>{text}</span>
    </div>
  );
}

// --- Bandeau de recommandation en attente (mode Assisté) ---
// Réapparaît toutes les 45s tant que la recommandation n'a pas été explicitement
// prise en compte, et à chaque fois que l'utilisateur revient sur ce module
// (visible dès le montage du composant). L'app ne force jamais la correction
// technique elle-même — elle indique juste clairement ce qu'il faudrait faire.
function PendingRecommendationsBanner({ recommendations, module, onDismiss, onApplyCorrection }) {
  const [visible, setVisible] = useState(true);
  const relevant = (recommendations || []).filter((r) => r.module === module);
  useEffect(() => {
    setVisible(true);
    if (relevant.length === 0) return;
    const interval = setInterval(() => setVisible(true), 45000);
    return () => clearInterval(interval);
  }, [relevant.length, module]);
  if (relevant.length === 0 || !visible) return null;
  return (
    <div className="rounded mb-4 overflow-hidden" style={{ border: "1px solid #E8B34A" }}>
      {relevant.map((r) => (
        <div key={r.id} className="px-3 py-3" style={{ background: "#FDF6E3" }}>
          <div className="text-xs font-medium mb-1 flex items-center gap-1" style={{ color: "#8A6D1E" }}>
            <span>⚠️</span> Recommandation en attente{r.entry_ref ? ` — ${r.entry_ref}` : ""}
          </div>
          <div className="text-xs mb-2" style={{ color: "#6B5A28" }}>{r.anomaly_text}</div>
          <div className="text-xs mb-2 p-2 rounded" style={{ background: "#fff", color: "#152238", border: "1px solid #EAD9A0" }}>
            <b>Correction suggérée :</b> {r.correction_text}
          </div>
          <div className="flex flex-wrap gap-2">
            {r.correction_kind === "reversed" && r.correction_payload && (
              <button onClick={() => onApplyCorrection?.(r)} className="text-xs px-3 py-1.5 rounded text-white" style={{ background: "#0F6B5C" }}>
                ✓ Appliquer l'écriture corrigée automatiquement
              </button>
            )}
            <button onClick={() => {
              // La levée ne se fait jamais en un clic : un récapitulatif de la
              // transaction concernée doit être relu et confirmé explicitement,
              // pour qu'accuser réception ne devienne pas un réflexe automatique
              // qui laisse filer l'anomalie sans vérification réelle.
              const confirmed = window.confirm(
                `Avant de continuer, vérifiez les montants exacts de cette transaction :\n\n` +
                `${r.entry_ref ? `Concerné : ${r.entry_ref}\n` : ""}${r.anomaly_text}\n\n` +
                `Confirmez-vous avoir vérifié et pris en compte cette recommandation ?`
              );
              if (!confirmed) return;
              onDismiss(r.id);
              setVisible(false);
            }} className="text-xs px-3 py-1.5 rounded" style={{ background: "#152238", color: "#fff" }}>
              J'ai pris connaissance
            </button>
          </div>
        </div>
      ))}
      <div className="px-3 py-2 text-xs" style={{ background: "#FBEFD4", color: "#8A6D1E" }}>
        Les nouvelles saisies sont bloquées dans ce module tant que cette recommandation n'est pas traitée.
      </div>
    </div>
  );
}

// --- Alertes intelligentes (forfait Assisté uniquement) ---
// Contrairement aux blocages universels (montant zéro, date future), ces
// anomalies ne sont jamais des erreurs certaines — juste des signaux
// statistiques qui MÉRITENT d'être relus. Mécanisme "3 tentatives" décidé par
// l'éditeur : la 1ère et la 2ème tentative sur la MÊME anomalie (même
// signature — donc si l'utilisateur change une valeur, ça repart à zéro)
// bloquent réellement l'enregistrement ; la 2ème ajoute une orientation
// explicite vers un comptable qualifié ; à la 3ème tentative identique,
// l'utilisateur est réputé avoir fait un choix informé et l'opération passe.
// Pile partagée des niveaux de navigation actifs (module principal, sous-onglet...).
// Un seul écouteur global sur popstate — peu importe combien de niveaux utilisent
// useBackNav en même temps — pour qu'un seul appui sur retour ne fasse remonter
// qu'UN SEUL niveau à la fois (le plus profond), jamais plusieurs simultanément.
const _backNavStack = [];
if (typeof window !== "undefined" && !window.__backNavListenerInstalled) {
  window.__backNavListenerInstalled = true;
  window.addEventListener("popstate", () => {
    const entry = _backNavStack.pop();
    if (entry) entry.reset();
  });
}

// Intercepte le bouton retour physique (Android) ou le geste retour du navigateur
// pour naviguer DANS l'application plutôt que d'en sortir. Principe : dès qu'on
// s'écarte de la valeur par défaut, on enregistre discrètement une étape dans
// l'historique du navigateur (sans changer l'adresse affichée) ET on empile un
// gestionnaire sur la pile partagée ci-dessus ; le bouton retour consomme cette
// étape (un seul popstate), qui ne réveille que le sommet de la pile — jamais
// tous les niveaux à la fois. Un module (onglet principal) et un sous-onglet à
// l'intérieur de ce module appellent chacun leur propre instance, créant
// naturellement une pile de retour à deux niveaux qui se dépile un cran à la fois.
function useBackNav(current, setCurrent, defaultValue) {
  const entryRef = React.useRef(null);
  const prevRef = React.useRef(current);

  React.useEffect(() => {
    const wasDefault = prevRef.current === defaultValue;
    const isDefault = current === defaultValue;
    if (!wasDefault && isDefault) {
      // Revenu à la valeur par défaut — que ce soit via le bouton retour (déjà
      // retiré de la pile par l'écouteur global) ou par un clic direct (encore
      // dans la pile, à retirer nous-mêmes) : dans les deux cas, notre entrée ne
      // doit plus traîner dans la pile.
      if (entryRef.current) {
        const idx = _backNavStack.indexOf(entryRef.current);
        if (idx !== -1) _backNavStack.splice(idx, 1);
        entryRef.current = null;
      }
    } else if (wasDefault && !isDefault) {
      const entry = { reset: () => setCurrent(defaultValue) };
      _backNavStack.push(entry);
      entryRef.current = entry;
      window.history.pushState({ backNavLevel: true }, "");
    }
    prevRef.current = current;
  }, [current, defaultValue]);

  React.useEffect(() => () => {
    // Nettoyage si le composant démonte pendant qu'il est encore sur un niveau
    // non-défaut (ex. changement de rôle qui démonte le module) — sans ça, une
    // entrée fantôme resterait dans la pile partagée indéfiniment.
    if (entryRef.current) {
      const idx = _backNavStack.indexOf(entryRef.current);
      if (idx !== -1) _backNavStack.splice(idx, 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function useAssistedAnomalyGate() {
  const attemptsRef = React.useRef({});
  return (signature, anomalies, proceed, showToast, onBypassed) => {
    if (!anomalies || anomalies.length === 0) {
      proceed();
      return;
    }
    const count = (attemptsRef.current[signature] || 0) + 1;
    attemptsRef.current[signature] = count;
    const list = anomalies.join(" ");
    if (count === 1) {
      showToast(`⚠️ ${list}`);
      return;
    }
    if (count === 2) {
      showToast(`⚠️ ${list} Nous vous recommandons de consulter un comptable qualifié avant de continuer.`);
      return;
    }
    if (onBypassed) onBypassed(anomalies); // 3e tentative identique : enregistre la recommandation en attente
    proceed(); // l'utilisateur assume son choix
  };
}

function detectAmountAnomaly(amount, historicalAmounts, label) {
  if (!historicalAmounts || historicalAmounts.length < 3) return null;
  const avg = historicalAmounts.reduce((a, b) => a + b, 0) / historicalAmounts.length;
  if (avg > 0 && amount > avg * 5) {
    return `Montant inhabituel pour ${label} : ${fmt(amount)} contre une moyenne récente de ${fmt(Math.round(avg))}.`;
  }
  return null;
}
function detectRareAccountAnomaly(accountCode, usageCounts, accountLabel) {
  const count = usageCounts?.[accountCode] || 0;
  if (count <= 1) {
    return `Le compte ${accountLabel || accountCode} a très peu servi dans cette entreprise (${count} fois) — vérifiez que c'est le bon compte.`;
  }
  return null;
}
function detectReversedAnomaly(lines, accounts) {
  for (const l of lines) {
    const acc = accounts.find((a) => a.code === l.account);
    if (!acc) continue;
    if (acc.code.startsWith("6") && Number(l.credit) > 0) {
      return `Le compte de charge ${acc.code} (${acc.name}) est crédité — une charge se débite normalement.`;
    }
    if (acc.code.startsWith("7") && Number(l.debit) > 0) {
      return `Le compte de produit ${acc.code} (${acc.name}) est débité — un produit se crédite normalement.`;
    }
  }
  return null;
}
function buildReversedCorrection(lines, accounts) {
  for (const l of lines) {
    const acc = accounts.find((a) => a.code === l.account);
    if (!acc) continue;
    const other = lines.find((x) => x.account !== l.account);
    const otherAcc = other ? accounts.find((a) => a.code === other.account) : null;
    if (acc.code.startsWith("6") && Number(l.credit) > 0) {
      return `Débit ${acc.code} (${acc.name}) ${fmt(l.credit)} / Crédit ${otherAcc?.code || other?.account || "?"} (${otherAcc?.name || ""}) ${fmt(l.credit)} — inversez les colonnes Débit/Crédit de cette ligne.`;
    }
    if (acc.code.startsWith("7") && Number(l.debit) > 0) {
      return `Crédit ${acc.code} (${acc.name}) ${fmt(l.debit)} / Débit ${otherAcc?.code || other?.account || "?"} (${otherAcc?.name || ""}) ${fmt(l.debit)} — inversez les colonnes Débit/Crédit de cette ligne.`;
    }
  }
  return null;
}
function buildReversedCorrectedLines(lines) {
  // Renvoie les lignes avec débit/crédit inversés pour la ligne fautive —
  // prêtes à être insérées telles quelles comme écriture corrigée.
  return lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit }));
}
function detectTaxAnomaly(taxActive, totalTax, subtotal, someProductsHaveTax) {
  if (taxActive && subtotal > 0 && totalTax === 0 && someProductsHaveTax) {
    return "Cette vente n'applique aucune taxe alors que d'autres produits de cette entreprise ont un taux de TCA défini — vérifiez la fiche des produits vendus.";
  }
  return null;
}
function isSimilarLabel(a, b) {
  if (!a || !b) return false;
  const na = a.trim().toLowerCase();
  const nb = b.trim().toLowerCase();
  return na === nb || na.includes(nb) || nb.includes(na);
}

// --- Suggestions guidées (forfait Assisté uniquement) ---
// Purement indicatif : propose un compte ou un nom de tiers déjà utilisé pour
// un libellé similaire, sans jamais rien appliquer automatiquement — l'utilisateur
// garde toujours la main pour accepter ou ignorer la suggestion.
function normalizeWords(str) {
  return (str || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/\s+/).filter((w) => w.length >= 3);
}
// Nettoie purement l'affichage du libellé montré dans une suggestion — les
// écritures d'achat/vente stockent un libellé technique complet ("Achat — X
// (Fournisseur)") ; on ne montre que la partie utile à l'utilisateur, sans
// jamais modifier la donnée réelle.
function cleanSuggestionLabel(str) {
  if (!str) return str;
  return str.replace(/^(Achat|Vente)\s*—\s*/, "").replace(/\s*\([^)]*\)\s*$/, "").trim();
}
function suggestAccountFromHistory(label, historyEntries) {
  const words = normalizeWords(label);
  if (words.length === 0 || !historyEntries || historyEntries.length === 0) return null;
  // Score chaque entrée historique par nombre de mots significatifs partagés,
  // puis regroupe par compte pour ne jamais cacher qu'un même libellé a pu être
  // affecté à des comptes différents (ex. selon le fournisseur) — l'utilisateur
  // doit voir toutes les options plausibles, pas une seule choisie en silence.
  const scored = [];
  for (const h of historyEntries) {
    if (!h.label || !h.account) continue;
    const hWords = normalizeWords(h.label);
    const score = words.filter((w) => hWords.includes(w)).length;
    if (score > 0) scored.push({ ...h, score });
  }
  if (scored.length === 0) return null;
  const maxScore = Math.max(...scored.map((s) => s.score));
  const topMatches = scored.filter((s) => s.score === maxScore);
  const byAccount = new Map();
  for (const m of topMatches) {
    const existing = byAccount.get(m.account);
    if (!existing || (m.date || "") > (existing.date || "")) byAccount.set(m.account, m);
  }
  const options = [...byAccount.values()].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return { options, ambiguous: options.length > 1 };
}
function suggestSimilarTiers(name, existingNames) {
  const n = (name || "").trim().toLowerCase();
  if (n.length < 3 || !existingNames || existingNames.length === 0) return null;
  const match = existingNames.find((existing) => {
    const e = (existing || "").trim().toLowerCase();
    if (!e || e === n) return false; // exactement identique : rien à suggérer
    return e === n.replace(/\s+/g, " ") || e.replace(/\s+/g, "") === n.replace(/\s+/g, "") || (e.length > 2 && (e.includes(n) || n.includes(e)));
  });
  return match || null;
}
function detectDuplicateAnomaly(newItem, recentItems) {
  const dup = (recentItems || []).find((it) => {
    if (Number(it.amount) !== Number(newItem.amount)) return false;
    const d1 = new Date(it.date).getTime();
    const d2 = new Date(newItem.date).getTime();
    if (!Number.isFinite(d1) || !Number.isFinite(d2)) return false;
    const daysApart = Math.abs(d1 - d2) / 86400000;
    if (daysApart > 1) return false;
    return isSimilarLabel(it.label, newItem.label);
  });
  if (dup) return "Une opération très proche (même montant, date proche, libellé similaire) existe déjà — vérifiez qu'il ne s'agit pas d'un doublon.";
  return null;
}
async function fetchHtgPerUsd() {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    const data = await res.json();
    const rate = data?.rates?.HTG;
    if (typeof rate === "number" && rate > 0) return rate;
  } catch (e) { /* pas de réseau ou service indisponible : on utilisera le repli */ }
  return null;
}

