(()=>{'use strict';const API='/.netlify/functions/tm-academy',$=id=>document.getElementById(id);let state=null,showArchivedOrders=false;
const fmtMoney=c=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((Number(c)||0)/100);
const fmtDate=d=>d?new Date(d).toLocaleDateString('pt-BR'):'—';
const show=(id,v)=>$(id).hidden=!v;
const msg=(id,txt,bad=false)=>{const e=$(id);e.textContent=txt;e.className='notice '+(bad?'error':'ok')};
async function req(action,payload){let r;try{r=await fetch(API+(payload?'':'?action='+encodeURIComponent(action)),{method:payload?'POST':'GET',credentials:'same-origin',headers:payload?{'Content-Type':'application/json'}:{},body:payload?JSON.stringify({action,...payload}):undefined})}catch(e){throw Error('Não foi possível conectar ao Netlify. Confira a internet e o domínio do site.')}const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok){let details=d.error||d.message||'';if(r.status===404)details='Função tm-academy não encontrada no deploy Netlify. Confira a pasta netlify/functions e o último deploy.';else if(r.status>=500)details=(details||'Erro interno da função tm-academy.')+' Verifique Functions → tm-academy → Logs no Netlify e a configuração TM_ADMIN_EMAIL.';else if(r.status===401||r.status===403)details=details||'Acesso recusado: confira a conta administrativa e a variável TM_ADMIN_EMAIL.';else if(!details)details='Não foi possível concluir a operação.';const err=new Error(details+' (HTTP '+r.status+')');err.httpStatus=r.status;throw err}return d}

function cell(row,value){const td=document.createElement('td');td.textContent=String(value??'');row.append(td);return td}
function navigate(name){document.querySelectorAll('[data-panel]').forEach(b=>b.classList.toggle('active',b.dataset.panel===name));for(const x of ['students','invitations','orders','settings'])show('panel-'+x,x===name);if(name==='students')loadStudents();if(name==='orders')loadOrders();if(name==='invitations')loadInvites();if(name==='settings')loadSettings()}
function showAuthenticatedAdmin(d){state=d;show('adminLogin',false);show('adminMain',true);$('adminIdentity').textContent=d.adminEmail;fillSettings(d.settings);navigate('invitations');loadOrders()}
function identitySdk(){return window.TMNetlifyIdentity||null}
function explainIdentityError(e){
 const code=Number(e?.status||e?.statusCode||e?.httpStatus||e?.response?.status||0);
 if(code===401||code===400)return 'O Netlify Identity recusou essa senha. Use “Esqueci minha senha” para redefini-la e recuperar seu acesso.';
 return String(e?.message||e||'Falha na autenticação com o Netlify Identity.');
}
async function useExistingIdentitySession(showErrors=true){
 try{
  const sdk=identitySdk();
  if(!sdk?.getUser)throw Error('Serviço de autenticação indisponível. Verifique a publicação de tm-identity-browser.js.');
  const user=await sdk.getUser(); // Reidrata a sessão do navegador (nf_jwt/nf_refresh).
  if(!user?.id)throw Error('Não existe sessão ativa neste navegador. Entre com e-mail e senha ou use “Esqueci minha senha”.');
  await req('identitySession',{}); // Somente o servidor autentica e autoriza o professor.
  const d=await req('admin');showAuthenticatedAdmin(d);return true;
 }catch(e){if(showErrors)msg('adminLoginMsg',e.message,true);return false}
}
async function login(e){
 e.preventDefault();msg('adminLoginMsg','Entrando com Netlify Identity…');
 const sdk=identitySdk();
 if(!sdk?.login){msg('adminLoginMsg','O componente de login do Netlify não foi carregado. Verifique tm-identity-browser.js.',true);return}
 const email=$('adminEmail').value.trim().toLowerCase(),password=$('adminPassword').value;
 if(!email||!password){msg('adminLoginMsg','Informe seu e-mail e a senha online.',true);return}
 try{
  const user=await sdk.login(email,password); // Login realizado pelo SDK oficial no navegador.
  if(!user?.id)throw Error('O Netlify não confirmou a autenticação.');
  await req('identitySession',{}); // Cria sessão secundária só após validação e autorização no servidor.
  const d=await req('admin');$('adminPassword').value='';showAuthenticatedAdmin(d);
 }catch(e){msg('adminLoginMsg',explainIdentityError(e),true)}
}
async function recoverAdminPassword(){
 const sdk=identitySdk();
 if(!sdk?.requestPasswordRecovery){msg('adminLoginMsg','O serviço de recuperação não foi carregado. Atualize tm-identity-entry.js.',true);return}
 const email=$('adminEmail').value.trim().toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){msg('adminLoginMsg','Preencha primeiro seu e-mail de administrador.',true);$('adminEmail').focus();return}
 const button=$('tm402ForgotPasswordButton');if(button)button.disabled=true;
 try{
  await sdk.requestPasswordRecovery(email);
  msg('adminLoginMsg','Solicitação enviada ao Netlify. Se a conta existir, verifique a caixa de entrada e o spam. Abra o link do e-mail para definir uma nova senha.');
 }catch(e){msg('adminLoginMsg','Não foi possível solicitar a recuperação: '+explainIdentityError(e),true)}
 finally{if(button)button.disabled=false}
}
async function initSession(){
 try{const d=await req('admin');showAuthenticatedAdmin(d)}
 catch{show('adminLogin',true);show('adminMain',false);await useExistingIdentitySession(false)}
}
function attachNetlifySessionButton(){
 const form=$('adminLoginForm');if(!form||$('tm402IdentitySessionButton'))return;
 const b=document.createElement('button');b.type='button';b.id='tm402IdentitySessionButton';b.className='btn outline';b.style.margin='8px 0 4px';b.textContent='Continuar com uma sessão Netlify ativa';
 b.addEventListener('click',()=>{msg('adminLoginMsg','Verificando sua sessão Netlify…');useExistingIdentitySession(true)});
 const reset=document.createElement('button');reset.type='button';reset.id='tm402ForgotPasswordButton';reset.className='btn outline';reset.style.margin='8px 0 4px 8px';reset.textContent='Esqueci minha senha';
 reset.addEventListener('click',recoverAdminPassword);
 form.after(b,reset);
}
async function loadStudents(){try{const d=await req('adminRoster');const root=$('studentRows');root.textContent='';let active=0;for(const s of d.students){const r=document.createElement('tr');cell(r,s.name);cell(r,s.email);cell(r,s.completed+'/50');cell(r,s.access.active?(s.access.kind==='free'?'Grátis':'Pago'):'Vencido / pendente');cell(r,fmtDate(s.updatedAt));root.append(r);if(s.access.active)active++}if(!d.students.length){const r=document.createElement('tr');cell(r,'Nenhum aluno matriculado.').colSpan=5;root.append(r)}$('studentCount').textContent=d.students.length;$('activeCount').textContent=active;msg('studentReportMsg','Lista atualizada no Netlify.') }catch(e){msg('studentReportMsg',e.message,true)}}
async function loadOrders(){try{
 const d=await req('adminOrders');const root=$('orderRows');root.textContent='';let pending=0;
 for(const o of d.orders){if(o.archivedAt&&!showArchivedOrders)continue;
  const r=document.createElement('tr');cell(r,o.email);cell(r,o.plan==='monthly'?'Mensal':'Anual');cell(r,fmtMoney(o.amount));cell(r,o.id.slice(0,8));
  cell(r,(o.status==='approved'?'Aprovado':o.status==='pending'?'Aguardando Pix':o.status==='revoked'?'Liberação anulada':'Rejeitado')+(o.archivedAt?' · Arquivado':''));
  const td=document.createElement('td');
  if(o.status==='pending'&&!o.archivedAt){pending++;
   const b=document.createElement('button');b.className='btn small primary';b.textContent='Confirmar recebimento';b.onclick=()=>approve(o.id,o.email,o.amount);td.append(b);
   const refuse=document.createElement('button');refuse.className='btn small';refuse.textContent='Rejeitar';refuse.onclick=()=>reject(o.id);td.append(refuse);
  }
  if(o.status==='approved'&&!o.archivedAt){const undo=document.createElement('button');undo.className='btn small';undo.textContent='Anular liberação';undo.onclick=()=>revokeOrder(o);td.append(undo)}
  if(!o.archivedAt){const archive=document.createElement('button');archive.className='btn small';archive.textContent='Arquivar / ocultar';archive.title='Remove da lista principal sem apagar o histórico nem mudar o acesso';archive.onclick=()=>archiveOrder(o);td.append(archive)}
  r.append(td);root.append(r)
 }
 if(!root.children.length){const r=document.createElement('tr');cell(r,showArchivedOrders?'Não há pedidos para exibir.':'Nenhum pedido ativo para exibir.').colSpan=6;root.append(r)}
 $('pendingCount').textContent=pending;msg('orderMsg','Pedidos consultados no Netlify. Arquivar não cancela acesso; use Anular liberação quando um pagamento tiver sido aprovado por engano.')
 }catch(e){msg('orderMsg',e.message,true)}}
