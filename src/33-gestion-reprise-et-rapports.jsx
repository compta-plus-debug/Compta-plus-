// ═══ MODULE ═══
// @module Gestion reprise et rapports
// @depends BZ_ATT_MAX_COUNT, BzAttLink, BzCard, BzEmpty, asstApplyFix, bzDiffDays, bzExcelRead, bzFixDate
//   bzNoAccent, bzNum, bzParseCSV, bzR, bzReadText, bzStoreAttachment, fmt, pjPickMark, todayStr
//   uid, useMemo, useState
// @exports BzJustificatifs, BzRapportBanque, BzReprise
// ═══ FIN DE L'EN-TÊTE ═══
// K:REP:START
// Reprise d'une comptabilité existante, rapport ventes ↔ banque, pièces justificatives.
// Fonctions pures (testées hors navigateur). Dépendent de bzNum, bzFixDate, bzNoAccent, bzR, bzDiffDays.
function repAccountType(code) {
  const c = String(code || "").replace(/\D/g, "");
  const two = c.slice(0, 2);
  if (c[0] === "1") return Number(two) >= 16 ? "Passif" : "Capitaux propres";
  if (c[0] === "2" || c[0] === "3") return "Actif";
  if (c[0] === "4") return /^41|^409|^46|^47/.test(c) ? "Actif" : "Passif";
  if (c[0] === "5") return /^519/.test(c) ? "Passif" : "Actif";
  if (c[0] === "6") return "Charge";
  if (c[0] === "7") return "Produit";
  return "Charge";
}
function repAmt(raw) {
  let s = String(raw == null ? "" : raw).trim().replace(/[−–—]/g, "-");
  if (!s) return { v: 0, side: null, neg: false };
  let side = null;
  const m = s.match(/^(.*?\d)\s*([A-Za-zéÉ]+)\.?\s*$/);
  if (m) {
    const w = bzNoAccent(m[2]);
    if (/^(c|cr|cred\w*)$/.test(w)) { side = "C"; s = m[1]; }
    else if (/^(d|dr|deb\w*)$/.test(w)) { side = "D"; s = m[1]; }
  }
  const v = bzNum(s);
  return { v: Math.abs(v), side, neg: v < 0 };
}
function repTable(text, wantRe) {
  const all = String(text || "").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() && l.replace(/[;,\t"\s]/g, ""));
  if (all.length === 0) return null;
  let hi = all.findIndex((l, i) => i < 20 && wantRe.test(bzNoAccent(l)));
  const probe = all[hi >= 0 ? hi : 0];
  const cnt = { "\t": (probe.match(/\t/g) || []).length, ";": (probe.match(/;/g) || []).length, ",": (probe.match(/,/g) || []).length };
  const sep = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
  if (!sep[1]) return null;
  const split = (l) => { const o = []; let cur = "", q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === sep[0] && !q) { o.push(cur); cur = ""; } else cur += ch; } o.push(cur); return o.map((x) => x.trim()); };
  return { head: hi >= 0 ? split(all[hi]) : null, rows: all.slice(hi >= 0 ? hi + 1 : 0).map(split) };
}
const REP_CODE = /^\d[\dA-Za-z.\-]*$/;
function repParseBalance(text) {
  const out = { rows: [], skipped: 0, found: false };
  const t = repTable(text, /^(?=.*(compte|account|cuenta|code))(?=.*(debit|credit|solde|balance|saldo))/);
  if (!t) return out;
  let iCode = 0, iName = 1, iDeb = -1, iCre = -1, iBal = -1;
  if (t.head) {
    const h = t.head.map(bzNoAccent);
    iCode = h.findIndex((x) => /(compte|account|cuenta|code|n°|numero)/.test(x) && !/(libelle|intitule|nom|name)/.test(x));
    if (iCode < 0) iCode = h.findIndex((x) => /(compte|account|cuenta|code)/.test(x));
    iName = h.findIndex((x, i) => i !== iCode && /(libelle|intitule|nom|name|desc|designation)/.test(x));
    iDeb = h.findIndex((x) => /debit|debe/.test(x));
    iCre = h.findIndex((x) => /credit|haber/.test(x));
    iBal = h.findIndex((x) => /solde|balance|saldo/.test(x));
    if (iCode < 0 || (iDeb < 0 && iCre < 0 && iBal < 0)) return out;
  } else {
    const w = Math.max(...t.rows.map((r) => r.length));
    if (w >= 4) { iDeb = 2; iCre = 3; } else if (w === 3) { iBal = 2; } else return out;
  }
  out.found = true;
  for (const c of t.rows) {
    const code = String(c[iCode] || "").replace(/\s+/g, "");
    if (!REP_CODE.test(code)) { if (c.some((x) => /\d/.test(x))) out.skipped++; continue; }
    let debit = 0, credit = 0;
    if (iDeb >= 0 || iCre >= 0) {
      debit = iDeb >= 0 ? repAmt(c[iDeb]).v : 0;
      credit = iCre >= 0 ? repAmt(c[iCre]).v : 0;
      if (iBal >= 0 && !debit && !credit) { const a = repAmt(c[iBal]); if (a.side === "C" || (!a.side && a.neg)) credit = a.v; else debit = a.v; }
    } else {
      const a = repAmt(c[iBal]);
      if (a.side === "C" || (!a.side && a.neg)) credit = a.v; else debit = a.v;
    }
    debit = bzR(debit); credit = bzR(credit);
    if (!debit && !credit) continue;
    out.rows.push({ code, name: iName >= 0 ? c[iName] || "" : "", debit, credit });
  }
  return out;
}
function repParseJournal(text) {
  const out = { rows: [], skipped: 0, found: false, dateOrder: "dmy" };
  const t = repTable(text, /^(?=.*date)(?=.*(compte|account|cuenta))(?=.*(debit|credit))/);
  if (!t || !t.head) return out;
  const h = t.head.map(bzNoAccent);
  const iDate = h.findIndex((x) => /date|fecha/.test(x));
  const iCode = h.findIndex((x) => /(compte|account|cuenta)/.test(x) && !/(libelle|intitule|nom|name)/.test(x));
  const iDeb = h.findIndex((x) => /debit|debe/.test(x));
  const iCre = h.findIndex((x) => /credit|haber/.test(x));
  const iPiece = h.findIndex((x, i) => i !== iDate && i !== iCode && /(piece|n°|num|ref|folio|document)/.test(x));
  const iLab = h.findIndex((x, i) => i !== iDate && i !== iCode && i !== iPiece && /(lib|desc|detail|memo|narrat|concept|intitule)/.test(x));
  if (iDate < 0 || iCode < 0 || (iDeb < 0 && iCre < 0)) return out;
  out.found = true;
  let dmy = 0, mdy = 0;
  t.rows.forEach((c) => { const m = String(c[iDate] || "").match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/); if (m) { if (Number(m[1]) > 12) dmy++; if (Number(m[2]) > 12) mdy++; } });
  out.dateOrder = mdy > 0 && dmy === 0 ? "mdy" : "dmy";
  for (const c of t.rows) {
    const date = bzFixDate(c[iDate], out.dateOrder);
    const code = String(c[iCode] || "").replace(/\s+/g, "");
    if (!date || !REP_CODE.test(code)) { if (c.some((x) => /\d/.test(x))) out.skipped++; continue; }
    const debit = bzR(iDeb >= 0 ? repAmt(c[iDeb]).v : 0), credit = bzR(iCre >= 0 ? repAmt(c[iCre]).v : 0);
    if (!debit && !credit) continue;
    out.rows.push({ date, piece: iPiece >= 0 ? String(c[iPiece] || "").trim() : "", code, label: iLab >= 0 ? c[iLab] || "" : "", debit, credit });
  }
  return out;
}
function repGroupJournal(rows) {
  const groups = [], byKey = new Map();
  let run = null;
  const closeRun = () => { if (run) { groups.push(run); run = null; } };
  for (const r of rows) {
    if (r.piece) {
      closeRun();
      const k = r.piece + "|" + r.date;
      let g = byKey.get(k);
      if (!g) { g = { piece: r.piece, date: r.date, label: r.label, lines: [] }; byKey.set(k, g); groups.push(g); }
      if (!g.label && r.label) g.label = r.label;
      g.lines.push({ account: r.code, debit: r.debit, credit: r.credit });
    } else {
      if (run && run.date !== r.date) closeRun();
      if (!run) run = { piece: "", date: r.date, label: r.label, lines: [] };
      if (!run.label && r.label) run.label = r.label;
      run.lines.push({ account: r.code, debit: r.debit, credit: r.credit });
      const d = bzR(run.lines.reduce((s, l) => s + l.debit, 0)), c = bzR(run.lines.reduce((s, l) => s + l.credit, 0));
      if (d === c && d > 0) closeRun();
    }
  }
  closeRun();
  groups.forEach((g, i) => { g.seq = i + 1; g.debit = bzR(g.lines.reduce((s, l) => s + l.debit, 0)); g.credit = bzR(g.lines.reduce((s, l) => s + l.credit, 0)); g.balanced = g.debit === g.credit; });
  return groups;
}
function repBuildBalance(rows, ctx) {
  const { date, entries, accounts, settings, mkId, nowIso, batchId, opts } = ctx;
  const res = { entry: null, newAccounts: [], error: "", warnings: [], totalDebit: 0, totalCredit: 0, gap: 0 };
  if (!rows || rows.length === 0) { res.error = "Aucune ligne de balance reconnue."; return res; }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { res.error = "Indiquez la date de reprise (jour d'ouverture de la comptabilité dans Compta+)."; return res; }
  if (settings && settings.lockDate && date <= settings.lockDate) { res.error = `Période clôturée jusqu'au ${settings.lockDate} : choisissez une date postérieure ou rouvrez la période.`; return res; }
  const act = (e) => !e.cancelledBy && !e.reversalOf;
  if ((entries || []).some((e) => act(e) && /^REP:BALANCE/.test(e.importRef || ""))) { res.error = "Une balance de reprise est déjà enregistrée. Annulez-la d'abord (« Reprises effectuées ») pour en importer une autre."; return res; }
  const agg = new Map();
  rows.forEach((r) => { const a = agg.get(r.code) || { code: r.code, name: r.name, debit: 0, credit: 0 }; a.debit = bzR(a.debit + r.debit); a.credit = bzR(a.credit + r.credit); if (!a.name && r.name) a.name = r.name; agg.set(r.code, a); });
  const lines = [];
  agg.forEach((a) => { const net = bzR(a.debit - a.credit); if (net > 0) lines.push({ account: a.code, debit: net, credit: 0 }); else if (net < 0) lines.push({ account: a.code, debit: 0, credit: -net }); });
  res.totalDebit = bzR(lines.reduce((s, l) => s + l.debit, 0));
  res.totalCredit = bzR(lines.reduce((s, l) => s + l.credit, 0));
  res.gap = bzR(res.totalDebit - res.totalCredit);
  if (res.gap !== 0) {
    if (!opts || !opts.balanceAccount) { res.error = `Balance déséquilibrée : débits ${res.totalDebit}, crédits ${res.totalCredit} (écart ${res.gap}). Corrigez le fichier, ou choisissez un compte pour absorber l'écart.`; return res; }
    lines.push(res.gap > 0 ? { account: opts.balanceAccount, debit: 0, credit: res.gap } : { account: opts.balanceAccount, debit: -res.gap, credit: 0 });
    res.warnings.push(`Écart de ${Math.abs(res.gap)} placé sur le compte ${opts.balanceAccount}.`);
  }
  const known = new Set((accounts || []).map((a) => a.code));
  const names = new Map(); agg.forEach((a) => names.set(a.code, a.name));
  const need = [...new Set(lines.map((l) => l.account))].filter((c) => !known.has(c));
  if (need.length && !(opts && opts.createAccounts === false)) need.forEach((c) => res.newAccounts.push({ code: c, name: names.get(c) || `Compte ${c}`, type: repAccountType(c) }));
  else if (need.length) { res.error = `Comptes absents du plan comptable : ${need.slice(0, 8).join(", ")}${need.length > 8 ? "…" : ""}.`; return res; }
  if ((entries || []).some((e) => act(e) && e.date >= date && !e.importRef)) res.warnings.push("Des écritures existent déjà à partir de cette date : la balance doit reprendre les soldes AVANT ces écritures.");
  res.entry = { id: mkId(), date, createdAt: nowIso, label: `Reprise de la comptabilité — balance d'ouverture au ${date}`, lines, importRef: `REP:BALANCE:${date}`, importBatch: batchId, source: "reprise" };
  return res;
}
function repBuildJournal(groups, ctx) {
  const { entries, accounts, settings, mkId, nowIso, batchId, opts } = ctx;
  const res = { entries: [], newAccounts: [], skipped: [], total: 0 };
  const act = (e) => !e.cancelledBy && !e.reversalOf;
  const done = new Set((entries || []).filter((e) => act(e) && e.importRef).map((e) => e.importRef));
  const known = new Set((accounts || []).map((a) => a.code));
  const added = new Set();
  groups.forEach((g) => {
    const ref = `REP:${g.piece || "N" + g.seq}:${g.date}`;
    const tag = g.piece || `ligne ${g.seq}`;
    if (!g.balanced) { res.skipped.push({ piece: tag, why: `déséquilibrée (débit ${g.debit}, crédit ${g.credit})` }); return; }
    if (settings && settings.lockDate && g.date <= settings.lockDate) { res.skipped.push({ piece: tag, why: `période clôturée (jusqu'au ${settings.lockDate})` }); return; }
    if (done.has(ref)) { res.skipped.push({ piece: tag, why: "déjà importée" }); return; }
    const miss = [...new Set(g.lines.map((l) => l.account))].filter((c) => !known.has(c));
    if (miss.length && opts && opts.createAccounts === false) { res.skipped.push({ piece: tag, why: `compte inconnu ${miss[0]}` }); return; }
    miss.forEach((c) => { if (!added.has(c)) { added.add(c); res.newAccounts.push({ code: c, name: `Compte ${c}`, type: repAccountType(c) }); } });
    done.add(ref);
    res.entries.push({ id: mkId(), date: g.date, createdAt: nowIso, label: `${g.label || "Écriture reprise"}${g.piece ? ` (pièce ${g.piece})` : ""}`, lines: g.lines.map((l) => ({ ...l })), importRef: ref, importBatch: batchId, source: "reprise" });
    res.total = bzR(res.total + g.debit);
  });
  return res;
}
// Rapprochement des entrées de banque (relevé ↔ journal) : un pour un, puis dépôt = somme de plusieurs écritures voisines.
function repMatchGroups(bankIn, bookIn, windowDays) {
  const w = windowDays == null ? 5 : windowDays;
  const used = new Set(), matches = [];
  const bank = bankIn.map((b, i) => ({ ...b, _i: i }));
  bank.forEach((b) => {
    let best = null;
    bookIn.forEach((e) => { if (used.has(e.id) || e.amount !== b.amount) return; const dd = Math.abs(bzDiffDays(b.date, e.date)); if (dd <= w && (!best || dd < best.dd)) best = { e, dd }; });
    if (best) { used.add(best.e.id); b._m = true; matches.push({ bank: b, entries: [best.e], kind: "1-1" }); }
  });
  bank.filter((b) => !b._m).forEach((b) => {
    const cand = bookIn.filter((e) => !used.has(e.id) && Math.abs(bzDiffDays(b.date, e.date)) <= w).sort((a, c) => (a.date < c.date ? -1 : a.date > c.date ? 1 : 0));
    for (let s = 0; s < cand.length && !b._m; s++) {
      let sum = 0;
      for (let k = s; k < Math.min(cand.length, s + 12); k++) {
        sum = bzR(sum + cand[k].amount);
        if (k > s && sum === b.amount) { const g = cand.slice(s, k + 1); g.forEach((e) => used.add(e.id)); b._m = true; matches.push({ bank: b, entries: g, kind: "groupe" }); break; }
        if (sum > b.amount) break;
      }
    }
  });
  return { matches, bankOnly: bank.filter((b) => !b._m), bookOnly: bookIn.filter((e) => !used.has(e.id)) };
}
function repSalesBankReport({ entries, bankLines, from, to, windowDays }) {
  const act = (e) => !e.cancelledBy && !e.reversalOf;
  const inR = (d) => (!from || d >= from) && (!to || d <= to);
  const sales = { total: 0, banque: 0, caisse: 0, credit: 0, cheques: 0, autres: 0, count: 0 };
  const bookIn = [];
  (entries || []).forEach((e) => {
    if (!act(e) || !inR(e.date)) return;
    const L = e.lines || [];
    const rev = bzR(L.filter((l) => /^70/.test(l.account)).reduce((s, l) => s + (Number(l.credit) || 0) - (Number(l.debit) || 0), 0));
    if (rev !== 0) {
      sales.count++; sales.total = bzR(sales.total + rev);
      L.forEach((l) => {
        const d = bzR((Number(l.debit) || 0) - (Number(l.credit) || 0));
        if (d <= 0 || /^70/.test(l.account)) return;
        if (l.account === "512") sales.banque = bzR(sales.banque + d);
        else if (l.account === "530") sales.caisse = bzR(sales.caisse + d);
        else if (/^411/.test(l.account)) sales.credit = bzR(sales.credit + d);
        else if (l.account === "5112") sales.cheques = bzR(sales.cheques + d);
        else sales.autres = bzR(sales.autres + d);
      });
    }
    const net = bzR(L.filter((l) => l.account === "512").reduce((s, l) => s + (Number(l.debit) || 0) - (Number(l.credit) || 0), 0));
    if (net > 0) bookIn.push({ id: e.id, date: e.date, label: e.label || "", amount: net, sale: rev !== 0 });
  });
  const bankIn = (bankLines || []).filter((b) => b.amount > 0 && inR(b.date));
  const m = repMatchGroups(bankIn, bookIn, windowDays);
  const sum = (a, f) => bzR(a.reduce((s, x) => s + f(x), 0));
  const bankTotal = sum(bankIn, (b) => b.amount), bookTotal = sum(bookIn, (b) => b.amount);
  return {
    sales, bankTotal, bookTotal, gap: bzR(bankTotal - bookTotal),
    matches: m.matches, bankOnly: m.bankOnly, bookOnly: m.bookOnly,
    matchedTotal: sum(m.matches, (x) => x.bank.amount),
    bankOnlyTotal: sum(m.bankOnly, (b) => b.amount), bookOnlyTotal: sum(m.bookOnly, (b) => b.amount),
    bankCount: bankIn.length, bookCount: bookIn.length,
  };
}
// Pièces justificatives : une écriture est justifiée par une pièce jointe, ou automatiquement quand elle découle d'un document déjà dans l'application.
function repJustify({ entries, bizdocs, from, to }) {
  const atts = (bizdocs || []).filter((d) => d.type === "attachment");
  const byRef = new Map();
  atts.forEach((a) => { byRef.set(a.ref, (byRef.get(a.ref) || 0) + 1); });
  const rows = [];
  (entries || []).forEach((e) => {
    if (e.cancelledBy || e.reversalOf) return;
    if ((from && e.date < from) || (to && e.date > to)) return;
    if (/^REP:BALANCE/.test(e.importRef || "")) return;
    let auto = "";
    if (e.invoiceId) auto = "facture de vente";
    else if (e.creditNoteId) auto = "avoir";
    else if (e.source === "import-pos") auto = "ticket POS importé";
    else if (e.source === "reprise") auto = "reprise de comptabilité";
    const own = byRef.get("e" + e.id) || 0;
    const pur = e.purchaseId ? byRef.get("p" + e.purchaseId) || 0 : 0;
    const n = own + pur;
    const amount = bzR((e.lines || []).reduce((s, l) => s + (Number(l.debit) || 0), 0));
    rows.push({ id: e.id, date: e.date, label: e.label || "", amount, auto, atts: n, ok: n > 0 || !!auto, purchaseId: e.purchaseId || "" });
  });
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const total = rows.length, justified = rows.filter((r) => r.ok).length;
  return { rows, total, justified, missing: total - justified, rate: total ? Math.round((justified / total) * 100) : 100 };
}
// K:REP:END

