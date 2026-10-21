/* Teacher Marks V414 Browser Video Editor: exportação com escolha de arquivo, projetos portáteis e cursor nas faixas. */
(()=>{'use strict';
const $=id=>document.getElementById(id),API='/.netlify/functions/tm-academy-video',ACADEMY='/.netlify/functions/tm-academy',MAX=96*1024*1024;
let file=null,rawUrl='',exportUrl='',exported=null,videoId='',storing=false,raf=0,rendering=false,player=null,sharedAudioCtx=null,sharedAudioSource=null,sharedAudioDest=null,sharedGain=null,cloudReady=false;
let clips=[],selectedClipId='',previewing=false,sourceUrls=new Map(),metadataLoading=false,frameGlobalTime=0;
let timelineZoom=1,historyUndo=[],historyRedo=[],restoringHistory=false,volumeGesture=false;
let audioItems=[],captionItems=[],selectedAudioId='',selectedCaptionId='',audioTrackMuted=false,muteVideoTrack=false;
let captionEditPreview=false,captionFloating=null;
let projectId='',projectName='',projectArmed=false,autoSaveTimer=0,savePipeline=Promise.resolve(),savingRevision=0,savedMediaKeys=new Set(), projectLoading=false;
let portableHandle=null,portableSaveTimer=0,portableSavePipeline=Promise.resolve(),portableSaveRunning=false;
let altAudio=null,altAudioCtxSource=null,altGain=null,currentAudioKey='',audioUrls=new Map();
let additionalTick=0;
let activeTrack='video',seekDesired=0;const extraPlayers=new Map();
const safeTime=n=>Math.max(0,Number(n)||0);
const audioLength=a=>Math.max(.01,Number(a.sourceEnd??(Number(a.sourceStart||0)+Number(a.duration||0)))-Number(a.sourceStart||0));
function normalizeAudio(a){a.sourceStart=safeTime(a.sourceStart);a.sourceEnd=Math.max(a.sourceStart+.01,Number(a.sourceEnd??a.sourceStart+Number(a.duration||0)));a.fileDuration=Number(a.fileDuration??a.sourceEnd);a.duration=audioLength(a);a.fadeIn=safeTime(a.fadeIn);a.fadeOut=safeTime(a.fadeOut);return a}
function activeItem(){return activeTrack==='audio'?audioItems.find(a=>a.id===selectedAudioId):activeTrack==='caption'?captionItems.find(c=>c.id===selectedCaptionId):selectedClip()}
function refreshSingleSelection(){
 // The video clip is still needed for the preview, but it must not stay selected when the editor is on another track.
 document.querySelectorAll('#tm407Clips .tm407-clip').forEach((b,i)=>{
  b.setAttribute('aria-pressed',String(activeTrack==='video' && clips[i]?.id===selectedClipId));
 });
 document.querySelectorAll('#tm410AudioTrack [data-track-type=audio]').forEach(b=>{
  b.setAttribute('aria-pressed',String(activeTrack==='audio' && b.dataset.itemId===selectedAudioId));
 });
 document.querySelectorAll('#tm410CaptionTrack [data-track-type=caption]').forEach(b=>{
  b.setAttribute('aria-pressed',String(activeTrack==='caption' && b.dataset.itemId===selectedCaptionId));
 });
}
function chooseTrack(type,id){
 activeTrack=type;
 if(type==='audio'){selectedAudioId=id;selectedCaptionId=''}
 else if(type==='caption'){selectedCaptionId=id;selectedAudioId=''}
 else{selectedAudioId='';selectedCaptionId='';selectedClipId=id||selectedClipId;}
 if(type!=='caption'){
  captionEditPreview=false;
  if(captionFloating&&!captionFloating.hidden)captionFloating.hidden=true;
 }
 updateActiveUI();
}

function updateActiveUI(){refreshSingleSelection();const n=$('tm411ActiveTrack');if(n){const i=activeItem();n.textContent='Selecionado: '+(activeTrack==='video'?'🎞 Vídeo':activeTrack==='audio'?'🎧 Áudio':'📝 Legenda')+(i?' · '+(i.name||String(i.text||'').slice(0,26)): '');}
 const b=$('tm411MuteVideo');if(b){b.textContent=activeTrack==='caption'?'👁 Mostrar/ocultar legenda':activeTrack==='audio'?'🎧 Silenciar/reativar áudio':'🔊 Silenciar/reativar vídeo';b.disabled=!activeItem();}
 const volumeEl=$('tm407Volume'),volumeText=$('tm407VolumeText');if(volumeEl){volumeEl.disabled=activeTrack==='caption';const item=activeItem();if(item&&activeTrack!=='caption'){volumeEl.value=Math.round((item.volume??1)*100);volumeText.textContent=volumeEl.value+'%';}}
 if($('tm411VolumeLabel'))$('tm411VolumeLabel').textContent=activeTrack==='audio'?'Volume do áudio selecionado':activeTrack==='caption'?'Volume (não aplicável à legenda)':'Volume do vídeo selecionado';
 const move=$('tm407Left');if(move)move.title=activeTrack==='video'?'Reordenar vídeo anterior':'Mover item selecionado 0,25s para a esquerda';
 if($('tm407Right'))$('tm407Right').title=activeTrack==='video'?'Reordenar vídeo seguinte':'Mover item selecionado 0,25s para a direita';}

const makeId=()=>crypto.randomUUID?.()||String(Date.now())+'-'+Math.random().toString(36).slice(2);
const allMedia=()=>[...clips,...audioItems];

const v=$('studioSource'),canvas=$('studioCanvas'),ctx=canvas.getContext('2d',{alpha:false});
const info=(msg,save=false)=>{$(save?'studioSaveStatus':'studioStatus').textContent=msg};
async function request(endpoint,action,payload=null){const url=endpoint+'?action='+encodeURIComponent(action);const r=await fetch(url,{method:payload?'POST':'GET',credentials:'same-origin',headers:payload?{'Content-Type':'application/json'}:{},body:payload?JSON.stringify({action,...payload}):undefined});const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw Error(d.error||'Não foi possível concluir a operação.');return d}
const post=(action,payload={})=>request(API,action,payload),get=action=>request(API,action),requireCloud=()=>{if(!cloudReady){$('studioCloudAuth').hidden=false;$('studioCloudAuth').scrollIntoView({behavior:'smooth',block:'center'});throw Error('Conecte a conta administrativa para publicar, atualizar ou excluir na nuvem. A edição local continua liberada.')}},fmt=s=>Math.floor(s/60).toString().padStart(2,'0')+':'+Math.floor(s%60).toString().padStart(2,'0');
function makeCanvas(){const mode=$('ratio').value;const dim=mode==='9:16'?[720,1280]:mode==='1:1'?[720,720]:[1280,720];canvas.width=dim[0];canvas.height=dim[1];}
function draw(){if(!file){ctx.fillStyle='#06151d';ctx.fillRect(0,0,canvas.width,canvas.height);$('timeStamp').textContent='00:00 / 00:00';return;}const W=canvas.width,H=canvas.height;ctx.save();ctx.fillStyle='#091d29';ctx.fillRect(0,0,W,H);
 if(v.readyState>=2){const sw=v.videoWidth,sh=v.videoHeight;const factor=($('fit').value==='cover'?Math.max:Math.min)(W/sw,H/sh);const dw=sw*factor,dh=sh*factor;ctx.filter='brightness('+$('bright').value+'%) contrast('+$('contrast').value+'%)';ctx.drawImage(v,(W-dw)/2,(H-dh)/2,dw,dh);ctx.filter='none'}
 ctx.textAlign='center';const sz=Math.max(21,Math.round(W/28));const t=frameGlobalTime||v.currentTime;
 if($('showTitle').checked&&$('titleOverlay').value.trim()&&t<5){const text=$('titleOverlay').value.trim();ctx.fillStyle='#072333b5';ctx.fillRect(0,12,W,sz*2.0);ctx.fillStyle='#fff';ctx.font='bold '+sz+'px Arial';ctx.fillText(text.slice(0,80),W/2,sz+20,W-30)}
 if($('captionOverlay').value.trim()&&t>=Number($('captionStart').value)&&t<=Number($('captionEnd').value)){
  ctx.fillStyle='#08283dbd';ctx.fillRect(0,H-sz*2.6,W,sz*2.2);ctx.fillStyle='#fff';ctx.font='bold '+Math.floor(sz*.74)+'px Arial';const raw=$('captionOverlay').value.trim().split('\n');raw.slice(0,2).forEach((line,i)=>ctx.fillText(line,W/2,H-sz*(1.65-i*.75),W-35));
 }
 // Fade through dark between clips; transition is visual, no false crossfade claim.
 if($('tm407Transition').value==='fade'&&clips.length>1){
   const current=selectedClip(),offset=Math.max(0,(v.currentTime||0)-(current?.start||0));
   const duration=clipDuration(current),gap=0.32;
   const opacity=Math.max(current===clips[0]?0:1-offset/gap,current===clips[clips.length-1]?0:1-(duration-offset)/gap,0);
   if(opacity>0){ctx.fillStyle='rgba(4,18,28,'+Math.min(.88,Math.max(0,opacity*.88))+')';ctx.fillRect(0,0,W,H)}
 }
 applyExtraTransition(W,H);drawCaptionTrack(W,H);
 ctx.restore();positionPlayhead();$('timeStamp').textContent=fmt(Math.max(0,frameGlobalTime))+' / '+fmt(totalDuration());if(!rendering)$('seek').value=String(Math.max(0,frameGlobalTime));}
function loop(){draw();raf=requestAnimationFrame(loop)}
async function checkCloudAccess({attemptIdentity=true}={}){
 try{
  try{await request(ACADEMY,'admin')}
  catch(first){
   if(!attemptIdentity)throw first;
   const sdk=window.TMNetlifyIdentity;
   if(!sdk?.getUser || !(await sdk.getUser())?.id)throw first;
   await request(ACADEMY,'identitySession',{});
   await request(ACADEMY,'admin');
  }
  cloudReady=true;$('studioAccess').textContent='Nuvem conectada';$('studioLibrary').hidden=false;$('studioCloudAuth').hidden=true;
  await refreshList();$('studioAuthMessage').textContent='✓ Conta de administrador conectada.';
  return true;
 }catch(e){
  cloudReady=false;$('studioAccess').textContent='Editor local disponível';$('studioLibrary').hidden=true;/* formulário só aparece ao solicitar publicação */
  $('studioAuthMessage').textContent='A edição local está liberada. Para publicar e excluir na Academia, conecte sua conta aqui.';
  return false;
 }
}
async function init(){
 // Editing, preview and exporting happen ONLY in the browser: no account needed.
 $('studioMain').hidden=false;info('✓ Estúdio disponível: você pode editar e exportar sem entrar na Gestão da Academia.');
 try{const cat=await request(ACADEMY,'catalog');const lessons=$('videoLesson');for(const lesson of cat.lessons||[]){const opt=document.createElement('option');opt.value=lesson.id;opt.textContent=(lesson.index+1).toString().padStart(2,'0')+'. '+lesson.title;lessons.append(opt)}}catch(e){info('Editor local disponível. Lista de aulas temporariamente indisponível: '+e.message)}
 await checkCloudAccess();
}
$('studioUseSession').onclick=async()=>{if(!await checkCloudAccess())$('studioAuthMessage').textContent='Nenhuma sessão administrativa ativa. Entre com e-mail e senha abaixo, sem sair desta página.'};
$('studioSignInForm').onsubmit=async e=>{
 e.preventDefault();const sdk=window.TMNetlifyIdentity;
 if(!sdk?.login){$('studioAuthMessage').textContent='O componente do Netlify Identity não foi carregado. Confira tm-identity-browser.js.';return}
 const email=$('studioAdminEmail').value.trim().toLowerCase(),password=$('studioAdminPassword').value;
 $('studioAuthMessage').textContent='Conectando ao Netlify Identity…';
 try{
  const user=await sdk.login(email,password);
  if(!user?.id)throw Error('O Identity não confirmou a sessão.');
  await request(ACADEMY,'identitySession',{});
  await request(ACADEMY,'admin');
  $('studioAdminPassword').value='';
  await checkCloudAccess({attemptIdentity:false});
 }catch(err){$('studioAdminPassword').value='';$('studioAuthMessage').textContent='Falha no acesso administrativo: '+err.message}
};
// V407 · editor multiparte: arquivos permanecem locais até o envio explícito.

const snapshot=()=>({clips:clips.map(c=>({...c})),selectedClipId,frameGlobalTime,activeTrack,audioItems:audioItems.map(a=>({...a})),captionItems:captionItems.map(a=>({...a,style:{...a.style}})),selectedAudioId,selectedCaptionId,audioTrackMuted,muteVideoTrack,transition:$('tm407Transition').value,
 settings:Object.fromEntries(['ratio','fit','bright','contrast','titleOverlay','captionOverlay','captionStart','captionEnd','showTitle','videoTitle','videoDescription','videoLesson','studioPublish'].map(id=>[id,$(id).type==='checkbox'?$(id).checked:$(id).value]))});
function updateHistoryButtons(){if($('tm409Undo'))$('tm409Undo').disabled=!historyUndo.length||rendering;if($('tm409Redo'))$('tm409Redo').disabled=!historyRedo.length||rendering}
function pushHistory(value=snapshot()){if(restoringHistory||rendering)return;historyUndo.push(value);if(historyUndo.length>35)historyUndo.shift();historyRedo=[];updateHistoryButtons()}
async function restoreSnapshot(state){
 restoringHistory=true;previewing=false;v.pause();clips=state.clips.map(c=>({...c}));selectedClipId=state.selectedClipId;
 audioItems=(state.audioItems||[]).map(a=>normalizeAudio({...a}));captionItems=(state.captionItems||[]).map(a=>({...a,style:{...a.style}}));selectedAudioId=state.selectedAudioId||'';selectedCaptionId=state.selectedCaptionId||'';activeTrack=state.activeTrack||'video';audioTrackMuted=!!state.audioTrackMuted;muteVideoTrack=!!state.muteVideoTrack;
 if(!clips.some(c=>c.id===selectedClipId))selectedClipId=clips[0]?.id||'';
 $('tm407Transition').value=state.transition;
 for(const [id,val] of Object.entries(state.settings||{})){if($(id).type==='checkbox')$(id).checked=!!val;else $(id).value=val}
 makeCanvas();lastTransition=state.transition;file=null;
 try{
  if(clips.length){const clip=selectedClip();await selectClip(clip.id,Math.min(clip.end-.02,Math.max(clip.start,clip.start+Math.max(0,state.frameGlobalTime-clips.slice(0,clips.indexOf(clip)).reduce((sum,c)=>sum+clipDuration(c),0)))))}
  else {v.removeAttribute('src');v.load();frameGlobalTime=0;renderClips();draw()}
  invalidateExport();renderOverlayTracks();syncCaptionControls();syncAudioControls();updateVideoMuteButtons();updateActiveUI();updateHistoryButtons();scheduleProjectSave();
 }finally{restoringHistory=false}
}
async function historyMove(direction){if(rendering)return;const source=direction==='undo'?historyUndo:historyRedo,target=direction==='undo'?historyRedo:historyUndo;if(!source.length)return;target.push(snapshot());const state=source.pop();await restoreSnapshot(state);info(direction==='undo'?'↶ Última alteração desfeita.':'↷ Alteração refeita.')}
$('tm409Undo').onclick=()=>historyMove('undo').catch(e=>info('⚠ '+e.message));
$('tm409Redo').onclick=()=>historyMove('redo').catch(e=>info('⚠ '+e.message));
const ZOOM_STEPS=[.45,.65,.8,1,1.25,1.6,2,2.5,3.2,4];
function setTimelineZoom(step){let i=ZOOM_STEPS.indexOf(timelineZoom);if(i<0)i=3;i=Math.max(0,Math.min(ZOOM_STEPS.length-1,i+step));timelineZoom=ZOOM_STEPS[i];$('tm409ZoomValue').textContent=Math.round(timelineZoom*100)+'%';renderClips()}
$('tm409ZoomOut').onclick=()=>setTimelineZoom(-1);
$('tm409ZoomIn').onclick=()=>setTimelineZoom(1);
$('tm409NewProject').onclick=async()=>{if(clips.length&&!confirm('Criar outro projeto? O atual será salvo antes de trocar.'))return;
 if(projectArmed)try{await flushSave()}catch{if(!confirm('O último salvamento falhou. Trocar mesmo assim?'))return}
 resetProject(true);info('Novo projeto criado. Dê um nome ao salvar ou importe vídeos para começar.')};
const clipDuration=c=>c?Math.max(0,Number(c.end)-Number(c.start)):0;
const selectedClip=()=>clips.find(c=>c.id===selectedClipId)||clips[0]||null;
const totalDuration=()=>clips.reduce((n,c)=>n+clipDuration(c),0);
function globalPosition(c,time){let result=0;for(const x of clips){if(x.id===c.id)break;result+=clipDuration(x)}return result+Math.max(0,time-c.start)}
function invalidateExport(){exported=null;$('studioDownload').hidden=true;}
function saveClipControls(){const c=selectedClip();if(!c)return;c.start=Number($('trimStart').value);c.end=Number($('trimEnd').value);c.volume=Number($('tm407Volume').value)/100;}
async function loadClip(c,at=null){
 if(!c)return;
 v.pause();v.src=c.url;v.load();
 if(v.readyState<1)await new Promise((resolve,reject)=>{const ok=()=>{cleanup();resolve()},bad=()=>{cleanup();reject(Error('Não foi possível carregar '+c.name))};const cleanup=()=>{v.removeEventListener('loadedmetadata',ok);v.removeEventListener('error',bad)};v.addEventListener('loadedmetadata',ok,{once:true});v.addEventListener('error',bad,{once:true})});
 const position=Math.min(c.end-.02,Math.max(c.start,at??c.start));
 if(Math.abs(v.currentTime-position)>.05){v.currentTime=position;await new Promise(resolve=>{const finish=()=>{v.removeEventListener('seeked',finish);resolve()};v.addEventListener('seeked',finish,{once:true});setTimeout(finish,900)})}
 v.volume=1;if(sharedGain)sharedGain.gain.value=muteVideoTrack?0:c.volume;else v.volume=muteVideoTrack?0:Math.min(1,c.volume);updateVideoMuteButtons();
 frameGlobalTime=globalPosition(c,v.currentTime);if(!arrowBusy&&arrowPending===null)seekDesired=frameGlobalTime;captureThumb(c);draw();
}

function renderRuler(){const el=$('tm408Ruler');if(!el)return;const duration=totalDuration();el.replaceChildren();for(let i=0;i<=4;i++){const span=document.createElement('span');span.textContent=fmt(duration*i/4);el.append(span)}}
function updateSelection(){const el=$('tm408Selection');if(!el)return;const c=selectedClip();el.textContent=c?('Selecionado: '+c.name+' · '+fmt(c.start)+' — '+fmt(c.end)+' · '+Math.round(c.volume*100)+'% de volume · cursor em '+fmt(frameGlobalTime)):'Nenhum trecho selecionado.'}
function positionPlayhead(){const root=$('tm407Clips'),marker=$('tm408Playhead');if(!root||!marker||!clips.length){if(marker)marker.style.display='none';return}const c=selectedClip();if(!c)return;const i=clips.findIndex(x=>x.id===c.id);const b=root.children[i];if(!b)return;const share=Math.max(0,Math.min(1,(v.currentTime-c.start)/Math.max(.01,clipDuration(c))));marker.style.display='block';marker.style.left=(b.getBoundingClientRect().left-$('tm408Playhead').parentElement.getBoundingClientRect().left+b.offsetWidth*share)+'px';if($('tm408Selection'))$('tm408Selection').textContent='Trecho '+(i+1)+'/'+clips.length+' · Cursor: '+fmt(frameGlobalTime)+' · '+c.name}
function captureThumb(c){if(!c||c.thumb||v.readyState<2)return;try{const canv=document.createElement('canvas');canv.width=176;canv.height=100;const g=canv.getContext('2d');g.drawImage(v,0,0,176,100);c.thumb=canv.toDataURL('image/jpeg',.66);renderClips()}catch{}}

function renderClips(){
 const root=$('tm407Clips');root.replaceChildren();
 clips.forEach((c,i)=>{const b=document.createElement('button');b.type='button';b.className='tm407-clip';b.style.setProperty('--clip-flex','1');b.style.setProperty('flex','0 0 '+Math.max(80,Math.round(clipDuration(c)*8*timelineZoom))+'px','important');b.setAttribute('aria-pressed',String(activeTrack==='video' && c.id===selectedClipId));b.draggable=true;
  const label=document.createElement('span');label.className='tm407-clip-title';label.textContent=(i+1)+'. '+c.name;const info=document.createElement('em');info.textContent=fmt(c.start)+'–'+fmt(c.end)+' · '+Math.round(c.volume*100)+'%';if(c.thumb){const poster=document.createElement('img');poster.className='tm407-clip-thumb';poster.src=c.thumb;poster.alt='';b.append(poster)}b.append(label,info);b.title='Clique para posicionar o cursor; arraste para reordenar. Arraste as bordas para aparar.';
 for(const edge of ['left','right']){const handle=document.createElement('span');handle.className='tm411-video-edge tm411-video-'+edge;handle.title=edge==='left'?'Aparar início do vídeo':'Aparar fim do vídeo';handle.draggable=false;
  handle.onpointerdown=e=>{if(e.button!==0||rendering)return;e.preventDefault();e.stopPropagation();chooseTrack('video',c.id);
   const starting=e.clientX,start=c.start,end=c.end,rect=b.getBoundingClientRect(),px=Math.max(8,rect.width/clipDuration(c));let changed=false;b.draggable=false;
   try{handle.setPointerCapture(e.pointerId)}catch{}
   handle.onpointermove=move=>{const delta=(move.clientX-starting)/px;if(Math.abs(move.clientX-starting)<4&&!changed)return;if(!changed){pushHistory();changed=true}
    if(edge==='left')c.start=Math.max(0,Math.min(end-.2,start+delta));else c.end=Math.min(c.fileDuration,Math.max(start+.2,end+delta));
    $('trimStart').value=c.start.toFixed(2);$('trimEnd').value=c.end.toFixed(2);b.classList.add('dragging');};
   handle.onpointerup=()=>{b.draggable=true;b.classList.remove('dragging');handle.onpointermove=null;handle.onpointerup=null;
    if(changed){b.dataset.dragged='yes';invalidateExport();renderClips();selectClip(c.id,Math.min(c.end-.03,Math.max(c.start,v.currentTime))).catch(err=>info(err.message));scheduleProjectSave();}};
   handle.onpointercancel=handle.onpointerup;
  };b.append(handle)}
 b.onclick=e=>{
  if(b.dataset.dragged==='yes'){b.dataset.dragged='';return}
  const rect=b.getBoundingClientRect();
  const share=Math.max(0,Math.min(.995,(e.clientX-rect.left)/Math.max(1,rect.width)));
  chooseTrack('video',c.id);
  const target=c.start+clipDuration(c)*share;
  frameGlobalTime=globalPosition(c,target);
  seekDesired=frameGlobalTime;
  $('seek').value=String(frameGlobalTime);
  selectClip(c.id,target).catch(err=>info('⚠ Não foi possível posicionar o vídeo: '+err.message));
 };
  b.ondragstart=e=>e.dataTransfer.setData('text/plain',c.id);b.ondragover=e=>e.preventDefault();b.ondrop=e=>{e.preventDefault();moveClip(e.dataTransfer.getData('text/plain'),c.id)};root.append(b);
 });
 $('tm407Total').textContent=fmt(totalDuration())+' · '+clips.length+' trecho(s)';$('seek').max=String(totalDuration()||1);renderRuler();updateSelection();positionPlayhead();updateHistoryButtons();renderOverlayTracks();updateActiveUI();if(!rendering&&!projectLoading&&!restoringHistory)scheduleProjectSave();
}
async function selectClip(id,at){if(rendering)return;const c=clips.find(x=>x.id===id);if(!c)return;previewing=false;selectedClipId=id;file=c.file;$('trimStart').value=c.start.toFixed(2);$('trimEnd').value=c.end.toFixed(2);$('tm407Volume').value=Math.round(c.volume*100);$('tm407VolumeText').textContent=Math.round(c.volume*100)+'%';renderClips();await loadClip(c,at)}
async function appendVideos(list,{clear=false}={}){
 if(rendering)return;
 if(clear){v.pause();sourceUrls.forEach(url=>URL.revokeObjectURL(url));sourceUrls.clear();clips=[];selectedClipId='';historyUndo=[];historyRedo=[]}else if(list?.length)pushHistory();
 for(const f of Array.from(list||[])){
  if(!f.type.startsWith('video/')){info('Ignorando arquivo incompatível: '+f.name);continue}
  const url=URL.createObjectURL(f),probe=document.createElement('video');probe.preload='metadata';probe.src=url;
  const duration=await new Promise((resolve,reject)=>{probe.onloadedmetadata=()=>resolve(probe.duration);probe.onerror=()=>reject(Error('Não foi possível abrir '+f.name));setTimeout(()=>reject(Error('Tempo esgotado ao carregar '+f.name)),12000)});
  if(!Number.isFinite(duration)||duration<=.2){URL.revokeObjectURL(url);continue}
  const c={id:makeId(),mediaKey:makeId(),name:f.name,file:f,url,start:0,end:duration,fileDuration:duration,volume:1};clips.push(c);sourceUrls.set(c.mediaKey,url);
 }
 if(!clips.length){info('Nenhum vídeo válido selecionado.');return}
 if(!projectArmed){projectArmed=true;projectId=makeId();projectName=clips[0].name.replace(/\.[^.]+$/,'');updateProjectHeading()}
 invalidateExport();renderClips();await selectClip(clips[clear?0:clips.length-1].id);
 if(clear){$('videoTitle').value=clips[0].name.replace(/\.[^.]+$/,'');$('captionEnd').value='5'}
 info(clips.length+' trecho(s) na timeline. Divida, reorganize e exporte antes de publicar. Nenhum vídeo foi enviado à nuvem.');
}
$('tm407AddVideos').onchange=async e=>{try{await appendVideos(e.target.files)}catch(err){info('⚠ '+err.message)}e.target.value=''};
function moveClip(sourceId,destId){if(rendering||!sourceId||sourceId===destId)return;const from=clips.findIndex(c=>c.id===sourceId),to=clips.findIndex(c=>c.id===destId);if(from<0||to<0)return;pushHistory();const [clip]=clips.splice(from,1);clips.splice(to,0,clip);invalidateExport();renderClips();if(selectedClip())frameGlobalTime=globalPosition(selectedClip(),v.currentTime);draw()}
function shiftSelected(direction){if(activeTrack==='video'){const i=clips.findIndex(c=>c.id===selectedClipId);if(direction<0&&i>0)moveClip(selectedClipId,clips[i-1].id);if(direction>0&&i>=0&&i<clips.length-1)moveClip(selectedClipId,clips[i+1].id);return}
 const item=activeItem();if(!item)return;pushHistory();const delta=direction*.25;
 if(activeTrack==='audio')item.startAt=Math.max(0,item.startAt+delta);
 else{const duration=item.endAt-item.startAt;item.startAt=Math.max(0,item.startAt+delta);item.endAt=item.startAt+duration;}
 afterTimelineEdit();}
$('tm407Left').onclick=()=>shiftSelected(-1);
$('tm407Right').onclick=()=>shiftSelected(1);
function afterTimelineEdit(){invalidateExport();renderClips();renderOverlayTracks();draw();updateExtraAudio(true);scheduleProjectSave()}

$('tm407Remove').onclick=async()=>{if(rendering)return;if(activeTrack==='audio')return deleteSelectedAudio();if(activeTrack==='caption')return deleteSelectedCaption();if(!selectedClip())return;const i=clips.findIndex(c=>c.id===selectedClipId);pushHistory();clips.splice(i,1);if(!clips.length){selectedClipId='';file=null;v.pause();v.removeAttribute('src');v.load();frameGlobalTime=0;renderClips();draw();invalidateExport();scheduleProjectSave();return}invalidateExport();await selectClip(clips[Math.max(0,i-1)].id)};
async function splitAtCursor(){
 if(rendering)return;
 if(activeTrack==='audio'){
  const a=activeItem();if(!a)return;const offset=frameGlobalTime-a.startAt;
  if(offset<.2||offset>audioLength(a)-.2){info('Posicione o cursor dentro do áudio, com ao menos 0,2s de cada extremidade.');return}
  pushHistory();normalizeAudio(a);const cut=a.sourceStart+offset;
  const left=normalizeAudio({...a,id:makeId(),sourceEnd:cut,fadeOut:0}),right=normalizeAudio({...a,id:makeId(),sourceStart:cut,startAt:frameGlobalTime,fadeIn:0});
  audioItems.splice(audioItems.indexOf(a),1,left,right);chooseTrack('audio',right.id);afterTimelineEdit();info('✂ Áudio dividido em dois trechos independentes.');return;
 }
 if(activeTrack==='caption'){
  const c=activeItem();if(!c)return;const cut=frameGlobalTime;
  if(cut<c.startAt+.1||cut>c.endAt-.1){info('Posicione o cursor no interior da legenda.');return}
  pushHistory();const left={...c,id:makeId(),endAt:cut,style:{...c.style}},right={...c,id:makeId(),startAt:cut,style:{...c.style}};
  captionItems.splice(captionItems.indexOf(c),1,left,right);chooseTrack('caption',right.id);afterTimelineEdit();info('✂ Legenda dividida; você pode editar cada trecho separadamente.');return;
 }
 const c=selectedClip();if(!c||rendering)return;const cut=v.currentTime;
 if(cut<=c.start+.2||cut>=c.end-.2){info('Posicione o cursor pelo menos 0,2 segundo longe do início e do fim para dividir.');return}
 const left={...c,id:crypto.randomUUID?.()||String(Math.random()),end:cut},right={...c,id:crypto.randomUUID?.()||String(Math.random()),start:cut};
 pushHistory();const i=clips.indexOf(c);clips.splice(i,1,left,right);invalidateExport();await selectClip(right.id);info('✂ Corte aplicado. Selecione o trecho indesejado e pressione Delete.');
}
$('tm407Split').onclick=splitAtCursor;
document.addEventListener('keydown',event=>{
 if(rendering||event.repeat)return;
 const typed=event.target instanceof Element&&event.target.closest('input:not([type=range]),textarea,select,[contenteditable="true"]');
 if((event.ctrlKey||event.metaKey)&&!event.altKey&&!typed){const k=event.key.toLowerCase();if(k==='z'){event.preventDefault();historyMove(event.shiftKey?'redo':'undo').catch(e=>info(e.message));return}if(k==='y'){event.preventDefault();historyMove('redo').catch(e=>info(e.message));return}}
 if(event.altKey||event.ctrlKey||event.metaKey||typed)return;
 const k=event.key.toLowerCase();
 if(k==='s'){event.preventDefault();splitAtCursor().catch(e=>info(e.message))}
 else if(event.code==='Space'){event.preventDefault();if(v.paused)$('studioPlay').click();else $('studioPause').click()}
 else if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();$('tm407Remove').click()}

});
$('tm407Volume').oninput=e=>{if(activeTrack==='caption')return;const c=activeItem();if(!c)return;if(!volumeGesture){pushHistory();volumeGesture=true}
 c.volume=Number(e.target.value)/100;$('tm407VolumeText').textContent=e.target.value+'%';
 if(activeTrack==='audio'){const p=extraPlayers.get(c.id),level=audioEffectiveVolume(c);if(p){if(p.gain)p.gain.gain.value=level;else p.el.volume=Math.min(1,level);}syncAudioControls();}else{if(sharedGain)sharedGain.gain.value=muteVideoTrack?0:c.volume;else v.volume=muteVideoTrack?0:Math.min(1,c.volume);updateVideoMuteButtons();}
 invalidateExport();renderClips();scheduleProjectSave()};
$('tm407Volume').addEventListener('change',()=>{volumeGesture=false;scheduleProjectSave()});$('tm407Volume').addEventListener('pointerup',()=>{volumeGesture=false;scheduleProjectSave()});
let lastTransition=$('tm407Transition').value;
$('tm407Transition').onchange=()=>{const current=$('tm407Transition').value;$('tm407Transition').value=lastTransition;pushHistory();$('tm407Transition').value=current;lastTransition=current;invalidateExport();draw();scheduleProjectSave()};
for(const id of ['trimStart','trimEnd'])$(id).addEventListener('change',async()=>{
 const c=selectedClip();if(!c)return;
 const from=Number($('trimStart').value),to=Number($('trimEnd').value);
 if(!Number.isFinite(from)||!Number.isFinite(to)||from<0||to>v.duration+.05||to-from<.2){$('trimStart').value=c.start.toFixed(2);$('trimEnd').value=c.end.toFixed(2);info('Corte inválido: início deve anteceder o fim em pelo menos 0,2s.');return}
 pushHistory();c.start=from;c.end=to;invalidateExport();renderClips();if(v.currentTime<from||v.currentTime>to){v.currentTime=from}draw()
});
v.onloadedmetadata=()=>{draw()};
v.onplay=()=>{if(!raf)loop();if(sharedAudioCtx?.state==='suspended')sharedAudioCtx.resume().catch(()=>{});updateExtraAudio(true)};v.onpause=()=>{cancelAnimationFrame(raf);raf=0;pauseExtraAudio();draw()};
v.ontimeupdate=()=>{const c=selectedClip();if(!c||rendering)return;frameGlobalTime=globalPosition(c,v.currentTime);if(Date.now()-additionalTick>200){updateExtraAudio();additionalTick=Date.now()}if(previewing&&v.currentTime>=c.end-.07){v.pause();const index=clips.indexOf(c);if(index<clips.length-1){selectClip(clips[index+1].id).then(()=>{previewing=true;v.play().catch(()=>{})})}else previewing=false}else if(!previewing&&v.currentTime>=c.end)v.pause();draw()};
$('studioPlay').onclick=async()=>{captionEditPreview=false;const c=selectedClip();if(!c)return info('Importe um vídeo primeiro.');previewing=true;if(v.currentTime<c.start||v.currentTime>=c.end-.05)await loadClip(c,c.start);try{await v.play()}catch(e){info(e.message)}};
$('studioPause').onclick=()=>{previewing=false;v.pause()};
$('seek').oninput=async e=>{if(!clips.length||rendering)return;let position=Number(e.target.value),c=clips[0];for(const clip of clips){if(position<=clipDuration(clip)){c=clip;break}position-=clipDuration(clip);c=clip}previewing=false;await selectClip(c.id,c.start+position);updateExtraAudio(true)};
for(const id of ['bright','contrast','fit','titleOverlay','captionOverlay','showTitle','captionStart','captionEnd','videoTitle','videoDescription','videoLesson','studioPublish'])$(id).addEventListener('input',()=>{invalidateExport();draw();scheduleProjectSave()});
$('ratio').onchange=()=>{invalidateExport();makeCanvas();draw();scheduleProjectSave()};
async function initExportAudio(stream){
 try{
  if(!sharedAudioCtx){sharedAudioCtx=new (window.AudioContext||window.webkitAudioContext)();sharedAudioSource=sharedAudioCtx.createMediaElementSource(v);sharedAudioDest=sharedAudioCtx.createMediaStreamDestination();sharedGain=sharedAudioCtx.createGain();sharedAudioSource.connect(sharedGain);sharedGain.connect(sharedAudioDest);sharedGain.connect(sharedAudioCtx.destination)}
  await sharedAudioCtx.resume();ensureAudioMix();for(const t of sharedAudioDest.stream.getAudioTracks())stream.addTrack(t.clone());
 }catch(e){info('⚠ Não foi possível incluir o áudio neste navegador: '+e.message,true)}
}
async function exportVideo(){
 if(rendering)return;
 let stream,recorder,outputHandle=null,chosenFileName='';
 const beforeExport={id:selectedClipId,at:v.currentTime,track:activeTrack};
 try{
  if(!clips.length)throw Error('Selecione um ou mais vídeos primeiro.');
  if(!('MediaRecorder' in window)||!canvas.captureStream)throw Error('Seu navegador não permite exportação de vídeo.');
  previewing=false;v.pause();makeCanvas();
  const choice=$('studioExportFormat')?.value||'mp4';
  const supported=(types)=>types.find(t=>MediaRecorder.isTypeSupported(t));
  // Some Chromium versions support MP4/H.264 with Opus rather than AAC; try standard AAC first.
  const mp4Types=['video/mp4;codecs="avc1.42E01E,mp4a.40.2"','video/mp4;codecs="avc1.42E01E,opus"','video/mp4;codecs="avc1.42E01E"','video/mp4'];
  const webmTypes=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
  const type=supported(choice==='webm'?webmTypes:mp4Types);
  if(!type)throw Error(choice==='mp4'?'Este navegador não oferece codificação MP4 pelo MediaRecorder. Escolha WebM como formato alternativo ou use um Chrome/Edge com suporte MP4/H.264. Não renomeie um WebM como MP4.':'Nenhum codec WebM disponível neste navegador.');
  const ext=type.startsWith('video/mp4')?'mp4':'webm';
  chosenFileName=(projectName||$('videoTitle').value||'teacher-marks-videoaula').replace(/[\\/:*?"<>|]/g,'_').slice(0,95)+'.'+ext;
  if(typeof window.showSaveFilePicker==='function'){
   try{outputHandle=await window.showSaveFilePicker({suggestedName:chosenFileName,types:[{description:ext.toUpperCase()+' · Videoaula',accept:{['video/'+ext]:['.'+ext]}}]});}
   catch(err){if(err?.name==='AbortError')return;info('O seletor de pasta não pôde ser aberto; usaremos o download do navegador: '+err.message);}
  }
  const overlay=$('tm414ExportOverlay');
  try{$('tm414ExportStill').src=canvas.toDataURL('image/jpeg',.65)}catch{$('tm414ExportStill').removeAttribute('src')}
  overlay.hidden=false;$('tm414ExportProgress').textContent='Iniciando renderização…';$('tm414ExportProgressBar').style.width='0%';
  stream=canvas.captureStream(24);await initExportAudio(stream);
  // Capture remains active, but the audio is not played on the speakers during export.
  if(sharedAudioCtx){try{sharedGain?.disconnect(sharedAudioCtx.destination)}catch{}for(const p of extraPlayers.values())try{p.gain?.disconnect(sharedAudioCtx.destination)}catch{}}
  const chunks=[];recorder=new MediaRecorder(stream,{mimeType:type,videoBitsPerSecond:2500000,audioBitsPerSecond:128000});recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
  const done=new Promise((res,rej)=>{recorder.onerror=e=>rej(e.error||Error('Falha na exportação'));recorder.onstop=res});
  rendering=true;info('Exportando '+clips.length+' trecho(s) em tempo real. Não feche esta aba.',true);recorder.start(700);
  for(const clip of clips){
   selectedClipId=clip.id;file=clip.file;renderClips();await loadClip(clip,clip.start);
   if(sharedGain)sharedGain.gain.value=muteVideoTrack?0:clip.volume;else v.volume=muteVideoTrack?0:Math.min(1,clip.volume);
   await v.play();updateExtraAudio(true);
   const deadline=Date.now()+Math.max(15000,Math.ceil(clipDuration(clip)*2500+12000));
   while(v.currentTime<clip.end-.04&&!v.ended){updateExtraAudio();if(Date.now()>deadline)throw Error('O navegador parou de avançar neste trecho. Verifique o formato do vídeo ou tente novamente.');await new Promise(r=>setTimeout(r,60));frameGlobalTime=globalPosition(clip,v.currentTime);draw();$('tm414ExportProgress').textContent='Processando '+fmt(frameGlobalTime)+' de '+fmt(totalDuration());$('tm414ExportProgressBar').style.width=Math.min(100,Math.round(frameGlobalTime/Math.max(.1,totalDuration())*100))+'%';info('Processando videoaula: '+fmt(frameGlobalTime)+' / '+fmt(totalDuration()),true)}
   v.pause();pauseExtraAudio();frameGlobalTime=globalPosition(clip,clip.end);draw();
  }
  recorder.stop();await done;rendering=false;stream.getTracks().forEach(t=>t.stop());
  const actualMime=(recorder.mimeType||type).split(';')[0].trim().toLowerCase();
  const actualContainer=actualMime==='video/mp4'?'mp4':'webm';
  exported=new Blob(chunks,{type:actualMime});if(exportUrl)URL.revokeObjectURL(exportUrl);exportUrl=URL.createObjectURL(exported);
  $('studioDownload').download='teacher-marks-videoaula.'+actualContainer;

  $('studioDownload').href=exportUrl;$('studioDownload').hidden=false;
  if(outputHandle){
   const writable=await outputHandle.createWritable();
   try{await writable.write(exported);await writable.close();info('✓ Vídeo salvo em '+outputHandle.name+' ('+(exported.size/1048576).toFixed(1)+' MB).',true)}
   catch(err){try{await writable.abort()}catch{}throw Error('Não foi possível salvar o MP4 na pasta escolhida: '+err.message)}
  }else{
   $('studioDownload').download=chosenFileName||$('studioDownload').download;
   $('studioDownload').click();info('✓ Vídeo exportado. O download foi iniciado ('+(exported.size/1048576).toFixed(1)+' MB). Caso não abra a escolha da pasta, ative essa opção nas configurações de Downloads do navegador.',true)
  }
 }catch(e){rendering=false;v.pause();if(recorder?.state==='recording')recorder.stop();stream?.getTracks().forEach(t=>t.stop());info('⚠ '+e.message,true)}
 finally{
   $('tm414ExportOverlay').hidden=true;
   if(sharedAudioCtx){try{sharedGain?.connect(sharedAudioCtx.destination)}catch{}for(const p of extraPlayers.values())try{p.gain?.connect(sharedAudioCtx.destination)}catch{}}
   if(!rendering&&clips.length){const old=clips.find(c=>c.id===beforeExport.id)||clips[0];activeTrack=beforeExport.track;try{await selectClip(old.id,Math.max(old.start,Math.min(old.end-.05,beforeExport.at)))}catch{}}
 }
}
$('studioExport').onclick=exportVideo;
$('studioExportFormat').onchange=()=>{invalidateExport();info('Formato de exportação alterado. Exporte novamente para gerar o arquivo no formato escolhido.',true)};
const b64=part=>new Promise((res,rej)=>{const reader=new FileReader();reader.onload=()=>res(String(reader.result).split(',')[1]);reader.onerror=rej;reader.readAsDataURL(part)});
function validatePublish(){if(!$('videoTitle').value.trim())throw Error('Informe o título da videoaula.');return {title:$('videoTitle').value,description:$('videoDescription').value,lessonId:$('videoLesson').value,published:$('studioPublish').checked}}
async function publishItem(id){requireCloud();await post('save',{id,...validatePublish()});info('✓ Videoaula salva no Netlify'+($('studioPublish').checked?' e publicada aos alunos.':' como rascunho.') ,true);await refreshList()}
$('studioUpload').onclick=async()=>{
 if(storing)return;
 try{
  requireCloud();const meta=validatePublish();const needsExport=clips.length>1||clips.some(c=>c.start>.01||c.end<c.fileDuration-.01||c.volume!==1)||muteVideoTrack||audioItems.length>0||captionItems.length>0||$('tm407Transition').value!=='none'||$('titleOverlay').value.trim()||$('captionOverlay').value.trim()||$('bright').value!=='100'||$('contrast').value!=='100'||$('fit').value!=='contain'||$('ratio').value!=='16:9';if(needsExport&&!exported)throw Error('Exporte primeiro a timeline para enviar todos os cortes e vídeos na ordem escolhida.');const blob=exported||file;
  if(!blob)throw Error('Importe um vídeo primeiro.');if(blob.size>MAX)throw Error('Vídeo acima de 96 MB. Compacte o arquivo ou utilize YouTube/Vimeo.');
  if(!['video/webm','video/mp4','video/ogg'].includes(blob.type))throw Error('Formato de vídeo não compatível. Exporte em MP4 ou WebM antes de publicar.');
  storing=true;$('studioUpload').disabled=true;info('Preparando envio…',true);
  const started=await post('initUpload',{size:blob.size,contentType:blob.type});
  for(let i=0;i<started.total;i++){const slice=blob.slice(i*started.chunkSize,Math.min(blob.size,(i+1)*started.chunkSize));await post('uploadChunk',{id:started.id,index:i,data:await b64(slice)});info('Enviando parte '+(i+1)+' de '+started.total+'…',true)}
  await post('finishUpload',{id:started.id});await post('save',{id:started.id,...meta});
  info('✓ Upload concluído e videoaula '+(meta.published?'publicada':'salva como rascunho')+'.',true);await refreshList();
 }catch(e){info('⚠ '+e.message+' (um envio interrompido não ficará publicado).',true)}finally{storing=false;$('studioUpload').disabled=false}
};
$('studioLink').onclick=async()=>{try{requireCloud();const meta=validatePublish(),url=$('studioExternal').value.trim();if(!url)throw Error('Informe o link YouTube ou Vimeo.');const r=await post('createLink',{url});await post('save',{id:r.id,...meta});info('✓ Link de videoaula salvo'+(meta.published?' e publicado.':'.'),true);await refreshList()}catch(e){info('⚠ '+e.message,true)}};
async function refreshList(){const d=await get('catalog');const root=$('studioList');root.replaceChildren();if(!d.videos?.length){root.textContent='Ainda não há vídeos cadastrados.';return}
 for(const item of d.videos){const row=document.createElement('div');row.className='video-row';const label=document.createElement('div');const title=document.createElement('strong');title.textContent=item.title;const desc=document.createElement('div');desc.className='small muted';desc.textContent=(item.published?'Publicado':'Rascunho')+' · '+(item.lessonId||'Complementar')+' · '+(item.type==='link'?'Vídeo externo':'Arquivo privado');label.append(title,desc);
  const tools=document.createElement('div');tools.className='flex';const edit=document.createElement('button');edit.className='btn small';edit.textContent='Editar cadastro';edit.onclick=()=>{videoId=item.id;$('videoTitle').value=item.title;$('videoDescription').value=item.description||'';$('videoLesson').value=item.lessonId||'';$('studioPublish').checked=!!item.published;info('Editando dados de '+item.title,true)};
  const save=document.createElement('button');save.className='btn small primary';save.textContent='Salvar cadastro';save.onclick=async()=>{try{requireCloud();await post('save',{id:item.id,...validatePublish()});info('✓ Cadastro atualizado.',true);await refreshList()}catch(e){info('⚠ '+e.message,true)}};
  const del=document.createElement('button');del.className='btn small';del.textContent='Excluir da Academia';del.onclick=async()=>{if(!confirm('EXCLUIR a videoaula \"'+item.title+'\" da plataforma do aluno?\n\nA página do estudante não voltará a mostrar este vídeo. Os dados editoriais serão preservados apenas como registro técnico de exclusão.'))return;try{requireCloud();await post('delete',{id:item.id});await refreshList();info('✓ Videoaula removida do servidor e do catálogo do aluno. Uma aba antiga já aberta pode precisar ser atualizada.',true)}catch(e){info('⚠ '+e.message,true)}};
  tools.append(edit,save,del);row.append(label,tools);root.append(row)
 }
}
$('reloadVideos').onclick=refreshList;
$('tm407Clips').addEventListener('scroll',positionPlayhead,{passive:true});
// V409 – edição de faixas, textos e projetos locais. Não modifica a API da Academia.
// V414: independent portable project file — works even when IndexedDB reports quota errors.
function portableBlob(){
 if(!clips.length&&!audioItems.length&&!captionItems.length)throw Error('Importe um vídeo ou crie uma legenda antes de salvar.');
 const list=[],media=new Map();
 for(const item of allMedia()){
  if(!item.mediaKey||!item.file)throw Error('A mídia '+(item.name||'')+' não está disponível para salvar.');
  if(!media.has(item.mediaKey))media.set(item.mediaKey,item);
 }
 for(const [mediaKey,item] of media){list.push({mediaKey,name:item.name||'Mídia',mime:item.file.type||'application/octet-stream',size:item.file.size});}
 const rec=projectRecord();
 const header=JSON.stringify({format:'teacher-marks-v414-portable',record:rec,files:list});
 const utf=new TextEncoder().encode(header);
 const framing='TMVIDEO414\n'+utf.byteLength.toString(16).padStart(12,'0')+'\n';
 return new Blob([framing,utf,...list.map(x=>media.get(x.mediaKey).file)],{type:'application/octet-stream'});
}
function portableName(){return (projectName||$('videoTitle').value||'teacher-marks-projeto').replace(/[\\/:*?"<>|]/g,'_').slice(0,95)+'.tmvideo'}
async function downloadPortableBackup(blob,name){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),18000)}
async function writePortable(handle,blob){const writable=await handle.createWritable();try{await writable.write(blob);await writable.close()}catch(e){try{await writable.abort()}catch{}throw e}}
function schedulePortableSave(){
 if(!portableHandle||projectLoading||rendering||!projectArmed)return;
 clearTimeout(portableSaveTimer);
 portableSaveTimer=setTimeout(()=>{
  const currentId=projectId,handle=portableHandle;
  portableSavePipeline=portableSavePipeline.catch(()=>{}).then(async()=>{
   if(currentId!==projectId||handle!==portableHandle)return;
   portableSaveRunning=true;
   try{await writePortable(handle,portableBlob());if(currentId===projectId)projectStatus('✓ Projeto salvo no arquivo '+handle.name,'saved')}
   catch(err){if(currentId===projectId)projectStatus('⚠ Cópia no computador não atualizada: '+err.message,'error')}
   finally{portableSaveRunning=false}
  });
 },3500);
}
$('tm414SaveFile').onclick=async()=>{
 if(!projectArmed){projectArmed=true;if(!projectId)projectId=makeId();projectName=projectName||$('videoTitle').value||'Minha videoaula';updateProjectHeading()}
 try{
  const blob=portableBlob(),name=portableName();let handle=portableHandle;
  if(typeof window.showSaveFilePicker==='function'){
    try{handle=await window.showSaveFilePicker({suggestedName:name,types:[{description:'Projeto Teacher Marks',accept:{'application/octet-stream':['.tmvideo']}}]})}
    catch(err){if(err?.name==='AbortError')return;handle=null;}
  }
  if(handle){await writePortable(handle,blob);portableHandle=handle;projectStatus('✓ Projeto salvo em '+handle.name+' · próximas edições serão atualizadas automaticamente','saved')}
  else{await downloadPortableBackup(blob,name);projectStatus('✓ Cópia .tmvideo enviada para Downloads. Se o navegador bloquear, confira a pasta Downloads.','saved')}
 }catch(err){projectStatus('⚠ Não foi possível salvar o arquivo .tmvideo: '+err.message,'error')}
};
const DB_NAME='TeacherMarksVideoProjectsV409', DB_VERSION=1;
let cachedDbPromise=null;
function dbOpen(){
 if(cachedDbPromise)return cachedDbPromise;
 cachedDbPromise=new Promise((resolve,reject)=>{
  if(!window.indexedDB)return reject(Error('IndexedDB não disponível neste navegador.'));
  const req=indexedDB.open(DB_NAME,DB_VERSION);
  req.onupgradeneeded=()=>{
   const db=req.result;
   if(!db.objectStoreNames.contains('projects'))db.createObjectStore('projects',{keyPath:'id'});
   if(!db.objectStoreNames.contains('media'))db.createObjectStore('media',{keyPath:'key'});
  };
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>{cachedDbPromise=null;reject(req.error||Error('Falha ao abrir o armazenamento local.'))};
 });return cachedDbPromise;
}
function dbRead(store,key){return dbOpen().then(db=>new Promise((resolve,reject)=>{const req=db.transaction(store,'readonly').objectStore(store).get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)}))}
function dbList(){return dbOpen().then(db=>new Promise((resolve,reject)=>{const req=db.transaction('projects','readonly').objectStore('projects').getAll();req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error)}))}
function dbCommit(stores,callback){return dbOpen().then(db=>new Promise((resolve,reject)=>{const tx=db.transaction(stores,'readwrite');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error||Error('Gravação do projeto interrompida'));tx.onabort=()=>reject(tx.error||Error('Espaço de armazenamento insuficiente'));try{callback(tx)}catch(e){tx.abort();reject(e)}}))}
function projectStatus(message,state='pending'){$('tm410SaveIndicator').textContent=message;$('tm410SaveIndicator').dataset.state=state}
function updateProjectHeading(){$('tm410ProjectName').textContent=projectName||'Projeto sem nome'}
function settingsData(){return snapshot().settings}
function safeClips(){return clips.map(c=>({id:c.id,mediaKey:c.mediaKey,name:c.name,start:c.start,end:c.end,fileDuration:c.fileDuration,volume:c.volume}))}
function safeAudio(){return audioItems.map(c=>({id:c.id,mediaKey:c.mediaKey,name:c.name,startAt:c.startAt,duration:c.duration,sourceStart:c.sourceStart,sourceEnd:c.sourceEnd,fileDuration:c.fileDuration,fadeIn:c.fadeIn,fadeOut:c.fadeOut,volume:c.volume,muted:c.muted}))}
function safeCaptions(){return captionItems.map(c=>({id:c.id,text:c.text,startAt:c.startAt,endAt:c.endAt,hidden:!!c.hidden,style:{...c.style}}))}
function projectRecord(){return {id:projectId,name:projectName||'Videoaula sem título',updatedAt:new Date().toISOString(),createdAt:projectCreatedAt||new Date().toISOString(),clips:safeClips(),audio:safeAudio(),captions:safeCaptions(),audioMuted:audioTrackMuted,videoMuted:muteVideoTrack,settings:settingsData(),transition:$('tm407Transition').value,zoom:timelineZoom,selection:selectedClipId,activeTrack,selectedAudioId,selectedCaptionId,position:frameGlobalTime}}
let projectCreatedAt='';
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&projectArmed){clearTimeout(autoSaveTimer);flushSave().catch(()=>{})}});
function scheduleProjectSave(){
 if(!projectArmed||projectLoading||rendering||restoringHistory)return;
 projectStatus('● Alterações pendentes');clearTimeout(autoSaveTimer);
 autoSaveTimer=setTimeout(()=>{flushSave().catch(()=>{})},650);
 schedulePortableSave();
}
async function flushSave(){
 clearTimeout(autoSaveTimer);autoSaveTimer=0;
 if(!projectArmed||!projectId)return;
 const rec=projectRecord(),projectAtCall=projectId;
 const newItems=[];const seen=new Set();
 for(const entry of allMedia()){
  if(!entry.mediaKey)entry.mediaKey=makeId();
  if(seen.has(entry.mediaKey)||savedMediaKeys.has(entry.mediaKey))continue;
  seen.add(entry.mediaKey);
  if(!entry.file)throw Error('O arquivo de mídia "'+entry.name+'" não está mais disponível.');
  newItems.push({key:projectAtCall+':'+entry.mediaKey,blob:entry.file,name:entry.name,mime:entry.file.type||'',mediaKey:entry.mediaKey});
 }
 const saveVersion=++savingRevision;
 projectStatus('● Gravando projeto…');
 savePipeline=savePipeline.catch(()=>{}).then(async()=>{
  try{
   await dbCommit(['projects','media'],tx=>{
    for(const m of newItems)tx.objectStore('media').put(m);
    tx.objectStore('projects').put(rec);
   });
   if(projectAtCall===projectId){newItems.forEach(m=>savedMediaKeys.add(m.mediaKey));if(saveVersion===savingRevision)projectStatus('✓ Salvo neste navegador · '+new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}),'saved')}
  }catch(err){if(projectAtCall===projectId)projectStatus('⚠ Não salvo no navegador: '+(err?.name==='QuotaExceededError'?'espaço insuficiente':err?.message||'falha desconhecida')+'. Use “Salvar arquivo .tmvideo” como cópia de segurança.','error');throw err}
 });return savePipeline;
}
function newProjectId(name){portableHandle=null;clearTimeout(portableSaveTimer);projectId=makeId();projectCreatedAt=new Date().toISOString();projectName=name||'';projectArmed=!!name;savedMediaKeys=new Set();updateProjectHeading();projectStatus(name?'● Novo projeto aguardando gravação':'Pronto para editar')}
function resetProject(resetName=true){
 clearTimeout(autoSaveTimer);projectLoading=true;previewing=false;v.pause();altAudio?.pause();sourceUrls.forEach(url=>URL.revokeObjectURL(url));sourceUrls.clear();audioUrls.forEach(url=>URL.revokeObjectURL(url));audioUrls.clear();
 clips=[];audioItems=[];captionItems=[];muteVideoTrack=false;captionEditPreview=false;selectedClipId='';selectedAudioId='';selectedCaptionId='';activeTrack='video';disposeExtraPlayers();file=null;currentAudioKey='';historyUndo=[];historyRedo=[];frameGlobalTime=0;v.removeAttribute('src');v.load();if(altAudio){altAudio.removeAttribute('src');altAudio.load()}
 if(resetName)newProjectId('');
 $('tm410CaptionText').value='';$('tm407Transition').value='none';lastTransition='none';invalidateExport();renderClips();renderOverlayTracks();draw();updateHistoryButtons();projectLoading=false;
}
async function listProjectUI(){
 const el=$('tm410ProjectsList');el.replaceChildren();const list=(await dbList()).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
 if(!list.length){el.textContent='Nenhum projeto salvo neste navegador.';return}
 for(const p of list){const row=document.createElement('div');row.className='tm410-project-entry';
 const desc=document.createElement('div');const title=document.createElement('strong');title.textContent=p.name;const meta=document.createElement('small');meta.textContent=(p.clips?.length||0)+' trechos · '+(p.audio?.length||0)+' áudios · '+(p.captions?.length||0)+' legendas · '+new Date(p.updatedAt).toLocaleString('pt-BR');desc.append(title,meta);
 const actions=document.createElement('div');actions.className='flex';const open=document.createElement('button');open.type='button';open.className='btn primary';open.textContent='Retomar';open.onclick=async()=>{try{if(projectArmed&&projectId!==p.id)await flushSave();await loadProject(p.id);$('tm410ProjectDialog').close()}catch(e){$('tm410ProjectDialogStatus').textContent='⚠ '+e.message}};
 const del=document.createElement('button');del.type='button';del.className='btn';del.textContent='Excluir';del.onclick=async()=>{if(!confirm('Excluir definitivamente o projeto "'+p.name+'" E OS ARQUIVOS LOCAIS associados?'))return;try{await removeProject(p.id);await listProjectUI()}catch(e){$('tm410ProjectDialogStatus').textContent='⚠ '+e.message}};actions.append(open,del);row.append(desc,actions);el.append(row)}
}
async function removeProject(id){
 if(projectId===id&&projectArmed)await flushSave();
 const rec=await dbRead('projects',id);if(!rec)return;
 const db=await dbOpen();await new Promise((resolve,reject)=>{const tx=db.transaction(['projects','media'],'readwrite');tx.objectStore('projects').delete(id);
 const store=tx.objectStore('media'),req=store.openCursor();req.onsuccess=()=>{const cur=req.result;if(!cur)return;if(String(cur.key).startsWith(id+':'))cur.delete();cur.continue()};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});
 if(projectId===id)resetProject();info('Projeto excluído do armazenamento local.');
}
async function loadProject(id){
 const rec=await dbRead('projects',id);if(!rec)throw Error('Projeto não encontrado.');
 const keys=new Set([...(rec.clips||[]),...(rec.audio||[])].map(c=>c.mediaKey));const mediaMap=new Map();
 for(const key of keys){const item=await dbRead('media',id+':'+key);if(!item?.blob)throw Error('Arquivo de mídia ausente: '+key+'. Restaure um backup do projeto.');const blob=item.blob;const url=URL.createObjectURL(blob);mediaMap.set(key,{file:blob,url});}
 resetProject(false);projectLoading=true;
 projectId=rec.id;projectName=rec.name;projectCreatedAt=rec.createdAt;projectArmed=true;audioTrackMuted=!!rec.audioMuted;muteVideoTrack=!!rec.videoMuted;savedMediaKeys=new Set(keys);
 for(const [key,m] of mediaMap){if((rec.clips||[]).some(c=>c.mediaKey===key))sourceUrls.set(key,m.url);else audioUrls.set(key,m.url)}
 clips=(rec.clips||[]).map(c=>({...c,...mediaMap.get(c.mediaKey)}));audioItems=(rec.audio||[]).map(c=>normalizeAudio({...c,...mediaMap.get(c.mediaKey)}));captionItems=(rec.captions||[]).map(c=>({...c,style:{...c.style}}));
 selectedClipId=clips.some(c=>c.id===rec.selection)?rec.selection:clips[0]?.id||'';activeTrack=rec.activeTrack||'video';selectedAudioId=rec.selectedAudioId||'';selectedCaptionId=rec.selectedCaptionId||'';timelineZoom=rec.zoom||1;$('tm409ZoomValue').textContent=Math.round(timelineZoom*100)+'%';$('tm407Transition').value=rec.transition||'none';lastTransition=$('tm407Transition').value;
 for(const [key,val] of Object.entries(rec.settings||{})){const el=$(key);if(!el)continue;if(el.type==='checkbox')el.checked=!!val;else el.value=val}
 makeCanvas();renderClips();renderOverlayTracks();updateVideoMuteButtons();updateActiveUI();updateProjectHeading();historyUndo=[];historyRedo=[];updateHistoryButtons();
 try{if(clips.length){const c=selectedClip();await selectClip(c.id,c.start+Math.min(clipDuration(c)-.05,Math.max(0,(rec.position||0))))}else draw();syncCaptionControls();syncAudioControls()}finally{projectLoading=false}
 projectStatus('✓ Projeto restaurado · salvamento automático ativo','saved');info('✓ Projeto "'+rec.name+'" restaurado, com arquivos e trechos.');
}
async function initProjectUI(){
 try{await dbOpen();projectStatus('✓ Projetos locais disponíveis','saved');}catch(e){projectStatus('⚠ Armazenamento automático indisponível','error');return}
 $('tm410SaveAs').onclick=async()=>{
  const name=prompt('Nome do projeto:',projectName||$('videoTitle').value||'Minha videoaula');if(!name?.trim())return;
  try{if(projectArmed)await flushSave();const oldId=projectId;projectId=makeId();projectCreatedAt=new Date().toISOString();projectName=name.trim().slice(0,120);projectArmed=true;savedMediaKeys=new Set();updateProjectHeading();await flushSave();info(oldId?'✓ Cópia do projeto salva com o novo nome.':'✓ Projeto salvo.');}catch(e){projectStatus('⚠ '+e.message,'error')}
 };
 $('tm410Projects').onclick=async()=>{try{await listProjectUI();$('tm410ProjectDialogStatus').textContent='';$('tm410ProjectDialog').showModal()}catch(e){projectStatus('⚠ '+e.message,'error')}};
 $('tm410ExportProject').onclick=()=>exportProjectBackup().catch(e=>{$('tm410ProjectDialogStatus').textContent='⚠ '+e.message});
 $('tm410ImportProject').onchange=async e=>{const f=e.target.files?.[0];e.target.value='';if(!f)return;try{await importProjectBackup(f);await listProjectUI()}catch(err){$('tm410ProjectDialogStatus').textContent='⚠ '+err.message}};
}
async function exportProjectBackup(){
 if(!projectArmed)throw Error('Crie e salve um projeto primeiro.');await flushSave();const rec=await dbRead('projects',projectId);if(!rec)throw Error('Projeto ainda não está salvo.');const ids=new Set([...(rec.clips||[]),...(rec.audio||[])].map(x=>x.mediaKey));const files=[];let backupBytes=0;
 for(const id of ids){const m=await dbRead('media',projectId+':'+id);if(!m?.blob)throw Error('Faltando arquivo '+id);backupBytes+=m.blob.size;if(backupBytes>90*1024*1024)throw Error('Backup acima de 90 MB: reduza os vídeos ou guarde também seus arquivos originais.');const b64=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(r.error);r.readAsDataURL(m.blob)});files.push({mediaKey:id,name:m.name,mime:m.mime,data:b64})}
 const blob=new Blob([JSON.stringify({format:'teacher-marks-v409',record:rec,files})],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=(rec.name||'projeto').replace(/[^\w\-.áàâãéêíóôõúç ]/gi,'').replace(/\s+/g,'_')+'.tmvideo';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),12000);$('tm410ProjectDialogStatus').textContent='✓ Backup exportado com os arquivos do projeto. Guarde-o em local seguro.';
}
async function openRestoredProjectWithoutDB(rec,media){
 // Usable even when IndexedDB is full; the backup file remains the durable copy.
 const maps=new Map();for(const m of media){const url=URL.createObjectURL(m.blob);maps.set(m.mediaKey,{file:m.blob,url});}
 resetProject(false);projectLoading=true;
 try{
  projectId=rec.id;projectName=rec.name;projectCreatedAt=rec.createdAt;projectArmed=true;savedMediaKeys=new Set();
  audioTrackMuted=!!rec.audioMuted;muteVideoTrack=!!rec.videoMuted;
  for(const [key,m] of maps){if((rec.clips||[]).some(c=>c.mediaKey===key))sourceUrls.set(key,m.url);else audioUrls.set(key,m.url)}
  clips=(rec.clips||[]).map(c=>({...c,...maps.get(c.mediaKey)}));
  audioItems=(rec.audio||[]).map(c=>normalizeAudio({...c,...maps.get(c.mediaKey)}));
  captionItems=(rec.captions||[]).map(c=>({...c,style:{...c.style}}));
  selectedClipId=rec.selection||clips[0]?.id||'';activeTrack=rec.activeTrack||'video';
  selectedAudioId=rec.selectedAudioId||'';selectedCaptionId=rec.selectedCaptionId||'';
  timelineZoom=rec.zoom||1;$('tm409ZoomValue').textContent=Math.round(timelineZoom*100)+'%';
  $('tm407Transition').value=rec.transition||'none';lastTransition=$('tm407Transition').value;
  for(const [key,val] of Object.entries(rec.settings||{})){const el=$(key);if(!el)continue;if(el.type==='checkbox')el.checked=!!val;else el.value=val}
  makeCanvas();renderClips();renderOverlayTracks();updateProjectHeading();updateHistoryButtons();
  if(clips.length){const c=clips.find(c=>c.id===selectedClipId)||clips[0];await selectClip(c.id,c.start)}else draw();
  syncCaptionControls();syncAudioControls();
 }finally{projectLoading=false}
 projectStatus('⚠ Projeto aberto do arquivo; salve novamente como .tmvideo antes de fechar. O salvamento automático local depende de espaço disponível.','pending');
 info('✓ Projeto restaurado diretamente do arquivo. Edite e use “Salvar arquivo .tmvideo” para preservar as alterações.');
}
async function importProjectBackup(file){
 let obj,media=[],rec;
 const lead=await file.slice(0,24).text();
 if(lead.startsWith('TMVIDEO414\n')){
  const length=parseInt(lead.slice(11,23),16);
  if(!Number.isSafeInteger(length)||length<1||length>10*1024*1024||lead[23]!=='\n')throw Error('Cabeçalho .tmvideo inválido.');
  obj=JSON.parse(await file.slice(24,24+length).text());
  if(obj.format!=='teacher-marks-v414-portable'||!obj.record||!Array.isArray(obj.files))throw Error('Projeto .tmvideo incompatível.');
  let offset=24+length;
  const newId=makeId();rec={...obj.record,id:newId,name:(obj.record.name||'Projeto')+' (restaurado)',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  for(const m of obj.files){const bytes=Number(m.size);if(!Number.isSafeInteger(bytes)||bytes<0||offset+bytes>file.size)throw Error('Arquivo de mídia incompleto: '+m.name);
    media.push({key:newId+':'+m.mediaKey,mediaKey:m.mediaKey,name:m.name,mime:m.mime,blob:file.slice(offset,offset+bytes,m.mime||'application/octet-stream')});offset+=bytes;}
 }else{
  obj=JSON.parse(await file.text());if(obj.format!=='teacher-marks-v409'||!obj.record||!Array.isArray(obj.files))throw Error('Backup não reconhecido.');
  const newId=makeId();rec={...obj.record,id:newId,name:(obj.record.name||'Projeto')+' (restaurado)',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  for(const m of obj.files){const bytes=atob(m.data||'');const arr=new Uint8Array(bytes.length);for(let i=0;i<arr.length;i++)arr[i]=bytes.charCodeAt(i);media.push({key:newId+':'+m.mediaKey,mediaKey:m.mediaKey,name:m.name,mime:m.mime,blob:new Blob([arr],{type:m.mime||'application/octet-stream'})})}
 }
 try{
  await dbCommit(['projects','media'],tx=>{media.forEach(m=>tx.objectStore('media').put(m));tx.objectStore('projects').put(rec)});
  $('tm410ProjectDialogStatus').textContent='✓ Projeto e mídias importados. Clique em Retomar para abrir.';
 }catch(e){
  $('tm410ProjectDialog').close();
  await openRestoredProjectWithoutDB(rec,media);
  projectStatus('⚠ Armazenamento local indisponível: projeto aberto apenas na sessão. Salve .tmvideo antes de fechar.','error');
 }
}


function updateVideoMuteButtons(){
 const c=selectedClip(),muted=!c||c.volume===0;
 $('tm411MuteVideo').textContent=muted?'🔇 Reativar som do trecho':'🔊 Silenciar trecho';
 $('tm411MuteVideo').disabled=!c;
 $('tm411MuteAllVideo').textContent=muteVideoTrack?'🎬 Som dos vídeos: mudo':'🎬 Som dos vídeos: ativo';
}
$('tm411MuteVideo').onclick=()=>{const item=activeItem();if(!item)return;pushHistory();
 if(activeTrack==='audio'){item.muted=!item.muted;const p=extraPlayers.get(item.id);if(p){const gain=audioEffectiveVolume(item);if(p.gain)p.gain.gain.value=gain;else p.el.volume=Math.min(1,gain);}syncAudioControls();updateExtraAudio(false);}
 else if(activeTrack==='caption'){item.hidden=!item.hidden;draw();}
 else{const c=item;if(c.volume>0){c.lastVolume=c.volume;c.volume=0}else c.volume=c.lastVolume||1;
 $('tm407Volume').value=Math.round(c.volume*100);$('tm407VolumeText').textContent=Math.round(c.volume*100)+'%';
 if(sharedGain)sharedGain.gain.value=muteVideoTrack?0:c.volume;else v.volume=muteVideoTrack?0:Math.min(1,c.volume);}
 afterTimelineEdit();};
$('tm411MuteAllVideo').onclick=()=>{pushHistory();muteVideoTrack=!muteVideoTrack;if(sharedGain)sharedGain.gain.value=muteVideoTrack?0:(selectedClip()?.volume||0);else v.volume=muteVideoTrack?0:Math.min(1,selectedClip()?.volume||0);invalidateExport();updateVideoMuteButtons();scheduleProjectSave()};
function disposeExtraPlayers(){for(const p of extraPlayers.values()){p.el.pause();p.el.removeAttribute('src');p.el.load();p.el.remove();try{p.source?.disconnect()}catch{}try{p.gain?.disconnect()}catch{}}extraPlayers.clear();}
function clearUnusedExtraPlayers(){const ids=new Set(audioItems.map(a=>a.id));for(const [id,p] of extraPlayers)if(!ids.has(id)){p.el.pause();p.el.remove();try{p.source?.disconnect()}catch{}try{p.gain?.disconnect()}catch{}extraPlayers.delete(id)}}
function ensureAudioMix(){clearUnusedExtraPlayers();for(const a of audioItems){if(extraPlayers.has(a.id))continue;
 const el=document.createElement('audio');el.preload='auto';el.src=a.url;el.style.display='none';document.body.append(el);
 const p={el,source:null,gain:null};extraPlayers.set(a.id,p)}
 if(sharedAudioCtx&&sharedAudioDest){for(const p of extraPlayers.values()){if(!p.source){p.source=sharedAudioCtx.createMediaElementSource(p.el);p.gain=sharedAudioCtx.createGain();p.source.connect(p.gain);p.gain.connect(sharedAudioDest);p.gain.connect(sharedAudioCtx.destination)}}}
}
function pauseExtraAudio(){for(const p of extraPlayers.values())p.el.pause()}
function audioEffectiveVolume(a){if(audioTrackMuted||a.muted)return 0;const elapsed=frameGlobalTime-a.startAt,duration=audioLength(a);let factor=1;
 if(a.fadeIn>0)factor=Math.min(factor,Math.max(0,elapsed/a.fadeIn));
 if(a.fadeOut>0)factor=Math.min(factor,Math.max(0,(duration-elapsed)/a.fadeOut));
 return Math.min(2,Math.max(0,Number(a.volume??1)))*factor}
function timelinePixels(){return 8*timelineZoom}
// A click in any track navigates to the clicked second, not merely to the beginning of its item.
function timeFromTrackClick(event,block,item,type){
 const r=block.getBoundingClientRect();
 const length=type==='audio'?audioLength(item):Math.max(.01,item.endAt-item.startAt);
 const portion=Math.max(0,Math.min(.995,(event.clientX-r.left)/Math.max(1,r.width)));
 return Math.max(0,item.startAt+portion*length);
}
function seekWithTrackSelection(time){
 if(!clips.length)return;
 const target=Math.max(0,Math.min(totalDuration()-.02,time));
 frameGlobalTime=target;
 seekDesired=target;
 $('seek').value=String(target);
 // Never call chooseTrack('video') here: the active audio/caption must remain the only selection.
 seekTimeline(target).catch(err=>info('⚠ Não foi possível posicionar o cursor: '+err.message));
}

function createTrackBlock(parent,item,type,top,px){const b=document.createElement('div');b.className='tm410-track-pill tm411-editable-block';b.tabIndex=0;b.setAttribute('role','button');b.dataset.trackType=type;b.dataset.itemId=item.id;
 b.setAttribute('aria-pressed',String(type===activeTrack&&(type==='audio'?item.id===selectedAudioId:item.id===selectedCaptionId)));
 const beginning=type==='audio'?item.startAt:item.startAt,length=type==='audio'?audioLength(item):item.endAt-item.startAt;
 b.style.left=Math.round(beginning*px)+'px';b.style.top=top+'px';b.style.width=Math.max(25,Math.round(length*px))+'px';
 const content=document.createElement('span');content.className='tm411-block-label';content.textContent=type==='audio'?'♫ '+item.name:'✎ '+String(item.text||'Legenda').slice(0,54);b.append(content);
 for(const [edge,title] of [['left','Ajustar início'],['right','Ajustar fim']]){const h=document.createElement('span');h.className='tm411-resize tm411-resize-'+edge;h.dataset.edge=edge;h.title=title;h.setAttribute('aria-label',title);b.append(h)}
 b.onclick=e=>{
  if(b.dataset.dragged==='yes'){b.dataset.dragged='';return}
  const target=timeFromTrackClick(e,b,item,type);
  chooseTrack(type,item.id);
  if(type==='caption'){captionEditPreview=true;syncCaptionControls();}else syncAudioControls();
  refreshSingleSelection();
  seekWithTrackSelection(target);
 };
 b.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();b.click()}};
 if(type==='caption')b.ondblclick=e=>{
  e.preventDefault();chooseTrack(type,item.id);captionEditPreview=true;syncCaptionControls();
  seekWithTrackSelection(timeFromTrackClick(e,b,item,type));openCaptionFloating();refreshSingleSelection();
 };
 b.onpointerdown=e=>{if(rendering||e.button!==0)return;e.stopPropagation();chooseTrack(type,item.id);if(type==='caption')syncCaptionControls();else syncAudioControls();refreshSingleSelection();updateActiveUI();
 const startX=e.clientX,mode=e.target?.dataset?.edge||'move',startAt=item.startAt,
       originStart=type==='audio'?Number(item.sourceStart||0):item.startAt,
       originEnd=type==='audio'?Number(item.sourceEnd):item.endAt;
 let changed=false;try{b.setPointerCapture(e.pointerId)}catch{}
 b.onpointermove=move=>{const delta=move.clientX-startX;if(Math.abs(delta)<3&&!changed)return;if(!changed){pushHistory();changed=true}
 const seconds=delta/px;
 if(type==='audio'){
  if(mode==='move')item.startAt=Math.max(0,startAt+seconds);
  else if(mode==='left'){const shift=Math.max(-startAt,-originStart,Math.min(seconds,originEnd-originStart-.1));item.startAt=startAt+shift;item.sourceStart=originStart+shift}
  else if(mode==='right'){item.sourceEnd=Math.max(originStart+.1,Math.min(item.fileDuration||originEnd,originEnd+seconds))}
  normalizeAudio(item);
 }else{
  if(mode==='move'){const dur=originEnd-originStart;item.startAt=Math.max(0,startAt+seconds);item.endAt=item.startAt+dur}
  else if(mode==='left')item.startAt=Math.max(0,Math.min(originEnd-.1,startAt+seconds));
  else if(mode==='right')item.endAt=Math.max(originStart+.1,originEnd+seconds);
 }
 b.style.left=Math.round(item.startAt*px)+'px';b.style.width=Math.max(25,Math.round((type==='audio'?audioLength(item):item.endAt-item.startAt)*px))+'px';b.classList.add('dragging');
 if(type==='caption')syncCaptionControls();else syncAudioControls();draw();};
 b.onpointerup=()=>{b.onpointermove=null;b.onpointerup=null;b.classList.remove('dragging');if(changed){b.dataset.dragged='yes';afterTimelineEdit()}};
 b.onpointercancel=b.onpointerup;
 };
 parent.append(b);return b}
