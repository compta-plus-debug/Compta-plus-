# Compta+ — version 280 — paquet PRODUCTION
**Bloc « Restauration » complet (validé sur TEST en v279) + serveur choisi dans une liste.** L'hôtellerie viendra dans une version suivante.

À faire sur le dépôt **Compta-plus-** (production) uniquement.

**Prérequis** : la v277 est active sur PROD (retour fait), le workflow corrigé (`ubuntu-24.04`) est en place. Ce paquet est **cumulatif depuis la v277**. **Aucun script SQL, aucune Edge Function.**

**Pourquoi la version 280 ?** La v279 testée sur TEST + votre correction (liste des serveurs) = nouvelle version, numérotée 280 sur PROD. Le site de TEST (v279) recevra la même correction à sa prochaine livraison.

## Ce qui change (pour vous)
L'espace Restauration compte maintenant **9 onglets** :

1. **Tableau de bord** : ventes du jour, nombre d'additions, panier moyen, ventes du mois, commandes ouvertes, service à répartir, **plats les plus vendus**, commandes en cours ; réglages (service en %, TCA oui/non) ; message de démarrage en 5 étapes.
2. **Salle et commandes** : le **serveur se choisit dans une liste déroulante** alimentée par l'onglet Personnel (plus de saisie à la main : une commande ne s'ouvre pas tant qu'aucun serveur n'est choisi, dès qu'au moins un employé est enregistré) ; **plan de salle** en cartes (vert = libre, orange = occupée, avec le montant). On **touche une table** pour prendre la commande ; on touche les **plats** pour les ajouter ; boutons **+ / −** ; **Envoyer en cuisine** (les lignes passent à « Envoyé », l'état devient « En cuisine »), puis **Marquer servie**, puis **Encaisser**. **Remise** avec motif obligatoire. **Paiement partagé** (plusieurs modes sur une addition) et **division entre N personnes**, tous deux **facultatifs** : sans rien toucher, un paiement unique suffit. Commandes sans table (comptoir, à emporter). Gestion des tables dans le même onglet.
3. **Factures** : toutes les additions encaissées, avec **filtres** (dates, table, serveur, mode de paiement, état) et une **ligne de totaux calculée** (sous-total, service, TCA, pourboires, total encaissé). Chaque facture s'ouvre en **vraie facture** (nom, adresse, téléphone, NIF et logo de l'entreprise, lignes, remise, service, TCA, pourboire, modes de paiement) à imprimer en **A4 ou en ticket étroit**, ou à enregistrer en PDF (bouton « Imprimer / enregistrer en PDF »). Elle s'ouvre aussi automatiquement après chaque encaissement.
4. **Menu** : une vraie **carte** en cartes illustrées, groupées par catégorie (Entrées, Plats, Desserts, Boissons + **vos propres catégories**, ex. « Grillades »). Chaque plat : nom, description, prix, **photo** (réduite automatiquement pour rester légère), **plat du jour**, **en rupture** (non commandable), modifier, retirer. **Aperçu de la carte pour les clients**, imprimable.
5. **Recettes et coûts** : une ligne par plat avec prix, **coût** et **marge** ; la fiche recette se règle ici (ingrédients du stock, quantité d'une portion).
6. **Personnel** : l'équipe avec **nom, téléphone, poste** (serveur 3 points, cuisinier 2, aide-cuisinier 1,5, plongeur 1, barman 2, caissier 1,5, gérant 0), points modifiables, « marquer parti ».
7. **Service et pourboires** : un encadré **explique le calcul en 4 lignes** avec un **exemple chiffré**. Vous choisissez la **période**, vous voyez le service, les pourboires et le total à répartir, le tableau **employé par employé (points, part en %, montant)** avec un **total en bas**, vous mettez **0 point** à un absent, puis **Répartir**. Les **reçus par employé** (avec signature) s'impriment. Une addition déjà répartie ne peut plus être annulée.
8. **Rapports** : **journal des ventes par jour avec ligne de total** (additions, sous-total, service, TCA, pourboires, total encaissé, espèces, banque), ventes **par plat, catégorie, serveur, table et heure**, **marge par plat**, **clôture de caisse** du jour (espèces attendues contre espèces comptées, écart), export CSV.
9. **Statistiques** : indicateurs du mois (ventes, additions, panier moyen, pourboires), **graphique des 6 derniers mois**, répartitions par catégorie, par mode de paiement et par serveur.

Le **Vendeur** (serveur ou caissier) voit 5 onglets (tableau de bord, salle et commandes, factures, menu en consultation, recettes en consultation) : pas de personnel, service, rapports ni statistiques.

**Comptabilité (automatique, à l'encaissement ; une commande ouverte n'écrit rien) :** Débit caisse et/ou banque (selon les modes de paiement) / Crédit **7075** ventes nettes de remise, **445** TCA si activée, **4677** service et pourboires. Répartition : Débit 4677 / Crédit caisse ou banque. Annulation : écritures contrepassées, ingrédients remis en stock.

Numéro de version : **20260830-280**.

## Fichiers du paquet (15 fichiers)
| Dossier du paquet | Fichier | Où le déposer | Action |
|---|---|---|---|
| racine | tst-u28.cjs | à la racine du dépôt | **nouveau** (test de cette version) |
| racine | tst-n1.cjs | à la racine du dépôt | remplace |
| racine | tst-lancer.mjs | à la racine du dépôt | remplace |
| racine | CARTE-DES-MODULES.md | à la racine du dépôt | remplace |
| build | build.mjs | dossier `build` (à la racine du dépôt) | remplace |
| src | 58-restauration.jsx | dossier `src` | **nouveau** |
| src | 57-assistant-blocs.jsx | dossier `src` | remplace |
| src | 17-compta-assistant-de-controle.jsx | dossier `src` | remplace |
| src | 12-application-principale.jsx | dossier `src` | remplace |
| src | 39-administration-module.jsx | dossier `src` | remplace |
| src | 38-administration-stock-et-sauvegardes.jsx | dossier `src` | remplace |
| src | 50-secteurs-et-blocs.jsx | dossier `src` | remplace |
| src | 07-constantes-metier.jsx | dossier `src` | remplace |
| src | 06-icones-et-graphiques.jsx | dossier `src` | remplace |
| src | 00-config.jsx | dossier `src` | remplace |

(4 fichiers de racine, 1 fichier `build`, 10 fichiers `src`, aucun script SQL.)

## Procédure pas à pas
### Étape 1 — Supabase
Rien à faire (pas de script SQL, pas d'Edge Function).
### Étape 2 — Les fichiers de la racine
Dépôt **Compta-plus-** → **Add file → Upload files** → glissez les 4 fichiers du dossier `racine` → **Commit changes**.
### Étape 3 — Le fichier du dossier `build`
Dossier **build** → **Add file → Upload files** → `build.mjs` → **Commit changes**.
### Étape 4 — Les fichiers du dossier `src`
Dossier **src** → **Add file → Upload files** → glissez les 10 fichiers → **Commit changes**. Une construction démarre (25 à 40 minutes). Ne redéposez rien pendant ce temps.
### Étape 5 — Attendre le vert
Onglet **Actions** → « Construire le site » doit passer au **vert**. Si rouge : copiez-moi les lignes **ÉCHEC / FAIL**. Si rien ne démarre : il faut un vrai changement dans `src`.
### Étape 6 — Vérifier sur le site de production
1. **Ctrl + Maj + R**. Version en bas du menu : **20260830-280**.
2. Le secteur « Restauration et hôtellerie » est maintenant proposé dans le choix des secteurs. Sur une entreprise réelle qui l'utilise (ou une entreprise d'essai), ouvrez l'espace **Restauration** : 9 onglets.
3. Onglet **Personnel** : enregistrez vos serveurs. Onglet **Salle et commandes** : la liste déroulante **Serveur** propose vos employés ; choisissez-en un, touchez une table.
4. Ne créez pas de fausses données dans une entreprise réelle : regardez simplement les écrans, ou testez sur une entreprise d'essai.

## CE QUI RESTE DE VOTRE RESSORT
- Déposer le paquet **sur Compta-plus- seulement**, attendre le vert, vérifier (étape 6), puis me dire **« v280 active sur PROD »**.
- Prévenir vos clients restaurateurs que le bloc est disponible (activation du secteur par eux ou par vous, dans Administration → Secteurs).
- Décisions pour l'**hôtellerie** : types de chambres et tarifs par nuit, taxe de séjour (oui/non, taux), acompte à la réservation, petit-déjeuner inclus ou non.
- À confirmer avec votre **expert-comptable** : comptes 7075 et 4677, traitement fiscal du service et des pourboires, TCA sur les additions, mentions de la facture.
- Avant le **31 octobre 2026** : liste annuelle des versements. **1–15 novembre** : retenues d'octobre. **1–15 décembre** : acomptes provisionnels.
- Décisions en attente : retour en arrière de la base (PITR), récupération 2FA, compte MonCash de production, tests d'intrusion, règle « période clôturée », scénario de prix « Équilibré ».
