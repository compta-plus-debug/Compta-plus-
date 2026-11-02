# Correctif v313 — un seul fichier

**Cause du rouge** : le test `tst-u44.cjs` cherchait le modèle de page dans `src/parties/`, alors que sur GitHub le fichier est `src/index.modele.html`. **L'application elle-même n'est pas en cause** : tous les autres tests, dont celui du nouveau bloc Services (u45), sont verts.

## Procédure
1. Dépôt **Compta-plus-** → **Add file → Upload files** → glissez `tst-u44.cjs` (à la **racine** du dépôt, il remplace l'ancien) → **Commit changes**.
2. Faites la même chose sur **compta-plus--test** (même fichier) si vous y avez déposé la v313.
3. Attendre 25 à 40 minutes ; **Actions** → « Construire le site » doit passer au **vert**. Si rouge, copiez-moi les lignes ÉCHEC / FAIL.

Rien d'autre à déposer. Version affichée : **20261102-313**.