function installTrackHoverGuide(lane){
 const guide=document.createElement('span');guide.className='tm414-hover-guide';guide.setAttribute('aria-hidden','true');lane.append(guide);
 lane.addEventListener('pointermove',e=>{
   if(e.pointerType==='touch'||e.buttons!==0){guide.style.display='none';return}
   guide.style.left=Math.max(0,Math.min(lane.clientWidth,e.clientX-lane.getBoundingClientRect().left))+'px';guide.style.display='block';
 });
 lane.addEventListener('pointerleave',()=>guide.style.display='none');
}
function renderOverlayTracks(){clearUnusedExtraPlayers();const px=timelinePixels();
 const ar=$('tm410AudioTrack');ar.replaceChildren();const alane=document.createElement('div');alane.className='tm411-track-lane';
 const audios=[...audioItems].sort((a,b)=>a.startAt-b.startAt),audioEnds=[];
 for(const a of audios){normalizeAudio(a);let row=audioEnds.findIndex(t=>t<=a.startAt*px-4);if(row<0)row=audioEnds.length;audioEnds[row]=a.startAt*px+Math.max(25,audioLength(a)*px)+5;createTrackBlock(alane,a,'audio',4+row*35,px)}
 alane.style.height=Math.max(42,audioEnds.length*35+8)+'px';alane.style.width=Math.max(ar.clientWidth-14,...audioItems.map(a=>(a.startAt+audioLength(a))*px+75),150)+'px';installTrackHoverGuide(alane);ar.append(alane);
 alane.addEventListener('click',e=>{
  if(e.target.closest('[data-item-id]'))return;
  // Clicks outside any audio fragment only move the cursor; no hidden item is selected.
  const rect=alane.getBoundingClientRect();
  seekWithTrackSelection((e.clientX-rect.left)/px);
 });
 const cr=$('tm410CaptionTrack');cr.replaceChildren();const clane=document.createElement('div');clane.className='tm411-track-lane';
 const captions=[...captionItems].sort((a,b)=>a.startAt-b.startAt),captionEnds=[];
 for(const c of captions){let row=captionEnds.findIndex(t=>t<=c.startAt*px-4);if(row<0)row=captionEnds.length;captionEnds[row]=c.startAt*px+Math.max(25,(c.endAt-c.startAt)*px)+5;createTrackBlock(clane,c,'caption',4+row*35,px)}
 clane.style.height=Math.max(42,captionEnds.length*35+8)+'px';clane.style.width=Math.max(cr.clientWidth-14,...captionItems.map(c=>c.endAt*px+75),150)+'px';installTrackHoverGuide(clane);cr.append(clane);
 clane.addEventListener('click',e=>{
  if(e.target.closest('[data-item-id]'))return;
  const rect=clane.getBoundingClientRect();
  seekWithTrackSelection((e.clientX-rect.left)/px);
 });
 $('tm410ToggleAudio').textContent=audioTrackMuted?'🔇 Áudio mudo':'🔊 Áudio ativo';updateActiveUI();
}
async function addAudioFiles(list){
 if(!list?.length)return;pushHistory();for(const f of Array.from(list)){if(!f.type.startsWith('audio/'))continue;const key=makeId(),url=URL.createObjectURL(f),probe=document.createElement('audio');probe.preload='metadata';probe.src=url;let duration=await new Promise((resolve,reject)=>{probe.onloadedmetadata=()=>resolve(probe.duration);probe.onerror=()=>reject(Error('Áudio não pôde ser carregado: '+f.name));setTimeout(()=>reject(Error('Tempo de leitura de áudio excedido')),12000)});if(!Number.isFinite(duration)||duration<=0)throw Error('Duração de áudio inválida.');const item=normalizeAudio({id:makeId(),mediaKey:key,name:f.name,url,file:f,startAt:Math.max(0,frameGlobalTime),sourceStart:0,sourceEnd:duration,fileDuration:duration,duration,fadeIn:0,fadeOut:0,volume:1,muted:false});audioItems.push(item);audioUrls.set(key,url);chooseTrack('audio',item.id)}
 if(!projectArmed){newProjectId('Nova videoaula');}
 invalidateExport();renderOverlayTracks();syncAudioControls();scheduleProjectSave();info('Áudio adicionado à faixa complementar.');
}
$('tm410AudioFiles').onchange=e=>{addAudioFiles(e.target.files).catch(err=>info('⚠ '+err.message));e.target.value=''};
$('tm410ToggleAudio').onclick=()=>{pushHistory();audioTrackMuted=!audioTrackMuted;renderOverlayTracks();updateExtraAudio(true);invalidateExport();scheduleProjectSave()};
function syncAudioControls(){const a=audioItems.find(c=>c.id===selectedAudioId);if(!a)return;normalizeAudio(a);
 $('tm410AudioStart').value=a.startAt.toFixed(2);$('tm410AudioVolume').value=Math.round(a.volume*100);$('tm410AudioMute').checked=!!a.muted;
 $('tm411FadeIn').value=a.fadeIn.toFixed(2);$('tm411FadeOut').value=a.fadeOut.toFixed(2);
 $('tm411AudioRange').textContent='Trecho do arquivo: '+a.sourceStart.toFixed(2)+'s a '+a.sourceEnd.toFixed(2)+'s · '+audioLength(a).toFixed(2)+'s';}
