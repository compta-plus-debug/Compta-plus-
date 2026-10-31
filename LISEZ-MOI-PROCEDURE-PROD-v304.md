# Compta+ — version 304 — paquet PRODUCTION
**Cumulatif depuis la v300 (active sur PROD) : nouveau bloc Industries artisanales (avec catalogue illustré) · réinitialisation corrigée · ventes à perte justifiées · Transport et Immobilier : fournisseur et règlement des dettes · achats des métiers visibles dans « Achat et fournisseurs » · numérotation du menu par importance.** Tout a été validé sur TEST (v304) et re-testé dans le navigateur sur la version de production.

À faire sur le dépôt **Compta-plus-** (production) uniquement.
**Prérequis** : la v300 est active sur PROD (confirmé). **Aucun script SQL, aucune Edge Function.** Vos données existantes ne changent pas. **Rien à supprimer.**

## Points d'attention propres à la production
- **Réinitialisation** : la correction (date de clôture effacée d'abord, puis vérification) s'applique aussi à PROD. Si une entreprise réelle a une date de clôture, elle sera effacée lors d'une réinitialisation complète — c'est voulu, mais ne réinitialisez jamais une entreprise réelle sans sauvegarde (Administration → Sauvegardes).
- **Industries artisanales** : nouveau secteur, à activer dans Administration → Secteurs (grille de prix A, inchangée). Rien ne change pour les entreprises qui ne l'activent pas.
- **Anciennes dépenses « à payer » de Transport et Immobilier** : elles n'ont pas de fournisseur ; elles restent telles quelles (décision prise).
- **Numérotation du menu** : les numéros changent d'aspect dans les espaces de métier (1, 2, 3… par importance) ; l'espace Commerce garde son ordre.

## 1. Industries — catalogue illustré (comme la Restauration)
**Ce que vous avez constaté** : l'onglet de vente restait un formulaire ; pas de catalogue comparable à la carte de la Restauration.
**Ce qui change** :
- **Produits et recettes** : chaque produit reçoit une **catégorie** (Alimentaire, Entretien et cosmétiques, Bois et métal, Couture et art, Autres produits), une **description courte** et une **photo** (réduite automatiquement à 420 px, comme en Restauration).
- **Nouvel onglet « Catalogue »** : les produits en **cartes par catégorie** (photo ou initiale, prix, stock disponible, « Rupture »), **vos propres catégories** (ex. Savons, Meubles), **retirer / remettre** un produit, et **aperçu du catalogue pour les clients** imprimable (sans coûts, « épuisé » signalé). Pour le gestionnaire, la carte montre aussi le coût moyen et la marge.
- **Ventes** : les mêmes cartes en haut ; **« + 1 »** ajoute une unité au prix du catalogue (contrôles de stock et de perte appliqués) ; « Choisir » remplit le formulaire. **Commandes** : le catalogue est consultable (repliable) pour choisir un produit.
- Le rôle **Vendeur** voit le catalogue en consultation et peut vendre ; il ne modifie pas le catalogue.

## 2. Ventes à perte : justification, autorisation, redressement
Vous avez décidé : **pas de blocage pur**, mais une justification et un moyen de redresser pour que la perte ne devienne pas une habitude.
- **Justification obligatoire** : pour vendre sous le coût de revient, il faut choisir une **raison** (déstockage, promotion décidée par la direction, geste commercial, prix ou fabrication mal calculé, autre à préciser). Elle est inscrite sur la ligne, le journal d'audit et le rapport « Ventes sous le coût de revient » (colonne Raison ; « non justifiée » si absente).
- **Autorisation** : **seul un gestionnaire** peut confirmer une vente à perte. Le rôle **Vendeur** voit l'alerte, peut seulement « Mettre au prix de revient » ou annuler.
- **Redressement** : l'alerte propose **« Mettre au prix de revient (X) »**. Dans **Produits et recettes → ouvrir un produit**, un bloc affiche coût de revient moyen, prix, marge ou perte, propose un **nouveau prix** (au moins le coût) à enregistrer (tracé au journal) et un bouton « Voir les lots » pour vérifier si la fabrication est sous-évaluée ou mal planifiée.
- **Prévention de la récidive** : « À faire » signale (a) tout produit dont le **prix du catalogue est inférieur à son coût** et (b) tout produit **vendu à perte 2 fois ou plus en 30 jours**.
- Même règle sur les **commandes** : à l'ajout d'une ligne produit, et à « Livrer et facturer » si le coût des lots liés dépasse le montant (raison obligatoire, gestionnaire requis).

## 3. Transport et Immobilier : fournisseur et règlement des dettes
**Constat (vérifié)** : ces deux modules permettaient « Payé par : à payer (dette) » mais **sans fournisseur et sans moyen de régler** la dette : elle restait en 401 sans suite.
**Ce qui change** : champ **Fournisseur** (obligatoire si « à payer ») avec liste commune ; état **« À payer : X »** / **« Payée »** ; bouton **« Régler »** (règlement partiel ou total, caisse ou banque, annulable, écritures 401 ↔ caisse/banque) ; annulation de la dépense bloquée tant qu'un règlement existe. Ces dépenses rejoignent « Achat et fournisseurs » comme celles du BTP et d'Industries. *Les dépenses « à payer » déjà saisies avant cette version n'ont pas de fournisseur : elles restent telles quelles (vous pouvez les annuler et les ressaisir si besoin).*

## 4. « Achat et fournisseurs » : onglet des métiers limité aux espaces concernés
Vous avez signalé qu'il apparaissait dans tous les blocs. Maintenant : **espace BTP** → « Achats BTP » ; **Industries** → « Achats Industries » ; **Transport** → « Achats Transport » ; **Immobilier** → « Achats Immobilier » ; **Commerce** → « Achats des métiers » (vue d'ensemble) ; **Restauration, Hôtellerie, Santé, Éducation, Import-export** → aucun onglet (ces secteurs n'ont pas d'achats propres de ce type). Le « total à payer » des fournisseurs suit la même règle.

