// ═══ MODULE ═══
// @module Constantes metier
// @depends BadgeDollar, BarChart3, BookOpen, Boxes, ClipboardIcon, Settings, ShoppingCart, Truck, Users
//   Wallet
// @exports ACCOUNTING_ONLY_HIDDEN_GESTION_TABS, ASSET_CATEGORIES, CURRENCIES, CURRENT_CURRENCY
//   DEFAULT_ACCOUNTS, DEFAULT_CLIENTS, DEFAULT_PRODUCTS, DEFAULT_SETTINGS, DEFAULT_SUPPLIERS
//   DEFAULT_USERS, MODULES, ROLE_MODULE_ACCESS, TAX_SYSTEMS, VENDEUR_WRITABLE_CATEGORIES
//   __uidCounter, allowedModulesFor, isLocked, roleLabel
// ═══ FIN DE L'EN-TÊTE ═══
const MODULES = [
  { id: "compta", n: 1, label: "Comptabilité", icon: BookOpen, ready: true },
  { id: "caisse", n: 2, label: "Caisse et banque", icon: Wallet, ready: true },
  { id: "vente", n: 3, label: "Vente (POS / Facturation)", icon: ShoppingCart, ready: true },
  { id: "achat", n: 4, label: "Achat et fournisseurs", icon: Truck, ready: true },
  { id: "stock", n: 5, label: "Stock et inventaire", icon: Boxes, ready: true },
  { id: "crm", n: 6, label: "Comptes clients (CRM)", icon: Users, ready: true },
  { id: "rapports", n: 7, label: "Rapports et analyse", icon: BarChart3, ready: true },
  { id: "admin", n: 8, label: "Administration", icon: Settings, ready: true },
  { id: "rh", n: 9, label: "Salaires (RH)", icon: BadgeDollar, ready: true },
  { id: "gestion", n: 10, label: "Gestion avancée", icon: ClipboardIcon, ready: true },
  { id: "ecole", n: 11, label: "Écoles", icon: BookOpen, ready: true }, // bloc par secteur : visible seulement si le secteur « Écoles » est actif
];

// Modules accessibles par rôle. "null" = accès à tous les modules (comportement
// historique pour Administrateur/Éditeur/Lecture seule). Le rôle "Vendeur" est
// cantonné au point de vente : il peut encaisser des clients sans jamais voir ni
// modifier la comptabilité, les rapports ou l'administration de l'entreprise.
// Libellés affichés des rôles. Les valeurs stockées (base de données, règles serveur) restent
// « Éditeur » et « Lecture seule » : seuls les mots vus à l'écran changent.
const ROLE_LABELS = { "Éditeur": "Gestionnaire", "Lecture seule": "Consultant" };
const roleLabel = (r) => ROLE_LABELS[r] || r;
const ROLE_MODULE_ACCESS = {
  Vendeur: ["vente", "crm", "stock"],
};

// Espace « comptabilité seule » (cabinet, comptable agréé) : réglage d'entreprise
// (settings.accountingOnly). Il ne masque que l'affichage des modules commerciaux ;
// les droits de chaque rôle restent appliqués par la base comme avant.
// A:ACCONLY:START
const ACCOUNTING_ONLY_MODULES = ["compta", "caisse", "rapports", "admin", "gestion"];
const ACCOUNTING_ONLY_HIDDEN_GESTION_TABS = ["docs", "inventaire", "recurrent"];
function allowedModulesFor(role, settings) {
  if (ROLE_MODULE_ACCESS[role]) return ROLE_MODULE_ACCESS[role];
  if (settings && settings.accountingOnly === true) return ACCOUNTING_ONLY_MODULES;
  return null;
}
// A:ACCONLY:END