function editAudio(field,value){const a=audioItems.find(c=>c.id===selectedAudioId);if(!a)return;pushHistory();a[field]=value;normalizeAudio(a);afterTimelineEdit()}
// Apply every audio change immediately. Slider changes do NOT reseek the track on every pixel.
let liveAudioGesture=false;
function changeSelectedAudioLive(field,value,commit=false){
 const a=audioItems.find(c=>c.id===selectedAudioId);if(!a)return;
 if(!liveAudioGesture){pushHistory();liveAudioGesture=true}
 a[field]=value;
 if(field==='fadeIn'||field==='fadeOut')a[field]=Math.min(audioLength(a),safeTime(value));
 if(field==='startAt')a[field]=safeTime(value);
 normalizeAudio(a);
 // Changes to gain and mute must affect the existing audio element immediately, without restarting playback.
 if(field==='volume'||field==='muted'||field==='fadeIn'||field==='fadeOut'){
  const p=extraPlayers.get(a.id),level=audioEffectiveVolume(a);
  if(p){if(p.gain)p.gain.gain.value=level;else p.el.volume=Math.min(1,level);}
 }
 if(field==='startAt')afterTimelineEdit();
 else{invalidateExport();scheduleProjectSave();updateActiveUI();}
 if(commit)liveAudioGesture=false;
}
$('tm410AudioStart').oninput=e=>changeSelectedAudioLive('startAt',Number(e.target.value));
$('tm410AudioVolume').oninput=e=>changeSelectedAudioLive('volume',Number(e.target.value)/100);
$('tm410AudioMute').onchange=e=>changeSelectedAudioLive('muted',e.target.checked,true);
$('tm411FadeIn').oninput=e=>changeSelectedAudioLive('fadeIn',Number(e.target.value));
$('tm411FadeOut').oninput=e=>changeSelectedAudioLive('fadeOut',Number(e.target.value));
for(const id of ['tm410AudioStart','tm410AudioVolume','tm411FadeIn','tm411FadeOut']){
 $(id).addEventListener('change',()=>{liveAudioGesture=false;invalidateExport();scheduleProjectSave()});
 $(id).addEventListener('pointerup',()=>{liveAudioGesture=false;scheduleProjectSave()});
}

