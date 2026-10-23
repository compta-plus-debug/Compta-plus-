# Compta+ — version 255 — paquet PROD
**Acomptes provisionnels (article 81) et liste annuelle des versements (article 95 du Code fiscal)**

À faire sur le dépôt **compta-plus-** (production) uniquement. Version validée sur le site de test. Aucune migration SQL, aucune Edge Function : rien à faire côté Supabase. Pas de changement du workflow.

**Prérequis / cumul** : ce paquet contient aussi la v254 (état des retenues DGI). Vous pouvez donc le déposer que le paquet PROD v254 soit déjà actif ou non : rien ne se perd.

## Ce qui change (pour vous)
1. **Acomptes provisionnels** — Rapports et analyse → Déclarations fiscales → Impôt sur le Revenu → régime « Réel ». Nouveau bloc : vous saisissez l'impôt établi pour l'avant-dernier exercice ; l'application calcule 60 % (acompte annuel), répartis en **deux tranches égales** : du 1er au 15 octobre et du 1er au 15 décembre. Une ligne « Acomptes déjà versés » se déduit de l'impôt à payer ; si les acomptes dépassent l'impôt, un message signale le **crédit à reporter** sur les acomptes suivants.
2. **Liste annuelle des versements** — Rapports et analyse → Déclarations fiscales → nouvel onglet « Liste annuelle des versements ». Pour l'exercice fiscal (1er octobre – 30 septembre) ou l'année civile, elle liste par bénéficiaire : **salaires, primes, boni** (depuis les bulletins de paie) et **loyers, honoraires et prestations, intérêts** (depuis les achats, d'après les comptes 613, 622 et 66), avec les retenues à la source. Export **PDF** et **CSV**. Échéance : du 1er au 31 octobre.
3. **NIF des bénéficiaires** : nouveau champ « NIF ou CIN » sur la fiche **employé** (Salaires) et sur la fiche **fournisseur** (Achats). Les lignes sans NIF sont signalées, car l'article 95 exige d'identifier chaque bénéficiaire.
- Numéro de version : **20260830-255**.

## À savoir
- Les dividendes, commissions, jetons de présence et autres versements ne sont pas calculés : à ajouter à la main sur le formulaire officiel.
- Les retenues des articles 96 et 97 (contrats de services, paiements à l'étranger) ne sont pas encore suivies : c'est le prochain chantier.
- L'impôt de l'avant-dernier exercice se saisit à la main (il ne peut pas être déduit de vos écritures de l'année en cours).
- L'écran Impôt sur le Revenu reste calculé sur l'année civile ; le passage à l'exercice octobre–septembre est à décider avec votre expert-comptable.

## Fichiers du paquet (11 fichiers)
| Dossier du paquet | Fichier | Où le déposer dans le dépôt | Action |
|---|---|---|---|
| racine | tst-lancer.mjs | à la racine | remplace |
| racine | tst-u7.cjs | à la racine | **nouveau** (ou remplace s'il existe déjà) |
| racine | tst-u8.cjs | à la racine | **nouveau** |
| racine | CARTE-DES-MODULES.md | à la racine | remplace |
| src | 00-config.jsx | dossier `src` | remplace |
| src | 12-application-principale.jsx | dossier `src` | remplace |
| src | 24-achats.jsx | dossier `src` | remplace |
| src | 27-paie.jsx | dossier `src` | remplace |
| src | 28-declarations-fiscales.jsx | dossier `src` | remplace |
| src | 35-rapports-et-bilans.jsx | dossier `src` | remplace |
| src | index.modele.html | dossier `src` | remplace |

## Procédure pas à pas
### Étape 1 — Les fichiers de la racine
1. Page d'accueil du dépôt **compta-plus-** → **Add file → Upload files**.
2. Glissez les 4 fichiers du dossier `racine`.
3. **Commit changes**.

### Étape 2 — Les fichiers du dossier `src`
1. Ouvrez le dossier **src** → **Add file → Upload files**.
2. Glissez les 7 fichiers du dossier `src` du paquet.
3. **Commit changes**. Une construction démarre (25 à 40 minutes). Ne redéposez rien pendant ce temps.

### Étape 3 — Attendre le vert
Onglet **Actions** : la dernière ligne « Construire le site » doit passer au **vert**. Si elle passe au rouge, ne touchez à rien et copiez-moi le texte de l'étape en échec.

### Étape 4 — Vérifier sur le site réel
1. **Ctrl + Maj + R** (téléphone : fermez complètement l'application puis rouvrez-la). Le numéro en bas du menu doit être **20260830-255**.
2. **NIF** : Salaires (RH) → fiche d'un employé → renseignez « NIF ou CIN » ; Achats → Fournisseurs → idem pour un fournisseur.
3. **Liste annuelle** : Rapports et analyse → Déclarations fiscales → « Liste annuelle des versements ». Choisissez l'exercice qui contient vos bulletins ; vérifiez les lignes, les totaux, l'avertissement « sans NIF » pour un bénéficiaire sans NIF, puis les boutons PDF et CSV.
4. **Acomptes** : Impôt sur le Revenu → « Réel » → saisissez 1 000 000 comme impôt de l'avant-dernier exercice : vous devez voir acompte annuel **600 000**, tranche 1 **300 000** (1er–15 octobre), tranche 2 **300 000** (1er–15 décembre).
5. Dites-moi « v255 active sur PROD », ou ce qui cloche (avec une capture si possible).

## Ce que j'ai vérifié avant livraison
- Série automatique complète rejouée sur la version finale (la série « c1 » se vérifie à la construction automatique, comme avant).
- Nouveau test dédié (u8) : calcul 60 % et tranches, crédit d'acomptes, lignes et totaux de la liste annuelle, exclusion des bulletins annulés et des périodes hors exercice, avertissement sans NIF, message vide.

## CE QUI RESTE DE VOTRE RESSORT
**À faire maintenant**
- Déposer ce paquet sur le dépôt de production (étapes 1 et 2), attendre le vert, faire les vérifications de l'étape 4 et me dire « v255 active sur PROD » (cela couvre aussi la v254).

**Décisions à prendre**
- **Numérotation qui repart de 0001 chaque année** : à valider avec votre expert-comptable ; si oui, je prépare le script SQL.
- **Exercice octobre–septembre dans l'impôt sur le revenu** (au lieu de l'année civile) : à confirmer avec l'expert-comptable.

**Échéances et suivis**
- **Liste annuelle des versements** : à déposer du 1er au 31 octobre 2026 pour l'exercice clos le 30 septembre 2026 ; **acomptes** : 1er–15 octobre et 1er–15 décembre.
- **Versement des retenues d'octobre** : entre le 1er et le 15 novembre 2026.
- **Lundi 26 octobre** : vérifier la réception des e-mails de relance (Resend).
- Dans quelques jours : relancer le script 1 (journal) sur TEST et PROD ; garder le script 3 sous la main.

**Validations externes et démarches**
- Expert-comptable : « Écarts fiscaux confirmés », crédit de TCA reporté, change (476/477), TCA sur l'abonnement logiciel, adresse client facultative, taux de retenue sur primes, traitement des acomptes et de la liste des versements.
- Relecture des documents juridiques par un avocat ; décision sur la sauvegarde à la minute ; récupération du 2FA ; compte MonCash de production ; prestataires de test d'intrusion ; règle « période clôturée » en observation.
