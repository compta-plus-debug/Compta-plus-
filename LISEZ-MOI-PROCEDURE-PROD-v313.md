# Compta+ — version 313 — paquet PRODUCTION
**Cumulatif depuis la v304 (active sur PROD, confirmé) : bloc Services et prestations · mention « ne remplace pas un expert-comptable » · bloc ONG · bloc Agriculture · Calendrier fiscal · cartes sans débordement · durcissement de sécurité.**

À faire sur le dépôt **Compta-plus-** (production) uniquement. Ce paquet est **cumulatif depuis la v304** : il remplace les paquets PROD v309, v310, v311 et v312 ; **si vous en avez déjà déposé un, déposez celui-ci par-dessus sans problème**. **Aucun script SQL, aucune Edge Function.** Vos données ne changent pas. **Rien à supprimer.**

## 0. Nouveautés de la v313 (votre message du 1er novembre)
### 0.1 Nouveau bloc : Services et prestations
Pour les métiers de service qui n'avaient pas de bloc : **agence de sécurité privée et gardiennage, club, discothèque, bar, événementiel, salon de coiffure et de beauté, nettoyage et entretien, conseil, formation, agence, cabinet, réparation et maintenance, autres services.**
**Activation** : Administration → Secteurs → cochez **Services et prestations** (grille de prix C, **inchangée**). Suivre `CAS-PRATIQUE-SERVICES-pas-a-pas.md`.
- **Activité** : à choisir au départ ; les mots et les natures de dépenses s'adaptent (sécurité : « Agent ou équipe », uniformes, agents partenaires ; club : DJ, artistes, sono ; coiffure : produits de soins ; conseil : consultants externes…).
- **Prestations** : catalogue avec prix et unité (heure, jour, mois, séance, soirée, intervention, forfait…). Rien n'est préréglé.
- **Clients** : sans doublon ; un client de passage peut aussi être facturé sans fiche.
- **Factures de prestations** : plusieurs lignes, **au comptant (caisse ou banque) ou à crédit** (client enregistré obligatoire), **taxe facultative** (taux pris dans Administration → Paramètres), numéro **FS-année-0001**, facture imprimable (A4), **encaissements partiels**, annulation par écriture inverse (refusée si la facture a des encaissements).
- **Contrats mensuels** : un contrat (ex. gardiennage mensuel d'un site) se facture **en un clic par mois**, sans doublon ; les mois oubliés sont proposés ; suspension possible.
- **Dépenses** : fournitures, sous-traitance, location, transport, loyer, énergie, communication, honoraires, autres ; **dette fournisseur réglée plus tard** ; « Personnel salarié » ne passe aucune écriture (la paie se fait dans Salaires).
- **Rapports** : chiffre d'affaires par prestation, par client et par intervenant (agent, DJ, coiffeur…), dépenses par nature, **résultat simple**, **créances clients âgées** (moins de 30 jours, 31 à 60, plus de 60) ; export CSV. **Statistiques**, « À faire » et **assistant** (factures impayées, contrats non facturés, dépenses en retard).
- **Comptabilité** : comptant = caisse ou banque / 706 (+ 445 si taxe) ; crédit = 411 / 706 ; encaissement = caisse ou banque / 411 ; dépense = 601, 611, 622, 618, 6133, 6056, 6231, 6322 ou 628 / caisse, banque ou 401. **Comptes à faire valider par l'expert-comptable** (706, 445, 611, 622, 6322… ; 601 est partagé avec BTP et Industries). Les écritures respectent la **période clôturée**.
- Rôle **Vendeur** (caisse) : tableau de bord, factures, clients ; pas de contrats, dépenses, rapports ni annulations. Achats listés dans « Achats Services ». Sauvegarde, export, import et réinitialisation incluent le bloc.
### 0.2 Métier sans secteur dédié : le socle Commerce
Une entreprise dont le métier n'a pas de bloc **n'a rien à choisir** : le **socle Commerce** (ventes, achats, stock, caisse, comptabilité, salaires, rapports, gestion) est son espace de travail. L'écran de choix des secteurs le dit maintenant clairement. Un métier de service peut aussi prendre « Services et prestations », ou « Autre service » dans ce bloc.
### 0.3 Mention de précision : l'application ne remplace pas un expert-comptable
Texte affiché : « *Compta+ est un outil d'aide à la gestion et à la tenue des comptes. Il ne remplace ni un cabinet comptable ni un expert-comptable : l'établissement et la certification des états financiers, les déclarations fiscales et sociales, le choix du plan comptable et du régime d'imposition, les opérations de fin d'exercice et tout avis juridique ou fiscal relèvent de votre expert-comptable, de votre juriste et des autorités compétentes. Faites valider ces éléments avant de les déposer ou de les remettre à un tiers.* »
Où : **en tête de Rapports et analyse** (écran et impression), **sur l'écran de clôture annuelle**, **sur les déclarations TCA et Impôt sur le Revenu**, **en bas de chaque PDF de rapport** (version courte), et dans le bloc Services. *Les écrans Salaires et déclarations avaient déjà des mises en garde ; elles restent.*
### 0.4 Deux procédures écrites (documents séparés, à lire, pas à déposer)
**Récupération du 2FA** et **règle de clôture des périodes** : deux documents rédigés dans Claude Docs (liens dans ma réponse).

## 0-bis. Rappel : nouveautés de la v312
- **Rapports sans débordement (votre retour du 1er novembre)** : le **rapport financier d'un fonds** (Rapports → Situation des fonds → « Rapport financier ») dépassait de l'écran sur téléphone, comme certaines listes déroulantes (Fonds, Dons, Dépenses) quand un nom était long. **Corrigé** : tableaux à colonnes fixes avec retour à la ligne, listes limitées à la largeur de l'écran. **Testé à 360 px** sur tous les onglets du bloc et sur les documents imprimés.
- **Sécurité — exports Excel** : un nom commençant par `=`, `+`, `-` ou `@` (par exemple un donateur nommé `=HYPERLINK(...)`) pouvait devenir une **formule exécutée à l'ouverture du fichier CSV** dans Excel. Les exports de tous les blocs, des rapports, de la gestion et de l'administration **neutralisent maintenant ces débuts** (une apostrophe est ajoutée). Les nombres ne sont pas touchés.
- **Sécurité — montants démesurés** (bloc ONG) : un montant de `1e308` ou de plus de 100 milliards était accepté et pouvait être enregistré comme illisible. Il est **refusé** (limite 100 milliards de gourdes).
- **Vocabulaire ONG selon le type d'organisation** : ONG, association, église et fondation ont chacune leurs natures de recettes (une association propose « Collecte », jamais « Offrande » ; l'église propose « Dîme » et « Offrande »), leurs libellés de dépenses, leurs mots (« Bailleur », « Financeur », « Partenaire »).