function deleteSelectedAudio(){const i=audioItems.findIndex(c=>c.id===selectedAudioId);if(i<0)return;pushHistory();audioItems.splice(i,1);selectedAudioId='';chooseTrack('video',selectedClipId);pauseExtraAudio();afterTimelineEdit()}
$('tm410DeleteAudio').onclick=deleteSelectedAudio;
function updateExtraAudio(force=false){ensureAudioMix();const shouldPlay=!v.paused;
 for(const a of audioItems){normalizeAudio(a);const p=extraPlayers.get(a.id);if(!p)continue;
 const elapsed=frameGlobalTime-a.startAt,active=elapsed>=0&&elapsed<a.duration&&frameGlobalTime<=totalDuration();
 if(!active||audioTrackMuted||a.muted||!shouldPlay){if(!p.el.paused)p.el.pause();if(p.gain)p.gain.gain.value=0;continue}
 const target=a.sourceStart+elapsed;if(force||Math.abs(p.el.currentTime-target)>.3){try{p.el.currentTime=Math.max(0,target)}catch{}}
 const vol=audioEffectiveVolume(a);if(p.gain){p.gain.gain.value=vol}else p.el.volume=Math.min(1,vol);
 if(p.el.paused)p.el.play().catch(()=>{});
 }
}
function newCaptionStyle(){return {font:'Arial',size:36,color:'#ffffff',bg:'#0a2532',bold:true,italic:false,underline:false,align:'center',lineHeight:1.3,x:50,y:87}}
function createCaption({text='Nova legenda',style=null,startAt=frameGlobalTime,endAt=null}={}){
 if(!projectArmed)newProjectId('Nova videoaula');pushHistory();const from=Math.max(0,startAt);
 const cue={id:makeId(),startAt:from,endAt:endAt??from+3,text,style:{...newCaptionStyle(),...(style||{})}};
 captionItems.push(cue);chooseTrack('caption',cue.id);captionEditPreview=true;invalidateExport();renderOverlayTracks();syncCaptionControls();draw();scheduleProjectSave();return cue;
}
$('tm410AddCaption').onclick=()=>{createCaption();openCaptionFloating()};
const captionFields={tm410CaptionText:'text',tm410CaptionFrom:'startAt',tm410CaptionTo:'endAt',tm410Font:'font',tm410FontSize:'size',tm410TextColor:'color',tm410BgColor:'bg',tm410Bold:'bold',tm410Italic:'italic',tm410Underline:'underline',tm410Align:'align',tm410LineHeight:'lineHeight'};
function syncCaptionControls(){const c=captionItems.find(c=>c.id===selectedCaptionId);if(!c)return;for(const [id,key] of Object.entries(captionFields)){const el=$(id);const value=key==='text'?c.text:(key==='startAt'?c.startAt:key==='endAt'?c.endAt:c.style[key]);if(el.type==='checkbox')el.checked=!!value;else el.value=value??''}}
for(const [id,key] of Object.entries(captionFields)){
 const el=$(id);let focused=false;
 el.addEventListener('focus',()=>{if(selectedCaptionId){pushHistory();focused=true}});
 const update=()=>{const c=captionItems.find(c=>c.id===selectedCaptionId);if(!c)return;
  if(!focused){pushHistory();focused=true}
  let value=el.type==='checkbox'?el.checked:el.value;
  if(['startAt','endAt','size','lineHeight'].includes(key))value=Number(value);
  if(key==='startAt')value=Math.max(0,Math.min(value,c.endAt-.1));
  if(key==='endAt')value=Math.max(c.startAt+.1,value);
  if(['text','startAt','endAt'].includes(key))c[key]=value;else c.style[key]=value;
  captionEditPreview=true;invalidateExport();renderOverlayTracks();draw();scheduleProjectSave();
 };
 el.addEventListener('input',update);el.addEventListener('change',update);el.addEventListener('blur',()=>focused=false);
}

