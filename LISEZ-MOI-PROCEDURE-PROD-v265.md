# Compta+ — version 265 — paquet PROD
**Bloc « Import-export »** (validé en TEST) + **noms des rôles de l'école dans Administration** (v264).

À faire sur le dépôt **de production** uniquement. La v265 est validée en TEST.

**Prérequis** : la v263 est active sur PROD. Ce paquet est **cumulatif** (v264 + v265) : un seul dépôt à faire. **Aucun script SQL, aucune Edge Function.** Pas de changement du workflow.

## Ce qui change (pour vous)
1. Nouveau module **Import-export** (secteur à cocher dans Administration → Entreprise → « Mes secteurs d'activité ») : dossiers d'importation avec coût de revient réel (droits, taxes, TCA, frais), règlements en dollars avec écart de change en gourdes, réception en stock, dossiers d'exportation, rapports. Comptabilité toujours en gourdes. Taux par défaut indicatifs, à confirmer avec l'expert-comptable.
2. Administration → Accès → Utilisateurs : pour une entreprise École, rôles affichés « Directeur (Gestionnaire) », « Secrétaire-caissier(ère) (Vendeur) », « Suppléant (Consultant) », quel que soit l'espace choisi.
3. Un sélecteur d'espace (École / Import-export / Commerce) apparaît selon les secteurs de l'entreprise.
4. Une entreprise sans ces secteurs ne voit aucun changement.
5. Numéro de version : **20260830-265**.

## Fichiers du paquet (13 fichiers)
| Dossier du paquet | Fichier | Où le déposer | Action |
|---|---|---|---|
| racine | tst-u16.cjs | à la racine du dépôt | **nouveau** |
| racine | tst-u15.cjs | à la racine du dépôt | remplace |
| racine | tst-lancer.mjs | à la racine du dépôt | remplace |
| racine | CARTE-DES-MODULES.md | à la racine du dépôt | remplace |
| src | 53-import-export.jsx | dossier `src` | **nouveau** |
| src | 00-config.jsx | dossier `src` | remplace |
| src | 07-constantes-metier.jsx | dossier `src` | remplace |
| src | 12-application-principale.jsx | dossier `src` | remplace |
| src | 38-administration-stock-et-sauvegardes.jsx | dossier `src` | remplace |
| src | 39-administration-module.jsx | dossier `src` | remplace |
| src | 50-secteurs-et-blocs.jsx | dossier `src` | remplace |
| src | 51-ecoles.jsx | dossier `src` | remplace (en-tête technique) |
| src | 52-ecoles-suite.jsx | dossier `src` | remplace (en-tête technique) |

(4 fichiers de racine, 9 fichiers `src`, aucun script SQL.)

## Procédure pas à pas
### Étape 1 — Supabase
Rien à faire (pas de script SQL, pas d'Edge Function).

### Étape 2 — Les fichiers de la racine
Dépôt de **production** → **Add file → Upload files** → glissez les 4 fichiers du dossier `racine` → **Commit changes**.

### Étape 3 — Les fichiers du dossier `src`
Dossier **src** → **Add file → Upload files** → glissez les 9 fichiers du dossier `src` → **Commit changes**. Une construction démarre (25 à 40 minutes). Ne redéposez rien pendant ce temps.

### Étape 4 — Attendre le vert
Onglet **Actions** : « Construire le site » doit passer au **vert**. Si rouge : ne touchez à rien, copiez-moi le texte de l'étape en échec.

### Étape 5 — Vérifier sur le site de production
1. **Ctrl + Maj + R** (téléphone : fermez puis rouvrez l'application). Version en bas du menu : **20260830-265**.
2. Vos entreprises existantes fonctionnent comme avant (Commerce, École).
3. Si vous cochez le secteur Import-export pour une entreprise : le sélecteur d'espace apparaît et le module Import-export s'ouvre.
4. Dites-moi « v265 active sur PROD », ou ce qui cloche.

## Ce que j'ai vérifié avant livraison
- Série automatique complète sur la version de test (47 séries réussies sur 48 ; « c1 » se vérifie à la construction automatique, comme avant).
- Version **de production** construite et rejouée : tests u16 (bloc Import-export, 24 contrôles) et u15 (rôles) sans échec.

## Retour arrière (seulement si je vous le demande)
Redéposer les fichiers de la v263 et supprimer `src/53-import-export.jsx`. Aucune donnée n'est touchée.

## CE QUI RESTE DE VOTRE RESSORT
**À faire maintenant**
- Déposer ce paquet sur **PROD**, vérifier (étape 5), me dire « v265 active sur PROD ».
- Répondre à ma question sur le bloc **Éducation** (école professionnelle, université).

**Décisions à prendre**
- **Prix** : scénario « Équilibré » retenu ; à confirmer après un test auprès de 5 à 10 entreprises cibles.
- **Numérotation qui repart de 0001 chaque année** et **exercice octobre–septembre** : avec l'expert-comptable.

**Échéances et suivis**
- **Liste annuelle des versements** : avant le **31 octobre 2026** ; **retenues d'octobre** : 1er–15 novembre ; **acomptes provisionnels** : 1er–15 décembre.
- **Lundi 26 octobre** : vérifier la réception des e-mails de relance (Resend).
- Dans quelques jours : relancer le script 1 (journal) sur TEST et PROD ; garder le script 3.

**Validations externes et démarches**
- Expert-comptable : TCA cantine/transport/uniformes ; compte 709 ; TCA abonnements ; base des retenues 96–97 ; taux de retenue sur primes ; acomptes ; **acompte d'impôt à l'importation, TCA à l'exportation, taux de droits et taxes à l'importation**.
- Avocat : documents juridiques et données d'élèves mineurs ; messages de relance ; accès d'une secrétaire.
- Décision sur la sauvegarde à la minute ; récupération du 2FA ; compte MonCash de production ; prestataires de test d'intrusion ; règle « période clôturée ».
