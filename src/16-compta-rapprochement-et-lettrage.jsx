// ═══ MODULE ═══
// @module Compta rapprochement et lettrage
// @depends —
// @exports EC_BALANCE_COLS, EC_JOURNAL_COLS, EC_PLAN_COLS, EC_TARGETS, applyLettrage, bankRecoCompute
//   ecBalanceRows, ecChecks, ecCsv, ecDownloadCsv, ecFmt, ecInviteError, ecJournalRows, ecPlanRows
//   ecSortEntries, lettrageLines, lettrageSuggest, nextLetterCode, rcR2, removeLettrage
// ═══ FIN DE L'EN-TÊTE ═══
// ── Chantier F : rapprochement bancaire et lettrage ─────────────────────────
// Rapprochement : on s'appuie sur le pointage existant (`reconciled` sur l'écriture).
// Le solde du relevé doit égaler le solde des écritures pointées ; les écritures non
// pointées (chèques en circulation, virements en transit) expliquent la différence
// avec le solde comptable. Lettrage : un code (A, B, … AA) posé sur des lignes d'un
// même compte de tiers dont le total débit égale le total crédit ; stocké dans
// `entry.lettrage = { [indexLigne]: code }` (métadonnée hors empreinte du journal).
const rcR2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
function bankRecoCompute(entries, account, date, statementBalance) {
  let book = 0, pointed = 0;
  const unpointed = [];
  (entries || []).forEach((e) => {
    if (!e.date || e.date > date) return;
    const net = rcR2((e.lines || []).filter((l) => l.account === account).reduce((t, l) => t + (Number(l.debit) || 0) - (Number(l.credit) || 0), 0));
    if (net === 0) return;
    book = rcR2(book + net);
    if (e.reconciled) pointed = rcR2(pointed + net);
    else unpointed.push({ id: e.id, date: e.date, label: e.label, net });
  });
  unpointed.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const inTransit = rcR2(unpointed.filter((u) => u.net > 0).reduce((t, u) => t + u.net, 0));
  const outstanding = rcR2(unpointed.filter((u) => u.net < 0).reduce((t, u) => t - u.net, 0));
  const st = statementBalance === "" || statementBalance == null ? null : Number(statementBalance);
  const gap = st == null || isNaN(st) ? null : rcR2(st - pointed);
  return { book, pointed, unpointed, inTransit, outstanding, gap, expectedStatement: rcR2(book - inTransit + outstanding) };
}
function nextLetterCode(used) {
  const set = new Set(used);
  for (let n = 0; n < 100000; n++) {
    let x = n, code = "";
    do { code = String.fromCharCode(65 + (x % 26)) + code; x = Math.floor(x / 26) - 1; } while (x >= 0);
    if (!set.has(code)) return code;
  }
  return "ZZZZ";
}
function lettrageLines(entries, account) {
  const out = [];
  (entries || []).forEach((e) => (e.lines || []).forEach((l, i) => {
    if (l.account !== account) return;
    out.push({ key: `${e.id}:${i}`, entryId: e.id, idx: i, date: e.date, label: e.label, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, letter: (e.lettrage && e.lettrage[i]) || "" });
  }));
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}
// Propositions prudentes : une ligne au débit et une au crédit de même montant exact, non lettrées.
function lettrageSuggest(lines) {
  const open = lines.filter((l) => !l.letter);
  const used = new Set();
  const pairs = [];
  open.forEach((a) => {
    if (used.has(a.key) || !(a.debit > 0)) return;
    const b = open.find((x) => !used.has(x.key) && x.credit > 0 && rcR2(x.credit) === rcR2(a.debit));
    if (b) { used.add(a.key); used.add(b.key); pairs.push([a.key, b.key]); }
  });
  return pairs;
}
function applyLettrage(entries, keys, code) {
  const byEntry = new Map();
  keys.forEach((k) => { const [id, idx] = [k.slice(0, k.lastIndexOf(":")), Number(k.slice(k.lastIndexOf(":") + 1))]; if (!byEntry.has(id)) byEntry.set(id, []); byEntry.get(id).push(idx); });
  return entries.map((e) => {
    const idxs = byEntry.get(String(e.id));
    if (!idxs) return e;
    const l = { ...(e.lettrage || {}) };
    idxs.forEach((i) => { l[i] = code; });
    return { ...e, lettrage: l };
  });
}
function removeLettrage(entries, account, code) {
  return entries.map((e) => {
    if (!e.lettrage) return e;
    const l = { ...e.lettrage };
    let changed = false;
    Object.keys(l).forEach((i) => { if (l[i] === code && e.lines[i] && e.lines[i].account === account) { delete l[i]; changed = true; } });
    if (!changed) return e;
    const next = { ...e };
    if (Object.keys(l).length) next.lettrage = l; else delete next.lettrage;
    return next;
  });
}