// A mesma janela contém os controles originais; o editor só muda de lugar na tela.
function setupFloatingEditor(){
 captionFloating=document.querySelector('.tm410-caption-editor');if(!captionFloating)return;
 captionFloating.classList.add('tm411-floating');captionFloating.id='tm411Floating';captionFloating.hidden=true;
 const grip=document.createElement('div');grip.className='tm411-float-grip';grip.innerHTML='<span>✎ Formatar legenda · arraste esta barra</span>';
 const close=document.createElement('button');close.type='button';close.className='btn';close.textContent='✕ Fechar';close.onclick=()=>{captionFloating.hidden=true;captionEditPreview=false;draw()};
 grip.append(close);captionFloating.prepend(grip);document.querySelector('.studio').append(captionFloating);
 let active=null;
 grip.addEventListener('pointerdown',e=>{if(e.target.closest('button'))return;active={x:e.clientX,y:e.clientY,left:captionFloating.getBoundingClientRect().left,top:captionFloating.getBoundingClientRect().top};grip.setPointerCapture(e.pointerId)});
 grip.addEventListener('pointermove',e=>{if(!active)return;captionFloating.style.left=Math.max(2,Math.min(window.innerWidth-captionFloating.offsetWidth,active.left+e.clientX-active.x))+'px';captionFloating.style.top=Math.max(2,Math.min(window.innerHeight-50,active.top+e.clientY-active.y))+'px'});
 const stop=()=>active=null;grip.addEventListener('pointerup',stop);grip.addEventListener('pointercancel',stop);
}
function openCaptionFloating(){if(!captionFloating)setupFloatingEditor();if(!selectedCaptionId)return;captionFloating.hidden=false;captionEditPreview=true;syncCaptionControls();draw()}
setupFloatingEditor();
// A legenda selecionada pode ser arrastada sobre a própria imagem do vídeo.
canvas.classList.add('tm411-preview-drag');
let captionCanvasDrag=null;
canvas.addEventListener('pointerdown',e=>{if(!selectedCaptionId||rendering||e.button!==0)return;const c=captionItems.find(x=>x.id===selectedCaptionId);if(!c)return;pushHistory();captionEditPreview=true;captionCanvasDrag={id:c.id,pointerId:e.pointerId};canvas.setPointerCapture(e.pointerId);
 const r=canvas.getBoundingClientRect();c.style.x=Math.max(8,Math.min(92,(e.clientX-r.left)/r.width*100));c.style.y=Math.max(8,Math.min(92,(e.clientY-r.top)/r.height*100));draw();});
