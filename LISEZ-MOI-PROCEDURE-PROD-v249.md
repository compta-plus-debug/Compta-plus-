# Compta+ — version 249 — paquet PROD
**TCA déductible sur les achats + aperçu de la facture dans Comptes clients**

À faire sur le dépôt **compta-plus-** (production) uniquement. Version validée sur le site de test. Aucune migration SQL, aucune Edge Function : rien à faire côté Supabase. Pas de changement du workflow.

**Prérequis** : la version 248 est déjà active sur ce dépôt (ce paquet s'ajoute par-dessus).

## Ce qui change (pour vous)
### 1. TCA déductible sur les achats (articles 187 à 190 du Code fiscal)
Cela ne concerne que les entreprises dont le régime de taxe est activé (Administration → régime TCA ou IVA) et qui ne sont pas en franchise. Sinon, rien ne change à l'écran.
- **Achat et fournisseurs → Achats** : deux nouveaux champs. « **TCA déductible payée au fournisseur** » (facultatif) et « **N° de la facture du fournisseur** ». Le champ « Montant » devient « Montant hors TCA », et l'écran affiche le **total à payer** (hors taxe + TCA).
- **Écriture comptable** : charge (hors taxe) + **compte 4456 « Taxe déductible sur achats »** au débit ; le total payé (hors taxe + TCA) au crédit (caisse, banque ou fournisseurs). Le compte 4456 est créé automatiquement.
- **Fiche d'achat** : le montant dû au fournisseur reste le **total** (hors taxe + TCA), donc les paiements fournisseurs et les soldes restent justes. La ligne détaillée affiche « dont TCA déductible » et le numéro de facture du fournisseur.
- **Retour fournisseur** : la TCA est rendue au prorata (le compte 4456 est crédité avec la part correspondante).
- **Déclaration TCA** (Rapports → Déclarations fiscales → Déclaration TCA) : trois lignes nouvelles : **L5** TCA déductible du mois, **L6** crédit de TCA reporté des mois précédents, **L7** TCA nette à payer (L4 − L5 − L6). Si la TCA déductible dépasse la TCA due, l'excédent est **reporté sur le mois suivant, sans remboursement** (article 188). La **liste des factures d'achat** avec TCA déductible du mois s'affiche à l'écran et dans le PDF (article 190 : à joindre à la déclaration).
- Important : la taxe n'est déductible que si elle figure sur une **facture en règle du fournisseur** (article 187). L'application vous le rappelle à la saisie.

### 2. Aperçu de la facture dans Comptes clients
- Dans **Comptes clients → Clients dûs** (après avoir ouvert le client) et **Clients payés**, un bouton « **Voir la facture** » ouvre l'aperçu de la facture **telle qu'elle sortira de l'imprimante** : feuille A4 ou ticket 80 mm / 58 mm, selon le format choisi dans Administration, avec logo, NIF, taux de TCA, mention de franchise, zone de visa et signature.
- Un bouton « **Imprimer** » dans l'aperçu lance l'impression de cette même mise en page.
- Cet aperçu est aussi la base pour un futur envoi de la facture au client (par exemple en PDF).

### 3. Divers
- Description du régime TCA corrigée dans Administration : la taxe payée aux fournisseurs est déductible (elle était décrite comme non déductible).
- Numéro de version : **20260830-249**.

## Fichiers du paquet (14 fichiers)
| Dossier du paquet | Fichier | Où le déposer dans le dépôt | Action |
|---|---|---|---|
| racine | tst-lancer.mjs | à la racine | remplace |
| racine | tst-u3.cjs | à la racine | **nouveau** |
| racine | tst-u4.cjs | à la racine | **nouveau** |
| racine | CARTE-DES-MODULES.md | à la racine | remplace |
| src | 00-config.jsx | dossier `src` | remplace |
| src | 07-constantes-metier.jsx | dossier `src` | remplace |
| src | 10-formatage-impression-et-pdf.jsx | dossier `src` | remplace |
| src | 12-application-principale.jsx | dossier `src` | remplace |
| src | 24-achats.jsx | dossier `src` | remplace |
| src | 26-creances-et-clients.jsx | dossier `src` | remplace |
| src | 28-declarations-fiscales.jsx | dossier `src` | remplace |
| src | 29-gestion-calculs.jsx | dossier `src` | remplace |
| src | 35-rapports-et-bilans.jsx | dossier `src` | remplace |
| src | index.modele.html | dossier `src` | remplace |

## Procédure pas à pas
### Étape 1 — Les fichiers de la racine
1. Page d'accueil du dépôt **compta-plus-** → **Add file → Upload files**.
2. Glissez les 4 fichiers du dossier `racine` : `tst-lancer.mjs`, `tst-u3.cjs`, `tst-u4.cjs`, `CARTE-DES-MODULES.md`.
3. **Commit changes**. (Une construction démarre, sans changement visible : normal.)

### Étape 2 — Les fichiers du dossier `src`
1. Ouvrez le dossier **src** → **Add file → Upload files**.
2. Glissez les 10 fichiers du dossier `src` du paquet.
3. **Commit changes**. Une construction démarre (environ 8 à 10 minutes).

### Étape 3 — Attendre le vert
Onglet **Actions** : la dernière ligne « Construire le site » doit passer au **vert**. Si elle passe au rouge, ne touchez à rien et copiez-moi le texte de l'étape en échec : rien n'est publié tant que tout n'est pas vert.

### Étape 4 — Vérifier sur le site réel
1. **Ctrl + Maj + R** (sur téléphone : fermez complètement l'application puis rouvrez-la). Le numéro en bas du menu doit être **20260830-249**.
2. **Achat avec TCA** : Achat et fournisseurs → Achats. Libellé « Papeterie », montant hors TCA **1 000**, TCA déductible **100**, N° de facture « F-114 ». Le total affiché doit être **1 100**. Enregistrez. Ouvrez la ligne de l'achat : « dont TCA déductible 100 ».
3. **Journal** : Comptabilité → Journal : l'écriture doit comporter la charge 1 000, le compte **4456** 100 au débit, et 1 100 au crédit.
4. **Déclaration** : Rapports → Déclarations fiscales → Déclaration TCA, mois de l'achat : ligne **L5 = 100**, la liste des factures d'achat affiche F-114, L7 = TCA du mois − 100. Téléchargez le PDF : les lignes L5 à L7 et la liste des factures y figurent.
5. **Crédit reporté** (facultatif) : si la TCA déductible d'un mois dépasse la TCA due, le mois suivant affiche le crédit en **L6**.
6. **Régime sans taxe** : dans Administration, mettez le régime sur « Aucune taxe » (ou cochez la franchise) : les champs TCA disparaissent des achats. Remettez ensuite votre réglage d'origine.
7. **Retour fournisseur** (facultatif) : Gestion avancée → retour sur l'achat ci-dessus : le retour doit rendre la TCA au prorata (compte 4456 au crédit).
8. **Aperçu de facture** : Comptes clients → Clients dûs → ouvrez un client → « Voir la facture ». Vérifiez que l'aperçu ressemble à ce que votre imprimante produit (changez le format A4 / ticket dans Administration pour comparer), puis testez « Imprimer ». Faites de même dans « Clients payés ».
9. Dites-moi « v249 active sur PROD », ou ce qui cloche (avec une capture si possible).

## À savoir
- Les achats **déjà saisis** avant cette version n'ont pas de TCA déductible : seuls les nouveaux achats (ou ceux que vous modifiez en ajoutant la TCA) en ont. Pour un achat ancien, annulez-le puis ressaisissez-le avec la TCA.
- L'aperçu de facture n'affiche pas encore l'adresse du client : elle n'existe pas dans la fiche client (prévu dans la prochaine étape, avec la numérotation par série).
- Ces règles restent à valider par votre expert-comptable.

## Ce que j'ai vérifié avant livraison
- Série automatique complète rejouée sur la version finale (la série « c1 » se vérifie à la construction automatique, comme avant).
- Deux nouveaux tests dédiés : achat avec TCA (écriture équilibrée, totaux, champ masqué sans régime ou en franchise), déclaration (déductible, crédit reporté d'un mois sur l'autre, liste des factures), aperçu de facture A4 et ticket, impression, fermeture.

## CE QUI RESTE DE VOTRE RESSORT
**À faire maintenant**
- Déposer ce paquet sur le dépôt de production (étapes 1 et 2) et attendre le vert.
- Faire les vérifications rapides de l'étape 4 sur le site réel (de préférence avec un achat de test que vous annulez ensuite) et me dire « v249 active sur PROD ».

**Échéances et suivis**
- **Lundi 26 octobre** : vérifier la réception des e-mails de relance (Resend).
- Dans quelques jours : relancer le script 1 (journal) sur TEST et PROD pour voir si des écritures sont refusées. Garder le script 3 sous la main (retour arrière).

**Validations externes (expert-comptable)**
- Le document « Écarts fiscaux confirmés » avec ses questions : barème pour un exercice à cheval sur le 1er octobre 2026, éventuelles décisions ministérielles sur la TCA, application des 15 % aux heures supplémentaires, seuil de 10 millions apprécié sur le chiffre d'affaires hors taxe.
- La nouvelle déduction de TCA (articles 187 à 190) : confirmer le traitement du crédit reporté et la liste des factures à joindre.
- Le traitement du change (comptes 476/477).
- La TCA est-elle applicable aux revenus de votre abonnement logiciel ?

**Décisions et démarches à traiter**
- Relecture des documents juridiques par un avocat.
- Décision sur la sauvegarde à la minute (PITR).
- Procédure de récupération de la double authentification (2FA).
- Compte MonCash de production.
- Choisir et contacter les prestataires de test d'intrusion (document remis).
- Une règle reste en mode « observation » (période clôturée), à passer en application quand vous êtes prêt.
