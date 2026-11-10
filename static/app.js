const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clock = n => `${Math.floor(n/60)}:${String(Math.floor(n%60)).padStart(2,'0')}`;
let projects=[], current=null, file=null, lastStatus='', currentView='studio', dirty=false, selectionPlaying=false;
let toastTimer;
function toast(message){ $('#toast').textContent=message; $('#toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('#toast').hidden=true,7000); }
async function api(path, options={}){
  const response=await fetch(path,{...options,headers:{'X-Cliploom':'1',...(options.body && !(options.body instanceof FormData)?{'Content-Type':'application/json'}:{}),...options.headers}});
  const data=await response.json();
  if(!response.ok) throw Error(typeof data.detail==='string'?data.detail:'Please check your input and try again.');
  return data;
}
function show(view){
  currentView=view;
  document.querySelectorAll('.view').forEach(x=>x.hidden=x.id!==`${view}-view`);
  document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view===(view==='editor'?'studio':view)));
  $('#page-label').textContent={studio:'Studio',editor:'Editing room',exports:'Exports',connect:'Connections'}[view];
  if(view!=='editor'){ $('#preview').pause(); selectionPlaying=false; }
  if(view==='exports')refresh().then(drawAllExports).catch(e=>toast(e.message));
}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{
  if(dirty&&!confirm('Leave without saving caption edits?'))return;
  dirty=false;show(b.dataset.view);
});
$('#back-btn').onclick=()=>{if(dirty&&!confirm('Leave without saving caption edits?'))return;dirty=false;show('studio');};
function pickFile(f){
  if(!f)return;
  if(f.size>200*1024*1024){toast('Choose a file smaller than 200 MB.');return;}
  if(!/\.(mp4|mov|webm|mkv)$/i.test(f.name)){toast('Choose MP4, MOV, WebM or MKV.');return;}
  file=f;$('#file-label').textContent=f.name;$('#create-btn').disabled=false;
}
$('#video-input').onchange=e=>pickFile(e.target.files[0]);
['dragenter','dragover'].forEach(type=>$('#dropzone').addEventListener(type,e=>{e.preventDefault();$('#dropzone').classList.add('drag');}));
['dragleave','drop'].forEach(type=>$('#dropzone').addEventListener(type,e=>{e.preventDefault();$('#dropzone').classList.remove('drag');}));
$('#dropzone').addEventListener('drop',e=>pickFile(e.dataTransfer.files[0]));
$('#create-btn').onclick=()=>{
  if(!file)return;
  const form=new FormData();form.append('file',file);form.append('language',$('#language').value);form.append('quality',$('#quality').value);form.append('vocabulary',$('#vocabulary').value);
  $('#create-btn').disabled=true;$('#upload-progress').hidden=false;
  const xhr=new XMLHttpRequest();xhr.open('POST','/api/projects');xhr.setRequestHeader('X-Cliploom','1');
  xhr.upload.onprogress=e=>{if(e.lengthComputable){const p=Math.round(e.loaded/e.total*100);$('#upload-progress progress').value=p;$('#upload-progress span').textContent=p===100?'Checking your video…':`Uploading ${p}%`;}};
  xhr.onload=async()=>{try{const p=JSON.parse(xhr.responseText);if(xhr.status>=400)throw Error(p.detail||'Upload failed.');file=null;$('#video-input').value='';$('#file-label').textContent='Drop your video here';await refresh();openProject(p.id);}catch(e){toast(e.message);$('#create-btn').disabled=!file;}finally{$('#upload-progress').hidden=true;}};
  xhr.onerror=()=>{toast('Could not reach Cliploom. Keep its server window open.');$('#create-btn').disabled=false;$('#upload-progress').hidden=true;};xhr.send(form);
};
$('#demo-btn').onclick=async()=>{const b=$('#demo-btn');b.disabled=true;try{toast('Preparing a generated sample with prepared captions…');const p=await api('/api/demo',{method:'POST'});await refresh();openProject(p.id);}catch(e){toast(e.message);}finally{b.disabled=false;}};
$('#demo-mobile').onclick=async()=>{const b=$('#demo-mobile');b.disabled=true;try{await $('#demo-btn').onclick();}finally{b.disabled=false;}};
async function refresh(){
  projects=await api('/api/projects');$('#project-count').textContent=projects.length;
  $('#export-count').textContent=String(projects.reduce((n,p)=>n+p.exports.length,0)).padStart(2,'0');
  $('#empty-state').hidden=projects.length>0;
  $('#project-list').innerHTML=projects.map(p=>`<button class="project-card" data-project="${p.id}"><div class="thumb">${p.status==='uploaded'||p.status==='queued'?'<span class="placeholder">✧</span>':`<img src="/media/${p.id}/thumb.jpg" alt="" loading="lazy">`}<span class="duration">${clock(p.duration)}</span></div><div class="project-info"><strong>${esc(p.name)}</strong><small>${p.demo?'SAMPLE · ':''}${esc(p.status.toUpperCase())} · ${p.exports.length} exports</small></div></button>`).join('');
  document.querySelectorAll('[data-project]').forEach(b=>b.onclick=()=>openProject(b.dataset.project));
  $('#project-list').querySelectorAll('img').forEach(img=>img.onerror=()=>{img.hidden=true;});
}
async function openProject(id){
  try{current=await api(`/api/projects/${id}`);lastStatus='';dirty=false;show('editor');drawEditor(true);loadOllama();window.scrollTo({top:0,behavior:'smooth'});}catch(e){toast(e.message);}
}
function busy(p){return ['uploaded','queued','processing','rendering'].includes(p.status);}
function drawEditor(full=false){
  const p=current;if(!p)return;
  $('#project-name').textContent=p.name;$('#project-badge').textContent=p.demo?'PREPARED DEMO':(p.detected_language||p.language).toUpperCase();
  $('#job-panel').hidden=!busy(p)&&p.status!=='error';$('#job-message').textContent=p.message;$('#job-progress').value=p.progress;$('#job-error').textContent=p.error||'';
  $('#retry-btn').hidden=p.status!=='error';$('#job-panel .spinner').hidden=p.status==='error';
  $('#render-btn').disabled=busy(p);$('#save-captions').disabled=busy(p);$('#suggest-btn').disabled=busy(p)||!$('#ollama-model').value;
  if(full || (lastStatus!==p.status && !busy(p) && !dirty)){
    const source=`/media/${p.id}/preview.mp4`;
    if($('#preview').getAttribute('src')!==source){$('#preview').src=source;}
    else if(lastStatus!==p.status && !busy(p) && $('#preview').error){$('#preview').load();}
    $('#suggestion-note').textContent=p.demo?'Demo uses prepared captions, not speech recognition. Try uploading a spoken video next.':p.suggestion_model?`Suggestions from ${p.suggestion_model}. Review the cuts before export.`:'Starting points based on transcript timing, not a prediction of engagement. Adjust the range to tell a complete story.';
    $('#clip-list').innerHTML=p.clips.map((c,i)=>`<button class="clip-choice" data-clip="${i}"><small>0${i+1} / ${clock(c.start)} — ${clock(c.end)} · ${(c.end-c.start).toFixed(0)}s</small><strong>${esc(c.title)}</strong></button>`).join('');
    $('#clip-list').querySelectorAll('button').forEach(b=>b.onclick=()=>selectClip(p.clips[+b.dataset.clip]));
    $('#caption-list').innerHTML=p.segments.length?p.segments.map((s,i)=>`<div class="caption-row" data-segment="${i}"><button data-seek="${s.start}">${clock(s.start)} → ${clock(s.end)}</button><textarea aria-label="Caption ${i+1}" data-caption="${i}">${esc(s.text)}</textarea></div>`).join(''):'<p class="panel-intro">No speech captions found. Try another model or export without captions.</p>';
    $('#caption-list').querySelectorAll('[data-seek]').forEach(b=>b.onclick=()=>{$('#preview').currentTime=+b.dataset.seek;});
    $('#caption-list').querySelectorAll('textarea').forEach(t=>t.oninput=()=>{dirty=true;$('#caption-save-state').textContent='Unsaved changes';});
    if(full){selectClip(p.clips[0]||{start:0,end:Math.min(30,p.duration),title:'My short'});}
    drawExports(p.exports,p.id,$('#project-exports'));
  }
  if(lastStatus==='rendering'&&p.status==='ready')refresh().catch(()=>{});
  lastStatus=p.status;
}
function selectClip(c){$('#clip-start').value=c.start;$('#clip-end').value=c.end;$('#clip-title').value=c.title;$('#preview').currentTime=c.start;selectionPlaying=false;}
$('#preview-range').onclick=()=>{const a=+$('#clip-start').value,b=+$('#clip-end').value;if(!(a>=0&&b>a&&b<=current.duration)){toast('Choose a valid start and end.');return;}selectionPlaying=true;$('#preview').currentTime=a;$('#preview').play().catch(()=>toast('Preview is still being prepared.'));};
$('#preview').ontimeupdate=()=>{if(!current)return;const t=$('#preview').currentTime;if(selectionPlaying&&t>=+$('#clip-end').value){$('#preview').pause();selectionPlaying=false;}const s=current.segments.find(s=>t>=s.start&&t<s.end);$('#caption-overlay').textContent=$('#burn-captions').checked&&s?s.text:'';};
$('#caption-style').onchange=()=>{$('#caption-overlay').style.color={bold:'#ffda58',clean:'#ffffff',mint:'#a3e8c9',coral:'#ffa187',lavender:'#d9c6f0',sky:'#a0d6f2'}[$('#caption-style').value];};
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('selected',x===b));$('#clips-tab').hidden=b.dataset.tab!=='clips';$('#captions-tab').hidden=b.dataset.tab!=='captions';});
async function saveCaptions(){
  const segments=current.segments.map((s,i)=>({...s,text:document.querySelector(`[data-caption="${i}"]`)?.value??s.text}));
  const selection={start:+$('#clip-start').value,end:+$('#clip-end').value,title:$('#clip-title').value};
  const p=await api(`/api/projects/${current.id}/captions`,{method:'PUT',body:JSON.stringify({segments})});current=p;dirty=false;drawEditor(true);selectClip(selection);$('#caption-save-state').textContent='Caption edits saved.';
}
$('#save-captions').onclick=async()=>{try{await saveCaptions();toast('Captions saved.');}catch(e){toast(e.message);}};
$('#render-btn').onclick=async()=>{
  const start=+$('#clip-start').value,end=+$('#clip-end').value;
  if(!(start>=0&&end>start&&end<=current.duration&&end-start<=90)){toast('Select a range within the video, up to 90 seconds.');return;}
  $('#render-btn').disabled=true;
  try{if(dirty)await saveCaptions();await api(`/api/projects/${current.id}/render`,{method:'POST',body:JSON.stringify({start,end,title:$('#clip-title').value||'My short',framing:$('#framing').value,captions:$('#burn-captions').checked,style:$('#caption-style').value})});current=await api(`/api/projects/${current.id}`);drawEditor();toast('Rendering started. You can keep this page open.');}catch(e){toast(e.message);$('#render-btn').disabled=false;}
};
$('#retry-btn').onclick=async()=>{try{await api(`/api/projects/${current.id}/retry`,{method:'POST'});current=await api(`/api/projects/${current.id}`);drawEditor();}catch(e){toast(e.message);}};
function drawExports(exports,pid,target){
  target.innerHTML=exports.length?exports.map(e=>`<article class="project-card"><video controls playsinline preload="metadata" src="/media/${pid}/${e.file}"></video><div class="project-info"><strong>${esc(e.title)}</strong><small>${(e.end-e.start).toFixed(1)}s · 720 × 1280</small></div><div class="download-actions"><a href="/media/${pid}/${e.file}?download=true" download>↓ Video</a><a href="/media/${pid}/${e.captions}?download=true" download>↓ Captions</a></div></article>`).join(''):'<p class="panel-intro">Your exported clips will appear here.</p>';
}
function drawAllExports(){const target=$('#all-exports');target.innerHTML='';for(const p of projects){if(!p.exports.length)continue;const div=document.createElement('div');drawExports(p.exports,p.id,div);while(div.firstChild)target.append(div.firstChild);}if(!target.children.length)target.innerHTML='<p class="panel-intro">Export your first clip from the editor.</p>';}
async function loadOllama(){
  try{const data=await api('/api/ollama');$('#ollama-model').innerHTML=data.models.length?data.models.map(m=>`<option value="${esc(m)}">${esc(m)}</option>`).join(''):'<option value="">No local model running</option>';$('#ollama-note').textContent=data.models.length?'Uses your local Ollama server. No cloud API calls.':'Ollama is optional. The editor and captions work without it.';$('#suggest-btn').disabled=!data.models.length||busy(current);}catch(e){$('#ollama-note').textContent=e.message;}
}
$('#suggest-btn').onclick=async()=>{if(!$('#ollama-model').value)return;$('#suggest-btn').disabled=true;try{if(dirty)await saveCaptions();toast('Asking your local model. This may take a few minutes.');const p=await api(`/api/projects/${current.id}/suggest`,{method:'POST',body:JSON.stringify({model:$('#ollama-model').value})});current=p;drawEditor(true);toast('Suggestions ready.');}catch(e){toast(e.message);}finally{$('#suggest-btn').disabled=false;}};
let pollBusy=false;
setInterval(async()=>{if(pollBusy)return;pollBusy=true;try{if(current&&currentView==='editor'){const p=await api(`/api/projects/${current.id}`);current=p;drawEditor();}if(currentView==='studio'||projects.some(busy))await refresh();}catch(e){/* Server status stays visible through subsequent operations. */}finally{pollBusy=false;}},2500);
refresh().catch(e=>toast('Start Cliploom to load your projects. '+e.message));
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