canvas.addEventListener('pointermove',e=>{if(!captionCanvasDrag)return;const c=captionItems.find(x=>x.id===captionCanvasDrag.id);if(!c)return;const r=canvas.getBoundingClientRect();c.style.x=Math.max(8,Math.min(92,(e.clientX-r.left)/r.width*100));c.style.y=Math.max(8,Math.min(92,(e.clientY-r.top)/r.height*100));invalidateExport();draw()});
const doneDrag=()=>{if(!captionCanvasDrag)return;captionCanvasDrag=null;scheduleProjectSave()};canvas.addEventListener('pointerup',doneDrag);canvas.addEventListener('pointercancel',doneDrag);

const captionPresets=[
 {title:'Clássica',text:'Aprenda inglês com Teacher Marks',style:{font:'Georgia',size:38,bold:true,color:'#ffffff',bg:'#122d42',x:50,y:86}},
 {title:'Minimalista',text:'Uma frase importante',style:{font:'Arial',size:31,bold:false,color:'#ffffff',bg:'#143b42',x:50,y:89}},
 {title:'Destaque',text:'PRESTE ATENÇÃO!',style:{font:'Trebuchet MS',size:46,bold:true,color:'#ffea85',bg:'#143c51',x:50,y:47}},
 {title:'Pergunta',text:'What is the correct answer?',style:{font:'Verdana',size:35,bold:true,color:'#ffffff',bg:'#1b5261',x:50,y:76}},
 {title:'Título central',text:'SIMPLE PRESENT',style:{font:'Georgia',size:52,bold:true,color:'#ffffff',bg:'#0e6d70',x:50,y:50}},
 {title:'Tradução',text:'Tradução da frase em português',style:{font:'Tahoma',size:29,italic:true,color:'#fff4b5',bg:'#163b54',x:50,y:91}},
 {title:'Aviso',text:'Dica do professor',style:{font:'Arial',size:36,bold:true,color:'#ffffff',bg:'#ae4434',x:50,y:22}},
 {title:'Neon',text:"Let's practice!",style:{font:'Verdana',size:40,bold:true,color:'#a4fff0',bg:'#162b40',x:50,y:84}},
 {title:'Legenda cinema',text:'Uma legenda elegante',style:{font:'Georgia',size:34,bold:true,italic:false,color:'#ffffff',bg:'#141414',x:50,y:88}},
 {title:'Subtítulo limpo',text:'Concentre-se na pronúncia',style:{font:'Arial',size:31,bold:false,italic:false,color:'#ffffff',bg:'#121f2d',x:50,y:91}},
 {title:'Notícia',text:'ENGLISH NEWS',style:{font:'Tahoma',size:42,bold:true,italic:false,color:'#ffffff',bg:'#b51931',x:50,y:16}},
 {title:'Vlog',text:'Vamos praticar juntos!',style:{font:'Trebuchet MS',size:39,bold:true,italic:false,color:'#ffffff',bg:'#ff6d35',x:50,y:80}},
 {title:'Aula premium',text:'TEACHER MARKS',style:{font:'Georgia',size:50,bold:true,italic:false,color:'#fff7e6',bg:'#34245c',x:50,y:42}},
 {title:'Correção',text:'✓ Correct answer',style:{font:'Arial',size:41,bold:true,italic:false,color:'#eafff0',bg:'#066747',x:50,y:84}},
 {title:'Atenção',text:'⚠ Remember!',style:{font:'Verdana',size:41,bold:true,italic:false,color:'#1e2431',bg:'#ffd45a',x:50,y:38}},
 {title:'Traduzindo',text:'I am learning English.',style:{font:'Arial',size:35,bold:false,italic:false,color:'#ffffff',bg:'#007b98',x:50,y:88}},
 {title:'Minimal preto',text:'Simple Present',style:{font:'Arial',size:40,bold:true,italic:false,color:'#111111',bg:'#ffffff',x:50,y:50}},
 {title:'Dourado',text:'MASTER YOUR ENGLISH',style:{font:'Georgia',size:41,bold:true,italic:false,color:'#ffe3a2',bg:'#293039',x:50,y:32}},
 {title:'Professor',text:'Uma dica importante',style:{font:'Trebuchet MS',size:41,bold:true,italic:false,color:'#ffffff',bg:'#056d76',x:50,y:78}},
 {title:'Lição numerada',text:'LESSON 01',style:{font:'Verdana',size:46,bold:true,italic:false,color:'#ffffff',bg:'#224c79',x:50,y:19}},
 {title:'Vocabulary',text:'VOCABULARY',style:{font:'Tahoma',size:45,bold:true,italic:false,color:'#fff7e0',bg:'#47688c',x:50,y:35}},
 {title:'Frase do dia',text:'A new word every day',style:{font:'Georgia',size:37,bold:false,italic:true,color:'#f2fbff',bg:'#365c87',x:50,y:83}},
 {title:'Foco',text:'FOCUS!',style:{font:'Arial',size:58,bold:true,italic:false,color:'#ffffff',bg:'#ca285d',x:50,y:48}},
 {title:'Clean blue',text:'Listen carefully',style:{font:'Arial',size:34,bold:false,italic:false,color:'#e9faff',bg:'#004a75',x:50,y:87}},
 {title:'Exercício',text:'CHOOSE THE BEST ANSWER',style:{font:'Verdana',size:35,bold:true,italic:false,color:'#ffffff',bg:'#8841af',x:50,y:80}},
 {title:'Pergunta verde',text:'What do you think?',style:{font:'Trebuchet MS',size:37,bold:true,italic:false,color:'#ffffff',bg:'#268262',x:50,y:80}},
 {title:'Inglês básico',text:'Hello, students!',style:{font:'Arial',size:45,bold:true,italic:false,color:'#0e2434',bg:'#f7eecc',x:50,y:47}},
 {title:'English tip',text:'ENGLISH TIP',style:{font:'Verdana',size:42,bold:true,italic:false,color:'#f4ffff',bg:'#0177a4',x:50,y:23}},
 {title:'Comentário',text:'Vamos analisar a frase.',style:{font:'Georgia',size:35,bold:false,italic:true,color:'#ffffff',bg:'#625c63',x:50,y:88}},
 {title:'Curso dark',text:'ENGLISH LEARNING CENTER',style:{font:'Tahoma',size:42,bold:true,italic:false,color:'#e9eeff',bg:'#162b40',x:50,y:48}},
 {title:'Dica rosa',text:'DID YOU KNOW?',style:{font:'Arial',size:41,bold:true,italic:false,color:'#ffffff',bg:'#c53e82',x:50,y:76}},
 {title:'Aviso laranja',text:'IMPORTANT!',style:{font:'Trebuchet MS',size:44,bold:true,italic:false,color:'#ffffff',bg:'#ae551c',x:50,y:38}},
 {title:'Conclusão',text:'GREAT JOB!',style:{font:'Verdana',size:54,bold:true,italic:false,color:'#edffeb',bg:'#12734d',x:50,y:52}},
 {title:'Exemplo',text:'For example...',style:{font:'Georgia',size:38,bold:false,italic:true,color:'#f8f8f8',bg:'#5b4d79',x:50,y:88}},
 {title:'Destaque lateral',text:'NEW CONTENT',style:{font:'Arial',size:40,bold:true,italic:false,color:'#fff',bg:'#35506d',x:30,y:36}},
 {title:'Cinema azul',text:'A WORLD OF IDEAS',style:{font:'Georgia',size:40,bold:true,italic:false,color:'#d9f4ff',bg:'#091e48',x:50,y:82}},
 {title:'Nota curta',text:'Note this down!',style:{font:'Trebuchet MS',size:38,bold:true,italic:false,color:'#393634',bg:'#fee694',x:50,y:21}},
 {title:'Fórmula',text:'SUBJECT + VERB',style:{font:'Courier New',size:40,bold:true,italic:false,color:'#98ffa8',bg:'#073329',x:50,y:55}},
 {title:'Pensamento',text:'What if...?',style:{font:'Georgia',size:42,bold:false,italic:true,color:'#e6deff',bg:'#514575',x:50,y:55}},
 {title:'Review',text:'LET’S REVIEW',style:{font:'Tahoma',size:48,bold:true,italic:false,color:'#ffffff',bg:'#9b2441',x:50,y:83}},
];
const presetGrid=$('tm411PresetGrid');captionPresets.forEach((item,i)=>{
 const b=document.createElement('button');b.type='button';b.className='tm411-preset';b.draggable=true;b.style.background=item.style.bg;b.style.color=item.style.color;b.style.fontFamily=item.style.font;b.style.fontWeight=item.style.bold?'bold':'normal';
 b.append(document.createTextNode(item.text));const sm=document.createElement('small');sm.textContent=item.title;b.append(sm);
 b.onclick=()=>{createCaption({text:item.text,style:item.style});$('tm411PresetDialog').close();openCaptionFloating()};
 b.ondragstart=e=>{e.dataTransfer.setData('application/x-tm-caption-preset',String(i));e.dataTransfer.setData('text/plain','Teacher Marks · '+item.title)};
 presetGrid.append(b);
});
$('tm411Presets').onclick=()=>$('tm411PresetDialog').show();$('tm411ClosePresets').onclick=()=>$('tm411PresetDialog').close();
$('tm410CaptionTrack').addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('application/x-tm-caption-preset'))e.preventDefault()});
$('tm410CaptionTrack').addEventListener('drop',e=>{const ix=Number(e.dataTransfer.getData('application/x-tm-caption-preset'));if(!Number.isInteger(ix)||!captionPresets[ix])return;e.preventDefault();const rect=$('tm410CaptionTrack').querySelector('.tm411-caption-lane')?.getBoundingClientRect();
 const x=rect?e.clientX-rect.left:0;const from=Math.max(0,Math.min(totalDuration(),x/(8*timelineZoom)));
 const it=captionPresets[ix];createCaption({text:it.text,style:it.style,startAt:from});$('tm411PresetDialog').close();openCaptionFloating();});

