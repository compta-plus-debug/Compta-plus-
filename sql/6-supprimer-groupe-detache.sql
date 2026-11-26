-- v364 — Suppression d'un groupe par l'administrateur de la plateforme (les entreprises sont détachées).
-- À exécuter UNIQUEMENT après relecture. Déjà exécuté sur TEST (projet de test) le 26/11/2026.
-- Retour arrière : supprimer la fonction avec « drop function public.delete_group_detach(uuid); ».

create or replace function public.delete_group_detach(target_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g record;
  admin_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if not exists (select 1 from public.platform_admins where lower(email) = admin_email) then
    raise exception 'Réservé à l''administrateur de la plateforme' using errcode = '42501';
  end if;
  select * into g from public.company_groups where id = target_group_id;
  if not found then
    raise exception 'Groupe introuvable';
  end if;
  update public.companies
     set group_id = null,
         plan_tier = 'standard',
         plan_status = case when g.trial_ends_at is not null and g.trial_ends_at > now()
                            then 'trial' else 'suspended' end,
         trial_ends_at = coalesce(g.trial_ends_at, trial_ends_at)
   where group_id = target_group_id;
  delete from public.company_groups where id = target_group_id;
end;
$$;

revoke all on function public.delete_group_detach(uuid) from public, anon;
grant execute on function public.delete_group_detach(uuid) to authenticated;
