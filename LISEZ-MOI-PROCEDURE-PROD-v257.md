# Compta+ — version 257 — paquet PROD
**Blocs par secteur d'activité — étape 1 : le socle (choix des 3 secteurs, verrouillage, demandes de changement)**

À faire sur le dépôt **compta-plus-** (production) et sur le projet Supabase **de production** uniquement. Version validée sur le site de test.

**Prérequis** : la v256 est déjà active sur ce dépôt de production. **Un script SQL est à exécuter (étape 1)**. Aucune Edge Function. Pas de changement du workflow.

## Ce qui change (pour vous)
Cette étape pose les fondations : elle ne crée pas encore de bloc métier (le bloc Écoles viendra à l'étape 2). Les secteurs se choisissent et se gèrent déjà.
1. **Choix des 3 secteurs, une seule fois** : l'administrateur de l'entreprise voit un écran « Choisissez vos secteurs d'activité » (jusqu'à 3 secteurs parmi 10). Le choix est **définitif**. « Plus tard » ferme l'écran sans rien enregistrer ; il reste possible dans Administration → Entreprise → « Mes secteurs d'activité ».
2. **Qui y a droit** : forfaits **Assisté et Extension** (3 secteurs inclus), entreprises **en essai gratuit**, et forfait **Standard avec le supplément « 3 secteurs »**. Un Standard sans supplément voit un message l'invitant à le demander au support.
3. **Demande de changement** : une fois le choix verrouillé, l'entreprise envoie une demande (nouveaux secteurs + motif obligatoire) depuis la même carte. Une seule demande en attente à la fois ; elle peut être annulée.
4. **Centre de gestion → Entreprises → nouvel onglet « Secteurs et blocs »** : liste des demandes en attente (Accepter / Refuser, tracé dans le suivi de travail), et réglage par entreprise : secteurs, **supplément « 3 secteurs »** (Standard) et **blocs supplémentaires** achetés hors des 3 secteurs, avec la grille A, B, C.
5. **Sécurité en base** : même en contournant l'écran, une entreprise ne peut choisir qu'une fois, au plus 3 secteurs valides ; tout le reste est réservé au centre de gestion.
6. Numéro de version : **20260830-257**.

## Prix retenus (scénario « Équilibré », affichés au centre de gestion)
Supplément « 3 secteurs » (Standard) : 12 $ ; blocs supplémentaires : grille A 8 $, B 5 $, C 3 $. Assisté et Extension : 3 secteurs inclus. Ce sont des montants d'affichage : aucune facturation automatique n'est modifiée dans cette version ; le centre de gestion coche le supplément quand le client a payé.

## Fichiers du paquet (10 fichiers)
| Dossier du paquet | Fichier | Où le déposer | Action |
|---|---|---|---|
| supabase | secteurs-et-blocs-migration.sql | SQL Editor de Supabase (projet de PRODUCTION) | **à exécuter** (étape 1) |
| racine | tst-lancer.mjs | à la racine du dépôt | remplace |
| racine | tst-u10.cjs | à la racine du dépôt | **nouveau** |
| racine | CARTE-DES-MODULES.md | à la racine du dépôt | remplace |
| src | 00-config.jsx | dossier `src` | remplace |
| src | 12-application-principale.jsx | dossier `src` | remplace |
| src | 39-administration-module.jsx | dossier `src` | remplace |
| src | 42-centre-de-gestion.jsx | dossier `src` | remplace |
| src | 50-secteurs-et-blocs.jsx | dossier `src` | **nouveau** |
| src | index.modele.html | dossier `src` | remplace |

(1 script SQL, 3 fichiers de racine, 6 fichiers `src` dont 1 nouveau.)

## Procédure pas à pas
### Étape 1 — Le script SQL (Supabase de PRODUCTION)
1. Ouvrez le tableau de bord Supabase du projet de **production** (celui de vos vrais clients, pas celui de test) → menu **SQL Editor** → **New query**.
2. Ouvrez le fichier `secteurs-et-blocs-migration.sql` du dossier `supabase`, copiez tout son contenu, collez-le dans l'éditeur.
3. Cliquez **Run**. Le résultat attendu est une ligne : `colonnes_ok_4 = 4`, `table_ok_1 = 1`, `declencheur_ok_1 = 1`. Des messages « already exists, skipping » sont normaux si vous le relancez.
4. Si une erreur rouge apparaît, ne faites rien d'autre et copiez-moi son texte. Ce script ne supprime ni ne modifie aucune donnée existante.
5. Le script est sans danger avant le dépôt des fichiers : l'application actuelle continue de fonctionner normalement.

### Étape 2 — Les fichiers de la racine
1. Page d'accueil du dépôt **compta-plus-** → **Add file → Upload files**.
2. Glissez les 3 fichiers du dossier `racine` : `tst-lancer.mjs`, `tst-u10.cjs`, `CARTE-DES-MODULES.md`. **Commit changes**.

### Étape 3 — Les fichiers du dossier `src`
1. Ouvrez le dossier **src** → **Add file → Upload files**.
2. Glissez les 6 fichiers du dossier `src` du paquet (dont le nouveau `50-secteurs-et-blocs.jsx`). **Commit changes**. Une construction démarre (25 à 40 minutes). Ne redéposez rien pendant ce temps.

