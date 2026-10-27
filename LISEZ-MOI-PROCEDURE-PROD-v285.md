# Compta+ — version 285 — paquet PRODUCTION
**Trois blocs réunis, validés sur TEST : Hôtellerie (v282), Éducation refondue (v284/285) et Restauration (v280), plus la correction des tableaux sur téléphone.** Ce paquet est **cumulatif depuis la v277** : il remplace les paquets PROD v280 et v283 (inutile de les déposer si ce n'est pas déjà fait ; si la v283 est déjà posée, celui-ci la met à jour).

À faire sur le dépôt **Compta-plus-** (production) uniquement.

**Prérequis** : la v277 (ou la v280, ou la v283) est active sur PROD, le workflow corrigé (`ubuntu-24.04`) est en place. **Aucun script SQL, aucune Edge Function.** Vos données existantes ne changent pas.

## Ce qui change (pour vous)
1. **Éducation refondue** : tableau de bord avec **guide de démarrage** (7 étapes cochées automatiquement), indicateurs du jour et du mois, échéances à venir, effectifs par classe ; **familles en tableau** (modifier, **relevé de compte** imprimable en A4 ou ticket) ; recherche et filtre des élèves ; **message avant « Appliquer les frais »** (combien d'échéances restent à créer) ; **filtres et totaux** sur Échéances et Encaissements ; reçu A4 ou ticket ; rapports avec totaux et « Encaissé par type de frais » ; statistiques complétées (« Élèves par classe » en **nombres**) ; nouveau contrôle de l'assistant (échéances jamais constatées). Comptabilité inchangée.
2. **Hôtellerie** (nouvel espace avec le secteur « Restauration et hôtellerie ») : Tableau de bord, Planning 14 jours, Réservations (acompte, arrivée, services, annulation, départ et facture ; départ entre l'arrivée et aujourd'hui, un départ le jour même compte 1 nuit), Chambres et tarifs, Clients, Factures (A4/ticket), Rapports, Statistiques. Rien n'est préréglé : tarifs, services, taxe de séjour et TCA sont saisis par vous. Réception (Vendeur) : 5 onglets. Assistant : 2 contrôles.
3. **Restauration** (9 onglets, serveur choisi dans une liste) : voir la v280.
4. **Téléphone** : les tableaux des Rapports défilent dans leur cadre au lieu de faire déborder la page.
5. **Technique** : les blocs Éducation, Hôtellerie et Restauration se chargent à la demande (application de départ plus légère).

**Comptabilité Hôtellerie (automatique)** : acompte = Débit caisse/banque / Crédit 4191. Au départ : Débit caisse/banque et 4191 / Crédit 7076 hébergement, 7077 services, 4476 taxe de séjour, 445 TCA. Annulation avec acompte : remboursé (Débit 4191 / Crédit caisse) ou conservé (Débit 4191 / Crédit 7078).

Numéro de version : **20260830-285**.

## Fichiers du paquet (23 fichiers)
| Dossier du paquet | Fichier | Où le déposer | Action |
|---|---|---|---|
| racine | tst-u31.cjs | à la racine du dépôt | **nouveau** (test Éducation) |
| racine | tst-u30.cjs | à la racine du dépôt | **nouveau** (test petits écrans) |
| racine | tst-u29.cjs | à la racine du dépôt | **nouveau** (test Hôtellerie) |
| racine | tst-u28.cjs | à la racine du dépôt | nouveau ou remplace |
| racine | tst-n1.cjs | à la racine du dépôt | remplace |
| racine | tst-lancer.mjs | à la racine du dépôt | remplace |
| racine | CARTE-DES-MODULES.md | à la racine du dépôt | remplace |
| build | build.mjs | dossier `build` | remplace |
| src | 60-ecoles-socle.jsx | dossier `src` | **nouveau** |
| src | 59-hotellerie.jsx | dossier `src` | **nouveau** |
| src | 58-restauration.jsx | dossier `src` | nouveau ou remplace |
| src | 57-assistant-blocs.jsx | dossier `src` | remplace |
| src | 55-statistiques.jsx | dossier `src` | remplace |
| src | 52-ecoles-suite.jsx | dossier `src` | remplace |
| src | 51-ecoles.jsx | dossier `src` | remplace |
| src | 50-secteurs-et-blocs.jsx | dossier `src` | remplace |
| src | 39-administration-module.jsx | dossier `src` | remplace |
| src | 38-administration-stock-et-sauvegardes.jsx | dossier `src` | remplace |
| src | 17-compta-assistant-de-controle.jsx | dossier `src` | remplace |
| src | 12-application-principale.jsx | dossier `src` | remplace |
| src | 07-constantes-metier.jsx | dossier `src` | remplace |
| src | 06-icones-et-graphiques.jsx | dossier `src` | remplace |
| src | 00-config.jsx | dossier `src` | remplace |

(7 fichiers de racine, 1 fichier `build`, 15 fichiers `src` = 23 fichiers ; aucun script SQL. **Rien à supprimer.**)

## Procédure pas à pas
### Étape 1 — Supabase
Rien à faire (pas de script SQL, pas d'Edge Function).
### Étape 2 — Les fichiers de la racine
Dépôt **Compta-plus-** → **Add file → Upload files** → glissez les 7 fichiers du dossier `racine` → **Commit changes**.
### Étape 3 — Le fichier du dossier `build`
Dossier **build** → **Add file → Upload files** → `build.mjs` → **Commit changes**.
### Étape 4 — Les fichiers du dossier `src`
Dossier **src** → **Add file → Upload files** → glissez les 15 fichiers → **Commit changes**. Une construction démarre (25 à 40 minutes). Ne redéposez rien pendant ce temps.
### Étape 5 — Attendre le vert
Onglet **Actions** → « Construire le site » doit passer au **vert**. Si rouge : copiez-moi les lignes **ÉCHEC / FAIL**.
### Étape 6 — Vérifier sur le site de production
1. **Ctrl + Maj + R**. Version en bas du menu : **20260830-285**.
2. **Éducation** : Tableau de bord (guide de démarrage si l'école est vide), Familles et élèves (tableau, Relevé de compte), Statistiques (« Élèves par classe » en nombres).
3. **Hôtellerie** (entreprise d'essai avec le secteur « Restauration et hôtellerie ») : bouton Hôtellerie, 8 onglets.
4. Sur téléphone : onglet Rapports, aucun débordement de page.
5. Ne créez pas de fausses données dans une entreprise réelle.

## CE QUI RESTE DE VOTRE RESSORT
- Déposer le paquet **sur Compta-plus- seulement**, attendre le vert, vérifier (étape 6), puis me dire **« v285 active sur PROD »**.
- Prévenir vos clients (écoles, hôtels, restaurants) que les blocs sont disponibles ; le secteur s'active dans Administration → Secteurs.
- À confirmer avec votre **expert-comptable** : TCA des frais scolaires, avances (487), bourses (709) ; Hôtellerie : 7076, 7077, 7078, 4191, 4476, taxe de séjour, acomptes conservés ; Restauration : 7075, 4677 ; mentions des factures.
- Avant le **31 octobre 2026** : liste annuelle des versements. **1–15 novembre** : retenues d'octobre. **1–15 décembre** : acomptes provisionnels.
- Décisions en attente : retour en arrière de la base (PITR), récupération 2FA, compte MonCash de production, tests d'intrusion, règle « période clôturée », scénario de prix « Équilibré ».
- **Suite** : refonte de l'**Import-export** (TEST d'abord), puis de la **Santé**.