// === I:PURE ===
// Chantier I — exports normalisés pour le cabinet comptable + contrôles de transmission.
const EC_TARGETS = [["general", "Général"], ["entry", "Écriture"], ["invoice", "Facture"], ["account", "Compte"], ["period", "Période"]];
function ecFmt(n) { return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace(".", ","); }
function ecCsvCell(v) {
  const s = String(v == null ? "" : v).replace(/\r?\n/g, " ");
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function ecCsv(cols, rows) { return "﻿" + [cols, ...rows].map((r) => r.map(ecCsvCell).join(";")).join("\r\n"); }
function ecDate8(d) { return String(d || "").replace(/-/g, "").slice(0, 8); }
function ecSortEntries(entries) {
  return [...(entries || [])].sort((a, b) => {
    const da = a.date || "", db = b.date || "";
    if (da !== db) return da < db ? -1 : 1;
    const ca = String(a.createdAt || ""), cb = String(b.createdAt || "");
    return ca < cb ? -1 : ca > cb ? 1 : 0;
  });
}
const EC_JOURNAL_COLS = ["JournalCode", "EcritureNum", "EcritureDate", "CompteNum", "CompteLib", "EcritureLib", "Debit", "Credit", "Devise", "Lettrage", "Pointage", "RefInterne"];
function ecJournalRows(entries, accounts, currency) {
  const names = {};
  (accounts || []).forEach((a) => { names[a.code] = a.name; });
  const rows = [];
  ecSortEntries(entries).forEach((e, i) => {
    (e.lines || []).forEach((l, li) => {
      rows.push([
        e.invoiceId ? "VE" : "OD", i + 1, ecDate8(e.date), l.account, names[l.account] || "", e.label || "",
        ecFmt(l.debit), ecFmt(l.credit), (e.fx && e.fx.currency) || currency || "HTG",
        (e.lettrage && e.lettrage[li]) || "", e.reconciled ? "O" : "", e.id || "",
      ]);
    });
  });
  return rows;
}
const EC_BALANCE_COLS = ["CompteNum", "CompteLib", "Type", "TotalDebit", "TotalCredit", "SoldeDebiteur", "SoldeCrediteur"];
function ecBalanceRows(accounts, entries) {
  const tot = {};
  (entries || []).forEach((e) => (e.lines || []).forEach((l) => {
    const t = (tot[l.account] = tot[l.account] || { d: 0, c: 0 });
    t.d += Number(l.debit || 0); t.c += Number(l.credit || 0);
  }));
  const known = new Set((accounts || []).map((a) => a.code));
  const list = [...(accounts || []).map((a) => ({ code: a.code, name: a.name, type: a.type })),
    ...Object.keys(tot).filter((c) => c && !known.has(c)).map((c) => ({ code: c, name: "(compte hors plan comptable)", type: "" }))]
    .sort((x, y) => String(x.code).localeCompare(String(y.code), undefined, { numeric: true }));
  const rows = [];
  let td = 0, tc = 0, sd = 0, sc = 0;
  list.forEach((a) => {
    const t = tot[a.code] || { d: 0, c: 0 };
    if (Math.abs(t.d) < 0.005 && Math.abs(t.c) < 0.005) return;
    const s = t.d - t.c;
    td += t.d; tc += t.c; sd += s > 0 ? s : 0; sc += s < 0 ? -s : 0;
    rows.push([a.code, a.name, a.type, ecFmt(t.d), ecFmt(t.c), ecFmt(s > 0 ? s : 0), ecFmt(s < 0 ? -s : 0)]);
  });
  rows.push(["TOTAL", "", "", ecFmt(td), ecFmt(tc), ecFmt(sd), ecFmt(sc)]);
  return rows;
}
const EC_PLAN_COLS = ["CompteNum", "CompteLib", "Type"];
function ecPlanRows(accounts) {
  return [...(accounts || [])].sort((x, y) => String(x.code).localeCompare(String(y.code), undefined, { numeric: true })).map((a) => [a.code, a.name, a.type || ""]);
}
// Contrôles avant transmission : ce que le cabinet vérifierait en premier.
function ecChecks(accounts, entries) {
  const known = new Set((accounts || []).map((a) => a.code));
  let td = 0, tc = 0, unbalanced = 0, unknown = new Set(), noDate = 0;
  (entries || []).forEach((e) => {
    let d = 0, c = 0;
    (e.lines || []).forEach((l) => { d += Number(l.debit || 0); c += Number(l.credit || 0); if (l.account && !known.has(l.account)) unknown.add(l.account); });
    td += d; tc += c;
    if (Math.abs(d - c) > 0.005) unbalanced++;
    if (!e.date) noDate++;
  });
  return { entryCount: (entries || []).length, totalDebit: td, totalCredit: tc, balanced: Math.abs(td - tc) <= 0.005, unbalancedEntries: unbalanced, unknownAccounts: [...unknown], noDate };
}
function ecDownloadCsv(filename, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function ecInviteError(err, fallback) {
  const msg = String((err && (err.message || err.code)) || "");
  if (/is_accountant|42703|schema cache/i.test(msg)) return "Cette fonction n'est pas encore disponible sur votre compte. Réessayez plus tard ou contactez le support.";
  if (/lecture seule/i.test(msg)) return "Un expert-comptable est toujours en lecture seule.";
  if (/déjà rattaché/i.test(msg)) return "Cette adresse est déjà rattachée à une autre entreprise comme utilisateur normal : un cabinet doit utiliser une adresse dédiée.";
  return fallback;
}
// === /I:PURE ===

