// v320 — Messagerie interne de l'équipe + fiches de procédures (2FA, clôture, réouverture), dans Super Admin et dans le Centre de gestion.
const {chromium}=require('playwright');const {boot}=require('./tst-harness.cjs');
let fails=0;const ok=(n,c,i)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(i)));if(!c)fails++};
const g=(p,t)=>p.locator('[data-testid="'+t+'"]');
const txt=p=>p.evaluate(()=>document.body.innerText);
const toast=async(p,re)=>{try{await p.getByText(re).first().waitFor({timeout:3000});return true;}catch(e){return false;}};
const base=()=>{if(!crypto.randomUUID)crypto.randomUUID=function(){return 'g'+Math.random().toString(36).slice(2)};const S=window.__srv;
 S.tables.platform_admins=[{email:'a@x.com'}];S.tables.superadmin_log=[];S.tables.billing_settings=[];S.tables.billing_invoices=[];S.tables.company_groups=[];
 S.tables.management_collaborators=[{id:'m1',email:'b@x.com',role:'support',permissions:{entreprises:true}}];
 S.tables.team_threads=[{id:'t1',subject:'Client X ne reçoit pas son lien',kind:'signalement',priority:'haute',status:'ouvert',assigned_email:'__admin__',created_by_email:'b@x.com',created_at:'2026-11-03T09:00:00Z',updated_at:'2026-11-03T10:00:00Z',last_message_by:'b@x.com'}];
 S.tables.team_messages=[{id:'mm1',thread_id:'t1',author_email:'b@x.com',body:'Le client X dit ne pas recevoir le lien magique.',created_at:'2026-11-03T10:00:00Z'}];
 S.tables.team_thread_reads=[];S.tables.procedure_runs=[];
 S.tables.companies=[{id:'c1',name:'Lakay SA',plan_status:'active',plan_tier:'standard',trial_ends_at:null,created_at:'2025-01-01T00:00:00Z',sectors:[],extra_blocks:[]}];
 S.tables.company_members=[{id:7,company_id:'c1',email:'a@x.com',role:'Administrateur',user_id:'u1',is_primary_admin:true,created_at:'2026-01-01'}];};