async function approve(orderId,email,amount){
 if(!confirm('ATENÇÃO: a Academia NÃO detecta Pix automaticamente.\n\nVocê conferiu no EXTRATO DO BANCO a origem, o valor '+fmtMoney(amount)+' e o vínculo com este pedido do aluno '+email+'?\n\nUm Pix de outra pessoa ou outra finalidade NÃO autoriza aprovação.'))return;
 const ref=orderId.slice(0,8),typed=prompt('Para confirmar o recebimento real, digite exatamente o código deste pedido: '+ref);
 if(typed!==ref){msg('orderMsg','Confirmação cancelada: código do pedido não corresponde.',true);return}
 try{await req('approve',{orderId,bankConfirmed:true,orderReference:ref});msg('orderMsg','✓ Pedido aprovado manualmente.');await loadOrders();await loadStudents()}catch(e){msg('orderMsg',e.message,true)}
}
async function reject(orderId){if(!confirm('Rejeitar este pedido?'))return;try{await req('reject',{orderId});await loadOrders()}catch(e){msg('orderMsg',e.message,true)}}
async function archiveOrder(o){
 if(!confirm('Arquivar o registro do pedido '+o.id.slice(0,8)+'?\n\nO histórico ficará preservado no servidor. ATENÇÃO: arquivar NÃO revoga o acesso de um pedido aprovado.'))return;
 try{const d=await req('orderArchive',{orderId:o.id});await loadOrders();msg('orderMsg','✓ '+d.message)}catch(e){msg('orderMsg',e.message,true)}
}
async function revokeOrder(o){
 if(!confirm('ANULAR a liberação associada ao pedido '+o.id.slice(0,8)+'?\n\nUse somente se a aprovação estiver errada e o pagamento não corresponder à compra. Isto pode retirar o acesso pago do aluno. O histórico será preservado.'))return;
 const typed=prompt('Digite ANULAR para confirmar a retirada do acesso pago.');if(typed!=='ANULAR')return;
 try{const d=await req('orderRevoke',{orderId:o.id});await loadOrders();await loadStudents();msg('orderMsg','✓ '+d.message)}catch(e){msg('orderMsg',e.message,true)}
}
async function manageInvite(kind,record){
 const action=kind==='delete'?'inviteDelete':'inviteRevoke';
 const warning=record.claimedBy?'ATENÇÃO: o convite já foi usado. Cancelar revoga o acesso gratuito associado, mas preserva eventual assinatura paga.':'O link deixará de funcionar imediatamente.';
 if(!confirm((kind==='delete'?'Excluir da lista e cancelar definitivamente este convite?':'Cancelar este convite?')+'\n\n'+warning))return;
 try{const r=await req(action,{token:record.token});msg('inviteMsg','✓ '+r.message);await loadInvites();await loadStudents()}
 catch(e){msg('inviteMsg',e.message,true)}
}
async function loadInvites(){try{
 const d=await req('adminInvites');const root=$('inviteRows');root.textContent='';
 for(const v of d.invites){const r=document.createElement('tr');cell(r,fmtDate(v.createdAt));cell(r,v.durationDays+' dias');cell(r,v.claimedBy?'Sim':'Não');cell(r,fmtDate(v.expiresAt));cell(r,v.revokedAt?'Cancelado':Date.parse(v.expiresAt)<Date.now()?'Expirado':v.claimedBy?'Utilizado':'Disponível');
 const td=document.createElement('td');const cancel=document.createElement('button');cancel.className='btn small';cancel.type='button';cancel.textContent='Cancelar';cancel.disabled=!!v.revokedAt;cancel.onclick=()=>manageInvite('revoke',v);const remove=document.createElement('button');remove.type='button';remove.className='btn small';remove.textContent='Excluir';remove.onclick=()=>manageInvite('delete',v);td.append(cancel,remove);r.append(td);root.append(r)}
 if(!d.invites.length){const r=document.createElement('tr');cell(r,'Nenhum convite visível.').colSpan=6;root.append(r)}
 }catch(e){msg('inviteMsg',e.message,true)}}
