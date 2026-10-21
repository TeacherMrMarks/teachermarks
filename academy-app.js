/* Teacher Marks V391 student UI. All authorizations and progress are checked on the server. */
(()=>{'use strict';
const API='/.netlify/functions/tm-academy', $=id=>document.getElementById(id);
let mode='login', me=null, catalog=[], lesson=null, answers=[], selectedPlan='', pendingPlan='';
let academyKit=null, lastFullLessonId='L01', academyQueue=null, academySaving=false, academyWriteTimer=null;
let currentWorkspace='home', activeKitArea='course', frameLoaded=false, resourceArea='', resourceToken=0, resourceAudio=null;
const money=c=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((Number(c)||0)/100);
const stamp=d=>d?new Date(d).toLocaleDateString('pt-BR'):'—';
const visible=(id,show)=>$(id).hidden=!show;
const setText=(id,text)=>{if($(id))$(id).textContent=text};
function notice(id,msg,err=false){$(id).textContent=msg;$(id).className='notice '+(err?'error':'ok')}
async function call(action,payload=null){const url=API+'?action='+encodeURIComponent(action);const opts=payload?{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({action,...payload})}:{credentials:'same-origin'};
 let r;try{r=await fetch(url,opts)}catch{throw Error('Sem conexão. Verifique sua internet e tente novamente.')}
 const data=await r.json().catch(()=>({}));if(!r.ok||!data.ok)throw Error(data.error||'Não foi possível concluir a operação.');return data;
}
function setStatus(text){setText('academyStatus',text)}
function toast(message){setText('toast',message);visible('toast',true);setTimeout(()=>visible('toast',false),3600)}
function authTab(next){mode=next;document.querySelectorAll('[data-auth]').forEach(b=>b.classList.toggle('active',b.dataset.auth===next));visible('studentNameField',next==='signup');visible('studentConfirmField',next==='signup');visible('academyForgotPassword',next==='login');setText('authSubmit',next==='login'?'Entrar no meu curso →':'Criar minha conta →');$('studentPassword').autocomplete=next==='signup'?'new-password':'current-password';$('studentEmail').autocomplete=next==='signup'?'email':'username';notice('authMsg','')}
function freeOrExpired(){return !me?.access?.active}
function render(){document.body.classList.toggle('academy-logged-in',!!me);if(!me?.access?.active){frameLoaded=false;academyKit=null;academyQueue=null;clearTimeout(academyWriteTimer);$('academyFullFrame')?.removeAttribute('srcdoc');visible('academyCourseFull',false)}const logged=!!me;visible('loginArea',!logged);visible('studentPanel',logged);$('topStudentOverview').hidden=!logged;setStatus(logged?(me.access.active?'Curso liberado': 'Acesso pendente'):'Entre para estudar');if(!logged)return;
 setText('profileName',me.user.name||(me.user.email||'Aluno').split('@')[0]);setText('profileEmail',me.user.guest?'Acesso gratuito por convite':(me.user.email||''));
 setText('accessLabel',me.access.active?(me.access.kind==='free'?'Teste gratuito ativo':'Acesso ativo'):'Sem acesso ativo');
 setText('accessExpiry',me.access.active?'Válido até '+stamp(me.access.kind==='free'?me.access.trialUntil:me.access.paidUntil):'Seu progresso permanece guardado');
 visible('inviteRedeemCard',!me.access.active);visible('lockedNotice',!me.access.active);
 const done=me.progress?.done||[],moments=me.progress?.moments||{},completedMoments=Object.values(moments).reduce((sum,v)=>sum+(Array.isArray(v)?v.length:0),0),percent=Math.round(done.length*100/Math.max(1,catalog.length));setText('courseMomentsDetail',completedMoments+' de 350 etapas · '+done.length+' aulas completas');setText('progressPercent',percent+'%');$('progressFill').style.width=percent+'%';setText('quizCount',Object.keys(me.quizProgress?.scores||{}).length+' / '+catalog.length+' praticados');
 const root=$('lessonsList');root.textContent='';for(const item of catalog){const el=document.createElement('button');el.type='button';el.className='lesson '+(me.quizProgress?.scores?.[item.id]!=null?'done':'');el.style.textAlign='left';el.disabled=!me.access.active;
 const n=document.createElement('span');n.className='num';n.textContent=me.quizProgress?.scores?.[item.id]!=null?'✓':String(item.index+1).padStart(2,'0');
 const info=document.createElement('span');info.style.flex='1';const t=document.createElement('span');t.className='title';t.textContent=item.title;const br=document.createElement('br');const m=document.createElement('span');m.className='meta';m.textContent=`Unidade ${item.module} · ${item.level} · ${me.quizProgress?.scores?.[item.id]!=null?'Melhor resultado: '+me.quizProgress.scores[item.id]+'%':'Quiz disponível'}`;info.append(t,br,m);const arrow=document.createElement('span');arrow.textContent='→';el.append(n,info,arrow);el.onclick=()=>openLesson(item.id);root.append(el)}
}
async function refresh(){try{me=await call('me');render()}catch(e){me=null;render();if(!String(e.message).includes('Entre novamente'))setStatus('Entre para continuar')}}
function invitedCode(){const p=new URLSearchParams(location.search);return p.get('convite')||''}
const workspaceIds=['academyCourseFull','aulas','academyPracticeLauncher','academyVideos','lessonView','academyResource','academyEnem'];
function switchWorkspace(which,{scroll=true}={}){
 if(which==='plans'){openPlansDialog();return}
 if(!me)return;
 if(!me.access?.active&&which!=='home'){toast('Ative seu convite ou plano antes de estudar.');return}
 const match={course:'academyCourseFull',quizzes:'aulas',practice:'academyPracticeLauncher',videos:'academyVideos',enem:'academyEnem',quiz:'lessonView',resource:'academyResource'};
 const id=match[which]||null;if(resourceArea==='listening' && which!=='resource')stopActiveListening();currentWorkspace=which;
 for(const area of workspaceIds)visible(area,area===id);
 document.querySelectorAll('[data-academy-screen]').forEach(b=>{
  const active=b.dataset.academyScreen===which||which==='resource'&&b.dataset.academyScreen==='practice';
  b.classList.toggle('is-active',active);b.setAttribute('aria-pressed',String(active));
 });
 if(which==='videos')window.TM406?.videos?.();if(which==='enem')window.TM406?.enem?.();if(scroll&&id)$(id).scrollIntoView({behavior:'smooth',block:'start'});
}
function openPlansDialog(){
 visible('planos',true);
 const dialog=$('academyPlansDialog');if(!dialog.open)dialog.showModal();
}
function openOverviewDialog(){
 if(!me)return;
 $('studentOverview').hidden=false;$('introOverview').hidden=false;
 const dialog=$('academyOverviewDialog');if(!dialog.open)dialog.showModal();
}
function resourceStatus(message){setText('resourceMessage',message)}
function clearResource(){
 stopActiveListening();
 if(resourceAudio){try{resourceAudio.pause();resourceAudio.src=''}catch(_){}resourceAudio=null}
 const main=$('resourceDetail');main.hidden=true;main.replaceChildren();
 $('resourceList').replaceChildren();$('resourceList').hidden=false;resourceStatus('');
}
function cleanRich(raw){
 const doc=new DOMParser().parseFromString(String(raw||''),'text/html');
 doc.querySelectorAll('script,style,iframe,object,embed,form,link,meta,svg,video,audio').forEach(e=>e.remove());
 for(const el of doc.body.querySelectorAll('*')){
  for(const attr of Array.from(el.attributes)){
   const n=attr.name.toLowerCase(),val=String(attr.value||'');
   if(n.startsWith('on')||n==='style'||n==='srcdoc'||n==='contenteditable'||n==='target'||n==='formaction'||((n==='href'||n==='src')&&!/^(?:https?:|data:image\/(?:png|jpeg|jpg|webp|gif);base64,)/i.test(val)))el.removeAttribute(attr.name);
  }
 }
 return doc.body.innerHTML;
}
function resourceButton(label,fn,extra=''){
 const b=document.createElement('button');b.type='button';b.className='btn small '+extra;b.textContent=label;b.onclick=fn;return b;
}
function resourceRich(root,html){
 const div=document.createElement('div');div.className='academy-resource-content';div.innerHTML=cleanRich(html);root.append(div);
 return div;
}
function speak(text){
 if(!window.speechSynthesis)return toast('A voz do navegador não está disponível.');
 speechSynthesis.cancel();const message=new SpeechSynthesisUtterance(String(text||''));message.lang='en-US';message.rate=.86;speechSynthesis.speak(message);
}
function studentQuizQuestions(root,questions){
 const form=document.createElement('div');form.className='academy-resource-test';
 const selected=Array(questions.length).fill(-1),blocks=[];
 questions.forEach((q,i)=>{
  const section=document.createElement('div');section.className='question';
  const heading=document.createElement('h4');heading.textContent=(i+1)+'. '+String(q.q||q.prompt||'');section.append(heading);
  const opts=q.choices||q.options||[];
  opts.forEach((text,j)=>{
   const btn=document.createElement('button');btn.type='button';btn.className='quiz-option';btn.textContent=String.fromCharCode(65+j)+') '+String(text);
   btn.onclick=()=>{if(form.dataset.graded)return;selected[i]=j;section.querySelectorAll('button.quiz-option').forEach((x,k)=>x.classList.toggle('selected',k===j))};section.append(btn);
  });form.append(section);blocks.push(section)
 });
 const result=document.createElement('div');result.setAttribute('role','status');result.className='notice';
 const submit=resourceButton('Concluir e corrigir',()=>{
  if(selected.some(x=>x<0)){result.textContent='Responda todas as questões antes de corrigir.';return}
  if(form.dataset.graded)return;form.dataset.graded='true';
  let hits=0;questions.forEach((q,i)=>{
   const right=Number(q.answer??q.correct),blocksButtons=blocks[i].querySelectorAll('button.quiz-option');
   if(selected[i]===right)hits++;
   blocksButtons.forEach((b,j)=>{b.disabled=true;b.classList.toggle('correct',j===right);b.classList.toggle('incorrect',j===selected[i]&&j!==right)});
   if(q.comment||q.explanation){const explanation=document.createElement('p');explanation.className='small muted';explanation.textContent=q.comment||q.explanation;blocks[i].append(explanation)}
  });result.textContent='Resultado: '+hits+' / '+questions.length+' · '+Math.round(hits/Math.max(questions.length,1)*100)+'%. Você pode escolher outra atividade para praticar.';
 },'primary');
 form.append(submit,result);root.append(form);
}
async function academyGet(action,params={}){
 const search=new URLSearchParams({action,...params});const response=await fetch(API+'?'+search.toString(),{credentials:'same-origin'});
 const data=await response.json().catch(()=>({}));if(!response.ok||!data.ok)throw Error(data.error||'Não foi possível carregar a atividade.');return data;
}
/* V406 listening student-only: player with pause/seek/rate and five completed listens. */
let resourceListeningStop=null;
function stopActiveListening(){
 if(resourceListeningStop){try{resourceListeningStop()}catch(_){}resourceListeningStop=null}
}
function listeningCounterKey(id){
 return 'teacher-marks-listening-complete-v406:'+String(me?.user?.id||'visitor')+':'+String(id||'');
}
function makeListeningExercise(slot,item,id){
 const player=document.createElement('section');player.className='tm-v406-listening-player';
 const styleId='tm-v406-listening-player-style';
 if(!document.getElementById(styleId)){
  const css=document.createElement('style');css.id=styleId;css.textContent=`
  .tm-v406-listening-player{border:1px solid #cfe4e2;background:#f6fbfa;border-radius:15px;padding:16px;margin:15px 0}
  .tm-v406-listening-main,.tm-v406-listening-options{display:flex;align-items:center;flex-wrap:wrap;gap:9px;margin-bottom:9px}
  .tm-v406-listening-player .tm-v406-listening-main>button{min-width:98px}
  .tm-v406-listening-player input[type=range]{flex:1 1 230px;min-width:130px;width:auto;box-shadow:none;padding:0;accent-color:#0c8075;cursor:pointer}
  .tm-v406-listening-player select{width:auto;min-width:105px;padding:8px;border-radius:9px;font-weight:750}
  .tm-v406-listening-player label{margin:0;font-weight:800;font-size:12px;display:inline-flex;align-items:center;gap:5px}
  .tm-v406-listening-note{color:#4f6d78;font-size:12px;margin:7px 0}
  .tm-v406-listening-status{color:#116c63;font-size:12px;font-weight:800;margin:7px 0}
  .tm-v406-listening-locked{border:1px solid #dce8e7;background:white;border-radius:12px;padding:12px;margin-top:12px}
  @media(max-width:580px){.tm-v406-listening-player{padding:12px}.tm-v406-listening-player input[type=range]{flex-basis:100%}}
  `;document.head.append(css);
 }
 const main=document.createElement('div');main.className='tm-v406-listening-main';
 const play=resourceButton('▶ Reproduzir',()=>togglePlay(),'primary');
 const stop=resourceButton('■ Parar',()=>stopPlayback());
 const seek=document.createElement('input');seek.type='range';seek.min='0';seek.max='1000';seek.step='1';seek.value='0';seek.setAttribute('aria-label','Voltar ou avançar no áudio');
 const clock=document.createElement('span');clock.className='small muted';clock.textContent='0:00 / --:--';
 const speedLabel=document.createElement('label');speedLabel.textContent='Velocidade';
 const speed=document.createElement('select');speed.setAttribute('aria-label','Velocidade de reprodução');
 for(const rate of [0.65,0.8,1,1.15,1.3,1.5,1.75]){const opt=document.createElement('option');opt.value=String(rate);opt.textContent=rate+'×';if(rate===1)opt.selected=true;speed.append(opt)}
 speedLabel.append(speed);main.append(play,stop,seek,clock,speedLabel);player.append(main);
 const typeNote=document.createElement('p');typeNote.className='tm-v406-listening-note';player.append(typeNote);
 const status=document.createElement('p');status.className='tm-v406-listening-status';status.setAttribute('role','status');player.append(status);
 const reveal=document.createElement('section');reveal.className='tm-v406-listening-locked';
 const actions=document.createElement('div');actions.className='tm-v406-listening-options';
 const transcriptBtn=resourceButton('Mostrar transcrição',()=>{transcript.hidden=!transcript.hidden;transcriptBtn.textContent=transcript.hidden?'Mostrar transcrição':'Esconder transcrição'});
 const translationBtn=resourceButton('Mostrar tradução',()=>{translation.hidden=!translation.hidden;translationBtn.textContent=translation.hidden?'Mostrar tradução':'Esconder tradução'});
 actions.append(transcriptBtn,translationBtn);reveal.append(actions);
 const transcript=document.createElement('div');transcript.className='academy-resource-content';transcript.hidden=true;transcript.innerHTML=cleanRich(item.textHtml);
 const translation=document.createElement('div');translation.className='academy-resource-content';translation.hidden=true;translation.innerHTML=cleanRich(item.translationHtml);
 reveal.append(transcript,translation);player.append(reveal);slot.append(player);
 const hasAudio=typeof item.audio==='string'&&/^data:audio\/(?:mpeg|mp3|wav|ogg|webm|mp4)(?:;|,)/i.test(item.audio);
 const content=new DOMParser().parseFromString(cleanRich(item.textHtml||''),'text/html').body.textContent.replace(/\s+/g,' ').trim();
 let heard=0;try{heard=Math.min(5,Math.max(0,Number(localStorage.getItem(listeningCounterKey(id)))||0))}catch(_){}
 let disposed=false,playing=false,paused=false,jumped=false,startedFromBeginning=false;
 let position=0,utterance=null,utteranceVersion=0,estimate=0,ticker=0,lastTick=0;
 const media=hasAudio?new Audio(item.audio):null;let listenedMediaSeconds=0,lastMediaTime=0;
 const countFull=()=>{
  if(disposed||jumped||!startedFromBeginning||(!media&&!content))return;
  heard=Math.min(5,heard+1);try{localStorage.setItem(listeningCounterKey(id),String(heard))}catch(_){}
  showGate();
 };
 const showGate=()=>{
  const unlocked=heard>=5;
  transcriptBtn.disabled=!unlocked;translationBtn.disabled=!unlocked;
  status.textContent=unlocked?'✓ Cinco escutas completas! Transcrição e tradução liberadas.':`Escutas completas: ${heard} de 5. Ouça do início ao fim para liberar a transcrição e a tradução.`;
  if(!unlocked){transcript.hidden=true;translation.hidden=true;transcriptBtn.textContent='Mostrar transcrição';translationBtn.textContent='Mostrar tradução'}
 };
 const fmt=s=>{s=Math.max(0,Math.floor(Number(s)||0));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')};
 const updateBar=(cur,total)=>{total=Math.max(0,Number(total)||0);cur=Math.min(total,Math.max(0,Number(cur)||0));seek.value=total?String(Math.round(cur/total*1000)):'0';clock.textContent=fmt(cur)+' / '+(total?fmt(total):'--:--')};
 const setButtons=()=>{play.textContent=playing?(paused?'▶ Continuar':'⏸ Pausar'):'▶ Reproduzir'};
 function stopPlayback(reset=true){
  if(media){media.pause();if(reset){try{media.currentTime=0}catch(_){}}}
  else{utteranceVersion++;try{speechSynthesis.cancel()}catch(_){}clearInterval(ticker);ticker=0;utterance=null;}
  playing=false;paused=false;if(reset){position=0;updateBar(0,hasAudio?media?.duration:estimate)}setButtons();
 }
 const rate=()=>Number(speed.value)||1;
 function startTTS(from=0){
  if(!content||!('speechSynthesis'in window)){toast('A leitura por voz não está disponível neste navegador.');return}
  utteranceVersion++;const version=utteranceVersion;
  try{speechSynthesis.cancel()}catch(_){}clearInterval(ticker);ticker=0;
  position=Math.min(content.length,Math.max(0,Math.floor(from)));
  const u=new SpeechSynthesisUtterance(content.slice(position));utterance=u;u.lang='en-US';u.rate=rate();
  estimate=Math.max(1,content.length/(12*rate()));
  const start=position;let lastBoundary=position;lastTick=Date.now();
  u.onboundary=e=>{if(disposed||version!==utteranceVersion)return;if(typeof e.charIndex==='number'){lastBoundary=Math.min(content.length,start+e.charIndex);position=lastBoundary;updateBar(position/Math.max(1,content.length)*estimate,estimate)}};
  u.onend=()=>{if(disposed||version!==utteranceVersion)return;clearInterval(ticker);ticker=0;position=content.length;updateBar(estimate,estimate);playing=false;paused=false;setButtons();countFull();};
  u.onerror=e=>{if(disposed||version!==utteranceVersion)return;clearInterval(ticker);ticker=0;playing=false;paused=false;setButtons();if(e.error!=='canceled'&&e.error!=='interrupted')status.textContent='⚠ Voz interrompida. Tente novamente.'};
  playing=true;paused=false;setButtons();
  ticker=setInterval(()=>{if(disposed||version!==utteranceVersion||paused)return;const now=Date.now(),delta=now-lastTick;lastTick=now;
   if(lastBoundary===start)position=Math.min(content.length-1,position+Math.max(0,delta/1000*12*rate()));
   updateBar(position/Math.max(1,content.length)*estimate,estimate)
  },300);
  try{speechSynthesis.speak(u)}catch(_){clearInterval(ticker);ticker=0;playing=false;setButtons();toast('Não foi possível iniciar a voz do navegador.')}
 }
 function togglePlay(){
  if(disposed)return;
  if(!playing&&!media&&position>=content.length-1)position=0;
  if(!playing){if((media?media.currentTime<=.25:position<=0)){jumped=false;startedFromBeginning=true;listenedMediaSeconds=0;lastMediaTime=0}
   if(media){media.playbackRate=rate();const p=media.play();if(p&&p.catch)p.catch(()=>{playing=false;setButtons();status.textContent='⚠ Áudio não pôde começar. Tente novamente.'});playing=true;paused=false;setButtons()}
   else startTTS(position);return}
  if(paused){if(media)media.play().catch(()=>{status.textContent='⚠ Não foi possível continuar.'});else{try{speechSynthesis.resume()}catch(_){}}paused=false;lastTick=Date.now()}
  else{if(media)media.pause();else{try{speechSynthesis.pause()}catch(_){}}paused=true}
  setButtons();
 }
 stop.onclick=()=>stopPlayback();
 seek.addEventListener('input',()=>{
  jumped=true;const fraction=Number(seek.value)/1000;
  if(media&&Number.isFinite(media.duration)){media.currentTime=Math.max(0,Math.min(media.duration* fraction,media.duration-.01));updateBar(media.currentTime,media.duration)}
  else {const target=Math.max(0,Math.min(content.length-1,Math.floor(content.length*fraction)));const wasPlaying=playing&&!paused;stopPlayback(false);position=target;updateBar(fraction*estimate,estimate);if(wasPlaying)startTTS(position)}
 });
 speed.addEventListener('change',()=>{
  if(media)media.playbackRate=rate();
  else if(playing){const wasPaused=paused,at=position;stopPlayback(false);startTTS(at);if(wasPaused){try{speechSynthesis.pause()}catch(_){}paused=true;setButtons()}}
  else{estimate=Math.max(1,content.length/(12*rate()));updateBar(position/Math.max(1,content.length)*estimate,estimate)}
 });
 if(media){
  typeNote.textContent='Áudio gravado: controle de tempo, pausa e velocidade.';
  media.preload='metadata';
  media.addEventListener('loadedmetadata',()=>updateBar(media.currentTime,media.duration));
  media.addEventListener('timeupdate',()=>{
   const t=media.currentTime;
   if(playing&&!paused){if(t>=lastMediaTime&&t-lastMediaTime<2.5*rate())listenedMediaSeconds+=Math.max(0,t-lastMediaTime);else if(t>lastMediaTime+2.5*rate())jumped=true}
   lastMediaTime=t;updateBar(t,media.duration)
  });
  media.addEventListener('ended',()=>{playing=false;paused=false;setButtons();if(media.duration&&listenedMediaSeconds>=media.duration*.8)countFull();listenedMediaSeconds=0;lastMediaTime=0;position=0;try{media.currentTime=0}catch(_){}});
  media.addEventListener('error',()=>{status.textContent='⚠ Não foi possível carregar o arquivo de áudio.'});
 }else{
  typeNote.textContent='Voz do navegador: barra de avanço aproximada por trecho de texto; use-a para voltar ou avançar. A velocidade pode ser alterada.';
  estimate=Math.max(1,content.length/12);updateBar(0,estimate);
 }
 resourceListeningStop=()=>{disposed=true;stopPlayback();if(media){media.removeAttribute('src');media.load()}};
 showGate();setButtons();
}

async function openPracticeResource(area){
 if(!me?.access?.active)return toast('Acesso indisponível.');
 if(!['reading','listening','speaking','vocabulary'].includes(area))return;
 resourceArea=area;const ticket=++resourceToken;clearResource();switchWorkspace('resource');
 const name={reading:'📖 Reading',listening:'🎧 Listening',speaking:'🎙 Speaking',vocabulary:'🧠 Vocabulary'}[area];
 setText('resourceTitle',name);setText('resourceSubtitle','Conteúdo original da Central · Acesso do aluno sem edição ou projeção.');
 resourceStatus('Carregando '+name+'…');
 try{
  if(area==='speaking'){
   const data=await academyGet('practiceItem',{area:'speaking'});if(ticket!==resourceToken)return;
   const frame=document.createElement('iframe');frame.title='Speaking e Dialogue Teacher Marks';frame.className='academy-resource-embed';frame.allow='microphone';
   frame.srcdoc=data.html.replaceAll('teacher-marks-speaking-dialogue-progress-v106','teacher-marks-speaking-student-'+me.user.id);
   $('resourceDetail').append(frame);$('resourceDetail').hidden=false;resourceStatus('Escolha o nível e o diálogo. Ouça e pratique suas falas.');return;
  }
  const data=await academyGet('practiceCatalog',{area});if(ticket!==resourceToken)return;
  resourceStatus(data.items.length+' atividade(s) disponíveis. Selecione uma para começar.');
  data.items.forEach((item,i)=>{
   const button=document.createElement('button');button.type='button';button.className='academy-resource-card';
   const count=document.createElement('span');count.className='rcount';count.textContent=String(i+1).padStart(2,'0');
   const desc=document.createElement('span');const strong=document.createElement('strong');strong.textContent=item.title;
   const detail=document.createElement('small');detail.textContent=(item.level?item.level+' · ':'')+item.count+' '+(area==='vocabulary'?'palavras':'questões');desc.append(strong,detail);
   button.append(count,desc);button.onclick=()=>showResourceItem(area,item.id,ticket);
   $('resourceList').append(button);
  });
 }catch(err){if(ticket===resourceToken)resourceStatus('⚠ '+err.message)}
}
async function showResourceItem(area,id,ticket){
 const slot=$('resourceDetail');stopActiveListening();slot.hidden=false;slot.replaceChildren();resourceStatus('Carregando atividade…');
 try{
  const d=await academyGet('practiceItem',{area,id});if(ticket!==resourceToken)return;
  $('resourceList').hidden=true;
  const back=resourceButton('← Voltar à lista',()=>{stopActiveListening();slot.hidden=true;slot.replaceChildren();$('resourceList').hidden=false;if(resourceAudio)resourceAudio.pause();resourceStatus('Escolha uma atividade.');});
  slot.append(back);const title=document.createElement('h3');title.textContent=d.item.title||d.item.name;title.style.marginTop='20px';slot.append(title);
  if(area==='reading'){
   if(d.item.instructionHtml)resourceRich(slot,d.item.instructionHtml);
   if(d.item.image&&/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,/i.test(d.item.image)){
    const img=document.createElement('img');img.src=d.item.image;img.alt='Imagem da atividade de leitura';img.style.cssText='max-width:100%;max-height:440px;display:block;margin:auto;border-radius:12px';slot.append(img)
   }
   if(d.item.textHtml)resourceRich(slot,d.item.textHtml);
  }else if(area==='listening'){
   makeListeningExercise(slot,d.item,id);
  }else if(area==='vocabulary'){
   const note=document.createElement('p');note.className='small muted';note.textContent='Ouça a pronúncia, consulte o significado e pratique os exemplos.';slot.append(note);
   for(const word of d.item.words||[]){const card=document.createElement('div');card.className='academy-vocab-word';
    const title=document.createElement('strong');title.textContent=word.w||'';
    const trans=document.createElement('p');trans.textContent=word.t||'';
    const example=document.createElement('p');example.className='small muted';example.textContent=word.e||'';
    card.append(title,resourceButton('🔊 Ouvir',()=>speak((word.w||'')+'. '+(word.e||''))),trans,example);slot.append(card)}
  }
  if(d.item.questions?.length){const label=document.createElement('h3');label.textContent='Atividade · '+d.item.questions.length+' questões';slot.append(label);studentQuizQuestions(slot,d.item.questions)}
  resourceStatus('Atividade carregada. O gabarito aparece após a correção.');
  slot.scrollIntoView({behavior:'smooth',block:'start'});
 }catch(e){if(ticket===resourceToken)resourceStatus('⚠ '+e.message)}
}
async function openKitArea(area){
 if(area==='regular'){switchWorkspace('resource');$('resourceTitle').textContent='🧠 Vocabulary';$('resourceSubtitle').textContent='Flashcards, Match, Quiz, Listen & Choose e Type It.';window.TM406?.vocabulary?.();return}
 return openPracticeResource(area);
}

function closeFullLesson(){
 frameLoaded=false;activeKitArea='course';$('academyFullFrame').removeAttribute('srcdoc');
 switchWorkspace('practice');
}
function flushAcademyProgress(){
 if(academySaving||!academyQueue||!me?.access?.active)return;
 const snapshot=academyQueue;academyQueue=null;academySaving=true;
 setText('academyFullStatus','Salvando as etapas no servidor…');
 call('courseMoments',{moments:snapshot}).then(r=>{
   if(r.progress){me.progress=r.progress;render();window.TM406?.courseProgress?.(me.progress)}
   setText('academyFullStatus','✓ Etapas sincronizadas com sua conta.');
 }).catch(e=>{
   // Keep progress pending without falsely claiming server save.
   academyQueue={...snapshot,...(academyQueue||{})};
   setText('academyFullStatus','⚠ Não foi possível sincronizar: '+e.message);
 }).finally(()=>{academySaving=false;if(academyQueue&&me?.access?.active){clearTimeout(academyWriteTimer);academyWriteTimer=setTimeout(flushAcademyProgress,1500)}});
}
async function openFullLesson(id,{area='course'}={}){
 if(!me?.access?.active){toast('Ative seu convite ou seu plano antes de estudar.');return}
 const item=catalog.find(x=>x.id===id)||catalog[0];if(!item)return;
 if(area==='course' && frameLoaded){
  activeKitArea='course';switchWorkspace('course');setText('academyKitTitle','📘 My English Course');setText('academyKitSubtitle','50 aulas · 25 conteúdos · 7 momentos por aula');
  $('academyFullFrame').contentWindow.postMessage({type:'tm-academy-open-area',area:'course'},location.origin);return;
 }
 lastFullLessonId=item.id;activeKitArea=area;frameLoaded=false;switchWorkspace('course');
 setText('academyKitTitle',area==='course'?'📘 My English Course':$('academyKitTitle').textContent);
 if(area==='course')setText('academyKitSubtitle','50 aulas · 25 conteúdos · 7 momentos por aula');
 setText('academyFullStatus','Carregando os sete momentos e as ferramentas de estudo…');
 try{
  if(!academyKit){const result=await call('studentKit');academyKit=result.html}
  if(!me?.access?.active)throw Error('Seu acesso não está mais ativo.');
  const frame=$('academyFullFrame');const index=item.index;
  frame.onload=()=>{frameLoaded=true;try{frame.contentWindow.postMessage({type:'tm-academy-choose-lesson',index},location.origin);if(area!=='course')frame.contentWindow.postMessage({type:'tm-academy-open-area',area},location.origin)}catch(_){}};
  const boot={uid:me.user.id,moments:me.progress?.moments||{}};
  const json=JSON.stringify(boot).replace(/</g,'\u003c').replace(/\u2028/g,'\u2028');
  frame.srcdoc=academyKit.replace('__TM_ACADEMY_BOOTSTRAP__',json);
  setText('academyFullStatus','Seu curso completo está disponível. O avanço é sincronizado com sua conta.');
 }catch(e){setText('academyFullStatus',e.message);toast(e.message)}
}
function academyMessage(event){
 if(event.origin!==location.origin||event.source!==$('academyFullFrame').contentWindow||!me?.access?.active)return;
 if(event.data?.type!=='tm-academy-course-moments-v1')return;
 const raw=event.data.moments;
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return;
 const cleaned={};
 for(const [k,v] of Object.entries(raw))if(/^[a-z0-9_]+-[01]$/.test(k)&&Array.isArray(v))cleaned[k]=v.filter(x=>Number.isInteger(x)&&x>=0&&x<=6);
 if(!Object.keys(cleaned).length)return;
 academyQueue={...(academyQueue||{}),...cleaned};
 clearTimeout(academyWriteTimer);academyWriteTimer=setTimeout(flushAcademyProgress,600);
}
async function openLesson(id){if(!me?.access?.active){toast('Ative um convite ou contrate um plano.');return}setText('saveStatus','Abrindo quiz…');switchWorkspace('quiz');try{
 const d=await academyGet('quizBank',{id});lesson=d.quiz;answers=Array(lesson.questions.length).fill(-1);
 setText('lessonTitle',lesson.topic+' · '+lesson.section);setText('lessonLevel','Quiz '+lesson.id);
 setText('gradeResult','');setText('lessonSaveMsg','');
 const questions=$('quizQuestions');questions.textContent='';lesson.questions.forEach((q,i)=>{
 const box=document.createElement('div');box.className='question';const heading=document.createElement('h4');heading.textContent=(i+1)+'. '+q.prompt;box.append(heading);
 q.options.forEach((opt,j)=>{const b=document.createElement('button');b.type='button';b.className='quiz-option';b.textContent=String.fromCharCode(65+j)+') '+opt;b.onclick=()=>{answers[i]=j;box.querySelectorAll('button').forEach((x,n)=>x.classList.toggle('selected',n===j))};box.append(b)});questions.append(box)});
 visible('lessonView',true);$('lessonView').scrollIntoView({behavior:'smooth',block:'start'});setText('saveStatus','Quiz carregado — resultado será gravado separadamente no servidor.');
 }catch(e){toast(e.message);setText('saveStatus','Não foi possível abrir este quiz.');switchWorkspace('quizzes',{scroll:false})}
}
async function grade(){if(!lesson)return;if(answers.some(n=>n<0)){notice('lessonSaveMsg','Responda todas as questões antes de concluir.',true);return}
 let right=0;lesson.questions.forEach((q,i)=>{if(answers[i]===q.correct)right++});const percent=Math.round(right*100/Math.max(1,lesson.questions.length));setText('gradeResult',right+' / '+lesson.questions.length+' • '+percent+'%');
 notice('lessonSaveMsg','Salvando seu resultado no Netlify…');try{const result=await call('quizPractice',{lessonId:lesson.id,score:percent});me.quizProgress=result.quizProgress;render();notice('lessonSaveMsg','✓ Quiz registrado no seu histórico independente.');setText('saveStatus','✓ Resultado do quiz salvo no Netlify.');toast('Quiz concluído! Continue praticando.')}
 catch(e){notice('lessonSaveMsg','A aula ainda NÃO foi salva: '+e.message,true);setText('saveStatus','⚠️ Registro pendente — salve novamente quando voltar a conexão.')}
}
function rememberPurchase(plan){pendingPlan=plan;try{sessionStorage.setItem('tm-academy-pending-plan',plan)}catch(_){}}
function clearPurchase(){pendingPlan='';try{sessionStorage.removeItem('tm-academy-pending-plan')}catch(_){}}
async function resumePurchase(){
 const plan=pendingPlan;if(!['monthly','annual'].includes(plan)||!me||me.user.guest)return;
 clearPurchase();openPlansDialog();await buy(plan);
}
async function buy(plan){
 if(!['monthly','annual'].includes(plan))return;
 if(!me||me.user.guest){
   rememberPurchase(plan);$('academyPlansDialog')?.close();
   authTab('signup');
   if(me?.user?.guest){visible('loginArea',true);visible('studentPanel',false)}
   notice('authMsg','Seu plano '+(plan==='monthly'?'mensal':'anual')+' foi reservado. Crie sua conta ou entre com e-mail e senha; voltaremos automaticamente ao Pix depois do login.');
   document.getElementById('minha-conta').scrollIntoView({behavior:'smooth'});
   return;
 }
 const b=document.querySelector('[data-buy="'+plan+'"]');b.disabled=true;try{
 const d=await call('order',{plan});selectedPlan=plan;visible('paymentCard',true);setText('paymentInfo',(plan==='monthly'?'Mensalidade':'Anuidade')+' · '+money(d.order.amount)+' · Pedido #'+d.order.id.slice(0,8));$('pixCopy').value=d.pix;
 if(window.TM391Qr?.render)await window.TM391Qr.render(d.pix,$('pixQR'));
 else {const ctx=$('pixQR').getContext('2d');ctx.font='13px sans-serif';ctx.fillText('Use Pix Copia e Cola',12,20)}
 notice('paymentMsg','Pix gerado. Confira o destinatário no aplicativo do banco. Após pagar, aguarde a confirmação do professor.');openPlansDialog();$('paymentCard').scrollIntoView({behavior:'smooth',block:'nearest'});
 }catch(e){notice('paymentMsg',e.message,true)}finally{b.disabled=false}}
async function loadCatalog(){try{const d=await call('catalog');catalog=d.lessons;setText('monthlyPrice',money(d.monthly));setText('annualPrice',money(d.annual));document.querySelectorAll('[data-buy]').forEach(b=>{b.disabled=!d.paymentEnabled;b.title=d.paymentEnabled?'':'Aguardando o professor ativar pagamentos.'});if(!d.paymentEnabled)notice('paymentMsg','O professor ainda não ativou as cobranças Pix. Convites gratuitos continuam disponíveis.')}catch(e){notice('paymentMsg',e.message,true)}}
async function doAuth(event){
 event.preventDefault();const btn=$('authSubmit');btn.disabled=true;notice('authMsg','Aguarde…');
 const email=$('studentEmail').value.trim(),password=$('studentPassword').value;
 try{
  if(mode==='signup'){
   if(password!==$('studentConfirm').value){notice('authMsg','As senhas precisam ser iguais.',true);return}
   const d=await call('signup',{email,password,name:$('studentName').value});
   $('studentConfirm').value='';
   // Tentar login imediato só quando a conta foi realmente aceita/confirmada pelo Identity.
   // Se a confirmação por e-mail for obrigatória, nunca contornar essa etapa.
   try{
     if(window.TMNetlifyIdentity?.login){await window.TMNetlifyIdentity.login(email,password);await call('identityStudentSession',{});}
     else await call('login',{email,password});
     await refresh();if(!me)throw Error('Sessão ainda não confirmada.');
     $('studentPassword').value='';authTab('login');
     toast('Conta criada! Bem-vindo(a) à English Academy.');
     await activateInviteAfterLogin();await resumePurchase();
     return;
   }catch(loginError){
     authTab('login');$('studentEmail').value=email;$('studentPassword').value='';
     notice('authMsg','Cadastro solicitado. '+(d.message||'Confira a mensagem de ativação no e-mail.')+' Depois volte a Entrar: seu plano continuará selecionado nesta aba.');return;
   }
  }
  // O Identity no navegador estabelece sua própria sessão antes do cookie de Academia.
  // Se não estiver disponível, existe caminho legado via servidor.
  if(window.TMNetlifyIdentity?.login){
   await window.TMNetlifyIdentity.login(email,password);
   await call('identityStudentSession',{});
  }else await call('login',{email,password});
  await refresh();if(!me)throw Error('A sessão não foi restaurada. Confira o Identity e tente novamente.');
  switchWorkspace('home',{scroll:false});$('introOverview').hidden=true;
  await activateInviteAfterLogin();
  toast('Bem-vindo(a) de volta! Seu histórico foi recuperado.');
  await resumePurchase();
 }catch(e){notice('authMsg',e.message||'Falha ao entrar; use Esqueci minha senha.',true)}
 finally{btn.disabled=false}
}
function inviteToken(raw){
 const text=String(raw||'').trim();let token=text;
 try{const u=new URL(text,location.href);token=u.searchParams.get('convite')||u.searchParams.get('token')||text}catch{}
 return /^[a-f0-9]{32}$/i.test(token)?token.toLowerCase():'';
}
async function activateInviteAfterLogin(){
 const token=inviteToken($('academyGuestInvite')?.value||'')||invitedCode();
 if(!token||!me||me.user.guest)return;
 try{
   await call('redeem',{token});await refresh();
   notice('academyGuestMessage','✓ Convite vinculado à sua conta. Você poderá sair e voltar com e-mail e senha enquanto estiver válido.');
   history.replaceState({},'',location.pathname);
 }catch(e){notice('academyGuestMessage','Conta autenticada, mas convite não foi ativado: '+e.message,true)}
}
async function guestSignIn(event){
 event.preventDefault();const name=$('academyGuestName').value.trim();const token=inviteToken($('academyGuestInvite').value);
 if(name.length<2)return notice('academyGuestMessage','Informe seu nome (pelo menos dois caracteres).',true);
 if(!token)return notice('academyGuestMessage','Cole o link completo recebido do professor ou o código de 32 caracteres.',true);
 const button=$('academyGuestEnter');button.disabled=true;notice('academyGuestMessage','Verificando convite no servidor…');
 try{
  const d=await call('guestInvite',{token,name});await refresh();
  if(!me?.access?.active)throw Error('Não foi possível ativar o período gratuito.');
  history.replaceState({},'',location.pathname);switchWorkspace('home',{scroll:false});
  toast('Convite liberado para '+(me.user.name||name)+'!');
 }catch(e){
   if(/exclusivo de um e-mail/i.test(e.message)){
      notice('academyGuestMessage','Este convite foi gerado para um e-mail específico. Entre ou cadastre-se com esse mesmo e-mail e senha; o link será ativado na sua conta. Ele não pode ser usado apenas com nome.',true);
      authTab('login');document.getElementById('minha-conta').scrollIntoView({behavior:'smooth'});
   }else notice('academyGuestMessage',e.message,true)
 }finally{button.disabled=false}
}
async function forgotStudentPassword(){
 const email=$('studentEmail').value.trim();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){notice('authMsg','Informe seu e-mail cadastrado antes de clicar em Esqueci minha senha.',true);return}
 const fn=window.TMNetlifyIdentity?.requestPasswordRecovery;
 if(!fn){notice('authMsg','A recuperação do Netlify Identity está indisponível. Atualize a página e tente novamente.',true);return}
 $('academyForgotPassword').disabled=true;
 try{await fn(email);notice('authMsg','Se este e-mail estiver cadastrado, você receberá instruções para criar uma nova senha. Verifique também a pasta Spam.');}
 catch(e){notice('authMsg','Não foi possível solicitar a recuperação: '+e.message,true)}
 finally{$('academyForgotPassword').disabled=false}
}
async function redeem(){const token=$('redeemCode').value.trim()||invitedCode();if(!token)return toast('Informe seu convite.');const b=$('redeemButton');b.disabled=true;try{const d=await call('redeem',{token});toast('Convite ativado com sucesso!');notice('redeemMessage','Acesso gratuito liberado.');await refresh();switchWorkspace('home',{scroll:false});history.replaceState({},'',location.pathname)}catch(e){notice('redeemMessage',e.message,true)}finally{b.disabled=false}}
async function logout(){stopActiveListening();academyKit=null;frameLoaded=false;academyQueue=null;clearTimeout(academyWriteTimer);$('academyFullFrame').removeAttribute('srcdoc');visible('academyCourseFull',false);try{await call('logout',{})}catch{}me=null;visible('lessonView',false);render();toast('Você saiu da plataforma.')}
window.TM406Bridge={get:academyGet,post:call,user:()=>me,show:(name)=>switchWorkspace(name),notify:toast};
async function init(){await loadCatalog();try{await window.TMNetlifyIdentity?.handleAuthCallback?.()}catch{};
 window.addEventListener('message',academyMessage);
 document.querySelectorAll('[data-academy-screen]').forEach(b=>b.addEventListener('click',()=>{
  const screen=b.dataset.academyScreen;
  if(screen==='course')openFullLesson(me?.progress?.lastLesson||'L01');else switchWorkspace(screen);
 }));
 document.querySelectorAll('[data-academy-practice]').forEach(b=>b.addEventListener('click',()=>openKitArea(b.dataset.academyPractice)));
 $('academyPlansSlot').append($('planos'));$('planos').append($('paymentCard'));$('academyOverviewSlot').append($('studentOverview'),$('introOverview'));
 $('academyPlansClose').onclick=()=>$('academyPlansDialog').close();$('academyOverviewClose').onclick=()=>$('academyOverviewDialog').close();
 $('resourceBack').onclick=()=>{resourceToken++;clearResource();switchWorkspace('practice')};
 $('topStudentPlans').onclick=e=>{e.preventDefault();openPlansDialog()};$('academyKnowPlans').onclick=e=>{e.preventDefault();openPlansDialog()};$('academyGuestForm').onsubmit=guestSignIn;$('academyForgotPassword').onclick=forgotStudentPassword;
 $('topStudentOverview').onclick=e=>{e.preventDefault();openOverviewDialog()};

 $('academyCloseFull').onclick=closeFullLesson;
 $('academyQuickReview').onclick=()=>{frameLoaded=false;$('academyFullFrame').removeAttribute('srcdoc');openLesson(lastFullLessonId)};document.querySelectorAll('[data-auth]').forEach(b=>b.onclick=()=>authTab(b.dataset.auth));$('authForm').onsubmit=doAuth;$('studentLogout').onclick=logout;$('redeemButton').onclick=redeem;$('lessonBack').onclick=()=>switchWorkspace('quizzes');$('gradeLesson').onclick=grade;
 $('lessonListen').onclick=()=>{if(!window.speechSynthesis)return toast('Áudio indisponível neste navegador.');speechSynthesis.cancel();const text=new SpeechSynthesisUtterance(lesson?.reading||'');text.lang='en-US';text.rate=.9;speechSynthesis.speak(text)};
 document.querySelectorAll('[data-buy]').forEach(b=>b.onclick=()=>buy(b.dataset.buy));$('copyPix').onclick=()=>navigator.clipboard?.writeText($('pixCopy').value).then(()=>toast('Pix Copia e Cola copiado!')).catch(()=>toast('Selecione e copie o código Pix.'));
 $('refreshOrder').onclick=async()=>{try{const d=await call('orders');notice('paymentMsg',d.orders.map(o=>'#'+o.id.slice(0,8)+' · '+o.status).join(' | ')||'Nenhum pedido.')}catch(e){notice('paymentMsg',e.message,true)}};
 const code=invitedCode();if(code){$('academyGuestInvite').value=location.href;$('redeemCode').value=code;}
 try{pendingPlan=sessionStorage.getItem('tm-academy-pending-plan')||''}catch(_){};
 await refresh();if(me){switchWorkspace('home',{scroll:false});$('introOverview').hidden=true;await activateInviteAfterLogin();if(pendingPlan&&!me.user.guest)setTimeout(resumePurchase,220);}const offer=new URLSearchParams(location.search).get('plano');if(offer==='mensal'||offer==='anual')setTimeout(openPlansDialog,150);if(!me&&code){notice('academyGuestMessage','Convite identificado! Informe seu nome e clique em Entrar com link de acesso.')}
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&me)refresh()});
 window.setInterval(()=>{if(!document.hidden&&me)refresh()},60*1000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&me)refresh()});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
