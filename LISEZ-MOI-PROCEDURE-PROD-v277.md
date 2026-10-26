# Compta+ — version 277 — paquet PRODUCTION
**Assistant de contrôle : vérifications propres à Éducation, Import-export et Santé.**

À faire sur le dépôt **Compta-plus-** (production) uniquement. La v277 est validée sur TEST.

**Prérequis** : la v276 est active sur PROD (confirmé) et le workflow corrigé (`ubuntu-24.04`) est en place sur ce dépôt. **Aucun script SQL, aucune Edge Function.**

## Ce qui change (pour vous)
Comptabilité → **Assistant de contrôle** (forfaits Assisté et Extension) affiche maintenant, en plus des contrôles du journal, des points propres aux blocs d'activité **activés** de l'entreprise. Chaque point donne le **nom précis** (famille, dossier, assureur, lot, praticien), la **cause** (« Pourquoi c'est un problème ») et la **solution pas à pas** (« Comment corriger »). L'assistant **ne modifie rien tout seul** : ces points demandent votre jugement.

**Éducation**
- Élève actif **sans aucun frais** (rien ne lui sera facturé).
- **Frais impayés depuis plus de 60 jours**, regroupés par famille (important au-delà de 90 jours).

**Import-export**
- Marchandise **au port depuis plus de 7 jours** (important au-delà de 21).
- **Fournisseur non soldé** : importation livrée en stock depuis plus de 60 jours avec un reste à payer.
- **Client étranger n'a pas tout payé** : exportation expédiée ou livrée depuis plus de 45 jours avec un reste à recevoir.
- **Taux de change** manquant, ou inhabituel (écart de plus de 15 % par rapport à vos autres dossiers).

**Santé**
- **Assureur en retard** : part assureur non remboursée sur des factures de plus de 45 jours, regroupée par assureur.
- **Lot périmé** (important) et **lot qui expire dans 30 jours**.
- **Honoraires non versés** à un praticien depuis plus de 30 jours.

Les boutons de filtre **Éducation / Import-export / Santé** apparaissent seulement s'il y a des points de ce bloc. Un bloc non activé n'est jamais contrôlé. « Ignorer » fonctionne comme pour les autres points.

Numéro de version : **20260830-277**.

## Fichiers du paquet (7 fichiers)
| Dossier du paquet | Fichier | Où le déposer | Action |
|---|---|---|---|
| racine | tst-u27.cjs | à la racine du dépôt | **nouveau** (test de cette version) |
| racine | tst-lancer.mjs | à la racine du dépôt | remplace |
| racine | CARTE-DES-MODULES.md | à la racine du dépôt | remplace |
| src | 57-assistant-blocs.jsx | dossier `src` | **nouveau** |
| src | 17-compta-assistant-de-controle.jsx | dossier `src` | remplace |
| src | 12-application-principale.jsx | dossier `src` | remplace |
| src | 00-config.jsx | dossier `src` | remplace |

(3 fichiers de racine, 4 fichiers `src`, aucun script SQL.)

## Procédure pas à pas
### Étape 1 — Supabase
Rien à faire (pas de script SQL, pas d'Edge Function).

### Étape 2 — Les fichiers de la racine
Dépôt **Compta-plus-** → **Add file → Upload files** → glissez les 3 fichiers du dossier `racine` → **Commit changes**.

### Étape 3 — Les fichiers du dossier `src`
Dossier **src** → **Add file → Upload files** → glissez les 4 fichiers → **Commit changes**. Une construction démarre (25 à 40 minutes). Ne redéposez rien pendant ce temps.

### Étape 4 — Attendre le vert
Onglet **Actions** : « Construire le site » doit passer au **vert**. Si rouge : copiez-moi les lignes **ÉCHEC / FAIL** de l'étape en échec.

### Étape 5 — Vérifier sur le site de production
1. **Ctrl + Maj + R**. Version en bas du menu : **20260830-277**.
2. Prenez une entreprise en forfait **Assisté** (ou Extension) avec le bloc Éducation, Import-export ou Santé activé et quelques données (ex. un élève sans frais, un lot de médicaments périmé, un dossier d'importation « Arrivé au port » depuis plus de 7 jours).
3. Comptabilité → **Assistant de contrôle** : les points apparaissent, avec le filtre du bloc. Ouvrez « Comment corriger » : la cause et les étapes sont affichées.
4. Corrigez un point (ex. enregistrez le paiement d'un assureur) puis rouvrez l'assistant : le point a disparu.
5. Sur une entreprise sans ce bloc : aucun point de ce bloc.

## CE QUI RESTE DE VOTRE RESSORT
- Déposer le paquet, attendre le vert, tester rapidement (étape 5), puis me dire **« v277 active sur PROD »** (ou vos remarques).
- Relire les seuils (60, 7/21, 45, 30 jours, 15 %) : dites-moi s'ils conviennent à votre activité, je les ajuste.
- Compte **WhatsApp Business** dédié ; relire les messages de relance ; renseigner les réglages de facturation (logo, NIF, comment payer).
- Avant le **31 octobre 2026** : liste annuelle des versements. Lundi **26 octobre** : vérifier les e-mails de relance (Resend). **1–15 novembre** : retenues d'octobre. **1–15 décembre** : acomptes provisionnels.
- Expert-comptable : TCA sur les abonnements, mentions des factures, points Santé / Éducation / Import-export. Juriste : conditions d'utilisation (consentement WhatsApp, données patients et clients).
- Décisions en attente : retour en arrière de la base (PITR), récupération 2FA, compte MonCash de production, tests d'intrusion, règle « période clôturée », scénario de prix « Équilibré ».
