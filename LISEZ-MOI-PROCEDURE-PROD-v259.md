# Compta+ — version 259 — paquet PROD
**Bloc Écoles, première version** (inclut la v258 : tickets de caisse, téléphone client, brouillons)

À faire sur le dépôt **compta-plus-** (production) et sur le projet Supabase **de production** uniquement. Version validée sur le site de test.

**Ce paquet est cumulatif : il contient les versions 257, 258 et 259.** Que vous ayez déjà déposé la v257 et la v258 sur PROD ou non, déposez simplement tout ce paquet. **Un script SQL est inclus (celui de la v257)** : il est sans danger si vous l'avez déjà exécuté (il peut être relancé, des messages « already exists, skipping » sont normaux). Aucune Edge Function. Pas de changement du workflow.

## Ce qui change (pour vous)
Un nouveau module **« Écoles »** (n° 11 du menu). Il n'apparaît que pour une entreprise qui a choisi le secteur **Écoles** (Administration → Entreprise → « Mes secteurs d'activité ») et dont le forfait couvre ses secteurs (Assisté, Extension, essai gratuit, ou Standard avec le supplément). Les rôles Vendeur et « comptabilité seule » ne le voient pas ; le rôle Consultant le voit en lecture seule.
1. **Années et classes** : création des années scolaires (une seule active à la fois) et des classes de chaque année.
2. **Familles et élèves** : fiche famille (responsable, téléphone, e-mail) ; inscription d'un élève avec matricule automatique (2026-0001…), famille et classe. On ne garde volontairement que le nom, la famille et la classe (pas de date de naissance : données d'enfants mineurs, à valider avec l'avocat). Changement de classe, marquage « sorti ».
3. **Grille de frais** : nom du frais, montant par élève, nombre d'échéances (1 à 12, mensuelles), date de la première échéance, type (écolage, inscription, autres), classes concernées. « Appliquer les frais aux élèves » crée les échéances (sans doublon). Un élève inscrit après coup reçoit tout de suite les frais de sa classe.
4. **Échéances** : liste de toutes les échéances avec leur état (à venir, avance reçue, échue impayée, partiellement payée, soldée). Bouton **« Constater les échéances échues »**.
5. **Encaissements et reçus** : choix de la famille (et de l'élève si besoin), montant, mode (espèces ou banque), date. Le paiement est réparti automatiquement sur les échéances de la plus ancienne à la plus récente, **reçu numéroté RE-2026-0001**, aperçu et impression (format ticket ou A4 selon vos réglages). Annulation d'un reçu avec écriture inverse. Un montant supérieur à ce que la famille doit est refusé.
6. **Vue d'ensemble** : élèves inscrits, frais attendus, encaissé, impayés échus, avances reçues, liste des familles avec impayés (téléphone cliquable).
7. **Écritures comptables automatiques** : à l'échéance, Débit 4111 (Familles) / Crédit 7061, 7062 ou 7068 (produit). Un paiement reçu **avant** l'échéance est une avance : Débit caisse ou banque / Crédit 487 (produits constatés d'avance) ; à l'échéance elle devient produit (Débit 487 / Crédit produit). Un paiement après constatation solde la créance : Débit caisse ou banque / Crédit 4111. Les comptes 4111, 7061, 7062 et 7068 sont créés tout seuls au premier besoin. Un encaissement constate d'abord les échéances échues de la famille.
8. **TCA** : les frais scolaires sont exonérés par défaut (art. 181). Pour la cantine, le transport, les uniformes, une case « Soumis à la TCA » existe : le montant saisi est alors toutes taxes comprises et la TCA est ventilée au compte 445. **À ne cocher qu'après confirmation de votre expert-comptable.**
9. **Sauvegardes** : les données de l'école font partie de l'export, de la restauration, de la sauvegarde automatique et de la remise à zéro (elles sont effacées avec la comptabilité, pour que les comptes restent cohérents).
10. Dans Administration, le secteur « Écoles » n'affiche plus « bientôt disponible ». Numéro de version : **20260830-259**.
(Inclus de la v258 : ticket de caisse refait, téléphone client et liste des clients dans le panier, formulaires conservés entre modules, texte de l'écran non sélectionnable.)
11. **Correction demandée après la v258** : la liste des anciens clients du panier est refaite sur mesure (la liste du navigateur ne s'ouvrait pas sur votre appareil). La petite flèche ▼ ouvre la liste de tous les clients avec leur téléphone ; les premières lettres tapées la réduisent ; toucher un nom remplit le nom et le téléphone.

## Ce que cette première version ne fait pas encore (étape suivante)
Bourses et rabais, relances automatiques des impayés, rapports de l'école (état par classe, âge des impayés), rôle secrétaire-caissier limité aux encaissements, cantine/transport en abonnement. Dites-moi ce qui compte le plus après vos essais.

## Fichiers du paquet (22 fichiers)
| Dossier du paquet | Fichier | Où le déposer | Action |
|---|---|---|---|
| supabase | secteurs-et-blocs-migration.sql | SQL Editor de Supabase (projet de PRODUCTION) | **à exécuter** (étape 1) |
| racine | tst-lancer.mjs | à la racine du dépôt | remplace |
| racine | tst-u11.cjs | à la racine du dépôt | nouveau (v258) ou remplace |
| racine | tst-u12.cjs | à la racine du dépôt | **nouveau** |
| racine | CARTE-DES-MODULES.md | à la racine du dépôt | remplace |
| src | 00-config.jsx | dossier `src` | remplace |
| src | 07-constantes-metier.jsx | dossier `src` | remplace |
| src | 08-composants-et-utilitaires.jsx | dossier `src` | remplace |
| src | 10-formatage-impression-et-pdf.jsx | dossier `src` | remplace |
| src | 12-application-principale.jsx | dossier `src` | remplace |
| src | 14-compta-immobilisations-et-provisions.jsx | dossier `src` | remplace |
| src | 21-caisse-et-banque.jsx | dossier `src` | remplace |
| src | 23-vente.jsx | dossier `src` | remplace |
| src | 24-achats.jsx | dossier `src` | remplace |
| src | 25-stock.jsx | dossier `src` | remplace |
| src | 26-creances-et-clients.jsx | dossier `src` | remplace |
| src | 38-administration-stock-et-sauvegardes.jsx | dossier `src` | remplace |
| src | 39-administration-module.jsx | dossier `src` | remplace |
| src | 42-centre-de-gestion.jsx | dossier `src` | remplace (v257) |
| src | 50-secteurs-et-blocs.jsx | dossier `src` | remplace |
| src | 51-ecoles.jsx | dossier `src` | **nouveau** |
| src | index.modele.html | dossier `src` | remplace |

(4 fichiers de racine, 17 fichiers `src` dont 1 nouveau, 1 script SQL.)

## Procédure pas à pas
### Étape 1 — Le script SQL (Supabase de PRODUCTION)
1. Ouvrez le tableau de bord Supabase du projet de **production** (celui de vos vrais clients, pas celui de test) → **SQL Editor** → **New query**.
2. Ouvrez le fichier `secteurs-et-blocs-migration.sql` du dossier `supabase`, copiez tout son contenu, collez-le dans l'éditeur.
3. Cliquez **Run**. Résultat attendu : une ligne `colonnes_ok_4 = 4`, `table_ok_1 = 1`, `declencheur_ok_1 = 1`. Des messages « already exists, skipping » sont normaux si le script a déjà été exécuté.
4. Si une erreur rouge apparaît, ne faites rien d'autre et copiez-moi son texte. Ce script ne supprime ni ne modifie aucune donnée existante.

### Étape 2 — Les fichiers de la racine
1. Page d'accueil du dépôt **compta-plus--test** → **Add file → Upload files**.
2. Glissez les 4 fichiers du dossier `racine`. **Commit changes**.

### Étape 3 — Les fichiers du dossier `src`
1. Ouvrez le dossier **src** → **Add file → Upload files**.
2. Glissez les 17 fichiers du dossier `src` du paquet (dont le nouveau `51-ecoles.jsx`). **Commit changes**. Une construction démarre (25 à 40 minutes). Ne redéposez rien pendant ce temps.

### Étape 4 — Attendre le vert
Onglet **Actions** : la dernière ligne « Construire le site » doit passer au **vert**. Si elle passe au rouge, ne touchez à rien et copiez-moi le texte de l'étape en échec.

### Étape 5 — Vérifier sur le site réel
1. **Ctrl + Maj + R** (téléphone : fermez complètement l'application puis rouvrez-la). Le numéro en bas du menu doit être **20260830-259**.
2. **Accès** : avec une entreprise (essai gratuit ou Assisté) qui a choisi le secteur **Écoles**, le module « Écoles » apparaît au menu ; avec une entreprise sans ce secteur, il n'apparaît pas.
3. **Mise en place** : année « 2026-2027 » → une classe → une famille avec téléphone → un élève (matricule 2026-0001).
4. **Frais** : « Écolage », 3 000, 3 échéances, première échéance dans le passé (par exemple il y a 40 jours) → « Appliquer les frais aux élèves ». Onglet Échéances : 3 lignes, 2 échues à constater.
5. **Encaissement** : famille → 1 500 → « Encaisser » : le reçu s'affiche (essayez « Imprimer »). Dans Comptabilité → journal : une écriture de constatation (4111 / 7061) et une d'encaissement (caisse / 4111).
6. **Avance** : encaissez le reste (1 500) : 500 soldent l'échéance échue et 1 000 sont en avance sur la dernière (compte 487). Vue d'ensemble : « Avances » = 1 000.
7. **Annulation** : annulez le dernier reçu : une écriture inverse apparaît, l'échéance redevient impayée.
8. **Impayés** : avec une échéance échue non payée, la famille apparaît dans « Familles avec impayés », téléphone cliquable.
9. **Liste des clients du panier** : Vente → ajoutez un article → touchez la flèche ▼ à droite du nom du client : la liste s'ouvre ; tapez quelques lettres : elle se réduit ; touchez un nom : le nom et le téléphone se remplissent.
10. **Sauvegarde** : Administration → exportez une sauvegarde : elle doit contenir « Écoles (élèves, frais, reçus) ».
11. Dites-moi « v259 active sur PROD », ou ce qui cloche (avec une capture si possible).

## Ce que j'ai vérifié avant livraison
- Série automatique complète rejouée sur la version finale (la série « c1 » se vérifie à la construction automatique, comme avant).
- Nouveau test dédié (u12, 32 contrôles) : module absent sans le secteur, présent avec ; parcours complet (année, classe, famille, élève, frais en 3 échéances, application) ; deux encaissements dont une avance ; toutes les écritures équilibrées ; comptes créés ; trop-perçu refusé ; annulation avec écriture inverse ; avance transformée en produit à l'échéance ; TCA ventilée (7068 / 445) ; impayés ; chargement de la catégorie.
- Reste à vérifier par vous : la mise en page du reçu sur votre imprimante ou en A4 (étape 5.5).

## Retour arrière (seulement si je vous le demande)
Aucune donnée existante n'est modifiée. Redéposer les fichiers de la v258 (ou v257) retirerait le module ; les données saisies dans l'école resteraient en réserve.

## CE QUI RESTE DE VOTRE RESSORT
**À faire maintenant**
- Exécuter le script SQL sur **PRODUCTION** (étape 1), déposer les fichiers (étapes 2 et 3), attendre le vert, vérifier (étape 5) et me dire « v259 active sur PROD » (cela couvre aussi la v257 et la v258).
- Essayer le bloc avec les vrais cas d'une école de votre connaissance (grille de frais réelle) et me dire ce qui manque.

**Décisions à prendre**
- **Prix** : scénario « Équilibré » retenu (grille A pour Écoles) ; à confirmer après un test auprès de 5 à 10 entreprises cibles.
- **Numérotation qui repart de 0001 chaque année** et **exercice octobre–septembre** dans l'impôt sur le revenu : avec l'expert-comptable.

**Échéances et suivis**
- **Liste annuelle des versements** : avant le 31 octobre 2026 ; **acomptes provisionnels** : 1er–15 décembre ; **versement des retenues d'octobre** : 1er–15 novembre.
- **Lundi 26 octobre** : vérifier la réception des e-mails de relance (Resend).
- Dans quelques jours : relancer le script 1 (journal) sur TEST et PROD ; garder le script 3 sous la main.

**Validations externes et démarches**
- Expert-comptable : TCA sur cantine, transport, uniformes ; TCA sur les abonnements ; base des retenues 96–97 ; taux de retenue sur primes ; acomptes.
- Avocat : documents juridiques et données d'élèves mineurs (le module ne garde que nom, famille et classe).
- Décision sur la sauvegarde à la minute ; récupération du 2FA ; compte MonCash de production ; prestataires de test d'intrusion ; règle « période clôturée » en observation.

## Prochaine étape (après validation)
Étape 3 de l'école : bourses et rabais, relances des impayés, rapports. Puis le bloc suivant (Import-export).
