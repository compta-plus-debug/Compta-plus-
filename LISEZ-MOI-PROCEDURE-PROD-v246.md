# Compta+ — version 246 — paquet PROD
**Mise à jour fiscale : nouveau barème d'impôt sur le revenu, NIF et mention de franchise sur les factures, retenue sur les primes**

À faire sur le dépôt **compta-plus-** uniquement. À faire après validation du paquet TEST. Aucune migration SQL, aucune Edge Function : rien à faire côté Supabase. Pas de changement du workflow.

Ce paquet **contient aussi** les versions précédentes non encore déployées (v244 panier conservé, v245 ouverture sans internet avec code PIN) : si elles sont déjà en place, les fichiers sont simplement remplacés, sans risque.

## Ce qui change (pour vous)
Ces règles viennent de la presse haïtienne et d'une note du ministère des Finances sur le **nouveau Code fiscal en vigueur depuis le 1er octobre 2026**. Le texte officiel n'a pas encore pu être consulté : l'application garde son avertissement « règles fiscales en cours de validation », et chaque réglage affiche qu'il doit être confirmé par votre expert-comptable.
1. **Impôt sur le revenu (Rapports → Déclarations fiscales → Impôt sur le Revenu, régime Réel)** : un sélecteur « Barème appliqué » propose le **nouveau barème** (0 % jusqu'à 360 000 ; 12 % jusqu'à 540 000 ; 18 % jusqu'à 1 080 000 ; 25 % jusqu'à 2 160 000 ; 30 % au-delà) et l'**ancien** (0 % jusqu'à 60 000, puis 10, 15, 25, 30 %). Par défaut : nouveau pour l'année 2026 et suivantes, ancien avant. Votre choix manuel prime toujours.
2. **NIF du vendeur sur les factures** : affiché sous l'adresse, sur la facture A4 (PDF et impression), le ticket (PDF et impression) et le ticket Bluetooth, dès que le NIF est renseigné dans Administration.
3. **Franchise de TCA** (Administration → informations de l'entreprise) : une case à cocher pour les entreprises dont le chiffre d'affaires est inférieur à 10 millions de HTG. Cochée, la TCA n'est plus facturée en caisse et la facture porte la mention « TCA non applicable - article 193 du CGI ». **Décochée par défaut** : rien ne change pour les entreprises existantes.
4. **Retenue d'impôt sur les primes (Salaires → Bulletins de paie)** : dès qu'une prime est saisie, une case « Retenir l'impôt sur la prime » apparaît, à **15 %** (modifiable, décochable). Le montant est déduit du net, enregistré sur le bulletin et placé avec les retenues à verser (compte 431), à reverser à la DGI avant le 15 du mois suivant.
5. Numéro de version : **20260830-246**.

## Fichiers du paquet (15 fichiers)
| Dossier du paquet | Fichier | Où le déposer dans le dépôt | Action |
|---|---|---|---|
| racine | tst-lancer.mjs | à la racine | remplace |
| racine | tst-t1.cjs, tst-t2.cjs | à la racine | nouveaux si les versions 244 et 245 ne sont pas déposées, sinon remplacent |
| racine | tst-u1.cjs | à la racine | **nouveau** |
| racine | CARTE-DES-MODULES.md | à la racine | remplace |
| src | 00-config.jsx | dossier `src` | remplace |
| src | 02-mode-hors-ligne.jsx | dossier `src` | remplace |
| src | 07-constantes-metier.jsx | dossier `src` | remplace |
| src | 10-formatage-impression-et-pdf.jsx | dossier `src` | remplace |
| src | 12-application-principale.jsx | dossier `src` | remplace |
| src | 23-vente.jsx | dossier `src` | remplace |
| src | 27-paie.jsx | dossier `src` | remplace |
| src | 28-declarations-fiscales.jsx | dossier `src` | remplace |
| src | 39-administration-module.jsx | dossier `src` | remplace |
| src | index.modele.html | dossier `src` | remplace |

## Procédure pas à pas
### Étape 1 — Les fichiers de la racine
1. Page d'accueil du dépôt **compta-plus-** → **Add file → Upload files**.
2. Glissez les 5 fichiers du dossier `racine` : `tst-lancer.mjs`, `tst-t1.cjs`, `tst-t2.cjs`, `tst-u1.cjs`, `CARTE-DES-MODULES.md`.
3. **Commit changes**. (Une construction démarre, sans changement visible : normal.)

### Étape 2 — Les fichiers du dossier `src`
1. Ouvrez le dossier **src** → **Add file → Upload files**.
2. Glissez les 10 fichiers du dossier `src` du paquet.
3. **Commit changes**. Une construction démarre (environ 8 à 10 minutes).

### Étape 3 — Attendre le vert
Onglet **Actions** : la dernière ligne « Construire le site » doit passer au **vert**. Si elle passe au rouge, ne touchez à rien et copiez-moi le texte de l'étape en échec : rien n'est publié tant que tout n'est pas vert.

### Étape 4 — Vérifier sur le site de production
1. **Ctrl + Maj + R** (sur téléphone : fermez complètement l'application puis rouvrez-la). Le numéro en bas du menu doit être **20260830-246**.
2. **Barème** : Rapports et analyse → Déclarations fiscales → Impôt sur le Revenu → Réel. Saisissez un revenu global de 600 000 pour l'année 2026 : impôt brut **32 400**. Choisissez « Ancien barème » : impôt brut **84 000**.
3. **NIF** : dans Administration, renseignez le NIF, enregistrez. Faites une vente, ouvrez la facture en PDF et à l'impression : « NIF : … » apparaît sous l'adresse.
4. **Franchise** (sur une entreprise de test uniquement) : cochez la case dans Administration, enregistrez, faites une vente : aucune TCA n'est ajoutée et la mention « TCA non applicable - article 193 du CGI » figure sur la facture. Décochez ensuite.
5. **Prime** : Salaires → Bulletins de paie, choisissez un employé, saisissez une prime de 2 000 : retenue de 300 (15 %), net réduit de 300. Changez le taux ou décochez : le net suit.
6. Dites-moi « v246 validée », ou ce qui cloche (avec une capture si possible).

## À savoir
- Ces règles restent à **faire confirmer par votre expert-comptable** avec le texte officiel du Code (Moniteur, numéro spécial 48-A du 30 septembre 2026). Si le texte officiel diffère, je corrige sur-le-champ.
- Le taux de 30 % de l'impôt sur les sociétés et les anciennes retenues à la source (services, loyers, etc.) ne sont **pas** calculés : ils attendent le texte officiel.
- Un article de presse conteste le fait que le Code ait été adopté par décret. Il s'applique aujourd'hui, mais restez attentif.

## Ce que j'ai vérifié avant livraison
- Nouveau test automatique dédié (20 contrôles) : les deux barèmes (32 400 et 84 000 pour 600 000), le choix par défaut selon l'année, le NIF et la mention de franchise sur la facture imprimée, la présence de l'option dans l'administration, la retenue de 15 % sur prime (300 sur 2 000, net 11 700), le taux modifiable, la case décochée.
- 32 des 33 séries automatiques réussies ; la 33e (« c1 », politique de sécurité) lit le site construit et se vérifie à la construction automatique, comme pour les versions précédentes.
