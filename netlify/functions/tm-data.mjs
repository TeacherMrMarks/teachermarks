/**
 * Teacher Marks V390 — armazenamento online por registro no Netlify Blobs.
 * Esta interface e o servidor preservam a identidade do usuário e evitam
 * substituições silenciosas via ETag/compare-and-swap.
 * Não remove nem altera os snapshots V389 de tm-cloud.mjs.
 */
import { getUser, verifyRequestOrigin } from '@netlify/identity';
import { getStore } from '@netlify/blobs';

const STORE='teacher-marks-records-v390';
const MAX_BYTES=4_400_000, MAX_KEYS=900;
const send=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const safe=v=>String(v||'').replace(/[^\w.-]/g,'').slice(0,100);
const prefix=u=>`users/${safe(u.id)}/records/`;
const validKey=k=>typeof k==='string'&&k.length>0&&k.length<=550&&!/[\u0000-\u001f]/.test(k)&&Buffer.byteLength(k,'utf8')<=370;
const id=(u,k)=>prefix(u)+Buffer.from(k,'utf8').toString('base64url');
async function checkUser(){return await getUser();}
export default async function handler(req){
 try{
  const user=await checkUser();
  if(!user?.id)return send({ok:false,error:'Entre na sua conta do Teacher Marks para salvar no servidor.'},401);
  const db=getStore({name:STORE,consistency:'strong'});
  const url=new URL(req.url),action=url.searchParams.get('action')||'list';
  if(req.method==='GET'){
   if(action==='health')return send({ok:true,version:'V390',user:user.id});
   if(action==='list'){
    const listed=await db.list({prefix:prefix(user)});
    const blobs=listed.blobs.slice(0,MAX_KEYS+1);
    if(blobs.length>MAX_KEYS)return send({ok:false,error:'Quantidade acima do limite de segurança.'},413);
    // Codificamos a chave em base64url no identificador do Blob. Assim a listagem
    // retorna nomes + ETags em UMA chamada, sem consultar metadata de cada registro.
    // Importante: o limite de bytes da chave evita exceder o limite do Netlify.
    const records=[];
    for(const blob of blobs){
      const slug=blob.key.slice(prefix(user).length);
      let name='';try{name=Buffer.from(slug,'base64url').toString('utf8')}catch{}
      if(validKey(name)&&id(user,name)===blob.key)records.push({key:name,etag:blob.etag});
    }
    return send({ok:true,records});
   }
   if(action==='read'){
    const key=url.searchParams.get('key');
    if(!validKey(key))return send({ok:false,error:'Chave inválida.'},400);
    const entry=await db.getWithMetadata(id(user,key),{type:'text',consistency:'strong'});
    if(!entry)return send({ok:true,found:false,key});
    if(entry.metadata?.name!==key)return send({ok:false,error:'Integridade do registro inválida.'},500);
    return send({ok:true,found:true,key,value:entry.data,etag:entry.etag,updatedAt:entry.metadata.updatedAt||''});
   }
   return send({ok:false,error:'Ação inválida.'},400);
  }
  if(req.method!=='POST')return send({ok:false,error:'Método não permitido.'},405);
  verifyRequestOrigin(req);
  if(Number(req.headers.get('content-length')||0)>MAX_BYTES+2000)return send({ok:false,error:'Registro muito grande.'},413);
  const body=await req.json();
  if(body?.action!=='write')return send({ok:false,error:'Ação inválida.'},400);
  const key=body.key,value=body.value,expected=body.expected;
  if(!validKey(key)||typeof value!=='string'||!['string'].includes(typeof expected))return send({ok:false,error:'Dados do registro inválidos.'},400);
  if(new TextEncoder().encode(value).byteLength>MAX_BYTES)return send({ok:false,error:'Registro excede 4,4 MB. Salve como arquivo separado ou divida o conteúdo.'},413);
  if(expected.length>200)return send({ok:false,error:'Revisão inválida.'},400);
  const recordKey=id(user,key);
  const before=await db.getMetadata(recordKey,{consistency:'strong'});
  const revision=before?.etag||'';
  if(revision!==expected)return send({ok:false,conflict:true,error:'Este registro foi alterado em outro dispositivo. A versão local não foi substituída.',current:revision},409);
  const updatedAt=new Date().toISOString();
  const options=before?{onlyIfMatch:revision}:{onlyIfNew:true};
  const written=await db.set(recordKey,value,{...options,metadata:{name:key,updatedAt}});
  if(!written.modified||!written.etag)return send({ok:false,conflict:true,error:'Outra gravação foi concluída antes desta. Nada foi substituído.',current:(await db.getMetadata(recordKey,{consistency:'strong'}))?.etag||''},409);
  return send({ok:true,key,etag:written.etag,updatedAt});
 }catch(e){
  console.error('[TeacherMarks V390] Falha em armazenamento de registros:',e);
  return send({ok:false,error:'O servidor não concluiu a operação. Verifique os registros das Functions no Netlify.'},500);
 }
}
