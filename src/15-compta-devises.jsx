// ── Chantier E : opérations en devise et écarts de change ───────────────────
// Principe : une créance client ou une dette fournisseur en devise est enregistrée
// dans la devise de tenue de compte (settings.currency) au taux du jour, avec les
// données d'origine conservées dans la métadonnée `fx` de l'écriture. Chaque règlement
// est converti au taux du jour du règlement ; la différence avec la valeur comptable
// de la part réglée est constatée en écart de change RÉALISÉ (766 gain / 666 perte).
// L'écart latent (créances et dettes encore ouvertes) est ESTIMÉ à un taux choisi mais
// n'est PAS comptabilisé : sa comptabilisation dépend d'une règle à valider par l'expert.
const FX_GAIN_ACCOUNT = { code: "766", name: "Gains de change", type: "Produit" };
const FX_LOSS_ACCOUNT = { code: "666", name: "Pertes de change", type: "Charge" };
const fxR2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
function fxRateOn(rates, currency, date) {
  let best = null;
  (rates || []).forEach((r) => {
    if (r.currency === currency && r.date <= date && Number(r.rate) > 0 && (!best || r.date > best.date || (r.date === best.date && String(r.id) > String(best.id)))) best = r;
  });
  return best ? Number(best.rate) : null;
}
const fxIsActive = (e) => !e.cancelledBy && !e.reversalOf;
// Reconstitue les créances/dettes en devise à partir du journal (écritures annulées ignorées).
function fxDocs(entries) {
  const docs = new Map();
  const list = (entries || []).filter((e) => e.fx && fxIsActive(e)).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.createdAt || "").localeCompare(String(b.createdAt || ""))));
  list.forEach((e) => {
    const f = e.fx;
    if (f.type === "open") {
      docs.set(f.docId, { docId: f.docId, kind: f.kind, currency: f.currency, party: f.party || "", ref: f.ref || "", date: e.date, amount: f.amount, baseAmount: fxR2(f.amount * f.rate), rate: f.rate, settledForeign: 0, settledBase: 0, settlements: [] });
    } else if (f.type === "settle") {
      const d = docs.get(f.docId);
      if (!d) return;
      d.settledForeign = fxR2(d.settledForeign + f.amount);
      d.settledBase = fxR2(d.settledBase + f.carry);
      d.settlements.push({ date: e.date, amount: f.amount, rate: f.rate, carry: f.carry, diff: f.diff });
    }
  });
  docs.forEach((d) => {
    d.remainingForeign = fxR2(d.amount - d.settledForeign);
    d.remainingBase = fxR2(d.baseAmount - d.settledBase);
  });
  return [...docs.values()];
}
// Calcul d'un règlement : valeur comptable de la part réglée, encaissement/paiement réel
// et écart de change (gain > 0, perte < 0). Le dernier règlement solde exactement la
// valeur comptable restante (pas de résidu d'arrondi).
function fxSettlePlan(doc, foreignAmount, rate) {
  const full = foreignAmount >= doc.remainingForeign - 0.005;
  const carry = full ? doc.remainingBase : fxR2(doc.remainingBase * foreignAmount / doc.remainingForeign);
  const cash = fxR2(foreignAmount * rate);
  const diff = doc.kind === "creance" ? fxR2(cash - carry) : fxR2(carry - cash);
  return { carry, cash, diff, full };
}
function fxBuildOpenEntry({ kind, currency, amount, rate, party, ref, date, counterAccount, label }) {
  const base = fxR2(amount * rate);
  const id = uid();
  const lines = kind === "creance"
    ? [{ account: "411", debit: base, credit: 0 }, { account: counterAccount, debit: 0, credit: base }]
    : [{ account: counterAccount, debit: base, credit: 0 }, { account: "401", debit: 0, credit: base }];
  return { id, date, createdAt: new Date().toISOString(), label, lines, fx: { type: "open", docId: id, kind, currency, amount, rate, party, ref } };
}
function fxBuildSettleEntry(doc, foreignAmount, rate, date, cashAccount, label) {
  const { carry, cash, diff } = fxSettlePlan(doc, foreignAmount, rate);
  const lines = [];
  if (doc.kind === "creance") {
    lines.push({ account: cashAccount, debit: cash, credit: 0 });
    if (diff < 0) lines.push({ account: FX_LOSS_ACCOUNT.code, debit: -diff, credit: 0 });
    lines.push({ account: "411", debit: 0, credit: carry });
    if (diff > 0) lines.push({ account: FX_GAIN_ACCOUNT.code, debit: 0, credit: diff });
  } else {
    lines.push({ account: "401", debit: carry, credit: 0 });
    if (diff < 0) lines.push({ account: FX_LOSS_ACCOUNT.code, debit: -diff, credit: 0 });
    lines.push({ account: cashAccount, debit: 0, credit: cash });
    if (diff > 0) lines.push({ account: FX_GAIN_ACCOUNT.code, debit: 0, credit: diff });
  }
  return { id: uid(), date, createdAt: new Date().toISOString(), label, lines, fx: { type: "settle", docId: doc.docId, kind: doc.kind, currency: doc.currency, amount: foreignAmount, rate, carry, diff, party: doc.party } };
}
// K:FXC:START
// Compte en dollars (USD) : achat / vente de devises à la banque, valorisé en gourdes au coût réel
// (coût moyen pondéré). Les montants de coût sont figés dans chaque écriture (`fxc`), donc une
// annulation d'une opération ancienne ne réécrit pas les écritures suivantes.
const FX_USD_ACCOUNT = { code: "5121", name: "Banque — compte en dollars (USD)", type: "Actif" };
const FX_BANKFEE_ACCOUNT = { code: "627", name: "Frais bancaires", type: "Charge" };
function fxcPosition(entries) {
  let usd = 0, cost = 0;
  (entries || []).forEach((e) => {
    if (!e.fxc || e.cancelledBy || e.reversalOf) return;
    const f = e.fxc;
    if (f.type === "buy") { usd = fxR2(usd + f.usd); cost = fxR2(cost + f.cost); }
    else if (f.type === "sell" || f.type === "spend") { usd = fxR2(usd - f.usd); cost = fxR2(cost - f.costOut); }
  });
  return { usd, cost, avg: usd > 0.004 ? cost / usd : 0 };
}
function fxcCostOut(pos, usd) { return usd >= pos.usd - 0.005 ? pos.cost : fxR2(pos.cost * usd / pos.usd); }
function fxcBuildBuy({ usd, rate, commission, source, date, label, mkId, nowIso }) {
  const cost = fxR2(usd * rate), fee = fxR2(commission || 0);
  const lines = [{ account: FX_USD_ACCOUNT.code, debit: cost, credit: 0 }];
  if (fee > 0) lines.push({ account: FX_BANKFEE_ACCOUNT.code, debit: fee, credit: 0 });
  lines.push({ account: source, debit: 0, credit: fxR2(cost + fee) });
  return { id: mkId(), date, createdAt: nowIso, label, lines, fxc: { type: "buy", usd, rate, cost, commission: fee, source } };
}
function fxcBuildSell({ usd, rate, commission, target, date, label, pos, mkId, nowIso }) {
  const costOut = fxcCostOut(pos, usd), proceeds = fxR2(usd * rate), fee = fxR2(commission || 0), diff = fxR2(proceeds - costOut);
  const lines = [{ account: target, debit: fxR2(proceeds - fee), credit: 0 }];
  if (fee > 0) lines.push({ account: FX_BANKFEE_ACCOUNT.code, debit: fee, credit: 0 });
  if (diff < 0) lines.push({ account: FX_LOSS_ACCOUNT.code, debit: -diff, credit: 0 });
  lines.push({ account: FX_USD_ACCOUNT.code, debit: 0, credit: costOut });
  if (diff > 0) lines.push({ account: FX_GAIN_ACCOUNT.code, debit: 0, credit: diff });
  return { id: mkId(), date, createdAt: nowIso, label, lines, fxc: { type: "sell", usd, rate, costOut, proceeds, commission: fee, diff, target } };
}
// K:FXC:END
const fmtFx = (n, cur) => {
  try { return new Intl.NumberFormat("fr-FR", { style: "currency", currency: cur, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
  catch (e) { return `${fxR2(n || 0)} ${cur}`; }
};
const fmtRate = (r) => Number(r).toLocaleString("fr-FR", { maximumFractionDigits: 4 });
async function fetchFxRate(currency, base) {
  try {
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 6000) : null;
    const res = await fetch(`https://open.er-api.com/v6/latest/${currency}`, ctl ? { signal: ctl.signal } : undefined);
    if (timer) clearTimeout(timer);
    const data = await res.json();
    const rate = data && data.rates && data.rates[base];
    if (typeof rate === "number" && rate > 0) return rate;
  } catch (e) { /* hors ligne ou service indisponible : saisie manuelle */ }
  return null;
}

function DevisesPanel({ accounts, setAccounts, entries, setEntries, settings, setSettings, role, showToast, logAudit }) {
  const base = settings.currency || "HTG";
  const canEdit = role === "Administrateur" || role === "Éditeur";
  const foreignList = Object.keys(CURRENCIES).filter((c) => c !== base);
  const today = todayStr();
  const rates = settings.fxRates || [];
  const [rateForm, setRateForm] = useState({ date: today, currency: foreignList[0] || "USD", rate: "" });
  const [form, setForm] = useState({ kind: "creance", party: "", currency: foreignList[0] || "USD", amount: "", rate: "", date: today, counter: "", ref: "" });
  const [settleFor, setSettleFor] = useState(null);
  const [settleForm, setSettleForm] = useState({ amount: "", rate: "", date: today, cash: "512" });
  const [busy, setBusy] = useState(false);
  const [latentRates, setLatentRates] = useState({});
  const lastSubmitRef = React.useRef(0);

  const docs = useMemo(() => fxDocs(entries), [entries]);
  const open = docs.filter((d) => d.remainingForeign > 0.004);
  const closed = docs.filter((d) => d.remainingForeign <= 0.004);
  const realized = (entries || []).filter((e) => e.fx && e.fx.type === "settle" && fxIsActive(e)).reduce((t, e) => t + (Number(e.fx.diff) || 0), 0);

  const counterAccounts = accounts.filter((a) => a.type === (form.kind === "creance" ? "Produit" : "Charge") && !["766", "666", "7816", "7817", "7815"].includes(a.code));
  const counterDefault = form.counter || (form.kind === "creance" ? (counterAccounts.find((a) => a.code === "706") || counterAccounts[0] || {}).code : (counterAccounts.find((a) => a.code === "607") || counterAccounts[0] || {}).code) || "";
  const suggestedRate = fxRateOn(rates, form.currency, form.date);
  const formRate = form.rate !== "" ? Number(form.rate) : suggestedRate;
  const formAmount = Number(form.amount) || 0;
  const formBase = formRate && formAmount ? fxR2(formAmount * formRate) : 0;

  const ensureFxAccounts = () => {
    setAccounts((prev) => {
      let next = prev;
      [FX_GAIN_ACCOUNT, FX_LOSS_ACCOUNT].forEach((a) => { if (!next.some((x) => x.code === a.code)) next = [...next, a]; });
      return next;
    });
  };
  const ensureUsdAccounts = (withGainLoss) => {
    setAccounts((prev) => {
      let next = prev;
      [FX_USD_ACCOUNT, FX_BANKFEE_ACCOUNT, ...(withGainLoss ? [FX_GAIN_ACCOUNT, FX_LOSS_ACCOUNT] : [])].forEach((a) => { if (!next.some((x) => x.code === a.code)) next = [...next, a]; });
      return next;
    });
  };
  const guardDate = (date) => {
    if (!date) { showToast("La date est requise."); return false; }
    if (isFutureDate(date)) { showToast("Impossible d'enregistrer une opération à une date future."); return false; }
    if (isLocked(date, settings)) { showToast(`La période comptable est clôturée jusqu'au ${settings.lockDate} inclus.`); return false; }
    return true;
  };

  const addRate = () => {
    const v = Number(rateForm.rate);
    if (!(v > 0)) { showToast("Saisissez un taux supérieur à 0."); return; }
    if (!rateForm.date || isFutureDate(rateForm.date)) { showToast("La date du taux est invalide."); return; }
    const entry = { id: uid(), date: rateForm.date, currency: rateForm.currency, rate: v };
    setSettings({ ...settings, fxRates: [...rates, entry] });
    logAudit("Comptabilité", "Taux de change", `1 ${rateForm.currency} = ${fmtRate(v)} ${base} au ${rateForm.date}`);
    setRateForm({ ...rateForm, rate: "" });
    showToast("Taux enregistré.");
  };
  const removeRate = (id) => {
    if (!window.confirm("Supprimer ce taux ? Les opérations déjà enregistrées ne changent pas.")) return;
    setSettings({ ...settings, fxRates: rates.filter((r) => r.id !== id) });
  };
  const fetchRateOnline = async () => {
    setBusy(true);
    const v = await fetchFxRate(rateForm.currency, base);
    setBusy(false);
    if (!v) { showToast("Le taux en ligne n'est pas disponible pour le moment. Saisissez-le à la main."); return; }
    setRateForm((f) => ({ ...f, rate: String(Math.round(v * 10000) / 10000), date: todayStr() }));
    showToast("Taux du jour récupéré : vérifiez-le puis enregistrez-le.");
  };

  const saveDoc = () => {
    if (Date.now() - lastSubmitRef.current < 800) return;
    lastSubmitRef.current = Date.now();
    if (!canEdit) { showToast("Vous n'avez pas le droit d'enregistrer cette opération."); return; }
    if (!form.party.trim()) { showToast("Indiquez le client ou le fournisseur."); return; }
    if (!(formAmount > 0)) { showToast("Saisissez un montant en devise supérieur à 0."); return; }
    if (!(formRate > 0)) { showToast("Saisissez le taux de change (ou enregistrez d'abord un taux pour cette devise)."); return; }
    if (!counterDefault) { showToast("Choisissez le compte de produit ou de charge."); return; }
    if (!guardDate(form.date)) return;
    const label = `${form.kind === "creance" ? "Créance en devise" : "Dette en devise"} — ${form.party.trim()} — ${fmtFx(formAmount, form.currency)} × ${fmtRate(formRate)}${form.ref ? ` (${form.ref})` : ""}`;
    const entry = fxBuildOpenEntry({ kind: form.kind, currency: form.currency, amount: formAmount, rate: formRate, party: form.party.trim(), ref: form.ref.trim(), date: form.date, counterAccount: counterDefault, label });
    setEntries((prev) => [...prev, entry]);
    logAudit("Comptabilité", form.kind === "creance" ? "Créance en devise" : "Dette en devise", label);
    showToast(`Enregistré : ${fmt(formBase)} au taux de ${fmtRate(formRate)}.`);
    setForm({ ...form, party: "", amount: "", rate: "", ref: "" });
  };

  const settleDoc = docs.find((d) => d.docId === settleFor);
  const sAmount = Number(settleForm.amount) || 0;
  const usdPos = fxcPosition(entries);
  const sRateInput = settleForm.rate !== "" ? Number(settleForm.rate) : (settleDoc ? fxRateOn(rates, settleDoc.currency, settleForm.date) : null);
  // Paiement d'un fournisseur depuis le compte en dollars : les dollars sortent au coût moyen réel, pas au taux du jour.
  const usdSpend = !!settleDoc && settleForm.cash === FX_USD_ACCOUNT.code && settleDoc.kind === "dette";
  const sRate = usdSpend ? (usdPos.avg > 0 ? usdPos.avg : null) : sRateInput;
  const sPlan = settleDoc && sAmount > 0 && sRate > 0 ? fxSettlePlan(settleDoc, sAmount, sRate) : null;
  const startSettle = (d) => {
    setSettleFor(d.docId);
    setSettleForm({ amount: String(d.remainingForeign), rate: "", date: todayStr(), cash: "512" });
  };
  const confirmSettle = () => {
    if (Date.now() - lastSubmitRef.current < 800) return;
    lastSubmitRef.current = Date.now();
    if (!canEdit || !settleDoc) return;
    if (!(sAmount > 0) || sAmount > settleDoc.remainingForeign + 0.005) { showToast(`Le montant doit être compris entre 0 et ${fmtFx(settleDoc.remainingForeign, settleDoc.currency)}.`); return; }
    if (usdSpend && sAmount > usdPos.usd + 0.005) { showToast(`Solde insuffisant sur le compte en dollars : ${fmtFx(usdPos.usd, "USD")} disponibles. Achetez d'abord des dollars (cadre « Achat et vente de dollars »).`); return; }
    if (!(sRate > 0)) { showToast(usdSpend ? "Le compte en dollars est vide : achetez d'abord des dollars." : "Saisissez le taux de change du règlement."); return; }
    if (!guardDate(settleForm.date)) return;
    if (settleForm.date < settleDoc.date) { showToast("La date du règlement ne peut pas précéder celle de l'opération."); return; }
    const label = `Règlement ${settleDoc.kind === "creance" ? "client" : "fournisseur"} — ${settleDoc.party} — ${fmtFx(sAmount, settleDoc.currency)} × ${fmtRate(sRate)}`;
    const entry = fxBuildSettleEntry(settleDoc, sAmount, sRate, settleForm.date, settleForm.cash, label);
    if (settleForm.cash === FX_USD_ACCOUNT.code) {
      const cash = fxSettlePlan(settleDoc, sAmount, sRate).cash;
      entry.fxc = usdSpend ? { type: "spend", usd: sAmount, costOut: cash } : { type: "buy", usd: sAmount, rate: sRate, cost: cash, commission: 0, source: "411" };
      ensureUsdAccounts();
    }
    if (entry.fx.diff !== 0) ensureFxAccounts();
    setEntries((prev) => [...prev, entry]);
    logAudit("Comptabilité", "Règlement en devise", `${label} — écart de change ${fmt(entry.fx.diff)}`);
    showToast(entry.fx.diff === 0 ? "Règlement enregistré." : `Règlement enregistré — ${entry.fx.diff > 0 ? "gain" : "perte"} de change de ${fmt(Math.abs(entry.fx.diff))}.`);
    setSettleFor(null);
  };

  const latentRate = (d) => (latentRates[d.currency] !== undefined && latentRates[d.currency] !== "" ? Number(latentRates[d.currency]) : fxRateOn(rates, d.currency, today));
  const latentOf = (d) => {
    const r = latentRate(d);
    if (!(r > 0)) return null;
    const value = fxR2(d.remainingForeign * r);
    return { rate: r, value, latent: d.kind === "creance" ? fxR2(value - d.remainingBase) : fxR2(d.remainingBase - value) };
  };
  const latentTotal = open.reduce((t, d) => { const l = latentOf(d); return t + (l ? l.latent : 0); }, 0);
  const thStyle = { color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 };
  const inputCls = "w-full border rounded px-2 py-1.5 text-sm mt-1";
  const inputStyle = { borderColor: "#DDD6C4" };

  const [chg, setChg] = useState({ type: "buy", date: today, usd: "", rate: "", account: "512", commission: "", note: "" });
  const chgUsd = Number(chg.usd) || 0;
  const chgRate = chg.rate !== "" ? Number(chg.rate) : fxRateOn(rates, "USD", chg.date);
  const chgFee = Number(chg.commission) || 0;
  const chgPlan = (() => {
    if (!(chgUsd > 0) || !(chgRate > 0)) return null;
    if (chg.type === "buy") { const cost = fxR2(chgUsd * chgRate); return { cost, total: fxR2(cost + chgFee) }; }
    const costOut = usdPos.usd > 0 ? fxcCostOut(usdPos, Math.min(chgUsd, usdPos.usd)) : 0, proceeds = fxR2(chgUsd * chgRate);
    return { costOut, proceeds, net: fxR2(proceeds - chgFee), diff: fxR2(proceeds - costOut) };
  })();
  const changes = (entries || []).filter((e) => e.fxc && (e.fxc.type === "buy" || e.fxc.type === "sell") && fxIsActive(e)).slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 8);
  const saveChange = () => {
    if (Date.now() - lastSubmitRef.current < 800) return;
    lastSubmitRef.current = Date.now();
    if (!canEdit) { showToast("Droits insuffisants."); return; }
    if (base === "USD") { showToast("Votre devise de tenue de compte est déjà le dollar."); return; }
    if (!(chgUsd > 0)) { showToast("Saisissez le montant en dollars (supérieur à 0)."); return; }
    if (!(chgRate > 0)) { showToast("Saisissez le taux (gourdes pour 1 dollar) ou enregistrez d'abord un taux USD."); return; }
    if (chgFee < 0) { showToast("La commission ne peut pas être négative."); return; }
    if (!guardDate(chg.date)) return;
    if (chg.type === "sell" && chgUsd > usdPos.usd + 0.005) { showToast(`Vous ne pouvez pas vendre plus que le solde du compte en dollars (${fmtFx(usdPos.usd, "USD")}).`); return; }
    const mk = uid, nowIso = new Date().toISOString();
    const note = chg.note.trim();
    const entry = chg.type === "buy"
      ? fxcBuildBuy({ usd: chgUsd, rate: chgRate, commission: chgFee, source: chg.account, date: chg.date, label: `Achat de ${fmtFx(chgUsd, "USD")} au taux ${fmtRate(chgRate)}${note ? " — " + note : ""}`, mkId: mk, nowIso })
      : fxcBuildSell({ usd: chgUsd, rate: chgRate, commission: chgFee, target: chg.account, date: chg.date, label: `Vente de ${fmtFx(chgUsd, "USD")} au taux ${fmtRate(chgRate)}${note ? " — " + note : ""}`, pos: usdPos, mkId: mk, nowIso });
    ensureUsdAccounts(chg.type === "sell");
    setEntries((prev) => [...prev, entry]);
    logAudit("Comptabilité", chg.type === "buy" ? "Achat de devises" : "Vente de devises", `${fmtFx(chgUsd, "USD")} × ${fmtRate(chgRate)}`);
    showToast(chg.type === "buy" ? "Achat de dollars enregistré." : "Vente de dollars enregistrée.");
    setChg({ ...chg, usd: "", rate: "", commission: "", note: "" });
  };

  return (
    <div className="space-y-6" data-testid="fx-panel">
      <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }} data-testid="fxc-card">
        <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Achat et vente de dollars (USD)</div>
        <p className="text-xs mb-3" style={{ color: "#8A8370" }}>Achetez des dollars à votre banque ou à un bureau de change pour payer vos fournisseurs. Les dollars sont tenus dans un compte en dollars (5121), valorisé en {base} au coût réel payé (coût moyen). Quand vous payez un fournisseur depuis ce compte, l'écart de change est calculé contre ce coût, pas contre un taux théorique. Vos factures de vente restent en {base}, au taux que vous fixez.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4" data-testid="fxc-position">
          <div className="rounded p-3" style={{ background: "#F7F4EA" }}><div className="text-xs" style={{ color: "#8A8370" }}>Solde du compte en dollars</div><div className="text-base font-semibold tabular" data-testid="fxc-usd">{fmtFx(usdPos.usd, "USD")}</div></div>
          <div className="rounded p-3" style={{ background: "#F7F4EA" }}><div className="text-xs" style={{ color: "#8A8370" }}>Valeur comptable ({base})</div><div className="text-base font-semibold tabular" data-testid="fxc-cost">{fmt(usdPos.cost)}</div></div>
          <div className="rounded p-3" style={{ background: "#F7F4EA" }}><div className="text-xs" style={{ color: "#8A8370" }}>Coût moyen (1 USD)</div><div className="text-base font-semibold tabular" data-testid="fxc-avg">{usdPos.avg > 0 ? fmtRate(usdPos.avg) : "—"}</div></div>
        </div>
        {canEdit && base !== "USD" && (
          <>
            <div className="flex flex-wrap gap-4 mb-3 text-sm">
              <label className="flex items-center gap-2"><input type="radio" name="fxctype" checked={chg.type === "buy"} onChange={() => setChg({ ...chg, type: "buy", account: "512" })} data-testid="fxc-type-buy" /> Achat de dollars</label>
              <label className="flex items-center gap-2"><input type="radio" name="fxctype" checked={chg.type === "sell"} onChange={() => setChg({ ...chg, type: "sell", account: "512" })} data-testid="fxc-type-sell" /> Vente de dollars</label>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Date</label><input type="date" max={today} value={chg.date} onChange={(e) => setChg({ ...chg, date: e.target.value })} className={inputCls} style={inputStyle} data-testid="fxc-date" /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Montant en dollars</label><input type="number" step="any" min="0" value={chg.usd} onChange={(e) => setChg({ ...chg, usd: e.target.value })} className={inputCls + " tabular"} style={inputStyle} data-testid="fxc-usd-input" /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Taux ({base} pour 1 USD)</label><input type="number" step="any" min="0" value={chg.rate} placeholder={chgRate ? String(chgRate) : ""} onChange={(e) => setChg({ ...chg, rate: e.target.value })} className={inputCls + " tabular"} style={inputStyle} data-testid="fxc-rate" /></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>{chg.type === "buy" ? "Payé depuis" : "Reçu sur"}</label><select value={chg.account} onChange={(e) => setChg({ ...chg, account: e.target.value })} className={inputCls} style={inputStyle} data-testid="fxc-account"><option value="512">512 — Banque</option><option value="530">530 — Caisse</option></select></div>
              <div><label className="text-xs" style={{ color: "#8A8370" }}>Commission / frais ({base})</label><input type="number" step="any" min="0" value={chg.commission} onChange={(e) => setChg({ ...chg, commission: e.target.value })} className={inputCls + " tabular"} style={inputStyle} data-testid="fxc-fee" /></div>
            </div>
            <div className="mt-3"><label className="text-xs" style={{ color: "#8A8370" }}>Précision (banque, objet — facultatif)</label><input value={chg.note} maxLength={80} onChange={(e) => setChg({ ...chg, note: e.target.value })} className={inputCls} style={inputStyle} data-testid="fxc-note" /></div>
            <div className="text-xs mt-3 p-2 rounded" style={{ background: "#FAF8F1", color: "#152238" }} data-testid="fxc-preview">
              {!chgPlan ? "Saisissez le montant en dollars et le taux pour voir l'écriture."
                : chg.type === "buy" ? `Dollars acquis : ${fmtFx(chgUsd, "USD")} valorisés ${fmt(chgPlan.cost)}${chgFee > 0 ? ` + frais ${fmt(chgFee)}` : ""} · sort de ${chg.account === "530" ? "la caisse" : "la banque"} : ${fmt(chgPlan.total)}`
                : usdPos.usd <= 0 ? "Le compte en dollars est vide : rien à vendre."
                  : `Vente : encaissé ${fmt(chgPlan.net)}${chgFee > 0 ? ` (après frais ${fmt(chgFee)})` : ""} · coût des dollars vendus ${fmt(chgPlan.costOut)} · ${chgPlan.diff === 0 ? "aucun écart de change" : chgPlan.diff > 0 ? `gain de change de ${fmt(chgPlan.diff)}` : `perte de change de ${fmt(-chgPlan.diff)}`}`}
            </div>
            <button onClick={saveChange} className="mt-3 px-4 py-2 rounded text-sm text-white" style={{ background: "#0F6B5C" }} data-testid="fxc-save">{chg.type === "buy" ? "Enregistrer l'achat de dollars" : "Enregistrer la vente de dollars"}</button>
          </>
        )}
        {changes.length > 0 && (
          <div className="mt-4 text-xs space-y-1" data-testid="fxc-list" style={{ color: "#152238" }}>
            <div className="font-semibold" style={{ color: "#8A8370" }}>Dernières opérations (pour annuler : Journal des écritures)</div>
            {changes.map((e) => <div key={e.id} data-testid="fxc-row">{e.date} — {e.label}</div>)}
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
        <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Opérations en devise</div>
        <p className="text-xs" style={{ color: "#8A8370" }}>
          Enregistrez une créance client ou une dette fournisseur dans une autre devise : elle est comptabilisée en {base} au taux du jour. À chaque règlement, l'écart de change réalisé est constaté automatiquement (compte 766 gain, 666 perte). Ces règles de change sont en cours de validation par un expert-comptable local.
        </p>
      </div>

      <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
        <div className="text-sm font-medium mb-3" style={{ color: "#152238" }}>Taux de change (1 unité de devise = ? {base})</div>
        {canEdit && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Date</label>
              <input type="date" value={rateForm.date} max={today} onChange={(e) => setRateForm({ ...rateForm, date: e.target.value })} className={inputCls} style={inputStyle} data-testid="fx-rate-date" />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Devise</label>
              <select value={rateForm.currency} onChange={(e) => setRateForm({ ...rateForm, currency: e.target.value })} className={inputCls} style={inputStyle} data-testid="fx-rate-currency">
                {foreignList.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Taux</label>
              <input type="number" step="any" min="0" value={rateForm.rate} onChange={(e) => setRateForm({ ...rateForm, rate: e.target.value })} className={inputCls + " tabular"} style={inputStyle} data-testid="fx-rate-value" />
            </div>
            <div className="flex items-end gap-2 flex-wrap">
              <button onClick={addRate} className="px-3 py-1.5 rounded text-xs text-white" style={{ background: "#152238" }} data-testid="fx-rate-add">Enregistrer</button>
              <button onClick={fetchRateOnline} disabled={busy} className="px-3 py-1.5 rounded text-xs" style={{ border: "1px solid #DDD6C4", color: "#152238" }} data-testid="fx-rate-fetch">{busy ? "…" : "Taux du jour (en ligne)"}</button>
            </div>
          </div>
        )}
        {rates.length === 0 ? (
          <div className="text-xs" style={{ color: "#A39C87" }}>Aucun taux enregistré.</div>
        ) : (
          <div className="overflow-x-auto"><table className="w-full text-xs" data-testid="fx-rates-table">
            <tbody>
              {[...rates].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 8).map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid #EEE9DA" }}>
                  <td className="py-1.5 pr-2 tabular">{r.date}</td>
                  <td className="py-1.5 pr-2">1 {r.currency}</td>
                  <td className="py-1.5 pr-2 tabular">= {fmtRate(r.rate)} {base}</td>
                  <td className="py-1.5 text-right">{canEdit && <button onClick={() => removeRate(r.id)} className="text-xs" style={{ color: "#A6432F" }}>Supprimer</button>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      {canEdit && (
        <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
          <div className="text-sm font-medium mb-3" style={{ color: "#152238" }}>Nouvelle créance ou dette en devise</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Type</label>
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value, counter: "" })} className={inputCls} style={inputStyle} data-testid="fx-kind">
                <option value="creance">Créance client (vente facturée en devise)</option>
                <option value="dette">Dette fournisseur (achat facturé en devise)</option>
              </select>
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>{form.kind === "creance" ? "Client" : "Fournisseur"}</label>
              <input value={form.party} onChange={(e) => setForm({ ...form, party: e.target.value })} className={inputCls} style={inputStyle} data-testid="fx-party" />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Devise</label>
              <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value, rate: "" })} className={inputCls} style={inputStyle} data-testid="fx-currency">
                {foreignList.map((c) => <option key={c} value={c}>{CURRENCIES[c].label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Montant en devise</label>
              <input type="number" step="any" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={inputCls + " tabular"} style={inputStyle} data-testid="fx-amount" />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Date</label>
              <input type="date" value={form.date} max={today} onChange={(e) => setForm({ ...form, date: e.target.value, rate: "" })} className={inputCls} style={inputStyle} data-testid="fx-date" />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Taux (1 {form.currency} = ? {base})</label>
              <input type="number" step="any" min="0" value={form.rate} placeholder={suggestedRate ? String(suggestedRate) : ""} onChange={(e) => setForm({ ...form, rate: e.target.value })} className={inputCls + " tabular"} style={inputStyle} data-testid="fx-rate-input" />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>{form.kind === "creance" ? "Compte de produit" : "Compte de charge"}</label>
              <select value={counterDefault} onChange={(e) => setForm({ ...form, counter: e.target.value })} className={inputCls} style={inputStyle} data-testid="fx-counter">
                {counterAccounts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Référence (facultatif)</label>
              <input value={form.ref} onChange={(e) => setForm({ ...form, ref: e.target.value })} className={inputCls} style={inputStyle} />
            </div>
          </div>
          <div className="text-xs mt-3" style={{ color: "#152238" }} data-testid="fx-preview">
            {formBase > 0 ? `Valeur comptable : ${fmt(formBase)} (${fmtFx(formAmount, form.currency)} × ${fmtRate(formRate)}).` : "Saisissez un montant et un taux pour voir la valeur comptable."}
          </div>
          <button onClick={saveDoc} className="mt-3 px-4 py-2 rounded text-sm text-white" style={{ background: "#152238" }} data-testid="fx-save">Enregistrer l'opération</button>
        </div>
      )}

      <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
        <div className="text-sm font-medium mb-3" style={{ color: "#152238" }}>Positions ouvertes en devise</div>
        {open.length === 0 ? (
          <div className="text-xs" style={{ color: "#A39C87" }} data-testid="fx-no-open">Aucune créance ni dette en devise en attente de règlement.</div>
        ) : (
          <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(21,34,56,0.08)" }}>
            <div className="overflow-x-auto"><table className="w-full text-sm" data-testid="fx-open-table">
              <thead>
                <tr style={{ background: "#C7CCDA" }}>
                  <th className="py-2 px-3 text-left font-medium" style={thStyle}>Tiers</th>
                  <th className="py-2 px-3 text-right font-medium" style={thStyle}>Reste (devise)</th>
                  <th className="py-2 px-3 text-right font-medium" style={thStyle}>Valeur comptable</th>
                  <th className="py-2 px-3 text-right font-medium" style={thStyle}>Écart latent estimé</th>
                  <th className="py-2 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {open.map((d) => {
                  const l = latentOf(d);
                  return (
                    <tr key={d.docId} data-testid="fx-open-row">
                      <td className="py-2 pl-3 pr-1" style={{ color: "#152238", borderLeft: `3px solid ${d.kind === "creance" ? "#378ADD" : "#7F77DD"}`, wordBreak: "break-word" }}>
                        {d.party}<span className="block text-xs" style={{ color: "#8A8370" }}>{d.kind === "creance" ? "Créance" : "Dette"} · {d.date}</span>
                      </td>
                      <td className="py-2 px-3 tabular text-right">{fmtFx(d.remainingForeign, d.currency)}</td>
                      <td className="py-2 px-3 tabular text-right">{fmt(d.remainingBase)}</td>
                      <td className="py-2 px-3 tabular text-right" style={{ color: !l ? "#A39C87" : l.latent >= 0 ? "#0F6B5C" : "#A6432F" }}>{l ? fmt(l.latent) : "taux manquant"}</td>
                      <td className="py-2 px-3 text-right">{canEdit && <button onClick={() => startSettle(d)} className="px-2 py-1 rounded text-xs text-white" style={{ background: "#0F6B5C" }} data-testid="fx-settle-btn">Régler</button>}</td>
                    </tr>
                  );
                })}
                <tr style={{ background: "#FAF8F1" }}>
                  <td className="py-2 pl-3 pr-1 font-semibold" colSpan={3} style={{ color: "#152238", borderLeft: "3px solid #152238" }}>Écart latent total estimé (non comptabilisé)</td>
                  <td className="py-2 px-3 tabular text-right font-semibold" style={{ color: latentTotal >= 0 ? "#0F6B5C" : "#A6432F" }} data-testid="fx-latent-total">{fmt(latentTotal)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table></div>
          </div>
        )}
        {open.length > 0 && [...new Set(open.map((d) => d.currency))].map((c) => (
          <div key={c} className="mt-3 flex items-center gap-2 flex-wrap text-xs" style={{ color: "#8A8370" }}>
            <span>Taux utilisé pour l'estimation {c} :</span>
            <input type="number" step="any" min="0" value={latentRates[c] !== undefined ? latentRates[c] : ""} placeholder={String(fxRateOn(rates, c, today) || "")}
              onChange={(e) => setLatentRates({ ...latentRates, [c]: e.target.value })} className="border rounded px-2 py-1 text-xs tabular" style={{ borderColor: "#DDD6C4", width: 110 }} data-testid={`fx-latent-rate-${c}`} />
            <span>{base} par {c}</span>
          </div>
        ))}
        <p className="text-xs mt-3" style={{ color: "#8A8370" }}>
          L'écart latent n'est pas inscrit dans les comptes : c'est une estimation à la date choisie. Sa comptabilisation en fin d'exercice dépend d'une règle à valider avec l'expert-comptable.
        </p>
        <div className="text-xs mt-2" style={{ color: "#152238" }} data-testid="fx-realized">Écarts de change réalisés (cumul) : <b style={{ color: realized >= 0 ? "#0F6B5C" : "#A6432F" }}>{fmt(realized)}</b>{closed.length > 0 ? ` — ${closed.length} opération(s) soldée(s)` : ""}</div>
      </div>

      {settleDoc && (
        <div className="bg-white rounded-lg p-6" style={{ border: "2px solid #0F6B5C" }} data-testid="fx-settle-form">
          <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Régler : {settleDoc.party}</div>
          <p className="text-xs mb-3" style={{ color: "#8A8370" }}>Reste à régler : {fmtFx(settleDoc.remainingForeign, settleDoc.currency)} (valeur comptable {fmt(settleDoc.remainingBase)}).</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Montant réglé ({settleDoc.currency})</label>
              <input type="number" step="any" min="0" value={settleForm.amount} onChange={(e) => setSettleForm({ ...settleForm, amount: e.target.value })} className={inputCls + " tabular"} style={inputStyle} data-testid="fx-settle-amount" />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Taux du jour du règlement</label>
              <input type="number" step="any" min="0" value={settleForm.rate} placeholder={sRate ? String(sRate) : ""} onChange={(e) => setSettleForm({ ...settleForm, rate: e.target.value })} className={inputCls + " tabular"} style={inputStyle} data-testid="fx-settle-rate" />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>Date du règlement</label>
              <input type="date" value={settleForm.date} max={today} onChange={(e) => setSettleForm({ ...settleForm, date: e.target.value })} className={inputCls} style={inputStyle} data-testid="fx-settle-date" />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#8A8370" }}>{settleDoc.kind === "creance" ? "Encaissé sur" : "Payé depuis"}</label>
              <select value={settleForm.cash} onChange={(e) => setSettleForm({ ...settleForm, cash: e.target.value })} className={inputCls} style={inputStyle} data-testid="fx-settle-cash">
                <option value="512">512 — Banque</option>
                <option value="530">530 — Caisse</option>
                {settleDoc.currency === "USD" && <option value={FX_USD_ACCOUNT.code}>5121 — Compte en dollars (USD)</option>}
              </select>
            </div>
          </div>
          <div className="text-xs mt-3 p-2 rounded" style={{ background: "#FAF8F1", color: "#152238" }} data-testid="fx-settle-preview">
            {sPlan
              ? `${settleDoc.kind === "creance" ? "Encaissement" : "Paiement"} : ${fmt(sPlan.cash)} · valeur comptable soldée : ${fmt(sPlan.carry)} · ${sPlan.diff === 0 ? "aucun écart de change" : sPlan.diff > 0 ? `gain de change de ${fmt(sPlan.diff)}` : `perte de change de ${fmt(-sPlan.diff)}`}${sPlan.full ? " · solde l'opération" : ""}`
              : "Saisissez le montant et le taux pour voir l'écart de change."}
          </div>
          <div className="flex gap-2 mt-3 flex-wrap">
            <button onClick={confirmSettle} className="px-4 py-2 rounded text-sm text-white" style={{ background: "#0F6B5C" }} data-testid="fx-settle-confirm">Enregistrer le règlement</button>
            <button onClick={() => setSettleFor(null)} className="px-4 py-2 rounded text-sm" style={{ border: "1px solid #DDD6C4", color: "#7A7460" }}>Annuler</button>
          </div>
        </div>
      )}
    </div>
  );
}

