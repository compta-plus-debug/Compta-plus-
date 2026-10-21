# Compta+ — version 243 — paquet TEST
**Chantier 9, étape 2 : retirer `unsafe-eval` et le script externe Tailwind**

À faire sur le dépôt **compta-plus--test** uniquement. Le paquet PROD viendra après votre « c'est validé ».

## Ce qui change (pour vous)
- Le site n'appelle plus aucun service extérieur pour son style : la feuille de style `tailwind.css` est fabriquée à la construction du site et hébergée avec lui.
- La politique de sécurité du site n'autorise plus l'exécution de code généré à la volée (`unsafe-eval`) : c'est une des premières choses qu'un test d'intrusion signale.
- Bonus : le mode hors ligne garde maintenant aussi le style (avant, il dépendait d'un service extérieur).
- Rien ne change visuellement ni dans les fonctions. Numéro de version : **20260830-243**.

## Fichiers du paquet (8 fichiers, dans 3 dossiers)
| Dossier du paquet | Fichier | Où le déposer dans le dépôt | Action |
|---|---|---|---|
| workflow | construire.yml | `.github/workflows/construire.yml` | remplace l'existant |
| racine | build.mjs | à la racine du dépôt | remplace |
| racine | tst-c1.cjs | à la racine | remplace |
| racine | tst-lancer.mjs | à la racine | remplace |
| racine | tst-s1.cjs | à la racine | **nouveau** |
| racine | tst-s2.cjs | à la racine | **nouveau** |
| src | 00-config.jsx | dossier `src` | remplace |
| src | index.modele.html | dossier `src` | **nouveau** |

Aucune migration SQL, aucune Edge Function : rien à faire côté Supabase.

## Procédure pas à pas

### Étape 1 — Le workflow (à faire en premier, seul)
1. Sur GitHub, ouvrez le dépôt **compta-plus--test**.
2. Cliquez sur le dossier `.github`, puis `workflows`, puis le fichier `construire.yml`.
3. Cliquez sur l'icône crayon (Edit this file).
4. Sélectionnez tout le contenu (Ctrl + A) et supprimez-le.
5. Ouvrez le fichier `workflow/construire.yml` de ce paquet, copiez tout son contenu et collez-le.
6. Cliquez sur **Commit changes…** puis **Commit changes** (message libre, par exemple « workflow v243 »).
Rien ne se construit à ce moment : c'est normal.

### Étape 2 — Les fichiers de la racine
1. Revenez à la page d'accueil du dépôt (nom du dépôt en haut).
2. **Add file → Upload files**.
3. Glissez les 5 fichiers du dossier `racine` du paquet : `build.mjs`, `tst-c1.cjs`, `tst-lancer.mjs`, `tst-s1.cjs`, `tst-s2.cjs`.
4. En bas : **Commit changes**. (GitHub remplace les 3 existants et ajoute les 2 nouveaux.)
Une construction démarre : elle réussit normalement, sans rien changer de visible (les nouveaux fichiers attendent la suite).

### Étape 3 — Les fichiers du dossier `src`
1. Dans le dépôt, cliquez sur le dossier **src**.
2. **Add file → Upload files**.
3. Glissez `00-config.jsx` et `index.modele.html` (dossier `src` du paquet).
4. **Commit changes**.
Une dernière construction démarre (environ 8 à 10 minutes).

### Étape 4 — Attendre le vert
1. Onglet **Actions** du dépôt : attendez que la dernière ligne « Construire le site » passe au **vert** (coche).
2. Si elle passe au **rouge** : ne touchez à rien, copiez-moi le texte de l'étape en échec ; le site publié reste celui d'avant (rien n'est publié tant que tout n'est pas vert).
3. Quand c'est vert, ouvrez le dossier `docs` du dépôt : vous devez voir un nouveau fichier **tailwind.css**.

### Étape 5 — Vérifier sur le site de test
1. Ouvrez le site de test et faites **Ctrl + Maj + R** (sur téléphone : fermez complètement l'application puis rouvrez-la).
2. Le numéro en bas du menu doit être **20260830-243**.
3. Regardez : couleurs, boutons, tableaux, menu — **tout doit être identique à avant**. Faites-le sur ordinateur et sur téléphone.
4. Testez : une facture en PDF, un export Excel, l'écran Super admin → Performances, et un écran lourd (Paie, Administration).
5. Test hors ligne : une fois la page chargée, coupez le Wi-Fi puis rechargez : la page doit s'ouvrir **avec son style**.
6. Dites-moi : « v243 validée en test », ou ce qui cloche (avec une capture si possible).

## Si quelque chose ne va pas
- Page sans style (tout en vrac) ou fonction cassée : dites-le-moi tout de suite avec une capture ; je prépare un correctif immédiat. Rien ne touche à vos données : seul l'habillage du site change.
- Construction rouge à cause du téléchargement de Tailwind : relancez-la (Actions → la construction → Re-run all jobs) ; sinon envoyez-moi le message.

## Ce que j'ai vérifié avant livraison
- 30 séries de tests automatiques réussies, dont 2 nouvelles :
  - la vraie page, avec la politique de sécurité appliquée sans `unsafe-eval` : aucune violation, PDF, Excel, QR, Supabase et React fonctionnent ;
  - aucune classe de style utilisée à l'écran ne manque dans la feuille générée.
- Régression complète : 63 séries à zéro échec.
- Captures d'écran de la page avec la feuille générée, sur ordinateur et téléphone : rendu normal.
