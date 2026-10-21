/* Teacher Marks V406 supplemental protected learning areas */
(()=>{'use strict';
const $=id=>document.getElementById(id);
let vocabCatalog=[],vocabIndex=0,wordIndex=0,vocabMode='flash',vocabAnswers=[],vocabScore=0,enemLoaded=false,videoObjects=[];
const api=()=>window.TM406Bridge;
const el=(tag,txt,cls)=>{const d=document.createElement(tag);if(txt!=null)d.textContent=txt;if(cls)d.className=cls;return d};
const btn=(name,fn,cls='btn small')=>{const d=el('button',name,cls);d.type='button';d.onclick=fn;return d};
const msg=(s)=>{const x=$('resourceMessage');if(x)x.textContent=s};
const voice=(txt)=>{if(!('speechSynthesis'in window))return;window.speechSynthesis.cancel();const v=new SpeechSynthesisUtterance(txt);v.lang='en-US';v.rate=.87;speechSynthesis.speak(v)};
async function vocabulary(){
 const list=$('resourceList'),detail=$('resourceDetail');list.hidden=true;detail.hidden=false;detail.replaceChildren();msg('Carregando temas de vocabulário…');
 try{
  if(!vocabCatalog.length){const d=await api().get('practiceCatalog',{area:'vocabulary'});vocabCatalog=d.items||[]}
  const picker=el('select',null,'tm406-vocab-select');picker.setAttribute('aria-label','Escolher tema');
  vocabCatalog.forEach((r,i)=>{const o=el('option',(i+1)+'. '+r.title+' · '+r.count+' palavras');o.value=String(i);picker.append(o)});
  picker.value=String(vocabIndex);picker.onchange=()=>{vocabIndex=Number(picker.value);wordIndex=0;vocabAnswers=[];loadVocabTheme()};
  const header=el('div');const title=el('h3','🧠 Vocabulary · Treino completo');header.append(title,picker);
  const bar=el('div',null,'tm406-vocab-toolbar');
  const names=[['flash','🃏 Flashcards'],['match','🔗 Match'],['quiz','✅ Quiz'],['listen','🎧 Listen & Choose'],['type','⌨️ Type It']];
  names.forEach(([mode,text])=>bar.append(btn(text,()=>{vocabMode=mode;wordIndex=0;vocabAnswers=[];renderVocab()},'btn small')));
  const stage=el('div');stage.id='tm406VocabularyStage';detail.append(header,bar,stage);await loadVocabTheme();
 }catch(e){msg('Erro ao carregar vocabulário: '+e.message)}
}
let currentWords=[];
async function loadVocabTheme(){
 try{const d=await api().get('practiceItem',{area:'vocabulary',id:String(vocabIndex)});currentWords=d.item.words||[];wordIndex=0;vocabScore=0;vocabAnswers=[];renderVocab();msg('Tema disponível: '+currentWords.length+' palavras.')}catch(e){msg(e.message)}
}
function sampleChoices(i){const right=currentWords[i];const pool=currentWords.map(w=>w.t).filter(t=>t!==right.t);pool.sort(()=>Math.random()-.5);return [right.t,...pool.slice(0,3)].sort(()=>Math.random()-.5)}
function renderVocab(){const stage=$('tm406VocabularyStage');if(!stage)return;stage.replaceChildren();if(!currentWords.length){stage.append(el('p','Tema sem palavras.'));return}const w=currentWords[wordIndex%currentWords.length];const total=currentWords.length;
 const head=el('h3',(vocabCatalog[vocabIndex]?.title||'Vocabulário')+' · '+(wordIndex+1)+' / '+total);stage.append(head);
 const feedback=el('p',null,'tm406-vocab-result');
 const controls=el('div',null,'tm406-vocab-toolbar');
 const next=()=>{wordIndex=(wordIndex+1)%total;renderVocab()};
 if(vocabMode==='flash'){
  const tile=el('button',w.w,'tm406-vocab-card');tile.type='button';tile.setAttribute('aria-label','Virar cartão de vocabulário');let flipped=false;
  tile.onclick=()=>{flipped=!flipped;tile.textContent=flipped?w.t:w.w};stage.append(tile);
  stage.append(el('p','Clique no cartão para ver o significado. '+(w.e||'')));
  controls.append(btn('← Anterior',()=>{wordIndex=(wordIndex-1+total)%total;renderVocab()}),btn('🔊 Ouvir',()=>voice(w.w)),btn('Virar cartão',()=>tile.click()),btn('Próximo →',next));
 }else if(vocabMode==='match'){
  const batch=currentWords.slice(wordIndex,wordIndex+6);if(!batch.length){wordIndex=0;renderVocab();return}
  stage.append(el('p','Combine cada palavra em inglês com seu significado. '+batch.length+' pares por rodada.'));
  const grid=el('div',null,'tm406-vocab-match-grid'),left=el('div'),right=el('div');
  let chosen=null,matched=0;const used=new Set();const shuffle=x=>[...x].sort(()=>Math.random()-.5);
  function choose(side,w,button){
   if(used.has(w.w))return;
   if(!chosen){chosen={side,w,button};button.style.outline='3px solid #e8ae44';return}
   if(chosen.side===side){chosen.button.style.outline='';chosen={side,w,button};button.style.outline='3px solid #e8ae44';return}
   const good=chosen.w.w===w.w;chosen.button.style.outline='';
   if(good){used.add(w.w);matched++;chosen.button.disabled=true;button.disabled=true;chosen.button.style.opacity='.45';button.style.opacity='.45';feedback.textContent='✓ '+matched+' / '+batch.length+' pares combinados';}
   else{feedback.textContent='Ainda não. Tente outra combinação.'}
   chosen=null;if(good&&matched===batch.length){controls.append(btn('Próximos pares →',()=>{wordIndex=(wordIndex+batch.length)%total;renderVocab()}));feedback.textContent+=' · Rodada concluída!'}
  }
  shuffle(batch).forEach(x=>left.append(btn(x.w,function(){choose('en',x,this)},'btn small tm406-match-item')));
  shuffle(batch).forEach(x=>right.append(btn(x.t,function(){choose('pt',x,this)},'btn small tm406-match-item')));
  grid.append(left,right);stage.append(grid,feedback)
 }else if(vocabMode==='quiz'){
  stage.append(el('h3','Selecione a tradução correta de: '+w.w));sampleChoices(wordIndex).forEach(x=>controls.append(btn(x,()=>{feedback.textContent=x===w.t?'✓ Correto!':'A resposta é '+w.t;stage.append(feedback);setTimeout(next,950)})));
 }else if(vocabMode==='listen'){
  stage.append(el('h3','Ouça e selecione o significado.'));stage.append(btn('🔊 Ouvir palavra',()=>voice(w.w)));
  sampleChoices(wordIndex).forEach(x=>controls.append(btn(x,()=>{feedback.textContent=x===w.t?'✓ Muito bem!':'Resposta: '+w.t;stage.append(feedback);setTimeout(next,950)})));
  setTimeout(()=>voice(w.w),100);
 }else{
  stage.append(el('h3','Escreva em inglês: '+w.t));const input=el('input');input.autocomplete='off';input.placeholder='Digite a palavra em inglês';input.style.cssText='max-width:550px;width:100%;padding:13px;border:1px solid #bacfca;border-radius:10px';
  const check=()=>{const ok=input.value.trim().toLowerCase()===w.w.toLowerCase();feedback.textContent=ok?'✓ Correto!':'Resposta: '+w.w;stage.append(feedback);if(ok)vocabScore++};
  input.onkeydown=e=>{if(e.key==='Enter')check()};stage.append(input);controls.append(btn('Conferir',check),btn('Próximo →',next));
 }
 stage.append(controls);if(vocabMode!=='flash'&&vocabMode!=='type')stage.append(btn('Pular →',next));
}
async function enem(){const h=api()?.user()?.enemProgress;const status=$('enemHistorySummary');if(status&&h)status.textContent=h.attempts?'Seu histórico: '+h.attempts+' simulado(s) realizado(s) · melhor resultado: '+h.bestScore+'%.':'Ainda não há simulados concluídos nesta conta.';if(enemLoaded)return;const root=$('academyEnemContent');if(!root)return;root.replaceChildren(btn('Iniciar simulado de 60 questões',startEnem,'btn primary'));}
async function startEnem(){const root=$('academyEnemContent');root.replaceChildren(el('p','Preparando 60 questões…'));try{
 const response=await api().get('enemPractice');const items=response.questions||[];if(items.length!==60)throw Error('O banco de 60 questões não está completo.');enemLoaded=true;
 root.replaceChildren(el('p','60 questões · preparação em leitura e interpretação. Responda todas antes de corrigir.','small muted'));
 const selected=Array(items.length).fill(-1),blocks=[];
 let passage='';items.forEach((q,i)=>{
  if(q.readingTitle!==passage){passage=q.readingTitle;root.append(el('h3','Texto: '+passage));const div=el('div',null,'academy-resource-content');
   const parser=new DOMParser().parseFromString(q.textHtml||'','text/html');parser.querySelectorAll('script,style,iframe,object,embed,form,link,meta,svg,video,audio').forEach(x=>x.remove());
   for(const x of parser.body.querySelectorAll('*'))for(const a of [...x.attributes]){if(a.name.startsWith('on')||['srcdoc','contenteditable','style'].includes(a.name)||(['href','src'].includes(a.name)&&!/^(?:https?:|data:image\/(?:png|jpeg|webp|gif);base64,)/i.test(String(a.value||''))))x.removeAttribute(a.name)}
   div.innerHTML=parser.body.innerHTML;root.append(div)}
  const box=el('div',null,'tm406-enem-section'),title=el('h4',(i+1)+'. '+q.prompt);box.append(title);
  q.options.forEach((v,k)=>{const b=btn(String.fromCharCode(65+k)+') '+v,()=>{if(box.dataset.graded)return;selected[i]=k;box.querySelectorAll('button').forEach((z,n)=>z.classList.toggle('selected',n===k))},'quiz-option');box.append(b)});
  root.append(box);blocks.push(box);
 });
 const result=el('div',null,'notice');const finish=btn('Concluir e corrigir 60 questões',async()=>{
  if(selected.some(v=>v<0)){result.textContent='Responda todas as 60 questões antes de concluir.';return}
  let hits=0;items.forEach((q,i)=>{const good=selected[i]===q.correct;if(good)hits++;blocks[i].dataset.graded='1';blocks[i].append(el('p',(good?'✓ Correto. ':'✗ Resposta: '+String.fromCharCode(65+q.correct)+'. ')+(q.explanation||''),'small'))});
  const percent=Math.round(hits*100/items.length);result.textContent='Resultado: '+hits+' / 60 ('+percent+'%). Gravando no Netlify…';finish.disabled=true;
  try{const saved=await api().post('enemResult',{score:percent,correct:hits});const user=api().user();if(user)user.enemProgress=saved.progress;const h=$('enemHistorySummary');if(h)h.textContent='Seu histórico: '+saved.progress.attempts+' simulado(s) · melhor resultado '+saved.progress.bestScore+'%.';result.textContent='✓ Resultado: '+hits+' / 60 ('+percent+'%). Histórico salvo na sua conta.'}catch(e){result.textContent='Resultado: '+hits+' / 60. ⚠ Não foi possível salvar: '+e.message}
 },'btn primary');root.append(finish,result);
 }catch(e){root.replaceChildren(el('p','Não foi possível abrir o simulado: '+e.message))}}
const VIDEO_API='/.netlify/functions/tm-academy-video';
async function videoFetch(action,params={}){const u=new URL(VIDEO_API,location.origin);u.searchParams.set('action',action);for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);const r=await fetch(u,{credentials:'same-origin'});const j=await r.json().catch(()=>({}));if(!r.ok||!j.ok)throw Error(j.error||'Falha na videoaula.');return j}
async function videos(){const root=$('academyVideoList'),detail=$('academyVideoDetail');detail.hidden=true;detail.replaceChildren();root.replaceChildren();$('academyVideoStatus').textContent='Carregando videoaulas…';try{
 const r=await videoFetch('catalog');videoObjects=r.videos||[];
 if(!videoObjects.length){$('academyVideoStatus').textContent='Ainda não há videoaulas publicadas pelo professor.';return}
 $('academyVideoStatus').textContent=videoObjects.length+' videoaula(s) disponíveis.';
 for(const item of videoObjects){const c=el('button',null,'tm406-video-card');c.type='button';c.append(el('strong','▶ '+item.title),el('small',item.lessonId?'Vinculada à aula '+item.lessonId:'Videoaula complementar'));c.onclick=()=>openVideo(item);root.append(c)}
 }catch(e){$('academyVideoStatus').textContent='⚠ '+e.message}}
async function openVideo(item){let fresh;try{fresh=await videoFetch('catalog')}catch(e){$('academyVideoStatus').textContent='Não foi possível conferir esta videoaula no servidor: '+e.message;return}if(!fresh.videos?.some(v=>v.id===item.id)){await videos();$('academyVideoStatus').textContent='Esta videoaula foi retirada pelo professor. A lista foi atualizada.';return}const detail=$('academyVideoDetail');detail.hidden=false;detail.replaceChildren();detail.append(btn('← Voltar aos vídeos',()=>{detail.hidden=true;detail.replaceChildren()}),el('h3',item.title));
 const slot=el('div');slot.textContent='Carregando vídeo…';detail.append(slot);
 try{
  if(item.type==='link'){
   const u=new URL(item.url);let src='';if(['youtube.com','www.youtube.com','www.youtube-nocookie.com'].includes(u.hostname)){const id=u.searchParams.get('v')||u.pathname.match(/\/embed\/([\w-]+)/)?.[1];if(id)src='https://www.youtube-nocookie.com/embed/'+id}
   if(u.hostname==='youtu.be')src='https://www.youtube-nocookie.com/embed/'+u.pathname.slice(1).split('/')[0];
   if(['vimeo.com','player.vimeo.com'].includes(u.hostname)){const id=u.pathname.match(/\d+/)?.[0];if(id)src='https://player.vimeo.com/video/'+id}
   if(!src)throw Error('Link de vídeo inválido para reprodução.');
   const frame=el('iframe');frame.src=src;frame.title=item.title;frame.allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';frame.allowFullscreen=true;frame.referrerPolicy='strict-origin-when-cross-origin';frame.style.cssText='width:100%;aspect-ratio:16/9;border:0;border-radius:12px';slot.replaceWith(frame);
  }else{
   const chunks=[];for(let i=0;i<item.total;i++){
    slot.textContent='Carregando vídeo: '+(i+1)+' / '+item.total;
    const part=await videoFetch('chunk',{id:item.id,n:String(i)});
    const decoded=atob(part.data);const bytes=new Uint8Array(decoded.length);for(let n=0;n<decoded.length;n++)bytes[n]=decoded.charCodeAt(n);chunks.push(bytes)
   }
   const blob=new Blob(chunks,{type:item.contentType});const url=URL.createObjectURL(blob);
   const vid=el('video',null,'tm406-video-player');vid.controls=true;vid.preload='metadata';vid.src=url;slot.replaceWith(vid);
   vid.addEventListener('emptied',()=>URL.revokeObjectURL(url),{once:true});
  }
  if(item.description){const d=el('div',null,'academy-resource-content');d.textContent=item.description;d.style.whiteSpace='pre-wrap';detail.append(el('h4','📝 Explicação do professor'),d)}
 }catch(e){slot.textContent='⚠ '+e.message}
 detail.scrollIntoView({behavior:'smooth',block:'start'});
}
function courseProgress(progress){const done=progress?.done||[];const moments=progress?.moments||{};let total=0;for(const x of Object.values(moments))if(Array.isArray(x))total+=x.length;const status=$('academyFullStatus');if(status)status.textContent='✓ '+done.length+' / 50 aulas completas · '+total+' / 350 etapas registradas no Netlify.'}
window.TM406={vocabulary,enem,videos,courseProgress};
})();
