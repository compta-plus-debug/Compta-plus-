# Compta+ v315 (PROD) — Factures et écritures enregistrées ensemble (atomique) + réparation en un clic

Cette version contient DEUX protections contre « facture créée, écriture absente » :

1. **Réparation en un clic** (Comptabilité > Journal > « Cohérence Facturation ↔ Journal ») : bouton vert « Régénérer les N écriture(s) manquante(s) ». Elle reconstruit l'écriture exactement comme la vente l'aurait faite (encaissement, produits, remise, frais, taxe, sortie de stock). Elle refuse, sans rien inventer, si la facture n'a pas de détail, si un article a disparu du catalogue, si des encaissements existent déjà, ou si la période est clôturée. Réservée à l'Administrateur.
2. **Enregistrement atomique** : à chaque nouvelle vente, la facture et ses écritures sont enregistrées dans UNE seule transaction côté base (tout ou rien). Si la fonction serveur n'est pas installée, l'application retombe automatiquement sur l'ancienne méthode (avec sa vérification différée) : rien ne casse.

Inclus aussi :
- le correctif v314 (écho de synchronisation) ;
- **Catalogue sans doublon** : un article ne peut exister qu'une fois (même nom = refus, sans tenir compte des majuscules, accents, espaces ; même code = refus), message « Cet article existe déjà au Catalogue » ;
- contrôles du formulaire article (prix négatif/démesuré, stock négatif, taxe hors 0-100 %, textes trop longs), plafond de quantité en vente, et messages d'alerte qui ne disparaissent plus trop tôt.

---
## PROCÉDURE COMPLÈTE — faites TEST d'abord, puis PROD

### Étape 1 — Installer la fonction côté base (Supabase) — projet cnmmxpwlgovzbcfqaxqm
1. Ouvrez https://supabase.com/dashboard et connectez-vous.
2. Cliquez sur le projet dont l'identifiant est **cnmmxpwlgovzbcfqaxqm** (vérifiez dans l'adresse de la page : `/project/cnmmxpwlgovzbcfqaxqm`).
3. Menu de gauche : **SQL Editor** > bouton **New query**.
4. Ouvrez le fichier `supabase/ventes-atomiques.sql` de ce zip avec le Bloc-notes, **Ctrl+A** puis **Ctrl+C**.
5. Collez dans l'éditeur Supabase (**Ctrl+V**), cliquez **Run** (ou Ctrl+Entrée).
6. Résultat attendu : un tableau avec UNE ligne : `commit_sale_documents | target_company_id uuid, p_invoice jsonb, p_entries jsonb DEFAULT '[]'::jsonb`. Message vert « Success ».
7. Si un message rouge apparaît : ne cliquez sur rien d'autre, faites-moi une capture.
Cette étape ne modifie aucune de vos données.

### Étape 2 — Déposer les fichiers dans GitHub — dépôt Compta-plus-
1. Décompressez le zip sur votre ordinateur.
2. Ouvrez le dépôt **Compta-plus-** > **Add file** > **Upload files**.
3. Dossier `src` du zip (5 fichiers : 00-config.jsx, 08-composants-et-utilitaires.jsx, 12-application-principale.jsx, 19-compta-module.jsx, 23-vente.jsx) : glissez-les dans le dossier **src/** du dépôt (là où se trouvent déjà les fichiers du même nom).
4. Dossier `racine` du zip (7 fichiers : tst-fake.js, tst-u46.cjs, tst-u47.cjs, tst-u48.cjs, tst-u49.cjs, tst-lancer.mjs, CARTE-DES-MODULES.md) : glissez-les **à la racine** du dépôt.
5. Dossier `supabase` du zip (2 fichiers .sql) : conservez-les dans le dossier **supabase/** du dépôt (simple archivage, GitHub ne les exécute pas).
6. Message de commit : « v315 ventes atomiques et réparation » > **Commit changes**.
7. Onglet **Actions** : attendez la coche verte (≈ 40 min). Si rouge : copiez-moi le journal.
8. Rechargez l'application en forçant (Ctrl+Maj+R). Version attendue : **20261102-315**.

### Étape 3 — Vérifier (5 minutes)
1. Faites une vente test (Vente > un article > Valider la vente). Comptabilité > Journal : l'écriture « Vente … » est là, et « Cohérence Facturation ↔ Journal » indique « aucun écart détecté ».
2. Coupez le Wi-Fi 2 secondes pendant une vente : la vente doit soit s'enregistrer complètement, soit être mise en file hors ligne — jamais une facture sans écriture.
3. Pour une facture déjà orpheline : Comptabilité > Journal > « Cohérence » > « Voir le détail » > « Régénérer l'écriture » (ou le bouton vert global). Les cas non fiables sont expliqués ligne par ligne (« Vérification manuelle : … »).

### Retour arrière (si besoin)
Supabase > SQL Editor : collez `supabase/ventes-atomiques-RETOUR-ARRIERE.sql` > Run. L'application retombe aussitôt sur l'ancienne méthode, sans perte de données.

---
## Ce qui reste de votre ressort
1. Cette procédure : TEST (étapes 1-3), puis PROD (mêmes étapes avec le zip PROD et le projet cnmmxpwlgovzbcfqaxqm). Confirmez-moi le build vert et la version 315 affichée.
2. Pour l'utilisateur concerné : après la mise à jour, ouvrir Comptabilité > Journal > Cohérence et cliquer « Régénérer… » ; me dire ce qui reste en « vérification manuelle ».
3. Test d'intrusion phase 1 (parité TEST/PROD, comptes d'essai) — dites-moi quand vous voulez le script d'isolation entre deux comptes.
4. Adopter les procédures 2FA et clôture de période (imprimer les codes de secours du Super Admin en 2 exemplaires).
5. Expert-comptable : valider les comptes des secteurs, fonds ONG, clôtures — avant d'activer Agriculture/ONG/Services chez de vrais clients.
6. Fiscal : acomptes 60 %/2 ou 75 %/3 ; échéance acomptes DGI du 1er au 15 décembre.
7. Juriste : reçus fiscaux, CGU/confidentialité, TCA sur abonnements.
8. Clients pilotes, témoignages, vidéos ; MonCash production et scénario de prix (peut attendre) ; pentest externe et PITR (facultatif).
