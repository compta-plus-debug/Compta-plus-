# Compta+ v319 (inclut v317 et v318)

## Ce que contient cette version
1. **Historique des ventes dans une carte** (écran Vente) : carte blanche avec bordure, compteur de ventes, bouton Masquer/Afficher. Il n'est plus posé « sur le fond » de l'écran.
2. **Champs de texte sur téléphone** : la page bloquait tout geste horizontal au toucher (réglage « touch-action: pan-y »), ce qui empêchait de faire glisser le texte dans un champ pour atteindre la lettre à corriger. Dès qu'un champ de texte est actif, le glissement horizontal est maintenant libre. Test : le réglage change bien au focus ; je n'ai pas pu essayer sur un vrai téléphone.
3. **Réinitialisation** (v317) : la file des ventes hors ligne est vidée et les ventes mises en attente avant la réinitialisation sont écartées.
4. **Catalogue conservé** (v318) : toutes les quantités du catalogue repassent à zéro.

SQL : aucun changement (ne relancez rien dans Supabase).

## Procédure (TEST d'abord, puis PROD)
1. Décompressez le zip. Dossier `src` -> à copier dans `src/` du dépôt (remplacer les fichiers, y compris index.modele.html). Dossier `racine` -> à copier à la racine du dépôt.
2. GitHub : Add file -> Upload files, glissez le contenu, message « v319 », Commit directement sur main.
3. Onglet Actions : attendez la coche verte.
4. Rechargez l'app avec Ctrl+Maj+R (sur téléphone : fermez et rouvrez l'onglet). La version affichée doit être **20261104-319**.
5. Vérifiez : Vente -> en bas, la carte « Historique des ventes » ; sur téléphone, touchez un champ de texte long, puis faites glisser le texte vers la gauche ou la droite et corrigez une lettre.

## Test effectué
Navigateur : test u54 (carte, repli, réglage de défilement) et u52/u53. La suite complète tourne : ne passez en PROD qu'après la coche verte sur TEST.
