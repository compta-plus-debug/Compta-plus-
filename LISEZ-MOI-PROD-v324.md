# Compta+ v324 (PROD) — captcha Cloudflare Turnstile (gratuit) à la connexion

Remplace la v323 (hCaptcha). Le captcha est DÉSACTIVÉ tant que la clé est vide : rien ne change avant l'ÉTAPE 2. Version : 20261106-324.

## ÉTAPE 0 — Compte Cloudflare et clés (une seule fois, gratuit)
1. dash.cloudflare.com > Sign up (e-mail + mot de passe), confirmez l'e-mail. Aucun nom de domaine ni carte bancaire n'est demandé pour Turnstile.
2. Menu de gauche : « Turnstile » (ou Application security > Turnstile) > Add widget / Add site.
3. Nom : Compta+. Hostname Management : ajoutez comptaplus.app puis compta-plus-debug.github.io (sans https://).
4. Widget Mode : Managed. Create.
5. Cloudflare affiche 2 clés : « Site Key » (PUBLIQUE, vous pouvez me l'envoyer) et « Secret Key » (SECRÈTE, ne l'envoyez à personne ; elle va seulement dans Supabase). Copiez-les dans un endroit sûr.
Un seul widget sert pour TEST et PROD.

## ÉTAPE 1 — Mettre la version en ligne (PROD)
1. GitHub, dépôt Compta-plus- > dossier src : remplacez 00-config.jsx, 04-authentification.jsx et index.modele.html par ceux du zip (Add file > Upload files, mêmes noms, Commit).
2. À la racine du dépôt : remplacez tst-u58.cjs, tst-lancer.mjs, tst-fake.js. Commit.
3. Onglet Actions : attendez la coche verte. Rechargez fortement : version 20261106-324. La connexion est inchangée (pas de case).

## ÉTAPE 2 — Activer le captcha (PROD), dans CET ordre, jamais l'inverse
1. GitHub, dépôt Compta-plus- > src/00-config.jsx > crayon : ligne
   const CAPTCHA_SITEKEY = "";
   collez la Site Key entre les guillemets. Commit, attendez la coche verte, rechargez : la case anti-robot apparaît sur l'écran de connexion.
2. SEULEMENT ENSUITE : Supabase PROD (compta-plus-debug's Project) > Authentication > Attack Protection > « Enable Captcha protection », fournisseur « Turnstile by Cloudflare », collez la Secret Key, Save changes.
3. Essai : écran de connexion (comptaplus.app), cochez la case, demandez le lien : il arrive.
4. SI LA CONNEXION EST BLOQUÉE : désactivez le bouton Captcha dans Supabase (retour à la normale) et envoyez-moi le message affiché.

## Ce qui reste de votre côté
1. Étapes 0, 1, 2 sur TEST, validation, puis PROD.
2. v322 (2FA), fermer-acces-2.sql, étape 16 (SQL + moncash) si pas encore faits.
3. Pentest TEST : exports 1.3 et comptes 1.4. Procédures 2FA/clôture, expert-comptable, acomptes, juriste, pilotes, MonCash production, pentest externe/PITR.
