# Compta+ — version 271 — paquet PROD
**Validée sur TEST.** Ce paquet est **cumulatif depuis la v265 (active sur PROD)** : il contient la v266 à v268 (Éducation), la v269 (module Santé), la v270 (rôle Réception, détection des doublons et de la fraude) et la v271 (sélecteur d'espaces sur 2 lignes, Commerce selon l'activité, onglet Statistiques). Il remplace les paquets PROD v268 et v270 : que l'un des deux ait été déposé ou non, celui-ci suffit.

À faire sur le dépôt **compta-plus** (PROD) uniquement. **1 script SQL à exécuter AVANT de déposer les fichiers.** Aucune Edge Function. Pas de changement du workflow.

## Ce qui change (pour vous)
- **Éducation** : le bloc École devient « Éducation » (école, formation professionnelle, université) avec données séparées par type, mots du métier, semestres, crédits, cours et réinscriptions, renvoi motivé, année modifiable par l'administrateur principal seulement, rôles de l'université (Doyen, Vice-doyen, Secrétaire général(e)).
- **Santé** (nouveau) : cabinet ou clinique, pharmacie, laboratoire ou imagerie, hôpital ; patients, catalogue, facturation avec assureur, honoraires, séjours, lots, rapports. Visible seulement pour une entreprise qui a le secteur Santé.
- **Rôle Réception** (Vendeur : « Réceptionniste » ou « Vendeur(se) de comptoir » en pharmacie) et **contrôle des doublons et de la fraude** sur les fiches patients.
- **v271** : sélecteur d'espaces sur 2 colonnes bien espacées ; l'espace Commerce n'est proposé que si l'activité en dépend (import-export, pharmacie, entreprise sans secteur) ; onglet **Statistiques** dans Éducation, Import-export et Santé.
- Numéro de version : **20260830-271**.

## Fichiers du paquet (29 fichiers)
| Dossier du paquet | Fichier | Où le déposer | Action |
|---|---|---|---|
| supabase | sante-reception.sql | **à copier dans Supabase** (étape 1), pas sur GitHub | **nouveau** |
| supabase | sante-reception-RETOUR-ARRIERE.sql | **à garder de côté**, ne pas l'exécuter | **nouveau** (au cas où) |
| racine | tst-lancer.mjs, CARTE-DES-MODULES.md, tst-u22.cjs | à la racine du dépôt | remplace (tst-u22 : nouveau) |
| racine | tst-n1.cjs, tst-u12.cjs, tst-u13.cjs, tst-u14.cjs, tst-u15.cjs, tst-u16.cjs | à la racine du dépôt | remplace |
| racine | tst-u17.cjs, tst-u18.cjs, tst-u19.cjs, tst-u20.cjs, tst-u21.cjs | à la racine du dépôt | nouveau ou remplace |
| build | build.mjs | dossier `build` (à la racine du dépôt) | remplace |
| src | 54-sante.jsx, 55-statistiques.jsx | dossier `src` | **nouveau** |
| src | 00-config.jsx, 06-icones-et-graphiques.jsx, 07-constantes-metier.jsx, 12-application-principale.jsx | dossier `src` | remplace |
| src | 38-administration-stock-et-sauvegardes.jsx, 39-administration-module.jsx, 50-secteurs-et-blocs.jsx | dossier `src` | remplace |
| src | 51-ecoles.jsx, 52-ecoles-suite.jsx, 53-import-export.jsx | dossier `src` | remplace |

(14 fichiers de racine, 1 fichier `build`, 12 fichiers `src`, 2 scripts SQL dont un seul à exécuter. Total 29 + ce LISEZ-MOI.)

## Procédure pas à pas
### Étape 1 — Supabase PROD (script SQL, à faire EN PREMIER)
1. Ouvrez votre projet Supabase **de PRODUCTION** → menu de gauche **SQL Editor** → **New query**.
2. Ouvrez `supabase/sante-reception.sql`, **copiez tout son contenu** et collez-le dans l'éditeur.
3. Cliquez **Run**. Résultat attendu : « Success » puis un tableau de 2 lignes (Insert own company data, Update own company data) dont la colonne `with_check` contient **compta-sante**. Sinon, copiez-moi le message.
4. Le script peut être rejoué sans risque. Ne lancez pas le fichier `RETOUR-ARRIERE`. **Aucune Edge Function.**

### Étape 2 — Les fichiers de la racine
Dépôt **compta-plus** → **Add file → Upload files** → glissez les 14 fichiers du dossier `racine` → **Commit changes**.

### Étape 3 — Le fichier du dossier `build`
Dossier **build** → **Add file → Upload files** → glissez `build.mjs` → **Commit changes**.

### Étape 4 — Les fichiers du dossier `src`
Dossier **src** → **Add file → Upload files** → glissez les 12 fichiers du dossier `src` → **Commit changes**. Une construction démarre (25 à 40 minutes). Ne redéposez rien pendant ce temps.

### Étape 5 — Attendre le vert
Onglet **Actions** : « Construire le site » doit passer au **vert**. Si rouge : ne touchez à rien, copiez-moi le texte de l'étape en échec.

### Étape 6 — Vérifier sur le site de production
1. **Ctrl + Maj + R** (téléphone : fermez complètement puis rouvrez). Version en bas du menu : **20260830-271**.
2. Entreprise avec le secteur Éducation : le module s'appelle « Éducation ». Entreprise avec le secteur Santé : l'espace Santé apparaît. Une entreprise sans ces secteurs ne voit aucun changement.
3. Entreprise avec plusieurs secteurs : le sélecteur d'espaces tient sur 2 lignes. Entreprise avec seulement Éducation : pas d'espace Commerce.
4. Compte Vendeur d'une entreprise Santé : pas de bandeau rouge d'erreur de synchronisation (signe que le script SQL est pris en compte).

## CE QUI RESTE DE VOTRE RESSORT
- Dites-moi **« v271 active sur PROD »** quand c'est fait.
- Avant le **31 octobre 2026** : liste annuelle des versements. Lundi **26 octobre** : vérifier les e-mails de relance (Resend). **1–15 novembre** : retenues d'octobre. **1–15 décembre** : acomptes provisionnels.
- Relancer le script 1 (journal) sur TEST/PROD dans quelques jours ; garder le script 3.
- **Expert-comptable** : TCA et exonérations des actes de santé, rétrocession d'honoraires, rejets d'assureurs ; points déjà notés (Éducation, Import-export).
- **Juriste** : confidentialité des données des patients, accès du personnel d'accueil, mineurs et motifs de renvoi (Éducation).
- Décisions en attente : retour en arrière de la base (PITR), récupération 2FA, compte MonCash de production, prestataires de tests d'intrusion, règle « période clôturée », scénario de prix « Équilibré ».
