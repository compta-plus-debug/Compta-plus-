# Compta+ v318 — réinitialisation : catalogue conservé + ventes hors ligne (inclut la v317)

**Cause trouvée** : une vente faite hors ligne reste dans une file locale de l'appareil et est rejouée automatiquement au retour du réseau. La réinitialisation ne la vidait pas : la facture et ses écritures revenaient.

**Correctif** : la réinitialisation vide la file de l'appareil ; les autres appareils écartent à la synchronisation toute vente mise en attente avant la dernière réinitialisation ; les contrôles différés ne remettent plus rien après une réinitialisation.

**SQL : aucun changement** (ne relancez rien dans Supabase). Rien d'autre que les fichiers de l'app.

## Procédure (TEST d'abord, puis PROD)
1. Décompressez le zip. Dossier `src` → à copier dans `src/` du dépôt (remplacer les 8 fichiers). Dossier `racine` → à copier à la racine du dépôt (tests + carte des modules ; remplacer).
2. Sur GitHub : dépôt → Add file → Upload files → glissez le contenu, message « v318 réinitialisation » → Commit directement sur main.
3. Onglet Actions : attendez la coche verte du déploiement (le test c1 peut montrer 2 vérifications Tailwind en local seulement ; en CI tout doit être vert).
4. Ouvrez l'app, rechargez avec Ctrl+Maj+R ; la version affichée doit être **20261102-318**.
5. Vérification : sur un appareil, passez hors ligne, faites une vente, remettez le réseau SANS attendre la synchronisation, réinitialisez tout, attendez 1 minute : aucune facture ne doit revenir (ni sur un second appareil rechargé).

## Test effectué
Navigateur : test u52 (file hors ligne vidée, aucune facture ne revient après 45 s, vente périmée écartée) et réinitialisation u41 existant à repasser. **La suite complète (~40 min) tourne encore** : ne déployez en PROD qu'après la coche verte sur TEST.

## Ce qui reste de votre côté
1. Déployer v317 (TEST puis PROD) et confirmer coche verte + version.
2. Refaire le test de réinitialisation ci-dessus sur 2 appareils.
3. Guide du test d'intrusion (TEST uniquement).
4. 2FA + procédures de clôture (imprimer les codes de secours Super Admin ×2).
5. Validation expert-comptable avant d'activer Agriculture/ONG/Services chez de vrais clients.
6. Question fiscale acomptes (60 %/2 vs 75 %/3) et acomptes DGI 1–15 décembre.
7. Juriste : reçus fiscaux, CGU/confidentialité, TCA sur abonnements, éditeur « Toris Technologie ».
8. Clients pilotes/témoignages ; MonCash production (peut attendre) ; pentest externe et PITR (optionnel).

## Ajout v318 — catalogue conservé
Quand vous réinitialisez en CONSERVANT le catalogue et que « Remettre à zéro les quantités en stock » est coché, seuls les articles de type « marchandise » étaient remis à zéro : un article de type « service » portant une quantité gardait son stock. Désormais toute quantité du catalogue conservé repasse à 0 (noms, prix, seuils conservés). Test u53 : catalogue de 2 articles (un service avec stock 12, une marchandise stock 40) → après réinitialisation, 2 articles conservés, stocks à 0. Vérifiez chez vous : réinitialisez en laissant « Catalogue produits » décoché, case « Remettre à zéro » cochée ; les quantités doivent être à 0.