function inviteDurationDays(){
 const input=$('inviteDuration');
 const unit=$('tm400AccessUnit')?.value||'days';
 if(unit==='hours')throw Error('Convites por horas ainda não estão disponíveis no servidor. Selecione Dias, Meses ou Anos.');
 if(unit==='forever')throw Error('Acesso permanente ainda não está disponível no servidor. Selecione uma duração limitada.');
 const amount=Number(input?.value);
 if(!Number.isInteger(amount)||amount<1)throw Error('Informe uma duração válida, com número inteiro maior que zero.');
 const durationDays=unit==='months'?amount*30:unit==='years'?amount*365:amount;
 if(!['days','months','years'].includes(unit)||!Number.isInteger(durationDays)||durationDays<1||durationDays>365)
  throw Error('A duração do convite deve estar entre 1 e 365 dias.');
 return durationDays;
}
async function invite(e){e.preventDefault();try{const d=await req('inviteCreate',{durationDays:inviteDurationDays(),validDays:Number($('inviteValid').value),email:$('inviteEmail').value.trim()});$('inviteLink').value=d.invite.url;show('inviteResult',true);msg('inviteMsg','Convite criado no servidor. Envie o link somente ao aluno desejado.');await loadInvites()}catch(e){msg('inviteMsg',e.message,true)}}
function moneyToCents(v){const normalized=String(v).trim().replace(/\s/g,'').replace(/\./g,'').replace(',','.');return Math.round(Number(normalized)*100)}
function fillSettings(s){$('monthlyInput').value=(s.monthly/100).toFixed(2).replace('.',',');$('annualInput').value=(s.annual/100).toFixed(2).replace('.',',');$('pixKeyInput').value=s.pixKey||'';$('merchantNameInput').value=s.merchantName||'';$('cityInput').value=s.city||'';$('enableSales').checked=!!s.enabled}
async function loadSettings(){try{const d=await req('admin');fillSettings(d.settings)}catch(e){msg('settingsMsg',e.message,true)}}
async function saveSettings(e){e.preventDefault();try{await req('settings',{monthly:moneyToCents($('monthlyInput').value),annual:moneyToCents($('annualInput').value),pixKey:$('pixKeyInput').value,merchantName:$('merchantNameInput').value,city:$('cityInput').value,enabled:$('enableSales').checked});msg('settingsMsg','✓ Configurações confirmadas pelo Netlify.') }catch(e){msg('settingsMsg',e.message,true)}}
async function diagnose(){const out=$('tm400ServerStatus');if(out)out.textContent='Consultando a função tm-academy…';try{const d=await req('catalog');if(out)out.textContent='✓ A API respondeu. Se o login continua falhando, verifique TM_ADMIN_EMAIL, Netlify Identity e Functions → tm-academy → Logs.'}catch(e){if(out)out.textContent='Diagnóstico: '+e.message}}
function updateDurationUnit(){const u=$('tm400AccessUnit')?.value||'days',input=$('inviteDuration'),info=$('tm400DurationHelp');if(!input||!info)return;const rules={days:[365,'O servidor aceita 1 a 365 dias.'],months:[12,'Cada mês é convertido em 30 dias. Máximo: 12 meses (360 dias).'],years:[1,'Um ano de acesso é convertido em 365 dias.'],hours:[8760,'Horas ainda não estão disponíveis na função atual do servidor.'],forever:[1,'Acesso sem vencimento exige suporte no servidor; não é gerado nesta versão.']};const [max,label]=rules[u];input.max=max;input.min=1;input.disabled=(u==='forever');if(u==='forever')input.value='1';else if(Number(input.value)>max||Number(input.value)<1)input.value=String(Math.min(7,max));info.textContent=label}
function shareInvite(){const url=$('inviteLink')?.value||'';if(!url){msg('inviteMsg','Gere primeiro um convite confirmado pelo servidor.',true);return}const message='Olá! Seu convite de acesso à Teacher Marks English Academy está pronto. Acesse pelo link: '+url;window.open('https://wa.me/?text='+encodeURIComponent(message),'_blank','noopener,noreferrer')}
async function logout(){await req('logout',{}).catch(()=>{});show('adminMain',false);show('adminLogin',true);msg('adminLoginMsg','Você saiu da administração.')}
function init(){attachNetlifySessionButton(); $('tm400Diagnose')?.addEventListener('click',diagnose);$('tm400AccessUnit')?.addEventListener('change',updateDurationUnit);$('tm400WhatsAppInvite')?.addEventListener('click',shareInvite);updateDurationUnit();$('adminLoginForm').onsubmit=login;$('inviteForm').onsubmit=invite;$('settingsForm').onsubmit=saveSettings;$('adminLogout').onclick=logout;$('reloadStudents').onclick=loadStudents;$('reloadOrders').onclick=loadOrders;const toggle=$('showArchivedOrders');if(toggle)toggle.onclick=()=>{showArchivedOrders=!showArchivedOrders;toggle.textContent=showArchivedOrders?'Ocultar arquivados':'Ver arquivados';loadOrders()};document.querySelectorAll('[data-panel]').forEach(b=>b.onclick=()=>navigate(b.dataset.panel));$('copyMonthlyLink').onclick=()=>navigator.clipboard.writeText(location.origin+'/aluno.html?plano=mensal#planos').then(()=>msg('settingsMsg','Link do plano mensal copiado.')).catch(()=>msg('settingsMsg','Copie o endereço do site manualmente.',true));$('copyAnnualLink').onclick=()=>navigator.clipboard.writeText(location.origin+'/aluno.html?plano=anual#planos').then(()=>msg('settingsMsg','Link do plano anual copiado.')).catch(()=>msg('settingsMsg','Copie o endereço do site manualmente.',true));$('copyInvite').onclick=()=>navigator.clipboard.writeText($('inviteLink').value).then(()=>msg('inviteMsg','Link copiado!')).catch(()=>msg('inviteMsg','Selecione e copie o link.',true));initSession() }
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();})();
