// ═══ MODULE ═══
// @module Rapports et bilans
// @depends ComparatifPanel, DeclarationIRPanel, DeclarationTCAPanel, Download, EC_BALANCE_COLS
//   EC_JOURNAL_COLS, FileDown, GroupedTabNav, Printer, SimpleDonutChart, SimpleLineChart
//   computeBalances, downloadEtatsFinanciersPDF, downloadTablePDF, ecBalanceRows, ecCsv
//   ecDownloadCsv, ecJournalRows, fmt, loansTotals, monthLabel, todayStr, useBackNav, useMemo
//   useState
// @exports BilanClasseView, RapportsModule, bilanClasse
// ═══ FIN DE L'EN-TÊTE ═══
function buildLedger(entries, accountCode, from, to) {
  const lines = [];
  (entries || []).forEach((e, idx) => {
    (e.lines || []).forEach((l, li) => {
      if (l.account !== accountCode) return;
      lines.push({ date: e.date || "", created: e.createdAt || "", idx, li, label: e.label || "", ref: e.ref || "", debit: Number(l.debit || 0), credit: Number(l.credit || 0) });
    });
  });
  lines.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.created < b.created ? -1 : a.created > b.created ? 1 : (a.idx - b.idx) || (a.li - b.li)));
  let opening = 0;
  const rows = [];
  lines.forEach((x) => {
    if (from && x.date < from) { opening += x.debit - x.credit; return; }
    if (to && x.date > to) return;
    rows.push({ ...x });
  });
  let running = opening, totalDebit = 0, totalCredit = 0;
  rows.forEach((r) => { running += r.debit - r.credit; r.balance = running; totalDebit += r.debit; totalCredit += r.credit; });
  return { opening, rows, totalDebit, totalCredit, closing: running };
}
// Solde affiché avec son sens : « D » = débiteur, « C » = créditeur.
function fmtDC(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  if (v === 0) return fmt(0);
  return `${fmt(Math.abs(v))} ${v > 0 ? "D" : "C"}`;
}