// Miroir exact, côté client, de la policy RLS "Insert/Update own company data" sur
// kv_store : le rôle Vendeur n'est autorisé à écrire QUE ces 4 catégories côté
// serveur — tout le reste (settings, employees, users, salesStations...) est
// refusé par design, pas par panne. Sans ce miroir, l'app tenterait quand même
// d'écrire ces catégories pour un Vendeur, échouerait à chaque fois (normal), et
// afficherait indéfiniment la bannière d'erreur de synchronisation pour une
// restriction de sécurité parfaitement normale.
const VENDEUR_WRITABLE_CATEGORIES = ["products", "invoices", "movements", "entries"];

const DEFAULT_ACCOUNTS = [
  { code: "101", name: "Capital", type: "Capitaux propres" },
  { code: "110", name: "Report à nouveau", type: "Capitaux propres" },
  { code: "106", name: "Réserves", type: "Capitaux propres" },
  { code: "457", name: "Associés — Dividendes à payer", type: "Passif" },
  { code: "108", name: "Report d'ouverture (solde initial)", type: "Capitaux propres" },
  { code: "411", name: "Clients", type: "Actif" },
  { code: "401", name: "Fournisseurs", type: "Passif" },
  { code: "445", name: "Taxe collectée sur ventes (IVA/TCA)", type: "Passif" },
  { code: "4456", name: "Taxe déductible sur achats (TCA)", type: "Actif" },
  { code: "512", name: "Banque", type: "Actif" },
  { code: "530", name: "Caisse", type: "Actif" },
  { code: "5112", name: "Chèques à encaisser", type: "Actif" },
  { code: "370", name: "Stock de marchandises", type: "Actif" },
  { code: "39", name: "Dépréciation des stocks", type: "Actif" },
  { code: "6037", name: "Coût des marchandises vendues", type: "Charge" },
  { code: "6817", name: "Dotations aux dépréciations des stocks", type: "Charge" },
  { code: "7817", name: "Reprises sur dépréciations des stocks", type: "Produit" },
  { code: "491", name: "Provisions pour créances douteuses", type: "Actif" },
  { code: "6816", name: "Dotations aux provisions pour créances douteuses", type: "Charge" },
  { code: "7816", name: "Reprises sur provisions pour créances douteuses", type: "Produit" },
  { code: "654", name: "Pertes sur créances irrécouvrables", type: "Charge" },
  { code: "2154", name: "Matériel industriel", type: "Actif" },
  { code: "28154", name: "Amortissements — Matériel industriel", type: "Actif" },
  { code: "2182", name: "Matériel de transport", type: "Actif" },
  { code: "28182", name: "Amortissements — Matériel de transport", type: "Actif" },
  { code: "2183", name: "Matériel de bureau et informatique", type: "Actif" },
  { code: "28183", name: "Amortissements — Matériel de bureau et informatique", type: "Actif" },
  { code: "2184", name: "Mobilier", type: "Actif" },
  { code: "28184", name: "Amortissements — Mobilier", type: "Actif" },
  { code: "6811", name: "Dotations aux amortissements des immobilisations", type: "Charge" },
  { code: "404", name: "Fournisseurs d'immobilisations", type: "Passif" },
  { code: "4081", name: "Fournisseurs — Factures non parvenues", type: "Passif" },
  { code: "4181", name: "Clients — Factures à établir", type: "Actif" },
  { code: "486", name: "Charges constatées d'avance", type: "Actif" },
  { code: "487", name: "Produits constatés d'avance", type: "Passif" },
  { code: "151", name: "Provisions pour risques", type: "Passif" },
  { code: "6815", name: "Dotations aux provisions pour risques", type: "Charge" },
  { code: "7815", name: "Reprises sur provisions pour risques", type: "Produit" },
  { code: "606", name: "Achats non stockés", type: "Charge" },
  { code: "607", name: "Achats de marchandises", type: "Charge" },
  { code: "608", name: "Frais accessoires d'achat (transport, manutention)", type: "Charge" },
  { code: "613", name: "Loyers et charges locatives", type: "Charge" },
  { code: "615", name: "Entretien et réparations", type: "Charge" },
  { code: "616", name: "Assurances", type: "Charge" },
  { code: "622", name: "Honoraires et prestations externes", type: "Charge" },
  { code: "623", name: "Publicité et marketing", type: "Charge" },
  { code: "626", name: "Télécommunications et internet", type: "Charge" },
  { code: "627", name: "Frais bancaires", type: "Charge" },
  { code: "635", name: "Impôts et taxes", type: "Charge" },
  { code: "641", name: "Charges de personnel", type: "Charge" },
  { code: "645", name: "Charges sociales", type: "Charge" },
  { code: "658", name: "Pertes sur stocks (péremption, casse)", type: "Charge" },
  { code: "6238", name: "Dons, libéralités", type: "Charge" },
  { code: "706", name: "Prestations de services", type: "Produit" },
  { code: "707", name: "Ventes de marchandises", type: "Produit" },
  { code: "708", name: "Produits accessoires", type: "Produit" },
];