let arrowSeek=Promise.resolve(),arrowPending=null,arrowBusy=false;
async function seekTimeline(time){const duration=totalDuration();if(duration<=0)return;const wanted=Math.max(0,Math.min(duration-.02,time));let position=wanted,c=clips[0];for(const clip of clips){c=clip;if(position<clipDuration(clip))break;position-=clipDuration(clip)}
 previewing=false;await selectClip(c.id,c.start+position);frameGlobalTime=wanted;updateExtraAudio(true);draw();}
async function processArrowQueue(){if(arrowBusy)return;arrowBusy=true;try{while(arrowPending!==null){const target=arrowPending;arrowPending=null;await seekTimeline(target)}}finally{arrowBusy=false}}
function keyboardSeek(delta){seekDesired=Math.max(0,Math.min(totalDuration()-.02,(arrowPending??seekDesired)+delta));arrowPending=seekDesired;processArrowQueue().catch(e=>info('⚠ Não foi possível posicionar o cursor: '+e.message))}
document.addEventListener('keydown',e=>{
 const tag=e.target instanceof Element?e.target.closest('input,textarea,select,[contenteditable]'):null;
 if((e.key==='ArrowLeft'||e.key==='ArrowRight')&&!tag&&!e.altKey&&!e.ctrlKey&&!e.metaKey&&!rendering){e.preventDefault();if(arrowPending===null&&!arrowBusy)seekDesired=frameGlobalTime;keyboardSeek((e.key==='ArrowRight'?1:-1)*(e.shiftKey?1:.25))}
 if(e.key==='Escape'&&captionFloating&&!captionFloating.hidden){captionFloating.hidden=true;captionEditPreview=false;draw()}
});
function deleteSelectedCaption(){const i=captionItems.findIndex(c=>c.id===selectedCaptionId);if(i<0)return;pushHistory();captionItems.splice(i,1);selectedCaptionId='';chooseTrack('video',selectedClipId);afterTimelineEdit()}
$('tm410DeleteCaption').onclick=deleteSelectedCaption;
function wrapCanvasWords(text,width){const words=text.split(/\s+/).filter(Boolean),lines=[];let line='';for(const word of words){const candidate=line?line+' '+word:word;if(ctx.measureText(candidate).width>width&&line){lines.push(line);line=word}else line=candidate}if(line)lines.push(line);return lines.slice(0,5)}
function drawCaptionTrack(W,H){
 let c=(captionEditPreview&&!rendering&&v.paused)?captionItems.find(x=>x.id===selectedCaptionId&&x.text?.trim()):null;
 if(!c)c=captionItems.find(x=>!x.hidden&&frameGlobalTime>=x.startAt&&frameGlobalTime<=x.endAt&&x.text?.trim());
 if(!c||c.hidden)return;
 const style=c.style||newCaptionStyle(),size=Math.max(15,Math.round(Number(style.size||36)*W/1280)),pad=Math.max(10,Math.round(size*.44)),width=Math.round(W*.83);
 ctx.save();ctx.font=(style.italic?'italic ':'')+(style.bold?'bold ':'')+size+'px '+JSON.stringify(style.font||'Arial');
 const lines=String(c.text).split('\n').flatMap(t=>wrapCanvasWords(t,width-2*pad)).slice(0,5);
 const lh=size*Math.max(1,Number(style.lineHeight)||1.3),boxH=lines.length*lh+pad*2;
 const xp=Math.max(8,Math.min(92,Number(style.x??50))),yp=Math.max(8,Math.min(92,Number(style.y??87)));
 const x=Math.min(W-width,Math.max(0,W*xp/100-width/2)),y=Math.min(H-boxH,Math.max(0,H*yp/100-boxH/2));
 ctx.fillStyle=(style.bg||'#0a2532')+'df';ctx.fillRect(x,y,width,boxH);ctx.fillStyle=style.color||'#fff';ctx.textBaseline='middle';
 for(let i=0;i<lines.length;i++){const line=lines[i],top=y+pad+lh*(i+.5);
  if(style.align==='justify'&&i<lines.length-1&&line.includes(' ')){const words=line.split(' '),ws=words.map(x=>ctx.measureText(x).width),gap=(width-pad*2-ws.reduce((a,b)=>a+b,0))/(words.length-1);let cursor=x+pad;words.forEach((w,j)=>{ctx.textAlign='left';ctx.fillText(w,cursor,top);if(style.underline)ctx.fillRect(cursor,top+size*.47,ws[j],Math.max(1,size*.04));cursor+=ws[j]+gap});continue}
  let tx=W/2;ctx.textAlign=style.align==='right'?'right':style.align==='left'?'left':'center';if(style.align==='left')tx=x+pad;if(style.align==='right')tx=x+width-pad;ctx.fillText(line,tx,top,width-pad*2);
  if(style.underline){const ww=Math.min(ctx.measureText(line).width,width-pad*2);let xx=tx;if(ctx.textAlign==='center')xx-=ww/2;if(ctx.textAlign==='right')xx-=ww;ctx.fillRect(xx,top+size*.47,ww,Math.max(1,size*.04))}
 }ctx.restore();
}

