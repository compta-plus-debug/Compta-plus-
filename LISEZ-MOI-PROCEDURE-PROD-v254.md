# Compta+ — version 254 — paquet PROD
**État mensuel des retenues à verser à la DGI (articles 100 et 103 du Code fiscal)**

À faire sur le dépôt **compta-plus-** (production) uniquement. Version validée sur le site de test. Aucune migration SQL, aucune Edge Function : rien à faire côté Supabase. Pas de changement du workflow.

**Prérequis** : la v253 est déjà active sur ce dépôt de production.

## Ce qui change (pour vous)
- Un nouvel onglet **« Retenues DGI »** dans **Salaires (RH)**. Pour le mois choisi, il liste, d'après vos bulletins de paie enregistrés : l'employé, la période, le brut, la **retenue sur salaire** (articles 100 et 132), la **prime ou le boni** avec son taux, et la **retenue sur prime/boni** (article 103).
- Il calcule le **total à verser à la DGI** (retenue sur salaires + retenue sur primes et boni) et affiche l'**échéance** : entre le 1er et le 15 du mois suivant.
- Un bouton **« Télécharger l'état (.pdf) »** produit l'état explicatif à joindre au versement, avec votre NIF.
- Les bulletins **annulés** et ceux **sans retenue** n'apparaissent pas. Le mois se choisit selon la **date de paie** du bulletin.
- Numéro de version : **20260830-254**.

## À savoir
- Les retenues sont celles que vous avez cochées à la saisie des bulletins (la retenue sur salaire est décochée par défaut) ; l'état ne recalcule rien, il rapporte ce qui a été retenu.
- Les retenues sont comptabilisées avec les charges sociales dans le compte 431 : l'application ne crée pas encore de compte séparé pour le versement à la DGI.
- Les taux (10 % boni, 15 % autres) restent à valider avec votre expert-comptable.

## Fichiers du paquet (6 fichiers)
| Dossier du paquet | Fichier | Où le déposer dans le dépôt | Action |
|---|---|---|---|
| racine | tst-lancer.mjs | à la racine | remplace |
| racine | tst-u7.cjs | à la racine | **nouveau** |
| racine | CARTE-DES-MODULES.md | à la racine | remplace |
| src | 00-config.jsx | dossier `src` | remplace |
| src | 27-paie.jsx | dossier `src` | remplace |
| src | index.modele.html | dossier `src` | remplace |

## Procédure pas à pas
### Étape 1 — Les fichiers de la racine
1. Page d'accueil du dépôt **compta-plus-** → **Add file → Upload files**.
2. Glissez les 3 fichiers du dossier `racine` : `tst-lancer.mjs`, `tst-u7.cjs`, `CARTE-DES-MODULES.md`.
3. **Commit changes**.

### Étape 2 — Les fichiers du dossier `src`
1. Ouvrez le dossier **src** → **Add file → Upload files**.
2. Glissez les 3 fichiers du dossier `src` du paquet.
3. **Commit changes**. Une construction démarre (25 à 40 minutes). Ne redéposez rien pendant ce temps.

### Étape 3 — Attendre le vert
Onglet **Actions** : la dernière ligne « Construire le site » doit passer au **vert**. Si elle passe au rouge, ne touchez à rien et copiez-moi le texte de l'étape en échec.

### Étape 4 — Vérifier sur le site réel
1. **Ctrl + Maj + R** (sur téléphone : fermez complètement l'application puis rouvrez-la). Le numéro en bas du menu doit être **20260830-254**.
2. **Préparer une donnée** : Salaires (RH) → Bulletins de paie : créez un bulletin pour un employé à 50 000 par mois, en cochant « Retenir l'impôt sur le salaire » (2 700), avec une prime de 2 000 (retenue 15 % = 300).
3. **L'état** : Salaires (RH) → onglet « Retenues DGI », choisissez le mois du bulletin. Vous devez voir la ligne de l'employé : retenue salaire 2 700, prime 2 000, retenue prime 300, **total à verser 3 000**, échéance « 15 » du mois suivant.
4. **PDF** : « Télécharger l'état (.pdf) » : le PDF contient le tableau, les totaux, l'échéance et votre NIF.
5. Annulez le bulletin de test (ou supprimez-le si votre expert-comptable le préfère) : l'état doit alors devenir vide pour ce mois.
6. Dites-moi « v254 active sur PROD », ou ce qui cloche (avec une capture si possible).

## Ce que j'ai vérifié avant livraison
- Série automatique complète rejouée sur la version finale (la série « c1 » se vérifie à la construction automatique, comme avant).
- Nouveau test dédié : totaux (3 700 + 500 = 4 200), exclusion des bulletins annulés, sans retenue ou d'un autre mois, échéances (novembre, janvier de l'année suivante pour décembre), message vide.

## CE QUI RESTE DE VOTRE RESSORT
**À faire maintenant**
- Déposer ce paquet sur le dépôt de production (étapes 1 et 2), attendre le vert, faire les vérifications de l'étape 4 et me dire « v254 active sur PROD ». (La v255, déjà sur TEST, est cumulative : elle contient la v254.)

**Décisions à prendre**
- **Numérotation qui repart de 0001 chaque année** : à valider avec votre expert-comptable ; si oui, je prépare le script SQL et sa procédure.

**Échéances et suivis**
- **Versement des retenues** : pour les paies d'octobre, entre le 1er et le 15 novembre 2026 (à confirmer avec votre expert-comptable).
- **Lundi 26 octobre** : vérifier la réception des e-mails de relance (Resend).
- Dans quelques jours : relancer le script 1 (journal) sur TEST et PROD ; garder le script 3 sous la main.

**Validations externes et démarches**
- Expert-comptable : document « Écarts fiscaux confirmés », crédit de TCA reporté, change (comptes 476/477), TCA sur l'abonnement logiciel, adresse du client facultative sur la facture, taux de retenue sur primes.
- Relecture des documents juridiques par un avocat ; décision sur la sauvegarde à la minute ; récupération du 2FA ; compte MonCash de production ; choix des prestataires de test d'intrusion ; règle « période clôturée » encore en observation.
