# Compta+ — version 312 — paquet PRODUCTION
**Cumulatif depuis la v304 (active sur PROD, confirmé) : bloc Agriculture et élevage · bloc ONG, associations, églises · Calendrier fiscal · cartes « Marche à suivre » toujours visibles · montants unitaires à 2 décimales · rapports sans débordement · durcissement de sécurité · cartes et montants à 7 chiffres et plus sans débordement sur petit écran.**

À faire sur le dépôt **Compta-plus-** (production) uniquement. **J'ai pris votre message du 1er novembre (« apporter la correction dans la version PROD ») comme la validation de la v310 sur TEST, correction du débordement comprise.** Ce paquet est **cumulatif depuis la v304** : il remplace les paquets PROD v309 et v310 ; **si vous avez déjà déposé la v309 sur PROD, déposez celui-ci par-dessus sans problème**. **Aucun script SQL, aucune Edge Function.** Vos données existantes ne changent pas. **Rien à supprimer.**

## Points d'attention propres à la production
- **Nouveaux secteurs** (Agriculture et élevage ; ONG, associations, églises) : à activer dans Administration → Secteurs (grilles de prix C et B, **inchangées**). **Rien ne change pour les entreprises qui ne les activent pas.**
- **Comptes comptables nouveaux** : Agriculture (6021, 6022, 6055, 6132, 6155, 6182, 6282, 632, 6612, 7012) et ONG (7581 à 7589, 6041, 6581, 6331, 6183, 6322, 6231, 6133, 6056, 6613, 6283), créés à la première saisie. **À faire valider par votre expert-comptable avant d'ouvrir ces secteurs à de vrais clients.**
- **Reçus de dons** : ils précisent qu'ils ne valent reçu fiscal que si la DGI a autorisé l'organisation. **À faire confirmer par un juriste.**
- **Calendrier fiscal** : informatif (il ne calcule rien) ; les lignes « À confirmer » viennent de pages de la DGI qui peuvent dater de l'ancien Code.
- **Test u29 corrigé** (indépendant de la date) : inclus.

## 0. Nouveautés de la v312 (par rapport à la v310 testée)
- **Rapports sans débordement (votre retour du 1er novembre)** : le **rapport financier d'un fonds** (Rapports → Situation des fonds → « Rapport financier ») dépassait de l'écran sur téléphone, comme certaines listes déroulantes (Fonds, Dons, Dépenses) quand un nom était long. **Corrigé** : tableaux à colonnes fixes avec retour à la ligne, listes limitées à la largeur de l'écran. **Testé à 360 px** sur tous les onglets du bloc et sur les documents imprimés.
- **Sécurité — exports Excel** : un nom commençant par `=`, `+`, `-` ou `@` (par exemple un donateur nommé `=HYPERLINK(...)`) pouvait devenir une **formule exécutée à l'ouverture du fichier CSV** dans Excel. Les exports de tous les blocs, des rapports, de la gestion et de l'administration **neutralisent maintenant ces débuts** (une apostrophe est ajoutée). Les nombres ne sont pas touchés.
- **Sécurité — montants démesurés** (bloc ONG) : un montant de `1e308` ou de plus de 100 milliards était accepté et pouvait être enregistré comme illisible. Il est **refusé** (limite 100 milliards de gourdes).
- **Vocabulaire ONG selon le type d'organisation** : ONG, association, église et fondation ont chacune leurs natures de recettes (une association propose « Collecte », jamais « Offrande » ; l'église propose « Dîme » et « Offrande »), leurs libellés de dépenses, leurs mots (« Bailleur », « Financeur », « Partenaire »).

## 0c. Nouveau bloc : ONG, associations, églises
**Activation** : Administration → Secteurs → cochez **ONG, associations, églises**. Suivre `CAS-PRATIQUE-ONG-pas-a-pas.md`. Le bloc contient : choix du type d'organisation ; **fonds affectés par projet** (budget, virements entre fonds, clôture à solde zéro) ; **dons et reçus numérotés** (montant en lettres, A4 ou ticket) ; donateurs, bailleurs, **membres et cotisations** avec retards ; **dépenses** imputées à un fonds avec **alerte, raison obligatoire et gestionnaire** en cas de dépassement ; **rapport financier par fonds**, rapport annuel des dons, relevé par donateur ; statistiques, « À faire », assistant, Achats ONG. Rôle **Vendeur** : donateurs, membres, dons, cotisations, reçus seulement.

## 0b. Corrections de vos retours (v306 à v309, déjà validées sur TEST)
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

