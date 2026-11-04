// Saved creatives live in IndexedDB: image uploads can exceed localStorage limits.
const AD_CHANNELS = [
  {label:'Facebook', platform:'Instagram / Facebook post', format:'1080x1080'},
  {label:'Instagram Post', platform:'Instagram / Facebook post', format:'1080x1350'},
  {label:'Instagram Story', platform:'Instagram / Facebook story', format:'1080x1920'},
  {label:'TikTok', platform:'TikTok', format:'1080x1920'}
];
let savedAds = [], duplicateSource = null, duplicateBusy = false;
const adDatabase = new Promise((resolve, reject) => {
  const request = indexedDB.open('spectron-saved-ads', 2);
  request.onupgradeneeded = () => {
    const db = request.result;
    if(!db.objectStoreNames.contains('ads')) db.createObjectStore('ads', {keyPath:'id'});
    if(!db.objectStoreNames.contains('brandImages')) db.createObjectStore('brandImages', {keyPath:'id'});
  };
  request.onsuccess = () => {
    request.result.onversionchange = () => request.result.close();
    resolve(request.result);
  };
  request.onblocked = () => studioNotice('Sluit andere Spectron-tabbladen om de beeldbibliotheek bij te werken.');
  request.onerror = () => reject(request.error);
});
function studioNotice(message){ document.getElementById('studioStatus').textContent = message; }
async function persistAds(ads){
  const db = await adDatabase;
  await new Promise((resolve, reject) => {
    const tx = db.transaction('ads', 'readwrite');
    tx.oncomplete = resolve;
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('Opslaan mislukt'));
    ads.forEach(ad => tx.objectStore('ads').put(ad));
  });
  await refreshSavedAds();
}
function snapshotAd(idx){
  const image = document.querySelector(`#cardVisual-${idx} .product-img`);
  const existing = savedAds.find(ad => ad.id === currentVariants[idx]._savedId);
  return {...existing, id:currentVariants[idx]._savedId || crypto.randomUUID(),
    variant:structuredClone(currentVariants[idx]), brand:currentBrand,
    product:currentProduct, platform:currentPlatform, format:currentFormat,
    label:existing?.platform === currentPlatform && existing?.format === currentFormat ? existing.label : undefined,
    image:image ? image.getAttribute('src') : selectedImage,
    gradientDarkness, visual:structuredClone(variantVisuals[idx]), savedAt:new Date().toISOString()};
}
async function saveAd(idx){
  try{
    const ad = snapshotAd(idx);
    await persistAds([ad]);
    currentVariants[idx]._savedId = ad.id;
    studioNotice('Advertentie opgeslagen in deze browser.');
  }catch(e){ studioNotice('Opslaan mislukt. Controleer of browseropslag beschikbaar is en probeer opnieuw.'); }
}
function showDuplicate(idx){
  if(duplicateBusy) return;
  duplicateSource = snapshotAd(idx);
  document.getElementById('duplicateChoices').innerHTML = AD_CHANNELS.map((c,i) =>
    `<label class="duplicate-choice"><input type="checkbox" value="${i}" onchange="updateDuplicateCount()"> ${c.label} <small>${c.format.replace('x',' × ')}</small></label>`).join('');
  updateDuplicateCount();
  document.getElementById('duplicateStatus').textContent = '';
  document.getElementById('duplicateDialog').showModal();
}
function updateDuplicateCount(){
  const count = document.querySelectorAll('#duplicateChoices input:checked').length;
  const btn = document.getElementById('confirmDuplicate');
  btn.disabled = duplicateBusy || count < 2;
  btn.textContent = `${count} advertenties maken en opslaan`;
}
async function confirmDuplicate(){
  const choices = [...document.querySelectorAll('#duplicateChoices input:checked')];
  if(duplicateBusy || choices.length < 2 || choices.length > 4 || !duplicateSource) return;
  duplicateBusy = true;
  const btn = document.getElementById('confirmDuplicate');
  btn.disabled = true;
  document.getElementById('duplicateStatus').textContent = 'Advertenties opslaan…';
  const batchId = crypto.randomUUID();
  const ads = choices.map(input => {
    const channel = AD_CHANNELS[Number(input.value)];
    const ad = structuredClone(duplicateSource);
    Object.assign(ad, channel, {id:crypto.randomUUID(), batchId, savedAt:new Date().toISOString()});
    delete ad.variant._savedId;
    return ad;
  });
  try{
    await persistAds(ads);
    document.getElementById('duplicateDialog').close();
    studioNotice(`${ads.length} advertenties gemaakt en opgeslagen. Open een voorbeeld om te bewerken.`);
    document.getElementById('savedLibrary').scrollIntoView({behavior:'smooth'});
  }catch(e){ document.getElementById('duplicateStatus').textContent = 'Opslaan kon niet worden bevestigd. Controleer de opgeslagen advertenties voordat je opnieuw probeert.'; }
  finally{ duplicateBusy = false; updateDuplicateCount(); }
}
function toggleSavedAds(){
  const panel = document.getElementById('savedAdsPanel');
  panel.hidden = !panel.hidden;
  document.getElementById('savedLibraryToggle').setAttribute('aria-expanded', String(!panel.hidden));
  document.getElementById('savedLibraryChevron').textContent = panel.hidden ? '\u25be' : '\u25b4';
}
async function refreshSavedAds(){
  const db = await adDatabase;
  savedAds = await new Promise((resolve,reject) => {
    const req = db.transaction('ads').objectStore('ads').getAll();
    req.onsuccess = () => resolve(req.result.sort((a,b) => b.savedAt.localeCompare(a.savedAt)));
    req.onerror = () => reject(req.error);
  });
  const grid = document.getElementById('savedAds');
  if(typeof canvasResizeObserver !== 'undefined'){
    grid.querySelectorAll('.saved-preview').forEach(preview => canvasResizeObserver.unobserve(preview));
  }
  grid.replaceChildren();
  document.getElementById('savedCount').textContent = savedAds.length;
  for(const ad of savedAds){
    const item = document.createElement('article');
    item.className = 'saved-ad';
    const title = document.createElement('h3');
    title.textContent = `${ad.label || ad.platform} · ${ad.format.replace('x',' × ')}`;
    const preview = document.createElement('div');
    preview.className = 'saved-preview';
    preview.style.setProperty('--gradient-darkness', String(normalizeGradientDarkness(ad.gradientDarkness) / 100));
    const [w,h] = ad.format.split('x').map(Number);
    preview.style.aspectRatio = w && h ? `${w}/${h}` : '1';
    if(ad.image){
      const img = document.createElement('img'); img.src = ad.image; img.alt = ad.product || ad.brand;
      img.style.objectPosition = `${ad.visual.imgPosX}% ${ad.visual.imgPosY}%`;
      const v = ad.visual;
      img.style.transform = `translate(${(50-v.imgPosX)*(v.imgScale-1)}%,${(50-v.imgPosY)*(v.imgScale-1)}%) scale(${v.imgScale})`;
      preview.append(img);
    }
    const shade = document.createElement('div'); shade.className = 'saved-shade'; preview.append(shade);
    const headline = document.createElement('strong'); headline.textContent = ad.variant.headline;
    headline.setAttribute('data-headline-size', String(18 * ad.visual.textScale));
    headline.style.fontSize = `${18 * ad.visual.textScale}px`;
    if(h/w > 1.5){ preview.classList.add('saved-vertical'); }
    preview.append(headline);
    const body = document.createElement('p'); body.textContent = ad.variant.body;
    const cta = document.createElement('p'); cta.textContent = ad.variant.cta;
    const button = document.createElement('button'); button.className = 'card-dl-btn'; button.textContent = 'Openen en bewerken';
    button.onclick = () => openSavedAd(ad.id);
    const actions = document.createElement('div'); actions.className = 'library-actions'; actions.append(button);
    item.append(title,preview,body,cta,actions); grid.append(item);
    if(typeof fitSavedPreviewText === 'function') fitSavedPreviewText(preview);
    if(typeof canvasResizeObserver !== 'undefined') canvasResizeObserver.observe(preview);
  }
}
function openSavedAd(id){
  const ad = savedAds.find(a => a.id === id);
  if(!ad) return;
  document.getElementById('brand').value = ad.brand;
  document.getElementById('platform').value = ad.platform;
  updateFormatOptions(); document.getElementById('format').value = ad.format;
  currentBrand = ad.brand;
  renderImageGallery();
  selectedImage = ad.image;
  applyGradientDarkness(normalizeGradientDarkness(ad.gradientDarkness));
  if(typeof syncBackgroundImage === 'function') syncBackgroundImage();
  renderResults([{...structuredClone(ad.variant),_savedId:ad.id}], ad.platform, ad.product, false);
  variantVisuals[0] = structuredClone(ad.visual);
  selectVariant(0); applyImageTransform(); applyTextScale();
  document.getElementById('outputMeta').textContent = `${ad.label || ad.platform} · opgeslagen advertentie`;
  document.getElementById('resultsArea').scrollIntoView({behavior:'smooth'});
}
async function copyAdText(idx){
  const v = currentVariants[idx];
  try{
    await navigator.clipboard.writeText([v.headline,v.body,v.cta,(v.hashtags || []).map(h=>'#'+h.replace(/^#/,'')).join(' ')].filter(Boolean).join('\n\n'));
    studioNotice('Tekst gekopieerd.');
  }catch(e){ studioNotice('Kopiëren niet toegestaan. Geef klembordtoegang of selecteer en kopieer de tekst handmatig.'); }
}
refreshSavedAds().catch(() => studioNotice('Browseropslag is niet beschikbaar. Opgeslagen advertenties kunnen niet worden geladen.'));

// Brand images share the existing IndexedDB database with saved advertisements.
async function refreshBrandImages(){
  const db = await adDatabase;
  const records = await new Promise((resolve,reject) => {
    const request = db.transaction('brandImages').objectStore('brandImages').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  brandImageRecords = records.sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  renderImageGallery();
}
async function persistBrandImage(record){
  const db = await adDatabase;
  const saved = await new Promise((resolve,reject) => {
    // The read and write share a transaction, so repeated accepts cannot insert duplicates.
    const tx = db.transaction('brandImages','readwrite');
    const store = tx.objectStore('brandImages');
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('Opslaan mislukt'));
    const request = store.getAll();
    request.onsuccess = () => {
      result = request.result.find(item => item.brand === record.brand && item.image === record.image);
      if(!result) { result = record; store.put(record); }
    };
  });
  // Update the existing gallery model only after the transaction commits.
  if(!brandImageRecords.some(item => item.id === saved.id)) brandImageRecords.unshift(saved);
  return saved;
}
refreshBrandImages().catch(() => studioNotice('Merkbeelden konden niet worden geladen. Controleer browseropslag en vernieuw de pagina.'));
