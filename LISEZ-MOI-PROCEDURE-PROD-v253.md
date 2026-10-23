# Compta+ — version 253 — paquet PROD
**Adresse du client sur la facture (optionnelle, au choix de l'administrateur) + préfixe de la série de numérotation**

À faire sur le dépôt **compta-plus-** (production) uniquement. Version validée sur le site de test. Aucune migration SQL, aucune Edge Function : rien à faire côté Supabase. Pas de changement du workflow.

**Prérequis** : la v251 est déjà active sur ce dépôt de production.

**Ce paquet est autonome** : il contient tout ce qu'a apporté la v252 (adresse du client, préfixe) et la v253 (adresse optionnelle). Il n'y a pas de paquet PROD v252.

## Ce qui change (pour vous)
0. **Nouveau : l'adresse du client sur la facture est une option** (Administration → Entreprise → case « Afficher l'adresse du client sur la facture », cochée par défaut). Décochée : le champ adresse disparaît de la caisse, l'adresse n'est plus enregistrée sur les nouvelles factures et n'est plus imprimée (facture, aperçu, PDF, ticket), même pour les anciennes factures qui en portaient une. Le champ « Adresse » de la fiche client reste disponible pour votre usage interne. Le Code fiscal la prévoit : décidez avec votre expert-comptable.
1. **Adresse du client** : un champ « Adresse » dans la fiche client (Comptes clients → « Compléter une fiche client »). Si la fiche du client existe déjà, saisissez son nom et l'adresse : la fiche est complétée (rien n'est effacé).
2. **Vente (caisse)** : quand vous saisissez le nom d'un client qui a une adresse dans sa fiche, l'adresse apparaît toute seule dans un champ « Adresse du client (facultatif) », modifiable pour cette facture. Elle est enregistrée avec la facture.
3. **Facture imprimée, aperçu, PDF et ticket** : l'adresse du client s'affiche sous son nom. Pour une ancienne facture sans adresse enregistrée, l'aperçu de Comptes clients reprend l'adresse de la fiche du client.
4. **Préfixe de numérotation** (Administration → Entreprise) : « Préfixe de la série des factures ». Par exemple « FA- » donne FA-0001, FA-0002… Laissé vide : « F », comme avant. Le compteur est conservé et ne change pas : pas de trou ni de doublon. Seul le début des **nouvelles** factures change ; les anciennes gardent leur numéro. Cela vaut aussi pour les ventes faites hors ligne, qui reçoivent leur vrai numéro à la synchronisation.
5. Numéro de version : **20260830-253**.

## À savoir
- Le compteur reste unique pour toute l'entreprise : changer de préfixe ne redémarre pas à 0001. Une numérotation qui repart de 0001 chaque année demanderait une modification de la base de données : je ne l'ai pas faite sans votre accord ni celui de votre expert-comptable (voir ci-dessous).
- L'adresse n'est reprise automatiquement que si le nom saisi correspond à celui de la fiche client (les majuscules et les espaces en trop sont ignorés).

## Fichiers du paquet (11 fichiers)
| Dossier du paquet | Fichier | Où le déposer dans le dépôt | Action |
|---|---|---|---|
| racine | tst-lancer.mjs | à la racine | remplace |
| racine | tst-u6.cjs | à la racine | **nouveau** |
| racine | CARTE-DES-MODULES.md | à la racine | remplace |
| src | 00-config.jsx | dossier `src` | remplace |
| src | 10-formatage-impression-et-pdf.jsx | dossier `src` | remplace |
| src | 12-application-principale.jsx | dossier `src` | remplace |
| src | 22-scanner-et-ventes-hors-ligne.jsx | dossier `src` | remplace |
| src | 23-vente.jsx | dossier `src` | remplace |
| src | 26-creances-et-clients.jsx | dossier `src` | remplace |
| src | 39-administration-module.jsx | dossier `src` | remplace |
| src | index.modele.html | dossier `src` | remplace |

