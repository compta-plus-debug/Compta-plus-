# Compta+ — version 258 — paquet PROD
**Ticket de caisse refait, téléphone et liste des clients dans le panier, formulaires conservés, texte de l'écran protégé**

À faire sur le dépôt **compta-plus-** (production) uniquement. Version validée sur le site de test.

**Prérequis** : la v257 est déjà active sur ce dépôt de production (script SQL de la v257 déjà exécuté sur le Supabase de production). **Aucun script SQL, aucune Edge Function** : rien à faire côté Supabase. Pas de changement du workflow.

## Ce qui change (pour vous)
1. **Ticket de caisse (80 mm, 58 mm) refait sur le modèle de votre ticket de 300** : « Facture » en titre, nom de l'entreprise, adresse, téléphones, e-mail ; ligne « Facture N° … » avec **la date et l'heure exactes d'émission** ; client (avec son téléphone) ; colonnes **Article / Qté / Montant** avec des lignes espacées ; « Articles au total » ; **« Montant total » en grand** ; **« Détails de paiement »** (Espèces, Banque, ou Versé et Solde dû pour un crédit) ; message de remerciement. Cela vaut pour les trois sorties : **impression Bluetooth**, **PDF ticket** et **impression système / aperçu**.
2. **Logo sur le ticket** : il apparaît sur l'aperçu, sur le PDF et sur l'impression système. Pour l'imprimante Bluetooth, il est converti en noir et blanc (si le logo est illisible, le ticket s'imprime sans logo, sans erreur). Un logo simple, contrasté et carré donne le meilleur résultat sur papier thermique.
3. **E-mail long** : sur l'imprimante Bluetooth, les coordonnées de l'entreprise s'impriment en petite police, pour que l'adresse e-mail ne soit plus coupée en deux.
4. **Facture A4** (aperçu, impression et PDF) : date et heure exactes, logo plus grand, téléphone du client, plus d'espace entre l'en-tête, les lignes et les totaux.
5. **Panier de vente : téléphone du client** (champ « Téléphone du client », facultatif, qui apparaît dès qu'un nom est saisi). Le numéro est imprimé sur la facture et **gardé sur la fiche du client** (la fiche est créée si le client n'existe pas encore). Il est repris automatiquement quand le client revient (fiche, sinon dernière facture).
6. **Panier de vente : liste des anciens clients** (⚠ sur votre téléphone, la petite flèche de la liste du navigateur ne s'ouvrait pas pendant les essais : une liste faite sur mesure, qui s'ouvre partout, arrive avec la v259 ; la saisie des premières lettres et le remplissage automatique fonctionnent déjà) : en tapant le nom, l'application propose les noms déjà enregistrés (fiches clients et noms déjà facturés, avec leur téléphone) ; en choisissant un nom, le téléphone et l'adresse se remplissent seuls.
7. **Formulaires conservés** : une saisie en cours n'est plus perdue quand vous ouvrez un autre module ou un autre onglet, puis revenez. Concerne : achats (et nouveau fournisseur), nouveau client, mouvements de stock, caisse et banque, immobilisations et provisions. Les brouillons sont propres à votre entreprise et à votre compte, expirent après 6 heures, ne gardent que du texte et des nombres, et un formulaire vidé après enregistrement reste vide. (Le panier de vente avait déjà cette protection.)
8. **Texte de l'écran protégé** : on ne peut plus sélectionner, glisser ni déposer le texte affiché, ni le déposer dans un champ. Les champs de saisie restent modifiables, et l'import de fichiers n'est pas touché. À savoir : c'est une protection de confort ; la vraie sécurité des données reste côté serveur.
9. **Secteurs** : la carte « Mes secteurs d'activité » indique « bientôt disponible » à côté des blocs pas encore construits.
10. Numéro de version : **20260830-258**.

## Fichiers du paquet (15 fichiers)
| Dossier du paquet | Fichier | Où le déposer | Action |
|---|---|---|---|
| racine | tst-lancer.mjs | à la racine du dépôt | remplace |
| racine | tst-u11.cjs | à la racine du dépôt | **nouveau** |
| racine | CARTE-DES-MODULES.md | à la racine du dépôt | remplace |
| src | 00-config.jsx | dossier `src` | remplace |
| src | 08-composants-et-utilitaires.jsx | dossier `src` | remplace |
| src | 10-formatage-impression-et-pdf.jsx | dossier `src` | remplace |
| src | 12-application-principale.jsx | dossier `src` | remplace |
| src | 14-compta-immobilisations-et-provisions.jsx | dossier `src` | remplace |
| src | 21-caisse-et-banque.jsx | dossier `src` | remplace |
| src | 23-vente.jsx | dossier `src` | remplace |
| src | 24-achats.jsx | dossier `src` | remplace |
| src | 25-stock.jsx | dossier `src` | remplace |
| src | 26-creances-et-clients.jsx | dossier `src` | remplace |
| src | 50-secteurs-et-blocs.jsx | dossier `src` | remplace |
| src | index.modele.html | dossier `src` | remplace |

(3 fichiers de racine, 12 fichiers `src`, aucun script SQL.)

