# Compta+ — version 278 — paquet TEST
**Nouveau bloc « Restauration » (l'hôtellerie viendra en v279).**

À faire sur le dépôt **compta-plus--test** uniquement. Le paquet PROD ne vous sera donné qu'après votre « v278 validée ».

**Prérequis** : la v277 est active sur TEST. **Aucun script SQL, aucune Edge Function.** Pas de changement du workflow.

## Ce qui change (pour vous)
Le secteur **« Restauration et hôtellerie »** devient disponible dans le choix des secteurs (forfait Assisté ou Extension). Quand il est activé, un espace **Restauration** apparaît (bouton en haut du menu et module « Restauration ») avec :

1. **Tables** : nom ou numéro, nombre de places, état Libre / Occupée.
2. **Menu et recettes** : plats et boissons (entrées, plats, desserts, boissons) avec prix. Pour chaque plat, une **fiche recette** : les ingrédients sont des produits de votre stock, avec la quantité pour une portion. L'application calcule le **coût du plat** et la **marge**.
3. **Commandes** : ouvrir une commande (sur une table, ou « sans table » pour le comptoir et l'emporter), ajouter des plats, voir l'**addition** (sous-total + service + TCA si activée), puis **encaisser** (espèces ou banque, avec pourboire facultatif).
4. **Service** : liste des employés avec leurs **points** (leur part) ; l'application calcule la part de chacun et la **répartit** en une action.
5. **Rapports** : ventes par plat, export CSV des additions.
6. **Réglages** (Vue d'ensemble) : taux de service (10 % par défaut) et TCA (oui/non).
7. **Assistant de contrôle** : plat sans recette, plat peu rentable (coût au-dessus de 70 % du prix), commande restée ouverte depuis la veille, service non reversé depuis plus de 30 jours.

**Comptabilité (automatique, à l'encaissement seulement ; une commande ouverte n'écrit rien) :**
- Encaissement : Débit caisse ou banque (addition + pourboire) / Crédit **7075** ventes de repas et boissons, **445** TCA si elle s'applique, **4677** service et pourboires à reverser au personnel (cet argent n'est pas un revenu de l'entreprise).
- Répartition du service : Débit **4677** / Crédit caisse ou banque.
- Les ingrédients sortent du stock (jamais en dessous de zéro). Avec la méthode « stock en actif » : Débit 6037 / Crédit 370.
- Annuler une addition payée : écritures contrepassées, ingrédients remis en stock ; refusé si son service a déjà été reversé.

Les rôles : l'administrateur et l'éditeur gèrent tout ; le **Vendeur** (serveur ou caissier) ouvre les commandes et encaisse, sans accès au menu, aux tables ni à la répartition du service. Les sauvegardes et restaurations incluent le bloc.

Numéro de version : **20260830-278**.

## Fichiers du paquet (15 fichiers)
| Dossier du paquet | Fichier | Où le déposer | Action |
|---|---|---|---|
| racine | tst-u28.cjs | à la racine du dépôt | **nouveau** (test de cette version) |
| racine | tst-n1.cjs | à la racine du dépôt | remplace (un 13e fichier de chargement est maintenant attendu) |
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
Rien à faire (pas de script SQL, pas d'Edge Function : les données du bloc sont enregistrées avec les autres).

### Étape 2 — Les fichiers de la racine
Dépôt **compta-plus--test** → **Add file → Upload files** → glissez les 4 fichiers du dossier `racine` → **Commit changes**.

### Étape 3 — Le fichier du dossier `build`
Dossier **build** → **Add file → Upload files** → glissez `build.mjs` → **Commit changes**.

### Étape 4 — Les fichiers du dossier `src`
Dossier **src** → **Add file → Upload files** → glissez les 10 fichiers → **Commit changes**. Une construction démarre (25 à 40 minutes). Ne redéposez rien pendant ce temps.

### Étape 5 — Attendre le vert
Onglet **Actions** → « Construire le site » doit passer au **vert**. Si rouge : copiez-moi les lignes **ÉCHEC / FAIL** de l'étape en échec. Si rien ne démarre : il faut un vrai changement dans `src` (redéposer un fichier identique ne crée aucun dépôt).

### Étape 6 — Vérifier sur le site de test
1. **Ctrl + Maj + R**. Version en bas du menu : **20260830-278**.
2. Prenez une entreprise de TEST en forfait **Assisté** ou **Extension**. Si le secteur n'est pas encore choisi, choisissez **Restauration et hôtellerie** (Administration → Secteurs). Un espace **Restauration** apparaît.
3. **Stock** : créez deux produits de type « marchandise » avec un prix de revient et une quantité (ex. « Riz », coût 60, stock 10).
4. Restauration → **Tables** : ajoutez « T1 ».
5. **Menu et recettes** : ajoutez « Riz au poulet », prix 500 ; cliquez « Recette », ajoutez Riz, quantité 2. Le coût (120) et la marge (76 %) s'affichent.
6. **Service** : ajoutez deux employés, « Anne » (1 point) et « Boris » (3 points).
7. **Commandes** : table T1 → **Ouvrir une commande** → ajoutez 2 × Riz au poulet. L'addition indique : sous-total 1 000, service 100, total 1 100. Pourboire 50, **Encaisser**.
8. Vérifiez : le stock du Riz est passé de 10 à 6 ; dans Comptabilité, l'écriture « Addition » : caisse 1 150 / ventes 7075 : 1 000 / 4677 : 150.
9. **Service** : 150 à répartir : Anne 37,50, Boris 112,50 → **Répartir**. Le montant à répartir passe à 0,00.
10. **Comptabilité → Assistant de contrôle** : ajoutez un plat sans recette, le point « Plat sans fiche recette » apparaît avec le filtre Restauration.

## CE QUI RESTE DE VOTRE RESSORT
- Déposer le paquet, attendre le vert, tester (étape 6), puis **« v278 validée »** (ou vos remarques). La v277 est déjà sur PROD.
- Décisions à me donner avant l'hôtellerie (v279) : types de chambres et tarifs (par nuit), taxe de séjour (oui/non, taux), acompte à la réservation, petit-déjeuner inclus ou non.
- À confirmer avec votre **expert-comptable** : comptes 7075 et 4677, traitement fiscal du service et des pourboires reversés (retenues sur salaires éventuelles), TCA sur les additions.
- Relire les seuils de l'assistant (70 % de coût, 1 jour pour une commande ouverte, 30 jours pour le service).
- Avant le **31 octobre 2026** : liste annuelle des versements. **1–15 novembre** : retenues d'octobre. **1–15 décembre** : acomptes provisionnels.
- Compte **WhatsApp Business** dédié ; relire messages de relance et réglages de facturation ; juriste : conditions d'utilisation (consentement WhatsApp, données patients et clients).
- Décisions en attente : retour en arrière de la base (PITR), récupération 2FA, compte MonCash de production, tests d'intrusion, règle « période clôturée », scénario de prix « Équilibré ».