// Catégories d'immobilisations proposées à la création — chacune porte son propre
// compte d'actif et son compte d'amortissements cumulés correspondant, pour rester
// simple (pas de sélection manuelle de compte à faire).
const ASSET_CATEGORIES = [
  { label: "Matériel industriel", assetAccount: "2154", depreciationAccount: "28154" },
  { label: "Matériel de transport", assetAccount: "2182", depreciationAccount: "28182" },
  { label: "Matériel de bureau et informatique", assetAccount: "2183", depreciationAccount: "28183" },
  { label: "Mobilier", assetAccount: "2184", depreciationAccount: "28184" },
];

const TAX_SYSTEMS = {
  iva: { label: "IVA", defaultRate: 16, description: "Impuesto al Valor Agregado (Mexique) — déductible sur les achats" },
  tca: { label: "TCA", defaultRate: 10, description: "Taxe sur le Chiffre d'Affaires (Haïti) — taxe sur ventes/services, supportée par le consommateur final ; la taxe payée aux fournisseurs est déductible (art. 187)" },
  aucune: { label: "Aucune taxe", defaultRate: 0, description: "Aucune taxe appliquée aux ventes" },
};

// Le taux des articles de démonstration suit TOUJOURS le régime fiscal par
// défaut d'une nouvelle entreprise (TAX_SYSTEMS.tca), au lieu d'un nombre codé
// séparément — évite qu'un futur changement du régime par défaut désynchronise
// silencieusement ces 3 articles, comme observé quand le régime par défaut était
// passé de 20% (ancienne TVA) à 10% (TCA) sans que ces articles suivent.
const DEFAULT_PRODUCTS = [
  { id: 1, code: "P001", name: "Prestation de conseil (h)", price: 60, tva: TAX_SYSTEMS.tca.defaultRate, type: "service", account: "706" },
  { id: 2, code: "P002", name: "Pack démarrage", price: 250, tva: TAX_SYSTEMS.tca.defaultRate, type: "service", account: "706" },
  { id: 3, code: "M001", name: "Article standard", price: 25, tva: TAX_SYSTEMS.tca.defaultRate, type: "marchandise", account: "707", stock: 40, seuil: 10 },
];

const DEFAULT_SUPPLIERS = [
  { id: 1, name: "Fournisseur Général SARL", contact: "" },
];

const DEFAULT_CLIENTS = [];

