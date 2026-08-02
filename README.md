# Compta+ — ERP Comptabilité

Projet prêt à builder et déployer, avec base de données **partagée entre plusieurs utilisateurs** (comptes différents, mêmes données) et gestion des rôles.

## 1. Créer la base de données (gratuit, 2 minutes)

1. Créez un compte sur **https://supabase.com** (gratuit)
2. Créez un nouveau projet
3. Dans le tableau de bord du projet → **SQL Editor** → collez le contenu de **`supabase-schema-v2-multiuser.sql`** → **Run**
   (si vous aviez déjà exécuté l'ancien `supabase-schema.sql`, ce nouveau script le remplace — les nouvelles tables `companies` et `company_members` gèrent maintenant le partage et les rôles)
4. Allez dans **Project Settings → API**, notez :
   - la **Project URL**
   - la clé **anon public**
5. Ouvrez `src/supabase-config.js` et remplacez les deux valeurs par les vôtres

## 2. Installer et builder (nécessite Node.js)

```bash
npm install
npm run build
```

Cela crée un dossier `dist/` contenant le site statique complet.

## 3. Déployer sur Netlify

Glissez le dossier `dist/` sur **https://app.netlify.com/drop**, ou connectez ce dossier à un dépôt Git puis importez-le dans Netlify (`netlify.toml` est déjà configuré pour lancer `npm run build` automatiquement).

## 4. Se connecter, inviter son équipe et gérer les rôles

1. Ouvrez l'URL, connectez-vous avec votre email (lien magique, pas de mot de passe) — vous devenez automatiquement **Administrateur** de votre propre entreprise
2. Allez dans **Module 8 → Administration → Utilisateurs**
3. Invitez vos collègues par email avec le rôle voulu :
   - **Administrateur** : accès complet, y compris ce module
   - **Éditeur** : peut consulter et modifier toutes les données (comptabilité, ventes, stock...), mais pas accéder à l'administration
   - **Lecture seule** : peut tout consulter, mais aucun bouton d'ajout/modification/suppression n'est actif
4. Dès qu'une personne invitée se connecte avec l'email exact utilisé pour l'invitation, elle rejoint automatiquement votre entreprise et voit les **mêmes données**, avec les droits de son rôle

## Comment ça marche

- `src/storage-supabase.js` : résout automatiquement l'**entreprise** (company) de la personne connectée — soit une invitation en attente à son email, soit sa propre entreprise créée à la première connexion — et lit/écrit les données dans `kv_store`, scindées par entreprise (`company_id`), pas par utilisateur individuel
- `supabase-schema-v2-multiuser.sql` : crée `companies`, `company_members` (avec rôles) et fait passer `kv_store` en `company_id` ; la sécurité au niveau ligne (RLS) empêche un rôle **Lecture seule** d'écrire, même en contournant l'interface
- Côté interface, un rôle **Lecture seule** désactive tous les formulaires et boutons d'action (via un `<fieldset disabled>` englobant), et le **Module 8** est masqué pour tout rôle autre qu'Administrateur

## Notes

- La version « sans build » (déployée via Netlify Drop directement) ne supporte **pas** ce partage multi-utilisateurs : elle stocke tout localement sur l'appareil, sans notion de compte. Seule cette version (avec build + Supabase) le permet.
- Pour un déploiement continu (mise à jour automatique à chaque modification), connectez ce dossier à un dépôt Git (GitHub/GitLab) puis dans Netlify choisissez « Import from Git ».
