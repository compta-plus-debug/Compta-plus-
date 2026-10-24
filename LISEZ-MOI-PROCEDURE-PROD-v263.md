# Compta+ — version 263 — paquet PROD
**Bloc Écoles complet et habillé** : espace École / Commerce, secrétaire-caissier(ère), noms de rôles de l'école, relances, bourses et rabais, rapports, cantine/transport, nouvel habillage.

À faire sur le dépôt **compta-plus-** (production) et sur le projet Supabase **de production** uniquement. Versions validées sur le site de test (« v261, v262, v263 validées »).

**Ce paquet est cumulatif : il contient les versions 257 à 263.** Que vous ayez déjà déposé le paquet PROD v261 ou non, déposez simplement tout ce paquet. **Deux scripts SQL sont inclus** (v257 et v261) : exécutez-les **dans l'ordre, avant** de déposer les fichiers, **s'ils n'ont pas déjà été exécutés sur la production** ; ils sont sans danger s'ils l'ont été (des messages « already exists, skipping » sont normaux). Aucune Edge Function. Pas de changement du workflow.

## Ce qui change (pour vous)
1. **Module « Écoles »** (n° 11) pour une entreprise qui a le secteur **Écoles** : années et classes, familles et élèves, grille de frais, échéances, encaissements avec reçus numérotés, écritures automatiques (4111 / 706x, avances 487, TCA optionnelle), sauvegardes.
2. **Relances** (appel, WhatsApp, message copiable et modifiable, historique, export), **bourses et rabais** (compte 709), **rapports** (par classe, âge des impayés, journal de caisse, exports), **cantine/transport** par abonnement.
3. **Espace de travail École | Commerce** : sélecteur en haut du menu ; l'espace École met l'école en premier et replie Vente, Stock et Comptes clients.
4. **Secrétaire-caissier(ère)** (rôle Vendeur dans une école) : accès au seul module Écoles (consultation des élèves, encaissements avec reçu, relances). **Faites ouvrir une fois le module Écoles par la direction** avant qu'elle encaisse (création des comptes 4111, 7061, 7062, 7068, 709).
5. **Noms de rôles de l'école** (espace École) : Vendeur → **Secrétaire-caissier(ère)**, Gestionnaire → **Directeur**, Consultant → **Suppléant** ; Administrateur inchangé. Seuls les mots changent, pas les droits.
6. **Habillage** : tableaux en cartes avec en-tête bleu marine et lignes alternées, pastilles d'état en couleur, onglets en boutons, cartes de chiffres.
7. **Inclus des versions 257 à 259** : ticket de caisse refait, téléphone et liste des clients dans le panier, formulaires conservés entre modules, texte de l'écran non sélectionnable, secteurs d'activité et blocs supplémentaires.
8. Numéro de version : **20260830-263**.

## Fichiers du paquet (27 fichiers)
| Dossier du paquet | Fichier | Où le déposer | Action |
|---|---|---|---|
| supabase | secteurs-et-blocs-migration.sql | **à copier dans Supabase** (étape 1, script A) | v257 — rejouable |
| supabase | ecole-secretaire-caissiere.sql | **à copier dans Supabase** (étape 1, script B) | v261 — rejouable |
| racine | tst-lancer.mjs, tst-u11.cjs, tst-u12.cjs, tst-u13.cjs, tst-u14.cjs, tst-u15.cjs, CARTE-DES-MODULES.md | à la racine du dépôt | remplace ou nouveau |
| src | 00-config, 07-constantes-metier, 08-composants-et-utilitaires, 10-formatage-impression-et-pdf, 12-application-principale, 14-compta-immobilisations-et-provisions, 21-caisse-et-banque, 23-vente, 24-achats, 25-stock, 26-creances-et-clients, 38-administration-stock-et-sauvegardes, 39-administration-module, 42-centre-de-gestion, 50-secteurs-et-blocs, 51-ecoles, 52-ecoles-suite (tous en `.jsx`), index.modele.html | dossier `src` | remplace ou nouveau |

