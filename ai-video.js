'use strict';
const DEFAULT_AI_VIDEO_PROMPT="Maak een vrolijke, professionele reclamevideo van acht seconden voor sociale media. Het product uit de foto is de ster: behoud het exacte uiterlijk, de kleuren, het merk en de verhoudingen, en houd het de hele video duidelijk en scherp in beeld. Laat het product op een speelse, natuurlijke manier bewegen of gebruiken, met een vloeiende filmische camerabeweging. Voeg passende vrolijke achtergrondmuziek en geluidseffecten toe. Als er een persoon spreekt, spreekt die duidelijk Nederlands. Voeg geen tekst of logo's toe.";
const MAX_VEO_IMAGE_BYTES=10*1024*1024;
const AI_VIDEO_INLINE_BYTES=4*1024*1024;
let aiVideoRunning=false,aiVideoPollTimer=0,aiVideoPollStarted=0,aiVideoUrl='',aiVideoPreviewUrl='';
const AI_VIDEO_SERVER_ERROR='De videodienst gaf een onverwacht serverantwoord. Probeer het opnieuw of neem contact op met de ondersteuning.';
const AI_VIDEO_RETRY_WARNING='De vorige videoaanvraag is mogelijk al gestart. Opnieuw starten kan een extra betaalde video opleveren.';
let aiVideoMayHaveStarted=false;
const AI_VIDEO_RECOVERY_KEY='spectron-ai-video-recovery';
const AI_VIDEO_OPERATION_PATTERN=/^(?:interactions\/[A-Za-z0-9_-]{1,2048}|operations\/[A-Za-z0-9._-]+|models\/[A-Za-z0-9._-]+\/operations\/[A-Za-z0-9._-]+)$/;
let aiVideoOperation='';
/** Persist only the provider reference, orientation and an empty-ID submission marker. */
function saveAIVideoRecovery(){
  updateAIVideoRecoveryButton();
  try{
    if(!window.sessionStorage){console.warn('[ai-video] Request recovery storage unavailable; keep this tab open.');return;}
    window.sessionStorage.setItem(AI_VIDEO_RECOVERY_KEY,JSON.stringify({
      operation:aiVideoOperation,aspectRatio:aiVideoRequestedRatio
    }));
  }catch(error){console.warn('[ai-video] Request recovery storage unavailable; keep this tab open.');}
}
function restoreAIVideoRecovery(){
  try{
    const raw=window.sessionStorage?.getItem(AI_VIDEO_RECOVERY_KEY);
    if(!raw)return;
    const saved=JSON.parse(raw);
    if(!saved||typeof saved.operation!=='string'
      ||(saved.operation!==''&&!AI_VIDEO_OPERATION_PATTERN.test(saved.operation))
      ||!['9:16','16:9'].includes(saved.aspectRatio)){
      console.warn('[ai-video] Ignoring invalid request recovery metadata.');
      return;
    }
    aiVideoOperation=saved.operation;
    aiVideoRequestedRatio=saved.aspectRatio;
    aiVideoMayHaveStarted=true;
    updateAIVideoRecoveryButton();
  }catch(error){console.warn('[ai-video] Request recovery metadata could not be read.');}
}
function updateAIVideoRecoveryButton(){
  const button=aiVideoEl('aiVideoPreviousButton');
  if(button)button.hidden=!aiVideoOperation&&!aiVideoMayHaveStarted;
}
// Restore silently; only an explicit click may reveal recovery or read status.
async function openPreviousAIVideo(){
  if(aiVideoRunning||aiVideoConfirmPending)return;
  if(aiVideoOperation){await resumeAIVideo();return;}
  if(aiVideoMayHaveStarted)showAIVideoRecovery('Een eerdere aanvraag is mogelijk gestart, maar er is geen aanvraagnummer ontvangen. Neem contact op met de ondersteuning voordat je een nieuwe betaalde aanvraag start.');
}
// Keep the submitted orientation independent of later selector changes.
let aiVideoRequestedRatio='9:16';
function aiVideoLocalDiagnostic(response,endpoint,body=''){
  if(!['localhost','127.0.0.1','[::1]'].includes(window.location?.hostname))return;
  const path=endpoint.split('?')[0];
  if(!['/.netlify/functions/start-veo-video','/.netlify/functions/veo-video-status','/.netlify/functions/download-veo-video'].includes(path))return;
  const mime=(response.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
  const contentType=['application/json','text/html','text/plain','video/mp4'].includes(mime)?mime:'other or missing';
  const prefix=/^\s*<!doctype/i.test(body)?'<!DOCTYPE':/^\s*<html/i.test(body)?'<html>':/^\s*</.test(body)?'[markup]':'[non-HTML body omitted]';
  console.warn('[ai-video] Unexpected service response',{path,status:response.status,contentType,prefix});
}
async function readAIVideoJSON(response,endpoint){
  const body=await response.text();
  const mime=(response.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
  let result;
  if(mime==='application/json'){
    try{result=JSON.parse(body);}catch{}
  }
  if(!result||typeof result!=='object'||Array.isArray(result)){
    aiVideoLocalDiagnostic(response,endpoint,body);
    throw new Error(AI_VIDEO_SERVER_ERROR);
  }
  if(!response.ok){
    if(endpoint==='/.netlify/functions/video-reference-upload'||result.category==='invalid-upload'){
      const messages={400:'Controleer de foto’s en probeer de upload opnieuw.',403:'De foto-upload is niet toegestaan voor deze sessie.',404:'De foto-upload is niet gevonden.',409:'De foto-upload is onvolledig of al gebruikt.',410:'De foto-upload is verlopen.',413:'De referentiefoto’s mogen samen maximaal 10 MiB zijn.',429:'Te veel foto-uploads. Probeer later opnieuw.'};
      const error=new Error((messages[response.status]||'De foto-upload is onderbroken.')+' Er is geen nieuwe video gestart.');
      error.noVideoStarted=true;throw error;
    }
    const messages={400:'De videoaanvraag is ongeldig. Controleer je afbeelding en beschrijving.',401:'De videodienst kon zich niet aanmelden.',403:'De videodienst heeft geen toegang.',404:'De videodienst is niet gevonden. Neem contact op met de ondersteuning.',405:'De videodienst heeft deze aanvraagmethode geweigerd.',409:'De video is nog niet klaar.',422:'De videoaanvraag kon niet worden voltooid.',429:'De gebruikslimiet van Google is bereikt. Probeer het later opnieuw.',500:'De serverinstellingen van de videodienst zijn onjuist.',502:'De videodienst kon de aanvraag niet voltooien. Probeer het opnieuw of neem contact op met de ondersteuning.'};
    throw new Error(messages[response.status]||AI_VIDEO_SERVER_ERROR);
  }
  return result;
}
async function readAIVideoDownload(response){
  const endpoint='/.netlify/functions/download-veo-video';
  const mime=(response.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
  if(!response.ok||mime!=='video/mp4'){
    await readAIVideoJSON(response,endpoint);
    throw new Error(AI_VIDEO_SERVER_ERROR);
  }
  const blob=await response.blob();
  if(!blob.size)throw new Error('Het gegenereerde videovoorbeeld is leeg.');
  return blob;
}
function aiVideoEl(id){return document.getElementById(id);}
function aiVideoFormatRatio(){return aiVideoEl('aiVideoAspect')?.value||'9:16';}
function updateVideoMode(){const ai=aiVideoEl('outputType')?.value==='ai-video';const panel=aiVideoEl('aiVideoOptions');const old=aiVideoEl('videoOptions');if(old)old.hidden=true;if(panel)panel.hidden=!ai;const main=aiVideoEl('generateBtn');if(main)main.hidden=ai;const btn=aiVideoEl('generateAIVideoBtn');if(btn){btn.disabled=!ai||aiVideoRunning;btn.setAttribute('aria-disabled',String(btn.disabled));}if(ai){syncAIVideoImage();const ratio=aiVideoFormatRatio();if(aiVideoEl('aiVideoAspect'))aiVideoEl('aiVideoAspect').value=ratio;if(typeof syncStudioVideoFormatButtons==='function')syncStudioVideoFormatButtons(ratio);if(aiVideoEl('aiVideoSquareHint'))aiVideoEl('aiVideoSquareHint').hidden=!(getFormatSpec()?.width===getFormatSpec()?.height);} }
window.syncAIVideoImage=function syncAIVideoImage(){window.aiVideoReferences?.syncSelectedImage(selectedImage);const preview=aiVideoEl('aiVideoSourcePreview');const empty=aiVideoEl('aiVideoNoImage');if(preview){preview.src=selectedImage||'';preview.hidden=!selectedImage;}if(empty)empty.hidden=true;const btn=aiVideoEl('generateAIVideoBtn');if(btn)btn.disabled=aiVideoRunning;}
function clearAIVideoUrl(){if(aiVideoPreviewUrl){URL.revokeObjectURL(aiVideoPreviewUrl);aiVideoPreviewUrl='';}aiVideoUrl='';}
function blobToDataUrl(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('De geselecteerde afbeelding kon niet worden gelezen.'));reader.readAsDataURL(blob);});}
async function normalizeAIVideoImage(targetRatio, source=selectedImage){
  // Output orientation belongs to response_format. References retain all pixels.
  if(!source)throw new Error('Selecteer eerst een merkbeeld.');
  let response;
  try{response=await fetch(source);}catch{throw new Error('Het geselecteerde merkbeeld is niet meer beschikbaar. Selecteer het opnieuw.');}
  let blob;
  try{blob=await response.blob();}catch{throw new Error('Het geselecteerde merkbeeld kon niet worden geladen.');}
  if(!['image/jpeg','image/png','image/webp'].includes(blob.type))throw new Error('AI-video ondersteunt merkbeelden in JPEG-, PNG- en WebP-formaat.');
  if(!blob.size)throw new Error('Het geselecteerde merkbeeld is leeg.');
  if(blob.size>MAX_VEO_IMAGE_BYTES)throw new Error('De referentiefoto’s mogen samen maximaal 10 MiB zijn.');
  const bitmap=await createImageBitmap(blob).catch(()=>null);
  if(!bitmap)throw new Error('Het merkbeeld kon niet worden verwerkt. Selecteer een andere afbeelding.');
  bitmap.close?.();
  const dataUrl=await blobToDataUrl(blob);
  const comma=dataUrl.indexOf(',');
  if(comma<0)throw new Error('Het geselecteerde merkbeeld heeft een ongeldig bestandsformaat.');
  return {mimeType:blob.type,data:dataUrl.slice(comma+1)};
}
async function referenceUploadAction(action, values={}, timeout=30000){
  const endpoint='/.netlify/functions/video-reference-upload';
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(timeout),body:JSON.stringify({action,...values})});
  return readAIVideoJSON(response,endpoint);
}
async function releaseReferenceUpload(reference){
  try{await referenceUploadAction('delete',{reference},5000);}catch{ /* The server expiry sweep retries cleanup; never retry generation. */ }
}
async function uploadAIVideoReferences(references){
  const files=await Promise.all(references.map(async image=>{
    const response=await fetch(`data:${image.mimeType};base64,${image.data}`);
    const bytes=new Uint8Array(await response.arrayBuffer());
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    const sha256=[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
    return {mimeType:image.mimeType,bytes,sha256};
  }));
  let reference;
  try{
    const result=await referenceUploadAction('create',{images:files.map(file=>({mimeType:file.mimeType,size:file.bytes.length,sha256:file.sha256}))});
    reference=result.reference;
    if(!reference||typeof reference.id!=='string'||!Number.isSafeInteger(reference.expiresAt)||typeof reference.token!=='string'||result.chunkBytes!==1024*1024)throw new Error('De foto-upload gaf een ongeldig antwoord.');
    for(let image=0;image<files.length;image++){
      const bytes=files[image].bytes;
      for(let offset=0,part=0;offset<bytes.length;offset+=result.chunkBytes,part++){
        const chunk=bytes.subarray(offset,offset+result.chunkBytes);
        let binary='';for(let start=0;start<chunk.length;start+=32768)binary+=String.fromCharCode(...chunk.subarray(start,start+32768));
        await referenceUploadAction('chunk',{reference,image,part,data:btoa(binary)});
      }
    }
    return reference;
  }catch(error){
    if(reference)await releaseReferenceUpload(reference);
    if(error instanceof TypeError||['TimeoutError','AbortError'].includes(error.name))throw new Error('De foto-upload is onderbroken. Er is geen nieuwe video gestart. Probeer opnieuw.');
    throw error;
  }
}
/** @param {boolean} loading */
function setAIVideoLoading(loading){
  aiVideoRunning=loading;
  window.aiVideoReferences?.setBusy(loading);
  const btn=aiVideoEl('generateAIVideoBtn');
  if(btn){btn.disabled=loading;btn.textContent=loading?'Video wordt gegenereerd...':'Genereer mijn video';}
  setAdGenerationState(loading,'video');
  if(loading){
    aiVideoEl('outputMeta').textContent='AI-video — bezig';
    const results=aiVideoEl('resultsArea');
    if(results)results.innerHTML='<div role="status">AI-video wordt verwerkt. Wachten op de bestaande aanvraag of het antwoord op de inzending...</div>';
  }
}
function clearAIVideoPolling(){if(aiVideoPollTimer){clearTimeout(aiVideoPollTimer);aiVideoPollTimer=0;}}
/** @param {string} message */
function showAIVideoError(message){
  showAIVideoRecovery(message,'AI-video mislukt',false);
}
/** @param {string} message @param {string} title @param {boolean} canResume */
function showAIVideoRecovery(message,title='AI-video — statuscontrole onderbroken',canResume=true){
  window.studioProgress?.stop();
  // Explicit recovery can run before generation has revealed the output.
  const output=aiVideoEl('workspaceOutput');if(output)output.hidden=false;
  const placeholder=aiVideoEl('workspacePlaceholder');if(placeholder)placeholder.hidden=true;
  const imagePreview=aiVideoEl('workspaceImagePreview');if(imagePreview)imagePreview.hidden=true;
  const results=aiVideoEl('resultsArea');
  const resume=canResume&&aiVideoOperation?'<button type="button" class="card-dl-btn" onclick="resumeAIVideo()">Bestaande aanvraag controleren / Voorbeeld opnieuw laden</button>':'';
  const newRequest='<button type="button" class="card-dl-btn" onclick="generateAIVideo(true)">Nieuwe betaalde video (bevestiging vereist)</button>';
  if(results)results.innerHTML=`<div class="error-box" role="alert">${escapeHtml(message)} ${resume} ${newRequest}</div>`;
  aiVideoEl('outputMeta').textContent=title;
}
async function resumeAIVideo(){
  if(aiVideoRunning||aiVideoConfirmPending||!aiVideoOperation)return;
  clearAIVideoPolling();
  aiVideoPollStarted=Date.now();
  setAIVideoLoading(true);
  await pollAIVideo(aiVideoOperation);
}
// Size only the rendered preview; the submitted ratio and download stay unchanged.
function sizeAIVideoPreview(){
  const frame=aiVideoEl('aiVideoFrame'),canvas=aiVideoEl('workspaceCanvas'),results=aiVideoEl('resultsArea');
  if(!frame||!canvas||!results||!frame.getBoundingClientRect)return;
  const viewportHeight=window.visualViewport?.height||window.innerHeight;
  const mobile=window.innerWidth<=600;
  const availableHeight=mobile?viewportHeight:Math.min(canvas.clientHeight,viewportHeight);
  const above=frame.getBoundingClientRect().top-canvas.getBoundingClientRect().top+(canvas.scrollTop||0);
  const footer=canvas.querySelector?.('.footer-note');
  const saved=aiVideoEl('savedLibrary');
  const below=Math.max(0,results.scrollHeight-frame.offsetHeight)+(footer?.offsetHeight||0)+(saved?.offsetHeight||0);
  const height=Math.max(1,availableHeight-above-below-24);
  frame.style.setProperty('--ai-video-preview-height',`${height}px`);
}
window.addEventListener('resize',sizeAIVideoPreview);
window.visualViewport?.addEventListener('resize',sizeAIVideoPreview);
/** @param {string} message */
function showAIVideoPreviewError(message){
  const error=aiVideoEl('aiVideoPreviewError');
  if(error){error.hidden=false;error.textContent=message+' Laad het voorbeeld opnieuw of kies MP4 downloaden om het bestand af te spelen.';}
  aiVideoEl('outputMeta').textContent='AI-video — voltooid, voorbeeld niet beschikbaar';
}
function waitForAIVideoReady(video){
  if(video.readyState>=2) return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{clearTimeout(timer);video.removeEventListener('loadeddata',ready);video.removeEventListener('error',failed);};
    const ready=()=>{cleanup();resolve();};
    const failed=()=>{cleanup();reject(new Error('Het videovoorbeeld kon niet worden afgespeeld.'));};
    const timer=setTimeout(()=>{cleanup();reject(new Error('Het laden van het videovoorbeeld duurde te lang.'));},30000);
    video.addEventListener('loadeddata',ready,{once:true});
    video.addEventListener('error',failed,{once:true});
  });
}
/** @param {string} operation */
async function showAIVideoPreview(operation){
  clearAIVideoUrl();
  aiVideoUrl='/.netlify/functions/download-veo-video?operation='+encodeURIComponent(operation);
  const previewMode=aiVideoRequestedRatio==='9:16'?'portrait':'landscape';
  const results=aiVideoEl('resultsArea');
  results.hidden=true;
  results.innerHTML=`<div class="video-result ai-video-result">
    <div id="aiVideoFrame" class="ai-video-frame ai-video-frame-${previewMode}">
      <video id="aiVideoPreview" class="video-preview" controls muted loop playsinline preload="metadata" aria-label="Voorbeeld van AI-video"></video>
    </div>
    <p id="aiVideoPreviewError" class="error-box" role="alert" hidden></p><p class="ai-video-title">AI-video</p>
    <div class="button-row">
      <a id="aiVideoDownload" class="card-dl-btn" href="${aiVideoUrl}" download="spectron-ai-video.mp4">MP4 downloaden</a>
      <button type="button" id="aiVideoAgain" class="card-dl-btn">Opnieuw genereren (nieuwe betaalde aanvraag)</button>
      <button type="button" class="card-dl-btn" onclick="resumeAIVideo()">Voorbeeld opnieuw laden</button>
    </div></div>`;
  const video=aiVideoEl('aiVideoPreview');
  video.controls=true;video.muted=true;video.loop=true;video.playsInline=true;video.preload='metadata';
  video.dataset.previewRatio=previewMode;
  video.addEventListener('loadedmetadata',()=>{
    sizeAIVideoPreview();
    console.info('[ai-video] preview dimensions',video.videoWidth,video.videoHeight,'ratio',video.videoWidth&&video.videoHeight?(video.videoWidth/video.videoHeight).toFixed(3):'unknown');
  });
  video.onerror=()=>showAIVideoPreviewError('Het videovoorbeeld kon niet in deze browser worden geladen.');
  aiVideoEl('aiVideoAgain').onclick=()=>generateAIVideo(true);
  aiVideoEl('outputMeta').textContent='AI-video — voltooid';
  try{
    const videoResponse=await fetch(aiVideoUrl);
    const videoBlob=await readAIVideoDownload(videoResponse);
    aiVideoPreviewUrl=URL.createObjectURL(videoBlob);
    video.src=aiVideoPreviewUrl;video.load();
    await waitForAIVideoReady(video);
    if(window.studioProgress && !await window.studioProgress.complete()) return;
  }catch(previewError){
    showAIVideoPreviewError(previewError.message||AI_VIDEO_SERVER_ERROR);
    clearAIVideoUrl();
  }finally{
    results.hidden=false;
    setAIVideoLoading(false);sizeAIVideoPreview();
  }
}
/** @param {string} operation */
async function pollAIVideo(operation){
  if(!aiVideoRunning)return;
  if(Date.now()-aiVideoPollStarted>=420000){
    clearAIVideoPolling();setAIVideoLoading(false);
    showAIVideoRecovery('De statuscontrole is na zeven minuten gestopt. Google is mogelijk nog bezig. Controleer de bestaande aanvraag opnieuw.');
    return;
  }
  try{
    const response=await fetch('/.netlify/functions/veo-video-status?operation='+encodeURIComponent(operation));
    const result=await readAIVideoJSON(response,'/.netlify/functions/veo-video-status');
    if(!['pending','failed','completed','unknown'].includes(result.state))throw new Error(AI_VIDEO_SERVER_ERROR);
    if(result.state==='pending'){
      aiVideoEl('outputMeta').textContent='AI-video — in behandeling';
      aiVideoPollTimer=setTimeout(()=>pollAIVideo(operation),10000);return;
    }
    clearAIVideoPolling();
    if(result.state==='completed'&&result.outputAvailable!==false){await showAIVideoPreview(operation);return;}
    setAIVideoLoading(false);
    if(result.state==='failed'){
      aiVideoMayHaveStarted=false;
      showAIVideoError(result.message||'Google heeft gemeld dat de videoaanvraag is mislukt.');return;
    }
    if(result.state==='completed'){
      showAIVideoRecovery(result.message||'Google meldt dat de aanvraag is voltooid, maar het videoresultaat is niet beschikbaar of niet herkend.','AI-video — voltooid, resultaat niet beschikbaar');return;
    }
    showAIVideoRecovery('De status van deze bestaande aanvraag kon niet worden bepaald. Controleer opnieuw; er is geen nieuwe video gestart.');
  }catch(error){
    clearAIVideoPolling();setAIVideoLoading(false);
    aiVideoMayHaveStarted=true;
    showAIVideoRecovery('De statuscontrole is onderbroken. Google is mogelijk nog bezig. '+(error instanceof TypeError?'De videodienst kon niet worden bereikt.':error.message||AI_VIDEO_SERVER_ERROR)+' '+AI_VIDEO_RETRY_WARNING);
  }
}
let aiVideoConfirmPending=false;
let aiVideoConfirmPreviousFocus=null;
function closeAIVideoConfirm(confirmed){const modal=aiVideoEl('aiVideoConfirmModal');const confirmButton=aiVideoEl('aiVideoConfirmButton');if(modal)modal.hidden=true;if(confirmButton&&!confirmed){confirmButton.disabled=false;confirmButton.textContent='Video genereren';}const previous=aiVideoConfirmPreviousFocus;aiVideoConfirmPreviousFocus=null;aiVideoConfirmPending=false;previous?.focus?.();if(window.__aiVideoConfirmResolve){const resolve=window.__aiVideoConfirmResolve;window.__aiVideoConfirmResolve=null;resolve(confirmed);}}
function requestAIVideoConfirmation(){if(aiVideoConfirmPending)return Promise.resolve(false);const modal=aiVideoEl('aiVideoConfirmModal');const confirmButton=aiVideoEl('aiVideoConfirmButton');const cancelButton=aiVideoEl('aiVideoCancelButton');if(!modal||!confirmButton||!cancelButton)return Promise.resolve(false);const warning=aiVideoEl('aiVideoRetryWarning');if(warning)warning.hidden=!aiVideoMayHaveStarted;aiVideoConfirmPending=true;aiVideoConfirmPreviousFocus=document.activeElement;modal.hidden=false;confirmButton.disabled=false;confirmButton.textContent='Video genereren';confirmButton.focus();return new Promise(resolve=>{window.__aiVideoConfirmResolve=resolve;confirmButton.onclick=()=>{confirmButton.disabled=true;confirmButton.textContent='Video wordt gestart...';closeAIVideoConfirm(true);};cancelButton.onclick=()=>closeAIVideoConfirm(false);modal.onclick=event=>{if(event.target===modal)closeAIVideoConfirm(false);};});}
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&!aiVideoEl('aiVideoConfirmModal')?.hidden)closeAIVideoConfirm(false);});
/** @param {boolean} newRequest Require a separate confirmation instead of resuming. */
async function generateAIVideo(newRequest=false){
  if(aiVideoRunning||aiVideoConfirmPending)return;
  if(aiVideoOperation&&!newRequest){await resumeAIVideo();return;}
  if(!selectedImage){const empty=aiVideoEl('aiVideoNoImage');if(empty)empty.hidden=false;return;}
  const empty=aiVideoEl('aiVideoNoImage');if(empty)empty.hidden=true;
  if(window.aiVideoReferences){
    try{window.aiVideoReferences.getSources();}
    catch(error){window.aiVideoReferences.showError(error.message);return;}
  }
  const confirmed=await requestAIVideoConfirmation();
  if(!confirmed||aiVideoRunning)return;
  clearAIVideoPolling();setAIVideoLoading(true);
  let submitting=false,uploadReference=null;
  try{
    const ratio=aiVideoEl('aiVideoAspect').value;
    if(!['9:16','16:9'].includes(ratio))throw new Error('Kies staand 9:16 of liggend 16:9.');
    const sources=window.aiVideoReferences?.getSources()||[selectedImage];
    const references=await Promise.all(sources.map(source=>normalizeAIVideoImage(ratio,source)));
    const totalBytes=references.reduce((sum,image)=>sum+image.data.length*3/4-(image.data.endsWith('==')?2:image.data.endsWith('=')?1:0),0);
    if(totalBytes>MAX_VEO_IMAGE_BYTES)throw new Error('De referentiefoto’s mogen samen maximaal 10 MiB zijn.');
    const images=references.map(image=>`data:${image.mimeType};base64,${image.data}`);
    const prompt=aiVideoEl('aiVideoPrompt').value.trim();
    if(!prompt)throw new Error('Voer een beschrijving voor de AI-video in.');
    let payload={images,prompt,aspectRatio:ratio};
    if(totalBytes>AI_VIDEO_INLINE_BYTES){
      aiVideoEl('outputMeta').textContent='AI-video — foto’s uploaden';
      uploadReference=await uploadAIVideoReferences(references);
      payload={upload:uploadReference,prompt,aspectRatio:ratio};
    }
    aiVideoRequestedRatio=ratio;aiVideoOperation='';aiVideoMayHaveStarted=true;
    saveAIVideoRecovery();submitting=true;
    const response=await fetch('/.netlify/functions/start-veo-video',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const result=await readAIVideoJSON(response,'/.netlify/functions/start-veo-video');
    if(typeof result.operation!=='string'||!AI_VIDEO_OPERATION_PATTERN.test(result.operation))throw new Error(AI_VIDEO_SERVER_ERROR);
    aiVideoOperation=result.operation;saveAIVideoRecovery();
    aiVideoPollStarted=Date.now();
    aiVideoEl('outputMeta').textContent='AI-video — in behandeling';
    aiVideoPollTimer=setTimeout(()=>pollAIVideo(result.operation),10000);
  }catch(error){
    if(error.noVideoStarted&&submitting){submitting=false;aiVideoMayHaveStarted=false;saveAIVideoRecovery();}
    setAIVideoLoading(false);
    const message=error instanceof TypeError?'De videodienst kon niet worden bereikt.':error.message||AI_VIDEO_SERVER_ERROR;
    if(submitting)showAIVideoRecovery(message+' Er is geen aanvraagnummer ontvangen; de uitkomst van de inzending is niet bevestigd. '+AI_VIDEO_RETRY_WARNING);
    else showAIVideoRecovery(message,'AI-video — controleer je invoer',false);
  }finally{if(uploadReference)await releaseReferenceUpload(uploadReference);}
}
window.addEventListener('pagehide',()=>{clearAIVideoPolling();clearAIVideoUrl();});
window.addEventListener('load',()=>{const p=aiVideoEl('aiVideoPrompt');if(p&&!p.value)p.value=DEFAULT_AI_VIDEO_PROMPT;updateVideoMode();restoreAIVideoRecovery();});


