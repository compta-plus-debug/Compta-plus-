# Compta+ — version 300 — paquet PRODUCTION
**Huit blocs réunis : Hôtellerie, Éducation refondue, Restauration, Import-export refondu, Santé refondue, Transport et logistique, Immobilier et location, et le nouveau bloc BTP et construction complet (v299 validée sur TEST), avec le nouveau bouton « Modifier le dossier » du chantier.** Ce paquet est **cumulatif depuis la v277** : il remplace tous les paquets PROD précédents (v280 à v292) ; inutile de les déposer. Si la v290 ou la v292 est déjà posée, celui-ci la met à jour.

À faire sur le dépôt **Compta-plus-** (production) uniquement.

**Prérequis** : la v277 (ou une version plus récente) est active sur PROD, le workflow corrigé (`ubuntu-24.04`) est en place. **Aucun script SQL, aucune Edge Function.** Vos données existantes ne changent pas. **Rien à supprimer.**

## La nouveauté demandée : modifier le dossier d'un chantier
Dans la fiche d'un chantier, onglet **Vue d'ensemble**, un bouton **« Modifier le dossier »** (Administrateur et Éditeur) ouvre un formulaire : nom, client, adresse, début, fin prévue, retenue de garantie. **Enregistrer les modifications** ou **Annuler**.
- Nom obligatoire et unique ; client obligatoire ; la fin ne peut pas précéder le début ; retenue entre 0 et 30 %.
- Le **début** ne peut pas être plus tardif que la première opération déjà datée (avance, dépense, situation, pointage).
- La **retenue de garantie est figée** dès qu'une situation de travaux a été émise (elle sert déjà dans les montants).
- Onglet **Marché** : la désignation et l'unité de chaque ligne du bordereau se corrigent directement dans la ligne ; **quantité et prix unitaire** aussi, **tant qu'aucune situation n'est émise** (ensuite ils sont figés pour ne pas fausser les situations).
- Chaque modification est inscrite au journal d'audit. Le Lecteur ne voit pas le bouton.

## Ce qui change (pour vous) depuis la v277
10. **Nouveau : BTP et construction** (secteur à activer : Administration → Secteurs, grille de prix C). Chantiers avec bordereau de prix, situations de travaux et retenue de garantie, avances, étapes et tâches, budget d'exécution, équipe et main-d'œuvre, supervision (visites, comptes rendus, journal de chantier imprimable), réception provisoire/définitive et réserves avec libération de la retenue selon la règle choisie, onglet Études et plan optionnel, devis et situations imprimables. Rien n'est préréglé. Comptabilité : situation 411/4117/4191 contre 706 (+445) ; avances 4191 ; dépenses 601, 661, 611, 622, 618, 628 ; paie des ouvriers via le module Salaires.
9. **Immobilier et location**, 8. **Transport et logistique**, 7. **Santé refondue**, 6. **Éducation**, 5. **Import-export refondu**, 4. **Hôtellerie** et **Restauration**, 3. **Téléphone** (tableaux des Rapports), 2. **Chargement à la demande** des blocs : voir les paquets précédents (inclus ici).

Numéro de version : **20260830-300**.

## Fichiers du paquet (36 fichiers)
| Dossier du paquet | Fichier | Où le déposer | Action |
|---|---|---|---|
| racine | CARTE-DES-MODULES.md | à la racine du dépôt | remplace ou nouveau |
| racine | tst-lancer.mjs | à la racine du dépôt | remplace ou nouveau |
| racine | tst-n1.cjs | à la racine du dépôt | remplace ou nouveau |
| racine | tst-u28.cjs | à la racine du dépôt | remplace ou nouveau |
| racine | tst-u29.cjs | à la racine du dépôt | remplace ou nouveau |
| racine | tst-u30.cjs | à la racine du dépôt | remplace ou nouveau |
| racine | tst-u31.cjs | à la racine du dépôt | remplace ou nouveau |
| racine | tst-u32.cjs | à la racine du dépôt | remplace ou nouveau |
| racine | tst-u33.cjs | à la racine du dépôt | remplace ou nouveau |
| racine | tst-u34.cjs | à la racine du dépôt | remplace ou nouveau |
| racine | tst-u35.cjs | à la racine du dépôt | remplace ou nouveau |
| racine | tst-u36.cjs | à la racine du dépôt | remplace ou nouveau |
| racine | tst-u37.cjs | à la racine du dépôt | remplace ou nouveau |
| racine | tst-u38.cjs | à la racine du dépôt | remplace ou nouveau |
| racine | tst-u39.cjs | à la racine du dépôt | remplace ou nouveau |
| build | build.mjs | dossier `build` | remplace ou nouveau |
| src | 00-config.jsx | dossier `src` | remplace ou nouveau |
| src | 06-icones-et-graphiques.jsx | dossier `src` | remplace ou nouveau |
| src | 07-constantes-metier.jsx | dossier `src` | remplace ou nouveau |
| src | 12-application-principale.jsx | dossier `src` | remplace ou nouveau |
| src | 17-compta-assistant-de-controle.jsx | dossier `src` | remplace ou nouveau |
| src | 38-administration-stock-et-sauvegardes.jsx | dossier `src` | remplace ou nouveau |
| src | 39-administration-module.jsx | dossier `src` | remplace ou nouveau |
| src | 50-secteurs-et-blocs.jsx | dossier `src` | remplace ou nouveau |
| src | 51-ecoles.jsx | dossier `src` | remplace ou nouveau |
| src | 52-ecoles-suite.jsx | dossier `src` | remplace ou nouveau |
| src | 53-import-export.jsx | dossier `src` | remplace ou nouveau |
| src | 54-sante.jsx | dossier `src` | remplace ou nouveau |
| src | 55-statistiques.jsx | dossier `src` | remplace ou nouveau |
| src | 57-assistant-blocs.jsx | dossier `src` | remplace ou nouveau |
| src | 58-restauration.jsx | dossier `src` | remplace ou nouveau |
| src | 59-hotellerie.jsx | dossier `src` | remplace ou nouveau |
| src | 60-ecoles-socle.jsx | dossier `src` | remplace ou nouveau |
| src | 61-transport.jsx | dossier `src` | remplace ou nouveau |
| src | 62-immobilier.jsx | dossier `src` | remplace ou nouveau |
| src | 63-btp.jsx | dossier `src` | remplace ou nouveau |