(7 fichiers de racine, 18 fichiers `src`, 2 scripts SQL.)

## Procédure pas à pas
### Étape 1 — Supabase (2 scripts SQL, à faire EN PREMIER, dans l'ordre)
Projet Supabase **de PRODUCTION** → **SQL Editor** → **New query**.
1. **Script A** : ouvrez `supabase/secteurs-et-blocs-migration.sql`, copiez tout, collez, **Run**. « Success » (des « already exists, skipping » sont normaux si déjà fait).
2. **Script B** : **New query** ; ouvrez `supabase/ecole-secretaire-caissiere.sql`, copiez tout, collez, **Run**. Résultat attendu : « Success » puis un tableau de 2 lignes dont la colonne `with_check` contient **compta-ecole**.
3. **Aucune Edge Function.**

### Étape 2 — Les fichiers de la racine
Dépôt **compta-plus-** → **Add file → Upload files** → glissez les 7 fichiers du dossier `racine` → **Commit changes**.

### Étape 3 — Les fichiers du dossier `src`
Dossier **src** → **Add file → Upload files** → glissez les 18 fichiers du dossier `src` du paquet → **Commit changes**. Une construction démarre (25 à 40 minutes). Ne redéposez rien pendant ce temps.

### Étape 4 — Attendre le vert
Onglet **Actions** : « Construire le site » doit passer au **vert**. Si rouge : ne touchez à rien, copiez-moi le texte de l'étape en échec.

### Étape 5 — Vérifier sur le site de production
1. **Ctrl + Maj + R** (téléphone : fermez complètement l'application puis rouvrez-la). Version en bas du menu : **20260830-263**.
2. Entreprise avec le secteur Écoles : sélecteur École | Commerce présent, tableaux habillés ; entreprise sans ce secteur : aucun changement.
3. Faire un essai léger **sur une entreprise de test de production** (pas sur une vraie école) : année, classe, famille, élève, frais, encaissement.
4. Dites-moi « v263 active sur PROD », ou ce qui cloche.

## Retour arrière (seulement si je vous le demande)
Redéposer les fichiers de la v256 retire les nouveautés ; les scripts SQL peuvent rester en place sans effet pour les autres rôles.

## CE QUI RESTE DE VOTRE RESSORT
**À faire maintenant**
- Exécuter les 2 scripts SQL sur la **production** (s'ils n'ont pas déjà été exécutés), déposer ce paquet, me dire « v263 active sur PROD ».
- Me dire si la **v260** est bien validée (incluse depuis la v261).

**Décisions à prendre**
- **Prix** : scénario « Équilibré » retenu (grille A pour Écoles) ; à confirmer après un test auprès de 5 à 10 entreprises cibles.
- **Numérotation qui repart de 0001 chaque année** et **exercice octobre–septembre** dans l'impôt sur le revenu : avec l'expert-comptable.
- Prochain bloc : **Import-export** (ou autre priorité : dites-moi).

**Échéances et suivis**
- **Liste annuelle des versements** : avant le **31 octobre 2026** ; **acomptes provisionnels** : 1er–15 décembre ; **versement des retenues d'octobre** : 1er–15 novembre.
- **Lundi 26 octobre** : vérifier la réception des e-mails de relance (Resend).
- Dans quelques jours : relancer le script 1 (journal) sur TEST et PROD ; garder le script 3 sous la main.

**Validations externes et démarches**
- Expert-comptable : TCA sur cantine, transport, uniformes ; compte 709 (bourses et rabais) ; TCA sur les abonnements ; base des retenues 96–97 ; taux de retenue sur primes ; acomptes.
- Avocat : documents juridiques et données d'élèves mineurs ; messages de relance ; accès d'une secrétaire aux fiches d'élèves.
- Décision sur la sauvegarde à la minute ; récupération du 2FA ; compte MonCash de production ; prestataires de test d'intrusion ; règle « période clôturée » en observation.
