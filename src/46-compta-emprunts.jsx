// ═══ MODULE ═══
// @module Compta emprunts
// @depends FX_GAIN_ACCOUNT, FX_LOSS_ACCOUNT, FX_USD_ACCOUNT, fmt, fmtFx, fmtRate, fxRateOn, fxcCostOut
//   fxcPosition, isLocked, todayStr, uid, useState
// @exports LoansPanel, loansTotals
// ═══ FIN DE L'EN-TÊTE ═══
// Emprunts (v236, dollars v237) — tableau d'amortissement, déblocage, échéances, remboursement anticipé,
// intérêts courus. Les écritures suivent le plan comptable en usage en Haïti (famille PCG) :
//   164  Emprunts auprès des établissements de crédit (banque, coopérative, microfinance)
//   168  Autres emprunts et dettes assimilées (prêt d'un tiers)         1688 Intérêts courus
//   455  Associés — comptes courants (prêt d'un associé ou du dirigeant)
//   6611 Intérêts des emprunts · 627 frais de dossier · 616 assurance emprunteur
//   668  pénalité de remboursement anticipé
// Une échéance payée = un débit du capital (16x/455) + un débit des intérêts (6611) [+ assurance]
// contre un crédit de la trésorerie. Le tableau de la banque fait foi : chaque ligne non payée
// peut être corrigée.
// Emprunt en dollars (v237) : le tableau est tenu en USD ; la comptabilité reste en gourdes.
//   - déblocage : valeur en gourdes = montant USD × taux du jour (écriture au taux d'origine) ;
//   - chaque paiement : le capital sort au taux d'origine (valeur comptable proportionnelle),
//     les intérêts et l'assurance sont convertis au taux du paiement ; la différence entre la
//     valeur payée et la valeur comptable du capital est un écart de change RÉALISÉ (666 perte /
//     766 gain) ; payé depuis le compte en dollars (5121), la sortie est valorisée au coût moyen ;
//   - l'écart latent (dette encore ouverte) est seulement ESTIMÉ à un taux choisi, jamais
//     comptabilisé (règle à valider par l'expert-comptable, comme pour les créances/dettes en devise).

// <calcul-emprunts>
const LOAN_FREQ = {
  monthly: { label: "Mensuelle", months: 1 },
  quarterly: { label: "Trimestrielle", months: 3 },
  semester: { label: "Semestrielle", months: 6 },
  annual: { label: "Annuelle", months: 12 },
};
const LOAN_KINDS = {
  banque: { label: "Banque, coopérative ou microfinance", code: "164", name: "Emprunts auprès des établissements de crédit" },
  tiers: { label: "Tiers (personne ou entreprise hors associé)", code: "168", name: "Autres emprunts et dettes assimilées" },
  associe: { label: "Associé ou dirigeant (compte courant)", code: "455", name: "Associés — comptes courants" },
};
const LOAN_METHODS = {
  annuite: "Échéance constante (capital + intérêts)",
  capital: "Capital constant (échéance décroissante)",
  infine: "In fine (intérêts périodiques, capital à la fin)",
};
const LOAN_ACCOUNTS = {
  interest: { code: "6611", name: "Intérêts des emprunts et dettes", type: "Charge" },
  accrued: { code: "1688", name: "Intérêts courus sur emprunts", type: "Passif" },
  penalty: { code: "668", name: "Autres charges financières (pénalités de remboursement anticipé)", type: "Charge" },
  fees: { code: "627", name: "Frais bancaires", type: "Charge" },
  insurance: { code: "616", name: "Assurances", type: "Charge" },
};
const loanRound = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
const loanIsFx = (loan) => !!loan && !!loan.currency && loan.currency !== "HTG";
// Valeur comptable restante (en gourdes) d'un emprunt en devise : valeur d'origine moins ce qui est déjà sorti.
function loanBookRemaining(loan) {
  if (!loanIsFx(loan)) return null;
  if (loan.status === "solde") return 0;
  const out = (loan.rows || []).filter((r) => r.status === "payee").reduce((s, r) => s + (r.carry || 0), 0);
  return Math.max(0, loanRound((loan.bookHtg || 0) - out));
}
// Règlement d'une part d'emprunt en devise. Retourne la valeur comptable sortie (carry), les montants
// en gourdes, le décaissement réel (cash) et l'écart de change (> 0 : perte, < 0 : gain).
// costOut : si le paiement sort du compte en dollars, valeur en gourdes de la sortie (coût moyen),
// répartie au prorata ; le capital reçoit le reliquat d'arrondi.
function loanFxSettle(bookRemaining, remainingForeign, parts, rate, costOut) {
  const cap = loanRound(parts.capital || 0), int = loanRound(parts.interest || 0), ins = loanRound(parts.insurance || 0), pen = loanRound(parts.penalty || 0);
  const full = cap >= remainingForeign - 0.005;
  const carry = full ? loanRound(bookRemaining) : loanRound(bookRemaining * cap / remainingForeign);
  let capV, intV, insV, penV, cash;
  if (costOut !== undefined && costOut !== null) {
    const T = cap + int + ins + pen;
    cash = loanRound(costOut);
    intV = T > 0 ? loanRound(cash * int / T) : 0; insV = T > 0 ? loanRound(cash * ins / T) : 0; penV = T > 0 ? loanRound(cash * pen / T) : 0;
    capV = loanRound(cash - intV - insV - penV);
  } else {
    capV = loanRound(cap * rate); intV = loanRound(int * rate); insV = loanRound(ins * rate); penV = loanRound(pen * rate);
    cash = loanRound(capV + intV + insV + penV);
  }
  return { carry, capV, intV, insV, penV, cash, diff: loanRound(capV - carry) };
}
function loanParseDate(s) {
  const [y, m, d] = String(s || "").slice(0, 10).split("-").map(Number);
  return { y, m, d };
}
function loanFmtDate(y, m, d) {
  return y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
}
function loanValidDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ""))) return false;
  const { y, m, d } = loanParseDate(s);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
