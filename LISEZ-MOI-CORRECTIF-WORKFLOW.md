# Compta+ — correctif du serveur de construction (1 mot à changer, TEST et PROD)

## Pourquoi
La construction de la v276 PROD s'est arrêtée au bout de 20 secondes avec : « Playwright does not support chromium on ubuntu26.04-x64 ». **Vos fichiers ne sont pas en cause.** GitHub a fait passer son serveur « ubuntu-latest » à Ubuntu 26.04, que l'outil de test n'accepte pas encore. La même erreur arrivera sur le dépôt TEST. La solution : demander à GitHub d'utiliser **Ubuntu 24.04** (celui qui fonctionnait jusqu'ici).

**Aucun script SQL, aucune Edge Function, aucun changement de l'application** (version inchangée : 276).

## Fichier du paquet (1)
| Dossier du paquet | Fichier | Où le mettre | Action |
|---|---|---|---|
| workflow | construire.yml | dans le dépôt, chemin `.github/workflows/construire.yml` | remplace (une seule ligne change : `runs-on: ubuntu-24.04`) |

## Procédure pas à pas (à faire sur les DEUX dépôts : Compta-plus- puis compta-plus--test)
**Méthode la plus simple : modifier une ligne sur GitHub (sans fichier)**
1. Ouvrez le dépôt sur GitHub → **Code** → dossier **.github** → **workflows** → fichier **construire.yml**.
2. Cliquez sur le **crayon** (Edit this file) en haut à droite du fichier.
3. Cherchez la ligne `    runs-on: ubuntu-latest` (environ ligne 30) et remplacez `ubuntu-latest` par `ubuntu-24.04`. La ligne doit devenir exactement : `    runs-on: ubuntu-24.04`
4. Cliquez **Commit changes…** → **Commit changes**.
5. Allez dans l'onglet **Actions** → à gauche **Construire le site** → bouton **Run workflow** (à droite) → choisissez la branche principale → **Run workflow**. (Ne cliquez pas « Re-run » sur l'ancienne construction : elle réutiliserait l'ancienne règle et échouerait encore.)
6. Attendez le **vert** (25 à 40 minutes pour la première construction).

**Variante avec le fichier** : sur la page `.github/workflows/construire.yml` du dépôt, cliquez le crayon, supprimez tout le contenu, collez le contenu du fichier `workflow/construire.yml` du zip, puis **Commit changes**. Reprenez ensuite à l'étape 5.

## Vérification
Après le vert : **Ctrl + Maj + R** sur le site. Version en bas du menu : **20260830-276** (PROD) ; le site de TEST est déjà en 276.

## CE QUI RESTE DE VOTRE RESSORT
- Faire ce changement sur **Compta-plus-** (PROD) **et** sur **compta-plus--test** (sinon la prochaine construction de TEST échouera aussi).
- Si le script SQL de la v276 PROD n'a pas encore été exécuté, **faites-le avant** (facturation-abonnements.sql puis relances-whatsapp.sql, dans l'ordre : voir le LISEZ-MOI de la v276 PROD).
- Me dire **« v276 active sur PROD »** une fois le vert obtenu et les vérifications faites.
- Échéances : liste annuelle des versements avant le **31 octobre 2026** ; lundi **26 octobre** e-mails de relance (Resend) ; **1–15 novembre** retenues d'octobre ; **1–15 décembre** acomptes provisionnels.
- Expert-comptable (TCA sur les abonnements, mentions des factures), juriste (consentement WhatsApp, données), décisions en attente (PITR, 2FA, MonCash production, tests d'intrusion, période clôturée, prix « Équilibré »).
