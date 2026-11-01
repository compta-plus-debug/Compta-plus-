# Compta+ — version 309 — paquet PRODUCTION
**Cumulatif depuis la v304 (active sur PROD, confirmé) : nouveau bloc Agriculture et élevage · Calendrier fiscal · cartes « Marche à suivre » toujours visibles (Restauration, Hôtellerie, Industries, Transport, Santé, Agriculture) · montants unitaires à 2 décimales · comptes et vocabulaire propres à l'Agriculture.**

À faire sur le dépôt **Compta-plus-** (production) uniquement. **Ce paquet est la version validée sur TEST (v309 validée).** **Prérequis** : la v304 est active sur PROD (confirmé). **Aucun script SQL, aucune Edge Function.** Vos données existantes ne changent pas. **Rien à supprimer.**

## Points d'attention propres à la production
- **Agriculture et élevage** : nouveau secteur, à activer dans Administration → Secteurs (grille de prix C, inchangée). **Rien ne change pour les entreprises qui ne l'activent pas.**
- **Comptes de l'Agriculture** : le secteur utilise ses propres comptes (6021, 6022, 6055, 6132, 6155, 6182, 6282, 632, 6612, 7012), créés automatiquement à la première saisie. **À faire valider par votre expert-comptable avant d'ouvrir le secteur à de vrais clients.**
- **Calendrier fiscal** : nouvel onglet **informatif** (il ne calcule rien) ; ses lignes « À confirmer » viennent de pages de la DGI qui peuvent dater de l'ancien Code. Ne vous y fiez pas sans votre comptable.
- **Cartes « Marche à suivre »** : elles restent visibles sur le tableau de bord de chaque secteur concerné, même une fois les étapes faites (avec ✓).
- **Montants par unité** : coût par unité, coût par tête, prix et marge par unité s'affichent maintenant avec 2 décimales dans l'Agriculture ; les totaux restent entiers. Les autres secteurs ne changent pas d'affichage.
- **Test u29 corrigé** : le test de l'Hôtellerie dépendait de la date (il échouait le 1er du mois ou le soir, en heure UTC) ; il est inclus dans ce paquet, corrigé. Sans lui, la construction PROD pourrait échouer à tort.

## 0. Corrections de vos retours (v306 à v309)
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

Numéro de version : **20261030-309**.

## Fichiers du paquet (31 fichiers + 2 documents à lire)
| Dossier du paquet | Fichiers | Où les déposer | Action |
|---|---|---|---|
| racine | CARTE-DES-MODULES.md, tst-fake.js, tst-lancer.mjs, tst-n1.cjs, tst-u29.cjs (corrigé), tst-u36.cjs, tst-u39.cjs, tst-u40.cjs, tst-u41.cjs, tst-u42.cjs, **tst-u43.cjs** | à la racine du dépôt | remplace (tst-u43 : nouveau) |
| build | build.mjs | dossier `build` | remplace |
| src | 00-config, 06-icones-et-graphiques, 07-constantes-metier, 12-application-principale, 17-compta-assistant-de-controle, 24-achats, 28-declarations-fiscales, 34-gestion-module, 35-rapports-et-bilans, 38-administration-stock-et-sauvegardes, 39-administration-module, 50-secteurs-et-blocs, 54-sante, 57-assistant-blocs, 58-restauration, 59-hotellerie, 61-transport, 64-industries, **65-agriculture** (tous en `.jsx`) | dossier `src` | remplace (65-agriculture : nouveau) |

(+ `CAS-PRATIQUE-AGRICULTURE-pas-a-pas.md` : à lire, pas à déposer.) Total : **11 fichiers** de racine, **1** fichier `build`, **19** fichiers `src` ; aucun script SQL.

## Procédure pas à pas
### Étape 1 — Supabase
Rien à faire (pas de script SQL, pas d'Edge Function).
### Étape 2 — Les fichiers de la racine
Dépôt **Compta-plus-** → **Add file → Upload files** → glissez les 11 fichiers du dossier `racine` → **Commit changes**.
### Étape 3 — Le fichier du dossier `build`
Dossier **build** → **Add file → Upload files** → `build.mjs` → **Commit changes**.
### Étape 4 — Les fichiers du dossier `src`
Dossier **src** → **Add file → Upload files** → glissez les 19 fichiers → **Commit changes**. Une construction démarre (25 à 40 minutes). Ne redéposez rien pendant ce temps.
### Étape 5 — Attendre le vert
Onglet **Actions** → « Construire le site » doit passer au **vert**. Si rouge : copiez-moi les lignes **ÉCHEC / FAIL**.
### Étape 6 — Vérifier sur le site de production
1. **Ctrl + Maj + R**. Version en bas du menu : **20261030-309**.
2. **Rapports → Déclarations fiscales → Calendrier fiscal** : cartes lisibles sur téléphone, sans défilement horizontal.
3. Un secteur existant (Restauration, Hôtellerie, Industries, Transport ou Santé) : la carte « Marche à suivre » est visible sur le tableau de bord.
4. **Agriculture** (sur une entreprise d'essai de production, **pas une entreprise cliente**) : activez le secteur, déroulez `CAS-PRATIQUE-AGRICULTURE-pas-a-pas.md` : coût par unité 6,50 G, marge 8,50 G, coût par tête 36,84 G.
5. Contrôle de non-régression : ouvrez Industries, BTP, Commerce et la comptabilité : tout fonctionne comme avant.

## CE QUI RESTE DE VOTRE RESSORT
- Déposer le paquet **sur Compta-plus- seulement**, attendre le vert, faire les vérifications ci-dessus, puis me dire **« v309 active sur PROD »** (ou me décrire par écrit ce qui ne va pas).
- **Prévenir vos clients** des nouveautés (calendrier fiscal, secteur Agriculture et élevage) ; **ne pas activer l'Agriculture chez un client réel avant la validation de l'expert-comptable.**
- **Échéances DGI** : retenues d'octobre du **1er au 15 novembre 2026** ; acomptes provisionnels du **1er au 15 décembre** ; liste annuelle des versements (31 octobre) : à vérifier qu'elle a bien été déposée, sinon pénalité de 25 000 G par mois de retard.
- **Question à votre juriste ou comptable** : acomptes à 60 % en 2 versements (nouveau Code, appliqué par l'application) ou 75 % en 3 (site DGI) ; date de la liste des employés (30 septembre).
- **Expert-comptable — Agriculture** : confirmer les comptes 6021, 6022, 6055, 6132, 6155, 6182, 6282, 632, 6612, 7012 et la valorisation des stocks et du cheptel à la clôture. **Aussi** : le BTP et les Industries partagent encore le compte 601 : voulez-vous leurs propres comptes ?
- **Juriste** : ventes d'animaux vivants, traçabilité et soins vétérinaires, contrats de main-d'œuvre agricole, conditions d'utilisation.
- **Décisions en attente** : retour en arrière de la base (PITR), récupération 2FA, compte MonCash de production, tests d'intrusion, règle « période clôturée », scénario de prix « Équilibré » (grille C).
- **Suite** : dernier bloc — ONG / associations / églises.
