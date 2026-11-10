/* Image editing uses the same server-side Gemini key as ad generation. */
let backgroundOriginal = null;
let backgroundAccepted = null;
let backgroundPreview = null;
let backgroundRequest = null;
let backgroundSaving = false;
let backgroundSaveFailed = false;
let backgroundPreviewMetadata = null;
const backgroundFingerprints = new Set();
const BACKGROUND_HISTORY_KEY = 'spectron-ai-background-fingerprints-v1';
try { for(const hash of JSON.parse(localStorage.getItem(BACKGROUND_HISTORY_KEY)||'[]')) if(typeof hash==='string') backgroundFingerprints.add(hash); } catch {}
function clearBackgroundPreview(){
  backgroundRequest?.abort();
  backgroundRequest=null;
  backgroundPreview=null;
  backgroundPreviewMetadata=null;
  backgroundSaveFailed=false;
  renderBackgroundControls();
}
async function backgroundFingerprint(image){
  // Compare image bytes, independent of the MIME label.
  const data=image.slice(image.indexOf(',')+1);
  const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');
}
const backgroundElement = id => document.getElementById(id);
function syncBackgroundImage() {
  if(selectedImage !== backgroundOriginal && (!backgroundAccepted || selectedImage !== backgroundAccepted)) {
    backgroundRequest?.abort();
    backgroundRequest = null;
    backgroundOriginal = selectedImage;
    backgroundAccepted = null;
    backgroundPreview = null;
    backgroundElement('backgroundPanel').hidden = true;
    backgroundElement('backgroundDescription').value = '';
    backgroundElement('backgroundError').textContent = '';
  }
  backgroundElement('backgroundButton').hidden = !selectedImage;
  renderBackgroundControls();
}
function renderBackgroundControls() {
  const busy = !!backgroundRequest || backgroundSaving;
  backgroundElement('backgroundPanel').setAttribute('aria-busy', String(busy));
  backgroundElement('backgroundGenerate').disabled = busy;
  backgroundElement('backgroundGenerate').textContent = busy ? 'Bezig met genereren…' : backgroundPreview ? 'Opnieuw genereren' : 'Genereren';
  backgroundElement('backgroundDescription').disabled = busy;
  backgroundElement('backgroundAccept').disabled = busy || !backgroundPreview;
  backgroundElement('backgroundRestore').disabled = backgroundSaving;
  backgroundElement('backgroundAccept').hidden = !backgroundPreview || !backgroundSaveFailed;
  backgroundElement('backgroundStatus').textContent = busy ? 'Achtergrond wordt gegenereerd…' : '';
  const preview = backgroundElement('backgroundPreview');
  preview.hidden = !backgroundPreview;
  if(backgroundPreview) preview.src = backgroundPreview;
  else preview.removeAttribute('src');
}
function openBackground() {
  syncBackgroundImage();
  if(!selectedImage) return;
  backgroundElement('backgroundPanel').hidden = false;
  backgroundElement('backgroundDescription').focus();
}
async function backgroundImageData(src, signal) {
  const response = await fetch(src, {signal});
  if(!response.ok) throw new Error('De originele afbeelding kon niet worden geladen.');
  const blob = await response.blob();
  if(!['image/png','image/jpeg','image/webp'].includes(blob.type)) throw new Error('Gebruik een PNG-, JPEG- of WebP-afbeelding.');
  if(blob.size > 3 * 1024 * 1024) throw new Error('De afbeelding is te groot (maximaal 3 MB).');
  return new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('De afbeelding kon niet worden gelezen.'));
    reader.readAsDataURL(blob);
  });
}
async function generateBackground() {
  if(backgroundRequest || backgroundSaving) return;
  const error = backgroundElement('backgroundError');
  error.textContent = '';
  backgroundPreview=null;
  backgroundPreviewMetadata=null;
  backgroundSaveFailed=false;
  renderBackgroundControls();
  const description = backgroundElement('backgroundDescription').value.trim();
  if(!selectedImage || !backgroundOriginal) { error.textContent = 'Selecteer eerst een afbeelding.'; return; }
  if(!description || description.length > 1000) { error.textContent = 'Beschrijf de achtergrond (maximaal 1000 tekens).'; return; }
  const metadata = {brand:backgroundElement('brand').value, prompt:description, originalImage:backgroundOriginal, originalImageId:brandImageRecords.find(item => item.image === backgroundOriginal)?.id || null};
  backgroundPreview=null;
  backgroundPreviewMetadata=null;
  const request = new AbortController();
  backgroundRequest = request;
  const timer = setTimeout(() => request.abort(), 65000);
  renderBackgroundControls();
  try {
    const image = await backgroundImageData(backgroundOriginal, request.signal);
    if(request.signal.aborted) throw new Error('Genereren geannuleerd.');
    for(let attempt=0;attempt<2;attempt++) {
      if(request.signal.aborted || backgroundRequest!==request) return;
      const requestId=crypto.randomUUID();
      const response = await fetch('/.netlify/functions/generate-ai-image?requestId='+encodeURIComponent(requestId), {
        method:'POST', cache:'no-store', headers:{'Content-Type':'application/json'}, signal:request.signal,
        body:JSON.stringify({image, description, requestId})
      });
      const result = await response.json();
      if(!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Genereren is mislukt. Probeer opnieuw.');
      if(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(result.image || '')) throw new Error('Geen geldige afbeelding ontvangen. Probeer opnieuw.');
      if(request.signal.aborted || backgroundRequest!==request) return;
      const fingerprint=await backgroundFingerprint(result.image);
      // Include saved results from earlier browser sessions and reject an unchanged source.
      const prior=[backgroundOriginal,...brandImageRecords.filter(item=>item.source==='ai-background').map(item=>item.image)];
      const priorHashes=await Promise.all(prior.filter(src=>/^data:image\//.test(src)).map(backgroundFingerprint));
      const duplicate=backgroundFingerprints.has(fingerprint)||priorHashes.includes(fingerprint);
      if(request.signal.aborted || backgroundRequest!==request) return;
      backgroundFingerprints.add(fingerprint);
      try { localStorage.setItem(BACKGROUND_HISTORY_KEY,JSON.stringify([...backgroundFingerprints])); } catch { throw new Error('De nieuwe afbeelding kon niet veilig worden geregistreerd. Controleer browseropslag en probeer opnieuw.'); }
      if(duplicate) {
        if(attempt===0) continue;
        throw new Error('Gemini gaf opnieuw een eerdere afbeelding terug. Er is geen nieuwe afbeelding gemaakt. Probeer een andere achtergrondbeschrijving.');
      }
      backgroundPreview=result.image;
      backgroundPreviewMetadata=metadata;
      backgroundRequest=null;
      clearTimeout(timer);
      await acceptBackground();
      break;
    }
  } catch(e) {
    if(backgroundRequest === request) error.textContent = request.signal.aborted ? 'Genereren duurde te lang. Probeer opnieuw.' : e instanceof SyntaxError ? 'Ongeldig antwoord van de server. Probeer opnieuw.' : e.message;
  } finally {
    clearTimeout(timer);
    if(backgroundRequest === request) { backgroundRequest = null; renderBackgroundControls(); }
  }
}
function applyBackgroundImage(src) {
  selectImage(src);
  if(typeof syncAIVideoImage === 'function') syncAIVideoImage();
}
async function acceptBackground() {
  if(backgroundRequest || backgroundSaving || !backgroundPreview || !backgroundPreviewMetadata) return;
  const preview = backgroundPreview;
  const original = backgroundOriginal;
  const metadata = backgroundPreviewMetadata;
  backgroundSaving = true;
  backgroundSaveFailed = false;
  backgroundElement('backgroundError').textContent = '';
  backgroundAccepted = preview;
  applyBackgroundImage(preview);
  backgroundPreview = preview;
  backgroundPreviewMetadata = metadata;
  renderBackgroundControls();
  let saved = false;
  try {
    await persistBrandImage({id:crypto.randomUUID(), source:'ai-background', image:preview,
      createdAt:new Date().toISOString(), ...metadata});
    saved = true;
  } catch {
    if(selectedImage === preview && backgroundOriginal === original && backgroundElement('brand').value === metadata.brand){
      backgroundSaveFailed = true;
      backgroundElement('backgroundError').textContent = 'Afbeelding is toegepast, maar kon niet worden opgeslagen. Controleer vrije browseropslag en probeer opslaan opnieuw.';
    }
  } finally {
    backgroundSaving = false;
    renderBackgroundControls();
    if(saved && selectedImage === preview) backgroundElement('backgroundStatus').textContent = 'Nieuwe AI-afbeelding opgeslagen en toegepast.';
  }
}
function restoreBackground() {
  if(backgroundSaving) return;
  backgroundRequest?.abort();
  backgroundRequest = null;
  backgroundPreview = null;
  backgroundElement('backgroundError').textContent = '';
  if(backgroundOriginal) applyBackgroundImage(backgroundOriginal);
  backgroundAccepted = null;
  renderBackgroundControls();
}
syncBackgroundImage();
