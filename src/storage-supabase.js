import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase-config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: {
    fetch: (url, options = {}) => fetch(url, { ...options, cache: "no-store" }),
  },
});

let _membership = null;

export async function resolveMembership() {
  if (_membership) return _membership;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Utilisateur non connecté");

  let { data: existing } = await supabase
    .from("company_members")
    .select("company_id, role, email")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    _membership = { companyId: existing.company_id, role: existing.role, email: existing.email };
    return _membership;
  }

  const { data: invite } = await supabase
    .from("company_members")
    .select("id, company_id, role")
    .ilike("email", user.email)
    .is("user_id", null)
    .maybeSingle();

  if (invite) {
    await supabase.from("company_members").update({ user_id: user.id }).eq("id", invite.id);
    _membership = { companyId: invite.company_id, role: invite.role, email: user.email };
    return _membership;
  }

  const { data: company, error: companyErr } = await supabase
    .from("companies")
    .insert({ name: "Mon Entreprise" })
    .select()
    .single();
  if (companyErr) throw companyErr;

  await supabase.from("company_members").insert({
    company_id: company.id, email: user.email, user_id: user.id, role: "Administrateur",
  });

  _membership = { companyId: company.id, role: "Administrateur", email: user.email };
  return _membership;
}

export function clearMembershipCache() {
  _membership = null;
}

window.storage = {
  async get(key, _shared = false) {
    const { companyId } = await resolveMembership();
    const { data, error } = await supabase
      .from("kv_store")
      .select("value")
      .eq("company_id", companyId)
      .eq("key", key)
      .maybeSingle();
    if (error || !data) return null;
    return { key, value: data.value, shared: false };
  },

  async set(key, value, _shared = false) {
    const { companyId } = await resolveMembership();
    const { error } = await supabase
      .from("kv_store")
      .upsert({ company_id: companyId, key, value, updated_at: new Date().toISOString() }, { onConflict: "company_id,key" });
    if (error) throw error;
    return { key, value, shared: false };
  },

  async delete(key, _shared = false) {
    const { companyId } = await resolveMembership();
    const { error } = await supabase.from("kv_store").delete().eq("company_id", companyId).eq("key", key);
    return { key, deleted: !error, shared: false };
  },

  async list(prefix = "", _shared = false) {
    const { companyId } = await resolveMembership();
    const { data, error } = await supabase
      .from("kv_store")
      .select("key")
      .eq("company_id", companyId)
      .like("key", `${prefix}%`);
    if (error) return { keys: [], prefix, shared: false };
    return { keys: (data || []).map((d) => d.key), prefix, shared: false };
  },
};
