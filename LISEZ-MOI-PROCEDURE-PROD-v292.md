# Compta+ — version 292 — paquet PRODUCTION
**Sept blocs réunis : Hôtellerie, Éducation refondue, Restauration, Import-export refondu, Santé refondue, Transport et logistique, et le nouveau bloc Immobilier et location (v291 validée sur TEST), avec la correction de la liste « Bien » dans Baux.** Ce paquet est **cumulatif depuis la v277** : il remplace tous les paquets PROD précédents (v280 à v290) ; inutile de les déposer. Si la v290 est déjà posée, celui-ci la met à jour.

À faire sur le dépôt **Compta-plus-** (production) uniquement.

**Prérequis** : la v277 (ou une version plus récente) est active sur PROD, le workflow corrigé (`ubuntu-24.04`) est en place. **Aucun script SQL, aucune Edge Function.** Vos données existantes ne changent pas. **Rien à supprimer.**

## La correction demandée (Immobilier → Baux)
Dans le formulaire « Nouveau bail », la liste « Bien » semblait ne pas fonctionner. Elle n'affichait que les biens **libres** : quand tous les biens avaient déjà un bail en cours (ou étaient « Hors gestion »), la liste restait vide sans explication.
- La liste affiche maintenant **tous vos biens en gestion** ; ceux qui ont un bail en cours sont **grisés** avec le nom du locataire (« Appartement 2B — loué à Marie Joseph »), seuls les biens libres se choisissent.
- Quand aucun bien n'est libre, un **message** explique pourquoi (aucun bien, biens hors gestion, ou tous loués) et quoi faire : ajouter un bien, cocher « En gestion » dans l'onglet Biens, ou « Mettre fin à ce bail » pour libérer un bien.
- Le nombre de biens « Hors gestion » (non proposés) est indiqué.
**Rappel de fonctionnement** : un bien ne peut avoir qu'un seul bail en cours ; pour le relouer, terminez d'abord son bail actuel (onglet Baux → Ouvrir → « Mettre fin à ce bail »).

## Ce qui change (pour vous) depuis la v277
9. **Nouveau : Immobilier et location** (secteur à activer : Administration → Secteurs, grille de prix C). Tableau de bord avec guide en 7 étapes et « À faire » (loyers en retard, loyers du mois à émettre, baux échus, dépôts) ; Biens ; Locataires ; Baux avec dépôt de garantie (réception, restitution avec retenue) ; Loyers : émission du mois en un clic ou loyer isolé, encaissements, **avis d'échéance et quittances A4 ou ticket**, filtres et totaux ; Dépenses par bien ; Rapports (rentabilité par bien, impayés par ancienneté, exports) ; Statistiques ; accueil (Vendeur) ; 3 contrôles de l'assistant. Rien n'est préréglé ; taxe sur les loyers désactivée par défaut. Comptabilité : loyer 411 / 706, 708 (charges), 445 (si taxe) ; dépôt 165 ; dépenses 6152, 6411, 616, 605, 628 ; annulations par écriture inverse.
8. **Transport et logistique** : bordereaux, véhicules et échéances, chauffeurs, voyages, factures A4/ticket (TCA désactivée par défaut), dépenses par véhicule, rentabilité par véhicule, régulation (Vendeur) ; en Factures, un message et la liste des voyages à passer à « Livré » quand le bouton est grisé.
7. **Santé refondue** : guide, « À faire », filtres et totaux, facture A4/ticket, rapports par période, statistiques.
6. **Éducation** : guide « Pour démarrer » dans une carte blanche.
5. **Import-export refondu** : guide, « À faire », fiche de coût de revient et facture d'exportation imprimables, rapports et statistiques complétés.
4. **Éducation refondue**, **Hôtellerie** (nouvel espace), **Restauration** : voir les paquets précédents (inclus ici).
3. **Téléphone** : les tableaux des Rapports défilent dans leur cadre.
2. **Technique** : les blocs se chargent à la demande (application de départ plus légère).

Numéro de version : **20260830-292**.

