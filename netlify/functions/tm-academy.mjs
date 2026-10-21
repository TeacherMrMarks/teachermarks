/** Teacher Marks English Academy V402 — correção da autenticação · Identity + Blobs.
 * Mantém o site Netlify atual e o armazenamento existente. Identity precisa estar ativado.
 * Required for admin access: TM_ADMIN_EMAIL (Netlify environment variable).
 * Payments: manual Pix confirmation in the recipient's bank, NEVER by screenshot.
 */
import { getUser, login, signup, logout, refreshSession, verifyRequestOrigin } from '@netlify/identity';
import { getStore } from '@netlify/blobs';
import { randomBytes, createHash } from 'node:crypto';
import { LESSONS } from '../../server/course-lessons.mjs';
import { ACADEMY_STUDY_HTML, ACADEMY_STUDY_KEYS } from '../../server/academy-course-content.mjs';
import { ACADEMY_QUIZ_BANKS, ACADEMY_LISTENING_BANK, ACADEMY_READING_BANK, ACADEMY_VOCABULARY_BANK, ACADEMY_SPEAKING_HTML } from '../../server/academy-student-banks.mjs';
const STORE='tm-academy-v391', IDLE_MS=24*60*60*1000, MAX_JSON=25000;
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
const str=v=>String(v??'').trim();
const safe=v=>str(v).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,90);
const date=()=>new Date().toISOString();
const days=n=>new Date(Date.now()+n*86400000).toISOString();
const asCents=x=>Number.isInteger(x)&&x>0&&x<=10000000;
const json=(payload,status=200,cookie='')=>{const h=new Headers(headers);if(cookie)h.set('Set-Cookie',cookie);return Response.json(payload,{status,headers:h})};
const fail=(message,status=400)=>json({ok:false,error:message},status);
const keyUser=(kind,id)=>`${kind}/${safe(id)}`;
const get=(db,key)=>db.get(key,{type:'json',consistency:'strong'});
const getMeta=(db,key)=>db.getWithMetadata(key,{type:'json',consistency:'strong'});
const put=async(db,key,value,expected)=>db.set(key,JSON.stringify(value),{...(expected?{onlyIfMatch:expected}:{onlyIfNew:true}),metadata:{updatedAt:date()}});
const setUnconditional=(db,key,obj)=>db.set(key,JSON.stringify(obj));
const ADMIN_EMAIL=()=>str(process.env.TM_ADMIN_EMAIL).toLowerCase();
const admin=u=>ADMIN_EMAIL()&&str(u?.email).toLowerCase()===ADMIN_EMAIL();
const catalog=()=>LESSONS.map(x=>({id:x.id,index:x.index,title:x.title,level:x.level,module:x.module,part:x.part}));
const accessActive=(a)=>!!(a&&[a.trialUntil,a.paidUntil].some(d=>d&&Date.parse(d)>Date.now()));
const entitle=(a)=>({active:accessActive(a),trialUntil:a?.trialUntil||null,paidUntil:a?.paidUntil||null,kind:a?.kind||'none',status:accessActive(a)?'active':'expired'});
// V408: toda consulta protegida valida novamente a origem do acesso gratuito.
// Cancelar/excluir um convite revoga o beneficio associado, mesmo se uma
// atualizacao anterior do registro access falhar. Assinaturas Pix permanecem válidas.
async function getVerifiedAccess(db,uid){
 const access=await get(db,keyUser('access',uid));if(!access)return null;
 if(!access.trialInviteToken)return access;
 const token=safe(access.trialInviteToken);
 const invitation=await get(db,`invites/${token}`);
 const paidValid=Boolean(access.paidUntil&&Date.parse(access.paidUntil)>Date.now());
 const claimedAt=Date.parse(invitation?.claimedAt||'');
 const originalEnd=claimedAt+Number(invitation?.durationDays||0)*86400000;
 const belongs=invitation?.claimedBy===uid;
 const freeValid=Boolean(invitation&&!invitation.revokedAt&&!invitation.deletedAt&&belongs&&
   Number.isFinite(originalEnd)&&originalEnd>Date.now()&&Date.parse(access.trialUntil||'')>Date.now());
 if(freeValid)return {...access,trialUntil:new Date(Math.min(originalEnd,Date.parse(access.trialUntil))).toISOString(),kind:paidValid?'paid':'free'};
 return {...access,trialUntil:null,kind:paidValid?'paid':'none',trialBlocked:!paidValid};
}

