// @module V332-GuichetsVendeur
// @depends VENDEUR_WRITABLE_CATEGORIES, _membership, hlKeys, hlPendDel, hlPendMark
// @exports —
// v332 — aligne la liste des catégories qu'un Vendeur tente d'enregistrer sur la règle serveur
// (policies "Insert/Update own company data" de kv_store, voir SQL 1-E) : produits, factures, mouvements,
// écritures + les 6 secteurs de guichet (école, santé, restaurant, hôtel, transport, services).
// Les autres secteurs (immobilier, BTP, ONG, agriculture, industrie) restent refusés par le serveur : le
// client n'essaie plus d'y écrire, donc plus de refus 403 pris à tort pour une coupure internet.
(function () {
  const ALLOWED = ["products", "invoices", "movements", "entries", "ecole", "sante", "resto", "hotel", "transport", "services"];
  const arr = VENDEUR_WRITABLE_CATEGORIES; // même tableau, modifié sur place : toutes les références le voient
  arr.length = 0;
  ALLOWED.forEach((c) => arr.push(c));
  const isBlocked = (cat) => { try { return !!_membership && _membership.role === "Vendeur" && !arr.includes(cat); } catch (e) { return false; } };
  // Plus de « modification en attente » pour une catégorie qu'un Vendeur n'a pas le droit d'écrire.
  const origMark = hlPendMark;
  hlPendMark = function (cid, cat) { if (isBlocked(cat)) return Promise.resolve(); return origMark.apply(this, arguments); };
  // Nettoyage, une seule fois par session, des anciennes marques « en attente » restées sur l'appareil (bandeau orange).
  let tries = 0;
  const timer = setInterval(async () => {
    tries++;
    try {
      const m = _membership;
      if (m && m.companyId && m.role) {
        clearInterval(timer);
        if (m.role !== "Vendeur") return;
        const pre = `pend:${m.companyId}:`;
        for (const k of await hlKeys(pre)) { const cat = k.slice(pre.length); if (!arr.includes(cat)) await hlPendDel(m.companyId, cat); }
      } else if (tries > 90) clearInterval(timer);
    } catch (e) { clearInterval(timer); }
  }, 1000);
})();