## Procédure pas à pas
### Étape 1 — Les fichiers de la racine
1. Page d'accueil du dépôt **compta-plus-** → **Add file → Upload files**.
2. Glissez les 3 fichiers du dossier `racine` : `tst-lancer.mjs`, `tst-u6.cjs`, `CARTE-DES-MODULES.md`.
3. **Commit changes**.

### Étape 2 — Les fichiers du dossier `src`
1. Ouvrez le dossier **src** → **Add file → Upload files**.
2. Glissez les 8 fichiers du dossier `src` du paquet.
3. **Commit changes**. Une construction démarre (25 à 40 minutes). Ne redéposez rien pendant ce temps.

### Étape 3 — Attendre le vert
Onglet **Actions** : la dernière ligne « Construire le site » doit passer au **vert**. Si elle passe au rouge, ne touchez à rien et copiez-moi le texte de l'étape en échec.

### Étape 4 — Vérifier sur le site réel
1. **Ctrl + Maj + R** (sur téléphone : fermez complètement l'application puis rouvrez-la). Le numéro en bas du menu doit être **20260830-253**.
2. **Fiche client** : Comptes clients → « Compléter une fiche client » : nom « Marie Joseph », adresse « 12 rue Capois, Delmas » → Enregistrer.
3. **Option adresse** : dans Administration → Entreprise, décochez « Afficher l'adresse du client sur la facture », enregistrez : en caisse, le champ adresse disparaît et la facture imprimée n'affiche plus l'adresse. Recochez ensuite.
3b. **Préfixe** : Administration → Entreprise → « Préfixe de la série des factures » : « FA- » → enregistrer.
4. **Vente** : Vente → ajoutez un article, saisissez le nom « Marie Joseph » : l'adresse apparaît dans le champ en dessous. Validez la vente : la facture porte un numéro de la forme **FA-xxxx**.
5. **Impression** : imprimez la facture (A4 puis ticket si vous l'utilisez) : l'adresse du client est sous son nom.
6. **Aperçu** : Comptes clients → Clients dûs → ouvrez le client → « Voir la facture » : l'adresse est visible.
7. **Réglage définitif** : laissez le préfixe vide (« F ») si vous ne souhaitez pas changer la série de vos factures réelles, et choisissez si l'adresse du client doit apparaître sur vos factures (case cochée ou non).
8. Dites-moi « v253 active sur PROD », ou ce qui cloche (avec une capture si possible).

## Ce que j'ai vérifié avant livraison
- Série automatique complète rejouée sur la version finale (la série « c1 » se vérifie à la construction automatique, comme avant).
- Nouveau test dédié (avec l'option désactivée) : adresse reprise de la fiche client, enregistrée avec la facture, affichée à l'aperçu ; numéro FA- avec le préfixe, F sans réglage ; fiche client complétée.

## CE QUI RESTE DE VOTRE RESSORT
**À faire maintenant**
- Déposer ce paquet sur le dépôt de production (étapes 1 et 2), attendre le vert, faire les vérifications de l'étape 4 et me dire « v253 active sur PROD ».

**Décisions à prendre**
- **Numérotation qui repart de 0001 chaque année** (par exemple 2026-0001) : à valider avec votre expert-comptable. Si oui, je la prépare avec le script SQL correspondant et sa procédure.

**Échéances et suivis**
- **Lundi 26 octobre** : vérifier la réception des e-mails de relance (Resend).
- Dans quelques jours : relancer le script 1 (journal) sur TEST et PROD ; garder le script 3 sous la main.

**Validations externes et démarches**
- Expert-comptable : document « Écarts fiscaux confirmés », crédit de TCA reporté, change (comptes 476/477), TCA sur l'abonnement logiciel.
- Relecture des documents juridiques par un avocat ; décision sur la sauvegarde à la minute ; récupération du 2FA ; compte MonCash de production ; choix des prestataires de test d'intrusion ; règle « période clôturée » encore en observation.
