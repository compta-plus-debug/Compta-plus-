// faux Supabase en mémoire pour tester l'application complète
(function(){
const S = window.__srv = { failSetKeys: [], hang: false, tables: {}, kv: {}, invCounter: 100, calls: [], net: true, stockRpcFailAfterApply: false, nextRpcFail: 0 };
const NET = () => S.net && navigator.onLine !== false;
const HNG = () => S.offlineHang && !NET(); // simule le vrai client Supabase hors ligne : l'appel reste en attente (rafraîchissement du jeton)
const NEVER = () => new Promise(() => {});
const netErr = () => ({ data: null, error: { message: "TypeError: Failed to fetch", code: "" } });
S.user = { id: "u1", email: "a@x.com" };
S.tables.company_members = [{ id: 1, company_id: "c1", role: "Administrateur", email: "a@x.com", user_id: "u1", is_assisted_supervisor: false, created_at: "2026-01-01" }];
S.tables.companies = [{ id: "c1", name: "Lakay SA", plan_status: "active", plan_tier: "standard", trial_ends_at: null, security_pin_hash: null, group_id: null }];
function builder(table) {
  const st = { f: [], op: "select", payload: null, single: false, maybe: false, limit: null };
  const api = {};
  ["select","order","like","neq","gt","lt","gte","lte","not","or","filter","range","contains"].forEach(m => api[m] = () => api);
  api.eq = (c, v) => { st.f.push(r => r[c] === v); return api; };
  api.in = (c, vs) => { st.f.push(r => vs.includes(r[c])); return api; };
  api.ilike = (c, v) => { st.f.push(r => String(r[c] || "").toLowerCase() === String(v).toLowerCase()); return api; };
  api.is = (c, v) => { st.f.push(r => v === null ? (r[c] == null) : r[c] === v); return api; };
  api.limit = (n) => { st.limit = n; return api; };
  api.single = () => { st.single = true; return api; };
  api.maybeSingle = () => { st.maybe = true; return api; };
  api.insert = (p) => { st.op = "insert"; st.payload = p; return api; };
  api.upsert = (p) => { st.op = "upsert"; st.payload = p; return api; };
  api.update = (p) => { st.op = "update"; st.payload = p; return api; };
  api.delete = () => { st.op = "delete"; return api; };
  const run = () => {
    if (!NET()) return netErr();
    if (table === "kv_store") {
      const rows = S.kvMulti ? Object.entries(S.kvMulti).flatMap(([cid, m]) => Object.entries(m).map(([k, v]) => ({ company_id: cid, key: k, value: v }))) : Object.entries(S.kv).map(([k, v]) => ({ company_id: "c1", key: k, value: v }));
      if (st.op === "upsert") { const p = Array.isArray(st.payload) ? st.payload : [st.payload]; const _dat = (v) => { try { return JSON.stringify(JSON.parse(v).data); } catch (e) { return null; } }; const _rr = p.find(x => S.ruleRefuse && S.ruleRefuse[x.key] && _dat(x.value) !== _dat(S.kv[x.key])); if (_rr) return { data: null, error: { message: "REGLE|test_regle|" + S.ruleRefuse[_rr.key], code: "P0001" } }; if (p.some(x => S.failSetKeys.includes(x.key))) return { data: null, error: { message: "TypeError: Failed to fetch", code: "" } }; p.forEach(x => { S.kv[x.key] = x.value; S.calls.push("kv.set " + x.key); }); return { data: p, error: null }; }
      let out = rows.filter(r => st.f.every(f => f(r)));
      if (st.op === "delete") { out.forEach(r => delete S.kv[r.key]); return { data: null, error: null }; }
      if (st.single || st.maybe) return { data: out[0] || null, error: null };
      return { data: out, error: null };
    }
    if (S.tableMissing && S.tableMissing[table]) return { data: null, error: { message: 'relation "public.' + table + '" does not exist', code: "42P01" } };
    const t = S.tables[table] || (S.tables[table] = []);
    if (st.op === "delete") { const del = t.filter(r => st.f.every(f => f(r))); del.forEach(r => t.splice(t.indexOf(r), 1)); return { data: del, error: null }; }
    if (st.op === "insert" && table === "compta_comments") { const p = (Array.isArray(st.payload) ? st.payload : [st.payload]).map(x => Object.assign({ id: "cm" + (t.length + 1) + "_" + Math.random().toString(36).slice(2, 6), status: "ouvert", created_at: new Date().toISOString(), author_user_id: S.user.id, resolved_at: null, resolved_by: null }, x)); p.forEach(x => t.push(x)); return { data: p, error: null }; }
    if (st.op === "insert" || st.op === "upsert") { const p = Array.isArray(st.payload) ? st.payload : [st.payload]; p.forEach(x => t.push(x)); return { data: p, error: null }; }
    let out = t.filter(r => st.f.every(f => f(r)));
    if (st.op === "update") { out.forEach(r => Object.assign(r, st.payload)); return { data: out, error: null }; }
    if (st.single || st.maybe) return { data: out[0] || null, error: null };
    return { data: st.limit ? out.slice(0, st.limit) : out, error: null };
  };
  api.then = (res, rej) => (S.hang || HNG() ? new Promise(() => {}) : Promise.resolve().then(run)).then(res, rej);
  return api;
}
const kvGet = (k) => { const v = S.kv[k]; return v ? JSON.parse(v) : null; };
const kvSet = (k, d) => { S.kv[k] = JSON.stringify(d); };
S.getCat = (c) => { const x = kvGet("compta-" + c); return x && x.data !== undefined ? x.data : x; };
S.setCat = (c, d) => { const x = kvGet("compta-" + c); kvSet("compta-" + c, { v: ((x && x.v) || 0) + 1, data: d }); };
const client = {
  auth: {
    getSession: async () => HNG() ? NEVER() : S.sessionNull ? ({ data: { session: null }, error: null }) : ({ data: { session: { access_token: "t", user: S.user } }, error: null }),
    getUser: async () => HNG() ? NEVER() : ({ data: { user: S.user }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => ({}),
    mfa: { getAuthenticatorAssuranceLevel: async () => HNG() ? NEVER() : ({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null }), listFactors: async () => ({ data: { totp: [] }, error: null }) },
  },
  from: builder,
  storage: { from: (bucket) => ({
    upload: async (path, blob, opts) => { S.calls.push("st.upload " + bucket); if (S.storageFail) return { data: null, error: { message: S.storageFail } }; (S.storage = S.storage || {})[bucket + "/" + path] = { size: blob && blob.size, type: opts && opts.contentType }; return { data: { path }, error: null }; },
    createSignedUrl: async (path) => { S.calls.push("st.sign " + path); if (S.signFail) return { data: null, error: { message: "x" } }; return { data: { signedUrl: "https://files.test/" + bucket + "/" + path + "?token=t" }, error: null }; },
    remove: async (paths) => { S.calls.push("st.remove " + paths.join(",")); if (S.removeFail) return { data: null, error: { message: "x" } }; paths.forEach((p) => { delete (S.storage || {})[bucket + "/" + p]; }); return { data: [], error: null }; },
    list: async (prefix) => { S.calls.push("st.list " + prefix); const pre = bucket + "/" + prefix + "/"; const out = Object.keys(S.storage || {}).filter((k) => k.startsWith(pre) && !k.slice(pre.length).includes("/")).map((k) => ({ name: k.slice(pre.length), id: "o" + k, created_at: "2026-10-16T20:00:00Z", metadata: { size: S.storage[k].size, mimetype: S.storage[k].type } })); return { data: out, error: null }; },
    getPublicUrl: (p) => ({ data: { publicUrl: "https://files.test/pub/" + p } }),
  }) },
  rpc: async (name, args) => {
    S.calls.push("rpc " + name);
    if (S.hang || HNG()) return new Promise(() => {});
    if (!NET()) return netErr();
    if (S.nextRpcFail > 0 && name === "commit_sale_stock") { S.nextRpcFail--; if (S.stockRpcFailAfterApply) applyStock(args); return netErr(); }
    if (S.rpcH && S.rpcH[name]) return S.rpcH[name](args);
    if (name === "next_invoice_number") return { data: ++S.invCounter, error: null };
    if (name === "commit_sale_stock") return { data: applyStock(args), error: null };
    return { data: null, error: null };
  },
  functions: { invoke: async (name, o) => { S.calls.push('fn ' + name); S.lastFn = { name, body: o && o.body }; if (S.fnH && S.fnH[name]) return S.fnH[name](o); return { data: null, error: { message: 'x' } }; } },
  channel: () => ({ on() { return this; }, subscribe() { return this; } }),
  removeChannel() {},
};
function applyStock(args) {
  const x = kvGet("compta-products"); const prods = (x && x.data) || [];
  const insuff = [];
  args.sale_lines.forEach(l => { const p = prods.find(q => q.id === l.productId); if (!p || (p.stock || 0) < l.qty) insuff.push({ name: p ? p.name : "?", available: p ? p.stock : 0, requested: l.qty }); });
  if (insuff.length) return { ok: false, insufficient: insuff };
  args.sale_lines.forEach(l => { const p = prods.find(q => q.id === l.productId); p.stock -= l.qty; });
  const m = kvGet("compta-movements"); const mv = (m && m.data) || [];
  args.sale_lines.forEach(l => mv.push({ id: Math.floor(Math.random() * 1e12), invoiceId: args.p_invoice_id, date: args.p_date, productId: l.productId, productName: prods.find(q => q.id === l.productId).name, type: "sortie", qty: l.qty, reason: "Vente " + args.p_invoice_number }));
  kvSet("compta-products", { v: ((x && x.v) || 0) + 1, data: prods }); kvSet("compta-movements", { v: ((m && m.v) || 0) + 1, data: mv });
  S.calls.push("applied " + args.p_invoice_number);
  return { ok: true, insufficient: [] };
}
window.supabase = { createClient: () => client };
})();
