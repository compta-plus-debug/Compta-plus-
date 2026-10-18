// ---------------------------------------------------------------- Phase 3 : avoirs / retours
// K:POS:START
// Import de tickets d'un POS externe (Zobase POS) : lecture du texte des tickets, contrôle des totaux,
// création d'une écriture (et d'une facture importée) par ticket. Fonctions pures, testées hors navigateur.
function posNum(raw) {
  let s = String(raw == null ? "" : raw).replace(/[^\d.,\-]/g, "");
  if (!s || !/\d/.test(s)) return null;
  const neg = s.startsWith("-");
  s = s.replace(/-/g, "");
  const hasDot = s.includes("."), hasCom = s.includes(",");
  if (hasDot && hasCom) {
    const dec = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ",";
    const th = dec === "." ? "," : ".";
    s = s.split(th).join("").replace(dec, ".");
  } else if (hasCom) {
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (hasDot) {
    s = /^\d{1,3}(\.\d{3}){2,}$/.test(s) ? s.replace(/\./g, "") : s;
  }
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}
const POS_MONTHS = { jan: 1, janv: 1, january: 1, janvier: 1, feb: 2, fev: 2, fevr: 2, february: 2, fevrier: 2, mar: 3, mars: 3, march: 3, apr: 4, avr: 4, april: 4, avril: 4, may: 5, mai: 5, jun: 6, juin: 6, june: 6, jul: 7, juil: 7, july: 7, juillet: 7, aug: 8, aou: 8, aout: 8, august: 8, sep: 9, sept: 9, september: 9, septembre: 9, oct: 10, october: 10, octobre: 10, nov: 11, november: 11, novembre: 11, dec: 12, december: 12, decembre: 12 };
function posNoAccent(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, ""); }
function posParseDate(line) {
  const t = posNoAccent(line);
  let m = t.match(/(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{2,4})(?:\s*[-–,]?\s*(\d{1,2}:\d{2}))?/);
  if (m && POS_MONTHS[m[2].toLowerCase()]) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return { date: `${y}-${String(POS_MONTHS[m[2].toLowerCase()]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`, time: m[4] || "" };
  }
  m = t.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:\s*[-–,]?\s*(\d{1,2}:\d{2}))?/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const d = Number(m[1]), mo = Number(m[2]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return { date: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`, time: m[4] || "" };
  }
  return null;
}
function posRound(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
function posParseReceiptsStd(text) {
  const src = String(text || "").replace(/\r/g, "").replace(/^﻿/, "");
  const parts = src.split(/(?=^[ \t]*(?:Receipt|Re[cç]u|Recu|Ticket)\s*(?:#|n[°o]?\.?)\s*[A-Za-z0-9])/im).filter((p) => /(?:Receipt|Re[cç]u|Recu|Ticket)\s*(?:#|n[°o]?\.?)\s*[A-Za-z0-9]/i.test(p));
  const tickets = [];
  for (const part of parts) {
    const lines = part.split("\n").map((l) => l.trim()).filter((l) => l !== "");
    const t = { number: "", date: "", time: "", cashier: "", payMode: "", customer: "", phone: "", lines: [], totalsRead: [], warnings: [] };
    const mNum = part.match(/(?:Receipt|Re[cç]u|Recu|Ticket)\s*(?:#|n[°o]?\.?)\s*([A-Za-z0-9][A-Za-z0-9\-_/]*)/i);
    t.number = mNum ? mNum[1] : "";
    const isPlaceholder = (v) => /\{\$|\{\{|\}\}/.test(v);
    let amountHeaderAt = -1, firstTotalAt = -1;
    lines.forEach((l, i) => {
      if (!t.date) { const d = posParseDate(l); if (d && !/^(?:Receipt|Re[cç]u|Recu|Ticket)/i.test(l)) { t.date = d.date; t.time = d.time; } }
      const pm = l.match(/^(?:Payment\s*Mode|Mode\s*de\s*paiement|Paiement)\s*:?\s*(.*)$/i);
      if (pm && !t.payMode) t.payMode = (pm[1] || (lines[i + 1] || "")).trim();
      const cm = l.match(/^(?:Cashier\s*Name|Caissier(?:e)?|Vendeur)\s*:?\s*(.*)$/i);
      if (cm && cm[1] && !isPlaceholder(cm[1])) t.cashier = cm[1].trim();
      if (amountHeaderAt < 0 && /^(?:Montant|Amount|Total\s*ligne)$/i.test(l)) amountHeaderAt = i;
      if (amountHeaderAt < 0 && /^Article\b.*(?:Montant|Amount)/i.test(l)) amountHeaderAt = i;
      if (firstTotalAt < 0 && amountHeaderAt >= 0 && i > amountHeaderAt && /^Total\b/i.test(l)) firstTotalAt = i;
    });
    const ci = lines.findIndex((l) => /^(?:Customer\s*Details|D[ée]tails?\s*(?:du\s*)?client|Client)\s*:?\s*$/i.test(l));
    if (ci >= 0) {
      const nxt = lines.slice(ci + 1, ci + 4);
      const name = nxt.find((l) => !/^[\d\s+()\-.]+$/.test(l) && !/^(?:Article|Qt[eé]|Taux|Montant)/i.test(l));
      if (name && !isPlaceholder(name)) t.customer = name;
      const ph = nxt.find((l) => /^[\d\s+()\-.]{6,}$/.test(l));
      if (ph) t.phone = ph.replace(/\s+/g, "");
    }
    if (amountHeaderAt < 0) { t.warnings.push("Tableau des articles introuvable."); tickets.push(t); continue; }
    const startAt = amountHeaderAt + 1;
    const endAt = firstTotalAt >= 0 ? firstTotalAt : lines.length;
    let body = lines.slice(startAt, endAt);
    // les en-têtes Article / Qté / Taux isolés avant « Montant » sont déjà exclus ; on ignore un éventuel rappel
    body = body.filter((l) => !/^(?:Article|Qt[eé]|Taux|Prix)$/i.test(l));
    const isNum = (l) => /^[\s$€]*-?[\d][\d\s.,]*[\s$€]*$/.test(l);
    let i = 0;
    while (i < body.length) {
      const l = body[i];
      const fields = l.split(/\t+|\s{2,}/).map((x) => x.trim()).filter((x) => x !== "");
      let one = null;
      if (fields.length === 4 && !isNum(fields[0]) && fields.slice(1).every(isNum)) one = [null, fields[0], fields[1], fields[2], fields[3]];
      else if (!isNum(l)) one = l.match(/^(.+?)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)$/);
      if (one) { t.lines.push({ name: one[1].trim(), qty: posNum(one[2]), price: posNum(one[3]), amount: posNum(one[4]) }); i++; continue; }
      if (!isNum(l) && i + 3 < body.length + 0 && isNum(body[i + 1]) && isNum(body[i + 2]) && isNum(body[i + 3])) {
        t.lines.push({ name: l, qty: posNum(body[i + 1]), price: posNum(body[i + 2]), amount: posNum(body[i + 3]) }); i += 4; continue;
      }
      t.warnings.push(`Ligne non reconnue : « ${l.slice(0, 40)} »`); i++;
    }
    // totaux lus (peut y en avoir deux : ex. un total en gourdes puis un autre en devise)
    if (firstTotalAt >= 0) {
      const tail = lines.slice(firstTotalAt);
      for (let k = 0; k < tail.length; k++) {
        if (/^Total\b/i.test(tail[k])) {
          const inline = tail[k].replace(/^Total\b\s*:?/i, "").trim();
          const val = inline && /\d/.test(inline) ? inline : (tail[k + 1] && isNum(tail[k + 1]) ? tail[k + 1] : "");
          if (val) t.totalsRead.push({ raw: val.trim(), value: posNum(val) });
        }
      }
    }
    t.computed = posRound(t.lines.reduce((s, l) => s + (l.amount || 0), 0));
    // Remise : soit une ligne « Remise / Discount / Rabais » explicite, soit un second total plus petit (total net).
    t.discount = 0; t.net = null;
    for (let k = 0; k < lines.length; k++) {
      const dm = lines[k].match(/^(?:Remise|Discount|Rabais|Escompte|R[ée]duction)\b[^\d\n]*?([\d][\d\s.,]*)?\s*$/i);
      if (dm && k > amountHeaderAt) {
        const val = dm[1] || (lines[k + 1] && /^[\s$€-]*[\d][\d\s.,]*$/.test(lines[k + 1]) ? lines[k + 1] : "");
        const v = val ? posNum(val) : null;
        if (v != null && v > 0) { t.discount = Math.abs(v); break; }
      }
    }
    t.lines.forEach((l) => { if (l.qty != null && l.price != null && l.amount != null && Math.abs(posRound(l.qty * l.price) - l.amount) > 0.01) t.warnings.push(`Ligne « ${l.name} » : ${l.qty} × ${l.price} ≠ ${l.amount}.`); });
    t.total = t.totalsRead.length ? t.totalsRead[0].value : null;
    t.status = "ok";
    if (!t.number) { t.status = "invalide"; t.warnings.push("Numéro de ticket introuvable."); }
    else if (!t.date) { t.status = "invalide"; t.warnings.push("Date introuvable."); }
    else if (t.lines.length === 0) { t.status = "invalide"; t.warnings.push("Aucun article lu."); }
    else if (t.total == null) { t.status = "ecart"; t.warnings.push("Total du ticket introuvable."); }
    else if (Math.abs(t.total - t.computed) > 0.01) { t.status = "ecart"; t.warnings.push(`Le total lu (${t.total}) ne correspond pas à la somme des articles (${t.computed}).`); }
    if (t.status === "ok") {
      const second = t.totalsRead.length > 1 ? t.totalsRead[1].value : null;
      if (t.discount > 0) {
        t.net = posRound(t.computed - t.discount);
        if (second != null && Math.abs(second - t.net) > 0.01) { t.status = "ecart"; t.warnings.push(`Remise ${t.discount} : le total net attendu (${t.net}) diffère du second total lu (${second}).`); }
        else t.warnings.push(`Remise de ${t.discount} : total net ${t.net}.`);
      } else if (second != null && second > 0 && second < t.computed) {
        t.discount = posRound(t.computed - second); t.net = second;
        t.warnings.push(`Remise de ${t.discount} déduite du second total : total net ${t.net}.`);
      } else if (t.totalsRead.length > 1) t.warnings.push(`Second total ignoré : ${t.totalsRead.slice(1).map((x) => x.raw).join(", ")}.`);
    }
    tickets.push(t);
  }
  return { tickets };
}
// Format « message client » (WhatsApp) : « salut *Client* / BJ-3193 Date: … / article, x qté montant / Subtotal / TOTAL / Type de paiement ».
function posParseChat(text) {
  const lines = String(text || "").split("\n").map((l) => l.trim());
  const heads = [];
  lines.forEach((l, i) => { const m = l.match(/^([A-Za-z0-9][A-Za-z0-9_\-/]*)\s*Date\s*:/i); if (m) heads.push({ i, num: m[1] }); });
  const tickets = [];
  const isAmt = (v) => /^[\s$€]*-?\d[\d\s.,]*[\s$€]*$/.test(v);
  heads.forEach((h, hi) => {
    let start = h.i;
    const floor = hi > 0 ? heads[hi - 1].i + 1 : 0;
    let greet = "";
    for (let k = h.i - 1; k >= Math.max(floor, h.i - 4); k--) { if (/^(?:salut|bonjour|bonsoir|hello|hi|bonjou)\b/i.test(lines[k])) { greet = lines[k]; start = k; break; } }
    let end = hi + 1 < heads.length ? heads[hi + 1].i : lines.length;
    for (let k = end - 1; k > h.i && hi + 1 < heads.length && k >= end - 4; k--) { if (/^(?:salut|bonjour|bonsoir|hello|hi|bonjou)\b/i.test(lines[k])) { end = k; break; } }
    const blk = lines.slice(h.i, end).filter((l) => l !== "");
    const t = { number: h.num, date: "", time: "", cashier: "", payMode: "", customer: "", phone: "", lines: [], totalsRead: [], warnings: [], format: "chat" };
    const d = posParseDate(blk[0] || "");
    if (d) { t.date = d.date; t.time = d.time; }
    const gname = greet.replace(/^(?:salut|bonjour|bonsoir|hello|hi|bonjou)\b[\s,:!-]*/i, "").replace(/[*_~]/g, "").trim();
    if (gname && !/^(?:client|customer|cliente?)$/i.test(gname)) t.customer = gname;
    let subtotal = null, total = null, discount = 0;
    let prev = "";
    for (let k = 1; k < blk.length; k++) {
      const l = blk[k];
      if (/^[-=_]{4,}$/.test(l)) { prev = ""; continue; }
      let m;
      if ((m = l.match(/^x\s*([\d.,]+)\s+(.+)$/i)) && isAmt(m[2]) && prev) {
        const qty = posNum(m[1]), amount = posNum(m[2]);
        t.lines.push({ name: prev, qty, price: qty ? posRound(amount / qty) : amount, amount });
        prev = ""; continue;
      }
      if ((m = l.match(/^Sub\s*total\b\s*:?\s*(.*)$/i))) { subtotal = posNum(m[1]); prev = ""; continue; }
      if ((m = l.match(/^(?:Remise|Discount|Rabais|Escompte|R[ée]duction)\b[^\d\n]*([\d][\d\s.,]*)\s*$/i))) { const v = posNum(m[1]); if (v) discount = Math.abs(v); prev = ""; continue; }
      if ((m = l.match(/^TOTAL\b\s*:?\s*(.*)$/i))) { const v = posNum(m[1]); if (v != null && total == null) total = v; prev = ""; continue; }
      if ((m = l.match(/^(?:Type\s*de\s*paiement|Payment\s*(?:Type|Mode)|Mode\s*de\s*paiement)\s*:?\s*(.*)$/i))) { t.payMode = m[1].trim(); prev = ""; continue; }
      if (/^(?:Articles?\s*au\s*total|Items?|Merci|Adresse|Nous\s*contacter|Piou)/i.test(l)) { prev = ""; continue; }
      if (!t.lines.length || prev === "" || true) prev = l;
    }
    if (total != null) t.totalsRead.push({ raw: String(total), value: total });
    t.computed = posRound(t.lines.reduce((x, l) => x + (l.amount || 0), 0));
    t.discount = 0; t.net = null;
    t.total = total;
    t.status = "ok";
    if (!t.date) { t.status = "invalide"; t.warnings.push("Date introuvable."); }
    else if (t.lines.length === 0) { t.status = "invalide"; t.warnings.push("Aucun article lu."); }
    else if (total == null) { t.status = "ecart"; t.warnings.push("Total du ticket introuvable."); }
    else if (Math.abs(total - t.computed) <= 0.01) {
      if (discount > 0) { t.status = "ecart"; t.warnings.push(`Remise ${discount} indiquée mais le total (${total}) n'en tient pas compte.`); }
    } else if (total < t.computed) {
      const dd = posRound(t.computed - total);
      if (discount > 0 && Math.abs(discount - dd) > 0.01) { t.status = "ecart"; t.warnings.push(`Remise ${discount} : le total net attendu (${posRound(t.computed - discount)}) diffère du total lu (${total}).`); }
      else { t.discount = dd; t.net = total; t.total = t.computed; t.warnings.push(`Remise de ${dd} : total net ${total}.`); }
    } else { t.status = "ecart"; t.warnings.push(`Le total lu (${total}) ne correspond pas à la somme des articles (${t.computed}).`); }
    tickets.push(t);
  });
  return tickets;
}
function posParseReceipts(text) {
  const src = String(text || "").replace(/[`\u200e\u200f\u200b\u202a-\u202e\ufeff]/g, "");
  const a = posParseReceiptsStd(src).tickets;
  const b = posParseChat(src);
  return { tickets: [...a, ...b] };
}
function posPayAccountFor(mode) {
  const m = posNoAccent(mode).toLowerCase();
  if (/moncash|natcash|card|carte|banque|bank|virement|transfer|cheque|check|wire|zelle/.test(m)) return "512";
  if (/cred|a terme|terme|dette/.test(m)) return "411";
  return "530";
}
// Écritures + factures importées. Un ticket déjà importé (écriture active de même numéro) est ignoré.
function posBuildImport(tickets, ctx) {
  const { entries, invoices, clients, settings, opts, mkId, nowIso, batchId } = ctx;
  const out = { entries: [], invoices: [], clients: [], skipped: [], imported: [] };
  const active = (e) => !e.cancelledBy && !e.reversalOf;
  const done = new Set((entries || []).filter((e) => e.importRef && active(e)).map((e) => String(e.importRef)));
  const seen = new Set();
  const known = new Set((clients || []).map((c) => normalizeClientName(c.name)));
  const rate = Number(opts.taxIncludedRate) || 0;
  for (const t of tickets) {
    if (t.status === "invalide") { out.skipped.push({ number: t.number || "?", why: "ticket illisible" }); continue; }
    if (t.status === "ecart" && !opts.allowMismatch) { out.skipped.push({ number: t.number, why: "total à vérifier" }); continue; }
    if (done.has(String(t.number)) || seen.has(String(t.number))) { out.skipped.push({ number: t.number, why: "déjà importé" }); continue; }
    if (settings && settings.lockDate && t.date <= settings.lockDate) { out.skipped.push({ number: t.number, why: `période clôturée (jusqu'au ${settings.lockDate})` }); continue; }
    seen.add(String(t.number));
    const gross = posRound(t.status === "ecart" ? t.computed : (t.total != null ? t.total : t.computed));
    const discount = t.discount > 0 && t.net != null ? t.discount : 0;
    const total = discount > 0 ? posRound(t.net) : gross;
    const payAcc = (opts.payMap && opts.payMap[t.payMode]) || posPayAccountFor(t.payMode);
    const tax = rate > 0 ? posRound(total - total / (1 + rate / 100)) : 0;
    const ht = posRound(total - tax);
    const invId = mkId();
    const label = `Import POS ${t.number}${t.customer ? " — " + t.customer : ""}`;
    out.entries.push({
      id: mkId(), invoiceId: invId, date: t.date, createdAt: nowIso, label,
      importRef: t.number, importBatch: batchId, source: "import-pos",
      lines: [
        { account: payAcc, debit: total, credit: 0 },
        { account: opts.revenueAccount || "707", debit: 0, credit: ht },
        ...(tax > 0 ? [{ account: (settings && settings.taxAccount) || "445", debit: 0, credit: tax }] : []),
      ],
    });
    out.invoices.push({
      id: invId, number: t.number, date: t.date, client: t.customer || "Client comptant", lines: [],
      globalDiscountPct: 0, globalDiscountAmtInput: discount, globalDiscountAmount: discount, fees: [],
      totalHT: ht, totalTax: tax, taxLabel: tax > 0 ? `Taxe incluse ${rate}%` : "", total,
      paymentMode: payAcc === "411" ? "credit" : payAcc === "512" ? "banque" : "caisse",
      status: payAcc === "411" ? "impayée" : "payée",
      importedFrom: "pos", importBatch: batchId, importRef: t.number,
      posLines: t.lines.map((l) => ({ name: l.name, qty: l.qty, price: l.price, amount: l.amount })),
      cashier: t.cashier || "", time: t.time || "",
    });
    if (t.customer && !known.has(normalizeClientName(t.customer))) {
      known.add(normalizeClientName(t.customer));
      out.clients.push({ id: mkId(), name: t.customer, email: "", phone: t.phone || "", createdAt: nowIso });
    }
    out.imported.push({ number: t.number, total, payAcc, discount });
  }
  return out;
}
// K:POS:END