## 5. Diagnostic des modules communs (réponse à votre question)
J'ai ouvert chaque module commun dans chaque espace. **Verdict : le socle convient à tous les secteurs ; une seule correction légère était nécessaire.**
- **Caisse et banque, Comptabilité, Rapports et analyse, Salaires, Administration** : fondés sur les écritures comptables, que tous les blocs alimentent. Même contenu partout = **normal et voulu**.
- **Dépenses et fournisseurs** : convient maintenant à tous (voir 3 et 4).
- **Stock** : présent seulement où il sert (Restauration, Hôtellerie, pharmacie, Commerce, Import-export).
- **Gestion avancée** : mélangeait des outils **propres au commerce** (« Devis & commandes », « Import POS ») inutiles dans les espaces qui ont leurs propres devis et ventes. **Ils sont masqués dans les espaces Éducation, Restauration, Hôtellerie, Transport, Immobilier, BTP, Industries** ; conservés en Commerce, Import-export et Santé. Les autres onglets (échéances, avoirs et retours, acomptes, inventaire, reprise, pièces justificatives, budget, pilotage) restent.
- **Pas de refonte en profondeur nécessaire** : rien n'est désarticulé, les données et écritures sont inchangées.
- **Ordre d'importance** : identique pour tous les espaces de métier (métier, caisse, dépenses et fournisseurs, [stock], salaires, comptabilité, rapports, gestion, administration) : c'est cohérent, car ces modules jouent le même rôle partout ; seul le module du métier change.

Numéro de version : **20261030-304**.

## Fichiers du paquet (31 fichiers)
| Dossier du paquet | Fichiers | Où les déposer | Action |
|---|---|---|---|
| racine | CARTE-DES-MODULES.md, tst-fake.js, tst-lancer.mjs, tst-n1.cjs, tst-u36.cjs, tst-u39.cjs, tst-u40.cjs, tst-u41.cjs, tst-u42.cjs | à la racine du dépôt | remplace (ou nouveau si absent) |
| build | build.mjs | dossier `build` | remplace |
| src | 00-config, 07-constantes-metier, 12-application-principale, 17-compta-assistant-de-controle, 19-compta-module, 21-caisse-et-banque, 23-vente, 24-achats, 25-stock, 26-creances-et-clients, 27-paie, 34-gestion-module, 35-rapports-et-bilans, 38-administration-stock-et-sauvegardes, 39-administration-module, 50-secteurs-et-blocs, 57-assistant-blocs, **61-transport, 62-immobilier**, 63-btp, 64-industries (tous en `.jsx`) | dossier `src` | remplace (64-industries : **nouveau**) |

