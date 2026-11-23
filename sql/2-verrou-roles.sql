-- v340 — Verrou des rôles d'administrateur (base de données)
-- À exécuter d'abord sur TEST, puis sur PROD après validation.
-- Ne modifie aucun rôle existant. Ajoute seulement un trigger sur company_members.
-- Règles :
--   1. Personne (connecté dans l'application) ne peut modifier son propre rôle.
--   2. Une entreprise garde toujours au moins un Administrateur.
-- Exemptions : opérations sans utilisateur connecté (SQL Editor, service_role, Edge Functions).

create or replace function public.cm_protect_admin_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  other_admins int;
begin
  -- Opérations serveur / SQL Editor : aucun utilisateur connecté, on laisse passer.
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  -- 1. Personne ne modifie son propre rôle dans une entreprise
  if tg_op = 'UPDATE' and old.user_id is not null and old.user_id = auth.uid()
     and new.role is distinct from old.role then
    raise exception 'REGLE|CM_SELF_ROLE|Vous ne pouvez pas modifier votre propre rôle dans cette entreprise. Demandez à un autre administrateur.';
  end if;

  -- 2. Une entreprise garde au moins un administrateur
  if old.role = 'Administrateur' and (tg_op = 'DELETE' or new.role is distinct from 'Administrateur') then
    select count(*) into other_admins
      from company_members
     where company_id = old.company_id
       and role = 'Administrateur'
       and id <> old.id;
    if other_admins = 0 then
      raise exception 'REGLE|CM_LAST_ADMIN|Cette entreprise doit garder au moins un administrateur.';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.cm_protect_admin_role() from public, anon, authenticated;

drop trigger if exists cm_protect_admin_role on public.company_members;
create trigger cm_protect_admin_role
  before update or delete on public.company_members
  for each row execute function public.cm_protect_admin_role();

-- Vérification : le trigger doit apparaître (1 ligne)
select tgname, tgenabled from pg_trigger where tgname = 'cm_protect_admin_role' and not tgisinternal;
