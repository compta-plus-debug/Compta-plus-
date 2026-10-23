# Compta+ — version 256 — paquet PROD
**Retenues à la source sur les prestataires (articles 96 et 97 du Code fiscal)**

À faire sur le dépôt **compta-plus-** (production) uniquement. Version validée sur le site de test. Aucune migration SQL, aucune Edge Function : rien à faire côté Supabase. Pas de changement du workflow.

**Prérequis** : la v255 est déjà active sur ce dépôt de production (acomptes, liste annuelle des versements, NIF).

## Ce qui change (pour vous)
1. **Achats — nouvelle zone « Retenue à la source sur la rémunération du prestataire »** (facultative) :
   - **10 %** : prestation de services par un prestataire établi en Haïti **non soumis aux états financiers** (art. 96) ;
   - **20 %** : licence, brevet, marque, procédé de fabrication (art. 96-2) ;
   - **20 %** : prestation payée à un bénéficiaire **résidant hors d'Haïti** (art. 97, retenue libératoire).
   L'application montre la retenue (sur le montant hors taxe) et le **net à payer au fournisseur**. La fiche d'achat porte ce net ; la retenue est inscrite au compte **431** (à verser à la DGI) ; l'écriture reste équilibrée.
2. **Nouvel onglet « Retenues sur prestations »** (Rapports et analyse → Déclarations fiscales) : par mois de paiement, la liste des retenues, le **total à verser à la DGI**, l'échéance (**1er au 15 du mois suivant**) et un état PDF avec votre NIF.
3. **Liste annuelle des versements** : les achats avec retenue y figurent avec la rémunération brute et leur retenue (honoraires, redevances, prestations hors d'Haïti).
4. Le détail d'un achat affiche la retenue. Numéro de version : **20260830-256**.

## À savoir
- Un **retour fournisseur** n'est pas proposé sur un achat avec retenue (pour ne pas fausser les montants).
- La retenue ne s'applique pas si le prestataire est imposé sur la base des états financiers : c'est à vous de choisir « Aucune retenue » dans ce cas.
- La base de calcul retenue est le montant **hors taxe** ; à confirmer avec votre expert-comptable pour la prestation payée à l'étranger.

## Fichiers du paquet (10 fichiers)
| Dossier du paquet | Fichier | Où le déposer dans le dépôt | Action |
|---|---|---|---|
| racine | tst-lancer.mjs | à la racine | remplace |
| racine | tst-u9.cjs | à la racine | **nouveau** |
| racine | CARTE-DES-MODULES.md | à la racine | remplace |
| src | 00-config.jsx | dossier `src` | remplace |
| src | 12-application-principale.jsx | dossier `src` | remplace |
| src | 24-achats.jsx | dossier `src` | remplace |
| src | 28-declarations-fiscales.jsx | dossier `src` | remplace |
| src | 32-gestion-ecrans.jsx | dossier `src` | remplace |
| src | 35-rapports-et-bilans.jsx | dossier `src` | remplace |
| src | index.modele.html | dossier `src` | remplace |

## Procédure pas à pas
### Étape 1 — Les fichiers de la racine
1. Page d'accueil du dépôt **compta-plus-** → **Add file → Upload files**.
2. Glissez les 3 fichiers du dossier `racine`.
3. **Commit changes**.

### Étape 2 — Les fichiers du dossier `src`
1. Ouvrez le dossier **src** → **Add file → Upload files**.
2. Glissez les 7 fichiers du dossier `src` du paquet.
3. **Commit changes**. Une construction démarre (25 à 40 minutes). Ne redéposez rien pendant ce temps.

### Étape 3 — Attendre le vert
Onglet **Actions** : la dernière ligne « Construire le site » doit passer au **vert**. Si elle passe au rouge, ne touchez à rien et copiez-moi le texte de l'étape en échec.

### Étape 4 — Vérifier sur le site réel
1. **Ctrl + Maj + R** (téléphone : fermez complètement l'application puis rouvrez-la). Le numéro en bas du menu doit être **20260830-256**.
2. **Saisie** : Achat et fournisseurs → libellé « Honoraires conseil », montant 10 000, zone de retenue → choix « 10 % ». Vous devez voir **retenue 1 000** et **net à payer 9 000** ; enregistrez.
3. **Détail** : ouvrez l'achat : la ligne « Retenue à la source (10 %) : 1 000 » apparaît ; le montant de l'achat est 9 000.
4. **Journal** : l'écriture contient la charge 10 000 au débit, 9 000 au crédit (banque/caisse/fournisseur) et 1 000 au crédit du compte 431.
5. **État** : Rapports et analyse → Déclarations fiscales → « Retenues sur prestations » → mois de l'achat : la ligne et le **total 1 000** ; PDF.
6. **Liste annuelle** : l'achat y figure (rémunération 10 000, retenue 1 000).
7. Annulez l'achat de test (écriture de contrepassation, pour ne pas laisser de retenue fictive dans vos vraies données) : l'état du mois doit redevenir vide.
8. Dites-moi « v256 active sur PROD », ou ce qui cloche (avec une capture si possible).

## Ce que j'ai vérifié avant livraison
- Série automatique complète rejouée sur la version finale (la série « c1 » se vérifie à la construction automatique, comme avant).
- Nouveau test dédié (u9) : calcul 10 %, net 9 000, écriture équilibrée avec le compte 431, compte créé automatiquement, état mensuel (achat annulé exclu, échéance), liste annuelle.

## CE QUI RESTE DE VOTRE RESSORT
**À faire maintenant**
- Déposer ce paquet sur le dépôt de production (étapes 1 et 2), attendre le vert, faire les vérifications de l'étape 4 et me dire « v256 active sur PROD ».
- Si ce n'est pas déjà fait : déposer d'abord le paquet PROD v255 (qui contient la v254) et me confirmer qu'il est actif.

**Décisions à prendre**
- **Numérotation qui repart de 0001 chaque année** : à valider avec votre expert-comptable ; si oui, je prépare le script SQL.
- **Exercice octobre–septembre dans l'impôt sur le revenu** (au lieu de l'année civile).

**Échéances et suivis**
- **Liste annuelle des versements** : à déposer du 1er au 31 octobre 2026 ; **acomptes provisionnels** : 1er–15 octobre et 1er–15 décembre ; **versement des retenues d'octobre** : 1er–15 novembre.
- **Lundi 26 octobre** : vérifier la réception des e-mails de relance (Resend).
- Dans quelques jours : relancer le script 1 (journal) sur TEST et PROD ; garder le script 3 sous la main.

**Validations externes et démarches**
- Expert-comptable : « Écarts fiscaux confirmés », crédit de TCA reporté, change (476/477), TCA sur l'abonnement logiciel, adresse client facultative, taux de retenue sur primes, base de calcul des retenues des articles 96–97 (HT ou TTC), traitement des acomptes.
- Relecture des documents juridiques par un avocat ; décision sur la sauvegarde à la minute ; récupération du 2FA ; compte MonCash de production ; prestataires de test d'intrusion ; règle « période clôturée » en observation.