### Étape 4 — Attendre le vert
Onglet **Actions** : la dernière ligne « Construire le site » doit passer au **vert**. Si elle passe au rouge, ne touchez à rien et copiez-moi le texte de l'étape en échec.

### Étape 5 — Vérifier sur le site réel
1. **Ctrl + Maj + R** (téléphone : fermez complètement l'application puis rouvrez-la). Le numéro en bas du menu doit être **20260830-257**.
2. **Choix** : avec une entreprise en essai gratuit (ou en forfait Assisté), connectez-vous en administrateur : l'écran « Choisissez vos secteurs d'activité » apparaît. Cochez 3 secteurs : le 4e est grisé, le compteur indique « 3 sur 3 ». Cliquez **Plus tard** : l'écran se ferme.
3. **Administration → Entreprise** (en bas) : carte « Mes secteurs d'activité » avec le bouton « Choisir mes secteurs ». Choisissez 3 secteurs → **Confirmer (définitif)** → les 3 secteurs sont listés et le bouton de choix a disparu.
4. **Demande** : même carte → « Demander un changement » → changez un secteur, écrivez un motif → « Envoyer la demande ». La demande apparaît « en attente » ; essayez « Annuler la demande », puis renvoyez-la.
5. **Centre de gestion** (compte administrateur de la plateforme) → Entreprises → **Secteurs et blocs** : la demande est listée → **Accepter**. Revenez dans l'entreprise : ses secteurs ont changé.
6. **Réglage** : « Régler » sur une entreprise Standard : cochez « Supplément 3 secteurs payé » et un bloc supplémentaire → Enregistrer. Rouvrez « Régler » : les valeurs sont conservées.
7. **Standard sans supplément** (entreprise hors essai) : pas d'écran de choix, message « Votre forfait Standard n'inclut pas les blocs par secteur… » dans Administration.
8. Dites-moi « v257 active sur PROD », ou ce qui cloche (avec une capture si possible).

## Ce que j'ai vérifié avant livraison
- Série automatique complète rejouée sur la version finale (la série « c1 » se vérifie à la construction automatique, comme avant).
- Nouveau test dédié (u10, 26 contrôles) : écran de choix, limite de 3, enregistrement et verrou, « Plus tard », Standard sans supplément, demande de changement (motif obligatoire, annulation), acceptation et réglage au centre de gestion.
- Script SQL exécuté sur une vraie base PostgreSQL de contrôle : exécuté deux fois sans erreur ; premier choix valide accepté ; refusés : second changement, éditeur, 4 secteurs, secteur inconnu, doublon, liste vide, supplément ou bloc ajouté par l'entreprise ; centre de gestion et fonctions serveur acceptés ; demandes : création par un administrateur seulement, une seule en attente, auto-acceptation refusée.

## Retour arrière (seulement si je vous le demande)
Si un problème grave survenait, je vous fournirais un script qui retire le déclencheur de sécurité, la table des demandes et les 4 colonnes. Ne l'exécutez pas de vous-même.

## CE QUI RESTE DE VOTRE RESSORT
**À faire maintenant**
- Exécuter le script SQL sur **PRODUCTION** (étape 1), déposer les fichiers (étapes 2 et 3), attendre le vert, vérifier (étape 5) et me dire « v257 active sur PROD ».
- Me confirmer que **les paquets PROD v254, v255 et v256 sont déposés et actifs** (v256 : retenues sur prestataires).

**Décisions à prendre**
- **Prix** : le scénario « Équilibré » est retenu pour l'affichage ; à confirmer après un test auprès de 5 à 10 entreprises cibles (écoles, importateurs).
- **Mise à niveau vers l'Extension en cours de période** : ma proposition est la différence au prorata ((350 − 80) × jours restants / 30) ; j'attends votre accord (document « Blocs par secteur »).
- **Passage à un forfait inférieur** : à l'échéance, sans remboursement (proposition).
- **Numérotation qui repart de 0001 chaque année** et **exercice octobre–septembre** dans l'impôt sur le revenu : avec l'expert-comptable.

**Échéances et suivis**
- **Liste annuelle des versements** : avant le 31 octobre 2026 ; **acomptes provisionnels** : 1er–15 octobre et 1er–15 décembre ; **versement des retenues d'octobre** : 1er–15 novembre.
- **Lundi 26 octobre** : vérifier la réception des e-mails de relance (Resend).
- Dans quelques jours : relancer le script 1 (journal) sur TEST et PROD ; garder le script 3 sous la main.

**Validations externes et démarches**
- Expert-comptable : TCA sur le supplément et sur vos abonnements, TCA sur cantine/transport/uniformes (bloc Écoles), base des retenues 96–97, taux de retenue sur primes, acomptes, « Écarts fiscaux confirmés ».
- Avocat : documents juridiques, et données d'élèves mineurs (bloc Écoles).
- Décision sur la sauvegarde à la minute ; récupération du 2FA ; compte MonCash de production ; prestataires de test d'intrusion ; règle « période clôturée » en observation.

## Prochaine étape (après validation)
Étape 2 : **bloc Écoles, première version** (années scolaires, classes, élèves et familles, grille de frais, échéancier, encaissements, reçus, écritures comptables).