// ---------------------------------------------------------------- Reprise, rapport ventes ↔ banque, pièces justificatives
const repDownload = (name, rows) => {
  const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const blob = new Blob(["﻿" + rows.map((r) => r.map(esc).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const el = document.createElement("a");
  el.href = url; el.download = name; el.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const repMonthStart = () => { const d = todayStr(); return d.slice(0, 8) + "01"; };
async function repReadAny(f) {
  const nm = (f.name || "").toLowerCase();
  if (/\.(xlsx|xls)$/.test(nm)) { const xr = await bzExcelRead(f); return xr.csv; }
  return bzReadText(f);
}
function BzReprise({ P }) {
  const { entries, setEntries, accounts, setAccounts, settings, role, showToast, logAudit } = P;
  const canEdit = role === "Administrateur";
  const [mode, setMode] = useState("balance");
  const [date, setDate] = useState("");
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState(null);
  const [createAcc, setCreateAcc] = useState(true);
  const [balanceAcc, setBalanceAcc] = useState("");
  const [result, setResult] = useState(null);
  const [confirmCancel, setConfirmCancel] = useState(null);
  const [cancelMsg, setCancelMsg] = useState(null);
  const [fileMsg, setFileMsg] = useState(null);
  const analyse = () => {
    setResult(null);
    const p = mode === "balance" ? repParseBalance(text) : repParseJournal(text);
    setParsed({ mode, ...p, groups: mode === "journal" ? repGroupJournal(p.rows) : null });
  };
  const ctxBase = { entries, accounts, settings, opts: { createAccounts: createAcc, balanceAccount: balanceAcc } };
  const preview = (() => {
    if (!parsed || parsed.rows.length === 0) return null;
    if (parsed.mode === "balance") return { kind: "balance", ...repBuildBalance(parsed.rows, { ...ctxBase, date, mkId: () => "x", nowIso: "", batchId: "x" }) };
    return { kind: "journal", ...repBuildJournal(parsed.groups, { ...ctxBase, mkId: () => "x", nowIso: "", batchId: "x" }) };
  })();
  const canRun = !!preview && (preview.kind === "balance" ? !!preview.entry && !preview.error : preview.entries.length > 0);
  const onFile = async (e) => {
    const el = e.target; const f = el.files && el.files[0];
    if (!f) return;
    try { const t = await repReadAny(f); setText(t); setParsed(null); setResult(null); setFileMsg({ ok: true, text: `« ${f.name} » chargé. Cliquez sur « Analyser ».` }); }
    catch (err) { setFileMsg({ ok: false, text: (err && err.message) || "Lecture du fichier impossible." }); }
    finally { try { setTimeout(() => { el.value = ""; }, 0); } catch (x) { /* ignoré */ } }
  };
  const run = () => {
    if (!canEdit) { showToast("Seul un administrateur peut importer une reprise de comptabilité."); return; }
    if (!canRun) return;
    const batchId = uid();
    const base = { ...ctxBase, mkId: uid, nowIso: new Date().toISOString(), batchId };
    const res = parsed.mode === "balance" ? repBuildBalance(parsed.rows, { ...base, date }) : repBuildJournal(parsed.groups, base);
    const list = parsed.mode === "balance" ? (res.entry ? [res.entry] : []) : res.entries;
    if (!list.length || res.error) { showToast(res.error || "Rien à importer."); return; }
    if (res.newAccounts.length) setAccounts((prev) => [...prev, ...res.newAccounts.filter((a) => !prev.some((x) => x.code === a.code))]);
    setEntries((prev) => [...prev, ...list]);
    logAudit("Comptabilité", parsed.mode === "balance" ? "Reprise : balance d'ouverture" : "Reprise : journal historique", `${list.length} écriture(s), ${res.newAccounts.length} compte(s) créé(s)`);
    showToast(`Reprise enregistrée : ${list.length} écriture(s).`);
    setResult({ done: list.length, accounts: res.newAccounts.length, skipped: res.skipped || [], kind: parsed.mode });
    setParsed(null); setText("");
  };
  const batches = (() => {
    const m = {};
    (entries || []).forEach((e) => { if (e.source === "reprise" && e.importBatch && !e.cancelledBy && !e.reversalOf) (m[e.importBatch] = m[e.importBatch] || []).push(e); });
    return Object.entries(m).map(([id, list]) => ({ id, list, total: list.reduce((s, e) => s + (e.lines || []).reduce((a, l) => a + (Number(l.debit) || 0), 0), 0), date: (list[0].createdAt || "").slice(0, 10), balance: list.some((e) => /^REP:BALANCE/.test(e.importRef || "")) })).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  })();
  const cancelBatch = (b) => {
    setConfirmCancel(null);
    if (!canEdit) { const m = "Seul un administrateur peut annuler une reprise."; setCancelMsg({ ok: false, text: m }); showToast(m); return; }
    const res = asstApplyFix({ kind: "reverse", entryIds: b.list.map((e) => e.id) }, { entries, accounts, settings, mkId: uid, today: todayStr(), nowIso: new Date().toISOString() });
    if (res.error) { setCancelMsg({ ok: false, text: res.error }); showToast(res.error); return; }
    setEntries(res.entries);
    logAudit("Comptabilité", "Annulation d'une reprise", `${b.list.length} écriture(s)`);
    setCancelMsg({ ok: true, text: `Reprise annulée par contrepassation (${b.list.length} écriture(s)). Vous pouvez en importer une nouvelle.` });
    showToast("Reprise annulée par contrepassation.");
  };
  const newCodes = new Set(preview && preview.newAccounts ? preview.newAccounts.map((a) => a.code) : []);
  return (
    <div className="space-y-5 min-w-0" data-testid="rep-import" style={{ overflowWrap: "anywhere" }}>
      <BzCard title="Reprise d'une comptabilité existante" id="reprise">
        <p className="text-xs mb-3" style={{ color: "#8A8370" }}>Reprenez la comptabilité tenue jusqu'ici dans un autre outil (Excel, ancien logiciel). Deux façons : la <b>balance d'ouverture</b> (les soldes de chaque compte à une date, en une seule écriture) ou le <b>journal historique</b> (toutes les écritures, pièce par pièce). Rien n'est supprimé : une reprise se contre-passe en un clic.</p>
        {!canEdit && <div className="text-xs mb-3 p-2 rounded" style={{ background: "#FBF1DC", color: "#8A6D1F" }}>Seul un administrateur peut importer ou annuler une reprise.</div>}
        <div className="flex flex-wrap gap-4 mb-3 text-sm">
          <label className="flex items-center gap-2"><input type="radio" name="repmode" checked={mode === "balance"} onChange={() => { setMode("balance"); setParsed(null); }} data-testid="rep-mode-balance" /> Balance d'ouverture</label>
          <label className="flex items-center gap-2"><input type="radio" name="repmode" checked={mode === "journal"} onChange={() => { setMode("journal"); setParsed(null); }} data-testid="rep-mode-journal" /> Journal historique</label>
        </div>
        <div className="text-xs mb-2" style={{ color: "#8A8370" }}>
          {mode === "balance" ? "Colonnes attendues : Compte, Libellé, Débit, Crédit (ou une colonne Solde, avec D/C ou un signe). Collez le tableau depuis Excel ou choisissez un fichier CSV / Excel." : "Colonnes attendues : Date, Pièce, Compte, Libellé, Débit, Crédit. Chaque pièce doit être équilibrée ; les autres sont signalées."}
        </div>
        {mode === "balance" && (
          <div className="mb-3 max-w-xs">
            <label className="text-xs" style={{ color: "#8A8370" }}>Date de reprise (jour d'ouverture dans Compta+)</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="rep-date" className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
          </div>
        )}
        <input type="file" accept="text/csv,text/plain,text/tab-separated-values,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.csv,.txt,.tsv,.xlsx,.xls" onChange={onFile} className="text-sm mb-1 max-w-full" data-testid="rep-file" data-ro-ok />
        {fileMsg && <div className="text-xs mb-2 p-2 rounded" style={{ background: fileMsg.ok ? "#EAF3EE" : "#F7E9E3", color: fileMsg.ok ? "#0F6B5C" : "#A6432F" }}>{fileMsg.text}</div>}
        <textarea data-testid="rep-text" value={text} onChange={(e) => { setText(e.target.value); setParsed(null); setResult(null); }} rows={7} placeholder={mode === "balance" ? "Compte;Libellé;Débit;Crédit\n101;Capital;;500000\n512;Banque;250000;\n…" : "Date;Pièce;Compte;Libellé;Débit;Crédit\n05/03/2026;F001;411;Vente;1000;\n05/03/2026;F001;707;Vente;;1000"} className="w-full border rounded px-2 py-1.5 text-xs font-mono" style={{ borderColor: "#DDD6C4", minWidth: 0 }} />
        <div className="flex flex-wrap items-center gap-3 mt-2">
          <button onClick={analyse} disabled={!text.trim()} data-testid="rep-analyse" data-ro-ok className="text-sm px-4 py-2 rounded" style={{ background: "#152238", color: "#EFE9DD", opacity: text.trim() ? 1 : 0.5 }}>Analyser</button>
          <label className="flex items-center gap-2 text-xs" style={{ color: "#152238" }}><input type="checkbox" checked={createAcc} onChange={(e) => setCreateAcc(e.target.checked)} data-testid="rep-create-acc" /> Créer les comptes absents du plan comptable</label>
        </div>
      </BzCard>
      {parsed && (
        <BzCard title="Aperçu avant import" id="reprise-preview">
          <div data-testid="rep-preview">
            {parsed.rows.length === 0 ? (
              <div className="text-sm" style={{ color: "#B3402F" }} data-testid="rep-error">Aucune ligne reconnue. {parsed.found ? "Les lignes n'ont ni compte numérique ni montant." : mode === "balance" ? "Il faut une ligne d'en-têtes avec Compte et Débit/Crédit (ou Solde), ou 3 à 4 colonnes : compte, libellé, débit, crédit." : "Il faut une ligne d'en-têtes avec Date, Compte, Débit et Crédit."}</div>
            ) : parsed.mode === "balance" ? (
              <>
                <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr style={{ color: "#8A8370" }}><th className="text-left font-normal py-1">Compte</th><th className="text-left font-normal">Libellé</th><th className="text-right font-normal">Débit</th><th className="text-right font-normal">Crédit</th><th className="pl-3 text-left font-normal"></th></tr></thead>
                  <tbody>{parsed.rows.map((r, i) => <tr key={i} style={{ borderTop: "1px solid #F3EFE3" }} data-testid="rep-row"><td className="py-1">{r.code}</td><td>{r.name}</td><td className="text-right tabular">{r.debit ? fmt(r.debit) : ""}</td><td className="text-right tabular">{r.credit ? fmt(r.credit) : ""}</td><td className="pl-3" style={{ color: "#B7791F" }}>{newCodes.has(r.code) ? "nouveau compte" : ""}</td></tr>)}</tbody>
                  <tfoot><tr style={{ borderTop: "2px solid #E4DFD1", fontWeight: 600 }}><td colSpan={2} className="py-1">Totaux</td><td className="text-right tabular" data-testid="rep-total-debit">{fmt(parsed.rows.reduce((s, r) => s + r.debit, 0))}</td><td className="text-right tabular" data-testid="rep-total-credit">{fmt(parsed.rows.reduce((s, r) => s + r.credit, 0))}</td><td></td></tr></tfoot></table></div>
                {preview && preview.error && <div className="mt-3 text-sm p-2 rounded" style={{ background: "#FBEDE9", color: "#8A2F1F" }} data-testid="rep-error">{preview.error}</div>}
                {preview && preview.gap !== 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" style={{ color: "#152238" }}>Absorber l'écart sur le compte :
                    <select value={balanceAcc} onChange={(e) => setBalanceAcc(e.target.value)} data-testid="rep-balance-account" className="border rounded px-2 py-1 text-xs" style={{ borderColor: "#DDD6C4" }}><option value="">— aucun (bloquer) —</option><option value="110">110 — Report à nouveau</option><option value="108">108 — Report d'ouverture</option></select>
                  </div>
                )}
              </>
            ) : (
              <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr style={{ color: "#8A8370" }}><th className="text-left font-normal py-1">Pièce</th><th className="text-left font-normal">Date</th><th className="text-left font-normal">Libellé</th><th className="text-right font-normal">Débit</th><th className="text-right font-normal">Crédit</th><th className="pl-3 text-left font-normal">État</th></tr></thead>
                <tbody>{parsed.groups.map((g, i) => { const sk = preview ? preview.skipped.find((s) => s.piece === (g.piece || `ligne ${g.seq}`)) : null; return <tr key={i} style={{ borderTop: "1px solid #F3EFE3" }} data-testid="rep-row"><td className="py-1">{g.piece || `#${g.seq}`}</td><td>{g.date}</td><td>{g.label}</td><td className="text-right tabular">{fmt(g.debit)}</td><td className="text-right tabular">{fmt(g.credit)}</td><td className="pl-3" style={{ color: sk ? "#B3402F" : "#2F7D4F" }}>{sk ? `Ignorée : ${sk.why}` : "Prête"}</td></tr>; })}</tbody></table></div>
            )}
            {parsed.skipped > 0 && <div className="mt-2 text-xs" style={{ color: "#8A8370" }}>{parsed.skipped} ligne(s) du fichier ignorée(s) (compte, date ou montant illisible).</div>}
            {preview && preview.warnings && preview.warnings.map((w, i) => <div key={i} className="mt-2 text-xs" style={{ color: "#8A6D1F" }}>{w}</div>)}
            {preview && preview.newAccounts && preview.newAccounts.length > 0 && <div className="mt-2 text-xs" style={{ color: "#8A8370" }}>{preview.newAccounts.length} compte(s) seront créés dans le plan comptable.</div>}
            <div className="flex flex-wrap items-center gap-3 mt-4">
              <button onClick={run} disabled={!canRun} data-testid="rep-run" className="text-sm px-4 py-2 rounded" style={{ background: "#0F6B5C", color: "#fff", opacity: canRun ? 1 : 0.5 }}>
                {parsed.mode === "balance" ? "Importer la balance d'ouverture" : `Importer ${preview && preview.entries ? preview.entries.length : 0} écriture(s)`}
              </button>
              {!canRun && parsed.rows.length > 0 && <span className="text-xs" data-testid="rep-why" style={{ color: "#B3402F" }}>{preview && preview.error ? preview.error : "Aucune écriture importable."}</span>}
            </div>
          </div>
        </BzCard>
      )}
      {result && (
        <div className="rounded-lg p-4 text-sm" style={{ background: "#F1F7F2", border: "1px solid #CFE3D4", color: "#152238" }} data-testid="rep-result">
          {result.done} écriture(s) reprise(s){result.accounts ? `, ${result.accounts} compte(s) créé(s)` : ""}.
          {result.skipped.length > 0 && <div className="text-xs mt-1" style={{ color: "#8A6D1F" }}>Ignorées : {result.skipped.map((s) => `${s.piece} (${s.why})`).join(", ")}.</div>}
        </div>
      )}
      {cancelMsg && <div className="rounded-lg p-3 text-sm" data-testid="rep-cancel-msg" style={cancelMsg.ok ? { background: "#F1F7F2", border: "1px solid #CFE3D4", color: "#152238" } : { background: "#FBEDE9", border: "1px solid #E9C4BA", color: "#8A2F1F" }}>{cancelMsg.text}</div>}
      {batches.length > 0 && (
        <BzCard title="Reprises effectuées" id="reprise-batches">
          <div className="space-y-2" data-testid="rep-batches">
            {batches.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: "#152238" }}>
                <span>{b.date || "—"}</span><span>{b.balance ? "Balance d'ouverture" : `${b.list.length} écriture(s)`}</span><span className="tabular">{fmt(b.total)}</span>
                {confirmCancel === b.id ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <span style={{ color: "#B3402F" }}>Annuler cette reprise ? Des écritures de contrepassation seront créées ; rien n'est supprimé.</span>
                    <button onClick={() => cancelBatch(b)} data-testid="rep-cancel-yes" className="px-2 py-1 rounded" style={{ background: "#B3402F", color: "#fff" }}>Oui, annuler</button>
                    <button onClick={() => setConfirmCancel(null)} className="px-2 py-1 rounded" style={{ border: "1px solid #DDD6C4", color: "#7A7460" }}>Non</button>
                  </span>
                ) : <button onClick={() => { setCancelMsg(null); setConfirmCancel(b.id); }} data-testid="rep-cancel" className="underline" style={{ color: "#B3402F" }}>Annuler cette reprise</button>}
              </div>
            ))}
          </div>
        </BzCard>
      )}
    </div>
  );
}

