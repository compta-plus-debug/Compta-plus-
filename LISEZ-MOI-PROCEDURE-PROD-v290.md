# Compta+ — version 290 — paquet PRODUCTION
**Six blocs réunis, tous validés sur TEST : Hôtellerie, Éducation refondue (guide en carte blanche), Restauration, Import-export refondu, Santé refondue et le nouveau bloc Transport et logistique, plus la correction des tableaux sur téléphone.** Ce paquet est **cumulatif depuis la v277** : il remplace les paquets PROD v280, v283, v285, v286 et v288 (inutile de les déposer si ce n'est pas déjà fait ; si la v283 est déjà posée, celui-ci la met à jour).

À faire sur le dépôt **Compta-plus-** (production) uniquement.

**Prérequis** : la v277 (ou la v280, ou la v283) est active sur PROD, le workflow corrigé (`ubuntu-24.04`) est en place. **Aucun script SQL, aucune Edge Function.** Vos données existantes ne changent pas.

## Ce qui change (pour vous)
8. **Nouveau : Transport et logistique** (secteur à activer dans Administration → Secteurs) : tableau de bord avec guide et « À faire » (documents de véhicule, entretien, permis, voyages à facturer, impayés), voyages avec **bordereau de transport** imprimable, véhicules et échéances, chauffeurs, clients, factures (A4 ou ticket, TCA désactivée par défaut), encaissements, dépenses par véhicule, **rentabilité par véhicule**, statistiques, régulation (Vendeur) et 3 contrôles de l'assistant. Comptabilité : facture 411 / 706 (445 si TCA) ; dépenses 6053, 6242, 6252, 618 ; annulations par écriture inverse. Prix, échéances et TCA sont saisis par vous.
6. **Éducation** : le guide « Pour démarrer, dans cet ordre » du tableau de bord est maintenant dans une **carte blanche**, comme dans l'Import-export et la Santé (contenu et étapes inchangés).
7. **Santé refondue** : tableau de bord avec guide en 7 étapes et « À faire », filtres et totaux sur factures, patients et assureurs, facture A4 ou ticket, rapports par période (facturé par praticien, assureurs par ancienneté), statistiques complétées. Comptabilité inchangée.
0. **Import-export refondu** : tableau de bord avec guide en 7 étapes, « À faire », arrivées prévues, indicateurs du mois ; recherche, filtre par étape et lignes de total sur Importations et Exportations ; listes déroulantes des fournisseurs, clients et pays déjà saisis ; **fiche de coût de revient** et **facture d'exportation** imprimables (A4/PDF) ; rapports avec période, totaux, dû par fournisseur, à recevoir par client, écart de change net ; statistiques complétées. Comptabilité inchangée.
1. **Éducation refondue** : tableau de bord avec **guide de démarrage** (7 étapes cochées automatiquement), indicateurs du jour et du mois, échéances à venir, effectifs par classe ; **familles en tableau** (modifier, **relevé de compte** imprimable en A4 ou ticket) ; recherche et filtre des élèves ; **message avant « Appliquer les frais »** (combien d'échéances restent à créer) ; **filtres et totaux** sur Échéances et Encaissements ; reçu A4 ou ticket ; rapports avec totaux et « Encaissé par type de frais » ; statistiques complétées (« Élèves par classe » en **nombres**) ; nouveau contrôle de l'assistant (échéances jamais constatées). Comptabilité inchangée.
2. **Hôtellerie** (nouvel espace avec le secteur « Restauration et hôtellerie ») : Tableau de bord, Planning 14 jours, Réservations (acompte, arrivée, services, annulation, départ et facture ; départ entre l'arrivée et aujourd'hui, un départ le jour même compte 1 nuit), Chambres et tarifs, Clients, Factures (A4/ticket), Rapports, Statistiques. Rien n'est préréglé : tarifs, services, taxe de séjour et TCA sont saisis par vous. Réception (Vendeur) : 5 onglets. Assistant : 2 contrôles.
3. **Restauration** (9 onglets, serveur choisi dans une liste) : voir la v280.
4. **Téléphone** : les tableaux des Rapports défilent dans leur cadre au lieu de faire déborder la page.
5. **Technique** : les blocs Éducation, Hôtellerie et Restauration se chargent à la demande (application de départ plus légère).

**Comptabilité Hôtellerie (automatique)** : acompte = Débit caisse/banque / Crédit 4191. Au départ : Débit caisse/banque et 4191 / Crédit 7076 hébergement, 7077 services, 4476 taxe de séjour, 445 TCA. Annulation avec acompte : remboursé (Débit 4191 / Crédit caisse) ou conservé (Débit 4191 / Crédit 7078).

Numéro de version : **20260830-290**.

## Fichiers du paquet (29 fichiers)
| Dossier du paquet | Fichier | Où le déposer | Action |
|---|---|---|---|
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
| src | 60-ecoles-socle.jsx | dossier `src` | **nouveau** |
| src | 59-hotellerie.jsx | dossier `src` | **nouveau** |
| src | 58-restauration.jsx | dossier `src` | nouveau ou remplace |
| src | 57-assistant-blocs.jsx | dossier `src` | remplace |
| src | 55-statistiques.jsx | dossier `src` | remplace |
| src | 52-ecoles-suite.jsx | dossier `src` | remplace |
| src | 61-transport.jsx | dossier `src` | **nouveau** |
| src | 54-sante.jsx | dossier `src` | remplace |
| src | 53-import-export.jsx | dossier `src` | remplace |
| src | 51-ecoles.jsx | dossier `src` | remplace |
| src | 50-secteurs-et-blocs.jsx | dossier `src` | remplace |
| src | 39-administration-module.jsx | dossier `src` | remplace |
| src | 38-administration-stock-et-sauvegardes.jsx | dossier `src` | remplace |
| src | 17-compta-assistant-de-controle.jsx | dossier `src` | remplace |
| src | 12-application-principale.jsx | dossier `src` | remplace |
| src | 07-constantes-metier.jsx | dossier `src` | remplace |
| src | 06-icones-et-graphiques.jsx | dossier `src` | remplace |
| src | 00-config.jsx | dossier `src` | remplace |

(10 fichiers de racine, 1 fichier `build`, 18 fichiers `src` = 29 fichiers ; aucun script SQL. **Rien à supprimer.**)

## Procédure pas à pas
### Étape 1 — Supabase
Rien à faire (pas de script SQL, pas d'Edge Function).
### Étape 2 — Les fichiers de la racine
Dépôt **Compta-plus-** → **Add file → Upload files** → glissez les 10 fichiers du dossier `racine` → **Commit changes**.
### Étape 3 — Le fichier du dossier `build`
Dossier **build** → **Add file → Upload files** → `build.mjs` → **Commit changes**.
### Étape 4 — Les fichiers du dossier `src`
Dossier **src** → **Add file → Upload files** → glissez les 18 fichiers → **Commit changes**. Une construction démarre (25 à 40 minutes). Ne redéposez rien pendant ce temps.
### Étape 5 — Attendre le vert
Onglet **Actions** → « Construire le site » doit passer au **vert**. Si rouge : copiez-moi les lignes **ÉCHEC / FAIL**.
### Étape 6 — Vérifier sur le site de production
1. **Ctrl + Maj + R**. Version en bas du menu : **20260830-290**.
2. **Éducation** : Tableau de bord (guide de démarrage si l'école est vide), Familles et élèves (tableau, Relevé de compte), Statistiques (« Élèves par classe » en nombres).
3. **Hôtellerie** (entreprise d'essai avec le secteur « Restauration et hôtellerie ») : bouton Hôtellerie, 8 onglets.
4. Sur téléphone : onglet Rapports, aucun débordement de page.
5. Ne créez pas de fausses données dans une entreprise réelle.

## CE QUI RESTE DE VOTRE RESSORT
- Déposer le paquet **sur Compta-plus- seulement**, attendre le vert, vérifier (étape 6), puis me dire **« v290 active sur PROD »**.
- Prévenir vos clients (écoles, hôtels, restaurants, importateurs, cabinets, pharmacies, laboratoires, hôpitaux) que les blocs sont disponibles ; le secteur s'active dans Administration → Secteurs.
- À confirmer avec votre **expert-comptable** : TCA des frais scolaires, avances (487), bourses (709) ; Hôtellerie : 7076, 7077, 7078, 4191, 4476, taxe de séjour, acomptes conservés ; Restauration : 7075, 4677 ; Transport : 6053, 6242, 6252, 618 (numéros proposés), TCA sur le transport ; Santé : 4112, 4113, 7065 à 7067, 6221, 4678, 659 (aucune TCA calculée) ; Import-export : 607/608/370, 4456, 4458, 666/766, taux douaniers, TCA à l'exportation ; mentions des factures.
- Avant le **31 octobre 2026** : liste annuelle des versements. **1–15 novembre** : retenues d'octobre. **1–15 décembre** : acomptes provisionnels.
- Décisions en attente : retour en arrière de la base (PITR), récupération 2FA, compte MonCash de production, tests d'intrusion, règle « période clôturée », scénario de prix « Équilibré ».
- **Juriste** : données des patients et clients (confidentialité, consentement), conditions d'utilisation.
- Transport : vérifiez quels documents de véhicule sont obligatoires pour vos types de véhicules (le bloc n'en impose aucun).
- **Suite** : les prochains blocs de service, avec les mêmes principes.
