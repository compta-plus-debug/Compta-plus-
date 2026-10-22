# Compta+ — version 250 — paquet PROD
**Correctif : ouverture de l'application avec une connexion internet très faible**

À faire sur le dépôt **compta-plus-** uniquement. Aucune migration SQL, aucune Edge Function : rien à faire côté Supabase. Pas de changement du workflow.

**Prérequis** : la version 249 doit être déposée sur ce dépôt. Si elle ne l'est pas encore, déposez d'abord le paquet v249, puis celui-ci.

## Le problème
Avec une connexion très mauvaise (réseau « connecté » mais qui ne répond presque pas), l'application ouvrait l'écran « Connexion refusée — Utilisateur non connecté — Se déconnecter et réessayer ». C'était une erreur : vous n'étiez pas déconnecté, le réseau ne répondait simplement pas.

## Ce qui change
1. **Appareil déjà ouvert en ligne** (cas courant) : avec un réseau trop faible, l'application s'ouvre maintenant directement avec l'identité mémorisée (mode hors ligne), comme lorsque internet est coupé. Le code PIN reste exigé s'il a plus de 7 jours.
2. **Appareil jamais ouvert, ou PIN trop ancien** : l'écran affiche « Connexion internet instable — nouvelle tentative automatique… » et réessaie tout seul (au retour du réseau et toutes les 15 secondes). L'écran « Connexion refusée » n'apparaît plus pour un simple problème de réseau. Il reste réservé aux vrais refus (compte non invité, essai déjà utilisé, etc.).
3. Numéro de version : **20260830-250**.

## Fichiers du paquet (8 fichiers)
| Dossier du paquet | Fichier | Où le déposer dans le dépôt | Action |
|---|---|---|---|
| racine | tst-lancer.mjs | à la racine | remplace |
| racine | tst-fake.js | à la racine | remplace |
| racine | tst-u5.cjs | à la racine | **nouveau** |
| racine | CARTE-DES-MODULES.md | à la racine | remplace |
| src | 00-config.jsx | dossier `src` | remplace |
| src | 03-session-et-appartenance.jsx | dossier `src` | remplace |
| src | 12-application-principale.jsx | dossier `src` | remplace |
| src | index.modele.html | dossier `src` | remplace |

## Procédure pas à pas
### Étape 1 — Les fichiers de la racine
1. Page d'accueil du dépôt **compta-plus-** → **Add file → Upload files**.
2. Glissez les 4 fichiers du dossier `racine`.
3. **Commit changes**.

### Étape 2 — Les fichiers du dossier `src`
1. Ouvrez le dossier **src** → **Add file → Upload files**.
2. Glissez les 4 fichiers du dossier `src` du paquet.
3. **Commit changes**. Une construction démarre (25 à 40 minutes avec toutes les séries de tests).

### Étape 3 — Attendre le vert
Onglet **Actions** : la dernière ligne « Construire le site » doit passer au **vert**. Si elle passe au rouge, ne touchez à rien et copiez-moi le texte de l'étape en échec. Ne redéposez pas pendant qu'une construction tourne.

### Étape 4 — Vérifier sur le site réel
1. **Ctrl + Maj + R** (sur téléphone : fermez complètement l'application puis rouvrez-la). Le numéro en bas du menu doit être **20260830-250**.
2. Ouvrez l'application normalement avec une bonne connexion : tout fonctionne comme avant.
3. Test du correctif, sur téléphone : après avoir ouvert l'application une fois avec une bonne connexion, passez dans un endroit à mauvais signal (ou activez le mode « réseau lent » / alternez le Wi-Fi). Fermez l'application complètement puis rouvrez-la : elle doit s'ouvrir (éventuellement avec le bandeau « hors ligne »), sans l'écran « Connexion refusée ».
4. Dites-moi « v250 validée » (ou « v250 active sur PROD »), ou ce qui cloche. Si le problème persiste, notez l'heure exacte et le type de connexion (Wi-Fi, 4G), cela m'aide à retrouver la trace.

## À savoir
- Le test à mauvais signal n'est pas toujours reproductible à la demande : si vous ne le reproduisez pas, ce n'est pas grave, le test automatique du cas a été ajouté.
- Les données saisies hors ligne restent gardées sur l'appareil et se synchronisent au retour du réseau (fonctionnement inchangé).

## Ce que j'ai vérifié avant livraison
- Nouveau test automatique (4 contrôles) : réseau défaillant sur un appareil connu (l'application s'ouvre) et sur un appareil inconnu (message d'attente, jamais « Connexion refusée »).
- Série automatique complète rejouée (la série « c1 » se vérifie à la construction automatique, comme avant).

## CE QUI RESTE DE VOTRE RESSORT
**À faire maintenant**
- Déposer ce paquet (étapes 1 et 2), attendre le vert, tester et me répondre.
- La v249 : si elle n'est pas encore sur PROD, la déposer (paquet PROD-v249) avant ce correctif.

**Échéances et suivis**
- **Lundi 26 octobre** : vérifier la réception des e-mails de relance (Resend).
- Dans quelques jours : relancer le script 1 (journal) sur TEST et PROD ; garder le script 3 sous la main.

**Validations externes et démarches**
- Expert-comptable : document « Écarts fiscaux confirmés », crédit de TCA reporté, change (comptes 476/477), TCA sur l'abonnement logiciel.
- Relecture des documents juridiques par un avocat ; décision sur la sauvegarde à la minute ; récupération du 2FA ; compte MonCash de production ; choix des prestataires de test d'intrusion ; règle « période clôturée » encore en observation.