function BzRapportBanque({ P }) {
  const { entries, settings } = P;
  const [from, setFrom] = useState(repMonthStart());
  const [to, setTo] = useState(todayStr());
  const [text, setText] = useState("");
  const [fileMsg, setFileMsg] = useState(null);
  const bankLines = useMemo(() => (text.trim() ? bzParseCSV(text) : []), [text]);
  const rep = useMemo(() => repSalesBankReport({ entries, bankLines, from, to }), [entries, bankLines, from, to]);
  const onFile = async (e) => {
    const el = e.target; const f = el.files && el.files[0];
    if (!f) return;
    try {
      const t = await repReadAny(f); setText(t);
      const n = bzParseCSV(t).length;
      setFileMsg({ ok: n > 0, text: n > 0 ? `« ${f.name} » : ${n} ligne(s) reconnue(s).` : `« ${f.name} » chargé, mais aucune ligne date + montant reconnue (colonnes Date, Description, Montant ou Débit/Crédit).` });
    } catch (err) { setFileMsg({ ok: false, text: (err && err.message) || "Lecture du fichier impossible." }); }
    finally { try { setTimeout(() => { el.value = ""; }, 0); } catch (x) { /* ignoré */ } }
  };
  const exportCsv = () => {
    const rows = [["Section", "Date", "Libellé", "Montant", "Détail"]];
    rep.matches.forEach((m) => rows.push(["Rapproché", m.bank.date, m.bank.label, m.bank.amount, m.entries.map((x) => `${x.date} ${x.label} ${x.amount}`).join(" + ")]));
    rep.bankOnly.forEach((b) => rows.push(["Au relevé, pas en compta", b.date, b.label, b.amount, ""]));
    rep.bookOnly.forEach((x) => rows.push(["En compta, pas au relevé", x.date, x.label, x.amount, x.sale ? "vente" : ""]));
    rows.push([]); rows.push(["Ventes comptabilisées", "", "", rep.sales.total, ""]); rows.push(["Entrées en banque (compta)", "", "", rep.bookTotal, ""]); rows.push(["Entrées au relevé", "", "", rep.bankTotal, ""]); rows.push(["Écart (relevé − compta)", "", "", rep.gap, ""]);
    repDownload(`rapprochement-ventes-banque-${from}-${to}.csv`, rows);
  };
  const Stat = ({ label, value, tid, color }) => <div className="rounded p-3" style={{ background: "#F7F4EA" }}><div className="text-xs" style={{ color: "#8A8370" }}>{label}</div><div className="text-base font-semibold tabular" data-testid={tid} style={{ color: color || "#152238" }}>{fmt(value)}</div></div>;
  const hasBank = bankLines.length > 0;
  return (
    <div className="space-y-5 min-w-0" data-testid="rb-report" style={{ overflowWrap: "anywhere" }}>
      <BzCard title="Rapport de rapprochement ventes ↔ banque" id="rapportbanque">
        <p className="text-xs mb-3" style={{ color: "#8A8370" }}>Compare, sur la période, les ventes comptabilisées, les entrées de banque du journal et votre relevé bancaire. Un dépôt qui regroupe plusieurs ventes de la même période est reconnu. Les pièces annulées sont exclues.</p>
        <div className="grid sm:grid-cols-2 gap-3 mb-3 max-w-md">
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Du</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="rb-from" data-ro-ok className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Au</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} data-testid="rb-to" data-ro-ok className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} /></div>
        </div>
        <div className="text-xs mb-1" style={{ color: "#8A8370" }}>Relevé bancaire de la période (CSV, Excel ou texte collé : colonnes Date, Description, Montant ou Débit/Crédit).</div>
        <input type="file" accept="text/csv,text/plain,text/tab-separated-values,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.csv,.txt,.tsv,.xlsx,.xls" onChange={onFile} className="text-sm mb-1 max-w-full" data-testid="rb-file" data-ro-ok />
        {fileMsg && <div className="text-xs mb-2 p-2 rounded" data-testid="rb-file-msg" style={{ background: fileMsg.ok ? "#EAF3EE" : "#F7E9E3", color: fileMsg.ok ? "#0F6B5C" : "#A6432F" }}>{fileMsg.text}</div>}
        <textarea data-testid="rb-text" value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="…ou collez le relevé ici" className="w-full border rounded px-2 py-1.5 text-xs font-mono" style={{ borderColor: "#DDD6C4", minWidth: 0 }} />
      </BzCard>
      <BzCard title="Ventes de la période" id="rb-sales">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label={`Ventes comptabilisées (${rep.sales.count})`} value={rep.sales.total} tid="rb-sales-total" />
          <Stat label="dont encaissées en banque" value={rep.sales.banque} tid="rb-sales-banque" />
          <Stat label="dont en caisse (espèces)" value={rep.sales.caisse} tid="rb-sales-caisse" />
          <Stat label="dont à crédit (clients)" value={rep.sales.credit} tid="rb-sales-credit" />
        </div>
        <div className="text-xs mt-2" style={{ color: "#A39C87" }}>Les ventes en espèces n'apparaissent à la banque qu'au moment du dépôt. Les ventes à crédit, au moment de l'encaissement du client.</div>
      </BzCard>
      <BzCard title="Banque : journal contre relevé" id="rb-bank">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label={`Entrées en banque — journal (${rep.bookCount})`} value={rep.bookTotal} tid="rb-book-total" />
          <Stat label={`Entrées — relevé (${rep.bankCount})`} value={rep.bankTotal} tid="rb-bank-total" />
          <Stat label="Rapproché" value={rep.matchedTotal} tid="rb-matched-total" color="#2F7D4F" />
          <Stat label="Écart (relevé − journal)" value={rep.gap} tid="rb-gap" color={rep.gap === 0 ? "#2F7D4F" : "#B3402F"} />
        </div>
        {!hasBank && <div className="text-sm mt-3" style={{ color: "#8A6D1F" }} data-testid="rb-nobank">Chargez ou collez votre relevé pour obtenir le rapprochement. Sans relevé, seules les ventes et les entrées du journal sont affichées.</div>}
        {hasBank && (
          <div className="mt-4 space-y-4">
            <div>
              <div className="text-xs font-semibold mb-1" style={{ color: "#2F7D4F" }}>Rapprochés ({rep.matches.length})</div>
              <div data-testid="rb-matches" className="text-xs space-y-1">{rep.matches.length === 0 ? <div style={{ color: "#A39C87" }}>Aucun.</div> : rep.matches.map((m, i) => <div key={i} data-testid="rb-match">{m.bank.date} — {m.bank.label || "Relevé"} — <b className="tabular">{fmt(m.bank.amount)}</b> ↔ {m.kind === "groupe" ? `${m.entries.length} écritures (${m.entries.map((x) => fmt(x.amount)).join(" + ")})` : m.entries[0].label}</div>)}</div>
            </div>
            <div>
              <div className="text-xs font-semibold mb-1" style={{ color: "#B3402F" }}>Au relevé, pas dans le journal ({rep.bankOnly.length} — {fmt(rep.bankOnlyTotal)})</div>
              <div data-testid="rb-bankonly" className="text-xs space-y-1">{rep.bankOnly.length === 0 ? <div style={{ color: "#A39C87" }}>Aucun.</div> : rep.bankOnly.map((b, i) => <div key={i} data-testid="rb-bankonly-row">{b.date} — {b.label || "Relevé"} — <b className="tabular">{fmt(b.amount)}</b> <span style={{ color: "#8A8370" }}>→ encaissement à enregistrer</span></div>)}</div>
            </div>
            <div>
              <div className="text-xs font-semibold mb-1" style={{ color: "#B7791F" }}>Dans le journal, pas au relevé ({rep.bookOnly.length} — {fmt(rep.bookOnlyTotal)})</div>
              <div data-testid="rb-bookonly" className="text-xs space-y-1">{rep.bookOnly.length === 0 ? <div style={{ color: "#A39C87" }}>Aucun.</div> : rep.bookOnly.map((x, i) => <div key={i} data-testid="rb-bookonly-row">{x.date} — {x.label} — <b className="tabular">{fmt(x.amount)}</b> <span style={{ color: "#8A8370" }}>→ dépôt non encore passé à la banque, ou à vérifier</span></div>)}</div>
            </div>
          </div>
        )}
        <div className="mt-4"><button onClick={exportCsv} data-testid="rb-export" data-ro-ok className="text-sm px-4 py-1.5 rounded" style={{ border: "1px solid #DDD6C4", color: "#152238" }}>Exporter en CSV</button></div>
      </BzCard>
    </div>
  );
}