## Fichiers du paquet (31 fichiers)
| Dossier du paquet | Fichier | Où le déposer | Action |
|---|---|---|---|
| racine | tst-u35.cjs | à la racine du dépôt | **nouveau** (test Immobilier) |
| racine | tst-u34.cjs | à la racine du dépôt | **nouveau** (test Transport) |
| racine | tst-u33.cjs | à la racine du dépôt | **nouveau** (test Santé) |
| racine | tst-u32.cjs | à la racine du dépôt | **nouveau** (test Import-export) |
| racine | tst-u31.cjs | à la racine du dépôt | **nouveau** (test Éducation) |
| racine | tst-u30.cjs | à la racine du dépôt | **nouveau** (test petits écrans) |
| racine | tst-u29.cjs | à la racine du dépôt | **nouveau** (test Hôtellerie) |
| racine | tst-u28.cjs | à la racine du dépôt | nouveau ou remplace |
| racine | tst-n1.cjs | à la racine du dépôt | remplace |
| racine | tst-lancer.mjs | à la racine du dépôt | remplace |
| racine | CARTE-DES-MODULES.md | à la racine du dépôt | remplace |
| build | build.mjs | dossier `build` | remplace |
| src | 62-immobilier.jsx | dossier `src` | **nouveau** |
| src | 61-transport.jsx | dossier `src` | **nouveau** |
| src | 60-ecoles-socle.jsx | dossier `src` | **nouveau** |
| src | 59-hotellerie.jsx | dossier `src` | **nouveau** |
| src | 58-restauration.jsx | dossier `src` | nouveau ou remplace |
| src | 57-assistant-blocs.jsx | dossier `src` | remplace |
| src | 55-statistiques.jsx | dossier `src` | remplace |
| src | 54-sante.jsx | dossier `src` | remplace |
| src | 53-import-export.jsx | dossier `src` | remplace |
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

(11 fichiers de racine, 1 fichier `build`, 19 fichiers `src` = 31 fichiers ; aucun script SQL.)

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
1. **Ctrl + Maj + R**. Version en bas du menu : **20260830-292**.
2. Immobilier (entreprise d'essai avec ce secteur) → Baux : la liste « Bien » affiche tous les biens, les loués sont grisés ; le bien libre se choisit.
3. Ne créez pas de fausses données dans une entreprise réelle.

## CE QUI RESTE DE VOTRE RESSORT
- Déposer le paquet **sur Compta-plus- seulement**, attendre le vert, vérifier (étape 6), puis me dire **« v292 active sur PROD »**.
- Dites-moi aussi si vous avez déjà déposé la v290 sur PROD (« v290 active sur PROD ») : ce paquet la remplace de toute façon.
- La correction sera reprise dans le prochain paquet TEST.
- Prévenir vos clients (écoles, hôtels, restaurants, importateurs, cabinets, transporteurs, propriétaires et agences immobilières) que les blocs sont disponibles ; le secteur s'active dans Administration → Secteurs.
- À confirmer avec votre **expert-comptable** : Immobilier : 706, 708, 165, 6152, 6411, 616, 605, 628, taxe éventuelle sur les loyers ; Transport : 6053, 6242, 6252, 618, TCA ; Santé : 4112, 4113, 7065 à 7067, 6221, 4678, 659 ; Import-export : 607/608/370, 4456, 4458, 666/766 ; Hôtellerie : 7076, 7077, 7078, 4191, 4476 ; Restauration : 7075, 4677 ; Éducation : TCA des frais scolaires, 487, 709.
- **Juriste** : contrat de bail, dépôt de garantie, préavis, valeur des quittances ; données des patients, clients, chauffeurs et locataires ; conditions d'utilisation. Le bloc Immobilier ne génère aucun contrat.
- Transport : documents de véhicule obligatoires à vérifier (le bloc n'en impose aucun).
- Échéances : liste annuelle des versements du **31 octobre 2026** (dans 2 jours) ; retenues d'octobre **1–15 novembre** ; acomptes provisionnels **1–15 décembre**.
- Décisions en attente : retour en arrière de la base (PITR), récupération 2FA, compte MonCash de production, tests d'intrusion, règle « période clôturée », scénario de prix « Équilibré » (grille C : Transport et Immobilier).
- **Suite** : blocs restants — Industries artisanales, ONG/associations/églises, BTP et construction, Agriculture et élevage.