## Fichiers du paquet (36 fichiers + 3 documents à lire)
| Dossier du paquet | Fichiers | Où les déposer | Action |
|---|---|---|---|
| racine | CARTE-DES-MODULES.md, tst-fake.js, tst-lancer.mjs, tst-n1.cjs, tst-u29.cjs, tst-u36.cjs, tst-u39.cjs, tst-u40.cjs, tst-u41.cjs, tst-u42.cjs, tst-u43.cjs, **tst-u44.cjs** | à la racine du dépôt | remplace (tst-u44 : nouveau) |
| build | build.mjs | dossier `build` | remplace |
| src | **index.modele** (en `.html`), 00-config, 06-icones-et-graphiques, 07-constantes-metier, 12-application-principale, 17-compta-assistant-de-controle, 24-achats, 28-declarations-fiscales, **33-gestion-reprise-et-rapports**, 34-gestion-module, 35-rapports-et-bilans, 38-administration-stock-et-sauvegardes, 39-administration-module, 50-secteurs-et-blocs, 54-sante, 57-assistant-blocs, 58-restauration, 59-hotellerie, **60-ecoles-socle**, 61-transport, 64-industries, **65-agriculture**, **66-ong** (tous en `.jsx`) | dossier `src` | remplace (65 et 66 : nouveaux) |

(+ `CAS-PRATIQUE-AGRICULTURE-pas-a-pas.md` et `CAS-PRATIQUE-ONG-pas-a-pas.md` : à lire, pas à déposer.) Total : **12 fichiers** de racine, **1** fichier `build`, **23** fichiers `src` (22 en `.jsx` + **index.modele.html**) ; aucun script SQL. **Important** : déposez bien les 12 fichiers de la racine (le test n1 compte désormais **21** fichiers de construction).

## Procédure pas à pas
### Étape 1 — Supabase
Rien à faire (pas de script SQL, pas d'Edge Function).
### Étape 2 — Les fichiers de la racine
Dépôt **Compta-plus-** → **Add file → Upload files** → glissez les 12 fichiers du dossier `racine` → **Commit changes**.
### Étape 3 — Le fichier du dossier `build`
Dossier **build** → **Add file → Upload files** → `build.mjs` → **Commit changes**.
### Étape 4 — Les fichiers du dossier `src`
Dossier **src** → **Add file → Upload files** → glissez les 23 fichiers → **Commit changes**. Une construction démarre (25 à 40 minutes). Ne redéposez rien pendant ce temps.
### Étape 5 — Attendre le vert
Onglet **Actions** → « Construire le site » doit passer au **vert**. Si rouge : copiez-moi les lignes **ÉCHEC / FAIL**.
### Étape 6 — Vérifier sur le site de production
1. **Ctrl + Maj + R**. Version en bas du menu : **20261102-312**.
2. **Rapports → Déclarations fiscales → Calendrier fiscal** : cartes lisibles sur téléphone.
3. Un secteur existant : la carte « Marche à suivre » est visible sur le tableau de bord.
4. **Agriculture** et **ONG** (sur une **entreprise d'essai de production**, pas une entreprise cliente) : activez, suivez les cas pratiques. Pour l'ONG, ouvrez un **rapport financier** sur téléphone : plus de défilement horizontal.
5. **Petit écran** : sur votre téléphone, ouvrez le tableau de bord d'un secteur (ONG, Agriculture…) avec de gros montants : ils restent dans leur carte.
6. Exportez un CSV : un nom commençant par `=` apparaît précédé d'une apostrophe.
7. Non-régression : Industries, BTP, Commerce, comptabilité : comme avant.

## CE QUI RESTE DE VOTRE RESSORT
- Déposer le paquet **sur Compta-plus- seulement**, attendre le vert, vérifier, puis me dire **« v312 active sur PROD »** (ou me décrire par écrit ce qui ne va pas).
- **TEST** : le paquet `Compta-plus-TEST-v312.zip` (petit) aligne le site de test sur la production. À déposer quand vous voulez ; sinon il sera inclus dans le prochain paquet de test.
- **Prévenir vos clients** des nouveautés ; **ne pas activer Agriculture ni ONG chez un client réel avant la validation de l'expert-comptable.**
- **Échéances DGI** : retenues d'octobre du **1er au 15 novembre 2026** ; acomptes provisionnels du **1er au 15 décembre** ; vérifier que la liste annuelle des versements (31 octobre) a bien été déposée (pénalité 25 000 G par mois de retard).
- **Questions au comptable / juriste** : voir le bilan complet que je vous ai remis (liste classée par importance).