function BzJustificatifs({ P }) {
  const { entries, bizdocs, setBizdocs, role, showToast, companyId } = P;
  const canEdit = role === "Administrateur" || role === "Éditeur";
  const [from, setFrom] = useState(repMonthStart());
  const [to, setTo] = useState(todayStr());
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const rep = useMemo(() => repJustify({ entries, bizdocs, from, to }), [entries, bizdocs, from, to]);
  const atts = (bizdocs || []).filter((d) => d.type === "attachment");
  const rows = onlyMissing ? rep.rows.filter((r) => !r.ok) : rep.rows;
  const filesOf = (r) => atts.filter((a) => a.ref === "e" + r.id || (r.purchaseId && a.ref === "p" + r.purchaseId));
  const addFile = async (r, ev) => {
    const el = ev.target; const f = el.files && el.files[0];
    if (!f) return;
    if (!canEdit) { showToast("Droits insuffisants."); return; }
    setBusy(true);
    try {
      const rec = await bzStoreAttachment({ atts, file: f, companyId, ref: "e" + r.id, refLabel: `Écriture ${r.date} — ${r.label}` });
      setBizdocs((prev) => [...prev, rec]);
      setMsg({ ok: true, text: `Pièce « ${f.name} » rattachée à l'écriture du ${r.date}.` }); showToast("Pièce justificative enregistrée.");
    } catch (e) { const m = (e && e.message) || "Fichier impossible à enregistrer."; setMsg({ ok: false, text: m }); showToast(m); }
    finally { setBusy(false); try { setTimeout(() => { el.value = ""; }, 0); } catch (x) { /* ignoré */ } }
  };
  const exportCsv = () => {
    const rows2 = [["Date", "Libellé", "Montant", "État", "Pièces"]];
    rep.rows.forEach((r) => rows2.push([r.date, r.label, r.amount, r.atts > 0 ? "Pièce jointe" : r.auto ? `Justifiée (${r.auto})` : "Pièce manquante", r.atts]));
    repDownload(`pieces-justificatives-${from}-${to}.csv`, rows2);
  };
  return (
    <div className="space-y-5 min-w-0" data-testid="pj-report" style={{ overflowWrap: "anywhere" }}>
      <BzCard title="Pièces justificatives" id="justificatifs">
        <p className="text-xs mb-3" style={{ color: "#8A8370" }}>Une écriture est justifiée par une pièce jointe (facture fournisseur, reçu, bordereau), ou automatiquement quand elle découle d'un document déjà dans l'application (facture de vente, avoir, ticket POS importé, reprise). Les écritures annulées sont exclues. Photos réduites automatiquement ; fichiers jusqu'à 5 Mo. Les {BZ_ATT_MAX_COUNT} premières pièces (8 Mo) sont gardées avec vos données ; les suivantes sont conservées dans un stockage de fichiers dédié et protégé.</p>
        <div className="grid sm:grid-cols-2 gap-3 mb-3 max-w-md">
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Du</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="pj-from" data-ro-ok className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} /></div>
          <div><label className="text-xs" style={{ color: "#8A8370" }}>Au</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} data-testid="pj-to" data-ro-ok className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} /></div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <div className="rounded p-3" style={{ background: "#F7F4EA" }}><div className="text-xs" style={{ color: "#8A8370" }}>Écritures suivies</div><div className="text-base font-semibold" data-testid="pj-total">{rep.total}</div></div>
          <div className="rounded p-3" style={{ background: "#F7F4EA" }}><div className="text-xs" style={{ color: "#8A8370" }}>Justifiées</div><div className="text-base font-semibold" data-testid="pj-ok" style={{ color: "#2F7D4F" }}>{rep.justified}</div></div>
          <div className="rounded p-3" style={{ background: "#F7F4EA" }}><div className="text-xs" style={{ color: "#8A8370" }}>Pièce manquante</div><div className="text-base font-semibold" data-testid="pj-missing" style={{ color: rep.missing ? "#B3402F" : "#2F7D4F" }}>{rep.missing}</div></div>
          <div className="rounded p-3" style={{ background: "#F7F4EA" }}><div className="text-xs" style={{ color: "#8A8370" }}>Taux de justification</div><div className="text-base font-semibold" data-testid="pj-rate">{rep.rate} %</div></div>
        </div>
        <label className="flex items-center gap-2 text-xs mb-2" style={{ color: "#152238" }}><input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} data-testid="pj-only-missing" data-ro-ok /> Afficher seulement les écritures sans pièce</label>
        {msg && <div className="text-xs mb-2 p-2 rounded" data-testid="pj-msg" style={{ background: msg.ok ? "#EAF3EE" : "#F7E9E3", color: msg.ok ? "#0F6B5C" : "#A6432F" }}>{msg.text}</div>}
        {rows.length === 0 ? <BzEmpty>{rep.total === 0 ? "Aucune écriture sur la période." : "Toutes les écritures de la période sont justifiées."}</BzEmpty> : (
          <div className="overflow-x-auto"><table className="w-full text-xs" style={{ minWidth: 520 }}><thead><tr style={{ color: "#8A8370" }}><th className="text-left font-normal py-1">Date</th><th className="text-left font-normal">Libellé</th><th className="text-right font-normal">Montant</th><th className="pl-3 text-left font-normal">État</th><th className="text-left font-normal">Pièce</th></tr></thead>
            <tbody>{rows.slice(0, 200).map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid #F3EFE3" }} data-testid="pj-row" data-pj-ok={r.ok ? "1" : "0"}>
                <td className="py-1.5">{r.date}</td><td>{r.label}</td><td className="text-right tabular">{fmt(r.amount)}</td>
                <td className="pl-3" style={{ color: r.ok ? "#2F7D4F" : "#B3402F" }}>{r.atts > 0 ? `Pièce jointe (${r.atts})` : r.auto ? `Justifiée (${r.auto})` : "Pièce manquante"}</td>
                <td>
                  {filesOf(r).map((a) => <div key={a.id}><BzAttLink a={a} showToast={showToast} /></div>)}
                  {canEdit && !r.auto && <label className="underline cursor-pointer" style={{ color: "#0F6B5C" }}>{r.atts > 0 ? "Ajouter une autre" : "Ajouter une pièce"}<input type="file" accept="image/*,.pdf" className="hidden" disabled={busy} onClick={pjPickMark} onChange={(ev) => addFile(r, ev)} data-testid="pj-file" /></label>}
                </td>
              </tr>))}</tbody></table></div>
        )}
        {rows.length > 200 && <div className="text-xs mt-1" style={{ color: "#8A8370" }}>200 premières écritures affichées sur {rows.length} : réduisez la période.</div>}
        <div className="mt-3"><button onClick={exportCsv} data-testid="pj-export" data-ro-ok className="text-sm px-4 py-1.5 rounded" style={{ border: "1px solid #DDD6C4", color: "#152238" }}>Exporter en CSV</button></div>
      </BzCard>
    </div>
  );
}