(15 fichiers de racine, 1 fichier `build`, 20 fichiers `src` = 36 fichiers ; aucun script SQL.)

## Procédure pas à pas
### Étape 1 — Supabase
Rien à faire (pas de script SQL, pas d'Edge Function).
### Étape 2 — Les fichiers de la racine
Dépôt **Compta-plus-** → **Add file → Upload files** → glissez les 15 fichiers du dossier `racine` → **Commit changes**.
### Étape 3 — Le fichier du dossier `build`
Dossier **build** → **Add file → Upload files** → `build.mjs` → **Commit changes**.
### Étape 4 — Les fichiers du dossier `src`
Dossier **src** → **Add file → Upload files** → glissez les 20 fichiers → **Commit changes**. Une construction démarre (25 à 40 minutes). Ne redéposez rien pendant ce temps.
### Étape 5 — Attendre le vert
Onglet **Actions** → « Construire le site » doit passer au **vert**. Si rouge : copiez-moi les lignes **ÉCHEC / FAIL**.
### Étape 6 — Vérifier sur le site de production
1. **Ctrl + Maj + R**. Version en bas du menu : **20260830-300**.
2. Dans une entreprise d'essai avec le secteur BTP : Chantiers → ouvrir un chantier → **Modifier le dossier** → changer l'adresse → Enregistrer → l'adresse est mise à jour.
3. Ne créez pas de fausses données dans une entreprise réelle.

## CE QUI RESTE DE VOTRE RESSORT
- Déposer le paquet **sur Compta-plus- seulement**, attendre le vert, vérifier (étape 6), puis me dire **« v300 active sur PROD »**. (Les confirmations v290 et v292 sont restées sans réponse : la v300 les remplace.)
- Le bouton Modifier sera repris dans le prochain paquet TEST (avec Industries artisanales).
- Prévenir vos clients (écoles, hôtels, restaurants, importateurs, cabinets, transporteurs, immobilier, entreprises de construction) que les blocs sont disponibles ; le secteur s'active dans Administration → Secteurs.
- À confirmer avec votre **expert-comptable** : BTP : 706, 4117, 4191, 601, 661, 611, 622, 618, 628 et la paie des ouvriers ; Immobilier : 706, 708, 165, 6152, 6411, 616, 605, 628 ; Transport : 6053, 6242, 6252, 618, TCA ; Santé : 4112, 4113, 7065 à 7067, 6221, 4678, 659 ; Import-export : 607/608/370, 4456, 4458, 666/766 ; Hôtellerie : 7076, 7077, 7078, 4191, 4476 ; Restauration : 7075, 4677 ; Éducation : TCA des frais scolaires, 487, 709.
- **Juriste** : règles de réception, réserves et garantie ; contrats d'ouvriers de chantier ; contrat de bail, dépôt de garantie, préavis, quittances ; données des patients, clients, chauffeurs, locataires ; conditions d'utilisation.
- Échéances : liste annuelle des versements du **31 octobre 2026** (demain) ; retenues d'octobre **1–15 novembre** ; acomptes provisionnels **1–15 décembre**.
- Décisions en attente : retour en arrière de la base (PITR), récupération 2FA, compte MonCash de production, tests d'intrusion, règle « période clôturée », scénario de prix « Équilibré » (grille C : Transport, Immobilier, BTP).
- **Suite** : Industries artisanales (je vous poserai quelques questions de cadrage), puis ONG/associations/églises, Agriculture et élevage.