// ── Chantier D : bilan classé, classement des flux de trésorerie ─────────────
// Rubrique de bilan d'un compte, d'après son type et le début de son code.
function bdAccountSection(a) {
  const c = String(a.code);
  if (a.type === "Actif") {
    if (c.startsWith("28") || c.startsWith("29")) return "amort";
    if (c.startsWith("2")) return "immo";
    if (c.startsWith("37") || c.startsWith("39")) return "stocks";
    if (c.startsWith("5")) return "treso";
    return "creances"; // clients, factures à établir, provisions clients, charges constatées d'avance, autres actifs
  }
  if (a.type === "Capitaux propres") return "capitaux";
  if (a.type === "Passif") {
    if (c.startsWith("15")) return "provisions";
    if (c.startsWith("16") || c.startsWith("17")) return "dettesFin";
    return "dettesExpl";
  }
  return null;
}
// Bilan classé : chaque compte d'actif ou de passif tombe dans UNE seule rubrique,
// si bien que les totaux sont identiques à ceux du bilan simplifié.
function bilanClasse(accounts, balances, resultat) {
  const acc = { immo: [], amort: [], stocks: [], creances: [], treso: [], capitaux: [], provisions: [], dettesFin: [], dettesExpl: [] };
  accounts.forEach((a) => {
    const sec = bdAccountSection(a);
    if (!sec) return;
    const bal = balances[a.code] || 0;
    const solde = a.type === "Actif" ? bal : -bal;
    if (Math.round(solde * 100) === 0) return;
    acc[sec].push({ code: a.code, name: a.name, solde });
  });
  const sum = (k) => acc[k].reduce((t, x) => t + x.solde, 0);
  const sums = {
    immoNet: sum("immo") + sum("amort"), circulant: sum("stocks") + sum("creances"), treso: sum("treso"),
    capitaux: sum("capitaux") + resultat, provisions: sum("provisions"), dettesFin: sum("dettesFin"), dettesExpl: sum("dettesExpl"),
  };
  sums.totalActif = sums.immoNet + sums.circulant + sums.treso;
  sums.totalPassif = sums.capitaux + sums.provisions + sums.dettesFin + sums.dettesExpl;
  return { acc, sums, resultat };
}
// Lignes à afficher (écran et PDF) : cur = exercice en cours, prev = clôture précédente (ou null).
function bilanClasseRows(cur, prev) {
  const byCode = (x, y) => String(x.code).localeCompare(String(y.code), undefined, { numeric: true });
  const merged = (key) => {
    const map = new Map();
    cur.acc[key].forEach((r) => map.set(r.code, { t: "r", code: r.code, name: r.name, cur: r.solde, prev: 0 }));
    if (prev) prev.acc[key].forEach((r) => { const e = map.get(r.code); if (e) e.prev = r.solde; else map.set(r.code, { t: "r", code: r.code, name: r.name, cur: 0, prev: r.solde }); });
    return [...map.values()].sort(byCode);
  };
  const pv = (fn) => (prev ? fn(prev) : 0);
  const section = (label, keys, subLabel, curTotal, prevTotal, extraRows) => {
    const rows = [];
    keys.forEach((k) => merged(k).forEach((r) => rows.push(r)));
    (extraRows || []).forEach((r) => rows.push(r));
    if (rows.length === 0) return [];
    return [{ t: "h", label }, ...rows, { t: "s", label: subLabel, cur: curTotal, prev: prevTotal }];
  };
  const S = cur.sums;
  const actif = [
    ...section("Immobilisations", ["immo", "amort"], "Immobilisations nettes", S.immoNet, pv((p) => p.sums.immoNet)),
    ...section("Actif circulant", ["stocks", "creances"], "Total actif circulant", S.circulant, pv((p) => p.sums.circulant)),
    ...section("Trésorerie", ["treso"], "Total trésorerie", S.treso, pv((p) => p.sums.treso)),
    { t: "T", label: "TOTAL ACTIF", cur: S.totalActif, prev: pv((p) => p.sums.totalActif) },
  ];
  const passif = [
    ...section("Capitaux propres", ["capitaux"], "Total capitaux propres", S.capitaux, pv((p) => p.sums.capitaux),
      [{ t: "r", code: "—", name: "Résultat de l'exercice", cur: cur.resultat, prev: prev ? prev.resultat : 0 }]),
    ...section("Provisions pour risques et charges", ["provisions"], "Total provisions", S.provisions, pv((p) => p.sums.provisions)),
    ...section("Dettes financières", ["dettesFin"], "Total dettes financières", S.dettesFin, pv((p) => p.sums.dettesFin)),
    ...section("Dettes d'exploitation et autres dettes", ["dettesExpl"], "Total dettes d'exploitation", S.dettesExpl, pv((p) => p.sums.dettesExpl)),
    { t: "T", label: "TOTAL PASSIF ET CAPITAUX PROPRES", cur: S.totalPassif, prev: pv((p) => p.sums.totalPassif) },
  ];
  return { actif, passif };
}
function BilanClasseView({ cur, prev }) {
  const P = prev ? prev.cls : null;
  const { actif, passif } = bilanClasseRows(cur, P);
  const thStyle = { color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 };
  const renderTable = (title, rows, accent) => (
    <div style={{ minWidth: 0 }}>
      <div className="text-sm font-semibold mb-3" style={{ color: "#152238" }}>{title}</div>
      <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(21,34,56,0.08)" }}>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead>
            <tr style={{ background: "#C7CCDA" }}>
              <th className="py-2 px-3 text-left font-medium" style={thStyle}>Rubrique</th>
              <th className="py-2 px-3 text-right font-medium" style={thStyle}>Exercice</th>
              {P && <th className="py-2 px-3 text-right font-medium" style={thStyle}>Au {prev.date}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              if (r.t === "h") return (
                <tr key={i}><td colSpan={P ? 3 : 2} className="pt-3 pb-1 pl-3 pr-3 font-semibold" style={{ color: "#152238", background: "#F6F3EA", fontSize: 12 }}>{r.label}</td></tr>
              );
              const isTotal = r.t === "T", isSub = r.t === "s";
              return (
                <tr key={i} style={isTotal ? { background: "#FAF8F1" } : undefined}>
                  <td className={"py-2 pr-1 " + (isTotal || isSub ? "font-semibold" : "")} style={{ paddingLeft: isTotal || isSub ? 12 : 20, color: "#152238", borderLeft: `3px solid ${isTotal ? "#152238" : isSub ? "#A39C87" : accent}`, wordBreak: "break-word" }}>
                    {r.t === "r" ? (r.code === "—" ? r.name : `${r.code} — ${r.name}`) : r.label}
                  </td>
                  <td className={"py-2 px-3 tabular text-right " + (isTotal || isSub ? "font-semibold" : "")} style={{ color: "#152238" }}>{fmt(r.cur)}</td>
                  {P && <td className={"py-2 px-3 tabular text-right " + (isTotal || isSub ? "font-semibold" : "")} style={{ color: "#7A7460" }}>{fmt(r.prev)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>
    </div>
  );
  return (
    <div data-testid="bilan-classe">
      <div className="grid gap-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        {renderTable("Actif", actif, "#378ADD")}
        {renderTable("Passif & capitaux propres", passif, "#7F77DD")}
      </div>
      {Math.round(cur.sums.totalActif) !== Math.round(cur.sums.totalPassif) && (
        <div className="text-xs px-4 py-2 rounded mt-4" style={{ background: "#F7E9E3", color: "#A6432F" }}>
          Écart entre actif et passif : {fmt(cur.sums.totalActif - cur.sums.totalPassif)} — vérifiez les écritures saisies.
        </div>
      )}
      <p className="text-xs mt-3" style={{ color: "#8A8370" }}>
        Les immobilisations sont présentées à leur valeur brute, diminuée des amortissements cumulés. {P ? `La colonne « Au ${prev.date} » reprend la situation à la dernière clôture d'exercice.` : "Aucun exercice n'a encore été clôturé : il n'y a pas de colonne de comparaison."}
      </p>
    </div>
  );
}

// Classement des flux de trésorerie (méthode directe). Pour chaque écriture touchant
// la caisse (530) ou la banque (512), la variation de trésorerie est répartie entre
// les trois catégories selon le compte de contrepartie de chaque ligne. La somme des
// trois montants est toujours égale à la variation réelle de trésorerie de l'écriture.
function fluxClassOf(code) {
  const c = String(code);
  if ((c.startsWith("2") && !c.startsWith("28") && !c.startsWith("29")) || c.startsWith("404")) return "investissement";
  if (/^(10|11|12|13|14|16|17|45)/.test(c)) return "financement";
  return "exploitation";
}
function fluxSplit(entry) {
  const out = { exploitation: 0, investissement: 0, financement: 0 };
  const lines = entry.lines || [];
  const isCash = (a) => a === "530" || a === "512";
  if (!lines.some((l) => isCash(l.account))) return out;
  lines.forEach((l) => {
    if (isCash(l.account)) return;
    // C = −Σ(débit − crédit des lignes hors trésorerie) : chaque ligne porte sa part.
    out[fluxClassOf(l.account)] += Number(l.credit || 0) - Number(l.debit || 0);
  });
  return out;
}

function RapportsModule({ accounts, balances, invoices, purchases, entries, settings, assets, riskProvisions, deferrals, loans, products, clients, showToast, planTier }) {
  const [tab, setTab] = useState("resultat");
  useBackNav(tab, setTab, "resultat");
  const [detailMonth, setDetailMonth] = useState("");
  const [fluxFrom, setFluxFrom] = useState("");
  const [fluxTo, setFluxTo] = useState(todayStr());
  // Grand livre : "" = tous les comptes mouvementés ; période vide = tout l'historique
  const [glAccount, setGlAccount] = useState("");
  const [glFrom, setGlFrom] = useState("");
  const [glTo, setGlTo] = useState("");
  const glData = useMemo(() => {
    const list = glAccount ? accounts.filter((a) => a.code === glAccount) : [...accounts].sort((x, y) => String(x.code).localeCompare(String(y.code), undefined, { numeric: true }));
    // Comptes utilisés dans le journal mais absents du plan comptable : on les garde visibles.
    const known = new Set(accounts.map((a) => a.code));
    const extra = glAccount ? [] : [...new Set((entries || []).flatMap((e) => (e.lines || []).map((l) => l.account)).filter((c) => c && !known.has(c)))].map((code) => ({ code, name: "(compte hors plan comptable)", type: "" }));
    return [...list, ...extra]
      .map((a) => ({ account: a, ledger: buildLedger(entries, a.code, glFrom, glTo) }))
      .filter((x) => glAccount || x.ledger.rows.length > 0 || Math.abs(x.ledger.opening) > 0.004);
  }, [accounts, entries, glAccount, glFrom, glTo]);
  const setGlPreset = (kind) => {
    const now = new Date();
    const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, "0");
    if (kind === "tout") { setGlFrom(""); setGlTo(""); }
    else if (kind === "mois") { setGlFrom(`${y}-${m}-01`); setGlTo(todayStr()); }
    else if (kind === "annee") { setGlFrom(`${y}-01-01`); setGlTo(todayStr()); }
  };
  const exportGrandLivreCSV = () => {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const out = [["Compte", "Libellé du compte", "Date", "Libellé de l'écriture", "Débit", "Crédit", "Solde progressif (débit − crédit)"].join(",")];
    glData.forEach(({ account, ledger }) => {
      out.push([esc(account.code), esc(account.name), "", esc("Solde d'ouverture"), "", "", ledger.opening.toFixed(2)].join(","));
      ledger.rows.forEach((r) => out.push([esc(account.code), esc(account.name), esc(r.date), esc(r.label), r.debit.toFixed(2), r.credit.toFixed(2), r.balance.toFixed(2)].join(",")));
      out.push([esc(account.code), esc(account.name), "", esc("Total / solde de clôture"), ledger.totalDebit.toFixed(2), ledger.totalCredit.toFixed(2), ledger.closing.toFixed(2)].join(","));
    });
    const blob = new Blob(["\uFEFF" + out.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url;
    el.download = `grand-livre-${(settings?.companyName || "export").replace(/\s+/g, "")}-${todayStr()}.csv`;
    el.click();
    URL.revokeObjectURL(url);
    showToast("Export du grand livre généré.");
  };

  const produitsAccounts = accounts.filter((a) => a.type === "Produit").map((a) => ({ ...a, solde: -(balances[a.code] || 0) }));
  const chargesAccounts = accounts.filter((a) => a.type === "Charge").map((a) => ({ ...a, solde: balances[a.code] || 0 }));
  const totalProduits = produitsAccounts.reduce((s, a) => s + a.solde, 0);
  const totalCharges = chargesAccounts.reduce((s, a) => s + a.solde, 0);
  const resultat = totalProduits - totalCharges;

  const actifAccounts = accounts.filter((a) => a.type === "Actif").map((a) => ({ ...a, solde: balances[a.code] || 0 }));
  const passifAccounts = accounts.filter((a) => a.type === "Passif").map((a) => ({ ...a, solde: -(balances[a.code] || 0) }));
  const capitauxAccounts = accounts.filter((a) => a.type === "Capitaux propres").map((a) => ({ ...a, solde: -(balances[a.code] || 0) }));
  const totalActif = actifAccounts.reduce((s, a) => s + a.solde, 0);
  const totalPassif = passifAccounts.reduce((s, a) => s + a.solde, 0) + capitauxAccounts.reduce((s, a) => s + a.solde, 0) + resultat;

  // Bilan classé : présentation par rubriques, avec comparaison à la dernière clôture.
  const [bilanView, setBilanView] = useState("simplifie");
  const bilanCls = useMemo(() => bilanClasse(accounts, balances, resultat), [accounts, balances, resultat]);
  const bilanPrev = useMemo(() => {
    const d = settings.lastClosingDate;
    if (!d) return null;
    const prevBal = computeBalances(accounts, (entries || []).filter((e) => e.date && e.date <= d));
    const prevResultat = accounts.filter((a) => a.type === "Produit").reduce((t, a) => t - (prevBal[a.code] || 0), 0)
      - accounts.filter((a) => a.type === "Charge").reduce((t, a) => t + (prevBal[a.code] || 0), 0);
    return { date: d, cls: bilanClasse(accounts, prevBal, prevResultat) };
  }, [accounts, entries, settings.lastClosingDate]);

  // Annexes auto-générées : un résumé des méthodes et provisions en cours, pour
  // donner une image fidèle sans construire un éditeur de notes libres.
  const notesAnnexes = useMemo(() => {
    const lines = [];
    lines.push(`Méthode de valorisation du stock : ${settings.stockValuationMethod === "actif" ? "stock en actif, coût moyen pondéré" : "stock en charge"}.`);
    if (assets && assets.length > 0) {
      const totalVNC = assets.reduce((s, a) => s + (a.originalValue - (a.accumulatedDepreciation || 0)), 0);
      const degressifCount = assets.filter((a) => a.method === "degressif").length;
      lines.push(`Immobilisations : ${assets.length} enregistrée(s), valeur nette comptable totale ${fmt(totalVNC)}${degressifCount > 0 ? ` (dont ${degressifCount} amortie(s) en dégressif)` : ""}.`);
    }
    const stockProvisionTotal = (products || []).reduce((s, p) => s + (Number(p.depreciationProvision) || 0), 0);
    if (stockProvisionTotal > 0) lines.push(`Dépréciation de stock provisionnée : ${fmt(stockProvisionTotal)}.`);
    const doubtfulTotal = (clients || []).reduce((s, c) => s + (Number(c.doubtfulProvision) || 0), 0);
    if (doubtfulTotal > 0) lines.push(`Provisions pour créances douteuses en cours : ${fmt(doubtfulTotal)}.`);
    const riskTotal = (riskProvisions || []).filter((p) => p.status !== "close").reduce((s, p) => s + (Number(p.currentAmount) || 0), 0);
    if (riskTotal > 0) lines.push(`Provisions pour risques et charges en cours : ${fmt(riskTotal)}.`);
    const deferralsRemaining = (deferrals || []).reduce((s, d) => s + (d.totalAmount - (d.amountRecognized || 0)), 0);
    const lt = loansTotals(loans, todayStr());
    if (lt.remaining > 0) lines.push(`Emprunts : capital restant dû ${fmt(lt.remaining)}, dont ${fmt(lt.dueWithinYear)} à rembourser dans l'année.`);
    if (deferralsRemaining > 0) lines.push(`Charges/produits constatés d'avance restant à reclasser : ${fmt(deferralsRemaining)}.`);
    lines.push(settings.lastClosingDate ? `Dernier exercice clôturé au : ${settings.lastClosingDate}.` : "Aucun exercice n'a encore été formellement clôturé.");
    return lines;
  }, [settings, assets, products, clients, riskProvisions, deferrals, loans]);

  const salesByMonth = useMemo(() => {
    const byMonth = {};
    invoices.forEach((inv) => {
      const key = monthLabel(inv.date);
      if (!byMonth[key]) byMonth[key] = { total: 0, count: 0 };
      byMonth[key].total += inv.total;
      byMonth[key].count += 1;
    });
    return Object.entries(byMonth).map(([mois, v]) => ({ mois, total: v.total, count: v.count }));
  }, [invoices]);

  const topProducts = useMemo(() => {
    const byProduct = {};
    invoices.forEach((inv) => {
      (inv.lines || []).forEach((l) => {
        if (!byProduct[l.name]) byProduct[l.name] = { name: l.name, qty: 0, revenue: 0 };
        byProduct[l.name].qty += l.qty;
        byProduct[l.name].revenue += l.subtotal;
      });
    });
    return Object.values(byProduct).sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  }, [invoices]);

  // Mois affiché par défaut dans le détail des ventes : le plus récent avec au moins
  // une vente, pour ne jamais ouvrir sur un mois vide si le mois en cours n'a rien.
  const effectiveDetailMonth = detailMonth || salesByMonth[salesByMonth.length - 1]?.mois || "";
  const salesForDetailMonth = useMemo(() => {
    if (!effectiveDetailMonth) return [];
    return invoices
      .filter((inv) => monthLabel(inv.date) === effectiveDetailMonth)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [invoices, effectiveDetailMonth]);

  const exportJournalCSV = () => {
    // Export générique du journal, sans référence à une administration fiscale
    // précise — utile pour un import dans un tableur ou un autre logiciel, en
    // attendant les formats réellement conformes DGI (Haïti) / SAT (Mexique)
    // prévus en v2.0 (voir note dans l'interface).
    const cols = ["Date", "Compte", "Libellé du compte", "Libellé de l'écriture", "Débit", "Crédit"];
    const rows = [cols.join(",")];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const sorted = [...entries].sort((a, b) => (a.date > b.date ? 1 : -1));
    sorted.forEach((e) => {
      (e.lines || []).forEach((l) => {
        const acc = accounts.find((a) => a.code === l.account);
        rows.push([esc(e.date), esc(l.account), esc(acc?.name || ""), esc(e.label || ""), (l.debit || 0).toFixed(2), (l.credit || 0).toFixed(2)].join(","));
      });
    });
    const blob = new Blob(["\uFEFF" + rows.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `journal-${(settings?.companyName || "export").replace(/\s+/g, "")}-${todayStr()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Export du journal généré.");
  };

  const reportTitles = {
    resultat: "Compte de résultat",
    bilan: bilanView === "classe" ? "Bilan classé" : "Bilan simplifié",
    balance: "Balance des comptes",
    grandlivre: "Grand livre",
    ventes: "Analyse des ventes",
    export: "Export",
  };

  const exportCurrentTabPDF = () => {
    if (tab === "resultat") {
      downloadTablePDF({
        title: "Compte de résultat", settings,
        columns: ["Code", "Compte", "Solde"],
        rows: [
          ...produitsAccounts.map((a) => [a.code, `Produit — ${a.name}`, fmt(a.solde)]),
          ...chargesAccounts.map((a) => [a.code, `Charge — ${a.name}`, fmt(a.solde)]),
        ],
        footerLines: [
          `Total produits : ${fmt(totalProduits)}`,
          `Total charges : ${fmt(totalCharges)}`,
          `Résultat net : ${fmt(resultat)}`,
        ],
      });
    } else if (tab === "bilan" && bilanView === "classe") {
      const { actif, passif } = bilanClasseRows(bilanCls, bilanPrev ? bilanPrev.cls : null);
      const withPrev = !!bilanPrev;
      const toPdf = (prefix, list) => list.map((r) => {
        if (r.t === "h") return ["", `${prefix} — ${r.label}`.toUpperCase(), "", ...(withPrev ? [""] : [])];
        const label = r.t === "r" ? r.name : r.label;
        return [r.t === "r" ? r.code : "", label, fmt(r.cur), ...(withPrev ? [fmt(r.prev)] : [])];
      });
      downloadTablePDF({
        title: "Bilan classé", settings,
        columns: ["Code", "Rubrique", "Exercice", ...(withPrev ? [`Au ${bilanPrev.date}`] : [])],
        rows: [...toPdf("Actif", actif), ...toPdf("Passif", passif)],
        footerLines: [
          `Total actif : ${fmt(bilanCls.sums.totalActif)}`,
          `Total passif + capitaux propres : ${fmt(bilanCls.sums.totalPassif)}`,
        ],
      });
    } else if (tab === "bilan") {
      downloadTablePDF({
        title: "Bilan simplifié", settings,
        columns: ["Code", "Compte", "Solde"],
        rows: [
          ...actifAccounts.map((a) => [a.code, `Actif — ${a.name}`, fmt(a.solde)]),
          ...capitauxAccounts.map((a) => [a.code, `Capitaux propres — ${a.name}`, fmt(a.solde)]),
          ...passifAccounts.map((a) => [a.code, `Passif — ${a.name}`, fmt(a.solde)]),
          ["—", "Résultat de l'exercice", fmt(resultat)],
        ],
        footerLines: [
          `Total actif : ${fmt(totalActif)}`,
          `Total passif + capitaux propres : ${fmt(totalPassif)}`,
        ],
      });
    } else if (tab === "balance") {
      downloadTablePDF({
        title: "Balance des comptes", settings,
        columns: ["Code", "Compte", "Type", "Solde"],
        rows: accounts.map((a) => [a.code, a.name, a.type, fmt(balances[a.code] || 0)]),
      });
    } else if (tab === "grandlivre") {
      const periode = glFrom || glTo ? ` (${glFrom || "début"} → ${glTo || "aujourd'hui"})` : "";
      const pdfRows = [];
      glData.forEach(({ account, ledger }) => {
        pdfRows.push([`${account.code} — ${account.name}`, "Solde d'ouverture", "", "", fmtDC(ledger.opening)]);
        ledger.rows.forEach((r) => pdfRows.push([r.date, r.label, r.debit ? fmt(r.debit) : "", r.credit ? fmt(r.credit) : "", fmtDC(r.balance)]));
        pdfRows.push(["", "Total / solde de clôture", fmt(ledger.totalDebit), fmt(ledger.totalCredit), fmtDC(ledger.closing)]);
      });
      downloadTablePDF({ title: `Grand livre${periode}`, settings, columns: ["Date", "Libellé", "Débit", "Crédit", "Solde"], rows: pdfRows });
    } else if (tab === "ventes") {
      downloadTablePDF({
        title: "Analyse des ventes — chiffre d'affaires par mois", settings,
        columns: ["Mois", "Chiffre d'affaires"],
        rows: salesByMonth.map((m) => [m.mois, fmt(m.total)]),
      });
      downloadTablePDF({
        title: "Analyse des ventes — meilleures ventes", settings,
        columns: ["Article", "Quantité vendue", "Chiffre d'affaires"],
        rows: topProducts.map((p) => [p.name, String(p.qty), fmt(p.revenue)]),
      });
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <header className="mb-6 no-print">
        <div className="text-xs uppercase tracking-widest" style={{ color: "#C9A24B" }}>Module 7</div>
        <div className="display text-3xl" style={{ color: "#152238" }}>Rapports et analyse</div>
        <p className="text-sm mt-1" style={{ color: "#7A7460" }}>États calculés en continu à partir du journal comptable et des ventes.</p>
      </header>

      {/* En-tête visible uniquement à l'impression (bouton "Imprimer" ci-dessous) */}
      <div className="print-only mb-6 flex items-start gap-3" style={{ borderBottom: "2px solid #152238", paddingBottom: 12 }}>
        {settings.companyLogo && (
          <img src={settings.companyLogo} alt="" style={{ width: 40, height: 40, objectFit: "contain" }} />
        )}
        <div>
          <div className="display" style={{ fontSize: 20, fontWeight: 700, color: "#152238" }}>{settings.companyName || "Mon Entreprise"}</div>
          {settings.companyAddress && <div style={{ fontSize: 12, color: "#555" }}>{settings.companyAddress}</div>}
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 8, color: "#152238" }}>{reportTitles[tab] || "Rapport"}</div>
          <div className="tabular" style={{ fontSize: 12, color: "#888" }}>Généré le {todayStr()}</div>
        </div>
      </div>

      <GroupedTabNav
        tab={tab}
        setTab={setTab}
        className="no-print"
        groups={[
          { label: "États financiers", color: { bg: "#152238", text: "#fff", light: "#E8EAF0", lightText: "#152238" }, tabs: [["resultat", "Compte de résultat"], ["bilan", "Bilan simplifié"], ["balance", "Balance des comptes"], ["grandlivre", "Grand livre"], ["fluxTresorerie", "Flux de trésorerie"], ["comparatif", "Comparatif"]] },
          { label: "Déclarations fiscales", color: { bg: "#A6432F", text: "#fff", light: "#F7E9E3", lightText: "#A6432F" }, tabs: [["declarationTCA", "Déclaration TCA"], ["declarationIR", "Impôt sur le Revenu"]] },
          { label: "Analyse & Export", color: { bg: "#9A7B1E", text: "#fff", light: "#FBF1DC", lightText: "#9A7B1E" }, tabs: [["ventes", "Analyse des ventes"], ["export", "Export"]] },
        ]}
      />
      {tab !== "export" && (
        <div className="flex flex-wrap gap-2 mb-6 no-print">
          <button onClick={exportCurrentTabPDF} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded" style={{ background: "#152238", color: "#EFE9DD" }}>
            <Download size={13} /> Télécharger « {reportTitles[tab]} » en PDF
          </button>
          <button onClick={() => window.print()} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded" style={{ border: "1px solid #DDD6C4", color: "#7A7460" }}>
            <Printer size={13} /> Imprimer
          </button>
        </div>
      )}

      {tab === "resultat" && (
        <div className="grid gap-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          <div style={{ minWidth: 0 }}>
            <div className="text-sm font-semibold mb-3" style={{ color: "#0F6B5C" }}>Produits</div>
            <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(21,34,56,0.08)" }}>
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "#C7CCDA" }}>
                    <th className="py-2 px-3 text-left font-medium" style={{ color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Compte</th>
                    <th className="py-2 px-3 text-right font-medium" style={{ color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Solde</th>
                  </tr>
                </thead>
                <tbody>
                  {produitsAccounts.map((a) => (
                    <tr key={a.code}>
                      <td className="py-2 pl-3 pr-1" style={{ color: "#152238", borderLeft: "3px solid #639922" }}>{a.code} — {a.name}</td>
                      <td className="py-2 px-3 tabular text-right" style={{ color: "#0F6B5C" }}>{fmt(a.solde)}</td>
                    </tr>
                  ))}
                  <tr style={{ background: "#FAF8F1" }}>
                    <td className="py-2 pl-3 pr-1 font-semibold" style={{ color: "#152238", borderLeft: "3px solid #152238" }}>Total produits</td>
                    <td className="py-2 px-3 tabular text-right font-semibold" style={{ color: "#0F6B5C" }}>{fmt(totalProduits)}</td>
                  </tr>
                </tbody>
              </table></div>
            </div>
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="text-sm font-semibold mb-3" style={{ color: "#A6432F" }}>Charges</div>
            <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(21,34,56,0.08)" }}>
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "#C7CCDA" }}>
                    <th className="py-2 px-3 text-left font-medium" style={{ color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Compte</th>
                    <th className="py-2 px-3 text-right font-medium" style={{ color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Solde</th>
                  </tr>
                </thead>
                <tbody>
                  {chargesAccounts.map((a) => (
                    <tr key={a.code}>
                      <td className="py-2 pl-3 pr-1" style={{ color: "#152238", borderLeft: "3px solid #D85A30" }}>{a.code} — {a.name}</td>
                      <td className="py-2 px-3 tabular text-right" style={{ color: "#A6432F" }}>{fmt(a.solde)}</td>
                    </tr>
                  ))}
                  <tr style={{ background: "#FAF8F1" }}>
                    <td className="py-2 pl-3 pr-1 font-semibold" style={{ color: "#152238", borderLeft: "3px solid #152238" }}>Total charges</td>
                    <td className="py-2 px-3 tabular text-right font-semibold" style={{ color: "#A6432F" }}>{fmt(totalCharges)}</td>
                  </tr>
                </tbody>
              </table></div>
            </div>
          </div>
          <div className="bg-white rounded-lg p-6 flex justify-between items-center" style={{ border: "1px solid #E4DFD1", gridColumn: "1 / -1" }}>
            <span className="text-sm font-medium" style={{ color: "#152238" }}>Résultat net</span>
            <span className="tabular text-xl font-semibold" style={{ color: resultat >= 0 ? "#0F6B5C" : "#A6432F" }}>{fmt(resultat)}</span>
          </div>
        </div>
      )}

      {tab === "bilan" && (
        <div className="flex flex-wrap gap-2 mb-4" data-testid="bilan-toggle">
          <button onClick={() => setBilanView("simplifie")} className="px-3 py-1.5 rounded text-xs" style={bilanView === "simplifie" ? { background: "#152238", color: "#fff" } : { border: "1px solid #DDD6C4", color: "#152238" }}>Présentation simplifiée</button>
          <button onClick={() => setBilanView("classe")} className="px-3 py-1.5 rounded text-xs" style={bilanView === "classe" ? { background: "#152238", color: "#fff" } : { border: "1px solid #DDD6C4", color: "#152238" }}>Présentation classée</button>
        </div>
      )}
      {tab === "bilan" && bilanView === "classe" && <BilanClasseView cur={bilanCls} prev={bilanPrev} />}
      {tab === "bilan" && bilanView === "simplifie" && (
        <div className="grid gap-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          <div style={{ minWidth: 0 }}>
            <div className="text-sm font-semibold mb-3" style={{ color: "#152238" }}>Actif</div>
            <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(21,34,56,0.08)" }}>
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "#C7CCDA" }}>
                    <th className="py-2 px-3 text-left font-medium" style={{ color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Compte</th>
                    <th className="py-2 px-3 text-right font-medium" style={{ color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Solde</th>
                  </tr>
                </thead>
                <tbody>
                  {actifAccounts.map((a) => (
                    <tr key={a.code}>
                      <td className="py-2 pl-3 pr-1" style={{ color: "#152238", borderLeft: "3px solid #378ADD" }}>{a.code} — {a.name}</td>
                      <td className="py-2 px-3 tabular text-right" style={{ color: "#152238" }}>{fmt(a.solde)}</td>
                    </tr>
                  ))}
                  <tr style={{ background: "#FAF8F1" }}>
                    <td className="py-2 pl-3 pr-1 font-semibold" style={{ color: "#152238", borderLeft: "3px solid #152238" }}>Total actif</td>
                    <td className="py-2 px-3 tabular text-right font-semibold" style={{ color: "#152238" }}>{fmt(totalActif)}</td>
                  </tr>
                </tbody>
              </table></div>
            </div>
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="text-sm font-semibold mb-3" style={{ color: "#152238" }}>Passif &amp; capitaux propres</div>
            <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(21,34,56,0.08)" }}>
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "#C7CCDA" }}>
                    <th className="py-2 px-3 text-left font-medium" style={{ color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Compte</th>
                    <th className="py-2 px-3 text-right font-medium" style={{ color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Solde</th>
                  </tr>
                </thead>
                <tbody>
                  {[...capitauxAccounts, ...passifAccounts].map((a) => (
                    <tr key={a.code}>
                      <td className="py-2 pl-3 pr-1" style={{ color: "#152238", borderLeft: "3px solid #7F77DD" }}>{a.code} — {a.name}</td>
                      <td className="py-2 px-3 tabular text-right" style={{ color: "#152238" }}>{fmt(a.solde)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="py-2 pl-3 pr-1" style={{ color: "#152238", borderLeft: "3px solid #7F77DD" }}>Résultat de l'exercice</td>
                    <td className="py-2 px-3 tabular text-right" style={{ color: "#152238" }}>{fmt(resultat)}</td>
                  </tr>
                  <tr style={{ background: "#FAF8F1" }}>
                    <td className="py-2 pl-3 pr-1 font-semibold" style={{ color: "#152238", borderLeft: "3px solid #152238" }}>Total passif + capitaux propres</td>
                    <td className="py-2 px-3 tabular text-right font-semibold" style={{ color: "#152238" }}>{fmt(totalPassif)}</td>
                  </tr>
                </tbody>
              </table></div>
            </div>
          </div>
          {Math.round(totalActif) !== Math.round(totalPassif) && (
            <div className="text-xs px-4 py-2 rounded" style={{ background: "#F7E9E3", color: "#A6432F", gridColumn: "1 / -1" }}>
              Écart entre actif et passif : {fmt(totalActif - totalPassif)} — vérifiez les écritures saisies.
            </div>
          )}
        </div>
      )}

      {tab === "fluxTresorerie" && (() => {
        // Méthode directe : chaque mouvement touchant la caisse (530) ou la banque
        // (512) est réparti selon le compte en contrepartie de chaque ligne (voir
        // fluxSplit) — immobilisations (2xx hors amortissements) et fournisseurs
        // d'immobilisations (404) → investissement ; capital, réserves, report,
        // emprunts (16x/17x) et comptes d'associés/dividendes (45x) → financement ;
        // tout le reste → exploitation. Purement une lecture des écritures déjà
        // enregistrées : aucune donnée n'est créée ni modifiée par cet écran.
        const cashMovement = (entry) =>
          (entry.lines || []).reduce((s, l) => s + (l.account === "530" || l.account === "512" ? Number(l.debit || 0) - Number(l.credit || 0) : 0), 0);

        const periodEntries = entries.filter((e) => (!fluxFrom || e.date >= fluxFrom) && (!fluxTo || e.date <= fluxTo) && cashMovement(e) !== 0);
        const buckets = { exploitation: [], investissement: [], financement: [] };
        periodEntries.forEach((e) => { const sp = fluxSplit(e); Object.keys(buckets).forEach((k) => { if (Math.abs(sp[k]) > 0.004) buckets[k].push({ entry: e, amount: sp[k] }); }); });
        const sumBucket = (key) => buckets[key].reduce((s, x) => s + x.amount, 0);
        const netExploitation = sumBucket("exploitation");
        const netInvestissement = sumBucket("investissement");
        const netFinancement = sumBucket("financement");
        const variationNette = netExploitation + netInvestissement + netFinancement;

        const tresorerie = (upTo) => entries
          .filter((e) => (!upTo || e.date <= upTo))
          .reduce((s, e) => s + (e.lines || []).reduce((s2, l) => s2 + ((l.account === "530" || l.account === "512") ? Number(l.debit || 0) - Number(l.credit || 0) : 0), 0), 0);
        const tresorerieDebut = fluxFrom ? tresorerie(new Date(new Date(fluxFrom).getTime() - 86400000).toISOString().slice(0, 10)) : 0;
        const tresorerieFin = tresorerie(fluxTo || null);

        const bucketLabels = { exploitation: "Activités opérationnelles", investissement: "Activités d'investissement", financement: "Activités de financement" };

        return (
          <div className="space-y-6">
            <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="text-xs" style={{ color: "#8A8370" }}>Du</label>
                  <input type="date" value={fluxFrom} onChange={(e) => setFluxFrom(e.target.value)}
                    className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
                </div>
                <div>
                  <label className="text-xs" style={{ color: "#8A8370" }}>Au</label>
                  <input type="date" value={fluxTo} max={todayStr()} onChange={(e) => setFluxTo(e.target.value)}
                    className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
                </div>
              </div>
              <p className="text-xs mb-2" style={{ color: "#8A8370" }}>Laissez "Du" vide pour calculer depuis le tout début.</p>
            </div>

            <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
              <div className="text-sm font-semibold mb-4" style={{ color: "#152238" }}>Tableau des flux de trésorerie</div>
              <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(21,34,56,0.08)" }}>
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <tbody>
                  <tr>
                    <td className="py-2 pl-3 pr-1" style={{ color: "#152238", borderLeft: "3px solid #A39C87" }}>Trésorerie en début de période</td>
                    <td className="py-2 px-3 tabular text-right" style={{ color: "#152238" }}>{fmt(tresorerieDebut)}</td>
                  </tr>
                  {["exploitation", "investissement", "financement"].map((key) => (
                    <tr key={key}>
                      <td className="py-2 pl-3 pr-1" style={{ color: "#152238", borderLeft: "3px solid #378ADD" }}>Flux net — {bucketLabels[key]}</td>
                      <td className="py-2 px-3 tabular text-right" style={{ color: sumBucket(key) >= 0 ? "#0F6B5C" : "#A6432F" }}>{fmt(sumBucket(key))}</td>
                    </tr>
                  ))}
                  <tr style={{ background: "#FAF8F1" }}>
                    <td className="py-2 pl-3 pr-1 font-medium" style={{ color: "#152238", borderLeft: "3px solid #152238" }}>Variation nette de trésorerie</td>
                    <td className="py-2 px-3 tabular text-right font-medium" style={{ color: "#152238" }}>{fmt(variationNette)}</td>
                  </tr>
                  <tr style={{ background: "#FAF8F1" }}>
                    <td className="py-2 pl-3 pr-1 font-medium" style={{ color: "#152238", borderLeft: "3px solid #152238" }}>Trésorerie en fin de période</td>
                    <td className="py-2 px-3 tabular text-right font-medium" style={{ color: "#152238" }}>{fmt(tresorerieFin)}</td>
                  </tr>
                </tbody>
              </table></div>
              </div>
              {Math.round((tresorerieDebut + variationNette - tresorerieFin) * 100) !== 0 && (
                <p className="text-xs mt-3" style={{ color: "#A6432F" }}>Écart de rapprochement détecté — vérifiez qu'aucune écriture n'a une date antérieure au début de trésorerie utilisé.</p>
              )}
            </div>

            {["exploitation", "investissement", "financement"].map((key) => buckets[key].length > 0 && (
              <div key={key}>
                <div className="text-sm font-semibold mb-3" style={{ color: "#152238" }}>Détail — {bucketLabels[key]}</div>
                <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(21,34,56,0.08)" }}>
                <div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: "#C7CCDA" }}>
                      <th className="py-2 px-3 text-left font-medium" style={{ color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Date</th>
                      <th className="py-2 px-3 text-left font-medium" style={{ color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Écriture</th>
                      <th className="py-2 px-3 text-right font-medium" style={{ color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Montant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buckets[key].map(({ entry, amount }) => (
                      <tr key={entry.id}>
                        <td className="py-1.5 pl-3 pr-1 tabular" style={{ borderLeft: `3px solid ${amount >= 0 ? "#639922" : "#D85A30"}` }}>{entry.date}</td>
                        <td className="py-1.5 px-3" style={{ color: "#152238" }}>{entry.label}</td>
                        <td className="py-1.5 px-3 tabular text-right" style={{ color: amount >= 0 ? "#0F6B5C" : "#A6432F" }}>{fmt(amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {tab === "balance" && (
        <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(21,34,56,0.08)" }}>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead>
              <tr style={{ background: "#C7CCDA" }}>
                <th className="py-2 px-3 text-left font-medium" style={{ color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Code</th>
                <th className="py-2 px-3 text-left font-medium" style={{ color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Compte</th>
                <th className="py-2 px-3 text-left font-medium" style={{ color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Type</th>
                <th className="py-2 px-3 text-right font-medium" style={{ color: "#152238", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Solde</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const accentByType = { "Produit": "#639922", "Charge": "#D85A30", "Actif": "#378ADD", "Passif": "#7F77DD", "Capitaux propres": "#7F77DD" };
                return (
                <tr key={a.code}>
                  <td className="py-2 pl-3 tabular" style={{ borderLeft: `3px solid ${accentByType[a.type] || "#A39C87"}` }}>{a.code}</td>
                  <td className="py-2 px-3" style={{ color: "#152238" }}>{a.name}</td>
                  <td className="py-2 px-3" style={{ color: "#7A7460" }}>{a.type}</td>
                  <td className="py-2 px-3 tabular text-right" style={{ color: "#152238" }}>{fmt(balances[a.code] || 0)}</td>
                </tr>
                );
              })}
            </tbody>
          </table></div>
        </div>
      )}

      {tab === "grandlivre" && (
        <div>
          <div className="bg-white rounded-lg p-4 mb-4 no-print" style={{ border: "1px solid #E4DFD1" }}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs" style={{ color: "#8A8370" }}>Compte</label>
                <select value={glAccount} onChange={(e) => setGlAccount(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }}>
                  <option value="">Tous les comptes mouvementés</option>
                  {[...accounts].sort((x, y) => String(x.code).localeCompare(String(y.code), undefined, { numeric: true })).map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs" style={{ color: "#8A8370" }}>Du</label>
                <input type="date" value={glFrom} onChange={(e) => setGlFrom(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
              </div>
              <div>
                <label className="text-xs" style={{ color: "#8A8370" }}>Au</label>
                <input type="date" value={glTo} onChange={(e) => setGlTo(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm mt-1" style={{ borderColor: "#DDD6C4" }} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <span className="text-xs" style={{ color: "#8A8370" }}>Période :</span>
              <button onClick={() => setGlPreset("tout")} className="text-xs px-2.5 py-1 rounded" style={{ border: "1px solid #DDD6C4", color: "#152238" }}>Tout l'historique</button>
              <button onClick={() => setGlPreset("mois")} className="text-xs px-2.5 py-1 rounded" style={{ border: "1px solid #DDD6C4", color: "#152238" }}>Ce mois</button>
              <button onClick={() => setGlPreset("annee")} className="text-xs px-2.5 py-1 rounded" style={{ border: "1px solid #DDD6C4", color: "#152238" }}>Cette année</button>
              <button onClick={exportGrandLivreCSV} className="flex items-center gap-1.5 text-xs px-3 py-1 rounded ml-auto" style={{ border: "1px solid #DDD6C4", color: "#7A7460" }}><Download size={13} /> Exporter en CSV</button>
            </div>
            <div className="text-xs mt-2" style={{ color: "#A39C87" }}>Solde : D = débiteur, C = créditeur. Les contrepassations et annulations apparaissent comme des lignes à part, comme dans le journal.</div>
          </div>
          {glData.length === 0 ? (
            <div className="text-sm py-8 text-center bg-white rounded-lg" style={{ color: "#A39C87", border: "1px solid #E4DFD1" }}>Aucun mouvement sur cette période.</div>
          ) : glData.map(({ account, ledger }) => (
            <div key={account.code} data-gl-account={account.code} className="mb-5" style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(21,34,56,0.08)" }}>
              <div className="px-3 py-2 text-sm font-semibold" style={{ background: "#C7CCDA", color: "#152238" }}>{account.code} — {account.name}</div>
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead>
                  <tr style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                    <th className="py-2 px-3 text-left font-normal">Date</th>
                    <th className="py-2 px-3 text-left font-normal">Libellé</th>
                    <th className="py-2 px-3 text-right font-normal">Débit</th>
                    <th className="py-2 px-3 text-right font-normal">Crédit</th>
                    <th className="py-2 px-3 text-right font-normal">Solde</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ background: "#FAF8F1" }}>
                    <td className="py-2 px-3"></td>
                    <td className="py-2 px-3 italic" style={{ color: "#7A7460" }}>Solde d'ouverture{glFrom ? ` au ${glFrom}` : ""}</td>
                    <td></td><td></td>
                    <td data-gl="opening" className="py-2 px-3 tabular text-right">{fmtDC(ledger.opening)}</td>
                  </tr>
                  {ledger.rows.map((r, i) => (
                    <tr key={i} style={{ borderTop: "1px solid #F3EFE3" }}>
                      <td className="py-2 px-3 tabular whitespace-nowrap">{r.date}</td>
                      <td className="py-2 px-3" style={{ color: "#152238" }}>{r.label}</td>
                      <td className="py-2 px-3 tabular text-right">{r.debit ? fmt(r.debit) : ""}</td>
                      <td className="py-2 px-3 tabular text-right">{r.credit ? fmt(r.credit) : ""}</td>
                      <td className="py-2 px-3 tabular text-right" style={{ color: "#152238" }}>{fmtDC(r.balance)}</td>
                    </tr>
                  ))}
                  <tr style={{ background: "#FAF8F1", borderTop: "1px solid #DDD6C4" }}>
                    <td className="py-2 px-3"></td>
                    <td className="py-2 px-3 font-semibold" style={{ color: "#152238" }}>Total / solde de clôture</td>
                    <td data-gl="totalDebit" className="py-2 px-3 tabular text-right font-semibold">{fmt(ledger.totalDebit)}</td>
                    <td data-gl="totalCredit" className="py-2 px-3 tabular text-right font-semibold">{fmt(ledger.totalCredit)}</td>
                    <td data-gl="closing" className="py-2 px-3 tabular text-right font-semibold" style={{ color: "#152238" }}>{fmtDC(ledger.closing)}</td>
                  </tr>
                </tbody>
              </table></div>
            </div>
          ))}
        </div>
      )}

      {tab === "comparatif" && (
        <ComparatifPanel entries={entries} accounts={accounts} planTier={planTier} />
      )}

      {tab === "declarationTCA" && (() => {
        const now = new Date();
        return <DeclarationTCAPanel invoices={invoices} settings={settings} defaultYear={now.getFullYear()} defaultMonth={now.getMonth() + 1} entries={entries} accounts={accounts} planTier={planTier} />;
      })()}

      {tab === "declarationIR" && (
        <DeclarationIRPanel entries={entries} accounts={accounts} invoices={invoices} settings={settings} defaultYear={new Date().getFullYear()} planTier={planTier} />
      )}

      {tab === "ventes" && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
            <div className="text-sm font-semibold mb-4" style={{ color: "#152238" }}>Chiffre d'affaires par mois</div>
            {salesByMonth.length === 0 ? (
              <div className="text-sm py-10 text-center" style={{ color: "#A39C87" }}>Aucune vente enregistrée.</div>
            ) : salesByMonth.length === 1 ? (
              // Un graphique en ligne avec un seul point ne montre qu'un point isolé sans
              // repère — illisible. Tant qu'il n'y a qu'un mois de données, on affiche plutôt
              // le chiffre directement : plus clair, et le graphique reprendra automatiquement
              // dès qu'un deuxième mois de ventes existera.
              <div className="text-center py-6">
                <div className="text-xs uppercase tracking-wide mb-1" style={{ color: "#8A8370" }}>{salesByMonth[0].mois}</div>
                <div className="tabular" style={{ fontSize: 32, fontWeight: 700, color: "#0F6B5C" }}>{fmt(salesByMonth[0].total)}</div>
                <div className="text-xs mt-1" style={{ color: "#A39C87" }}>{salesByMonth[0].count} vente{salesByMonth[0].count > 1 ? "s" : ""} — le graphique d'évolution apparaîtra ici dès qu'un deuxième mois de ventes sera enregistré.</div>
              </div>
            ) : (
              <SimpleLineChart data={salesByMonth} xKey="mois" yKey="total" color="#0F6B5C" name="Chiffre d'affaires" />
            )}
          </div>
          <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div className="text-sm font-semibold" style={{ color: "#152238" }}>Détail des ventes du mois</div>
              {salesByMonth.length > 1 && (
                <select value={effectiveDetailMonth} onChange={(e) => setDetailMonth(e.target.value)}
                  className="border rounded px-2 py-1 text-xs" style={{ borderColor: "#DDD6C4" }}>
                  {salesByMonth.map((m) => <option key={m.mois} value={m.mois}>{m.mois}</option>)}
                </select>
              )}
            </div>
            {salesForDetailMonth.length === 0 ? (
              <div className="text-sm py-10 text-center" style={{ color: "#A39C87" }}>Aucune vente pour ce mois.</div>
            ) : (
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead>
                  <tr className="text-left" style={{ color: "#8A8370", borderBottom: "1px solid #EEE9DA" }}>
                    <th className="py-2 font-normal">Date</th>
                    <th className="py-2 font-normal">N°</th>
                    <th className="py-2 font-normal">Client</th>
                    <th className="py-2 font-normal text-right">Montant</th>
                    <th className="py-2 font-normal text-right">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {salesForDetailMonth.map((inv) => (
                    <tr key={inv.id} style={{ borderBottom: "1px solid #F3EFE3" }}>
                      <td className="py-2 tabular">{inv.date}</td>
                      <td className="py-2 tabular">{inv.number}</td>
                      <td className="py-2">{inv.client}</td>
                      <td className="py-2 tabular text-right">{fmt(inv.total)}</td>
                      <td className="py-2 text-right">
                        <span className="text-xs px-1.5 py-0.5 rounded" style={{
                          background: inv.status === "payée" ? "#E6F1EE" : inv.status === "annulée" ? "#F7E9E3" : "#FBF1DC",
                          color: inv.status === "payée" ? "#0F6B5C" : inv.status === "annulée" ? "#A6432F" : "#9A7B1E",
                        }}>{inv.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>
          <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
            <div className="text-sm font-semibold mb-4" style={{ color: "#152238" }}>Meilleures ventes — répartition du chiffre d'affaires</div>
            {topProducts.length === 0 ? (
              <div className="text-sm py-10 text-center" style={{ color: "#A39C87" }}>Aucune vente enregistrée.</div>
            ) : (
              <SimpleDonutChart data={topProducts} nameKey="name" valueKey="revenue" />
            )}
          </div>
        </div>
      )}

      {tab === "export" && (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
          <div className="bg-white rounded-lg p-5" style={{ border: "1px solid #E4DFD1", minWidth: 0 }}>
            <FileDown size={18} style={{ color: "#0F6B5C" }} className="mb-2" />
            <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Export du journal (CSV)</div>
            <p className="text-xs mb-3" style={{ color: "#8A8370" }}>
              Toutes les écritures du journal, format tableur universel — pour import dans Excel ou un autre logiciel.
            </p>
            <button onClick={exportJournalCSV} className="px-3 py-1.5 rounded text-xs text-white" style={{ background: "#152238" }}>
              Télécharger (.csv)
            </button>
            <p className="text-xs mt-3 pt-3" style={{ color: "#A39C87", borderTop: "1px dashed #EEE9DA" }}>
              Formats conformes aux administrations fiscales d'Haïti (DGI) et du Mexique (SAT — Catálogo de Cuentas, Balanza de Comprobación, Pólizas) prévus pour la version 2.0.
            </p>
          </div>
          <div className="bg-white rounded-lg p-5" style={{ border: "1px solid #E4DFD1", minWidth: 0 }}>
            <FileDown size={18} style={{ color: "#0F6B5C" }} className="mb-2" />
            <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Exports normalisés (cabinet)</div>
            <p className="text-xs mb-3" style={{ color: "#8A8370" }}>
              Journal (avec lettrage et pointage) et balance générale en CSV normalisé pour l'expert-comptable.
            </p>
            <div className="flex gap-2 flex-wrap">
              <button data-ec="rap-journal" onClick={() => { ecDownloadCsv(`journal-normalise-${(settings?.companyName || "export").replace(/\s+/g, "")}-${todayStr()}.csv`, ecCsv(EC_JOURNAL_COLS, ecJournalRows(entries, accounts, settings?.currency))); showToast("Journal normalisé généré."); }} className="px-3 py-1.5 rounded text-xs text-white" style={{ background: "#152238" }}>Journal (.csv)</button>
              <button data-ec="rap-balance" onClick={() => { ecDownloadCsv(`balance-${(settings?.companyName || "export").replace(/\s+/g, "")}-${todayStr()}.csv`, ecCsv(EC_BALANCE_COLS, ecBalanceRows(accounts, entries))); showToast("Balance générée."); }} className="px-3 py-1.5 rounded text-xs text-white" style={{ background: "#152238" }}>Balance (.csv)</button>
            </div>
          </div>
          <div className="bg-white rounded-lg p-5 no-print" style={{ border: "1px solid #E4DFD1", minWidth: 0 }}>
            <Download size={18} style={{ color: "#0F6B5C" }} className="mb-2" />
            <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>États financiers complets (PDF)</div>
            <p className="text-xs mb-3" style={{ color: "#8A8370" }}>
              Compte de résultat, bilan et annexes (méthodes et provisions en cours) réunis en un seul document — prêt à transmettre à une banque ou un tiers.
            </p>
            <button onClick={() => downloadEtatsFinanciersPDF({ settings, produitsAccounts, chargesAccounts, totalProduits, totalCharges, resultat, actifAccounts, passifAccounts, capitauxAccounts, totalActif, totalPassif, notes: notesAnnexes })}
              className="px-3 py-1.5 rounded text-xs text-white" style={{ background: "#152238" }}>
              Télécharger (.pdf)
            </button>
          </div>
          <div className="bg-white rounded-lg p-5 no-print" style={{ border: "1px solid #E4DFD1", minWidth: 0 }}>
            <Download size={18} style={{ color: "#0F6B5C" }} className="mb-2" />
            <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Export PDF par onglet</div>
            <p className="text-xs mb-3" style={{ color: "#8A8370" }}>
              Retournez sur l'onglet souhaité (Compte de résultat, Bilan, Balance, Analyse des ventes) et utilisez le bouton « Télécharger en PDF » en haut de la page — un vrai fichier PDF est généré et téléchargé directement, y compris sur mobile.
            </p>
          </div>
          <div className="text-xs px-4 py-3 rounded" style={{ background: "#FAF8F1", color: "#7A7460", gridColumn: "1 / -1" }}>
            Le bouton « Imprimer » sur chaque onglet reste disponible séparément pour une impression papier classique.
          </div>
        </div>
      )}
    </div>
  );
}

