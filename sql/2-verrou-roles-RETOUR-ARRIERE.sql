-- Retour arrière du verrou des rôles (v340)
drop trigger if exists cm_protect_admin_role on public.company_members;
drop function if exists public.cm_protect_admin_role();
-- Vérification : doit renvoyer 0 ligne
select tgname from pg_trigger where tgname = 'cm_protect_admin_role' and not tgisinternal;