function applyExtraTransition(W,H){
 const type=$('tm407Transition').value;if(type==='none'||type==='fade'||clips.length<2)return;
 const current=selectedClip();if(!current||v.readyState<2)return;const idx=clips.indexOf(current),elapsed=Math.max(0,(v.currentTime||0)-current.start),duration=clipDuration(current),span=Math.min(.5,duration*.24);
 let u=0;if(idx>0&&elapsed<span)u=1-elapsed/span;if(idx<clips.length-1&&duration-elapsed<span)u=Math.max(u,1-(duration-elapsed)/span);if(u<=0)return;
 ctx.save();const color=(hex,opacity)=>{ctx.fillStyle=hex;ctx.globalAlpha=opacity;ctx.fillRect(0,0,W,H);ctx.globalAlpha=1};
 if(type==='fadeWhite'||type==='flash'){color('#ffffff',Math.min(1,u*(type==='flash'?1.6:1)))}
 else if(type==='dipBlue'){color('#00324b',u)}
 else if(type==='wipeLeft'){ctx.fillStyle='#06151d';ctx.fillRect(W*(1-u),0,W*u,H)}
 else if(type==='wipeRight'){ctx.fillStyle='#06151d';ctx.fillRect(0,0,W*u,H)}
 else if(type==='slideLeft'){ctx.drawImage(canvas,-W*u,0,W,H);ctx.fillStyle='#06151d';ctx.fillRect(W*(1-u),0,W*u,H)}
 else if(type==='slideRight'){ctx.drawImage(canvas,W*u,0,W,H);ctx.fillStyle='#06151d';ctx.fillRect(0,0,W*u,H)}
 else if(type==='zoomIn'||type==='zoomOut'){const scale=type==='zoomIn'?1+u*.28:1-u*.24;ctx.fillStyle='#06151d';ctx.fillRect(0,0,W,H);ctx.translate(W/2,H/2);ctx.scale(scale,scale);ctx.drawImage(canvas,-W/2,-H/2,W,H);}
 else if(type==='blur'){ctx.filter='blur('+Math.max(1,Math.round(u*14))+'px)';ctx.drawImage(canvas,0,0,W,H);ctx.filter='none';}
 else if(type==='circle'){ctx.fillStyle='#06151d';ctx.beginPath();ctx.rect(0,0,W,H);ctx.arc(W/2,H/2,Math.max(0.1,(1-u)*Math.hypot(W,H)/2),0,Math.PI*2,true);ctx.fill('evenodd')}
 else if(type==='grayscale'||type==='sepia'){ctx.filter=(type==='grayscale'?'grayscale':'sepia')+'('+Math.round(u*100)+'%)';ctx.drawImage(v,0,0,W,H);ctx.filter='none'}
 ctx.restore();
}

updateHistoryButtons();makeCanvas();draw();init();initProjectUI().catch(e=>projectStatus('⚠ Projetos locais indisponíveis: '+e.message,'error'));
})();
