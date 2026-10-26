# Compta+ — RETOUR à la version 277 sur PROD (dépôt Compta-plus-)
Annule le dépôt par erreur de la v278 (paquet TEST) sur la production. **Aucun script SQL, aucune Edge Function.** Vos données ne sont pas touchées.

**Important :** remettre les fichiers de la v277 ne supprime pas les fichiers que la v278 a AJOUTÉS (`58-restauration.jsx` et `tst-u28.cjs`). Ils doivent être supprimés à la main (étape 3), sinon la construction peut échouer. Ce paquet contient aussi les fichiers `build.mjs` et `tst-n1.cjs` de la v277 : sans eux, la construction de PROD échouerait.

Ce paquet a été essayé de mon côté : construction PROD réussie en version 20260830-277, tests n1 et u27 réussis.

## Fichiers du paquet (13 fichiers)
| Dossier du paquet | Fichier | Où le déposer | Action |
|---|---|---|---|
| racine | tst-n1.cjs | racine du dépôt | remplace |
| racine | tst-lancer.mjs | racine du dépôt | remplace |
| racine | CARTE-DES-MODULES.md | racine du dépôt | remplace |
| build | build.mjs | dossier `build` | remplace |
| src | 00-config.jsx, 06-icones-et-graphiques.jsx, 07-constantes-metier.jsx, 12-application-principale.jsx, 17-compta-assistant-de-controle.jsx, 38-administration-stock-et-sauvegardes.jsx, 39-administration-module.jsx, 50-secteurs-et-blocs.jsx, 57-assistant-blocs.jsx | dossier `src` | remplace (9 fichiers) |

## Procédure pas à pas (dépôt **Compta-plus-** uniquement)
### Étape 1 — Supabase
Rien à faire.
### Étape 2 — Déposer les fichiers
1. Racine du dépôt → **Add file → Upload files** → les 3 fichiers du dossier `racine` → **Commit changes**.
2. Dossier **build** → **Add file → Upload files** → `build.mjs` → **Commit changes**.
3. Dossier **src** → **Add file → Upload files** → les 9 fichiers → **Commit changes**. (Une construction démarre : laissez-la passer ou être remplacée par la suivante.)
### Étape 3 — Supprimer les 2 fichiers ajoutés par la v278 (À FAIRE EN DERNIER)
1. Dossier **src** → cliquez sur `58-restauration.jsx` → icône **corbeille** (Delete file) en haut à droite → **Commit changes**.
2. Racine du dépôt → cliquez sur `tst-u28.cjs` → corbeille → **Commit changes**.
(Chaque suppression relance une construction ; seule la dernière va au bout.)
### Étape 4 — Attendre le vert, puis vérifier
Onglet **Actions** : « Construire le site » au **vert**. Puis **Ctrl + Maj + R** : version **20260830-277** en bas du menu. Le secteur « Restauration et hôtellerie » n'est plus proposé dans le choix des secteurs.
Si la construction est rouge, copiez-moi les lignes ÉCHEC / FAIL.

## CE QUI RESTE DE VOTRE RESSORT
- Faire les 3 étapes ci-dessus, puis me dire « PROD revenue en v277 ».
- Déposer le paquet **TEST v278** sur compta-plus--test (et là seulement), le tester, puis me dire « v278 validée ».
- Avant le 31 octobre 2026 : liste annuelle des versements. 1–15 novembre : retenues d'octobre. 1–15 décembre : acomptes provisionnels.
- Décisions en attente : hôtellerie v279 (chambres, tarifs, taxe de séjour, acompte), PITR, récupération 2FA, compte MonCash de production, tests d'intrusion, règle « période clôturée », prix « Équilibré ».
