// Local animation: reuse the shared advertisement DOM and canvas image helpers.
let animatedVideoJob = null;
let animatedVideoUrl = null;
let animatedVideoSource = null;

function videoMimeType(){
  if(!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return '';
  return ['video/mp4;codecs=avc1','video/mp4','video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm']
    .find(type => MediaRecorder.isTypeSupported(type)) || '';
}
function releaseVideoRecording(job){
  cancelAnimationFrame(job.frame);
  clearTimeout(job.timeout);
  if(job.recorder){
    job.recorder.ondataavailable = job.recorder.onerror = job.recorder.onstop = null;
    if(job.recorder.state !== 'inactive') { try{ job.recorder.stop(); }catch{} }
  }
  job.stream?.getTracks().forEach(track => track.stop());
  job.stream=null;
  if(typeof canvasResizeObserver !== 'undefined') job.stage?.querySelectorAll('.canvas').forEach(canvas=>canvasResizeObserver.unobserve(canvas));
  job.stage?.remove();
  job.stage=null;
  job.recorder=null;
}
function cleanupAnimatedVideo(){
  const job = animatedVideoJob;
  if(job){
    job.cancelled = true;
    job.reject?.(new Error('Videogeneratie geannuleerd.'));
    releaseVideoRecording(job);
    animatedVideoJob = null;
    setAdGenerationState(false);
  }
  const preview = document.getElementById('animatedVideoPreview');
  if(preview){ preview.pause(); preview.removeAttribute('src'); preview.load(); }
  if(animatedVideoUrl){ URL.revokeObjectURL(animatedVideoUrl); animatedVideoUrl = null; }
}
function updateVideoMode(){
  const video = document.getElementById('outputType').value === 'video';
  document.getElementById('videoOptions').hidden = !video;
  if(!video){
    cleanupAnimatedVideo();
    if(document.getElementById('animatedVideoPreview')) document.getElementById('resultsArea').replaceChildren();
  }
}
function videoMotion(style, progress, visual){
  const p = Math.max(0, Math.min(1, progress));
  const base = Math.max(1, visual.imgScale);
  const position = {scale:base, x:visual.imgPosX, y:visual.imgPosY};
  if(style === 'zoom-in') position.scale *= 1 + p * .06;
  if(style === 'zoom-out') position.scale *= 1 + (1-p) * .06;
  // A small additional crop gives even square images room to pan without blank edges.
  if(style === 'pan-right' || style === 'pan-left'){
    position.scale *= 1.06;
    const direction = style === 'pan-right' ? -1 : 1;
    position.x = Math.max(0,Math.min(100,position.x + direction * (p-.5) * 10));
  }
  return position;
}
function checkVideoJob(job){ if(job.cancelled) throw new Error('Videogeneratie geannuleerd.'); }
function recordAnimatedCanvas(job, canvas, drawFrame, seconds, mimeType){
  return new Promise((resolve,reject) => {
    job.reject = reject;
    try{
      drawFrame(0);
      job.stream = canvas.captureStream(30);
      const recorder = job.recorder = new MediaRecorder(job.stream,{mimeType,videoBitsPerSecond:6000000});
      const chunks = [];
      recorder.ondataavailable = event => { if(event.data.size) chunks.push(event.data); };
      recorder.onerror = () => reject(new Error('De video-opname is mislukt. Probeer het opnieuw of kies Afbeelding.'));
      recorder.onstop = () => {
        const blob = new Blob(chunks,{type:recorder.mimeType || mimeType});
        if(!blob.size) reject(new Error('Er is geen video opgenomen. Probeer het opnieuw.'));
        else resolve(blob);
      };
      recorder.start(100);
      const started = performance.now();
      
      function frame(now){
        try{
          checkVideoJob(job);
          const progress = Math.min(1,(now-started)/(seconds*1000));
          drawFrame(progress);
          if(progress < 1) job.frame = requestAnimationFrame(frame);
          else recorder.stop();
        }catch(error){ reject(error); }
      }
      job.frame = requestAnimationFrame(frame);
      job.timeout = setTimeout(()=>reject(new Error('De opname duurde te lang. Houd dit tabblad zichtbaar en probeer het opnieuw.')),seconds*1000+10000);
    }catch(error){ reject(error); }
  });
}
async function ensureVideoCapture(){
  if(!window.html2canvas){
    await new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      script.onload=resolve;script.onerror=()=>reject(new Error('De beeldopname kon niet worden geladen. Probeer het opnieuw.'));
      document.head.appendChild(script);
    });
  }
}
async function generateAnimatedAd(){
  if(adGenerationInProgress) return;
  const brand=document.getElementById('brand').value;
  const platform=document.getElementById('platform').value;
  const format=getFormatSpec(platform);
  const seconds=Number(document.getElementById('videoDuration').value);
  const motion=document.getElementById('videoMotion').value;
  const image=selectedImage;
  const key=JSON.stringify([brand,platform,format.value]);
  // Capture the selected design before replacing old results with progress.
  const existing=document.querySelector(`#cardVisual-${selectedVariantIndex} .canvas`);
  if(existing && currentBrand===brand && currentPlatform===platform && currentFormat===format.value){
    animatedVideoSource={key,node:existing.cloneNode(true),width:existing.clientWidth,
      visual:structuredClone(variantVisuals[selectedVariantIndex])};
  }
  cleanupAnimatedVideo();
  const job=animatedVideoJob={cancelled:false};
  setAdGenerationState(true);
  try{
    const mime=videoMimeType();
    if(!mime) throw new Error('Deze browser ondersteunt geen video-opname. Kies Afbeelding of probeer Chrome of Edge.');
    if(!brand || !image) throw new Error('Selecteer eerst een merk en een merkbeeld.');
    if(![3,4,5].includes(seconds)) throw new Error('Kies een duur van 3, 4 of 5 seconden.');
    if(!['zoom-in','zoom-out','pan-right','pan-left'].includes(motion)) throw new Error('Kies een ondersteunde bewegingsstijl.');
    if(!format.width || !format.height || PLATFORM_LIMITS[platform]?.mock!=='social') throw new Error('Kies voor video een Instagram-/Facebook-bericht, verhaal of TikTok-formaat. Afbeeldingen genereren blijft beschikbaar voor dit formaat.');
    const stage=job.stage=document.createElement('div');
    stage.style.cssText='position:fixed;left:-10000px;top:0;width:320px;pointer-events:none;';
    stage.setAttribute('aria-hidden','true');stage.inert=true;
    document.body.appendChild(stage);
    let visual;
    if(animatedVideoSource?.key===key){
      stage.className='mock-social';
      stage.style.width=(animatedVideoSource.width || 320)+'px';
      stage.append(animatedVideoSource.node.cloneNode(true));
      visual=structuredClone(animatedVideoSource.visual);
    }else{
      visual={imgScale,imgPosX,imgPosY,textScale};
      const variants=currentBrand===brand && currentVariants.length
        ? [structuredClone(currentVariants[selectedVariantIndex] || currentVariants[0])]
        : generateOffline(brand,`${brand} collectie`,platform,document.getElementById('tone').value,getSelectedUSPs(),document.getElementById('promo').value.trim(),1);
      currentBrand=brand;
      renderResults(variants.slice(0,1),platform,`${brand} collectie`,false,stage);
      variantVisuals[0]=structuredClone(visual);
      applyImageTransform(0);applyTextScale(0);
      const generated=stage.querySelector('.canvas');
      animatedVideoSource={key,node:generated.cloneNode(true),width:generated.clientWidth,visual:structuredClone(visual)};
    }
    document.getElementById('imgAdjust').style.display='none';
    document.getElementById('downloadAllBtn').style.display='none';
    const design=stage.querySelector('.canvas');
    design.style.background='transparent';
    design.querySelector('.product-img').style.visibility='hidden';
    await ensureVideoCapture();checkVideoJob(job);
    if(document.fonts?.ready) await document.fonts.ready;
    const photo=await loadCanvasImage(image);checkVideoJob(job);
    const overlay=await window.html2canvas(design,{backgroundColor:null,scale:format.width/design.clientWidth,useCORS:true});
    checkVideoJob(job);
    const canvas=document.createElement('canvas');canvas.width=format.width;canvas.height=format.height;
    const ctx=canvas.getContext('2d');
    const blob=await recordAnimatedCanvas(job,canvas,progress=>{
      ctx.clearRect(0,0,canvas.width,canvas.height);
      const position=videoMotion(motion,progress,visual);
      drawCoverImage(ctx,photo,canvas.width,canvas.height,position.scale,position.x,position.y);
      ctx.drawImage(overlay,0,0,canvas.width,canvas.height);
    },seconds,mime);
    checkVideoJob(job);
    animatedVideoUrl=URL.createObjectURL(blob);
    const extension=blob.type.startsWith('video/mp4')?'mp4':'webm';
    const results=document.getElementById('resultsArea');
    results.innerHTML=`<div class="video-result"><video id="animatedVideoPreview" class="video-preview" autoplay muted loop playsinline controls aria-label="Voorbeeld van bewegende advertentie"></video><a id="animatedVideoDownload" class="card-dl-btn">Video downloaden (${extension.toUpperCase()})</a></div>`;
    const preview=document.getElementById('animatedVideoPreview');
    preview.muted=true;preview.src=animatedVideoUrl;preview.play()?.catch(()=>{});
    const download=document.getElementById('animatedVideoDownload');
    download.href=animatedVideoUrl;download.download=`${brand}-${format.value}-${seconds}s.${extension}`;
    document.getElementById('outputMeta').textContent=`${seconds} seconden · ${format.width} × ${format.height} · ${extension.toUpperCase()}`;
  }catch(error){
    if(!job.cancelled){
      document.getElementById('resultsArea').innerHTML=`<div class="error-box" role="alert">${escapeHtml(error.message)} <button type="button" class="card-dl-btn" onclick="generateAds()">Opnieuw proberen</button></div>`;
      document.getElementById('outputMeta').textContent='Video mislukt';
      if(animatedVideoUrl){URL.revokeObjectURL(animatedVideoUrl);animatedVideoUrl=null;}
    }
  }finally{
    releaseVideoRecording(job);
    if(animatedVideoJob===job){animatedVideoJob=null;setAdGenerationState(false);}
  }
}
window.addEventListener('pagehide',()=>{cleanupAnimatedVideo();animatedVideoSource=null;});
updateVideoMode();