## 0-bis-c. Nouveau bloc : ONG, associations, églises
**Activation** : Administration → Secteurs → cochez **ONG, associations, églises**. Suivre `CAS-PRATIQUE-ONG-pas-a-pas.md`. Le bloc contient : choix du type d'organisation ; **fonds affectés par projet** (budget, virements entre fonds, clôture à solde zéro) ; **dons et reçus numérotés** (montant en lettres, A4 ou ticket) ; donateurs, bailleurs, **membres et cotisations** avec retards ; **dépenses** imputées à un fonds avec **alerte, raison obligatoire et gestionnaire** en cas de dépassement ; **rapport financier par fonds**, rapport annuel des dons, relevé par donateur ; statistiques, « À faire », assistant, Achats ONG. Rôle **Vendeur** : donateurs, membres, dons, cotisations, reçus seulement.

## 0-bis-b. Corrections de vos retours (v306 à v309, déjà validées sur TEST)
- **v309 — Écarts de chiffres (arrondis)** : vos écarts (7 au lieu de 6,50 ; 37 au lieu de 36,84 ; marge de 9 au lieu de 8,50) ne venaient pas du calcul mais de l'**affichage**, qui arrondissait à l'unité. Le calcul interne était juste (6 500 ÷ 1 000 = 6,50 ; 3 500 ÷ 95 = 36,84 ; 15 − 6,50 = 8,50). **Tous les montants « par unité » s'affichent maintenant avec 2 décimales** : coût par unité de la campagne, coût par tête, prix, marge par unité, prix unitaire des lignes de vente et de commande, factures et devis imprimés, alertes de vente à perte. Les totaux restent affichés en gourdes entières. Vérifiez : Rapports → Rentabilité des campagnes : coût par unité **6,50 G**, prix **15,00 G**, marge par unité **8,50 G** ; Élevage : coût par tête **36,84 G**. *Le bouton « Mettre au prix de revient » propose toujours un prix arrondi à la gourde supérieure, pour ne jamais vendre à perte.*
- **v309 — Onglet Commandes** : il reprenait le vocabulaire des Industries (« Gâteaux de mariage, Porte en fer forgé, Uniformes », « produits de la gamme », « Spéciale », « Prête », « Travail sur mesure »), ce qui ressemblait à une pâtisserie ou à un atelier. Il parle maintenant d'agriculture : **Vente courante (produits de la ferme)** et **Précommande (récolte ou animaux à venir, avance)** ; exemples « Maïs de la récolte de juin, 20 poulets pour Noël, Légumes pour le marché » ; états **Devis, Confirmée, En préparation, Prête à livrer, Livrée et facturée, Annulée** ; devis imprimé « PRÉCOMMANDE ». J'ai aussi corrigé d'autres restes : exemples de noms d'intrants, de produits et de catégories, « Coût des transformations » dans les rapports. *Les commandes déjà saisies gardent leurs données ; seuls les libellés changent.*
- **v308 — Parcelles en double** : vous avez créé deux fois la même parcelle (même nom en minuscules) sans refus. **Je n'ai pas pu reproduire** l'erreur chez moi (nom identique, majuscules différentes, double clic rapide : tout est refusé), mais j'ai **renforcé le contrôle** : il compare maintenant au tout dernier état des données, sans tenir compte des majuscules, accents ni espaces en trop ; le refus s'écrit **en rouge sous le bouton** (en plus du message qui disparaît vite, qu'on rate facilement sur téléphone) ; les parcelles sont listées dans une **carte « Mes parcelles »** avec leur surface et leur nombre de campagnes. Même renforcement pour les doublons d'**intrants, produits, clients, bandes et repères d'animaux**. *Si le problème revient, écrivez-moi les deux noms exacts saisis et l'appareil utilisé.* **Nouveau bouton « Retirer »** sur chaque parcelle qui n'a aucune campagne : utilisez-le pour supprimer votre parcelle en double (il n'existait aucun moyen de la retirer, c'était un manque).
- **v307 — Vocabulaire comptable de l'Agriculture** : l'achat d'intrants affichait « Achats de matériaux de chantier », car le compte 601 est partagé avec le BTP et gardait son nom. L'Agriculture a maintenant **ses propres comptes**, nommés avec le vocabulaire du métier : **6021 Achats d'intrants agricoles** (semences, engrais, aliments, produits vétérinaires) ; **6022 Achats d'animaux d'élevage** ; **6055 Eau d'irrigation, énergie et carburant agricole** ; **6132 Location de terres agricoles** ; **6155 Entretien du matériel agricole, des clôtures et des bâtiments d'élevage** ; **6182 Transport des récoltes et des animaux** ; **6282 Autres frais d'exploitation agricole** ; **632 Honoraires (vétérinaire, agronome)** ; **6612 Main-d'œuvre agricole (journaliers)** ; **7012 Ventes de produits agricoles et d'animaux d'élevage**. Les écrans disent aussi **« Intrant »** au lieu de « Matière » et **« Fiche de transformation »** au lieu de « fiche de fabrication ». *Les écritures déjà passées sous l'ancien compte 601 restent telles quelles ; seules les nouvelles saisies utilisent les nouveaux comptes (si besoin, annulez et ressaisissez vos essais).*
- **Calendrier fiscal** : il est maintenant **en cartes** (« Calendrier fiscal », « Chaque mois », « Chaque année », « À savoir ») et **ne déborde plus sur petit écran** (testé à 360 px de large) : chaque échéance s'affiche sur plusieurs lignes au lieu d'un tableau large.
- **Cartes « Marche à suivre »** : elles se cachaient dès que les 7 étapes étaient faites (ou si vous aviez déjà des données). **Elles restent désormais toujours visibles** sur le Tableau de bord, avec ✓ devant les étapes faites et la mention « toutes faites ✓ » à la fin. Corrigé pour **Restauration, Hôtellerie, Industries, Transport, Santé et Agriculture** (Import-export l'avait déjà).
- **Cas pratique Agriculture et élevage** : `CAS-PRATIQUE-AGRICULTURE-pas-a-pas.md` (à lire, pas à déposer).

## 1. Calendrier fiscal (Rapports → Déclarations fiscales → dernier onglet « Calendrier fiscal »)
- **Réponse à votre question sur « l'échéance de demain »** : le **31 octobre**, c'est la **liste annuelle des bénéficiaires de versements** (art. 95), à déposer du 1er au 31 octobre. Pénalité indiquée par la DGI : 25 000 G par mois de retard, plafonnée à 300 000 G.
- **Correction de ma part** : je vous avais proposé d'« ajouter » cette liste alors qu'elle existait déjà dans l'application. Ce qui manquait était un **calendrier** qui regroupe toutes les dates ; il est maintenant là.
- **Contenu** : dates mensuelles (retenues sur salaires et primes, retenues sur prestataires, TCA : du 1er au 15 du mois suivant) ; dates annuelles (liste des employés 30 septembre, liste des bénéficiaires 1–31 octobre, acomptes 1–15 octobre et 1–15 décembre, déclaration définitive de l'IR 1er octobre–31 janvier) ; **échéances proches** en haut ; rappel sur la conservation des documents (5 ans), l'attestation de retenue remise aux employés, les pénalités et l'intérêt de 3 % par mois.
- **Chaque date est marquée « Code fiscal » ou « À confirmer ».** Cet onglet **ne calcule rien** : vos calculs restent ceux du **nouveau Code fiscal** (en vigueur le 1er octobre 2026).
- **Écart à connaître** : les pages du site de la DGI datent de l'**ancien Code** (acomptes à 75 % en 3 versements) alors que l'application applique le **nouveau** (60 % en 2 versements, primes à 15 %). Je n'ai rien changé aux calculs ; les dates incertaines sont « À confirmer » (voir « Ce qui reste de votre ressort »).

## 2. Restauration et Hôtellerie : carte « marche à suivre »
Comme dans les autres secteurs, l'**Aperçu** affiche une carte de **7 étapes** tant que vous n'avez pas fini : 
- **Restauration** : tables, menu, recettes, personnel, première commande, premier encaissement, service et pourboires.
- **Hôtellerie** : types de chambres, chambres, clients, réservation, arrivée, départ et facture, planning.
Chaque étape a un bouton **Ouvrir** qui mène à l'écran concerné (le Vendeur ne voit que les écrans qui lui sont permis). La carte disparaît quand tout est fait.

## 3. Nouveau bloc : Agriculture et élevage
**Activation** : Administration → **Secteurs** → cochez **Agriculture et élevage** (grille de prix C, **inchangée**). L'espace « Agriculture et élevage » apparaît dans le sélecteur d'espace.

**Ce que le bloc permet** (les trois activités : cultures, élevage, transformation et vente) :
- **Intrants et achats** : semences, engrais, aliments, produits vétérinaires ; achat avec fournisseur (à payer ou payé), stock suivi.
- **Produits et prix**, **Catalogue illustré** (comme Industries).
- **Cultures** : **parcelles**, **campagnes** (par campagne et par parcelle), **utilisation d'intrants**, **récoltes**, coût de la campagne et **coût par unité récoltée**.
- **Élevage** : **bandes** (lots) ou **animaux un par un** selon l'espèce ; naissances, achats, **mortalités**, pertes, autoconsommation ; **soins et vaccins avec rappel** ; pesées ; effectif, **coût par tête**, taux de mortalité.
- **Transformation simple** : recettes et lots (ex. maïs → farine), à partir d'un produit récolté.
- **Clients, commandes, ventes** : vente de produits **et d'animaux vivants** (bande ou animal) ; refus de vendre plus que le stock ou l'effectif ; **vente à perte = même règle qu'Industries** (raison obligatoire, gestionnaire requis, bouton « prix de revient », jamais de blocage pur).
- **Dépenses** (main-d'œuvre, salarié, animaux, vétérinaire, terre, énergie, entretien, transport, autre), **imputables à une campagne ou à une bande**. « Salarié » ne crée **pas** d'écriture (la paie se fait dans Salaires, pour éviter le double compte).
- **Rapports** : rentabilité des campagnes ; effectifs et coût par tête. **Statistiques** : coût par campagne.
- **« À faire » et assistant** : impayés, intrant bas, soin en retard, mortalité supérieure à 10 %, campagne de plus de 180 jours sans récolte.
- **Achat et fournisseurs** : onglet « Achats Agriculture ». Sauvegarde, export, import et réinitialisation incluent le bloc. Le **Vendeur** voit : aperçu, catalogue, clients, commandes, ventes.

Numéro de version : **20261102-312**.

## Fichiers du paquet (41 fichiers + 4 documents à lire)
| Dossier du paquet | Fichiers | Où les déposer | Action |
|---|---|---|---|
| racine | CARTE-DES-MODULES.md, tst-fake.js, tst-lancer.mjs, tst-n1.cjs, tst-u29.cjs, tst-u36.cjs, tst-u39.cjs, tst-u40.cjs, tst-u41.cjs, tst-u42.cjs, tst-u43.cjs, tst-u44.cjs, **tst-u45.cjs** | à la racine du dépôt | remplace (tst-u45 : nouveau) |
| build | build.mjs | dossier `build` | remplace |
| src | **index.modele** (en `.html`), 00-config, 06-icones-et-graphiques, 07-constantes-metier, **10-formatage-impression-et-pdf**, 12-application-principale, 17-compta-assistant-de-controle, **18-compta-revision-et-cloture**, 24-achats, 28-declarations-fiscales, 33-gestion-reprise-et-rapports, 34-gestion-module, 35-rapports-et-bilans, 38-administration-stock-et-sauvegardes, 39-administration-module, 50-secteurs-et-blocs, 54-sante, **56-facturation-abonnements**, 57-assistant-blocs, 58-restauration, 59-hotellerie, 60-ecoles-socle, 61-transport, 64-industries, 65-agriculture, 66-ong, **67-services** (tous en `.jsx`) | dossier `src` | remplace (67 : nouveau) |

(+ `CAS-PRATIQUE-AGRICULTURE-pas-a-pas.md`, `CAS-PRATIQUE-ONG-pas-a-pas.md`, `CAS-PRATIQUE-SERVICES-pas-a-pas.md` : à lire, pas à déposer.) Total : **13 fichiers** de racine, **1** fichier `build`, **27** fichiers `src` (26 en `.jsx` + **index.modele.html**) ; aucun script SQL. **Important** : déposez bien les 13 fichiers de la racine (le test n1 compte désormais **22** fichiers de construction).

## Procédure pas à pas
### Étape 1 — Supabase
Rien à faire (pas de script SQL, pas d'Edge Function).
### Étape 2 — Les fichiers de la racine
Dépôt **Compta-plus-** → **Add file → Upload files** → glissez les 13 fichiers du dossier `racine` → **Commit changes**.
### Étape 3 — Le fichier du dossier `build`
Dossier **build** → **Add file → Upload files** → `build.mjs` → **Commit changes**.
### Étape 4 — Les fichiers du dossier `src`
Dossier **src** → **Add file → Upload files** → glissez les 27 fichiers (dont `index.modele.html`) → **Commit changes**. Une construction démarre (25 à 40 minutes). Ne redéposez rien pendant ce temps.
### Étape 5 — Attendre le vert
Onglet **Actions** → « Construire le site » doit passer au **vert**. Si rouge : copiez-moi les lignes **ÉCHEC / FAIL**.
### Étape 6 — Vérifier sur le site de production
1. **Ctrl + Maj + R**. Version en bas du menu : **20261102-313**.
2. **Rapports et analyse** : l'encadré « Compta+ est un outil d'aide à la gestion… » apparaît en haut ; exportez un PDF : la mention courte est en bas de page.
3. **Services et prestations** (sur une **entreprise d'essai de production**) : activez le secteur, suivez `CAS-PRATIQUE-SERVICES-pas-a-pas.md` (prestation, client, facture au comptant, facture à crédit, encaissement, contrat mensuel, dépense, rapport).
4. **Petit écran** : sur téléphone, le tableau de bord de Services et ceux des autres secteurs gardent leurs montants dans les cartes.
5. Écran de choix des secteurs (entreprise sans secteur) : la phrase sur le socle Commerce est visible.
6. Non-régression : Commerce, comptabilité, ONG, Agriculture, Industries, BTP : comme avant.

## CE QUI RESTE DE VOTRE RESSORT
**1.** Déposer ce paquet sur **Compta-plus-** seulement, attendre le vert, vérifier, puis me dire **« v313 active sur PROD »**.
**2.** **Adopter les deux procédures** (récupération 2FA ; clôture des périodes) : les lire, remplir les cases à cocher, désigner l'agent de vérification et le second validateur, imprimer les codes de secours du Super Admin en deux exemplaires.
**3.** **Expert-comptable** : valider les comptes des secteurs (dont Services : 706, 445, 611, 622, 6322), la comptabilité des fonds ONG, le compte 601 partagé, les stocks, et les délais internes de la règle de clôture.
**4.** **Fiscalité** : trancher acomptes 60 % en 2 versements (application) ou 75 % en 3 (site DGI, ancien Code) ; vérifier la date de la liste des employés.
**5.** **Échéances DGI** : retenues d'octobre du **1er au 15 novembre 2026** ; acomptes provisionnels du **1er au 15 décembre** ; vérifier le dépôt de la liste annuelle des bénéficiaires (31 octobre ; pénalité 25 000 G par mois).
**6.** **Juriste** : reçus fiscaux (autorisation DGI), CGU et confidentialité (y compris la phrase sur la récupération du 2FA et la mention « ne remplace pas un expert-comptable »), TCA sur les abonnements, enregistrement de l'éditeur « Toris Technologie », durée de conservation du registre 2FA.
**7.** **Trois contrôles de sécurité gratuits** : Security Advisor de Supabase (10 min), test de cloisonnement entre deux comptes sur TEST (30 min, script à demander), relecture des Edge Functions (code à m'envoyer).
**8.** Clients pilotes, témoignages, vidéos, communication WhatsApp.
**9.** Compte MonCash de production (peut attendre faute de budget) ; scénario de prix « Équilibré » (peut attendre).
**10.** Test d'intrusion externe (après les contrôles gratuits, avant un gros client) ; sauvegarde à la seconde près PITR (peut attendre).
**11.** **Ne pas activer Agriculture, ONG ni Services chez un client réel** avant la validation de l'expert-comptable.
