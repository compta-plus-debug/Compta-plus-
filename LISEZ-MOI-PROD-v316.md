# Compta+ v316 (PROD) — Réinitialisation fiable, ventes atomiques, réparation, catalogue sans doublon

Ce paquet est **cumulatif depuis la v313** : il remplace les paquets v314 et v315 (leurs correctifs sont inclus).

## Ce que cette version corrige
1. **Réinitialisation qui ne tenait pas d'un appareil à l'autre** (téléphone puis ordinateur) :
   - la réinitialisation remplace maintenant le serveur tel quel (même ce qu'un autre appareil y avait ajouté) et pose un **marqueur de réinitialisation** ;
   - un appareil resté ouvert avec d'anciennes données reconnaît le marqueur, adopte l'état réinitialisé et **n'écrit rien par-dessus** : les données ne reviennent plus ;
   - les modifications hors ligne antérieures à une réinitialisation sont abandonnées au lieu de ressusciter les données.
2. **Remise à niveau au retour sur l'application** (onglet qui redevient visible, réseau revenu, toutes les 5 minutes) : un appareil resté en veille récupère ce qui a été supprimé ou modifié ailleurs avant de pouvoir le re-sauvegarder. Seules les catégories sans modification locale en attente sont touchées.
3. « **Sauvegarder maintenant** » et les nouvelles tentatives couvrent désormais aussi les blocs de secteur (restauration, hôtellerie, transport, immobilier, BTP, industrie, agriculture, ONG, services), oubliés auparavant.
4. **Facture et écriture enregistrées ensemble** (fonction SQL, tout ou rien) + **réparation en un clic** des écritures manquantes (Comptabilité > Journal > Cohérence Facturation ↔ Journal).
5. **Catalogue sans doublon** (même nom ou même code = refus, sans tenir compte des majuscules, accents, espaces), contrôles du formulaire article, plafond de quantité, avertissement avant suppression d'un article encore en stock, messages d'alerte qui ne disparaissent plus trop tôt.
6. Écho de synchronisation de nos propres sauvegardes (écritures et clients qui disparaissaient puis revenaient).

## PROCÉDURE COMPLÈTE — TEST d'abord, puis PROD

### Étape 1 — Installer la fonction côté base (Supabase) — projet cnmmxpwlgovzbcfqaxqm
1. Ouvrez https://supabase.com/dashboard et connectez-vous.
2. Cliquez sur le projet dont l'adresse de page contient `/project/cnmmxpwlgovzbcfqaxqm`.
3. Menu de gauche : **SQL Editor** > **New query**.
4. Ouvrez `supabase/ventes-atomiques.sql` avec le Bloc-notes, **Ctrl+A**, **Ctrl+C**, collez dans l'éditeur, cliquez **Run**.
5. Résultat attendu : une ligne `commit_sale_documents`. Aucune donnée n'est modifiée. Si vous avez déjà exécuté ce fichier pour la v315, **relancez-le** : cette version le met à jour (le marqueur de réinitialisation est conservé) sans effet sur vos données.
6. Message rouge : ne touchez à rien d'autre, envoyez-moi une capture.

### Étape 2 — Déposer les fichiers dans GitHub — dépôt Compta-plus-
1. Décompressez le zip.
2. Dépôt **Compta-plus-** > **Add file** > **Upload files**.
3. Contenu du dossier `src` du zip : glissez-le dans le dossier **src/** du dépôt (mêmes noms de fichiers que ceux qui existent déjà).
4. Contenu du dossier `racine` du zip : glissez-le **à la racine** du dépôt.
5. Dossier `supabase` : conservez-le dans **supabase/** (archivage).
6. Message de commit : « v316 reinitialisation fiable » > **Commit changes**.
7. Onglet **Actions** : attendez la coche verte (≈ 45 min). Si rouge, copiez-moi le journal.
8. Rechargez en forçant (**Ctrl+Maj+R**). Version attendue : **20261102-316**.

### Étape 3 — Vérifier sur TEST (10 minutes, avec deux appareils ou deux navigateurs)
1. Connectez le même compte TEST sur le téléphone et sur l'ordinateur.
2. Sur le téléphone : **Administration > Données > Réinitialiser…** > « Tout cocher (complète) » > confirmer.
3. Sur l'ordinateur (sans recharger) : cliquez sur « Sauvegarder maintenant ». Un message indique que les données ont été réinitialisées depuis un autre appareil, et l'écran se vide. Rechargez : toujours vide.
4. Faites une vente : l'écriture apparaît dans le Journal, « Cohérence » indique « aucun écart détecté ».

### Retour arrière
Supabase > SQL Editor : `supabase/ventes-atomiques-RETOUR-ARRIERE.sql` > Run. L'application retombe sur l'ancienne méthode de vente.

## Limites connues (à savoir)
- Un appareil resté **hors ligne** puis reconnecté après une réinitialisation adopte l'état réinitialisé : ses modifications hors ligne antérieures sont abandonnées (volontaire, pour que rien ne ressuscite).
- Les **sauvegardes** (copie « avant réinitialisation » de l'appareil, sauvegardes serveur) ne sont pas supprimées par la réinitialisation : ce sont des filets de sécurité, qui ne reviennent jamais d'eux-mêmes. Elles ne servent qu'à une restauration que vous décidez.
- La fonction serveur de stock existante (`commit_sale_stock`) peut effacer le marqueur de réinitialisation de la catégorie « produits » lors d'une vente ; sans conséquence sur la réinitialisation elle-même.

## Documents
Tous les documents (procédures, guide du test d'intrusion, suivi) sont réunis dans le document « Compta+ — Bibliothèque des documents et suivi » (liste des Artifacts de claude.ai).

## Ce qui reste de votre ressort
1. Déposer cette version (TEST puis PROD, SQL d'abord) et me confirmer le build vert et la version 316.
2. Test d'intrusion : suivre le guide pas à pas (phase 1, puis scripts A, B, C).
3. Adopter les procédures 2FA et de clôture ; imprimer les codes de secours du Super Admin en 2 exemplaires.
4. Expert-comptable : valider les comptes des secteurs, les fonds ONG, les clôtures — avant d'activer Agriculture/ONG/Services chez de vrais clients.
5. Fiscal : acomptes 60 %/2 ou 75 %/3 ; DGI : acomptes du 1er au 15 décembre.
6. Juriste : reçus fiscaux, CGU/confidentialité, TCA sur abonnements.
7. Clients pilotes, témoignages, vidéos ; MonCash et prix (peut attendre) ; pentest externe et PITR (facultatif).
