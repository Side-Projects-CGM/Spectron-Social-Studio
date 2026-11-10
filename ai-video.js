'use strict';
const DEFAULT_AI_VIDEO_PROMPT='Create a professional eight-second product showcase. Preserve the product’s exact appearance, colours, branding and proportions. Add subtle natural movement and a slow cinematic camera push-in. Keep the product clearly visible. Do not introduce new text, logos, products, people or objects.';
const MAX_VEO_IMAGE_BYTES=12*1024*1024;
let aiVideoRunning=false,aiVideoPollTimer=0,aiVideoPollStarted=0,aiVideoUrl='',aiVideoPreviewUrl='';
const AI_VIDEO_SERVER_ERROR='The video service returned an unexpected server response. Please try again or contact support.';
const AI_VIDEO_RETRY_WARNING='The previous video request may already have started. Starting again may create another paid video.';
let aiVideoMayHaveStarted=false;
const AI_VIDEO_RECOVERY_KEY='spectron-ai-video-recovery';
const AI_VIDEO_OPERATION_PATTERN=/^(?:interactions\/[A-Za-z0-9_-]{1,2048}|operations\/[A-Za-z0-9._-]+|models\/[A-Za-z0-9._-]+\/operations\/[A-Za-z0-9._-]+)$/;
let aiVideoOperation='';
/** Persist only the provider reference, orientation and an empty-ID submission marker. */
function saveAIVideoRecovery(){
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
    if(aiVideoOperation)showAIVideoRecovery('An existing video request is available. Check its status or preview without starting another video.');
    else showAIVideoRecovery('A previous submission may have started, but no operation ID was received. Contact support before starting another paid request.');
  }catch(error){console.warn('[ai-video] Request recovery metadata could not be read.');}
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
    const messages={400:'The video request was invalid. Check your image and prompt.',401:'The video service could not authenticate.',403:'The video service does not have permission.',404:'The video service could not be found. Please contact support.',405:'The video service rejected the request method.',409:'The video is not ready yet.',422:'The video request could not be completed.',429:'Google usage limit reached. Please try again later.',500:'The video service has a server configuration error.',502:'The video service could not complete the request. Please try again or contact support.'};
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
  if(!blob.size)throw new Error('The generated video preview is empty.');
  return blob;
}
function aiVideoEl(id){return document.getElementById(id);}
function aiVideoFormatRatio(){return aiVideoEl('aiVideoAspect')?.value||'9:16';}
function updateVideoMode(){const ai=aiVideoEl('outputType')?.value==='ai-video';const panel=aiVideoEl('aiVideoOptions');const old=aiVideoEl('videoOptions');if(old)old.hidden=true;if(panel)panel.hidden=!ai;const main=aiVideoEl('generateBtn');if(main)main.hidden=ai;const btn=aiVideoEl('generateAIVideoBtn');if(btn){btn.disabled=!ai||aiVideoRunning;btn.setAttribute('aria-disabled',String(btn.disabled));}if(ai){syncAIVideoImage();const ratio=aiVideoFormatRatio();if(aiVideoEl('aiVideoAspect'))aiVideoEl('aiVideoAspect').value=ratio;if(typeof syncStudioVideoFormatButtons==='function')syncStudioVideoFormatButtons(ratio);if(aiVideoEl('aiVideoSquareHint'))aiVideoEl('aiVideoSquareHint').hidden=!(getFormatSpec()?.width===getFormatSpec()?.height);} }
window.syncAIVideoImage=function syncAIVideoImage(){const preview=aiVideoEl('aiVideoSourcePreview');const empty=aiVideoEl('aiVideoNoImage');if(preview){preview.src=selectedImage||'';preview.hidden=!selectedImage;}if(empty)empty.hidden=true;const btn=aiVideoEl('generateAIVideoBtn');if(btn)btn.disabled=aiVideoRunning;}
function clearAIVideoUrl(){if(aiVideoPreviewUrl){URL.revokeObjectURL(aiVideoPreviewUrl);aiVideoPreviewUrl='';}aiVideoUrl='';}
function blobToDataUrl(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('The selected image could not be read.'));reader.readAsDataURL(blob);});}
async function normalizeAIVideoImage(targetRatio){if(!selectedImage)throw new Error('Select a Brand Image first.');let response;try{response=await fetch(selectedImage);}catch{throw new Error('The selected Brand Image is no longer available. Select it again.');}let blob;try{blob=await response.blob();}catch{throw new Error('The selected Brand Image could not be loaded.');}const allowed=['image/jpeg','image/png','image/webp'];if(!allowed.includes(blob.type))throw new Error('AI Video supports JPEG, PNG and WebP Brand Images.');if(!blob.size)throw new Error('The selected Brand Image is empty.');const targetAspect=targetRatio==='9:16'?9/16:16/9;const bitmap=await createImageBitmap(blob).catch(()=>null);if(!bitmap)throw new Error('The Brand Image could not be decoded. Select another image.');if(bitmap){const sourceAspect=bitmap.width/bitmap.height;if(Math.abs(sourceAspect-targetAspect)>0.01||blob.size>MAX_VEO_IMAGE_BYTES){const cropWidth=sourceAspect>targetAspect?Math.round(bitmap.height*targetAspect):bitmap.width;const cropHeight=sourceAspect>targetAspect?bitmap.height:Math.round(bitmap.width/targetAspect);const cropX=Math.max(0,Math.round((bitmap.width-cropWidth)/2));const cropY=Math.max(0,Math.round((bitmap.height-cropHeight)/2));const scale=Math.min(1,Math.sqrt(MAX_VEO_IMAGE_BYTES/blob.size));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(cropWidth*scale));canvas.height=Math.max(1,Math.round(cropHeight*scale));canvas.getContext('2d').drawImage(bitmap,cropX,cropY,cropWidth,cropHeight,0,0,canvas.width,canvas.height);blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('The Brand Image could not be prepared.')),blob.type,.9));}bitmap.close?.();}if(blob.size>MAX_VEO_IMAGE_BYTES)throw new Error('This Brand Image is too large after compression. Choose a smaller image.');const dataUrl=await blobToDataUrl(blob);const comma=dataUrl.indexOf(',');if(comma<0)throw new Error('The selected Brand Image has an invalid format.');return {mimeType:blob.type,data:dataUrl.slice(comma+1)};}
/** @param {boolean} loading */
function setAIVideoLoading(loading){
  aiVideoRunning=loading;
  const btn=aiVideoEl('generateAIVideoBtn');
  if(btn){btn.disabled=loading;btn.textContent=loading?'Video wordt gegenereerd...':'Genereer mijn video';}
  setAdGenerationState(loading);
  if(loading){
    aiVideoEl('outputMeta').textContent='AI Video — in progress';
    const results=aiVideoEl('resultsArea');
    if(results)results.innerHTML='<div role="status">AI Video in progress. Waiting for the existing request or submission response...</div>';
  }
}
function clearAIVideoPolling(){if(aiVideoPollTimer){clearTimeout(aiVideoPollTimer);aiVideoPollTimer=0;}}
/** @param {string} message */
function showAIVideoError(message){
  showAIVideoRecovery(message,'AI Video mislukt',false);
}
/** @param {string} message @param {string} title @param {boolean} canResume */
function showAIVideoRecovery(message,title='AI Video — monitoring interrupted',canResume=true){
  const results=aiVideoEl('resultsArea');
  const resume=canResume&&aiVideoOperation?'<button type="button" class="card-dl-btn" onclick="resumeAIVideo()">Check existing request / Retry preview</button>':'';
  const newRequest='<button type="button" class="card-dl-btn" onclick="generateAIVideo(true)">New paid video (confirmation required)</button>';
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
  if(error){error.hidden=false;error.textContent=message+' Retry preview or use Download MP4 to play the file.';}
  aiVideoEl('outputMeta').textContent='AI Video — completed, preview unavailable';
}
/** @param {string} operation */
async function showAIVideoPreview(operation){
  clearAIVideoUrl();
  aiVideoUrl='/.netlify/functions/download-veo-video?operation='+encodeURIComponent(operation);
  const previewMode=aiVideoRequestedRatio==='9:16'?'portrait':'landscape';
  const results=aiVideoEl('resultsArea');
  results.innerHTML=`<div class="video-result ai-video-result">
    <div id="aiVideoFrame" class="ai-video-frame ai-video-frame-${previewMode}">
      <video id="aiVideoPreview" class="video-preview" controls muted loop playsinline preload="metadata" aria-label="AI Video preview"></video>
    </div>
    <p id="aiVideoPreviewError" class="error-box" role="alert" hidden></p><p class="ai-video-title">AI Video</p>
    <div class="button-row">
      <a id="aiVideoDownload" class="card-dl-btn" href="${aiVideoUrl}" download="spectron-ai-video.mp4">Download MP4</a>
      <button type="button" id="aiVideoAgain" class="card-dl-btn">Generate Again (new paid request)</button>
      <button type="button" class="card-dl-btn" onclick="resumeAIVideo()">Retry preview</button>
    </div></div>`;
  const video=aiVideoEl('aiVideoPreview');
  video.controls=true;video.muted=true;video.loop=true;video.playsInline=true;video.preload='metadata';
  video.dataset.previewRatio=previewMode;
  video.addEventListener('loadedmetadata',()=>{
    sizeAIVideoPreview();
    console.info('[ai-video] preview dimensions',video.videoWidth,video.videoHeight,'ratio',video.videoWidth&&video.videoHeight?(video.videoWidth/video.videoHeight).toFixed(3):'unknown');
  });
  video.onerror=()=>showAIVideoPreviewError('Video preview could not be loaded on this browser.');
  aiVideoEl('aiVideoAgain').onclick=()=>generateAIVideo(true);
  aiVideoEl('outputMeta').textContent='AI Video — completed';
  try{
    const videoResponse=await fetch(aiVideoUrl);
    const videoBlob=await readAIVideoDownload(videoResponse);
    aiVideoPreviewUrl=URL.createObjectURL(videoBlob);
    video.src=aiVideoPreviewUrl;video.load();
  }catch(previewError){showAIVideoPreviewError(previewError.message||AI_VIDEO_SERVER_ERROR);}
  setAIVideoLoading(false);sizeAIVideoPreview();
}
/** @param {string} operation */
async function pollAIVideo(operation){
  if(!aiVideoRunning)return;
  if(Date.now()-aiVideoPollStarted>=420000){
    clearAIVideoPolling();setAIVideoLoading(false);
    showAIVideoRecovery('Monitoring stopped after seven minutes. Google may still be working. Check the existing request again.');
    return;
  }
  try{
    const response=await fetch('/.netlify/functions/veo-video-status?operation='+encodeURIComponent(operation));
    const result=await readAIVideoJSON(response,'/.netlify/functions/veo-video-status');
    if(!['pending','failed','completed','unknown'].includes(result.state))throw new Error(AI_VIDEO_SERVER_ERROR);
    if(result.state==='pending'){
      aiVideoEl('outputMeta').textContent='AI Video — pending';
      aiVideoPollTimer=setTimeout(()=>pollAIVideo(operation),10000);return;
    }
    clearAIVideoPolling();
    if(result.state==='completed'&&result.outputAvailable!==false){await showAIVideoPreview(operation);return;}
    setAIVideoLoading(false);
    if(result.state==='failed'){
      showAIVideoError((result.message||'Google reported that the video request failed.')+' '+AI_VIDEO_RETRY_WARNING);return;
    }
    if(result.state==='completed'){
      showAIVideoRecovery(result.message||'Google reports completion, but the video output is unavailable or unrecognised.','AI Video — completed, output unavailable');return;
    }
    showAIVideoRecovery('The status of this existing request could not be determined. Check again; no new video has been started.');
  }catch(error){
    clearAIVideoPolling();setAIVideoLoading(false);
    showAIVideoRecovery('Monitoring interrupted. Google may still be working. '+(error instanceof TypeError?'The video service could not be reached.':error.message||AI_VIDEO_SERVER_ERROR));
  }
}
let aiVideoConfirmPending=false;
let aiVideoConfirmPreviousFocus=null;
function closeAIVideoConfirm(confirmed){const modal=aiVideoEl('aiVideoConfirmModal');const confirmButton=aiVideoEl('aiVideoConfirmButton');if(modal)modal.hidden=true;if(confirmButton&&!confirmed){confirmButton.disabled=false;confirmButton.textContent='Generate video';}const previous=aiVideoConfirmPreviousFocus;aiVideoConfirmPreviousFocus=null;aiVideoConfirmPending=false;previous?.focus?.();if(window.__aiVideoConfirmResolve){const resolve=window.__aiVideoConfirmResolve;window.__aiVideoConfirmResolve=null;resolve(confirmed);}}
function requestAIVideoConfirmation(){if(aiVideoConfirmPending)return Promise.resolve(false);const modal=aiVideoEl('aiVideoConfirmModal');const confirmButton=aiVideoEl('aiVideoConfirmButton');const cancelButton=aiVideoEl('aiVideoCancelButton');if(!modal||!confirmButton||!cancelButton)return Promise.resolve(false);const warning=aiVideoEl('aiVideoRetryWarning');if(warning)warning.hidden=!aiVideoMayHaveStarted;aiVideoConfirmPending=true;aiVideoConfirmPreviousFocus=document.activeElement;modal.hidden=false;confirmButton.disabled=false;confirmButton.textContent='Generate video';confirmButton.focus();return new Promise(resolve=>{window.__aiVideoConfirmResolve=resolve;confirmButton.onclick=()=>{confirmButton.disabled=true;confirmButton.textContent='Starting video...';closeAIVideoConfirm(true);};cancelButton.onclick=()=>closeAIVideoConfirm(false);modal.onclick=event=>{if(event.target===modal)closeAIVideoConfirm(false);};});}
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&!aiVideoEl('aiVideoConfirmModal')?.hidden)closeAIVideoConfirm(false);});
/** @param {boolean} newRequest Require a separate confirmation instead of resuming. */
async function generateAIVideo(newRequest=false){
  if(aiVideoRunning||aiVideoConfirmPending)return;
  if(aiVideoOperation&&!newRequest){await resumeAIVideo();return;}
  if(!selectedImage){const empty=aiVideoEl('aiVideoNoImage');if(empty)empty.hidden=false;return;}
  const empty=aiVideoEl('aiVideoNoImage');if(empty)empty.hidden=true;
  const confirmed=await requestAIVideoConfirmation();
  if(!confirmed||aiVideoRunning)return;
  clearAIVideoPolling();setAIVideoLoading(true);
  let submitting=false;
  try{
    const ratio=aiVideoEl('aiVideoAspect').value;
    if(!['9:16','16:9'].includes(ratio))throw new Error('Choose portrait 9:16 or landscape 16:9.');
    const image=await normalizeAIVideoImage(ratio);
    const prompt=aiVideoEl('aiVideoPrompt').value.trim();
    if(!prompt)throw new Error('Enter an AI Video prompt.');
    aiVideoRequestedRatio=ratio;aiVideoOperation='';aiVideoMayHaveStarted=true;
    saveAIVideoRecovery();submitting=true;
    const response=await fetch('/.netlify/functions/start-veo-video',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:`data:${image.mimeType};base64,${image.data}`,prompt,aspectRatio:ratio})});
    const result=await readAIVideoJSON(response,'/.netlify/functions/start-veo-video');
    if(typeof result.operation!=='string'||!AI_VIDEO_OPERATION_PATTERN.test(result.operation))throw new Error(AI_VIDEO_SERVER_ERROR);
    aiVideoOperation=result.operation;saveAIVideoRecovery();
    aiVideoPollStarted=Date.now();
    aiVideoEl('outputMeta').textContent='AI Video — pending';
    aiVideoPollTimer=setTimeout(()=>pollAIVideo(result.operation),10000);
  }catch(error){
    setAIVideoLoading(false);
    const message=error instanceof TypeError?'The video service could not be reached.':error.message||AI_VIDEO_SERVER_ERROR;
    if(submitting)showAIVideoRecovery(message+' No operation ID was received; the submission outcome is unconfirmed. '+AI_VIDEO_RETRY_WARNING);
    else showAIVideoRecovery(message,'AI Video — input needs attention',false);
  }
}
window.addEventListener('pagehide',()=>{clearAIVideoPolling();clearAIVideoUrl();});
window.addEventListener('load',()=>{const p=aiVideoEl('aiVideoPrompt');if(p&&!p.value)p.value=DEFAULT_AI_VIDEO_PROMPT;updateVideoMode();restoreAIVideoRecovery();});


