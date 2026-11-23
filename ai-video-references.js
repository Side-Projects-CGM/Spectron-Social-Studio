// Video-only slots. Brand/advertisement uploads and submitted image bytes stay unchanged.
// Three is a provisional application cap, not a documented Omni 1.1 maximum.
(() => {
  const MAX_IMAGES = 3;
  const MAX_BYTES = 4 * 1024 * 1024;
  const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  let references = [null, null, null];
  let selectedSource = null;
  let reading = false;
  let locked = false;
  let version = 0;
  let uploadSlot = null;
  const el = id => document.getElementById(id);

  function showError(message = '') {
    const error = el('aiVideoReferenceError');
    if (error) {error.textContent = message; error.hidden = !message;}
  }

  function syncCanvas() {
    const canvas = el('workspaceVideoImages');
    const preview = el('workspaceImagePreview');
    const product = el('workspaceProductImage');
    if (!canvas || !preview || !product) return;
    const video = activeStudioWorkflow === 'video';
    product.hidden = video;
    canvas.hidden = !video;
    preview.classList.toggle('video-reference-preview', video);
    canvas.replaceChildren();
    if (!video) return;
    canvas.style.setProperty('--video-reference-columns', String(references.filter(Boolean).length || 1));
    references.forEach((reference, index) => {
      if (!reference) return;
      const figure = document.createElement('figure');
      const image = document.createElement('img');
      image.src = reference.source;
      image.alt = `Referentiefoto ${index + 1} op het canvas`;
      const caption = document.createElement('figcaption');
      caption.textContent = `Foto ${index + 1}`;
      figure.append(image, caption);
      canvas.append(figure);
    });
  }

  function revealCanvas() {
    if (activeStudioWorkflow !== 'video') return;
    el('workspaceImagePreview').hidden = !references.some(Boolean);
    el('workspaceOutput').hidden = true;
    el('workspacePlaceholder').hidden = true;
  }

  function chooseSlot(index) {
    if (index < 1 || index >= MAX_IMAGES || locked || reading) return;
    uploadSlot = index;
    el('aiVideoReferenceInput')?.click();
  }

  function render() {
    const list = el('aiVideoReferenceList');
    if (!list) return;
    list.replaceChildren();
    references.forEach((reference, index) => {
      const item = document.createElement('div');
      item.className = 'video-reference-thumb';
      item.dataset.slot = String(index + 1);
      const box = document.createElement(index ? 'button' : 'div');
      box.className = 'video-reference-box';
      if (index) {
        box.type = 'button';
        box.id = `aiVideoReferenceUpload${index}`;
        box.disabled = locked || reading;
        box.setAttribute('aria-label', `${reference ? 'Vervang' : 'Upload'} foto ${index + 1}`);
        box.addEventListener('click', () => chooseSlot(index));
      }
      if (reference) {
        const image = document.createElement('img');
        image.src = reference.source;
        image.alt = `Referentiefoto ${index + 1}`;
        box.append(image);
      } else {
        const plus = document.createElement('span');
        plus.className = 'video-reference-plus';
        plus.textContent = '+';
        plus.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.textContent = index ? 'Upload' : 'Kies een foto';
        box.append(plus, label);
      }
      item.append(box);
      if (index && reference) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'video-reference-remove';
        remove.textContent = '×';
        remove.setAttribute('aria-label', `Verwijder referentiefoto ${index + 1}`);
        remove.disabled = locked || reading;
        remove.addEventListener('click', () => {
          if (locked || reading) return;
          references[index] = null;
          version++;
          showError();
          render();
          revealCanvas();
        });
        item.append(remove);
      }
      list.append(item);
    });
    const count = el('aiVideoReferenceCount');
    if (count) count.textContent = `${references.filter(Boolean).length} van ${MAX_IMAGES} referentiefoto's`;
    const input = el('aiVideoReferenceInput');
    if (input) input.disabled = locked || reading;
    syncCanvas();
  }

  function syncSelectedImage(source) {
    if (source === selectedSource) return;
    selectedSource = source;
    version++;
    uploadSlot = null;
    // A different gallery product/brand must not inherit the old product's photos.
    references = [source ? {source} : null, null, null];
    showError();
    render();
  }

  function getSources() {
    syncSelectedImage(selectedImage);
    if (reading) throw new Error('Wacht tot de referentiefoto’s zijn geladen.');
    const sources = references.filter(Boolean).map(reference => reference.source);
    if (!sources.length) throw new Error('Voeg minstens één referentiefoto toe.');
    return sources;
  }

  async function validateSources(sources) {
    let total = 0;
    for (const source of sources) {
      const response = await fetch(source);
      if (!response.ok) throw new Error('Een referentiefoto kon niet worden geladen.');
      const blob = await response.blob();
      if (!TYPES.includes(blob.type) || !blob.size) throw new Error('Gebruik JPEG-, PNG- of WebP-foto’s.');
      total += blob.size;
      if (total > MAX_BYTES) throw new Error('De referentiefoto’s mogen samen maximaal 4 MiB zijn.');
      const bitmap = await createImageBitmap(blob).catch(() => null);
      if (!bitmap) throw new Error('Een bestand is geen leesbare foto.');
      bitmap.close();
    }
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Een referentiefoto kon niet worden gelezen.'));
      reader.readAsDataURL(file);
    });
  }

  async function addFile(event) {
    const input = event.target;
    const files = Array.from(input.files || []);
    const index = uploadSlot;
    uploadSlot = null;
    input.value = '';
    if (!files.length || index === null || locked || reading) return;
    const selectionVersion = version;
    if (files.length !== 1) {showError('Kies één foto per vak.'); return;}
    const file = files[0];
    if (!TYPES.includes(file.type) || !file.size) {
      showError('Gebruik niet-lege JPEG-, PNG- of WebP-foto’s.');
      return;
    }
    if (file.size > MAX_BYTES) {
      showError('De referentiefoto’s mogen samen maximaal 4 MiB zijn.');
      return;
    }
    reading = true;
    showError();
    render();
    try {
      const source = await readFile(file);
      // Replacing a slot counts its new bytes, not both the old and new photo.
      const sources = references.map((reference, slot) => slot === index ? source : reference?.source).filter(Boolean);
      await validateSources(sources);
      // Ignore a slow upload if the user switched to another product meanwhile.
      if (selectionVersion !== version) return;
      references[index] = {source};
      revealCanvas();
    } catch (error) {
      if (selectionVersion === version) showError(error.message);
    } finally {
      reading = false;
      render();
    }
  }

  window.aiVideoReferences = {
    syncSelectedImage, syncCanvas, getSources, showError,
    setBusy(value) {locked = value; render();}
  };
  window.addEventListener('load', () => {
    el('aiVideoReferenceInput')?.addEventListener('change', addFile);
    syncSelectedImage(selectedImage);
    render();
  });
})();
