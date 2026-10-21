/** Teacher Marks V406: video library with access control for each request.
 * Uploads are stored privately in Netlify Blobs. No public URL or browser-only access flag.
 * Intended for videos up to 96 MiB, uploaded in authenticated 512-KiB chunks. For large files, publish an external hosted link instead.
 */
import {getUser, refreshSession, verifyRequestOrigin} from '@netlify/identity';
import {getStore} from '@netlify/blobs';
import {randomBytes,createHash} from 'node:crypto';
const storeName='tm-academy-v391',MAX_BYTES=96*1024*1024,CHUNK=512*1024,MAX_ITEMS=100;
const j=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
const fail=(msg,status=400)=>j({ok:false,error:msg},status);
const safe=x=>String(x||'').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,90);
const sha=x=>createHash('sha256').update(String(x)).digest('hex');
const cookie=(req,k)=>{const x=String(req.headers.get('cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(k+'='));return x?decodeURIComponent(x.slice(k.length+1)):''};
const load=(db,k)=>db.get(k,{type:'json',consistency:'strong'});
const meta=(db,k)=>db.getWithMetadata(k,{type:'json',consistency:'strong'});
const set=(db,k,x)=>db.set(k,JSON.stringify(x));
async function editIndex(db,change){
 for(let attempt=0;attempt<6;attempt++){
  const previous=await meta(db,'video-library/index'),values=Array.isArray(previous?.data)?previous.data:[];
  const updated=change(values);
  const r=await db.set('video-library/index',JSON.stringify(updated),{...(previous?.etag?{onlyIfMatch:previous.etag}:{onlyIfNew:true})});
  if(r.modified)return;
 }
 throw Error('Outra publicação de vídeo ocorreu ao mesmo tempo. Recarregue a lista.');
}
async function auth(req,db){
 try{await refreshSession()}catch{};let u;try{u=await getUser()}catch{}
 if(!u?.id)return null;
 const key=cookie(req,'tm_academy_session');if(!/^[a-f0-9]{64}$/.test(key))return null;
 const s=await load(db,`sessions/${sha(key)}`);
 if(!s||s.uid!==u.id||Date.now()-Number(s.lastSeen||0)>86400000)return null;
 const admin=String(process.env.TM_ADMIN_EMAIL||'').toLowerCase()===String(u.email||'').toLowerCase();
 const a=await load(db,`access/${safe(u.id)}`);
 // A revogação de convites é conferida também antes de servir cada parte de vídeo.
 const paid=!!(a?.paidUntil&&Date.parse(a.paidUntil)>Date.now());
 let trial=!!(a?.trialUntil&&Date.parse(a.trialUntil)>Date.now());
 if(trial&&a.trialInviteToken){
  const iv=await load(db,`invites/${safe(a.trialInviteToken)}`);
  const actualExpiry=Date.parse(iv?.claimedAt||'')+Number(iv?.durationDays||0)*86400000;
  trial=!!(iv&&!iv.revokedAt&&!iv.deletedAt&&iv.claimedBy===u.id&&Number.isFinite(actualExpiry)&&actualExpiry>Date.now());
 }
 const active=paid||trial;
 return {u,admin,active};
}
const validYoutube=url=>{
 try{const u=new URL(url);return u.protocol==='https:'&&['youtube.com','www.youtube.com','youtu.be','www.youtube-nocookie.com','vimeo.com','player.vimeo.com'].includes(u.hostname)}catch{return false}
};
const publicMeta=v=>({id:v.id,title:v.title,description:v.description,published:!!v.published,lessonId:v.lessonId,createdAt:v.createdAt,type:v.type,url:v.type==='link'?v.url:undefined,contentType:v.contentType,size:v.size,total:v.total});
export default async function handler(req){try{
 const db=getStore({name:storeName,consistency:'strong'});
 const access=await auth(req,db);if(!access)return fail('Entre novamente na Academia.',401);
 const url=new URL(req.url),action=String(url.searchParams.get('action')||'catalog');
 if(req.method==='GET'){
  if(action==='catalog'){
   if(!access.active&&!access.admin)return fail('Seu acesso ao curso está inativo.',403);
   const index=await load(db,'video-library/index')||[];const out=[];
   for(const item of index.slice(0,MAX_ITEMS)){const row=await load(db,`video-library/${safe(item)}`);if(row&&(access.admin||row.published)&&row.status==='ready')out.push(publicMeta(row))}
   return j({ok:true,videos:out});
  }
  if(action==='chunk'){
   if(!access.active&&!access.admin)return fail('Sem acesso autorizado.',403);
   const vid=safe(url.searchParams.get('id'));const n=Number(url.searchParams.get('n'));
   const row=await load(db,`video-library/${vid}`);if(!row||row.type!=='upload'||row.status!=='ready'||(!row.published&&!access.admin))return fail('Vídeo indisponível.',404);
   if(!Number.isInteger(n)||n<0||n>=row.total)return fail('Parte inválida.');
   const data=await db.get(`video-library/data/${vid}/${n}`,{type:'text',consistency:'strong'});
   return data?j({ok:true,data,contentType:row.contentType}):fail('Parte indisponível.',404);
  }
  return fail('Ação inválida.',404);
 }
 if(req.method!=='POST')return fail('Método não permitido.',405);
 verifyRequestOrigin(req);
 if(!access.admin)return fail('Operação exclusiva do professor.',403);
 if(Number(req.headers.get('content-length')||0)>850000)return fail('Parte acima do limite permitido.',413);
 const b=await req.json().catch(()=>null);if(!b||typeof b!=='object')return fail('Dados inválidos.');
 const kind=String(b.action||'');
 if(kind==='initUpload'){
  const size=Number(b.size),total=Math.ceil(size/CHUNK),type=String(b.contentType||'');
  if(!Number.isInteger(size)||size<1||size>MAX_BYTES||!['video/mp4','video/webm','video/ogg'].includes(type))return fail('Apenas vídeo MP4/WebM/OGG até 96 MB. Para arquivos maiores, use um link de hospedagem.',413);
  const id=randomBytes(12).toString('hex');const item={id,type:'upload',contentType:type,size,total,title:'Nova videoaula',description:'',lessonId:'',published:false,status:'uploading',createdAt:new Date().toISOString()};
  await set(db,`video-library/${id}`,item);return j({ok:true,id,total,chunkSize:CHUNK});
 }
 if(kind==='uploadChunk'){
  const id=safe(b.id),index=Number(b.index),data=String(b.data||'');
  const item=await load(db,`video-library/${id}`);
  if(!item||item.type!=='upload'||item.status!=='uploading')return fail('Envio não encontrado.',404);
  if(!Number.isInteger(index)||index<0||index>=item.total||data.length>Math.ceil(CHUNK*4/3)+30||!/^[A-Za-z0-9+/]+={0,2}$/.test(data))return fail('Parte de vídeo inválida.');
  const length=Buffer.from(data,'base64').length;
  const expected=index===item.total-1?item.size-CHUNK*(item.total-1):CHUNK;
  if(length!==expected)return fail('Tamanho da parte não corresponde ao envio.',400);
  await db.set(`video-library/data/${id}/${index}`,data);
  return j({ok:true,index});
 }
 if(kind==='finishUpload'){
  const id=safe(b.id),key=`video-library/${id}`,item=await load(db,key);
  if(!item||item.type!=='upload'||item.status!=='uploading')return fail('Envio não encontrado.',404);
  for(let i=0;i<item.total;i++)if(await db.get(`video-library/data/${id}/${i}`,{type:'text',consistency:'strong'})==null)return fail(`Parte ${i+1} ainda não foi enviada.`,409);
  await set(db,key,{...item,status:'ready'});
  await editIndex(db,index=>[id,...index.filter(v=>v!==id)].slice(0,MAX_ITEMS));
  return j({ok:true,id});
 }
 if(kind==='createLink'){
  if(!validYoutube(String(b.url||'')))return fail('Use um link HTTPS de vídeo do YouTube ou Vimeo.');
  const id=randomBytes(12).toString('hex'),item={id,type:'link',url:String(b.url).slice(0,500),contentType:'',size:0,total:0,status:'ready',published:false,title:'Nova videoaula',description:'',lessonId:'',createdAt:new Date().toISOString()};
  await set(db,`video-library/${id}`,item);
  await editIndex(db,index=>[id,...index.filter(v=>v!==id)].slice(0,MAX_ITEMS));return j({ok:true,id});
 }
 if(kind==='save'){
  const id=safe(b.id),key=`video-library/${id}`;const existing=await meta(db,key);if(!existing?.data)return fail('Videoaula não encontrada.',404);
  const cur=existing.data;
  if(cur.status!=='ready')return fail('Conclua o envio do vídeo antes de publicar.',409);
  const title=String(b.title||'').trim().slice(0,130),description=String(b.description||'').trim().slice(0,12000),lessonId=safe(b.lessonId||'');
  if(!title)return fail('Informe o título da videoaula.');
  if(lessonId&&!/^L(?:0[1-9]|[1-4][0-9]|50)$/.test(lessonId))return fail('Aula vinculada inválida.');
  const updated=await db.set(key,JSON.stringify({...cur,title,description,lessonId,published:b.published===true,updatedAt:new Date().toISOString()}),{onlyIfMatch:existing.etag});
  return updated.modified?j({ok:true}):fail('Outro dispositivo alterou o cadastro.',409);
 }
 if(kind==='delete'){
  const id=safe(b.id);const key=`video-library/${id}`,row=await load(db,key);if(!row)return fail('Vídeo não encontrado.',404);
  // Remove from catalog before deletion; old active student tab is denied by missing metadata.
  await db.set(key,JSON.stringify({...row,published:false,status:'deleted'}));
  await editIndex(db,index=>index.filter(x=>x!==id));
  return j({ok:true});
 }
 return fail('Ação inválida.',404);
}catch(e){console.error('Teacher Marks video error',e);return fail('Falha no armazenamento das videoaulas. Confira os logs no Netlify.',500)}}