function loanAddMonths(s, n, anchorDay) {
  const { y, m, d } = loanParseDate(s);
  const t = y * 12 + (m - 1) + n;
  const ny = Math.floor(t / 12), nm = (t % 12) + 1;
  const dim = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return loanFmtDate(ny, nm, Math.min(anchorDay || d, dim));
}
function loanAddDays(s, n) {
  const { y, m, d } = loanParseDate(s);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return loanFmtDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
function loanDaysBetween(a, b) {
  const pa = loanParseDate(a), pb = loanParseDate(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
}
// Tableau d'amortissement. count = nombre d'échéances ; grace = échéances d'intérêts seuls au début.
function loanBuildSchedule(p) {
  const P = loanRound(p.principal);
  const n = Math.max(1, Math.floor(p.count));
  const g = Math.min(Math.max(0, Math.floor(p.grace || 0)), n - 1);
  const pm = p.periodMonths || 1;
  const i = ((Number(p.annualRate) || 0) / 100) * pm / 12;
  const anchor = loanParseDate(p.firstDate).d;
  const ins = loanRound(p.insurance || 0);
  const amortN = n - g;
  let annuity = 0;
  if (p.method === "annuite") annuity = loanRound(i > 0 ? (P * i) / (1 - Math.pow(1 + i, -amortN)) : P / amortN);
  const constCap = loanRound(P / amortN);
  const rows = [];
  let bal = P;
  for (let k = 0; k < n; k++) {
    const date = loanAddMonths(p.firstDate, k * pm, anchor);
    const interest = loanRound(bal * i);
    let capital = 0;
    if (k >= g) {
      if (p.method === "annuite") capital = loanRound(annuity - interest);
      else if (p.method === "capital") capital = constCap;
      else capital = k === n - 1 ? bal : 0;
      if (k === n - 1 || capital > bal) capital = bal;
      if (capital < 0) capital = 0;
    }
    capital = loanRound(capital);
    bal = loanRound(bal - capital);
    rows.push({ n: k + 1, date, capital, interest, insurance: ins, total: loanRound(capital + interest + ins), status: "prevue" });
  }
  return rows;
}
// Situation d'un emprunt à une date : capital restant dû, part à moins d'un an, prochaine échéance.
function loanSummary(loan, asOf) {
  const rows = loan.rows || [];
  const paidCapital = rows.filter((r) => r.status === "payee").reduce((s, r) => s + (r.capital || 0), 0);
  const remaining = loan.status === "solde" ? 0 : loanRound((loan.disbursed || loan.alreadyRunning ? loan.principal : 0) - paidCapital);
  const unpaid = rows.filter((r) => r.status === "prevue");
  const horizon = loanAddMonths(asOf, 12);
  const dueWithinYear = loanRound(unpaid.filter((r) => r.date <= horizon).reduce((s, r) => s + (r.capital || 0), 0));
  const next = unpaid[0] || null;
  const overdue = unpaid.filter((r) => r.date < asOf).length;
  const rem = Math.max(0, remaining), due = Math.min(dueWithinYear, Math.max(0, remaining));
  let remainingBook = rem, dueBook = due;
  if (loanIsFx(loan)) {
    remainingBook = loanBookRemaining(loan);
    dueBook = rem > 0 ? loanRound(remainingBook * due / rem) : 0;
  }
  return { paidCapital: loanRound(paidCapital), remaining: rem, dueWithinYear: due, remainingBook, dueBook, next, overdue };
}
function loansTotals(loans, asOf) {
  let remaining = 0, dueWithinYear = 0, overdue = 0, next = null;
  (loans || []).forEach((l) => {
    if (l.status === "solde") return;
    const s = loanSummary(l, asOf);
    remaining += s.remainingBook; dueWithinYear += s.dueBook; overdue += s.overdue;
    if (s.next && (!next || s.next.date < next.date)) next = { ...s.next, loanName: l.name, currency: l.currency || "HTG" };
  });
  return { remaining: loanRound(remaining), dueWithinYear: loanRound(dueWithinYear), overdue, next };
}
// Intérêts courus à une date : échéances échues non payées (en entier) + part au prorata de la période en cours.
function loanAccrued(loan, asOf) {
  if (loan.status === "solde") return 0;
  const rows = loan.rows || [];
  const unpaid = rows.filter((r) => r.status === "prevue");
  if (unpaid.length === 0) return 0;
  let total = 0;
  unpaid.forEach((r) => { if (r.date <= asOf) total += r.interest || 0; });
  const nextRow = unpaid.find((r) => r.date > asOf);
  if (nextRow) {
    const idx = rows.indexOf(nextRow);
    const prevDue = idx > 0 ? rows[idx - 1].date : (loan.firstRowStart || loan.startDate);
    const periodDays = Math.max(1, loanDaysBetween(prevDue, nextRow.date));
    const days = Math.min(periodDays, Math.max(0, loanDaysBetween(prevDue, asOf)));
    total += (nextRow.interest || 0) * days / periodDays;
  }
  return loanRound(total);
}
// Remboursement anticipé partiel : recalcule les échéances restantes sur le nouveau capital,
// à dates inchangées. Intérêts de la période en cours au prorata (avant / après la date de remboursement).
function loanRebuildAfterPartial(loan, repayDate, capital) {
  const rows = loan.rows || [];
  const unpaid = rows.filter((r) => r.status === "prevue");
  if (unpaid.length === 0) return rows;
  const first = unpaid[0];
  const fi = rows.indexOf(first);
  const prevDue = fi > 0 ? rows[fi - 1].date : (loan.firstRowStart || loan.startDate);
  const paidCap = rows.filter((r) => r.status === "payee").reduce((s, r) => s + (r.capital || 0), 0) + capital;
  const newBal = loanRound(loan.principal - paidCap);
  if (newBal <= 0) return rows.filter((r) => r.status !== "prevue");
  const pm = loan.periodMonths || 1;
  const rebuilt = loanBuildSchedule({
    principal: newBal, annualRate: loan.annualRate, count: unpaid.length, periodMonths: pm,
    firstDate: first.date, method: loan.method, grace: 0, insurance: loan.insurance || 0,
  });
  const periodDays = Math.max(1, loanDaysBetween(prevDue, first.date));
  const remainDays = Math.min(periodDays, Math.max(0, loanDaysBetween(repayDate, first.date)));
  const i = ((Number(loan.annualRate) || 0) / 100) * pm / 12;
  rebuilt[0].interest = loanRound(newBal * i * remainDays / periodDays);
  rebuilt[0].total = loanRound(rebuilt[0].capital + rebuilt[0].interest + rebuilt[0].insurance);
  const lastN = rows.slice(0, fi).length;
  return [...rows.slice(0, fi), ...rebuilt.map((r, k) => ({ ...r, n: lastN + k + 1 }))];
}
// </calcul-emprunts>

function loanCsv(loan) {
  const head = ["N°", "Échéance", "Capital", "Intérêts", "Assurance", "Total", "Statut", "Payée le"];
  const body = (loan.rows || []).map((r) => [
    r.type === "anticipe" ? "Anticipé" : r.n, r.date, String(r.capital).replace(".", ","), String(r.interest).replace(".", ","),
    String(r.insurance || 0).replace(".", ","), String(r.total).replace(".", ","),
    r.status === "payee" ? "Payée" : "Prévue", r.paidDate || "",
  ]);
  return "﻿" + [head, ...body].map((l) => l.join(";")).join("\r\n");
}
function loanDownload(loan) {
  try {
    const blob = new Blob([loanCsv(loan)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "tableau-amortissement-" + String(loan.name || "emprunt").replace(/[^\w\-]+/g, "_") + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) { /* téléchargement indisponible */ }
}

function LoansPanel({ accounts, setAccounts, loans, setLoans, entries, setEntries, settings, role, showToast, logAudit }) {
  const canEdit = role === "Administrateur" || role === "Éditeur";
  const isAdmin = role === "Administrateur";
  const today = todayStr();
  const baseCur = settings.currency || "HTG";
  const rates = settings.fxRates || [];
  const usdPos = fxcPosition(entries);
  const allTreasury = accounts.filter((a) => a.type === "Actif" && String(a.code).startsWith("5"));
  const treasury = allTreasury.filter((a) => a.code !== FX_USD_ACCOUNT.code);
  const treasuryUsd = allTreasury.some((a) => a.code === FX_USD_ACCOUNT.code) ? allTreasury : [...allTreasury, FX_USD_ACCOUNT];
  const defaultTreasury = (treasury.find((a) => a.code === "512") || treasury[0] || { code: "512" }).code;
  const money = (loan, n) => (loanIsFx(loan) ? fmtFx(n, loan.currency) : fmt(n));
  const blank = {
    name: "", kind: "banque", lender: "", principal: "", annualRate: "", startDate: today, freq: "monthly", count: "12",
    firstDate: loanAddMonths(today, 1), method: "annuite", grace: "0", insurance: "", fees: "", account: defaultTreasury, alreadyRunning: false,
    currency: "HTG", bookRate: "",
  };
  const [form, setForm] = useState(blank);
  const [preview, setPreview] = useState(null);
  const [open, setOpen] = useState(null);
  const [pay, setPay] = useState(null);
  const [accr, setAccr] = useState(null);
  const [early, setEarly] = useState(null);
  const [edit, setEdit] = useState(null);
  const [latentRates, setLatentRates] = useState({});

  const totals = loansTotals(loans, today);
  const fxLoans = (loans || []).filter((l) => loanIsFx(l) && l.status !== "solde");
  const fxTot = fxLoans.reduce((t, l) => {
    const sm = loanSummary(l, today), r = fxRateOn(rates, l.currency, today);
    t.remaining += sm.remaining; t.due += sm.dueWithinYear; t.book += sm.remainingBook;
    t.latent = r > 0 && t.latent !== null ? t.latent + (sm.remainingBook - loanRound(sm.remaining * r)) : null;
    return t;
  }, { remaining: 0, due: 0, book: 0, latent: 0 });
  const ensureAccounts = (defs) => {
    const missing = defs.filter((d) => !accounts.some((a) => a.code === d.code));
    if (missing.length) setAccounts((prev) => [...prev, ...missing.filter((d) => !prev.some((a) => a.code === d.code)).map((d) => ({ code: d.code, name: d.name, type: d.type }))]);
  };
  const loanDef = (kind) => ({ code: LOAN_KINDS[kind].code, name: LOAN_KINDS[kind].name, type: "Passif" });
  const lock = (date) => {
    if (isLocked(date, settings)) { showToast("La période comptable est clôturée jusqu'au " + settings.lockDate + " inclus : impossible d'enregistrer une opération à cette date."); return true; }
    return false;
  };
  const upd = (id, fn) => setLoans((prev) => prev.map((l) => (l.id === id ? fn(l) : l)));
  const mkEntry = (date, label, lines, extra) => ({ id: uid(), date, createdAt: new Date().toISOString(), label, lines: lines.filter((l) => l.debit > 0 || l.credit > 0), ...extra });

  // Plan de règlement d'une part d'emprunt en devise (taux saisi ou du jour ; compte en dollars : coût moyen).
  const fxPlanFor = (loan, parts, account, date, rateStr) => {
    const sum = loanSummary(loan, today);
    const T = loanRound((parts.capital || 0) + (parts.interest || 0) + (parts.insurance || 0) + (parts.penalty || 0));
    const rate = rateStr !== "" && rateStr !== undefined ? Number(rateStr) : fxRateOn(rates, loan.currency, date);
    if (account === FX_USD_ACCOUNT.code) {
      if (!(usdPos.usd > 0.004)) return { error: "Le compte en dollars est vide : achetez d'abord des dollars (module Devises), ou payez depuis un compte en gourdes." };
      if (T > usdPos.usd + 0.005) return { error: "Solde insuffisant sur le compte en dollars : " + fmtFx(usdPos.usd, "USD") + " disponibles." };
      return { plan: loanFxSettle(loanBookRemaining(loan), sum.remaining, parts, null, fxcCostOut(usdPos, T)), viaUsd: true, rate: usdPos.avg, total: T };
    }
    if (!(rate > 0)) return { error: "Indiquez le taux de change du dollar à la date du paiement (ou enregistrez-le dans le module Devises)." };
    return { plan: loanFxSettle(loanBookRemaining(loan), sum.remaining, parts, rate), viaUsd: false, rate, total: T };
  };
  const fxLines = (loan, plan, cashAccount) => [
    { account: loan.account, debit: plan.carry, credit: 0 },
    { account: LOAN_ACCOUNTS.interest.code, debit: plan.intV, credit: 0 },
    { account: LOAN_ACCOUNTS.insurance.code, debit: plan.insV, credit: 0 },
    { account: LOAN_ACCOUNTS.penalty.code, debit: plan.penV, credit: 0 },
    { account: FX_LOSS_ACCOUNT.code, debit: plan.diff > 0 ? plan.diff : 0, credit: 0 },
    { account: cashAccount, debit: 0, credit: plan.cash },
    { account: FX_GAIN_ACCOUNT.code, debit: 0, credit: plan.diff < 0 ? -plan.diff : 0 },
  ];
  const fxExtra = (loan, res, amount, capital) => {
    const x = { loanFx: { currency: loan.currency, amount, capital, rate: res.rate, carry: res.plan.carry, diff: res.plan.diff } };
    if (res.viaUsd) x.fxc = { type: "spend", usd: amount, costOut: res.plan.cash };
    return x;
  };
  const ensureFxPlanAccounts = (res, extra) => {
    const defs = [...(extra || [])];
    if (res.viaUsd) defs.push(FX_USD_ACCOUNT);
    if (res.plan.diff > 0) defs.push(FX_LOSS_ACCOUNT);
    if (res.plan.diff < 0) defs.push(FX_GAIN_ACCOUNT);
    ensureAccounts(defs);
  };
  const diffText = (d) => (d === 0 ? "aucun écart de change" : (d > 0 ? "perte" : "gain") + " de change de " + fmt(Math.abs(d)));

  const parseForm = () => {
    const principal = loanRound(form.principal), rate = Number(form.annualRate), count = Math.floor(Number(form.count));
    const pm = LOAN_FREQ[form.freq].months;
    if (!form.name.trim()) { showToast("Donnez un nom à cet emprunt (par exemple : « Prêt banque — camion »)."); return null; }
    if (!(principal > 0)) { showToast("Indiquez le montant emprunté."); return null; }
    if (!(rate >= 0) || form.annualRate === "") { showToast("Indiquez le taux d'intérêt annuel (0 si aucun)."); return null; }
    if (!(count >= 1) || count > 600) { showToast("Indiquez un nombre d'échéances valide."); return null; }
    if (!loanValidDate(form.startDate) || !loanValidDate(form.firstDate)) { showToast("Vérifiez les dates saisies."); return null; }
    if (form.firstDate <= form.startDate && !form.alreadyRunning) { showToast("La première échéance doit être après la date de déblocage."); return null; }
    const grace = Math.floor(Number(form.grace) || 0);
    if (grace < 0 || grace >= count) { showToast("Le différé doit être inférieur au nombre d'échéances."); return null; }
    let fxRate = null;
    if (form.currency !== "HTG") {
      fxRate = form.bookRate !== "" ? Number(form.bookRate) : fxRateOn(rates, form.currency, form.startDate);
      if (!(fxRate > 0)) { showToast(form.alreadyRunning ? "Indiquez le taux de change auquel cette dette est déjà inscrite dans vos comptes." : "Indiquez le taux de change du dollar à la date du déblocage (ou enregistrez-le dans le module Devises)."); return null; }
    }
    return { principal, rate, count, pm, grace, insurance: loanRound(form.insurance || 0), fees: loanRound(form.fees || 0), fxRate };
  };
  const compute = () => {
    const v = parseForm();
    if (!v) return;
    setPreview(loanBuildSchedule({ principal: v.principal, annualRate: v.rate, count: v.count, periodMonths: v.pm, firstDate: form.firstDate, method: form.method, grace: v.grace, insurance: v.insurance }));
  };
  const saveLoan = () => {
    const v = parseForm();
    if (!v) return;
    if (!form.alreadyRunning && lock(form.startDate)) return;
    const rows = loanBuildSchedule({ principal: v.principal, annualRate: v.rate, count: v.count, periodMonths: v.pm, firstDate: form.firstDate, method: form.method, grace: v.grace, insurance: v.insurance });
    const loanId = uid();
    const defs = [loanDef(form.kind), LOAN_ACCOUNTS.interest, LOAN_ACCOUNTS.accrued];
    if (v.fees > 0) defs.push(LOAN_ACCOUNTS.fees);
    if (v.insurance > 0) defs.push(LOAN_ACCOUNTS.insurance);
    ensureAccounts(defs);
    let disbEntryId = null;
    const isFx = form.currency !== "HTG";
    const bookHtg = isFx ? loanRound(v.principal * v.fxRate) : 0;
    if (!form.alreadyRunning) {
      let e;
      if (isFx) {
        const feeHtg = loanRound(v.fees * v.fxRate), recvHtg = loanRound(bookHtg - feeHtg);
        e = mkEntry(form.startDate, "Déblocage de l'emprunt — " + form.name.trim() + " — " + fmtFx(v.principal, form.currency) + " × " + fmtRate(v.fxRate), [
          { account: form.account, debit: recvHtg, credit: 0 },
          { account: LOAN_ACCOUNTS.fees.code, debit: feeHtg, credit: 0 },
          { account: LOAN_KINDS[form.kind].code, debit: 0, credit: bookHtg },
        ], { loanId, loanFx: { currency: form.currency, amount: v.principal, rate: v.fxRate } });
        if (form.account === FX_USD_ACCOUNT.code) {
          e.fxc = { type: "buy", usd: loanRound(v.principal - v.fees), rate: v.fxRate, cost: recvHtg, commission: 0, source: LOAN_KINDS[form.kind].code };
          ensureAccounts([FX_USD_ACCOUNT]);
        }
      } else {
        e = mkEntry(form.startDate, "Déblocage de l'emprunt — " + form.name.trim(), [
          { account: form.account, debit: loanRound(v.principal - v.fees), credit: 0 },
          { account: LOAN_ACCOUNTS.fees.code, debit: v.fees, credit: 0 },
          { account: LOAN_KINDS[form.kind].code, debit: 0, credit: v.principal },
        ], { loanId });
      }
      disbEntryId = e.id;
      setEntries((prev) => [...prev, e]);
    }
    setLoans((prev) => [...prev, {
      id: loanId, name: form.name.trim(), kind: form.kind, lender: form.lender.trim(), principal: v.principal, annualRate: v.rate,
      startDate: form.startDate, periodMonths: v.pm, method: form.method, grace: v.grace, insurance: v.insurance, fees: v.fees,
      ...(isFx ? { currency: form.currency, bookRate: v.fxRate, bookHtg } : {}),
      account: LOAN_KINDS[form.kind].code, alreadyRunning: !!form.alreadyRunning, disbursed: !form.alreadyRunning, disbursementEntryId: disbEntryId,
      firstRowStart: form.alreadyRunning ? loanAddMonths(form.firstDate, -v.pm) : form.startDate,
      rows, accruals: [], status: "encours", createdAt: new Date().toISOString(),
    }]);
    logAudit("Comptabilité", "Nouvel emprunt", form.name.trim() + " : " + (isFx ? fmtFx(v.principal, form.currency) + " (taux " + fmtRate(v.fxRate) + ")" : fmt(v.principal)) + " à " + v.rate + " %");
    showToast(form.alreadyRunning ? "Emprunt enregistré (déjà en cours, aucune écriture de déblocage)." : "Emprunt enregistré et déblocage comptabilisé.");
    setForm({ ...blank, account: defaultTreasury });
    setPreview(null);
    setOpen(loanId);
  };

  const startPay = (loan, row) => setPay({ loanId: loan.id, n: row.n, date: row.date > today ? today : row.date, account: defaultTreasury, rate: "" });
  const doPay = (loan) => {
    const row = (loan.rows || []).find((r) => r.n === pay.n && r.status === "prevue" && r.type !== "anticipe");
    if (!row) return;
    const first = loan.rows.find((r) => r.status === "prevue");
    if (first !== row) { showToast("Payez d'abord l'échéance précédente."); return; }
    if (!loanValidDate(pay.date)) { showToast("Vérifiez la date du paiement."); return; }
    if (lock(pay.date)) return;
    if (!(row.total > 0)) { showToast("Cette échéance est à zéro : il n'y a rien à payer."); return; }
    const baseDefs = [loanDef(loan.kind), LOAN_ACCOUNTS.interest, ...(row.insurance > 0 ? [LOAN_ACCOUNTS.insurance] : [])];
    const label = "Échéance " + row.n + "/" + loan.rows.filter((r) => r.type !== "anticipe").length + " — " + loan.name;
    let e, fxRow = {}, res = null;
    if (loanIsFx(loan)) {
      res = fxPlanFor(loan, { capital: row.capital, interest: row.interest, insurance: row.insurance || 0 }, pay.account, pay.date, pay.rate);
      if (res.error) { showToast(res.error); return; }
      if (pay.date < loan.startDate && !loan.alreadyRunning) { showToast("La date du paiement ne peut pas précéder celle du déblocage."); return; }
      ensureFxPlanAccounts(res, baseDefs);
      e = mkEntry(pay.date, label + " — " + fmtFx(row.total, loan.currency) + " × " + fmtRate(res.rate), fxLines(loan, res.plan, pay.account), { loanId: loan.id, loanRow: row.n, ...fxExtra(loan, res, row.total, row.capital) });
      fxRow = { carry: res.plan.carry, fxRate: res.rate, fxDiff: res.plan.diff };
    } else {
      ensureAccounts(baseDefs);
      e = mkEntry(pay.date, label, [
        { account: loan.account, debit: row.capital, credit: 0 },
        { account: LOAN_ACCOUNTS.interest.code, debit: row.interest, credit: 0 },
        { account: LOAN_ACCOUNTS.insurance.code, debit: row.insurance || 0, credit: 0 },
        { account: pay.account, debit: 0, credit: row.total },
      ], { loanId: loan.id, loanRow: row.n });
    }
    setEntries((prev) => [...prev, e]);
    upd(loan.id, (l) => {
      const rows = l.rows.map((r) => (r === row || (r.n === row.n && r.type !== "anticipe") ? { ...r, status: "payee", entryId: e.id, paidDate: pay.date, ...fxRow } : r));
      const done = rows.every((r) => r.status === "payee");
      return { ...l, rows, status: done ? "solde" : l.status };
    });
    logAudit("Comptabilité", "Échéance d'emprunt payée", loan.name + " n° " + row.n + " : " + money(loan, row.total) + (res ? " (" + diffText(res.plan.diff) + ")" : ""));
    showToast(res && res.plan.diff !== 0 ? "Échéance enregistrée — " + diffText(res.plan.diff) + "." : "Échéance enregistrée.");
    setPay(null);
  };
  const cancelPay = (loan, row) => {
    if (!isAdmin) { showToast("Seul un administrateur peut annuler un paiement d'échéance."); return; }
    const orig = entries.find((x) => x.id === row.entryId);
    if (!orig) { showToast("L'écriture de ce paiement est introuvable."); return; }
    if (isLocked(orig.date, settings)) { showToast("La période comptable est clôturée jusqu'au " + settings.lockDate + " inclus : ce paiement ne peut plus être annulé."); return; }
    if (orig.cancelledBy) { showToast("Ce paiement a déjà été annulé."); return; }
    if (row.type === "anticipe") { showToast("Un remboursement anticipé s'annule par une écriture de correction dans le journal."); return; }
    const later = loan.rows.some((r) => r.n > row.n && r.status === "payee");
    if (later) { showToast("Annulez d'abord les paiements plus récents."); return; }
    if (!window.confirm("Annuler ce paiement ? Une écriture de contrepassation sera ajoutée au journal et l'échéance redeviendra à payer.")) return;
    const revId = uid();
    setEntries((prev) => [
      ...prev.map((x) => (x.id === orig.id ? { ...x, cancelledBy: revId } : x)),
      { id: revId, date: today, createdAt: new Date().toISOString(), label: "Contrepassation — " + orig.label, reversalOf: orig.id, lines: orig.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })), loanId: loan.id },
    ]);
    upd(loan.id, (l) => ({ ...l, status: "encours", rows: l.rows.map((r) => (r.n === row.n && r.type !== "anticipe" ? { ...r, status: "prevue", entryId: undefined, paidDate: undefined, carry: undefined, fxRate: undefined, fxDiff: undefined } : r)) }));
    logAudit("Comptabilité", "Paiement d'échéance annulé", loan.name + " n° " + row.n);
    showToast("Paiement annulé par contrepassation.");
  };
  const saveEdit = (loan) => {
    const c = loanRound(edit.capital), it = loanRound(edit.interest), ins = loanRound(edit.insurance || 0);
    if (!(c >= 0) || !(it >= 0) || !(ins >= 0) || !loanValidDate(edit.date)) { showToast("Vérifiez les montants et la date."); return; }
    upd(loan.id, (l) => ({ ...l, rows: l.rows.map((r) => (r.n === edit.n && r.status === "prevue" && r.type !== "anticipe" ? { ...r, date: edit.date, capital: c, interest: it, insurance: ins, total: loanRound(c + it + ins), edited: true } : r)) }));
    logAudit("Comptabilité", "Échéance d'emprunt modifiée (tableau de la banque)", loan.name + " n° " + edit.n);
    showToast("Échéance corrigée.");
    setEdit(null);
  };

  const startAccrual = (loan) => setAccr({ loanId: loan.id, date: today, rate: "" });
  const accrRateOf = (loan, a) => (!loanIsFx(loan) ? 1 : (a.rate !== "" && a.rate !== undefined ? Number(a.rate) : fxRateOn(rates, loan.currency, a.date)));
  const doAccrual = (loan) => {
    if (!loanValidDate(accr.date)) { showToast("Vérifiez la date."); return; }
    if ((loan.accruals || []).some((a) => a.asOf === accr.date && !a.cancelled)) { showToast("Les intérêts courus à cette date ont déjà été constatés."); return; }
    if (lock(accr.date)) return;
    const amountF = loanAccrued(loan, accr.date);
    if (!(amountF > 0)) { showToast("Aucun intérêt couru à constater à cette date."); return; }
    const aRate = accrRateOf(loan, accr);
    if (!(aRate > 0)) { showToast("Indiquez le taux de change du dollar à la date de clôture (ou enregistrez-le dans le module Devises)."); return; }
    const amount = loanIsFx(loan) ? loanRound(amountF * aRate) : amountF;
    ensureAccounts([LOAN_ACCOUNTS.interest, LOAN_ACCOUNTS.accrued]);
    const next = loanAddDays(accr.date, 1);
    const e1 = mkEntry(accr.date, "Intérêts courus non échus — " + loan.name, [
      { account: LOAN_ACCOUNTS.interest.code, debit: amount, credit: 0 }, { account: LOAN_ACCOUNTS.accrued.code, debit: 0, credit: amount },
    ], { loanId: loan.id });
    const e2 = mkEntry(next, "Extourne intérêts courus — " + loan.name, [
      { account: LOAN_ACCOUNTS.accrued.code, debit: amount, credit: 0 }, { account: LOAN_ACCOUNTS.interest.code, debit: 0, credit: amount },
    ], { loanId: loan.id, reversalOf: e1.id });
    e1.cancelledBy = e2.id;
    setEntries((prev) => [...prev, e1, e2]);
    upd(loan.id, (l) => ({ ...l, accruals: [...(l.accruals || []), { id: uid(), asOf: accr.date, amount, ...(loanIsFx(loan) ? { amountForeign: amountF, rate: aRate } : {}), entryId: e1.id, reversalId: e2.id }] }));
    logAudit("Comptabilité", "Intérêts courus d'emprunt constatés", loan.name + " au " + accr.date + " : " + fmt(amount) + (loanIsFx(loan) ? " (" + fmtFx(amountF, loan.currency) + " × " + fmtRate(aRate) + ")" : ""));
    showToast("Intérêts courus de " + fmt(amount) + " constatés, avec leur extourne au lendemain.");
    setAccr(null);
  };

  const startEarly = (loan) => {
    const sum = loanSummary(loan, today);
    setEarly({ loanId: loan.id, date: today, total: false, capital: "", interest: "", penalty: "", account: defaultTreasury, remaining: sum.remaining, rate: "" });
  };
  const earlyDefaults = (loan, e) => {
    const unpaid = loan.rows.filter((r) => r.status === "prevue");
    const first = unpaid[0];
    if (!first || !loanValidDate(e.date)) return 0;
    const fi = loan.rows.indexOf(first);
    const prevDue = fi > 0 ? loan.rows[fi - 1].date : (loan.firstRowStart || loan.startDate);
    const periodDays = Math.max(1, loanDaysBetween(prevDue, first.date));
    const days = Math.min(periodDays, Math.max(0, loanDaysBetween(prevDue, e.date)));
    return loanRound(first.interest * days / periodDays);
  };
  const doEarly = (loan) => {
    const sum = loanSummary(loan, today);
    const unpaid = loan.rows.filter((r) => r.status === "prevue");
    const first = unpaid[0];
    if (!first) { showToast("Cet emprunt n'a plus d'échéance à payer."); return; }
    if (!loanValidDate(early.date)) { showToast("Vérifiez la date du remboursement."); return; }
    if (early.date >= first.date) { showToast("Payez d'abord l'échéance du " + first.date + ", puis faites le remboursement anticipé."); return; }
    if (lock(early.date)) return;
    const cap = early.total ? sum.remaining : loanRound(early.capital);
    if (!(cap > 0) || cap > sum.remaining + 0.001) { showToast("Le capital remboursé doit être positif et ne pas dépasser le capital restant dû (" + money(loan, sum.remaining) + ")."); return; }
    const it = early.interest === "" ? earlyDefaults(loan, early) : loanRound(early.interest);
    const pen = loanRound(early.penalty || 0);
    if (!(it >= 0) || !(pen >= 0)) { showToast("Vérifiez les montants."); return; }
    const total = loanRound(cap + it + pen);
    const earlyLabel = (early.total ? "Remboursement anticipé total" : "Remboursement anticipé partiel") + " — " + loan.name;
    const baseDefs = [loanDef(loan.kind), LOAN_ACCOUNTS.interest, ...(pen > 0 ? [LOAN_ACCOUNTS.penalty] : [])];
    let e, fxRow = {}, res = null;
    if (loanIsFx(loan)) {
      res = fxPlanFor(loan, { capital: cap, interest: it, penalty: pen }, early.account, early.date, early.rate);
      if (res.error) { showToast(res.error); return; }
      ensureFxPlanAccounts(res, baseDefs);
      e = mkEntry(early.date, earlyLabel + " — " + fmtFx(total, loan.currency) + " × " + fmtRate(res.rate), fxLines(loan, res.plan, early.account), { loanId: loan.id, ...fxExtra(loan, res, total, cap) });
      fxRow = { carry: res.plan.carry, fxRate: res.rate, fxDiff: res.plan.diff };
    } else {
      ensureAccounts(baseDefs);
      e = mkEntry(early.date, earlyLabel, [
        { account: loan.account, debit: cap, credit: 0 },
        { account: LOAN_ACCOUNTS.interest.code, debit: it, credit: 0 },
        { account: LOAN_ACCOUNTS.penalty.code, debit: pen, credit: 0 },
        { account: early.account, debit: 0, credit: total },
      ], { loanId: loan.id });
    }
    setEntries((prev) => [...prev, e]);
    upd(loan.id, (l) => {
      const paidRow = { n: 0, type: "anticipe", date: early.date, capital: cap, interest: it, insurance: 0, penalty: pen, total, status: "payee", entryId: e.id, paidDate: early.date, ...fxRow };
      if (early.total || cap >= sum.remaining - 0.001) {
        return { ...l, rows: [...l.rows.filter((r) => r.status === "payee"), paidRow], status: "solde" };
      }
      const rebuilt = loanRebuildAfterPartial(l, early.date, cap);
      const idx = rebuilt.findIndex((r) => r.status === "prevue");
      const rows = idx < 0 ? [...rebuilt, paidRow] : [...rebuilt.slice(0, idx), paidRow, ...rebuilt.slice(idx)];
      return { ...l, rows };
    });
    logAudit("Comptabilité", "Remboursement anticipé d'emprunt", loan.name + " : capital " + money(loan, cap) + (pen > 0 ? ", pénalité " + money(loan, pen) : "") + (res ? " (" + diffText(res.plan.diff) + ")" : ""));
    showToast((early.total ? "Emprunt soldé par remboursement anticipé." : "Remboursement partiel enregistré ; les échéances restantes ont été recalculées.") + (res && res.plan.diff !== 0 ? " " + diffText(res.plan.diff).replace(/^./, (c) => c.toUpperCase()) + "." : ""));
    setEarly(null);
  };
  const removeLoan = (loan) => {
    if (loan.rows.some((r) => r.status === "payee") || (loan.accruals || []).length > 0) { showToast("Cet emprunt a déjà des écritures : il ne peut pas être supprimé."); return; }
    if (!isAdmin) { showToast("Seul un administrateur peut supprimer un emprunt."); return; }
    if (loan.disbursementEntryId) { showToast("Le déblocage est déjà comptabilisé : annulez d'abord cette écriture dans le journal (contrepassation), puis supprimez l'emprunt."); return; }
    if (!window.confirm("Supprimer cet emprunt ? Aucune écriture n'a été passée.")) return;
    setLoans((prev) => prev.filter((l) => l.id !== loan.id));
    logAudit("Comptabilité", "Emprunt supprimé", loan.name);
    showToast("Emprunt supprimé.");
  };

  const pm$ = (n) => (form.currency !== "HTG" ? fmtFx(n, form.currency) : fmt(n));
  const inp = "w-full border rounded px-2 py-1.5 text-sm mt-1";
  const bd = { borderColor: "#DDD6C4" };
  const lab = (t) => <label className="text-xs" style={{ color: "#8A8370" }}>{t}</label>;
  const treasurySelect = (value, onChange, tid, usd) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inp} style={bd} data-testid={tid}>
      {(usd ? treasuryUsd : (treasury.length ? treasury : [{ code: "512", name: "Banque" }])).map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
    </select>
  );

  return (
    <div className="space-y-6" data-testid="loans-panel">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="loans-summary">
        <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}><div className="text-xs" style={{ color: "#8A8370" }}>Capital restant dû</div><div className="text-lg font-semibold tabular" style={{ color: "#152238" }} data-testid="loans-remaining">{fmt(totals.remaining)}</div></div>
        <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}><div className="text-xs" style={{ color: "#8A8370" }}>Dont à moins d'un an</div><div className="text-lg font-semibold tabular" style={{ color: "#152238" }} data-testid="loans-lt1">{fmt(totals.dueWithinYear)}</div></div>
        <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}><div className="text-xs" style={{ color: "#8A8370" }}>Prochaine échéance</div><div className="text-sm font-semibold" style={{ color: "#152238" }}>{totals.next ? totals.next.date + " · " + (totals.next.currency && totals.next.currency !== "HTG" ? fmtFx(totals.next.total, totals.next.currency) : fmt(totals.next.total)) : "—"}</div></div>
        <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}><div className="text-xs" style={{ color: "#8A8370" }}>Échéances en retard</div><div className="text-lg font-semibold" style={{ color: totals.overdue ? "#A6432F" : "#152238" }} data-testid="loans-overdue">{totals.overdue}</div></div>
      </div>

      {fxLoans.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="loans-fx-summary">
          <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}><div className="text-xs" style={{ color: "#8A8370" }}>Emprunts en dollars — capital restant dû</div><div className="text-lg font-semibold tabular" style={{ color: "#1F5A8C" }} data-testid="loans-fx-remaining">{fmtFx(fxTot.remaining, "USD")}</div></div>
          <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}><div className="text-xs" style={{ color: "#8A8370" }}>Dont à moins d'un an</div><div className="text-lg font-semibold tabular" style={{ color: "#1F5A8C" }} data-testid="loans-fx-lt1">{fmtFx(fxTot.due, "USD")}</div></div>
          <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}><div className="text-xs" style={{ color: "#8A8370" }}>Valeur comptable en gourdes</div><div className="text-lg font-semibold tabular" style={{ color: "#152238" }} data-testid="loans-fx-book">{fmt(fxTot.book)}</div></div>
          <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #E4DFD1" }}><div className="text-xs" style={{ color: "#8A8370" }}>Écart latent estimé (non comptabilisé)</div><div className="text-sm font-semibold tabular" style={{ color: fxTot.latent === null ? "#8A8370" : fxTot.latent >= 0 ? "#0F6B5C" : "#A6432F" }} data-testid="loans-fx-latent">{fxTot.latent === null ? "Taux du jour non enregistré" : (fxTot.latent >= 0 ? "gain " : "perte ") + fmt(Math.abs(fxTot.latent))}</div></div>
        </div>
      )}

      {canEdit && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }} data-testid="loan-form">
          <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Nouvel emprunt</div>
          <p className="text-xs mb-4" style={{ color: "#8A8370" }}>
            Les écritures sont générées dans le plan comptable : emprunts bancaires au 164, prêts de tiers au 168, prêts d'associé au 455, intérêts au 6611. Le tableau de votre banque fait foi : vous pourrez corriger chaque ligne avant de la payer. Les emprunts en dollars sont suivis en USD ; la comptabilité reste en gourdes, avec les écarts de change réalisés à chaque paiement.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">{lab("Nom de l'emprunt")}<input data-testid="loan-name" className={inp} style={bd} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex : Prêt banque — camion" /></div>
            <div>{lab("Type de prêteur")}<select data-testid="loan-kind" className={inp} style={bd} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{Object.entries(LOAN_KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
            {baseCur !== "USD" && (
              <div>{lab("Devise de l'emprunt")}<select data-testid="loan-currency" className={inp} style={bd} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value, bookRate: "", account: e.target.value === "HTG" ? defaultTreasury : FX_USD_ACCOUNT.code })}><option value="HTG">Gourdes (HTG)</option><option value="USD">Dollars américains (USD)</option></select></div>
            )}
            <div>{lab("Prêteur (nom)")}<input className={inp} style={bd} value={form.lender} onChange={(e) => setForm({ ...form, lender: e.target.value })} placeholder="Ex : Sogebank" /></div>
            <div>{lab(form.currency === "HTG" ? "Montant emprunté" : "Montant emprunté (en dollars)")}<input data-testid="loan-principal" type="number" min="0" className={inp + " text-right tabular"} style={bd} value={form.principal} onChange={(e) => setForm({ ...form, principal: e.target.value })} /></div>
            <div>{lab("Taux d'intérêt annuel (%)")}<input data-testid="loan-rate" type="number" min="0" step="0.01" className={inp + " text-right tabular"} style={bd} value={form.annualRate} onChange={(e) => setForm({ ...form, annualRate: e.target.value })} /></div>
            <div>{lab("Date de déblocage des fonds")}<input data-testid="loan-start" type="date" className={inp} style={bd} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></div>
            <div>{lab("Fréquence des échéances")}<select data-testid="loan-freq" className={inp} style={bd} value={form.freq} onChange={(e) => setForm({ ...form, freq: e.target.value })}>{Object.entries(LOAN_FREQ).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
            <div>{lab("Nombre d'échéances")}<input data-testid="loan-count" type="number" min="1" className={inp + " text-right tabular"} style={bd} value={form.count} onChange={(e) => setForm({ ...form, count: e.target.value })} /></div>
            <div>{lab("Date de la première échéance")}<input data-testid="loan-first" type="date" className={inp} style={bd} value={form.firstDate} onChange={(e) => setForm({ ...form, firstDate: e.target.value })} /></div>
            <div className="sm:col-span-2">{lab("Mode de remboursement")}<select data-testid="loan-method" className={inp} style={bd} value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>{Object.entries(LOAN_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div>{lab("Différé (échéances d'intérêts seuls)")}<input data-testid="loan-grace" type="number" min="0" className={inp + " text-right tabular"} style={bd} value={form.grace} onChange={(e) => setForm({ ...form, grace: e.target.value })} /></div>
            <div>{lab("Assurance emprunteur par échéance")}<input data-testid="loan-insurance" type="number" min="0" className={inp + " text-right tabular"} style={bd} value={form.insurance} onChange={(e) => setForm({ ...form, insurance: e.target.value })} placeholder="0" /></div>
            <div>{lab("Frais de dossier (retenus au déblocage)")}<input data-testid="loan-fees" type="number" min="0" className={inp + " text-right tabular"} style={bd} value={form.fees} onChange={(e) => setForm({ ...form, fees: e.target.value })} placeholder="0" /></div>
            <div>{lab("Compte qui reçoit les fonds")}{treasurySelect(form.account, (v) => setForm({ ...form, account: v }), "loan-account", form.currency !== "HTG")}</div>
            {form.currency !== "HTG" && (
              <div>{lab(form.alreadyRunning ? "Taux auquel la dette est déjà inscrite" : "Taux de change du déblocage")}<input data-testid="loan-bookrate" type="number" min="0" step="any" className={inp + " text-right tabular"} style={bd} value={form.bookRate} onChange={(e) => setForm({ ...form, bookRate: e.target.value })} placeholder={fxRateOn(rates, form.currency, form.startDate) ? String(fxRateOn(rates, form.currency, form.startDate)) : "Ex : 131,50"} /></div>
            )}
          </div>
          {form.currency !== "HTG" && form.principal !== "" && (
            <div className="text-xs mt-2" style={{ color: "#7A7460" }} data-testid="loan-fx-hint">
              Valeur comptable à l'enregistrement : {fmt(loanRound(Number(form.principal || 0) * ((form.bookRate !== "" ? Number(form.bookRate) : fxRateOn(rates, form.currency, form.startDate)) || 0)))}. Le tableau et les paiements restent en dollars ; chaque paiement donne un écart de change réalisé.
            </div>
          )}
          <label className="flex items-center gap-2 mt-3 text-xs cursor-pointer" style={{ color: "#7A7460" }}>
            <input type="checkbox" data-testid="loan-running" checked={form.alreadyRunning} onChange={(e) => setForm({ ...form, alreadyRunning: e.target.checked })} />
            Emprunt déjà en cours : les fonds sont déjà reçus et déjà comptabilisés (indiquez le capital restant dû comme montant, et la prochaine échéance)
          </label>
          <div className="flex flex-wrap gap-2 mt-4">
            <button data-testid="loan-compute" onClick={compute} className="px-4 py-2 rounded text-sm" style={{ border: "1px solid #DDD6C4", color: "#152238" }}>Calculer le tableau</button>
            <button data-testid="loan-save" onClick={saveLoan} className="px-4 py-2 rounded text-sm text-white" style={{ background: "#152238" }}>Enregistrer l'emprunt</button>
          </div>
          {preview && (
            <div className="mt-4 overflow-x-auto" data-testid="loan-preview">
              {form.currency !== "HTG" && <div className="text-xs mb-1" style={{ color: "#7A7460" }}>Montants en dollars (USD).</div>}
              <table className="w-full text-xs"><thead><tr style={{ background: "#F3EFE3" }}>
                {["N°", "Échéance", "Capital", "Intérêts", "Assurance", "Total"].map((h) => <th key={h} className="py-1.5 px-2 text-left font-medium" style={{ color: "#152238" }}>{h}</th>)}
              </tr></thead><tbody>
                {preview.map((r) => (<tr key={r.n}><td className="py-1 px-2">{r.n}</td><td className="py-1 px-2">{r.date}</td><td className="py-1 px-2 tabular">{pm$(r.capital)}</td><td className="py-1 px-2 tabular">{pm$(r.interest)}</td><td className="py-1 px-2 tabular">{pm$(r.insurance)}</td><td className="py-1 px-2 tabular font-medium">{pm$(r.total)}</td></tr>))}
                <tr style={{ borderTop: "1px solid #DDD6C4" }}><td colSpan={2} className="py-1 px-2 font-medium">Total</td><td className="py-1 px-2 tabular font-medium">{pm$(preview.reduce((s, r) => s + r.capital, 0))}</td><td className="py-1 px-2 tabular font-medium">{pm$(preview.reduce((s, r) => s + r.interest, 0))}</td><td className="py-1 px-2 tabular font-medium">{pm$(preview.reduce((s, r) => s + r.insurance, 0))}</td><td className="py-1 px-2 tabular font-medium">{pm$(preview.reduce((s, r) => s + r.total, 0))}</td></tr>
              </tbody></table>
            </div>
          )}
        </div>
      )}

      {(loans || []).length === 0 && (
        <div className="bg-white rounded-lg p-6 text-sm" style={{ border: "1px solid #E4DFD1", color: "#A39C87" }}>Aucun emprunt enregistré pour le moment.</div>
      )}

      {(loans || []).map((loan) => {
        const s = loanSummary(loan, today);
        const isOpen = open === loan.id;
        const nInst = (loan.rows || []).filter((r) => r.type !== "anticipe").length;
        const firstUnpaid = (loan.rows || []).find((r) => r.status === "prevue");
        return (
          <div key={loan.id} className="bg-white rounded-lg p-5" style={{ border: "1px solid #E4DFD1" }} data-testid="loan-card">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold" style={{ color: "#152238" }}>{loan.name}{loanIsFx(loan) && <span className="text-xs px-2 py-0.5 rounded ml-1" style={{ background: "#E8F0F8", color: "#1F5A8C" }} data-testid="loan-fx-badge">{loan.currency}</span>} <span className="text-xs px-2 py-0.5 rounded ml-1" style={{ background: loan.status === "solde" ? "#E6F1EE" : "#EDEAF7", color: loan.status === "solde" ? "#0F6B5C" : "#5B3FA0" }}>{loan.status === "solde" ? "Soldé" : "En cours"}</span></div>
                <div className="text-xs mt-0.5" style={{ color: "#8A8370" }}>{LOAN_KINDS[loan.kind]?.label}{loan.lender ? " · " + loan.lender : ""} · {money(loan, loan.principal)} à {loan.annualRate} % · {nInst} échéance{nInst > 1 ? "s" : ""} {LOAN_FREQ[Object.keys(LOAN_FREQ).find((k) => LOAN_FREQ[k].months === loan.periodMonths)]?.label.toLowerCase()}s · compte {loan.account}</div>
              </div>
              <div className="text-right text-xs" style={{ color: "#7A7460" }}>
                <div>Capital restant dû : <b className="tabular" data-testid="loan-remaining">{money(loan, s.remaining)}</b></div>
                <div>Dont à moins d'un an : <span className="tabular">{money(loan, s.dueWithinYear)}</span></div>
                {loanIsFx(loan) && <div data-testid="loan-book">Valeur comptable : <b className="tabular" data-testid="loan-book-value">{fmt(s.remainingBook)}</b></div>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <button data-testid="loan-toggle" onClick={() => setOpen(isOpen ? null : loan.id)} className="px-3 py-1.5 rounded text-xs" style={{ border: "1px solid #DDD6C4", color: "#152238" }}>{isOpen ? "Masquer le tableau" : "Voir le tableau"}</button>
              <button onClick={() => loanDownload(loan)} className="px-3 py-1.5 rounded text-xs" style={{ border: "1px solid #DDD6C4", color: "#152238" }}>Exporter (Excel/CSV)</button>
              {canEdit && loan.status !== "solde" && <button data-testid="loan-accrual-btn" onClick={() => startAccrual(loan)} className="px-3 py-1.5 rounded text-xs" style={{ border: "1px solid #DDD6C4", color: "#152238" }}>Intérêts courus…</button>}
              {canEdit && loan.status !== "solde" && firstUnpaid && <button data-testid="loan-early-btn" onClick={() => startEarly(loan)} className="px-3 py-1.5 rounded text-xs" style={{ border: "1px solid #DDD6C4", color: "#152238" }}>Remboursement anticipé…</button>}
              {isAdmin && <button data-testid="loan-remove" onClick={() => removeLoan(loan)} className="px-3 py-1.5 rounded text-xs" style={{ color: "#A6432F" }}>Supprimer</button>}
            </div>

            {loanIsFx(loan) && loan.status !== "solde" && s.remaining > 0 && (() => {
              const lr = latentRates[loan.id] !== undefined && latentRates[loan.id] !== "" ? Number(latentRates[loan.id]) : fxRateOn(rates, loan.currency, today);
              const value = lr > 0 ? loanRound(s.remaining * lr) : null;
              const latent = value === null ? null : loanRound(s.remainingBook - value);
              return (
                <div className="mt-3 rounded p-3 text-xs flex flex-wrap items-end gap-3" style={{ background: "#F2F6FA" }} data-testid="loan-latent">
                  <div>{lab("Taux d'estimation (aujourd'hui)")}<input type="number" min="0" step="any" data-testid="loan-latent-rate" className={inp + " text-right tabular"} style={{ ...bd, width: 130 }} value={latentRates[loan.id] !== undefined ? latentRates[loan.id] : ""} placeholder={fxRateOn(rates, loan.currency, today) ? String(fxRateOn(rates, loan.currency, today)) : "Taux"} onChange={(e) => setLatentRates({ ...latentRates, [loan.id]: e.target.value })} /></div>
                  <div style={{ color: "#152238" }}>
                    {value === null ? "Saisissez un taux pour estimer l'écart de change latent." : <>Dette estimée à ce taux : <b className="tabular" data-testid="loan-latent-value">{fmt(value)}</b> · écart latent estimé : <b className="tabular" data-testid="loan-latent-diff" style={{ color: latent >= 0 ? "#0F6B5C" : "#A6432F" }}>{latent >= 0 ? "gain " : "perte "}{fmt(Math.abs(latent))}</b></>}
                    <div style={{ color: "#8A8370" }}>Estimation indicative : cet écart n'est pas comptabilisé. Seuls les écarts réalisés aux paiements sont inscrits (666 / 766).</div>
                  </div>
                </div>
              );
            })()}

            {accr && accr.loanId === loan.id && (
              <div className="mt-3 rounded p-3 text-xs" style={{ background: "#F7F4EA" }} data-testid="loan-accrual-form">
                <div className="mb-2" style={{ color: "#7A7460" }}>À la clôture, constatez les intérêts courus mais non échus : une écriture au 6611 / 1688 à la date choisie, extournée automatiquement le lendemain.</div>
                <div className="flex flex-wrap items-end gap-3">
                  <div>{lab("Date de clôture")}<input type="date" data-testid="accr-date" className={inp} style={bd} value={accr.date} onChange={(e) => setAccr({ ...accr, date: e.target.value })} /></div>
                  {loanIsFx(loan) && <div>{lab("Taux de change à la clôture")}<input type="number" min="0" step="any" data-testid="accr-rate" className={inp + " text-right tabular"} style={{ ...bd, width: 120 }} value={accr.rate} placeholder={loanValidDate(accr.date) && fxRateOn(rates, loan.currency, accr.date) ? String(fxRateOn(rates, loan.currency, accr.date)) : "Taux"} onChange={(e) => setAccr({ ...accr, rate: e.target.value })} /></div>}
                  <div className="pb-1.5" style={{ color: "#152238" }}>Intérêts courus : <b className="tabular" data-testid="accr-amount">{loanValidDate(accr.date) ? money(loan, loanAccrued(loan, accr.date)) : "—"}</b>{loanIsFx(loan) && loanValidDate(accr.date) && accrRateOf(loan, accr) > 0 ? " soit " + fmt(loanRound(loanAccrued(loan, accr.date) * accrRateOf(loan, accr))) : ""}</div>
                  <button data-testid="accr-save" onClick={() => doAccrual(loan)} className="px-3 py-1.5 rounded text-xs text-white" style={{ background: "#152238" }}>Constater</button>
                  <button onClick={() => setAccr(null)} className="px-3 py-1.5 rounded text-xs" style={{ color: "#7A7460" }}>Annuler</button>
                </div>
              </div>
            )}

            {early && early.loanId === loan.id && (
              <div className="mt-3 rounded p-3 text-xs" style={{ background: "#F7F4EA" }} data-testid="loan-early-form">
                <div className="mb-2" style={{ color: "#7A7460" }}>Capital restant dû : {money(loan, s.remaining)}. Les intérêts courus depuis la dernière échéance sont proposés ; corrigez-les selon le décompte de la banque. Le remboursement se fait avant la prochaine échéance ({firstUnpaid ? firstUnpaid.date : "—"}).</div>
                <label className="flex items-center gap-2 mb-2 cursor-pointer"><input type="checkbox" data-testid="early-total" checked={early.total} onChange={(e) => setEarly({ ...early, total: e.target.checked })} /> Remboursement total (solde l'emprunt)</label>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <div>{lab("Date")}<input type="date" data-testid="early-date" className={inp} style={bd} value={early.date} onChange={(e) => setEarly({ ...early, date: e.target.value })} /></div>
                  <div>{lab("Capital remboursé")}<input type="number" min="0" data-testid="early-capital" className={inp + " text-right tabular"} style={bd} disabled={early.total} value={early.total ? s.remaining : early.capital} onChange={(e) => setEarly({ ...early, capital: e.target.value })} /></div>
                  <div>{lab("Intérêts payés")}<input type="number" min="0" data-testid="early-interest" className={inp + " text-right tabular"} style={bd} value={early.interest === "" ? earlyDefaults(loan, early) : early.interest} onChange={(e) => setEarly({ ...early, interest: e.target.value })} /></div>
                  <div>{lab("Pénalité")}<input type="number" min="0" data-testid="early-penalty" className={inp + " text-right tabular"} style={bd} value={early.penalty} onChange={(e) => setEarly({ ...early, penalty: e.target.value })} placeholder="0" /></div>
                  <div>{lab("Payé depuis")}{treasurySelect(early.account, (v) => setEarly({ ...early, account: v }), "early-account", loanIsFx(loan))}</div>
                  {loanIsFx(loan) && early.account !== FX_USD_ACCOUNT.code && <div>{lab("Taux de change du paiement")}<input type="number" min="0" step="any" data-testid="early-rate" className={inp + " text-right tabular"} style={bd} value={early.rate} placeholder={loanValidDate(early.date) && fxRateOn(rates, loan.currency, early.date) ? String(fxRateOn(rates, loan.currency, early.date)) : "Taux"} onChange={(e) => setEarly({ ...early, rate: e.target.value })} /></div>}
                </div>
                {loanIsFx(loan) && (() => {
                  const cap = early.total ? s.remaining : loanRound(early.capital);
                  if (!(cap > 0) || cap > s.remaining + 0.001 || !loanValidDate(early.date)) return null;
                  const it = early.interest === "" ? earlyDefaults(loan, early) : loanRound(early.interest);
                  const r = fxPlanFor(loan, { capital: cap, interest: it, penalty: loanRound(early.penalty || 0) }, early.account, early.date, early.rate);
                  return <div className="mt-2" style={{ color: "#152238" }} data-testid="early-fx-preview">{r.error ? r.error : <>Décaissement : <b className="tabular">{fmt(r.plan.cash)}</b> · valeur comptable du capital remboursé : <b className="tabular">{fmt(r.plan.carry)}</b> · {diffText(r.plan.diff)}.</>}</div>;
                })()}
                <div className="flex gap-2 mt-3">
                  <button data-testid="early-save" onClick={() => doEarly(loan)} className="px-3 py-1.5 rounded text-xs text-white" style={{ background: "#152238" }}>Enregistrer le remboursement</button>
                  <button onClick={() => setEarly(null)} className="px-3 py-1.5 rounded text-xs" style={{ color: "#7A7460" }}>Annuler</button>
                </div>
              </div>
            )}

            {isOpen && (
              <div className="mt-4 overflow-x-auto" data-testid="loan-table">
                <table className="w-full text-xs"><thead><tr style={{ background: "#F3EFE3" }}>
                  {["N°", "Échéance", "Capital", "Intérêts", "Assurance", "Total", "Statut", ""].map((h, i) => <th key={i} className="py-1.5 px-2 text-left font-medium" style={{ color: "#152238" }}>{h}</th>)}
                </tr></thead><tbody>
                  {loan.rows.map((r, idx) => {
                    const late = r.status === "prevue" && r.date < today;
                    const editing = edit && edit.loanId === loan.id && edit.n === r.n && r.status === "prevue" && r.type !== "anticipe";
                    const paying = pay && pay.loanId === loan.id && pay.n === r.n && r.type !== "anticipe";
                    return (
                      <React.Fragment key={idx}>
                        <tr data-testid="loan-row" style={{ borderTop: "1px solid #F3EFE3", background: late ? "#FBEFEA" : undefined }}>
                          <td className="py-1.5 px-2">{r.type === "anticipe" ? "Anticipé" : r.n}</td>
                          <td className="py-1.5 px-2">{r.date}</td>
                          <td className="py-1.5 px-2 tabular">{money(loan, r.capital)}</td>
                          <td className="py-1.5 px-2 tabular">{money(loan, r.interest)}{r.penalty > 0 ? " + pén. " + money(loan, r.penalty) : ""}</td>
                          <td className="py-1.5 px-2 tabular">{money(loan, r.insurance || 0)}</td>
                          <td className="py-1.5 px-2 tabular font-medium">{money(loan, r.total)}</td>
                          <td className="py-1.5 px-2" style={{ color: r.status === "payee" ? "#0F6B5C" : late ? "#A6432F" : "#7A7460" }}>{r.status === "payee" ? "Payée" + (r.paidDate ? " le " + r.paidDate : "") : late ? "En retard" : "À payer"}{r.edited ? " ✎" : ""}{r.status === "payee" && typeof r.fxDiff === "number" && r.fxDiff !== 0 ? " · " + (r.fxDiff > 0 ? "perte" : "gain") + " de change " + fmt(Math.abs(r.fxDiff)) : ""}</td>
                          <td className="py-1.5 px-2 text-right whitespace-nowrap">
                            {canEdit && r.status === "prevue" && r === firstUnpaid && <button data-testid="loan-pay" onClick={() => startPay(loan, r)} className="underline mr-2" style={{ color: "#152238" }}>Payer</button>}
                            {canEdit && r.status === "prevue" && <button data-testid="loan-edit" onClick={() => setEdit({ loanId: loan.id, n: r.n, date: r.date, capital: String(r.capital), interest: String(r.interest), insurance: String(r.insurance || 0) })} className="underline" style={{ color: "#7A7460" }}>Corriger</button>}
                            {isAdmin && r.status === "payee" && r.type !== "anticipe" && <button data-testid="loan-cancel" onClick={() => cancelPay(loan, r)} className="underline" style={{ color: "#A6432F" }}>Annuler</button>}
                          </td>
                        </tr>
                        {paying && (
                          <tr><td colSpan={8} className="py-2 px-2" style={{ background: "#F7F4EA" }} data-testid="loan-pay-form">
                            <div className="flex flex-wrap items-end gap-3">
                              <div>{lab("Date du paiement")}<input type="date" data-testid="pay-date" className={inp} style={bd} value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></div>
                              <div>{lab("Payé depuis")}{treasurySelect(pay.account, (v) => setPay({ ...pay, account: v }), "pay-account", loanIsFx(loan))}</div>
                              {loanIsFx(loan) && pay.account !== FX_USD_ACCOUNT.code && <div>{lab("Taux de change du paiement")}<input type="number" min="0" step="any" data-testid="pay-rate" className={inp + " text-right tabular"} style={{ ...bd, width: 130 }} value={pay.rate} placeholder={loanValidDate(pay.date) && fxRateOn(rates, loan.currency, pay.date) ? String(fxRateOn(rates, loan.currency, pay.date)) : "Taux"} onChange={(e) => setPay({ ...pay, rate: e.target.value })} /></div>}
                              <button data-testid="pay-save" onClick={() => doPay(loan)} className="px-3 py-1.5 rounded text-xs text-white" style={{ background: "#152238" }}>Enregistrer le paiement de {money(loan, r.total)}</button>
                              <button onClick={() => setPay(null)} className="px-3 py-1.5 rounded text-xs" style={{ color: "#7A7460" }}>Annuler</button>
                            </div>
                            {loanIsFx(loan) && loanValidDate(pay.date) && (() => {
                              const q = fxPlanFor(loan, { capital: r.capital, interest: r.interest, insurance: r.insurance || 0 }, pay.account, pay.date, pay.rate);
                              return <div className="mt-2 text-xs" style={{ color: "#152238" }} data-testid="pay-fx-preview">{q.error ? q.error : <>Décaissement : <b className="tabular">{fmt(q.plan.cash)}</b> · valeur comptable du capital : <b className="tabular">{fmt(q.plan.carry)}</b> · {diffText(q.plan.diff)}.</>}</div>;
                            })()}
                          </td></tr>
                        )}
                        {editing && (
                          <tr><td colSpan={8} className="py-2 px-2" style={{ background: "#F7F4EA" }} data-testid="loan-edit-form">
                            <div className="flex flex-wrap items-end gap-3">
                              <div>{lab("Date")}<input type="date" data-testid="edit-date" className={inp} style={bd} value={edit.date} onChange={(e) => setEdit({ ...edit, date: e.target.value })} /></div>
                              <div>{lab("Capital")}<input type="number" data-testid="edit-capital" className={inp + " text-right tabular"} style={bd} value={edit.capital} onChange={(e) => setEdit({ ...edit, capital: e.target.value })} /></div>
                              <div>{lab("Intérêts")}<input type="number" data-testid="edit-interest" className={inp + " text-right tabular"} style={bd} value={edit.interest} onChange={(e) => setEdit({ ...edit, interest: e.target.value })} /></div>
                              <div>{lab("Assurance")}<input type="number" data-testid="edit-insurance" className={inp + " text-right tabular"} style={bd} value={edit.insurance} onChange={(e) => setEdit({ ...edit, insurance: e.target.value })} /></div>
                              <button data-testid="edit-save" onClick={() => saveEdit(loan)} className="px-3 py-1.5 rounded text-xs text-white" style={{ background: "#152238" }}>Enregistrer la correction</button>
                              <button onClick={() => setEdit(null)} className="px-3 py-1.5 rounded text-xs" style={{ color: "#7A7460" }}>Annuler</button>
                            </div>
                          </td></tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody></table>
                {(loan.accruals || []).length > 0 && (
                  <div className="text-xs mt-3" style={{ color: "#7A7460" }}>
                    Intérêts courus constatés : {(loan.accruals || []).map((a) => a.asOf + " (" + fmt(a.amount) + ")").join(" · ")}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
