# Compta+ — version 276 — paquet PROD
**Validée sur TEST (v274, v275, v276).** Ce paquet est **cumulatif depuis la v271 (active sur PROD)** : il contient la v272 et la v273 (facturation des abonnements de Compta+ à ses clients), la v274 (cartes graphiques, relances par e-mail et WhatsApp, téléphone à l'inscription), la v275 (WhatsApp hors facture, promotions) et la v276 (choix de l'entreprise à facturer).

À faire sur le dépôt **compta-plus** (PROD) uniquement. **2 scripts SQL à exécuter AVANT de déposer les fichiers, dans cet ordre** (étape 1). **Aucune Edge Function à déployer** (l'envoi des e-mails de relance utilise la fonction `send-offer-email` déjà en place sur PROD). Pas de changement du workflow.

## Ce qui change (pour vous)
- **Facturation de Compta+ à ses clients** (Super admin → Facturation → Factures) :
  - facture d'inscription à 0 émise automatiquement à la création d'une entreprise ;
  - facture mensuelle (forfait + blocs d'activité) avec prorata de la première facture payante, facture du groupe Extension au nom de l'entreprise la plus ancienne, facture complémentaire en cours de mois ;
  - prix en dollars, facture établie en gourdes au taux affiché ; TCA en option (désactivée par défaut) ;
  - **sélecteur « Entreprise à facturer »** : toutes les entreprises payantes ou une seule ;
  - enregistrement des paiements, annulation avec motif (jamais d'effacement), facture imprimable du logo au mot de remerciement ;
  - tout présenté en cartes graphiques.
- **Relances** (Super admin → Facturation → Relances) : factures en retard, bouton **E-mail** (envoi immédiat) et bouton **WhatsApp** (ouvre WhatsApp avec le message prêt), envoi groupé par e-mail (jamais deux fois en 3 jours), messages modifiables dans Réglages de facturation.
- **WhatsApp hors facture** : carte « Écrire à un client sur WhatsApp », carte **Promotions** (uniquement les clients qui ont accepté), bouton WhatsApp dans la fiche de chaque entreprise.
- **Téléphone WhatsApp obligatoire à l'inscription** (avec case facultative pour les offres), modifiable dans Administration → Accès → Abonnement et factures → Vos coordonnées de contact.
- **Écran client « Abonnement et factures »** (Administration → Accès) : résumé, historique des factures, coordonnées de contact.
- Numéro de version : **20260830-276**.

## Fichiers du paquet (18 fichiers + ce LISEZ-MOI)
| Dossier du paquet | Fichier | Où le déposer | Action |
|---|---|---|---|
| supabase | facturation-abonnements.sql | **à copier dans Supabase** (étape 1, en premier) | **nouveau** |
| supabase | relances-whatsapp.sql | **à copier dans Supabase** (étape 1, en second) | **nouveau** |
| supabase | facturation-abonnements-RETOUR-ARRIERE.sql, relances-whatsapp-RETOUR-ARRIERE.sql | **à garder de côté**, ne pas les exécuter | **nouveau** (au cas où ; ils suppriment les factures et les téléphones) |
| racine | tst-u23.cjs, tst-u24.cjs, tst-u25.cjs, tst-u26.cjs | à la racine du dépôt | **nouveau** (tests de ces versions) |
| racine | tst-p3.cjs, tst-p6.cjs | à la racine du dépôt | remplace (le téléphone est saisi à l'inscription) |
| racine | tst-lancer.mjs, CARTE-DES-MODULES.md | à la racine du dépôt | remplace |
| src | 56-facturation-abonnements.jsx | dossier `src` | **nouveau** |
| src | 00-config.jsx, 12-application-principale.jsx, 39-administration-module.jsx, 43-super-admin.jsx, 50-secteurs-et-blocs.jsx | dossier `src` | remplace |

(8 fichiers de racine, 6 fichiers `src`, 4 scripts SQL dont 2 seulement à exécuter.)

## Procédure pas à pas
### Étape 1 — Supabase PROD (2 scripts SQL, à faire EN PREMIER, dans l'ordre)
**Script A — facturation-abonnements.sql**
1. Ouvrez votre projet Supabase **de PRODUCTION** → menu de gauche **SQL Editor** → **New query**.
2. Ouvrez `supabase/facturation-abonnements.sql` (bloc-notes), **copiez tout**, collez dans l'éditeur, cliquez **Run**.
3. Résultat attendu : « Success » puis un tableau d'**1 ligne** (id 1, issuer_name « Compta+ », vat_enabled false, vat_rate 10, les prix). Sinon, copiez-moi le message.

**Script B — relances-whatsapp.sql** (seulement après le script A)
1. **New query** (nouvelle requête vide).
2. Ouvrez `supabase/relances-whatsapp.sql`, **copiez tout**, collez, cliquez **Run**.
3. Résultat attendu : un tableau de **3 lignes avec le chiffre 3** (companies, billing_invoices, billing_settings). Sinon, copiez-moi le résultat.

Les deux scripts peuvent être rejoués sans risque. **Ne lancez jamais les fichiers RETOUR-ARRIERE.** **Aucune Edge Function.**

### Étape 2 — Les fichiers de la racine
Dépôt **compta-plus** → **Add file → Upload files** → glissez les 8 fichiers du dossier `racine` → **Commit changes**.

### Étape 3 — Les fichiers du dossier `src`
Dossier **src** → **Add file → Upload files** → glissez les 6 fichiers du dossier `src` → **Commit changes**. Une construction démarre (25 à 40 minutes). Ne redéposez rien pendant ce temps.

### Étape 4 — Attendre le vert
Onglet **Actions** : « Construire le site » doit passer au **vert**. Si rouge : ne touchez à rien, copiez-moi les lignes **ÉCHEC / FAIL** de l'étape en échec.

### Étape 5 — Vérifier sur le site de production
1. **Ctrl + Maj + R** (téléphone : fermez complètement puis rouvrez). Version en bas du menu : **20260830-276**.
2. Super admin → Facturation → **Réglages de facturation** : renseignez **logo, nom, NIF, adresse, téléphone, e-mail, « comment payer », mot de remerciement**, vérifiez les prix et le taux, relisez les **messages de relance**, puis **Enregistrer les réglages**. (Ces réglages de PROD sont séparés de ceux de TEST.)
3. Super admin → Facturation → Factures : le sélecteur « Entreprise à facturer » est dans la carte d'émission. **N'émettez pas encore pour tout le monde** : choisissez d'abord UNE entreprise de test, émettez, ouvrez la facture (Voir / Imprimer) et vérifiez le nom, les lignes, le total en gourdes. Annulez-la avec un motif si c'était un essai.
4. Administration d'une entreprise → Accès → **Abonnement et factures** : saisissez votre numéro WhatsApp dans « Vos coordonnées de contact » et enregistrez.
5. Super admin → Relances : cartes « Écrire à un client sur WhatsApp » et « Promotions » présentes.
6. Créer un compte neuf n'est pas nécessaire : vérifiez simplement, dans un navigateur privé si vous voulez, que l'écran de bienvenue demande le téléphone WhatsApp.

## CE QUI RESTE DE VOTRE RESSORT
- Dites-moi **« v276 active sur PROD »** quand c'est fait.
- **Décider du jour de la première émission** pour tous vos clients réels (étape 5-3 : essai sur une entreprise d'abord) et **informer vos clients** de la facturation (essai gratuit puis forfait).
- Renseigner les réglages de facturation de PROD (logo, NIF, coordonnées, comment payer) et relire les messages de relance.
- **Compte WhatsApp Business** dédié (application WhatsApp Business, numéro dédié, profil, message d'accueil, réponses rapides, catalogue).
- Si l'envoi d'e-mail de relance échoue avec « RESEND_API_KEY non configurée » sur PROD : le secret est à refaire (dites-le-moi, je détaille).
- Avant le **31 octobre 2026** : liste annuelle des versements. Lundi **26 octobre** : vérifier les e-mails de relance (Resend). **1–15 novembre** : retenues d'octobre. **1–15 décembre** : acomptes provisionnels.
- **Expert-comptable** : TCA sur vos abonnements, numérotation et conservation des factures, mentions légales obligatoires en Haïti ; points déjà notés (Santé, Éducation, Import-export).
- **Juriste** : conditions d'utilisation (consentement WhatsApp, protection des données des clients et des patients).
- Décisions en attente : retour en arrière de la base (PITR), récupération 2FA, compte MonCash de production (lien de paiement), prestataires de tests d'intrusion, règle « période clôturée », scénario de prix « Équilibré ».