const goSA=async p=>{await p.getByText('Super Admin',{exact:false}).first().click();await p.waitForTimeout(900);await g(p,'sa-group-equipe').click();};
(async()=>{const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
{const {p,errs}=await boot(b,{settings:{companyName:'X'},primary:true,pageInit:new Function('('+base.toString()+')()')});
 await p.getByText('Super Admin',{exact:false}).first().click();await p.waitForTimeout(1200);
 ok('groupe « Équipe » présent dans Super Admin',await g(p,'sa-group-equipe').count()===1);
 await g(p,'sa-group-equipe').click();await p.waitForTimeout(600);
 ok('onglet affiche « (1) »',/Messagerie interne \(1\)/.test(await g(p,'sa-subtabs').innerText()),await g(p,'sa-subtabs').innerText());
 ok('liste : 1 fil, non lu, à mon attention, priorité haute',await g(p,'tm-fil').count()===1&&await g(p,'tm-nonlu').count()===1&&await g(p,'tm-pourmoi').count()===1&&/Haute/.test(await g(p,'tm-liste').innerText()));
 await g(p,'tm-fil').click();await p.waitForTimeout(600);
 ok('ouverture : le message est lisible',/ne pas recevoir le lien magique/.test(await g(p,'tm-messages').innerText()));
 ok('lecture enregistrée (marqué lu pour a@x.com)',await p.evaluate(()=>window.__srv.tables.team_thread_reads.some(r=>r.thread_id==='t1'&&r.user_email==='a@x.com')));
 await p.waitForTimeout(500);
 ok('badge disparu après lecture',!/Messagerie interne \(/.test(await g(p,'sa-subtabs').innerText()),await g(p,'sa-subtabs').innerText());
 // réponse
 await g(p,'tm-reponse').fill('Merci, je vérifie la boîte de réception du client.');await g(p,'tm-envoyer').click();await p.waitForTimeout(700);
 const st=await p.evaluate(()=>({m:window.__srv.tables.team_messages.filter(x=>x.thread_id==='t1'),t:window.__srv.tables.team_threads[0]}));
 ok('réponse enregistrée avec auteur et fil mis à jour',st.m.length===2&&st.m[1].author_email==='a@x.com'&&st.t.last_message_by==='a@x.com',st);
 ok('la réponse apparaît dans le fil (« Vous »)',(await g(p,'tm-message').count())===2&&/Vous/.test(await g(p,'tm-messages').innerText()));
 // nouveau fil
 await g(p,'tm-nouveau').click();await g(p,'tm-creer').click();
 ok('nouveau fil sans sujet : refusé',await toast(p,/Indiquez un sujet/)&&await p.evaluate(()=>window.__srv.tables.team_threads.length)===1);
 await g(p,'tm-sujet').fill('Consigne : relances du lundi');await g(p,'tm-creer').click();
 ok('nouveau fil sans message : refusé',await toast(p,/Écrivez le message/));
 await g(p,'tm-type').selectOption('consigne');await g(p,'tm-dest').selectOption('b@x.com');await g(p,'tm-corps').fill('Merci de relancer les factures en retard avant mardi.');await g(p,'tm-creer').click();await p.waitForTimeout(900);
 const nt=await p.evaluate(()=>window.__srv.tables.team_threads.find(t=>t.subject.startsWith('Consigne')));
 ok('consigne créée, destinée à b@x.com, auteur a@x.com',!!nt&&nt.kind==='consigne'&&nt.assigned_email==='b@x.com'&&nt.created_by_email==='a@x.com',nt);
 ok('premier message enregistré',await p.evaluate((id)=>window.__srv.tables.team_messages.some(m=>m.thread_id===id&&/relancer/.test(m.body)),nt&&nt.id));
 // clôture / filtres
 await g(p,'tm-clore').click();await p.waitForTimeout(600);
 const closed=await p.evaluate((id)=>window.__srv.tables.team_threads.find(t=>t.id===id),nt.id);
 ok('fil clos : statut, date et auteur de clôture',closed.status==='clos'&&closed.closed_by_email==='a@x.com'&&!!closed.closed_at,closed);
 ok('fil clos : plus de zone de réponse',await g(p,'tm-reponse').count()===0);
 await g(p,'tm-filtre-ouverts').click();ok('filtre « ouverts » : la consigne close n\'y est plus',!/relances du lundi/.test(await g(p,'tm-liste').innerText()));
 await g(p,'tm-filtre-clos').click();ok('filtre « clos » : la consigne y est',/relances du lundi/.test(await g(p,'tm-liste').innerText()));
 await g(p,'tm-rouvrir').click();await p.waitForTimeout(500);
 ok('rouvrir remet le fil en cours',await p.evaluate((id)=>window.__srv.tables.team_threads.find(t=>t.id===id).status,nt.id)==='ouvert');
 // un collaborateur répond : redevient non lu
 await p.evaluate(()=>{const S=window.__srv;S.tables.team_messages.push({id:'mm9',thread_id:'t1',author_email:'b@x.com',body:'Le client a bien reçu le lien finalement.',created_at:'2026-11-04T12:00:00Z'});const t=S.tables.team_threads.find(x=>x.id==='t1');t.updated_at='2099-01-01T00:00:00Z';t.last_message_by='b@x.com';});
 await g(p,'sa-tab-equipe_procedures').click();await p.waitForTimeout(400);
 await p.evaluate(()=>window.dispatchEvent(new Event('compta-plus-team-read')));await p.waitForTimeout(600);
 ok('nouveau message d\'un collaborateur : badge à nouveau',/Messagerie interne \(1\)/.test(await g(p,'sa-subtabs').innerText()),await g(p,'sa-subtabs').innerText());
 await g(p,'sa-tab-equipe_messages').click();await p.waitForTimeout(500);
 ok('fil de nouveau marqué non lu',await g(p,'tm-nonlu').count()===1);
 ok('aucune erreur de page (messagerie)',errs.length===0,errs);

 // ───── Procédures
 await g(p,'sa-tab-equipe_procedures').click();await p.waitForTimeout(500);
 ok('3 procédures présentées',(await p.locator('[data-testid^="pr-ouvrir-"]').count())===3);
 await g(p,'pr-lire-2fa').click();
 const regle=await g(p,'pr-regle-2fa').innerText();
 ok('règle 2FA lisible : délai de 24 heures, interdits, modèles',/24 heures/.test(regle)&&/Interdits/.test(regle)&&/STOP/.test(regle)&&/Signaux d'alerte/.test(regle),regle.slice(0,200));
 await g(p,'pr-ouvrir-2fa').click();await g(p,'pr-f-creer').click();
 ok('fiche sans entreprise : refusée',await toast(p,/Indiquez l'entreprise/));
 await g(p,'pr-f-entreprise').fill('Boutique Lakay');await g(p,'pr-f-creer').click();
 ok('fiche 2FA sans e-mail d\'origine : refusée',await toast(p,/adresse e-mail d'origine/));
 await g(p,'pr-f-email').fill('client@boutique.ht');await g(p,'pr-f-creer').click();await p.waitForTimeout(800);
 let r=await p.evaluate(()=>window.__srv.tables.procedure_runs[0]);
 const yr=new Date().getFullYear();
 ok('fiche ouverte : référence '+yr+'-001, en cours, étapes 1 et 2 consignées',r&&r.reference===yr+'-001'&&r.status==='en_cours'&&!!r.data.steps.s1&&!!r.data.steps.s2&&r.opened_by==='a@x.com',r);
 await g(p,'pr-alerte').click();
 ok('alerte sans preuves vérifiées : refusée',await toast(p,/Vérifiez d'abord les deux preuves/));
 await g(p,'pr-etape-s3').check();await p.waitForTimeout(400);
 await g(p,'pr-alerte').click();await p.waitForTimeout(600);
 r=await p.evaluate(()=>window.__srv.tables.procedure_runs[0]);
 ok('alerte envoyée : heure enregistrée et délai de 24 h affiché',!!r.data.alert_sent_at&&/encore 2[34] h/.test(await g(p,'pr-delai').innerText())&&/sur 24 h/.test(await g(p,'pr-delai').innerText()),await g(p,'pr-delai').innerText());
 ok('le signal d\'alerte ne se modifie plus après l\'envoi',await g(p,'pr-sig-urgence').isDisabled());
 await g(p,'pr-terminer').click();
 ok('réinitialisation avant la fin du délai : refusée',await toast(p,/délai d'attente n'est pas écoulé/)&&await p.evaluate(()=>window.__srv.tables.procedure_runs[0].status)==='en_cours');
 ok('étape « délai écoulé » non cochable à la main',await g(p,'pr-etape-s5').isDisabled()&&!(await g(p,'pr-etape-s5').isChecked()));
 // délai écoulé : on recule l'heure de l'alerte de 25 h, puis on recharge la fiche
 await p.evaluate(()=>{window.__srv.tables.procedure_runs[0].data.alert_sent_at=new Date(Date.now()-25*3600000).toISOString();});
 await p.getByText('Retour').first().click();await p.waitForTimeout(300);await g(p,'pr-ligne').first().click();await p.waitForTimeout(500);
 ok('après 25 h : délai écoulé, étape 5 cochée automatiquement',/Délai écoulé/.test(await g(p,'pr-delai').innerText())&&await g(p,'pr-etape-s5').isChecked());
 await g(p,'pr-terminer').click();
 ok('étapes 7 et 8 manquantes : refusé',await toast(p,/Étapes manquantes/)&&await p.evaluate(()=>window.__srv.tables.procedure_runs[0].status)==='en_cours');
 await g(p,'pr-stop').check();await p.waitForTimeout(300);await g(p,'pr-etape-s7').check();await g(p,'pr-etape-s8').check();await p.waitForTimeout(300);
 await g(p,'pr-terminer').click();
 ok('réponse STOP reçue : réinitialisation interdite',await toast(p,/STOP a été reçue/)&&await p.evaluate(()=>window.__srv.tables.procedure_runs[0].status)==='en_cours');
 await g(p,'pr-stop').uncheck();await p.waitForTimeout(300);
 await g(p,'pr-forts-enjeux').check();await p.waitForTimeout(300);await g(p,'pr-terminer').click();
 ok('compte à forts enjeux sans second validateur : refusé',await toast(p,/Second validateur/));
 await g(p,'pr-etape-s6').check();await p.waitForTimeout(300);await g(p,'pr-terminer').click();await p.waitForTimeout(700);
 r=await p.evaluate(()=>window.__srv.tables.procedure_runs[0]);
 ok('fiche terminée : statut, auteur et date de clôture',r.status==='termine'&&r.closed_by==='a@x.com'&&!!r.closed_at,r);
 ok('fiche close : cases verrouillées',await g(p,'pr-etape-s3').isDisabled());
 // 2e fiche : signal d'alerte => 72 h ; refus ; tentative suspecte
 await p.getByText('Retour').first().click();await p.waitForTimeout(300);
 await g(p,'pr-ouvrir-2fa').click();await g(p,'pr-f-entreprise').fill('Pharmacie Nord');await g(p,'pr-f-email').fill('p@nord.ht');await g(p,'pr-f-creer').click();await p.waitForTimeout(700);
 await g(p,'pr-sig-urgence').check();await p.waitForTimeout(300);await g(p,'pr-etape-s3').check();await p.waitForTimeout(300);await g(p,'pr-alerte').click();await p.waitForTimeout(500);
 ok('signal d\'alerte coché : délai porté à 72 h',/sur 72 h/.test(await g(p,'pr-delai').innerText()),await g(p,'pr-delai').innerText());
 await g(p,'pr-suspect').click();
 ok('tentative suspecte sans remarque : refusée',await toast(p,/Notez la raison/));
 await g(p,'pr-note').fill('Demande pressante, adresse différente.');await g(p,'pr-note').blur();await p.waitForTimeout(300);await g(p,'pr-suspect').click();await p.waitForTimeout(600);
 r=await p.evaluate(()=>window.__srv.tables.procedure_runs[1]);
 ok('clôturée comme tentative suspecte avec remarque',r.status==='suspect'&&/pressante/.test(r.data.note),r);
 ok('référence suivante '+yr+'-002',r.reference===yr+'-002');
 await p.getByText('Retour').first().click();await p.waitForTimeout(300);
 await g(p,'pr-filtre-en_cours').click();ok('registre « en cours » : vide',await g(p,'pr-vide').count()===1);
 await g(p,'pr-filtre-closes').click();ok('registre « closes » : 2 fiches',(await g(p,'pr-ligne').count())===2);
 // Clôture de période
 await g(p,'pr-ouvrir-cloture').click();await g(p,'pr-f-entreprise').fill('Lakay SA');await g(p,'pr-f-creer').click();await p.waitForTimeout(700);
 await g(p,'pr-periode').fill('Mensuelle — octobre 2026');await g(p,'pr-periode').blur();await p.waitForTimeout(300);
 ok('clôture : 11 contrôles à cocher',(await p.locator('[data-testid^="pr-etape-c"]').count())===11);
 await g(p,'pr-terminer').click();ok('clôture avec contrôles non cochés : refusée',await toast(p,/Il reste 11 point\(s\)/));
 for(let i=1;i<=11;i++)await g(p,'pr-etape-c'+i).check();
 await p.waitForTimeout(500);await g(p,'pr-terminer').click();await p.waitForTimeout(600);
 r=await p.evaluate(()=>window.__srv.tables.procedure_runs.find(x=>x.procedure==='cloture'));
 ok('clôture terminée, période conservée, 11 contrôles consignés',r.status==='termine'&&/octobre 2026/.test(r.data.period)&&Object.keys(r.data.steps).length===11,r);
 // Réouverture
 await p.getByText('Retour').first().click();await p.waitForTimeout(300);
 await g(p,'pr-ouvrir-reouverture').click();await g(p,'pr-f-entreprise').fill('Lakay SA');await g(p,'pr-f-creer').click();await p.waitForTimeout(700);
 for(let i=1;i<=7;i++)await g(p,'pr-etape-r'+i).check();
 await p.waitForTimeout(400);await g(p,'pr-terminer').click();
 ok('réouverture sans motif : refusée',await toast(p,/motif de la réouverture est obligatoire/));
 await g(p,'pr-motif').fill('Déclaration TCA déjà déposée à rectifier.');await g(p,'pr-motif').blur();await p.waitForTimeout(300);await g(p,'pr-terminer').click();await p.waitForTimeout(600);
 r=await p.evaluate(()=>window.__srv.tables.procedure_runs.find(x=>x.procedure==='reouverture'));
 ok('réouverture consignée avec motif',r.status==='termine'&&/TCA/.test(r.data.motif),r);
 await g(p,'pr-rouvrir').click();await p.waitForTimeout(500);
 ok('une fiche close peut être rouverte',await p.evaluate(()=>window.__srv.tables.procedure_runs.find(x=>x.procedure==='reouverture').status)==='en_cours');
 ok('aucune erreur de page (procédures)',errs.length===0,errs);
 await p.close();}

// ───── Centre de gestion, collaborateur sans droit « Procédures »
for(const [perm,label] of [[false,'sans'],[true,'avec']]){
 const extra="const S=window.__srv;S.tables.platform_admins=[];S.tables.management_collaborators=[{id:'m1',email:'a@x.com',role:'support',permissions:{entreprises:true,offres:true,statistiques:true,"+(perm?"procedures:true":"collaborateurs:false")+"}}];S.rpcH={company_activity_summary:()=>({data:[],error:null}),cabinet_overview:()=>({data:[],error:null})};S.tables.team_threads[0].assigned_email='a@x.com';";
 const {p,errs}=await boot(b,{kv:{},pageInit:new Function('('+base.toString()+')();'+extra)});
 await p.getByText('Centre de gestion',{exact:true}).first().click({timeout:4000}).catch(()=>{});await p.waitForTimeout(1200);
 await p.getByText('Équipe',{exact:true}).first().click({timeout:4000}).catch(()=>{});await p.waitForTimeout(500);
 ok('collaborateur '+label+' droit Procédures : onglet Messagerie visible',await p.getByText('Messagerie interne',{exact:false}).first().isVisible().catch(()=>false),(await txt(p)).slice(0,300));
 ok('collaborateur '+label+' droit Procédures : onglet Procédures '+(perm?'visible':'absent'),(await p.getByText('Procédures',{exact:true}).count()>0)===perm);
 await p.getByText('Messagerie interne',{exact:false}).first().click({timeout:4000}).catch(()=>{});await p.waitForTimeout(700);
 ok('collaborateur : voit le fil qui lui est destiné',await g(p,'tm-fil').count()===1&&await g(p,'tm-pourmoi').count()===1);
 await g(p,'tm-fil').click();await p.waitForTimeout(500);await g(p,'tm-reponse').fill('Bien reçu, je m\'en occupe.');await g(p,'tm-envoyer').click();await p.waitForTimeout(600);
 ok('collaborateur : réponse enregistrée sous son adresse',await p.evaluate(()=>window.__srv.tables.team_messages.some(m=>m.author_email==='a@x.com'&&/Bien reçu/.test(m.body))));
 if(perm){await p.getByText('Procédures',{exact:true}).first().click();await p.waitForTimeout(500);ok('collaborateur autorisé : accède aux procédures',await g(p,'pr-panel').count()===1);}
 ok('aucune erreur de page (centre de gestion '+label+')',errs.length===0,errs);
 await p.close();}
// ───── Tables absentes (SQL pas encore exécuté) : message d'explication, pas de plantage
{const init=()=>{const S=window.__srv;S.tables.platform_admins=[{email:'a@x.com'}];S.tables.superadmin_log=[];S.tables.billing_settings=[];S.tables.billing_invoices=[];S.tableMissing={team_threads:1,procedure_runs:1,team_messages:1,team_thread_reads:1};};
 const {p,errs}=await boot(b,{settings:{companyName:'X'},primary:true,pageInit:new Function('('+init.toString()+')()')});
 await goSA(p);await p.waitForTimeout(600);
 ok('messagerie sans SQL : message d\'activation',await g(p,'tm-missing').count()===1);
 await g(p,'sa-tab-equipe_procedures').click();await p.waitForTimeout(500);
 ok('procédures sans SQL : message d\'activation',await g(p,'pr-missing').count()===1);
 ok('aucune erreur de page (SQL absent)',errs.length===0,errs);
 await p.close();}
await b.close();console.log(fails?'ÉCHECS: '+fails:'TOUT PASSE');process.exit(fails?1:0);})();
