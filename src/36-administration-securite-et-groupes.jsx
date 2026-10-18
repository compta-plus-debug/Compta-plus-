// Panneau de gestion du code de sécurité partagé de l'entreprise — visible
// uniquement de l'Administrateur principal (contrôlé par le composant appelant).
// Le code lui-même n'est jamais stocké ni transmis en clair : seule son empreinte
// (hachée côté serveur, avec sel) est conservée, via des fonctions RPC dédiées.
function CompanySecurityPinPanel({ companyId, showToast, logAudit }) {
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [showPins, setShowPins] = useState(false);

  const savePin = async () => {
    if (newPin.length < 4) { showToast("Le code doit contenir au moins 4 caractères."); return; }
    if (newPin !== confirmPin) { showToast("Les deux codes saisis ne correspondent pas."); return; }
    setSaving(true);
    const { error } = await supabase.rpc("set_company_pin", { target_company_id: companyId, new_pin: newPin });
    setSaving(false);
    if (error) { showToast(friendlyError(error)); return; }
    setNewPin(""); setConfirmPin("");
    showToast("Code de sécurité de l'entreprise mis à jour — toute l'équipe devra le ressaisir à sa prochaine connexion.");
    logAudit("Administration", "Modification du code de sécurité d'entreprise", "");
  };

  const removePin = async () => {
    if (!window.confirm("Retirer le code de sécurité de l'entreprise ? Plus personne n'aura à le saisir pour accéder à l'entreprise.")) return;
    setSaving(true);
    const { error } = await supabase.rpc("set_company_pin", { target_company_id: companyId, new_pin: null });
    setSaving(false);
    if (error) { showToast(friendlyError(error)); return; }
    showToast("Code de sécurité retiré.");
    logAudit("Administration", "Retrait du code de sécurité d'entreprise", "");
  };

  return (
    <div className="mt-6 p-4 rounded-lg" style={{ background: "#FAF8F1", border: "1px solid #EEE9DA" }}>
      <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Code de sécurité de l'entreprise</div>
      <p className="text-xs mb-3" style={{ color: "#8A8370" }}>
        Réservé à l'Administrateur principal. Un code unique, partagé avec toute l'équipe, requis en plus de la connexion habituelle pour accéder à cette entreprise. Le modifier déconnecte effectivement tout le monde jusqu'à ce qu'ils saisissent le nouveau code.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
        <div className="relative">
          <input type={showPins ? "text" : "password"} value={newPin} onChange={(e) => setNewPin(e.target.value)}
            placeholder="Nouveau code (4 caractères min.)"
            className="border rounded px-2 py-1.5 pr-8 text-sm w-full" style={{ borderColor: "#DDD6C4" }} />
        </div>
        <div className="relative">
          <input type={showPins ? "text" : "password"} value={confirmPin} onChange={(e) => setConfirmPin(e.target.value)}
            placeholder="Confirmer le code"
            className="border rounded px-2 py-1.5 pr-8 text-sm w-full" style={{ borderColor: "#DDD6C4" }} />
          <button type="button" onClick={() => setShowPins((v) => !v)}
            title={showPins ? "Masquer les codes" : "Afficher les codes pour vérifier qu'ils correspondent"}
            className="absolute right-2 top-1/2 -translate-y-1/2" style={{ color: "#8A8370" }}>
            {showPins ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={savePin} disabled={saving} className="text-xs px-3 py-1.5 rounded text-white" style={{ background: "#152238" }}>
          {saving ? "Enregistrement…" : "Définir / changer le code"}
        </button>
        <button onClick={removePin} disabled={saving} className="text-xs px-3 py-1.5 rounded" style={{ border: "1px solid #A6432F", color: "#A6432F" }}>
          Retirer le code
        </button>
      </div>
    </div>
  );
}

// Carte "Imprimante Bluetooth" — permet de jumeler une mini-imprimante thermique
// (ex. GOOJPRT PT-210) directement depuis le navigateur, sans appli tierce. Une
// fois connectée pour cette session, le bouton "Imprimer (Bluetooth)" des factures
// fonctionne directement.
function BluetoothPrinterCard({ showToast, settings, compact }) {
  const [connected, setConnected] = useState(isThermalPrinterConnected());
  const [printerName, setPrinterName] = useState(getRememberedPrinterName());
  const [busy, setBusy] = useState(false);
  const supported = !!navigator.bluetooth;

  const handleConnect = async () => {
    setBusy(true);
    try {
      const name = await connectThermalPrinter();
      setPrinterName(name);
      setConnected(true);
      showToast("Imprimante « " + name + " » connectée.");
    } catch (e) {
      if (e && e.name !== "NotFoundError") { // l'utilisateur a juste fermé la liste sans choisir — pas une vraie erreur
        showToast("Connexion à l\'imprimante impossible. Vérifiez qu\'elle est allumée et à portée, puis réessayez.");
      }
    }
    setBusy(false);
  };
  const handleDisconnect = () => {
    disconnectThermalPrinter();
    setConnected(false);
    showToast("Imprimante déconnectée.");
  };
  const handleTest = async () => {
    setBusy(true);
    const testInvoice = {
      number: "TEST", date: todayStr(), client: "Client test",
      lines: [{ name: "Article de test", qty: 1, price: 100, subtotal: 100 }],
      totalHT: 100, totalTax: 0, total: 100, taxLabel: "Taxe", paymentMode: "caisse", payments: [],
    };
    await printInvoiceBluetooth(testInvoice, settings, showToast);
    setBusy(false);
  };

  if (compact) {
    if (!supported) return null; // évite d'encombrer l'écran de vente sur un appareil incompatible
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: connected ? "#0F6B5C" : "#DDD6C4" }} />
        <span className="text-xs shrink-0" style={{ color: "#7A7460" }}>
          {connected ? `Imprimante : ${printerName}` : "Imprimante Bluetooth non connectée"}
        </span>
        {!connected ? (
          <button onClick={handleConnect} disabled={busy} className="flex items-center gap-1 text-xs underline" style={{ color: "#152238" }}>
            <BluetoothIcon size={12} /> {busy ? "Connexion…" : "Connecter"}
          </button>
        ) : (
          <button onClick={handleDisconnect} className="flex items-center gap-1 text-xs underline" style={{ color: "#7A7460" }}>
            Déconnecter
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
      <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Imprimante Bluetooth (mini-imprimante thermique)</div>
      <p className="text-xs mb-4" style={{ color: "#8A8370" }}>
        Connecte directement l'application à une mini-imprimante Bluetooth (ex. GOOJPRT PT-210) — aucune appli tierce à installer. La connexion doit être refaite si la page est rechargée ou le navigateur fermé. Fonctionne sur Chrome/Edge Android — pas sur Safari/iPhone. Chaque vendeur connecte sa propre imprimante depuis l'onglet Point de vente ; ce panneau ici sert surtout à faire un test.
      </p>
      {!supported && (
        <p className="text-xs mb-3" style={{ color: "#A6432F" }}>Bluetooth non disponible dans ce navigateur sur cet appareil.</p>
      )}
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full" style={{ background: connected ? "#0F6B5C" : "#DDD6C4" }} />
        <span className="text-xs" style={{ color: "#7A7460" }}>
          {connected ? `Connectée : ${printerName}` : printerName ? `Non connectée (dernière utilisée : ${printerName})` : "Aucune imprimante connectée"}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {!connected ? (
          <button onClick={handleConnect} disabled={!supported || busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-white" style={{ background: "#152238" }}>
            <BluetoothIcon size={13} /> {busy ? "Connexion…" : "Connecter l'imprimante"}
          </button>
        ) : (
          <>
            <button onClick={handleTest} disabled={busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-white" style={{ background: "#152238" }}>
              <Printer size={13} /> Imprimer un ticket de test
            </button>
            <button onClick={handleDisconnect} className="px-3 py-1.5 rounded text-xs" style={{ border: "1px solid #DDD6C4", color: "#7A7460" }}>
              Déconnecter
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// Gestion des postes de vente distincts (ex. "Caisse 1", "Caisse 2") — fonctionnalité
// réservée au forfait Assisté. Chaque poste est identifié par l'appareil lui-même
// (pas ce panneau), dans l'onglet Point de vente. En plus de son nom, chaque poste
// porte deux listes indépendantes gérées ici : des noms de vendeurs et des emails
// qui lui sont affiliés — un seul de chaque étant "actif" à la fois (celui qui
// s'applique aux ventes en cours sur ce poste). Un Administrateur (non principal)
// peut ajouter des noms/emails et changer lequel est actif, mais seul
// l'Administrateur principal peut en retirer.
function SalesStationsPanel({ salesStations, setSalesStations, showToast, logAudit, isPrimaryAdmin }) {
  const [newName, setNewName] = useState("");
  const [newSellerName, setNewSellerName] = useState({});
  const [newSellerEmail, setNewSellerEmail] = useState({});

  const addStation = () => {
    const name = newName.trim();
    if (!name) return;
    if (salesStations.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      showToast("Un poste porte déjà ce nom.");
      return;
    }
    setSalesStations((prev) => [...prev, { id: uid(), name, sellerNames: [], activeSellerName: null, sellerEmails: [], activeSellerEmail: null }]);
    logAudit("Administration", "Ajout d'un poste de vente", name);
    setNewName("");
  };
  const renameStation = (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSalesStations((prev) => prev.map((s) => (s.id === id ? { ...s, name: trimmed } : s)));
  };
  const removeStation = (station) => {
    if (!isPrimaryAdmin) { showToast("Seul l'administrateur principal peut retirer un poste de vente."); return; }
    if (!window.confirm(`Retirer le poste « ${station.name} » ? Les ventes déjà enregistrées sous ce nom resteront visibles dans les rapports passés.`)) return;
    setSalesStations((prev) => prev.filter((s) => s.id !== station.id));
    logAudit("Administration", "Retrait d'un poste de vente", station.name);
  };

  const addSellerName = (station) => {
    const name = (newSellerName[station.id] || "").trim();
    if (!name) return;
    if ((station.sellerNames || []).some((n) => n.toLowerCase() === name.toLowerCase())) { showToast("Ce nom est déjà dans la liste."); return; }
    // Un seul vendeur par poste : la responsabilité de la caisse doit rester claire.
    if ((station.sellerNames || []).length >= 1) {
      showToast(`Le poste « ${station.name} » est déjà attribué à ${station.sellerNames[0]}. Un seul vendeur par poste : retirez d'abord ce vendeur avant d'en assigner un autre.`);
      return;
    }
    const nameTaken = salesStations.find((st) => st.id !== station.id && (st.sellerNames || []).some((n) => n.toLowerCase() === name.toLowerCase()));
    if (nameTaken) { showToast(`« ${name} » est déjà assigné au poste « ${nameTaken.name} ». Un vendeur ne peut tenir qu'un seul poste.`); return; }
    setSalesStations((prev) => prev.map((s) => (s.id === station.id
      ? { ...s, sellerNames: [...(s.sellerNames || []), name], activeSellerName: s.activeSellerName || name }
      : s)));
    setNewSellerName((prev) => ({ ...prev, [station.id]: "" }));
  };
  const removeSellerName = (station, name) => {
    if (!isPrimaryAdmin) { showToast("Seul l'administrateur principal peut retirer un nom de vendeur."); return; }
    setSalesStations((prev) => prev.map((s) => (s.id === station.id
      ? { ...s, sellerNames: (s.sellerNames || []).filter((n) => n !== name), activeSellerName: s.activeSellerName === name ? null : s.activeSellerName }
      : s)));
  };
  const addSellerEmail = (station) => {
    const email = (newSellerEmail[station.id] || "").trim();
    if (!email) return;
    if ((station.sellerEmails || []).some((e) => e.toLowerCase() === email.toLowerCase())) { showToast("Cet email est déjà dans la liste."); return; }
    // Un seul vendeur par poste : la responsabilité de la caisse doit rester claire.
    if ((station.sellerEmails || []).length >= 1) {
      showToast(`Le poste « ${station.name} » est déjà attribué à ${station.sellerEmails[0]}. Un seul vendeur par poste : retirez d'abord ce vendeur avant d'en assigner un autre.`);
      return;
    }
    const emailTaken = salesStations.find((st) => st.id !== station.id && (st.sellerEmails || []).some((e) => e.toLowerCase() === email.toLowerCase()));
    if (emailTaken) { showToast(`${email} est déjà assigné au poste « ${emailTaken.name} ». Un vendeur ne peut tenir qu'un seul poste.`); return; }
    setSalesStations((prev) => prev.map((s) => (s.id === station.id
      ? { ...s, sellerEmails: [...(s.sellerEmails || []), email], activeSellerEmail: s.activeSellerEmail || email }
      : s)));
    setNewSellerEmail((prev) => ({ ...prev, [station.id]: "" }));
  };
  const removeSellerEmail = (station, email) => {
    if (!isPrimaryAdmin) { showToast("Seul l'administrateur principal peut retirer un email."); return; }
    setSalesStations((prev) => prev.map((s) => (s.id === station.id
      ? { ...s, sellerEmails: (s.sellerEmails || []).filter((e) => e !== email), activeSellerEmail: s.activeSellerEmail === email ? null : s.activeSellerEmail }
      : s)));
  };

  return (
    <div className="space-y-6 max-w-md">
      <div className="bg-white rounded-lg p-6" style={{ border: "1px solid #E4DFD1" }}>
        <div className="text-sm font-medium mb-1" style={{ color: "#152238" }}>Postes de vente</div>
        <p className="text-xs mb-4" style={{ color: "#8A8370" }}>
          Créez un poste par caisse ou comptoir (ex. « Caisse 1 », « Comptoir »). Chaque poste n'a qu'UN SEUL vendeur, assigné ici par son email (et, si vous le souhaitez, son nom pour la fiche de vente) : un vendeur ne peut tenir qu'un poste, et un poste n'a qu'un vendeur. Le vendeur ne choisit pas lui-même son poste.
        </p>
        <div className="flex gap-2 mb-4">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addStation()}
            placeholder="Nom du nouveau poste" className="flex-1 border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#DDD6C4" }} />
          <button onClick={addStation} className="px-3 py-1.5 rounded text-xs text-white shrink-0" style={{ background: "#152238" }}>Ajouter</button>
        </div>
        {salesStations.length === 0 ? (
          <div className="text-xs py-4 text-center" style={{ color: "#A39C87" }}>Aucun poste créé — tant qu'aucun poste n'existe, les ventes fonctionnent normalement sans distinction.</div>
        ) : (
          <div className="space-y-4">
            {salesStations.map((s) => (
              <div key={s.id} className="p-3 rounded" style={{ border: "1px solid #EEE9DA" }}>
                <div className="flex items-center gap-2 mb-3">
                  <input defaultValue={s.name} onBlur={(e) => renameStation(s.id, e.target.value)}
                    className="flex-1 border rounded px-2 py-1.5 text-sm font-medium" style={{ borderColor: "#DDD6C4" }} />
                  <button onClick={() => removeStation(s)} className="p-1.5 rounded" style={{ color: "#A6432F" }}><Trash2 size={14} /></button>
                </div>

                {((s.sellerNames || []).length > 1 || (s.sellerEmails || []).length > 1) && (
                  <div className="text-xs rounded px-2 py-1.5 mb-3" style={{ background: "#F7E9E3", color: "#A6432F" }} data-testid="station-multi-warning">
                    Ce poste a plusieurs vendeurs : ce n'est plus permis. Retirez-en pour n'en garder qu'un seul, afin de savoir qui répond de la caisse.
                  </div>
                )}
                <div className="text-xs font-medium mb-1" style={{ color: "#7A7460" }}>Noms de vendeurs affiliés</div>
                <div className="space-y-1 mb-2">
                  {(s.sellerNames || []).length === 0 && <div className="text-xs" style={{ color: "#A39C87" }}>Aucun nom — la fiche de vente n'affichera aucun vendeur.</div>}
                  {(s.sellerNames || []).map((name) => (
                    <div key={name} className="flex items-center gap-2 text-xs min-w-0">
                      <input type="radio" checked={s.activeSellerName === name} className="shrink-0"
                        onChange={() => setSalesStations((prev) => prev.map((st) => (st.id === s.id ? { ...st, activeSellerName: name } : st)))} />
                      <span className={`min-w-0 flex-1 truncate ${s.activeSellerName === name ? "font-medium" : ""}`} style={{ color: "#152238" }} title={name}>{name}</span>
                      {s.activeSellerName === name && <span className="text-xs px-1.5 rounded shrink-0" style={{ background: "#E6F1EE", color: "#0F6B5C" }}>actif</span>}
                      <button onClick={() => removeSellerName(s, name)} className="shrink-0" style={{ color: "#A6432F" }}><Trash2 size={12} /></button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 mb-3">
                  <input value={newSellerName[s.id] || ""} onChange={(e) => setNewSellerName((prev) => ({ ...prev, [s.id]: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && addSellerName(s)}
                    placeholder="Nom du vendeur" className="flex-1 border rounded px-2 py-1 text-xs" style={{ borderColor: "#DDD6C4" }} />
                  <button onClick={() => addSellerName(s)} className="px-2 py-1 rounded text-xs text-white shrink-0" style={{ background: "#152238" }}>Ajouter</button>
                </div>

                <div className="text-xs font-medium mb-1" style={{ color: "#7A7460" }}>Emails affiliés</div>
                <div className="space-y-1 mb-2">
                  {(s.sellerEmails || []).length === 0 && <div className="text-xs" style={{ color: "#A39C87" }}>Aucun email affilié.</div>}
                  {(s.sellerEmails || []).map((email) => (
                    <div key={email} className="flex items-center gap-2 text-xs min-w-0">
                      <input type="radio" checked={s.activeSellerEmail === email} className="shrink-0"
                        onChange={() => setSalesStations((prev) => prev.map((st) => (st.id === s.id ? { ...st, activeSellerEmail: email } : st)))} />
                      <span className={`min-w-0 flex-1 truncate ${s.activeSellerEmail === email ? "font-medium" : ""}`} style={{ color: "#152238" }} title={email}>{email}</span>
                      {s.activeSellerEmail === email && <span className="text-xs px-1.5 rounded shrink-0" style={{ background: "#E6F1EE", color: "#0F6B5C" }}>actif</span>}
                      <button onClick={() => removeSellerEmail(s, email)} className="shrink-0" style={{ color: "#A6432F" }}><Trash2 size={12} /></button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input value={newSellerEmail[s.id] || ""} onChange={(e) => setNewSellerEmail((prev) => ({ ...prev, [s.id]: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && addSellerEmail(s)}
                    placeholder="Email du vendeur" className="flex-1 border rounded px-2 py-1 text-xs" style={{ borderColor: "#DDD6C4" }} />
                  <button onClick={() => addSellerEmail(s)} className="px-2 py-1 rounded text-xs text-white shrink-0" style={{ background: "#152238" }}>Ajouter</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Groupe multi-entreprises : création et aperçu, depuis Administration ---
function CompanyGroupPanel({ companyId, groupId, groupName, groupMaxCompanies, showToast }) {
  const [siblings, setSiblings] = useState(null);
  const [searchName, setSearchName] = useState("");
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [sendingRequestFor, setSendingRequestFor] = useState(null);
  const [myRequests, setMyRequests] = useState([]);

  useEffect(() => {
    if (!groupId) return;
    supabase.from("companies").select("id, name").eq("group_id", groupId).order("created_at", { ascending: true })
      .then(({ data, error }) => { if (!error) setSiblings(data || []); });
  }, [groupId]);

  const loadMyRequests = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from("group_join_requests").select("id, group_id, group_name, status, created_at").eq("company_id", companyId).eq("requested_by_user_id", user.id).order("created_at", { ascending: false });
    setMyRequests(data || []);
  };
  useEffect(() => { loadMyRequests(); }, [groupId]);

  const searchGroups = async () => {
    if (searchName.trim().length < 2) { showToast("Entrez au moins 2 caractères."); return; }
    setSearching(true);
    const { data, error } = await invokeEdgeFunction("search-groups-by-name", { name: searchName.trim() });
    setSearching(false);
    if (error) { showToast(friendlyError(error)); return; }
    setSearchResults(data.results || []);
  };

  const sendJoinRequest = async (group) => {
    setSendingRequestFor(group.id);
    const { error } = await invokeEdgeFunction("request-join-group", { groupId: group.id, companyId });
    setSendingRequestFor(null);
    if (error) { showToast(friendlyError(error)); return; }
    showToast(`Demande envoyée à « ${group.name} ».`);
    setSearchResults(null); setSearchName("");
    loadMyRequests();
  };

  // La création d'un groupe n'est jamais en libre-service — comme pour le
  // passage au forfait Assisté, c'est une action manuelle effectuée depuis le
  // Centre de gestion, jamais directement accessible à l'entreprise elle-même.
  // En revanche, DEMANDER à rejoindre le groupe de quelqu'un d'autre (ex. un
  // franchisé rejoignant le groupe de son franchiseur) est bien en libre-service
  // — sous réserve de l'acceptation explicite du propriétaire de ce groupe.
  if (!groupId) {
    const pendingReq = myRequests.find((r) => r.status === "pending");
    const lastDeclined = !pendingReq ? myRequests.find((r) => r.status === "declined") : null;
    return (
      <div className="mt-4 p-4 rounded-lg" style={{ border: "1px solid #E4DFD1" }}>
        <div className="text-sm font-semibold mb-1" style={{ color: "#152238" }}>Groupe d'entreprises</div>
        <p className="text-xs mb-3" style={{ color: "#7A7460" }}>
          Si vous possédez plusieurs entreprises (succursales d'une même franchise, ou commerces distincts), regroupez-les sous un seul abonnement — chacune garde sa propre gestion complètement séparée, mais vous obtenez un tableau de bord consolidé et des comparatifs entre elles. Contactez le support (Centre d'aide, dans le menu latéral) pour mettre ça en place.
        </p>

        <div className="pt-3" style={{ borderTop: "1px solid #EEE9DA" }}>
          <div className="text-xs font-medium mb-1" style={{ color: "#152238" }}>Rejoindre le groupe de quelqu'un d'autre</div>
          <p className="text-xs mb-2" style={{ color: "#A39C87" }}>Si une autre personne possède déjà un groupe (ex. votre franchiseur) et que vous souhaitez y rattacher cette entreprise, recherchez-le par son nom. Le propriétaire du groupe devra accepter votre demande.</p>

          {lastDeclined && (
            <p className="text-xs p-2 rounded mb-2" style={{ background: "#F7E9E3", color: "#A6432F" }}>Votre demande pour rejoindre « {lastDeclined.group_name} » a été refusée. Vous pouvez essayer un autre groupe ci-dessous.</p>
          )}

          {pendingReq ? (
            <p className="text-xs p-2 rounded" style={{ background: "#FBF1DC", color: "#9A7B1E" }}>Demande envoyée, en attente de réponse du propriétaire du groupe.</p>
          ) : (
            <>
              <div className="flex gap-2 flex-wrap">
                <input value={searchName} onChange={(e) => setSearchName(e.target.value)} placeholder="Nom du groupe à rejoindre"
                  className="flex-1 border rounded px-3 py-2 text-sm" style={{ borderColor: "#DDD6C4", minWidth: 180 }} />
                <button onClick={searchGroups} disabled={searching} className="text-xs px-3 py-2 rounded text-white shrink-0" style={{ background: "#152238", opacity: searching ? 0.5 : 1 }}>
                  {searching ? "Recherche..." : "Rechercher"}
                </button>
              </div>
              {searchResults !== null && (
                searchResults.length === 0 ? (
                  <p className="text-xs mt-2" style={{ color: "#A39C87" }}>Aucun groupe trouvé avec ce nom.</p>
                ) : (
                  <div className="mt-2 space-y-1.5">
                    {searchResults.map((g) => (
                      <div key={g.id} className="flex items-center justify-between gap-2 p-2 rounded text-xs" style={{ background: "#FAF8F1" }}>
                        <span style={{ color: "#152238" }}>{g.name}</span>
                        <button onClick={() => sendJoinRequest(g)} disabled={sendingRequestFor === g.id}
                          className="px-2 py-1 rounded text-white shrink-0" style={{ background: "#152238", opacity: sendingRequestFor === g.id ? 0.5 : 1 }}>
                          {sendingRequestFor === g.id ? "Envoi..." : "Demander à rejoindre"}
                        </button>
                      </div>
                    ))}
                  </div>
                )
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  const acceptedViaRequest = myRequests.find((r) => r.group_id === groupId && r.status === "accepted");
  return (
    <div className="mt-4 p-4 rounded-lg" style={{ border: "1px solid #E4DFD1" }}>
      {acceptedViaRequest && (
        <p className="text-xs p-2 rounded mb-3" style={{ background: "#E6F1EE", color: "#0F6B5C" }}>Votre demande pour rejoindre « {groupName} » a été acceptée !</p>
      )}
      <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
        <div className="text-sm font-semibold" style={{ color: "#152238" }}>Groupe — {groupName}</div>
        <span className="text-xs" style={{ color: "#A39C87" }}>{siblings ? siblings.length : "…"} / {groupMaxCompanies || 5} entreprises</span>
      </div>
      <div className="space-y-1.5">
        {(siblings || []).map((s) => (
          <div key={s.id} className="text-xs p-2 rounded" style={{ background: s.id === companyId ? "#E8EAF0" : "#FAF8F1", color: "#152238" }}>
            {s.name}{s.id === companyId ? " (celle-ci)" : ""}
          </div>
        ))}
      </div>
      <p className="text-xs mt-2" style={{ color: "#A39C87" }}>Gérez le groupe (ajouter une entreprise, voir les comparatifs) depuis "Groupe — {groupName}" dans le menu latéral.</p>
    </div>
  );
}