(+ `CAS-PRATIQUE-INDUSTRIES-pas-a-pas.md` : à lire, pas à déposer.) Total : 9 fichiers de racine, 1 fichier `build`, 21 fichiers `src` ; aucun script SQL.

## Procédure pas à pas
### Étape 1 — Supabase
Rien à faire (pas de script SQL, pas d'Edge Function).
### Étape 2 — Les fichiers de la racine
Dépôt **Compta-plus-** → **Add file → Upload files** → glissez les 9 fichiers du dossier `racine` → **Commit changes**.
### Étape 3 — Le fichier du dossier `build`
Dossier **build** → **Add file → Upload files** → `build.mjs` → **Commit changes**.
### Étape 4 — Les fichiers du dossier `src`
Dossier **src** → **Add file → Upload files** → glissez les 21 fichiers → **Commit changes**. Une construction démarre (25 à 40 minutes). Ne redéposez rien pendant ce temps.
### Étape 5 — Attendre le vert
Onglet **Actions** → « Construire le site » doit passer au **vert**. Si rouge : copiez-moi les lignes **ÉCHEC / FAIL**.
### Étape 6 — Vérifier sur le site de production
*Faites ces essais sur une **entreprise d'essai** de PROD (pas une entreprise réelle).*
1. **Ctrl + Maj + R**. Version en bas du menu : **20261030-304**.
2. **Industries** : Produits et recettes → ouvrez un produit : choisissez une catégorie, une description, une photo ; onglet **Catalogue** : les cartes, une catégorie à vous, l'aperçu client ; onglet **Ventes** : « + 1 » sur un produit.
3. **Vente à perte** : donnez à un produit un prix inférieur à son coût ; « + 1 » → encadré rouge ; sans raison la confirmation est refusée ; avec une raison, la ligne passe ; Rapports → « Ventes sous le coût » montre la raison. Connectez-vous (ou testez) avec un compte **Vendeur** : pas de bouton de confirmation. Redressement : ouvrez le produit, enregistrez un nouveau prix.
4. **Transport / Immobilier** : Dépenses → « Payé par : À payer » **sans fournisseur** → refusé ; avec fournisseur → « À payer » ; **Régler** (partiel puis solde) ; ouvrez « Dépenses et fournisseurs » → onglet **Achats Transport / Immobilier**.
5. **Numérotation et onglets** : en BTP, Industries, Transport, Immobilier l'onglet s'appelle « Achats BTP / Industries / … » ; en Restauration, aucun.
6. **Gestion avancée** en espace BTP : plus de « Devis & commandes » ni « Import POS » ; en Commerce, ils sont là.
7. **Industries** : cas pratique dans `CAS-PRATIQUE-INDUSTRIES-pas-a-pas.md` (à faire sur une entreprise d'essai, pas sur une entreprise réelle).
8. **Réinitialisation** : à ne tester que sur une entreprise d'essai de PROD.

## CE QUI RESTE DE VOTRE RESSORT
- Déposer le paquet **sur Compta-plus- (production)**, attendre le vert, faire les vérifications de l'étape 6, puis me dire **« v304 active sur PROD »**.
- **Règles du serveur** : activer le mode « bloque » (enforce) après lecture du journal reste compatible avec la correction de réinitialisation.
- Prévenir vos clients (nouveautés : catalogue Industries, achats des métiers, numérotation du menu).
- **Expert-comptable** : Industries (601, 701, 4191, 602, 605, 613, 615, 618, 628, stock de fin d'exercice, main-d'œuvre des lots) ; BTP (706, 4117, 4191, 601, 661, 611, 622, 618, 628, paie des ouvriers) ; Transport et Immobilier (comptes de charges et 401 des dettes réglées).
- **Juriste** : étiquetage/traçabilité des lots, acomptes et commandes sur mesure, règles BTP, contrats d'ouvriers, conditions d'utilisation.
- **Échéances** : liste annuelle des versements du **31 octobre 2026** (demain) ; retenues d'octobre **1–15 novembre** ; acomptes provisionnels **1–15 décembre**.
- **Décisions en attente** : retour en arrière de la base (PITR), récupération 2FA, compte MonCash de production, tests d'intrusion, règle « période clôturée », scénario de prix « Équilibré » (grille C).
- **Suite** : ONG/associations/églises, puis Agriculture et élevage.
