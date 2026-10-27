# Compta+ — version 283 — paquet PRODUCTION
**Bloc « Hôtellerie » (validé sur TEST en v282) + correction de l'affichage des tableaux sur téléphone.** Ce paquet contient aussi le bloc Restauration (v280) : il est **cumulatif depuis la v277**.

À faire sur le dépôt **Compta-plus-** (production) uniquement.

**Prérequis** : la v277 (ou la v280) est active sur PROD, le workflow corrigé (`ubuntu-24.04`) est en place. **Aucun script SQL, aucune Edge Function.**

## Ce qui change (pour vous)
1. **Hôtellerie** (nouvel espace, avec le secteur « Restauration et hôtellerie ») : 8 onglets — Tableau de bord, Planning (14 jours), Réservations (acompte, arrivée, services, annulation, départ et facturation), Chambres et tarifs, Clients, Factures (A4 ou ticket), Rapports, Statistiques. Rien n'est préréglé : tarifs, services, taxe de séjour et TCA sont saisis par vous. Départ : date entre l'arrivée et aujourd'hui, un départ le jour même compte 1 nuit. Réception (Vendeur) : 5 onglets. Assistant : 2 contrôles (client attendu ni arrivé ni annulé, séjour dépassé sans départ).
2. **Petits écrans** : dans les Rapports (Hôtellerie, mais aussi Restauration, Éducation, Santé et Import-export qui partagent la même mise en page), les tableaux ne font plus déborder la page sur téléphone : ils **défilent horizontalement dans leur cadre** (faites glisser le doigt sur le tableau).
3. **Restauration** : la liste déroulante des serveurs (déjà dans la v280).

**Comptabilité Hôtellerie (automatique)** : acompte = Débit caisse/banque / Crédit 4191. Au départ : Débit caisse/banque et 4191 / Crédit 7076 hébergement, 7077 services, 4476 taxe de séjour, 445 TCA. Annulation avec acompte : remboursé (Débit 4191 / Crédit caisse) ou conservé (Débit 4191 / Crédit 7078).

Numéro de version : **20260830-283**.

## Fichiers du paquet (18 fichiers)
| Dossier du paquet | Fichier | Où le déposer | Action |
|---|---|---|---|
| racine | tst-u30.cjs | à la racine du dépôt | **nouveau** (test petits écrans) |
| racine | tst-u29.cjs | à la racine du dépôt | **nouveau** (test Hôtellerie) |
| racine | tst-u28.cjs | à la racine du dépôt | remplace ou nouveau (selon que la v280 est déjà posée) |
| racine | tst-n1.cjs | à la racine du dépôt | remplace |
| racine | tst-lancer.mjs | à la racine du dépôt | remplace |
| racine | CARTE-DES-MODULES.md | à la racine du dépôt | remplace |
| build | build.mjs | dossier `build` | remplace |
| src | 59-hotellerie.jsx | dossier `src` | **nouveau** |
| src | 58-restauration.jsx | dossier `src` | nouveau ou remplace (selon la v280) |
| src | 57-assistant-blocs.jsx | dossier `src` | remplace |
| src | 51-ecoles.jsx | dossier `src` | remplace (correction des tableaux) |
| src | 50-secteurs-et-blocs.jsx | dossier `src` | remplace |
| src | 39-administration-module.jsx | dossier `src` | remplace |
| src | 38-administration-stock-et-sauvegardes.jsx | dossier `src` | remplace |
| src | 17-compta-assistant-de-controle.jsx | dossier `src` | remplace |
| src | 12-application-principale.jsx | dossier `src` | remplace |
| src | 07-constantes-metier.jsx | dossier `src` | remplace |
| src | 06-icones-et-graphiques.jsx | dossier `src` | remplace |
| src | 00-config.jsx | dossier `src` | remplace |

(6 fichiers de racine, 1 fichier `build`, 12 fichiers `src` ; aucun script SQL.)

## Procédure pas à pas
### Étape 1 — Supabase
Rien à faire (pas de script SQL, pas d'Edge Function).
### Étape 2 — Les fichiers de la racine
Dépôt **Compta-plus-** → **Add file → Upload files** → glissez les 6 fichiers du dossier `racine` → **Commit changes**.
### Étape 3 — Le fichier du dossier `build`
Dossier **build** → **Add file → Upload files** → `build.mjs` → **Commit changes**.
### Étape 4 — Les fichiers du dossier `src`
Dossier **src** → **Add file → Upload files** → glissez les 12 fichiers → **Commit changes**. Une construction démarre (25 à 40 minutes). Ne redéposez rien pendant ce temps.
### Étape 5 — Attendre le vert
Onglet **Actions** → « Construire le site » doit passer au **vert**. Si rouge : copiez-moi les lignes **ÉCHEC / FAIL**.
### Étape 6 — Vérifier sur le site de production
1. **Ctrl + Maj + R**. Version en bas du menu : **20260830-283**.
2. Sur une entreprise d'essai avec le secteur « Restauration et hôtellerie » : un bouton **Hôtellerie** apparaît ; ouvrez-le (8 onglets).
3. Sur téléphone (ou fenêtre étroite), onglet **Rapports** : la page ne déborde plus, les tableaux se font glisser dans leur cadre.
4. Ne créez pas de fausses données dans une entreprise réelle.

## CE QUI RESTE DE VOTRE RESSORT
- Déposer le paquet **sur Compta-plus- seulement**, attendre le vert, vérifier (étape 6), puis me dire **« v283 active sur PROD »**.
- Prévenir vos clients hôteliers que le bloc est disponible (secteur à activer dans Administration → Secteurs).
- À confirmer avec votre **expert-comptable** : comptes 7076, 7077, 7078, 4191, 4476, 445 ; traitement fiscal de la taxe de séjour et des acomptes conservés ; mentions de la facture ; et, pour la Restauration, 7075/4677.
- Avant le **31 octobre 2026** : liste annuelle des versements. **1–15 novembre** : retenues d'octobre. **1–15 décembre** : acomptes provisionnels.
- Décisions en attente : retour en arrière de la base (PITR), récupération 2FA, compte MonCash de production, tests d'intrusion, règle « période clôturée », scénario de prix « Équilibré ».
- **Prochaine étape côté TEST** : je reprends la refonte du bloc Éducation (même méthode) sur la base de la v283 — le correctif tableaux y sera déjà inclus.