const DEFAULT_SETTINGS = {
  companyName: "Mon Entreprise",
  companyAddress: "",
  companyPhone: "",
  companyEmail: "",
  tcaFranchise: false, // Entreprise en franchise de TCA (CA < 10 M HTG) : pas de TCA facturée, mention légale sur la facture
  companyNIF: "", // Numéro d'Identification Fiscale — requis pour la déclaration TCA
  companyVille: "",
  companySecteurCode: "",
  companySecteurNom: "",
  companyType: "", // ex. "Salon de coiffure", "Lave-auto", "Dépôt de gros" — utile notamment pour distinguer les entreprises d'un groupe multi-entreprises
  currency: "HTG",
  fiscalYearStart: "01-01",
  emailReminders: true, // Rappels par email aux administrateurs (fin d'abonnement, factures en retard)
  requireAdminMfa: false, // Double authentification obligatoire pour les administrateurs de cette entreprise
  taxSystem: "tca", // "iva" | "tca" | "aucune"
  taxRate: TAX_SYSTEMS.tca.defaultRate,
  taxAccount: "445",
  taxDeductibleOnPurchases: true,
  lockDate: "", // Clôture d'exercice/période : aucune écriture datée ≤ cette date ne peut être créée, modifiée ou annulée
  nextInvoiceNumber: 1, // Compteur strictement croissant : garantit une numérotation de factures sans trous ni doublons
  subscriptionPriceHTG: 2600, // Repli si le taux de change en temps réel est indisponible
  subscriptionPriceUSD: 20, // Prix de référence en USD — le montant HTG facturé est recalculé au taux du jour
  assistedPlanPriceUSD: 80, // Prix de référence du forfait Assisté (mode Superviseur assisté + alertes/suggestions) — activé manuellement par Super Admin en attendant l'intégration MonCash dédiée
  autoBackupEnabled: false, // Sauvegarde JSON hebdomadaire automatique — contrôlée uniquement par l'Administrateur principal
  lastAutoBackupAt: null, // Horodatage de la dernière sauvegarde automatique déclenchée, partagé entre tous les appareils de l'entreprise
  receiptFormat: "a4", // "a4" | "ticket80" | "ticket58" — format d'impression des factures, selon le matériel utilisé
  // "charge" (par défaut, comportement historique) : le stock est comptabilisé en
  // charge dès l'achat, comme la plupart des petites entreprises sans comptable
  // dédié — simple, mais ne respecte pas les normes comptables formelles (IFRS/PCG/
  // SYSCOHADA) dès qu'un stock est conservé d'une période à l'autre.
  // "actif" : le stock est un actif circulant (compte 370), sorti au coût moyen
  // pondéré vers 6037 (Coût des marchandises vendues) à chaque vente — la méthode
  // conforme, choisie explicitement par l'entreprise dans Administration.
  stockValuationMethod: "charge", // "charge" | "actif"
  // Date du dernier exercice clôturé (null si aucun exercice n'a jamais été
  // clôturé) — sert de point de départ pour calculer le résultat de la période
  // suivante lors d'une nouvelle clôture annuelle, sans recompter depuis toujours.
  lastClosingDate: null,
  invoiceFooterNote: "", // Note personnalisée affichée en bas de chaque facture (conditions, mentions légales, remerciement...)
};

// Une date est verrouillée (période clôturée) si elle est antérieure ou égale à la date de clôture définie.
const isLocked = (date, settings) => !!(settings && settings.lockDate && date && date <= settings.lockDate);
const DEFAULT_USERS = [{ id: 1, name: "Administrateur", email: "", role: "Administrateur" }];

const CURRENCIES = {
  EUR: { label: "Euro (EUR)", locale: "fr-FR" },
  USD: { label: "Dollar américain (USD)", locale: "en-US" },
  HTG: { label: "Gourde haïtienne (HTG)", locale: "fr-HT" },
  MXN: { label: "Peso mexicain (MXN)", locale: "es-MX" },
};

// Devise active pour le formatage — mise à jour en direct par App() selon les paramètres.
// (variable de module plutôt que prop, car fmt() est appelée dans des dizaines d'endroits)
let CURRENT_CURRENCY = "HTG";

// Génère un identifiant numérique garanti unique, même si plusieurs éléments sont créés
// à la même milliseconde (saisie très rapide, copier-coller en série...). Date.now() seul
// pouvait produire deux identifiants identiques dans ce cas, ce qui faisait qu'un nouvel
// élément écrasait silencieusement le précédent au lieu de s'ajouter (le nombre total
// semblait alors plafonner sans raison apparente).
let __uidCounter = 0;
