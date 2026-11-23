-- Vérification PROD avant v340 — lecture seule
-- Projet PROD : cnmmxpwlgovzbcfqaxqm (lecture seule)
-- Ce fichier est en LECTURE SEULE : il ne modifie aucune donnée.
-- Remplacer l'adresse e-mail de l'invité dans les sections B et C.

-- ==========================================================================
-- A. Règles RLS et déclencheurs actifs sur company_members (à m'envoyer)
-- ==========================================================================
select policyname, cmd, roles, qual as condition_using, with_check
from pg_policies
where schemaname = 'public' and tablename = 'company_members'
order by cmd, policyname;

select tgname, tgenabled, pg_get_triggerdef(oid) as definition
from pg_trigger
where tgrelid = 'public.company_members'::regclass and not tgisinternal
order by tgname;

-- ==========================================================================
-- B. État de l'invitation AVANT le changement de rôle dans l'application
--    (remplacer l'adresse e-mail ci-dessous)
-- ==========================================================================
select id, company_id, email, role, user_id, invite_token, is_primary_admin, created_at
from company_members
where lower(email) = lower('EMAIL_DE_L_INVITE@exemple.com');

-- ==========================================================================
-- C. État APRÈS avoir changé le rôle dans l'application puis rechargé la page
--    Si role = le nouveau rôle : la base a bien enregistré, le problème est à l'affichage.
--    Si role = Administrateur : la base a refusé sans erreur (mise à jour à 0 ligne).
-- ==========================================================================
select id, company_id, email, role, user_id, invite_token, is_primary_admin, created_at
from company_members
where lower(email) = lower('EMAIL_DE_L_INVITE@exemple.com');
