// --- Page d'accueil publique — première chose vue par un visiteur non connecté,
// avant l'écran de connexion. Sert de vitrine du produit.
function LandingPage({ onStart }) {
  const [htgRate, setHtgRate] = useState(null);
  const [rateIsLive, setRateIsLive] = useState(false);
  useEffect(() => {
    fetchHtgPerUsd().then((rate) => {
      if (rate) { setHtgRate(rate); setRateIsLive(true); }
      else { setHtgRate(FALLBACK_HTG_PER_USD); setRateIsLive(false); }
    });
  }, []);
  const htgPrice = htgRate ? Math.round((20 * htgRate) / 10) * 10 : Math.round((20 * FALLBACK_HTG_PER_USD) / 10) * 10;
  const htgPriceAssisted = htgRate ? Math.round((80 * htgRate) / 10) * 10 : Math.round((80 * FALLBACK_HTG_PER_USD) / 10) * 10;
  const htgPriceGroup = htgRate ? Math.round((350 * htgRate) / 10) * 10 : Math.round((350 * FALLBACK_HTG_PER_USD) / 10) * 10;
  const features = [
    { icon: BookOpen, title: "Comptabilité en partie double", desc: "Journal, plan de comptes, bilan et compte de résultat générés automatiquement, avec journal scellé par chaînage cryptographique." },
    { icon: ShoppingCart, title: "Point de vente & facturation", desc: "Encaissez en boutique, générez des factures professionnelles imprimables ou en PDF, gérez remises et paiements partiels." },
    { icon: Boxes, title: "Stock & inventaire", desc: "Suivi en temps réel des quantités, alertes de réapprovisionnement, mouvements tracés." },
    { icon: Truck, title: "Achats & fournisseurs", desc: "Centralisez vos commandes fournisseurs et leur suivi de paiement." },
    { icon: Users, title: "Comptes clients (CRM)", desc: "Suivez les factures dues et payées, relancez vos clients en un coup d'œil." },
    { icon: BarChart3, title: "Rapports en continu", desc: "Bilan, résultat, balance et analyse des ventes toujours à jour, exportables en PDF." },
  ];
  return (
    <div style={{ background: "linear-gradient(160deg, #F4FBE8 0%, #DFF0BE 55%, #C7E296 100%)", fontFamily: "'Source Sans Pro', 'Inter', sans-serif", minHeight: "100vh", color: "#152238" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Spectral:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap'); .lp-display { font-family: 'Spectral', serif; }`}</style>

      <header className="flex items-center justify-between px-6 py-5 max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <img src="icons/icon-192.png" alt="Compta+" className="w-8 h-8 rounded-full" />
          <span className="lp-display text-xl">Compta+</span>
        </div>
        <button onClick={onStart} className="text-sm px-4 py-2 rounded" style={{ background: "#152238", color: "#EFE9DD" }}>
          Se connecter
        </button>
      </header>

      <section className="px-6 py-14 md:py-20 max-w-4xl mx-auto text-center">
        <div className="text-xs uppercase tracking-widest mb-3" style={{ color: "#C9A24B" }}>Pensé pour Haïti et le Mexique</div>
        <h1 className="lp-display text-3xl md:text-5xl leading-tight mb-5">
          La comptabilité et la vente de votre entreprise, réunies dans une seule application
        </h1>
        <p className="text-base md:text-lg mb-8" style={{ color: "#7A7460" }}>
          Point de vente, facturation, stock, comptabilité et gestion clients — sans logiciel compliqué, accessible depuis votre téléphone ou votre ordinateur.
        </p>
        <button onClick={onStart} className="px-6 py-3 rounded text-base" style={{ background: "#152238", color: "#EFE9DD" }}>
          Démarrer mon essai gratuit de 30 jours
        </button>
        <p className="text-xs mt-3" style={{ color: "#A39C87" }}>Aucune carte bancaire requise</p>
      </section>

      <section className="px-6 py-12 max-w-6xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {features.map((f, i) => (
            <div key={i} className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
              <f.icon size={22} style={{ color: "#C9A24B" }} className="mb-3" />
              <div className="text-sm font-medium mb-1.5">{f.title}</div>
              <p className="text-xs" style={{ color: "#8A8370" }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="px-6 py-14 max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <div className="lp-display text-2xl mb-2">Trois forfaits, selon vos besoins</div>
          <p className="text-sm" style={{ color: "#7A7460" }}>30 jours d'essai gratuit avant tout engagement, quel que soit le forfait choisi.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="bg-white rounded-lg p-7" style={{ border: "1px solid #E4DFD1" }}>
            <div className="text-center mb-5">
              <div className="lp-display text-xl mb-1" style={{ color: "#152238" }}>Standard</div>
              <p className="text-xs" style={{ color: "#8A8370" }}>Toutes les fonctionnalités de base</p>
            </div>
            <div className="space-y-4">
              <div className="text-center pb-4" style={{ borderBottom: "1px solid #F0EBDD" }}>
                <div className="text-xs uppercase tracking-widest mb-1" style={{ color: "#C9A24B" }}>Haïti</div>
                <div className="lp-display text-2xl mb-1">{htgPrice.toLocaleString("fr-FR")} HTG<span className="text-sm font-normal" style={{ color: "#A39C87" }}> / mois</span></div>
                <p className="text-xs" style={{ color: "#A39C87" }}>≈ 20 USD ({(htgRate || FALLBACK_HTG_PER_USD).toFixed(2)} HTG/USD) — MonCash, NatCash ou virement</p>
              </div>
              <div className="text-center">
                <div className="text-xs uppercase tracking-widest mb-1" style={{ color: "#C9A24B" }}>Mexique</div>
                <div className="lp-display text-2xl mb-1">400 MXN<span className="text-sm font-normal" style={{ color: "#A39C87" }}> / mois</span></div>
                <p className="text-xs" style={{ color: "#8A8370" }}>Paiement par carte (Stripe)</p>
              </div>
            </div>
            <button onClick={onStart} className="w-full mt-5 text-sm px-5 py-2 rounded" style={{ border: "1px solid #152238", color: "#152238" }}>Essayer gratuitement</button>
          </div>
          <div className="rounded-lg p-7" style={{ border: "1px solid #DDD0F5", background: "#FBFAFE" }}>
            <div className="text-center mb-5">
              <div className="lp-display text-xl mb-1" style={{ color: "#5B3FA0" }}>Assisté</div>
              <p className="text-xs" style={{ color: "#8A8370" }}>+ alertes, recommandations et corrections automatiques pour éviter les erreurs de saisie</p>
            </div>
            <div className="space-y-4">
              <div className="text-center pb-4" style={{ borderBottom: "1px solid #EEE6FA" }}>
                <div className="text-xs uppercase tracking-widest mb-1" style={{ color: "#8B6FD9" }}>Haïti</div>
                <div className="lp-display text-2xl mb-1">{htgPriceAssisted.toLocaleString("fr-FR")} HTG<span className="text-sm font-normal" style={{ color: "#A39C87" }}> / mois</span></div>
                <p className="text-xs" style={{ color: "#A39C87" }}>≈ 80 USD ({(htgRate || FALLBACK_HTG_PER_USD).toFixed(2)} HTG/USD) — MonCash, NatCash ou virement</p>
              </div>
              <div className="text-center">
                <div className="text-xs uppercase tracking-widest mb-1" style={{ color: "#8B6FD9" }}>Mexique</div>
                <div className="lp-display text-2xl mb-1">1 600 MXN<span className="text-sm font-normal" style={{ color: "#A39C87" }}> / mois</span></div>
                <p className="text-xs" style={{ color: "#8A8370" }}>Paiement par carte (Stripe)</p>
              </div>
            </div>
            <button onClick={onStart} className="w-full mt-5 text-sm px-5 py-2 rounded text-white" style={{ background: "#5B3FA0" }}>Essayer gratuitement</button>
          </div>
          <div className="rounded-lg p-7" style={{ border: "1px solid #BFE0D6", background: "#FAFEFC" }}>
            <div className="text-center mb-5">
              <div className="lp-display text-xl mb-1" style={{ color: "#0F6B5C" }}>Extension</div>
              <p className="text-xs" style={{ color: "#8A8370" }}>Gérez jusqu'à 5 entreprises dans un même espace, avec tableau de bord consolidé — inclut toutes les fonctionnalités Assisté</p>
            </div>
            <div className="space-y-4">
              <div className="text-center pb-4" style={{ borderBottom: "1px solid #E3F2EC" }}>
                <div className="text-xs uppercase tracking-widest mb-1" style={{ color: "#4FAE93" }}>Haïti</div>
                <div className="lp-display text-2xl mb-1">{htgPriceGroup.toLocaleString("fr-FR")} HTG<span className="text-sm font-normal" style={{ color: "#A39C87" }}> / mois</span></div>
                <p className="text-xs" style={{ color: "#A39C87" }}>≈ 350 USD ({(htgRate || FALLBACK_HTG_PER_USD).toFixed(2)} HTG/USD) — MonCash, NatCash ou virement</p>
              </div>
              <div className="text-center">
                <div className="text-xs uppercase tracking-widest mb-1" style={{ color: "#4FAE93" }}>Mexique</div>
                <div className="lp-display text-2xl mb-1">7 000 MXN<span className="text-sm font-normal" style={{ color: "#A39C87" }}> / mois</span></div>
                <p className="text-xs" style={{ color: "#8A8370" }}>Paiement par carte (Stripe)</p>
              </div>
            </div>
            <button onClick={onStart} className="w-full mt-5 text-sm px-5 py-2 rounded text-white" style={{ background: "#0F6B5C" }}>Essayer gratuitement</button>
          </div>
        </div>
      </section>

      <section className="px-6 py-14 max-w-5xl mx-auto">
        <div className="text-center mb-8">
          <div className="lp-display text-2xl mb-2">Ce que nos utilisateurs en disent</div>
        </div>
        <div className="bg-white rounded-lg p-8 text-center max-w-lg mx-auto" style={{ border: "1px dashed #DDD6C4" }}>
          <p className="text-sm" style={{ color: "#A39C87" }}>
            Les témoignages de nos premiers clients apparaîtront ici prochainement.
          </p>
        </div>
      </section>

      <section className="px-6 py-14 max-w-2xl mx-auto text-center">
        <div className="lp-display text-2xl mb-3">Prêt à essayer ?</div>
        <p className="text-sm mb-6" style={{ color: "#7A7460" }}>
          30 jours d'essai gratuit, sans engagement. Créez votre entreprise en moins d'une minute.
        </p>
        <button onClick={onStart} className="px-6 py-3 rounded text-base" style={{ background: "#152238", color: "#EFE9DD" }}>
          Commencer maintenant
        </button>
      </section>

      <footer className="px-6 py-8 text-center text-xs" style={{ color: "#A39C87", borderTop: "1px solid #E4DFD1" }}>
        © {new Date().getFullYear()} Compta+ · <a href="cgu.html" style={{ color: "#A39C87", textDecoration: "underline" }}>Conditions d'utilisation</a> · <a href="confidentialite.html" style={{ color: "#A39C87", textDecoration: "underline" }}>Confidentialité</a> · <a href="securite.html" style={{ color: "#A39C87", textDecoration: "underline" }}>Sécurité</a> · <a href="support.html" style={{ color: "#A39C87", textDecoration: "underline" }}>Support</a>
      </footer>
    </div>
  );
}

