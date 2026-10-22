# Compta+ — version 251 — paquet PROD
**Correctif : ouverture avec réseau lent ou absent (message « Connexion internet difficile » et écran des blocs)**

À faire sur le dépôt **compta-plus-** (production) uniquement. Version validée sur le site de test. Aucune migration SQL, aucune Edge Function : rien à faire côté Supabase. Pas de changement du workflow.

**Prérequis** : la v250 est déjà active sur ce dépôt (construction verte). Rien d'autre à ajouter : ce paquet ne contient que 4 fichiers.

## Ce que vous avez observé
1. Après un redémarrage avec connexion faible, l'écran « Connexion internet difficile » s'affichait, puis l'application s'ouvrait toute seule quelques secondes plus tard.
2. Elle s'ouvrait alors sur l'écran des blocs (« Groupe d'entreprises »…) au lieu de votre entreprise.

## Ce qui change
1. **Écran de secours moins pressé.** Ce message apparaissait après 15 secondes si l'application n'avait pas fini de se charger, même si elle allait réussir un peu après. Maintenant : après 12 secondes, un simple message « Connexion lente — Compta+ continue de se charger, merci de patienter… », et l'écran « Connexion internet difficile » seulement si rien n'a démarré après une minute.
2. **Ouverture sans réseau : directement l'entreprise.** Quand l'application s'ouvre à partir de l'identité mémorisée (réseau absent ou trop faible), elle saute l'écran des blocs (Groupe, Centre de gestion), car il a besoin d'internet, et ouvre l'entreprise mémorisée. Avec une bonne connexion, rien ne change : vous retrouvez l'écran des blocs comme avant.
3. Numéro de version : **20260830-251**.

## Limite à connaître
Hors ligne, l'application rouvre **la dernière entreprise ouverte sur cet appareil avec internet**. Si vous avez ouvert en dernier une entreprise du groupe et que vous voulez travailler hors ligne sur l'entreprise sans groupe, ouvrez d'abord celle-ci une fois avec internet. Passer d'une entreprise à l'autre n'est possible qu'avec internet.

## Fichiers du paquet (4 fichiers)
| Dossier du paquet | Fichier | Où le déposer dans le dépôt | Action |
|---|---|---|---|
| racine | CARTE-DES-MODULES.md | à la racine | remplace |
| src | 00-config.jsx | dossier `src` | remplace |
| src | 12-application-principale.jsx | dossier `src` | remplace |
| src | index.modele.html | dossier `src` | remplace |

## Procédure pas à pas
### Étape 1 — Le fichier de la racine
1. Page d'accueil du dépôt **compta-plus-** → **Add file → Upload files**.
2. Glissez `CARTE-DES-MODULES.md`.
3. **Commit changes**.

### Étape 2 — Les fichiers du dossier `src`
1. Ouvrez le dossier **src** → **Add file → Upload files**.
2. Glissez les 3 fichiers du dossier `src` du paquet.
3. **Commit changes**. Une construction démarre (25 à 40 minutes). Ne redéposez rien pendant ce temps.

### Étape 3 — Attendre le vert
Onglet **Actions** : la dernière ligne « Construire le site » doit passer au **vert**. Si elle passe au rouge, ne touchez à rien et copiez-moi le texte de l'étape en échec.

### Étape 4 — Vérifier sur le site réel
1. **Ctrl + Maj + R** (sur téléphone : fermez complètement l'application puis rouvrez-la). Le numéro en bas du menu doit être **20260830-251**.
2. Avec une bonne connexion : ouvrez l'application, ouvrez votre entreprise sans groupe, travaillez normalement. L'écran des blocs apparaît comme avant.
3. Passez en mode avion (ou coupez le Wi-Fi), fermez complètement l'application et rouvrez-la : elle doit s'ouvrir directement sur l'entreprise, avec le bandeau « hors ligne », sans passer par l'écran des blocs.
4. Test réseau lent : réseau très faible, fermez et rouvrez l'application. Le message d'attente « Connexion lente… » peut apparaître, mais pas l'écran « Connexion internet difficile » avant une minute.
5. Dites-moi « v251 active sur PROD », ou ce qui cloche. Si le problème revient, notez l'heure, le type de connexion et ce que l'écran affichait.

## Ce que j'ai vérifié avant livraison
- Série automatique complète rejouée sur la version finale (la série « c1 » se vérifie à la construction automatique, comme avant).
- Je n'ai pas pu reproduire un vrai réseau lent sur un téléphone : le comportement du délai est vérifié en lisant le code et par les tests de démarrage, à confirmer à l'étape 4.

## CE QUI RESTE DE VOTRE RESSORT
**À faire maintenant**
- Déposer ce paquet sur le dépôt de production (étapes 1 et 2), attendre le vert, faire les vérifications de l'étape 4 et me dire « v251 active sur PROD ».

**Échéances et suivis**
- **Lundi 26 octobre** : vérifier la réception des e-mails de relance (Resend).
- Dans quelques jours : relancer le script 1 (journal) sur TEST et PROD ; garder le script 3 sous la main.

**Validations externes et démarches**
- Expert-comptable : document « Écarts fiscaux confirmés », crédit de TCA reporté, change (comptes 476/477), TCA sur l'abonnement logiciel.
- Relecture des documents juridiques par un avocat ; décision sur la sauvegarde à la minute ; récupération du 2FA ; compte MonCash de production ; choix des prestataires de test d'intrusion ; règle « période clôturée » encore en observation.
