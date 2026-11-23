-- Correctif PROD — changement de rôle d'un membre en attente d'invitation
-- Projet PROD : cnmmxpwlgovzbcfqaxqm. Exécuter après validation TEST (faite le 17/11).
--
-- Cause : la fonction lock_invite_fields() remettait le rôle à l'ancienne valeur pour
-- toute invitation en attente (user_id vide), sans erreur. L'application affichait
-- « Rôle mis à jour » puis rechargeait l'ancien rôle.
--
-- Correctif : seul un administrateur de l'entreprise peut changer le rôle d'une
-- invitation en attente. L'invité qui réclame son invitation garde le verrou.
-- Email et entreprise restent verrouillés pour tous.

create or replace function public.lock_invite_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if OLD.user_id is null then
    -- Un administrateur de l'entreprise peut modifier le rôle de l'invitation.
    if auth.uid() is null or not exists (
      select 1 from public.company_members m
      where m.company_id = OLD.company_id
        and m.user_id = auth.uid()
        and m.role = 'Administrateur'
    ) then
      NEW.role := OLD.role;
    end if;
    NEW.company_id := OLD.company_id;
    NEW.email := OLD.email;
  end if;
  return NEW;
end;
$$;

-- Vérification : doit renvoyer une ligne avec la nouvelle définition
select proname, prosecdef from pg_proc where proname = 'lock_invite_fields';

/* ROLLBACK — remettre l'ancienne fonction (verrouillage du rôle pour toutes les invitations)
create or replace function public.lock_invite_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if OLD.user_id is null then
    NEW.role := OLD.role;
    NEW.company_id := OLD.company_id;
    NEW.email := OLD.email;
  end if;
  return NEW;
end;
$$;
*/