## Procédure pas à pas
### Étape 1 — Supabase
Rien à faire (pas de script SQL, pas d'Edge Function).

### Étape 2 — Les fichiers de la racine
1. Page d'accueil du dépôt **compta-plus-** → **Add file → Upload files**.
2. Glissez les 3 fichiers du dossier `racine` : `tst-lancer.mjs`, `tst-u11.cjs`, `CARTE-DES-MODULES.md`. **Commit changes**.

### Étape 3 — Les fichiers du dossier `src`
1. Ouvrez le dossier **src** → **Add file → Upload files**.
2. Glissez les 12 fichiers du dossier `src` du paquet. **Commit changes**. Une construction démarre (25 à 40 minutes). Ne redéposez rien pendant ce temps.

### Étape 4 — Attendre le vert
Onglet **Actions** : la dernière ligne « Construire le site » doit passer au **vert**. Si elle passe au rouge, ne touchez à rien et copiez-moi le texte de l'étape en échec.

### Étape 5 — Vérifier sur le site réel
1. **Ctrl + Maj + R** (téléphone : fermez complètement l'application puis rouvrez-la). Le numéro en bas du menu doit être **20260830-258**.
2. **Ticket** : Administration → Entreprise : format « ticket 80 mm », logo et coordonnées renseignés. Faites une vente avec un client (ou ouvrez une facture existante), ouvrez la facture (Comptes clients → Voir la facture) : l'aperçu montre le titre, la date **et l'heure**, le téléphone du client, les colonnes, le grand « Montant total » et « Détails de paiement ». Téléchargez le PDF ticket et vérifiez de même.
3. **Imprimante Bluetooth** (sur votre téléphone, avec l'imprimante) : « Imprimer (Bluetooth) » sur cette facture. Comparez avec votre ticket modèle de 300 : titre, coordonnées (e-mail entier sur une ligne), date et heure, colonnes, grand total, détails de paiement. Dites-moi si le logo sort bien ou s'il faut le simplifier.
4. **Facture A4** : même facture en format A4 : logo, date et heure, espacement.
5. **Panier** : Vente → ajoutez un article → tapez les premières lettres d'un ancien client : la liste se propose ; choisissez-le : le téléphone se remplit. Saisissez un nouveau client avec un téléphone, validez la vente : la facture porte le numéro, et la fiche du client (Comptes clients) l'a gardé.
6. **Brouillon** : Achats → commencez à saisir un libellé sans enregistrer → ouvrez un autre module → revenez : la saisie est toujours là. Faites de même dans Comptes clients (nouveau client) et Caisse.
7. **Texte** : essayez de sélectionner un texte à la souris ou de le glisser dans un champ : impossible. Les champs (nom du client, montants…) restent modifiables.
8. Dites-moi « v258 active sur PROD », ou ce qui cloche (avec une capture si possible).

## Ce que j'ai vérifié avant livraison
- Série automatique complète rejouée sur la version finale (la série « c1 » se vérifie à la construction automatique, comme avant).
- Nouveau test dédié (u11, 27 contrôles) : liste des clients, téléphone repris de la fiche et de la dernière facture, téléphone enregistré sur la facture et la fiche, nouvelle fiche créée, aperçu ticket et A4 (date et heure, logo, téléphone, colonnes, total en grand, détails de paiement), brouillon d'achat conservé après un passage par un autre module, texte non sélectionnable, dépôt de texte bloqué.
- Texte envoyé à l'imprimante Bluetooth contrôlé ligne par ligne sur 32 caractères (facture à crédit de 40 000, deux articles). L'impression physique et le rendu du logo en noir et blanc ne se contrôlent que sur votre imprimante (étape 5.3).

## Retour arrière (seulement si je vous le demande)
Aucune donnée n'est modifiée par cette version. Redéposer les fichiers de la v257 suffirait.

## CE QUI RESTE DE VOTRE RESSORT
**À faire maintenant**
- Déposer ce paquet sur **PROD** (étapes 2 et 3), attendre le vert, vérifier (étape 5) et me dire « v258 active sur PROD ».
- **Prérequis** : la v257 doit être active sur PROD (script SQL de production exécuté, paquet PROD v257 déposé). Sinon, déposez-la d'abord.

**Décisions à prendre**
- **Prix** : scénario « Équilibré » retenu pour l'affichage ; à confirmer après un test auprès de 5 à 10 entreprises cibles.
- **Numérotation qui repart de 0001 chaque année** et **exercice octobre–septembre** dans l'impôt sur le revenu : avec l'expert-comptable.

**Échéances et suivis**
- **Liste annuelle des versements** : avant le 31 octobre 2026 ; **acomptes provisionnels** : 1er–15 décembre ; **versement des retenues d'octobre** : 1er–15 novembre.
- **Lundi 26 octobre** : vérifier la réception des e-mails de relance (Resend).
- Dans quelques jours : relancer le script 1 (journal) sur TEST et PROD ; garder le script 3 sous la main.

**Validations externes et démarches**
- Expert-comptable : TCA sur les abonnements, base des retenues 96–97, taux de retenue sur primes, acomptes, TCA sur cantine/transport/uniformes (bloc Écoles).
- Avocat : documents juridiques et données d'élèves mineurs (bloc Écoles).
- Décision sur la sauvegarde à la minute ; récupération du 2FA ; compte MonCash de production ; prestataires de test d'intrusion ; règle « période clôturée » en observation.

## Prochaine étape (après validation)
Étape 2 des blocs : **bloc Écoles, première version** (années scolaires, classes, élèves et familles, grille de frais, échéancier, encaissements, reçus, écritures comptables).
