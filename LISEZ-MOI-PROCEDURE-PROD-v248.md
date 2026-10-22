# Compta+ — version 248 — paquet PROD (complet)
**Alignement sur le texte officiel du Code fiscal (Moniteur spécial 48-A du 30 septembre 2026)**

À faire sur le dépôt **compta-plus-** uniquement. Version validée sur le site de test. Aucune migration SQL, aucune Edge Function : rien à faire côté Supabase. Pas de changement du workflow.

**Ce paquet est complet** : il regroupe aussi les versions 244 (panier conservé), 245 (ouverture sans internet avec code PIN), 246 (nouveau barème, NIF, franchise, primes) et 247 (bouton « Vider le panier »). Que ces versions soient déjà déposées ou non, déposez simplement tous les fichiers : ceux qui existent déjà sont remplacés sans risque.

J'ai lu le Code fiscal officiel que vous m'avez fourni. Il corrige plusieurs points que j'avais déduits de la presse.

## Ce qui change (pour vous)
1. **Retenue sur primes (Salaires → Bulletins de paie)** — article 103 : un choix « Prime ou autre rémunération (15 %) » ou « Boni (10 %) ». Le taux se règle tout seul selon le choix et reste modifiable. Le versement à la DGI se fait entre le 1er et le 15 du mois suivant, avec un état explicatif.
2. **Retenue d'impôt sur le salaire (même écran)** — articles 100 et 132 : pour les salaires mensuels supérieurs à 30 000 HTG, une case « Retenir l'impôt sur le salaire (1/12 de l'impôt annuel) » apparaît avec le montant calculé. Elle est **décochée par défaut** : vous décidez, avec votre expert-comptable, quand l'activer.
3. **Régime forfaitaire (Rapports → Déclarations fiscales → Impôt sur le Revenu)** — articles 62 à 66 : seuil de **10 millions de HTG** de chiffre d'affaires de l'exercice précédent, abattement d'**un million**, taux de **5 %** pour les services ou **2 %** pour les autres activités (choix à l'écran), impôt **minimum de 25 000 HTG**, déclaration et paiement avant le 31 octobre. Les anciennes valeurs (2,5 millions, 500 000, 1 %, 10 000) sont retirées.
4. **Impôt sur les sociétés (même écran, régime Réel)** — article 137 : un choix « Type de contribuable » : personne physique (barème de l'article 132), société (**30 %**) ou coopérative d'épargne et de crédit (**10 %**). Avant, les sociétés recevaient à tort le barème des personnes physiques.
5. **Déclaration TCA** — articles 186 et 190 : la TCA est de 10 % sans abattement ni minimum dans le Code. Les deux champs (abattement, minimum) restent à zéro par défaut et modifiables si la DGI exigeait un montant. Attention : la TCA déductible sur vos achats (article 187) n'est pas encore déduite dans cette déclaration.
6. **Facture A4 (article 191)** — le **taux de TCA appliqué** s'affiche à côté du montant de la TCA, et une zone « **Visa de l'entreprise et signature** » est ajoutée (PDF et impression). L'article 191 ne demande pas le NIF sur la facture : celui-ci reste affiché quand il est renseigné, c'est utile mais pas obligatoire.
7. **Franchise de TCA** : le texte de la case dans Administration cite maintenant l'article 193 et rappelle que facturer la TCA à tort en rend redevable.
8. Numéro de version : **20260830-248**.

## Contenu en plus (versions 244 à 247)
- **Panier** : conservé quand on change de module ; bouton rouge « Vider » en haut du panier.
- **Mode hors ligne** : une entreprise protégée par un code PIN s'ouvre sans internet pendant 7 jours après une saisie du code avec internet sur l'appareil.
- **Fiscalité** : nouveau barème d'impôt sur le revenu (article 132), NIF affiché sur les factures, case de franchise de TCA (article 193), retenue sur primes.

## Fichiers du paquet (16 fichiers)
| Dossier du paquet | Fichier | Où le déposer dans le dépôt | Action |
|---|---|---|---|
| racine | tst-lancer.mjs | à la racine | remplace |
| racine | tst-t1.cjs, tst-t2.cjs | à la racine | nouveaux ou remplacent |
| racine | tst-u1.cjs, tst-u2.cjs | à la racine | nouveaux ou remplacent |
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
2. Glissez les 6 fichiers du dossier `racine` : `tst-lancer.mjs`, `tst-t1.cjs`, `tst-t2.cjs`, `tst-u1.cjs`, `tst-u2.cjs`, `CARTE-DES-MODULES.md`.
3. **Commit changes**. (Une construction démarre, sans changement visible : normal.)

### Étape 2 — Les fichiers du dossier `src`
1. Ouvrez le dossier **src** → **Add file → Upload files**.
2. Glissez les 10 fichiers du dossier `src` du paquet.
3. **Commit changes**. Une construction démarre (environ 8 à 10 minutes).

### Étape 3 — Attendre le vert
Onglet **Actions** : la dernière ligne « Construire le site » doit passer au **vert**. Si elle passe au rouge, ne touchez à rien et copiez-moi le texte de l'étape en échec : rien n'est publié tant que tout n'est pas vert.

### Étape 4 — Vérifier sur le site de production
1. **Ctrl + Maj + R** (sur téléphone : fermez complètement l'application puis rouvrez-la). Le numéro en bas du menu doit être **20260830-248**.
2. **Forfaitaire** : Rapports et analyse → Déclarations fiscales → Impôt sur le Revenu → « Forfaitaire (CA < 10 M) ». Saisissez 5 000 000 : services → **200 000** ; choisissez « Autres activités » → **80 000**. Saisissez 1 200 000 : **25 000** (minimum). Saisissez 12 000 000 : message « pas éligible ».
3. **Sociétés** : régime « Réel », revenu global 1 000 000. « Société » → **300 000** ; « Coopérative » → **100 000** ; « Personne physique » → **104 400**.
4. **TCA** : onglet Déclaration TCA : la TCA vaut 10 % du chiffre d'affaires du mois, sans abattement.
5. **Paie** : Salaires → Bulletins de paie, employé à 50 000 par mois : cochez « Retenir l'impôt sur le salaire » → **2 700** retenus. Saisissez une prime de 2 000 : **300** (15 %) ; choisissez « Boni » : **200** (10 %).
6. **Facture** : ouvrez une facture à l'impression : le taux (par exemple « TCA (10 %) ») et la zone « Visa de l'entreprise et signature » apparaissent.
7. **Panier** : ajoutez plusieurs articles à la vente, changez de module et revenez : le panier est conservé ; le bouton rouge « Vider » le vide en un clic.
8. Dites-moi « v248 en production », ou ce qui cloche (avec une capture si possible).

## À savoir
- L'**acompte provisionnel** (article 81 : 60 % de l'impôt de l'avant-dernier exercice, en deux tranches, octobre et décembre), les **retenues sur contrats de services** (article 96 : 10 %, 20 % pour les licences) et les **retenues sur paiements à l'étranger** (article 97 : 20 %) ne sont pas encore calculés par l'application.
- Le Code fiscal a été adopté par décret ; un article de presse conteste cette voie. Il s'applique à ce jour.
- Ces règles restent à valider par votre expert-comptable.

## Ce que j'ai vérifié avant livraison
- 32 des 33 séries automatiques réussies (la 33e, « c1 », se vérifie à la construction automatique, comme avant), et les deux séries fiscales rejouées sur la version finale.
- Nouveau test automatique dédié (23 contrôles) : forfaitaire (200 000, 80 000, minimum 25 000, seuil de 10 millions), sociétés (300 000, 100 000, personnes physiques 104 400), TCA sans abattement, retenue sur salaire (2 700), prime 15 % et boni 10 %, taux et zone de visa sur la facture.
- Chaque chiffre a été recoupé avec le texte officiel (articles 62 à 66, 100, 103, 132, 137, 186, 190, 191, 193).