const parseCookie=(req,name)=>{const hit=String(req.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(p=>p.startsWith(name+'='));return hit?decodeURIComponent(hit.slice(name.length+1)):''};
const cookie=(value,age)=>`tm_academy_session=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${age}`;
const sha=value=>createHash('sha256').update(String(value)).digest('hex');
const id=()=>randomBytes(16).toString('hex');

// A sessão secundária da Academia só é criada após validação pelo Netlify Identity.
// Nenhum e-mail ou senha vindo do navegador é considerado prova de autenticação.
async function createAcademySession(db,user,{registerStudent=false}={}){
 const token=randomBytes(32).toString('hex');
 await setUnconditional(db,`sessions/${sha(token)}`,{uid:user.id,lastSeen:Date.now()});
 if(registerStudent)await student(db,user);
 return json({ok:true,user:{id:user.id,email:user.email}},200,cookie(token,2592000));
}
async function authenticated(req,db){
 const token=parseCookie(req,'tm_academy_session');
 if(!/^[a-f0-9]{64}$/.test(token))return null;
 const sessionKey=`sessions/${sha(token)}`;
 const session=await get(db,sessionKey);
 if(!session||Date.now()-Number(session.lastSeen||0)>IDLE_MS)return null;
 if(session.guest){
   // Convite usado é um segredo de acesso. Nenhum nome/e-mail vindo da página vira autenticação.
   const guest=await get(db,keyUser('students',session.uid));
   if(!guest?.guest||guest.id!==session.uid)return null;
   const iv=await get(db,`invites/${safe(guest.inviteToken)}`);
   if(!iv||iv.claimedBy!==guest.id||iv.revokedAt||iv.deletedAt)return null;
   if(Date.parse(iv.claimedAt||'')+Number(iv.durationDays||0)*86400000<=Date.now())return null;
   if(Date.now()-Number(session.lastSeen||0)>4*60*1000){try{await setUnconditional(db,sessionKey,{...session,lastSeen:Date.now()})}catch{}}
   return {user:{id:guest.id,name:guest.name,email:'',guest:true},guest:true,sessionKey,token};
 }
 let user=null;try{await refreshSession()}catch{};try{user=await getUser()}catch{}
 if(!user?.id||session.uid!==user.id)return null;
 if(Date.now()-Number(session.lastSeen||0)>4*60*1000){try{await setUnconditional(db,sessionKey,{...session,lastSeen:Date.now()})}catch{}}
 return {user,sessionKey,token};
}
async function student(db,u){
 const k=keyUser('students',u.id);let old=await get(db,k);
 if(!old){const v={id:u.id,name:str(u.name||u.userMetadata?.full_name||u.email?.split('@')[0]).slice(0,90),email:str(u.email).slice(0,160),createdAt:date()};await put(db,k,v).catch(()=>{});old=await get(db,k)||v}
 return old;
}
async function list(db,prefix){
 const out=[];let cursor;
 for(let page=0;page<12;page++){
  const r=await db.list({prefix,perPage:100,...(cursor?{cursor}:{})});
  for(const b of r.blobs||[])out.push(b.key);
  cursor=r.cursor;if(!cursor)break;
 }
 return out;
}
const digits=(num)=>String(num).padStart(2,'0');
function tlv(id,v){const value=String(v);return id+digits(value.length)+value}
function ascii(v,max){return str(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9 .-]/g,'').slice(0,max)||'TEACHER MARKS'}
function crc16(input){let crc=0xffff;for(const ch of input){crc^=ch.charCodeAt(0)<<8;for(let i=0;i<8;i++)crc=((crc<<1)^(crc&0x8000?0x1021:0))&0xffff}return crc.toString(16).toUpperCase().padStart(4,'0')}
function pixCode(st,amountCents,txid){
 const merchant=tlv('00','br.gov.bcb.pix')+tlv('01',st.pixKey);
 const payload=tlv('00','01')+tlv('01','11')+tlv('26',merchant)+tlv('52','0000')+tlv('53','986')+tlv('54',(amountCents/100).toFixed(2))+tlv('58','BR')+tlv('59',ascii(st.merchantName,25))+tlv('60',ascii(st.city,15))+tlv('62',tlv('05',txid))+'6304';
 return payload+crc16(payload);
}
async function config(db){return await get(db,'settings')||{monthly:2990,annual:24990,pixKey:'',merchantName:'TEACHER MARKS',city:'BRASIL',enabled:false,configured:false}}
async function grant(db,uid,update){
 const k=keyUser('access',uid);
 for(let i=0;i<5;i++){
  const old=await getMeta(db,k),cur=old?.data||{id:uid,trialUntil:null,paidUntil:null,kind:'none',appliedOrders:[]};
  const next=update({...cur});
  const r=await put(db,k,next,old?.etag);if(r.modified)return next;
 }
 throw Error('O registro foi alterado simultaneamente. Tente novamente.');
}
// V407: migra somente o progresso de um convite anônimo COM sessão de convidado válida
// para uma conta Identity autenticada no mesmo navegador. Nunca utiliza nome como prova.
async function migrateGuestToIdentity(db,guestAuth,identity){
 if(!guestAuth?.guest||!identity?.id)return false;
 const original=await get(db,keyUser('students',guestAuth.user.id));
 if(!original?.guest||!original.inviteToken)return false;
 const invKey=`invites/${safe(original.inviteToken)}`;
 const stored=await getMeta(db,invKey),iv=stored?.data;
 if(!iv||iv.revokedAt||iv.deletedAt||iv.claimedBy!==original.id||iv.guestId!==original.id)return false;
 const expiration=Date.parse(iv.claimedAt||'')+Number(iv.durationDays||0)*86400000;
 if(!Number.isFinite(expiration)||expiration<=Date.now())return false;
 // Vincular a identidade ANTES de alterar a sessão. Isso também invalida o login
 // anônimo anterior; cancelamento posterior revoga a nova conta real.
 const modified=await put(db,invKey,{...iv,claimedBy:identity.id,guestId:null,migratedGuestId:original.id,migratedAt:date(),studentEmail:str(identity.email).toLowerCase()},stored.etag);
 if(!modified.modified)throw Error('Convite atualizado em outro aparelho. Tente novamente.');
 await student(db,identity);
 await grant(db,identity.id,prev=>({...prev,kind:accessActive(prev)&&prev.kind==='paid'?'paid':'free',trialInviteToken:original.inviteToken,trialUntil:prev.trialUntil&&Date.parse(prev.trialUntil)>expiration?prev.trialUntil:new Date(expiration).toISOString()}));
 for(const kind of ['progress','quizprogress','enemprogress']){
  const source=await get(db,keyUser(kind,original.id));
  if(source&&!await get(db,keyUser(kind,identity.id)))await put(db,keyUser(kind,identity.id),source).catch(()=>{});
 }
 return true;
}
function requireAdmin(auth){if(!ADMIN_EMAIL())return fail('Configure TM_ADMIN_EMAIL nas variáveis de ambiente do Netlify.',503);if(!admin(auth?.user))return fail('Acesso exclusivo da administração.',403);return null}
export default async function handler(req){
 try{
  const url=new URL(req.url);const action=req.method==='GET'?url.searchParams.get('action')||'catalog':null;
  if(req.method==='POST'){
   verifyRequestOrigin(req);
   if(Number(req.headers.get('content-length')||0)>MAX_JSON)return fail('Solicitação muito grande.',413);
  }else if(req.method!=='GET')return fail('Método não permitido.',405);
  // Open connection within request: prevents stale Blob credentials.
  const db=getStore({name:STORE,consistency:'strong'});
  if(req.method==='GET'&&action==='catalog'){
   const settings=await config(db);
   return json({ok:true,lessons:catalog(),monthly:settings.monthly,annual:settings.annual,paymentEnabled:!!(settings.enabled&&settings.pixKey)});
  }
  if(req.method==='GET'&&action==='invite'){
   const token=safe(url.searchParams.get('token'));if(!/^[a-f0-9]{32}$/.test(token))return fail('Convite inválido.',404);
   const iv=await get(db,`invites/${token}`);
   if(!iv||iv.revokedAt||iv.deletedAt||Date.parse(iv.expiresAt)<=Date.now()||iv.claimedBy)return fail('Convite não encontrado, cancelado, utilizado ou vencido.',410);
   return json({ok:true,invitation:{durationDays:iv.durationDays,expiresAt:iv.expiresAt}});
  }
  let body=null;
  if(req.method==='POST'){
   try{body=await req.json()}catch{return fail('Dados inválidos.')} 
   if(!body||typeof body!=='object')return fail('Dados inválidos.');
   const kind=str(body.action);
   if(kind==='signup'){
    const email=str(body.email).toLowerCase(),password=String(body.password||''),name=str(body.name);
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<10||name.length<2)return fail('Informe nome, e-mail válido e senha de pelo menos 10 caracteres.');
    const token=safe(body.invite||'');
    if(token){const v=await get(db,`invites/${token}`);if(!v||v.revokedAt||v.deletedAt||v.claimedBy||Date.parse(v.expiresAt)<=Date.now()||v.email&&str(v.email).toLowerCase()!==email)return fail('Convite inválido, vencido ou não destinado a esse e-mail.',410)}
    try{await signup(email,password,{full_name:name.slice(0,90)})}
    catch(err){
      const status=Number(err?.status||err?.statusCode||err?.response?.status||0);
      const details=String(err?.message||'');
      if(/signup.*disabled|registration.*(disabled|closed)|invite.only|not allowed to sign up/i.test(details))
        return fail('O cadastro público está fechado no Netlify Identity. O administrador precisa ativar o cadastro de novos alunos em Identity → Registration. Nenhum pagamento foi gerado.',403);
      if(/already registered|already exists|duplicate|already in use/i.test(details))
        return fail('Este e-mail já está cadastrado. Utilize Entrar ou Esqueci minha senha.',409);
      if(status===400||status===401||status===422)
        return fail('Não foi possível criar a conta no Netlify Identity. Confira se o cadastro público está habilitado e se o e-mail já está registrado. '+details.slice(0,150),400);
      throw err;
    }
    return json({ok:true,message:'Cadastro recebido. Se o Netlify solicitar, confirme seu e-mail antes de entrar. Depois use o mesmo convite para ativar o acesso.'});
   }
   if(kind==='guestInvite'){
    const token=safe(body.token).toLowerCase(),name=str(body.name).replace(/[\u0000-\u001f\u007f]/g,'').slice(0,90);
    if(!/^[a-f0-9]{32}$/.test(token)||name.length<2)return fail('Informe um link válido e seu nome completo.');
    const key=`invites/${token}`;
    const existing=await getMeta(db,key),iv=existing?.data;
    if(!iv||iv.revokedAt||iv.deletedAt)return fail('Convite cancelado ou não encontrado.',410);
    // Convites vinculados a e-mail são exclusivos: nunca permitir bypass com nome.
    if(iv.email)return fail('Este convite é exclusivo de um e-mail. Cadastre-se com o e-mail destinatário e ative o convite com sua conta.',403);
    const validUntil=Date.parse(iv.expiresAt||'');
    let guestId='';
    if(iv.claimedBy){
     if(!iv.guestId||iv.guestId!==iv.claimedBy)return fail('Convite utilizado por outra conta.',410);
     guestId=iv.guestId;
     const guest=await get(db,keyUser('students',guestId));
     if(!guest?.guest||guest.inviteToken!==token||guest.name.toLowerCase()!==name.toLowerCase())return fail('Convite utilizado. Informe o mesmo nome do primeiro acesso.',403);
     const trialUntil=Date.parse(iv.claimedAt||'')+Number(iv.durationDays||0)*86400000;
     if(!Number.isFinite(trialUntil)||trialUntil<=Date.now())return fail('O período gratuito deste convite terminou.',410);
    }else{
     if(!Number.isFinite(validUntil)||validUntil<=Date.now())return fail('O convite expirou. Solicite outro link.',410);
     guestId='guest_'+id();
     const updated=await put(db,key,{...iv,claimedBy:guestId,guestId,claimedAt:date(),guestName:name},existing.etag);
     if(!updated.modified)return fail('Este convite acabou de ser utilizado em outro acesso. Atualize a página.',409);
     await put(db,keyUser('students',guestId),{id:guestId,guest:true,inviteToken:token,name,email:'',createdAt:date()});
     await grant(db,guestId,prev=>({...prev,kind:'free',trialInviteToken:token,trialUntil:days(iv.durationDays)}));
    }
    const guest=await get(db,keyUser('students',guestId));
    if(!guest)return fail('Cadastro gratuito incompleto. Tente novamente.',503);
    // Sessão bearer aleatória, em cookie seguro e inacessível ao JS do navegador.
    const sessionToken=randomBytes(32).toString('hex');
    await setUnconditional(db,`sessions/${sha(sessionToken)}`,{uid:guestId,guest:true,lastSeen:Date.now()});
    return json({ok:true,user:{id:guestId,name:guest.name,guest:true},message:'Acesso gratuito autorizado.'},200,cookie(sessionToken,2592000));
   }
   if(kind==='identityStudentSession'){
    // O SDK no navegador faz login; aqui o servidor exige que o Identity confirme a conta.
    try{await refreshSession()}catch{}
    const user=await getUser();
    if(!user?.id)return fail('A conta ainda não foi autenticada pelo Netlify Identity. Confira seu e-mail e a senha.',401);
    // Conta autenticada e cookie de convidado verificado: transferência opcional do acesso e progresso.
    const previous=await authenticated(req,db);
    if(previous?.guest)await migrateGuestToIdentity(db,previous,user);
    return createAcademySession(db,user,{registerStudent:true});
   }
   if(kind==='login'){
    const email=str(body.email).toLowerCase(),password=String(body.password||'');
    if(!email||!password)return fail('Informe e-mail e senha.');
    let user;
    try{user=await login(email,password)}catch(err){
     // Não transformar recusa de credenciais do Identity (401) em erro interno (500).
     const code=Number(err?.status||err?.statusCode||err?.response?.status||0);
     if(code===401||code===400)return fail('O Netlify Identity não aceitou o login. Verifique a ativação da conta e a senha online.',401);
     throw err;
    }
    if(!user?.id)return fail('Não foi possível validar sua conta no Netlify Identity.',401);
    return createAcademySession(db,user,{registerStudent:true});
   }
   if(kind==='identitySession'){
    // Alternativa segura quando a conta já foi ativada no próprio site.
    // O navegador NÃO informa identidade, função nem papel: getUser() verifica
    // a sessão Identity no servidor e requireAdmin confere a variável de ambiente.
    const user=await getUser();
    if(!user?.id)return fail('Não existe sessão Netlify Identity ativa neste navegador. Ative sua conta ou entre com e-mail e senha.',401);
    const err=requireAdmin({user});if(err)return err;
    return createAcademySession(db,user);
   }
  }
  const auth=await authenticated(req,db);
  if(!auth)return json({ok:false,authRequired:true,error:'Entre novamente. Sua sessão foi encerrada ou ficou inativa por 24 horas.'},401,cookie('',0));
  const u=auth.user, uid=safe(u.id);
  if(req.method==='POST'){
   const kind=str(body.action);
   if(kind==='logout'){
    await db.delete(auth.sessionKey).catch(()=>{});if(!auth.guest)await logout().catch(()=>{});
    return json({ok:true},200,cookie('',0));
   }
   if(kind==='redeem'){
    if(auth.guest)return fail('Para ativar outro convite, entre com uma conta de e-mail ou utilize o link do novo convite.',403);
    const token=safe(body.token);if(!/^[a-f0-9]{32}$/.test(token))return fail('Convite inválido.');
    const k=`invites/${token}`,item=await getMeta(db,k),iv=item?.data;
    if(!iv)return fail('Convite não encontrado.',404);
    if(iv.revokedAt||iv.deletedAt)return fail('Este convite foi cancelado pelo professor.',410);
    if(iv.claimedBy&&iv.claimedBy!==uid)return fail('Convite já utilizado.',410);
    if(!iv.claimedBy&&(Date.parse(iv.expiresAt)<=Date.now()||iv.email&&str(iv.email).toLowerCase()!==str(u.email).toLowerCase()))return fail('Convite vencido ou de outro destinatário.',410);
    if(!iv.claimedBy){const r=await put(db,k,{...iv,claimedBy:uid,claimedAt:date()},item.etag);if(!r.modified)return fail('Convite utilizado ao mesmo tempo. Atualize e tente novamente.',409)}
    const a=await grant(db,uid,prev=>({...prev,kind:Date.parse(prev.paidUntil||'')>Date.now()?'paid':'free',trialInviteToken:token,trialUntil:(iv.claimedAt?new Date(Date.parse(iv.claimedAt)+iv.durationDays*86400000).toISOString():days(iv.durationDays))}));
    return json({ok:true,access:entitle(a)});
   }
   if(kind==='courseMoments'){
    const access=await get(db,keyUser('access',uid));
    if(!accessActive(access))return fail('Seu acesso não está ativo.',403);
    const posted=body.moments;
    if(!posted||typeof posted!=='object'||Array.isArray(posted)||Object.keys(posted).length>50)return fail('Registro das etapas inválido.');
    const legalKeys=new Set(ACADEMY_STUDY_KEYS);
    const received={};
    for(const [key,steps] of Object.entries(posted)){
      if(!legalKeys.has(key)||!Array.isArray(steps)||steps.length>7||!steps.every(n=>Number.isInteger(n)&&n>=0&&n<=6))return fail('Etapa de aula inválida.');
      const sorted=[...new Set(steps)].sort((a,b)=>a-b);
      if(sorted.some((n,i)=>i!==n))return fail('É necessário concluir os momentos na ordem indicada.',409);
      received[key]=sorted;
    }
    const k=keyUser('progress',uid);
    for(let attempt=0;attempt<5;attempt++){
      const previous=await getMeta(db,k);
      const current=previous?.data||{done:[],scores:{},lastLesson:'',updatedAt:''};
      const moments=(current.moments&&typeof current.moments==='object')?{...current.moments}:{};
      let changed=false;
      for(const key of ACADEMY_STUDY_KEYS){
        const incoming=received[key];if(!incoming)continue;
        const old=Array.isArray(moments[key])?moments[key]:[];
        if(incoming.length>old.length){moments[key]=incoming;changed=true}
      }
      const done=Array.isArray(current.done)?current.done.filter(x=>LESSONS.some(l=>l.id===x)):[];
      let lastLesson=current.lastLesson||'';
      for(let i=0;i<ACADEMY_STUDY_KEYS.length;i++){
        const steps=moments[ACADEMY_STUDY_KEYS[i]]||[];
        if(steps.length===7){const lid=LESSONS[i]?.id;if(lid&&!done.includes(lid)){done.push(lid);lastLesson=lid;changed=true}}
      }
      if(!changed)return json({ok:true,progress:{...current,done,moments},unchanged:true});
      const next={...current,done,moments,lastLesson,updatedAt:date()};
      const updated=await put(db,k,next,previous?.etag);
      if(updated.modified)return json({ok:true,progress:next,completedLessons:done.length,completedMoments:Object.values(moments).reduce((a,v)=>a+(Array.isArray(v)?v.length:0),0)});
    }
    return fail('Outro aparelho atualizou o progresso. Atualize a página e tente novamente.',409);
   }
   if(kind==='enemResult'){
    const score=Number(body.score),correct=Number(body.correct);
    if(!Number.isInteger(correct)||correct<0||correct>60||!Number.isFinite(score)||score<0||score>100||Math.round(correct*100/60)!==Math.round(score))return fail('Resultado do simulado inválido.');
    const a=await getVerifiedAccess(db,uid);if(!accessActive(a))return fail('Seu acesso ao curso está vencido.',403);
    const k=keyUser('enemprogress',uid);
    for(let i=0;i<5;i++){
     const old=await getMeta(db,k);const prev=old?.data||{attempts:0,bestScore:0};
     const next={attempts:(prev.attempts||0)+1,bestScore:Math.max(prev.bestScore||0,score),lastScore:score,lastCorrect:correct,updatedAt:date()};
     const stored=await put(db,k,next,old?.etag);if(stored.modified)return json({ok:true,progress:next});
    }
    return fail('Outro dispositivo atualizou o resultado. Tente novamente.',409);
   }
   if(kind==='quizPractice'){
    const lesson=safe(body.lessonId),score=Number(body.score);
    if(!LESSONS.some(l=>l.id===lesson)||!Number.isFinite(score)||score<0||score>100)return fail('Quiz ou resultado inválido.');
    const access=await getVerifiedAccess(db,uid);if(!accessActive(access))return fail('Seu acesso não está ativo.',403);
    // Separate namespace: independent quizzes MUST NOT mark the seven-moment course as completed.
    const k=keyUser('quizprogress',uid);
    for(let i=0;i<5;i++){
     const existing=await getMeta(db,k),current=existing?.data||{scores:{},attempts:{},updatedAt:''};
     const scores={...(current.scores||{})},attempts={...(current.attempts||{})};
     const value=Math.round(score);
     scores[lesson]=Math.max(Number(scores[lesson]||0),value);
     attempts[lesson]=Math.min(100000,(Number(attempts[lesson])||0)+1);
     const next={scores,attempts,updatedAt:date()};
     const changed=await put(db,k,next,existing?.etag);
     if(changed.modified)return json({ok:true,quizProgress:next});
    }
    return fail('Outro aparelho atualizou este quiz. Tente novamente.',409);
   }
   if(kind==='progress'){
    const lesson=safe(body.lessonId),score=Number(body.score),completed=body.completed===true;
    if(!LESSONS.some(l=>l.id===lesson))return fail('Aula inválida.');
    const a=await getVerifiedAccess(db,uid);if(!accessActive(a))return fail('O acesso ao curso está vencido. Solicite uma renovação.',403);
    const k=keyUser('progress',uid);
    for(let i=0;i<5;i++){
     const existing=await getMeta(db,k),v=existing?.data||{done:[],scores:{},lastLesson:'',updatedAt:''};
     const done=Array.isArray(v.done)?v.done.filter(x=>LESSONS.some(l=>l.id===x)):[];
     if(completed&&!done.includes(lesson))done.push(lesson);
     const scores={...(v.scores||{})};if(Number.isFinite(score)&&score>=0&&score<=100)scores[lesson]=Math.max(Number(scores[lesson]||0),Math.round(score));
     const next={done,scores,lastLesson:lesson,updatedAt:date()};
     const r=await put(db,k,next,existing?.etag);if(r.modified)return json({ok:true,progress:next,percent:Math.round(done.length*100/LESSONS.length)});
    }
    return fail('Outra atualização ocorreu. Tente salvar novamente.',409);
   }
   if(kind==='order'){
    if(auth.guest)return fail('Para comprar um plano, crie uma conta com e-mail e senha. Seu convite gratuito continua disponível.',403);
    const plan=str(body.plan);if(!['monthly','annual'].includes(plan))return fail('Plano inválido.');
    const settings=await config(db);if(!settings.enabled||!settings.pixKey)return fail('As vendas ainda não foram ativadas pelo professor.',503);
    const amount=Number(settings[plan]);if(!asCents(amount))return fail('Preço não configurado.',503);
    const orderId=id(),txid='TM'+orderId.slice(0,20).toUpperCase();
    const order={id:orderId,uid,email:str(u.email),plan,amount,txid,status:'pending',createdAt:date(),expiresAt:days(2)};
    await put(db,`orders/${orderId}`,order);
    return json({ok:true,order,pix:pixCode(settings,amount,txid)});
   }
   if(kind==='settings'||kind==='inviteCreate'||kind==='inviteRevoke'||kind==='inviteDelete'||kind==='approve'||kind==='reject'||kind==='orderArchive'||kind==='orderRevoke'){
    const err=requireAdmin(auth);if(err)return err;
    if(kind==='settings'){
     const previous=await config(db);
     const monthly=Number(body.monthly),annual=Number(body.annual),pixKey=str(body.pixKey).slice(0,90),merchantName=str(body.merchantName).slice(0,35),city=str(body.city).slice(0,30),enabled=body.enabled===true;
     if(!asCents(monthly)||!asCents(annual)||!merchantName||!city||enabled&&!pixKey)return fail('Preencha preços válidos e os dados Pix antes de ativar as vendas.');
     await setUnconditional(db,'settings',{monthly,annual,pixKey,merchantName,city,enabled,configured:true,updatedAt:date()});
     return json({ok:true,message:'Configurações salvas no Netlify. Novos pedidos usarão esses preços.'});
    }
    if(kind==='inviteCreate'){
     const durationDays=Number(body.durationDays),validDays=Number(body.validDays),email=str(body.email).toLowerCase();
     if(!Number.isInteger(durationDays)||durationDays<1||durationDays>365||!Number.isInteger(validDays)||validDays<1||validDays>90)return fail('Informe períodos de 1 a 365 dias de acesso e 1 a 90 dias de validade do convite.');
     if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return fail('E-mail do destinatário inválido.');
     const token=id(),iv={token,durationDays,expiresAt:days(validDays),email:email||null,createdAt:date(),claimedBy:null};
     await put(db,`invites/${token}`,iv);
     return json({ok:true,invite:{...iv,url:`${url.origin}/aluno.html?convite=${token}`}});
    }
    if(kind==='inviteRevoke'||kind==='inviteDelete'){
     const token=safe(body.token);
     if(!/^[a-f0-9]{32}$/.test(token))return fail('Identificador de convite inválido.');
     const key=`invites/${token}`;
     const previous=await getMeta(db,key);const iv=previous?.data;
     if(!iv)return fail('Convite não localizado.',404);
     const revokedAt=iv.revokedAt||date();
     const next={...iv,revokedAt, ...(kind==='inviteDelete'?{deletedAt:date()}:{} )};
     const saved=iv.revokedAt&&kind==='inviteRevoke'?{modified:true}:await put(db,key,next,previous.etag);
     if(!saved.modified)return fail('Este convite foi alterado em outro lugar. Atualize a página.',409);
     // Se ele já foi usado, retire APENAS o benefício gratuito associado.
     // Uma assinatura Pix paga nunca é cancelada por este comando.
     let revokedAccess=false;
     if(iv.claimedBy){
      const ak=keyUser('access',iv.claimedBy);
      for(let attempt=0;attempt<5;attempt++){
       const existing=await getMeta(db,ak);const a=existing?.data;
       if(!a)break;
       const originalExpiry=Date.parse(iv.claimedAt||'')+Number(iv.durationDays||0)*86400000;
       const matches=a.trialInviteToken===token ||
         (!a.trialInviteToken&&a.kind==='free'&&(!a.paidUntil||Date.parse(a.paidUntil)<=Date.now())&&
          Number.isFinite(originalExpiry)&&Math.abs(Date.parse(a.trialUntil||'')-originalExpiry)<900000);
       if(!matches)break;
       const result=await put(db,ak,{...a,trialUntil:new Date(0).toISOString(),trialInviteToken:token,trialRevokedAt:date()},existing?.etag);
       if(result.modified){revokedAccess=true;break}
      }
     }
     return json({ok:true,revokedAccess,message:revokedAccess?'Convite cancelado e acesso gratuito associado revogado.':'Convite cancelado. Acesso pago ou de outro convite preservado.'});
    }
    if(kind==='orderArchive'||kind==='orderRevoke'){
     const oid=safe(body.orderId);if(!/^[a-f0-9]{32}$/.test(oid))return fail('Pedido inválido.');
     const k=`orders/${oid}`,stored=await getMeta(db,k),order=stored?.data;if(!order)return fail('Pedido não encontrado.',404);
     if(kind==='orderArchive'){
      // Never delete financial evidence. Archiving only hides the record from the active view.
      if(order.archivedAt)return json({ok:true,message:'Registro já arquivado.'});
      const r=await put(db,k,{...order,archivedAt:date(),archivedBy:uid},stored.etag);
      return r.modified?json({ok:true,message:'Registro arquivado. O acesso do aluno não mudou.'}):fail('O pedido mudou. Atualize.',409);
     }
     if(order.status!=='approved')return fail('Somente pedidos aprovados podem ter a liberação anulada.',409);
     // Only revoke where we can prove this was the sole paid grant. Otherwise manual review.
     const ak=keyUser('access',order.uid),existing=await getMeta(db,ak),a=existing?.data;
     if(!a||!Array.isArray(a.appliedOrders)||!a.appliedOrders.includes(oid))return fail('Acesso relacionado não foi encontrado. Revise manualmente; nada foi alterado.',409);
     if(a.appliedOrders.some(x=>x!==oid))return fail('O aluno tem outros pedidos pagos. Anulação automática bloqueada para não prejudicar uma compra válida.',409);
     const next={...a,paidUntil:new Date(0).toISOString(),kind:Date.parse(a.trialUntil||'')>Date.now()?'free':'none',appliedOrders:[],paidRevokedAt:date(),paidRevokedOrder:oid};
     const revoked=await put(db,ak,next,existing.etag);
     if(!revoked.modified)return fail('Outro dispositivo alterou o acesso. Atualize a tela.',409);
     const checked=await getMeta(db,k);if(checked?.data?.status!=='approved')return fail('Acesso revogado, mas o pedido mudou. Consulte o histórico.',409);
     const marked=await put(db,k,{...checked.data,status:'revoked',revokedAt:date(),revokedBy:uid,revocationReason:'Aprovação administrativa anulada'},checked.etag);
     return marked.modified?json({ok:true,message:'Liberação paga anulada. Histórico financeiro preservado. Convites gratuitos válidos continuam funcionando.'}):fail('O acesso foi revogado; atualize a lista para conferir o pedido.',409);
    }
    if(kind==='approve'||kind==='reject'){
     const oid=safe(body.orderId);if(!/^[a-f0-9]{32}$/.test(oid))return fail('Pedido inválido.');
     const k=`orders/${oid}`,existing=await getMeta(db,k),order=existing?.data;if(!order)return fail('Pedido inexistente.',404);
     if(kind==='reject'){
      if(order.status==='approved')return fail('Pedido já aprovado; não é possível rejeitá-lo.',409);
      const r=await put(db,k,{...order,status:'rejected',reviewedAt:date()},existing.etag);return r.modified?json({ok:true}):fail('Pedido alterado simultaneamente.',409);
     }
     if(order.status==='rejected'||order.status==='revoked')return fail('Pedido rejeitado ou anulado.',409);
     // Double opt-in: an unrelated Pix bank notification NEVER confirms an Academy order.
     if(body.bankConfirmed!==true||body.orderReference!==oid.slice(0,8))return fail('Confira a entrada no banco e confirme o código do pedido antes de aprovar.',400);
     // Approval always requires manual bank verification. Retries repair an earlier partial grant.
     if(order.status==='pending'){
      const r=await put(db,k,{...order,status:'approved',reviewedAt:date()},existing.etag);if(!r.modified)return fail('Pedido alterado. Atualize a lista.',409);
     }
     const period=order.plan==='annual'?12:1;
     const access=await grant(db,order.uid,prev=>{
      const already=Array.isArray(prev.appliedOrders)?prev.appliedOrders:[];
      if(already.includes(oid))return prev;
      const start=Math.max(Date.now(),Date.parse(prev.paidUntil||'')||0);const dt=new Date(start);dt.setUTCMonth(dt.getUTCMonth()+period);
      return {...prev,kind:'paid',paidUntil:dt.toISOString(),appliedOrders:[...already.slice(-30),oid]};
     });
     return json({ok:true,access:entitle(access)});
    }
   }
   return fail('Ação inválida.',404);
  }
  // V405: bancos originais servidos somente depois da autenticação e validação do acesso.
  if(['quizBank','practiceCatalog','practiceItem'].includes(action)){
   const acc=await getVerifiedAccess(db,uid);
   if(!accessActive(acc))return fail('Seu acesso ao curso não está ativo.',403);
   if(action==='quizBank'){
    const key=safe(url.searchParams.get('id'));
    const item=ACADEMY_QUIZ_BANKS[key];
    return item?json({ok:true,quiz:item}):fail('Quiz não encontrado.',404);
   }
   const area=safe(url.searchParams.get('area')).toLowerCase();
   if(action==='practiceCatalog'){
    if(!['reading','listening','vocabulary'].includes(area))return fail('Área inválida.',400);
    const bank=area==='reading'?ACADEMY_READING_BANK:area==='listening'?ACADEMY_LISTENING_BANK:ACADEMY_VOCABULARY_BANK;
    return json({ok:true,items:bank.map((v,i)=>({id:area==='vocabulary'?String(i):v.id,title:v.title||v.name,level:v.level||'',count:v.questions?.length||v.words?.length||0}))});
   }
   if(action==='practiceItem'){
    if(area==='speaking')return json({ok:true,html:ACADEMY_SPEAKING_HTML});
    const key=str(url.searchParams.get('id'));
    const bank=area==='reading'?ACADEMY_READING_BANK:area==='listening'?ACADEMY_LISTENING_BANK:area==='vocabulary'?ACADEMY_VOCABULARY_BANK:null;
    if(!bank)return fail('Área inválida.',400);
    const item=area==='vocabulary'?(/^(?:0|[1-9]\d{0,2})$/.test(key)?bank[Number(key)]:null):bank.find(v=>v.id===key);
    return item?json({ok:true,item}):fail('Atividade não encontrada.',404);
   }
  }
  if(action==='enemPractice'){
   const a=await getVerifiedAccess(db,uid);if(!accessActive(a))return fail('Seu acesso ao curso está vencido.',403);
   // Treino de interpretação com textos do banco escolar existente.
   // Não se apresenta como reprodução oficial de questões do ENEM.
   const questions=[];
   for(const item of ACADEMY_READING_BANK){
     const picks=(item.questions||[]).slice(0,2);
     for(const q of picks)questions.push({readingTitle:item.title,textHtml:item.textHtml||'',prompt:q.q||'',options:q.choices||[],correct:q.answer,explanation:q.comment||''});
   }
   for(const item of ACADEMY_READING_BANK.slice(0,4)){
     const q=(item.questions||[])[2];if(q)questions.push({readingTitle:item.title,textHtml:item.textHtml||'',prompt:q.q||'',options:q.choices||[],correct:q.answer,explanation:q.comment||''});
   }
   if(questions.length!==60)return fail('O acervo de 60 questões ainda precisa ser completado pelo professor.',503);
   return json({ok:true,questions});
  }
  if(action==='studentKit'){
    const a=await getVerifiedAccess(db,uid);
    if(!accessActive(a))return fail('Sua matrícula não está ativa. Renove o acesso para continuar.',403);
    return json({ok:true,html:ACADEMY_STUDY_HTML});
  }
  if(action==='me'){
   if(!auth.guest)await student(db,u);const acc=await getVerifiedAccess(db,uid),prog=await get(db,keyUser('progress',uid)),quizProg=await get(db,keyUser('quizprogress',uid));const enemProg=await get(db,keyUser('enemprogress',uid));
   return json({ok:true,user:{id:uid,email:u.email||'',name:u.name||u.userMetadata?.full_name||'',guest:!!auth.guest},access:entitle(acc),progress:prog||{done:[],scores:{},lastLesson:''},quizProgress:quizProg||{scores:{},attempts:{}},enemProgress:enemProg||{attempts:0,bestScore:0},admin:!!admin(u)});
  }
  if(action==='lesson'){
   const a=await getVerifiedAccess(db,uid);if(!accessActive(a))return fail('Seu período de acesso expirou. O progresso continua guardado.',403);
   const lesson=LESSONS.find(x=>x.id===safe(url.searchParams.get('id')));if(!lesson)return fail('Aula não encontrada.',404);
   return json({ok:true,lesson});
  }
  if(action==='orders'){
   const keys=await list(db,'orders/');const orders=[];
   for(const k of keys){const o=await get(db,k);if(o?.uid===uid)orders.push(o)}
   return json({ok:true,orders:orders.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,20)});
  }
  if(['admin','adminRoster','adminOrders','adminInvites'].includes(action)){
   const err=requireAdmin(auth);if(err)return err;
   if(action==='admin')return json({ok:true,settings:await config(db),adminEmail:u.email});
   if(action==='adminOrders'){
    const keys=await list(db,'orders/'),records=[];for(const k of keys){const rec=await get(db,k);if(rec)records.push(rec)}
    return json({ok:true,orders:records.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,300)});
   }
   if(action==='adminInvites'){
    const keys=await list(db,'invites/'),records=[];for(const k of keys){const rec=await get(db,k);if(rec&&!rec.deletedAt)records.push({...rec,tokenHash:sha(k.slice(8)).slice(0,12),token:k.slice(8)})}
    return json({ok:true,invites:records.slice(0,300)});
   }
   if(action==='adminRoster'){
    const keys=await list(db,'students/'),records=[];
    for(const k of keys){const stu=await get(db,k);if(!stu)continue;const a=await getVerifiedAccess(db,stu.id),p=await get(db,keyUser('progress',stu.id));records.push({...stu,access:entitle(a),completed:(p?.done||[]).length,lastLesson:p?.lastLesson||'',updatedAt:p?.updatedAt||''})}
    return json({ok:true,students:records.slice(0,300)});
   }
  }
  return fail('Ação não encontrada.',404);
 }catch(err){console.error('TM391 Academy error',err);return fail('Não foi possível concluir a operação. Consulte os logs da função no Netlify.',500)}
}
