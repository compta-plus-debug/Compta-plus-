# Compta+ v320 — projet PRODUCTION

## Ce que contient cette version
1. **Code de sécurité (PIN) : message clair.** Après un mauvais code, l'écran dit combien d'essais restent (« Il vous reste 3 essais avant un blocage de 15 minutes »). Au 5e échec, il explique que le blocage est voulu et ce n'est pas une panne, indique la durée, désactive le bouton « Valider » et n'envoie plus rien au serveur pendant ce temps.
2. **Messagerie interne de l'équipe** : fils de discussion entre les collaborateurs du Centre de gestion et l'administrateur de la plateforme (signalement, consigne ou question ; priorité normale ou haute ; destinataire facultatif ; lu / non lu avec compteur sur l'onglet ; clôture d'un fil). Les messages ne se modifient ni ne se suppriment. Où : Super Admin -> groupe « Équipe » -> Messagerie interne ; Centre de gestion -> groupe « Équipe » -> Messagerie interne.
3. **Procédures (accès réservé)** : récupération de l'accès 2FA (7 étapes, délai de 24 h imposé par l'application, 72 h si un signal d'alerte est coché, modèles de messages copiables), contrôles avant clôture d'une période (11 contrôles) et réouverture exceptionnelle (conditions et motif obligatoire). Chaque procédure se lit puis s'exécute sur une fiche : étapes cochées avec le nom et l'heure, registre non supprimable. Où : Super Admin -> Équipe -> Procédures. Dans le Centre de gestion, l'onglet n'apparaît que pour les collaborateurs à qui l'administrateur coche « Procédures (2FA, clôtures) » (Équipe -> Collaborateurs).

## Procédure complète (TEST d'abord)
### A. Base de données Supabase (à faire AVANT de déposer les fichiers)
1. https://supabase.com/dashboard -> projet **TEST** (adresse contenant cnmmxpwlgovzbcfqaxqm). Vérifiez le nom en haut à gauche.
2. Menu **SQL Editor** -> **New query**.
3. Ouvrez le fichier `supabase/v320-messagerie-procedures-pin.sql`, copiez tout, collez-le dans l'éditeur, cliquez **Run**. Résultat attendu : « Success. No rows returned ».
4. En cas de problème : exécutez `supabase/annulation-v320.sql` (supprime les nouvelles tables) puis écrivez-moi le message exact.

### B. Fichiers de l'application
1. Décompressez le zip. Dossier `src` -> à copier dans `src/` du dépôt (remplacer les fichiers). Dossier `racine` -> à copier à la racine du dépôt.
2. GitHub : dépôt PROD -> Add file -> Upload files, glissez le contenu, message « v320 », Commit directement sur main.
3. Onglet Actions : attendez la coche verte.
4. Rechargez l'app avec Ctrl+Maj+R (téléphone : fermez et rouvrez l'onglet). La version affichée doit être **20261104-320**.

### C. Vérifications
1. **PIN** (entreprise avec code de sécurité) : saisissez 2 mauvais codes -> « Il vous reste 3 essais… ». Saisissez-en 5 -> message de blocage, bouton grisé. Le bon code ne marche plus pendant 15 minutes, puis refonctionne.
2. **Messagerie** : Super Admin -> Équipe -> Messagerie interne -> Nouveau fil, destiné à un collaborateur. Connectez-vous avec ce collaborateur (navigation privée) : l'onglet affiche (1), il lit et répond ; revenez côté Super Admin : (1) de nouveau. Clôturez le fil.
3. **Procédures** : Super Admin -> Équipe -> Procédures -> « Lire la règle » (2FA), puis « Ouvrir une fiche » avec une entreprise fictive : vérifiez que la réinitialisation est refusée avant la fin du délai, puis clôturez la fiche comme « Tentative suspecte » avec une remarque.
4. **Droit Procédures** : Centre de gestion -> Équipe -> Collaborateurs -> cochez « Procédures (2FA, clôtures) » pour un collaborateur de test : son onglet Procédures apparaît.

## Ce qui reste de votre côté
1. SQL v320 sur TEST, fichiers, vérifications ci-dessus ; puis la même chose sur PROD (paquet PROD).
2. Désigner par écrit l'agent de vérification 2FA et le second validateur, puis imprimer les codes de secours du Super Admin en deux exemplaires dans deux lieux distincts.
3. Pentest : suivre le guide (scripts A, B, C sur TEST), voir le message de livraison.
4. Validation par l'expert-comptable et le juriste (inchangé).

## Test effectué
Navigateur : tests u55 (PIN) et u56 (messagerie, procédures, droits du Centre de gestion, tables absentes). La suite complète tourne : l'avoir validée sur TEST d'abord.
