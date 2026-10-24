# Compta+ — version 261 — paquet PROD
**Bloc Écoles complet** : espace École / Commerce, secrétaire-caissier(ère), relances, bourses et rabais, rapports, cantine/transport en abonnement.

À faire sur le dépôt **compta-plus-** (production) et sur le projet Supabase **de production** uniquement. Version validée sur le site de test (« v261 validée »).

**Ce paquet est cumulatif : il contient les versions 257 à 261.** Que vous ayez déjà déposé la v257, la v258 ou la v259 sur PROD ou non, déposez simplement tout ce paquet. **Deux scripts SQL sont inclus** (celui de la v257 et celui de la v261) : exécutez-les **dans l'ordre**, **avant** de déposer les fichiers. Ils sont sans danger s'ils ont déjà été exécutés (des messages « already exists, skipping » sont normaux). Aucune Edge Function. Pas de changement du workflow.

## Ce qui change (pour vous)
1. **Module « Écoles »** (n° 11) pour une entreprise qui a le secteur **Écoles** : années et classes, familles et élèves, grille de frais, échéances, encaissements avec reçus numérotés, écritures comptables automatiques (4111 / 706x, avances en 487, TCA optionnelle), sauvegardes.
2. **Impayés et relances** : familles en retard, appel, WhatsApp, message copiable et modifiable, historique des relances, export tableur.
3. **Bourses et rabais** : pourcentage ou montant fixe, par frais ou sur tous, jamais sous ce qui est déjà payé ; écriture Débit 709 / Crédit 4111 si l'échéance est déjà constatée.
4. **Rapports** : situation par classe, âge des impayés, journal de caisse avec exports ; chaque reçu mémorise la personne qui a encaissé.
5. **Cantine et transport** : frais « facultatifs » par abonnement, case à cocher sur chaque élève.
6. **Espace de travail** : sélecteur **École | Commerce** en haut du menu pour une école. Espace École : Écoles en premier, Vente / Stock / Comptes clients repliés, « Dépenses et fournisseurs », « Salaires du personnel », bouton « Tableau de bord de l'école » et arrivée directe dans l'école. Espace Commerce : le menu habituel. Entreprise sans le secteur Écoles : aucun changement.
7. **Secrétaire-caissier(ère)** (rôle Vendeur dans une école) : accès au seul module Écoles — consultation des élèves, encaissements avec reçu, relances ; pas d'annulation de reçu, pas de grille de frais, pas de comptabilité. **Faites ouvrir une fois le module Écoles par la direction** avant qu'elle encaisse (création des comptes 4111, 7061, 7062, 7068, 709).
8. **Inclus des versions 257 à 259** : ticket de caisse refait (logo, date et heure, nombre d'articles), téléphone et liste des clients dans le panier, formulaires conservés entre modules, texte de l'écran non sélectionnable, secteurs d'activité et blocs supplémentaires.
9. Numéro de version : **20260830-261**.

## Fichiers du paquet (26 fichiers)
| Dossier du paquet | Fichier | Où le déposer | Action |
|---|---|---|---|
| supabase | secteurs-et-blocs-migration.sql | **à copier dans Supabase** (étape 1, script A) | v257 — rejouable |
| supabase | ecole-secretaire-caissiere.sql | **à copier dans Supabase** (étape 1, script B) | **nouveau** |
| racine | tst-lancer.mjs, tst-u11.cjs, tst-u12.cjs, tst-u13.cjs, tst-u14.cjs, CARTE-DES-MODULES.md | à la racine du dépôt | remplace ou nouveau |
| src | 00-config, 07-constantes-metier, 08-composants-et-utilitaires, 10-formatage-impression-et-pdf, 12-application-principale, 14-compta-immobilisations-et-provisions, 21-caisse-et-banque, 23-vente, 24-achats, 25-stock, 26-creances-et-clients, 38-administration-stock-et-sauvegardes, 39-administration-module, 42-centre-de-gestion, 50-secteurs-et-blocs, 51-ecoles (tous en `.jsx`), index.modele.html | dossier `src` | remplace |
| src | **52-ecoles-suite.jsx** | dossier `src` | **nouveau** |

(6 fichiers de racine, 18 fichiers `src` dont 1 nouveau, 2 scripts SQL. Vérifiez que `src` contient bien les 18 fichiers du dossier `src` du paquet.)

## Procédure pas à pas
### Étape 1 — Supabase (2 scripts SQL, à faire EN PREMIER, dans l'ordre)
Projet Supabase **de PRODUCTION** → **SQL Editor** → **New query**.
1. **Script A** : ouvrez `supabase/secteurs-et-blocs-migration.sql`, copiez tout, collez, **Run**. « Success » (des « already exists, skipping » sont normaux si déjà fait).
2. **Script B** : nouvelle requête (**New query**) ; ouvrez `supabase/ecole-secretaire-caissiere.sql`, copiez tout, collez, **Run**. Résultat attendu : « Success » puis un tableau de 2 lignes dont la colonne `with_check` contient **compta-ecole**.
3. **Aucune Edge Function.**

### Étape 2 — Les fichiers de la racine
Dépôt **compta-plus-** → **Add file → Upload files** → glissez les 6 fichiers du dossier `racine` → **Commit changes**.

### Étape 3 — Les fichiers du dossier `src`
Ouvrez le dossier **src** → **Add file → Upload files** → glissez les 18 fichiers du dossier `src` du paquet → **Commit changes**. Une construction démarre (25 à 40 minutes). Ne redéposez rien pendant ce temps.

### Étape 4 — Attendre le vert
Onglet **Actions** : « Construire le site » doit passer au **vert**. Si rouge : ne touchez à rien, copiez-moi le texte de l'étape en échec.

### Étape 5 — Vérifier sur le site de production
1. **Ctrl + Maj + R** (téléphone : fermez complètement l'application puis rouvrez-la). Version en bas du menu : **20260830-261**.
2. Avec une entreprise qui a le secteur Écoles : le sélecteur École | Commerce est présent ; une entreprise sans ce secteur est inchangée.
3. Faire un essai léger **sur une entreprise de test de production** (et non sur une vraie école) : une année, une classe, une famille, un élève, un frais, un encaissement.
4. Dites-moi « v261 active sur PROD », ou ce qui cloche.

## Retour arrière (seulement si je vous le demande)
Redéposer les fichiers de la v256 retire les nouveautés ; les scripts SQL peuvent rester en place sans effet pour les autres rôles.

## CE QUI RESTE DE VOTRE RESSORT
**À faire maintenant**
- Exécuter les 2 scripts SQL sur la **production**, déposer ce paquet, me dire « v261 active sur PROD ».
- Me dire si vous avez aussi validé la **v260** (elle est incluse dans la v261 que vous venez de valider).
- Je prépare pour TEST la v262 : libellés de rôles adaptés à l'école (Secrétaire-caissier(ère), Directeur, Suppléant).

**Décisions à prendre**
- **Prix** : scénario « Équilibré » retenu (grille A pour Écoles) ; à confirmer après un test auprès de 5 à 10 entreprises cibles.
- **Numérotation qui repart de 0001 chaque année** et **exercice octobre–septembre** dans l'impôt sur le revenu : avec l'expert-comptable.

**Échéances et suivis**
- **Liste annuelle des versements** : avant le 31 octobre 2026 ; **acomptes provisionnels** : 1er–15 décembre ; **versement des retenues d'octobre** : 1er–15 novembre.
- **Lundi 26 octobre** : vérifier la réception des e-mails de relance (Resend).
- Dans quelques jours : relancer le script 1 (journal) sur TEST et PROD ; garder le script 3 sous la main.

**Validations externes et démarches**
- Expert-comptable : TCA sur cantine, transport, uniformes ; compte 709 (bourses et rabais) ; TCA sur les abonnements ; base des retenues 96–97 ; taux de retenue sur primes ; acomptes.
- Avocat : documents juridiques et données d'élèves mineurs ; messages de relance ; accès d'une secrétaire aux fiches d'élèves.
- Décision sur la sauvegarde à la minute ; récupération du 2FA ; compte MonCash de production ; prestataires de test d'intrusion ; règle « période clôturée » en observation.
