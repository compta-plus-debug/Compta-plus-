# Compta+ v314 (PROD) — correctif « écritures qui disparaissent / écarts qui alternent »

Correctif léger : 5 fichiers à remplacer, rien d'autre (aucune migration SQL, aucune Edge Function).

## Procédure
1. Décompressez le zip.
2. Dans le dépôt GitHub Compta-plus- : bouton « Add file » > « Upload files ».
3. Glissez le contenu du dossier `src` dans le dossier `src/` du dépôt (2 fichiers : 00-config.jsx, 12-application-principale.jsx). Attention : si votre dépôt les garde dans `src/parties/`, déposez-les là où se trouvent déjà les fichiers du même nom.
4. Glissez le contenu du dossier `racine` à la racine du dépôt (3 fichiers : tst-fake.js, tst-u46.cjs, tst-lancer.mjs).
5. Message de commit : « v314 correctif synchronisation » puis « Commit changes ».
6. Onglet Actions : attendez la coche verte (≈ 35-40 min). Si rouge, copiez-moi le journal.
7. Rechargez l'application en forçant (Ctrl+Maj+R) ; la version affichée doit être 20261102-314.

## Vérification
Saisissez rapidement 6-10 clients ou écritures à la suite : tout doit rester à l'écran, et « Cohérence et facturation » ne doit plus alterner.

## Ce qui reste de votre ressort
1. Déposer ce correctif (TEST d'abord, puis PROD) et confirmer ; confirmer aussi que le correctif u44 de v313 a donné un build vert.
2. Demander à l'utilisateur concerné de recharger, puis de contrôler ses clients à 0 HTG : si un client reste à 0, envoyez-moi une capture (cela viendrait alors d'une saisie, pas de la synchronisation).
3. Test d'intrusion phase 1 (parité TEST/PROD, comptes d'essai).
4. Adopter les procédures 2FA et clôture de période (imprimer les codes de secours du Super Admin en 2 exemplaires).
5. Validation par un expert-comptable (comptes des secteurs, fonds ONG, clôtures) avant d'activer Agriculture/ONG/Services chez de vrais clients.
6. Échéances DGI : retenues 1-15 nov, acomptes 1-15 déc ; question fiscale acomptes 60 %/2 vs 75 %/3.
7. Juriste : reçus fiscaux, CGU/confidentialité, TCA sur abonnements.
8. Clients pilotes, témoignages, vidéos ; MonCash production et scénario de prix (peut attendre) ; pentest externe et PITR (facultatif).
