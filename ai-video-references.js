// Video-only reference selection. Brand/advertisement uploads stay unchanged.
// Three is a provisional application cap, not a documented Omni 1.1 maximum.
(() => {
  const MAX_IMAGES = 3;
  const MAX_BYTES = 4 * 1024 * 1024;
  const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  let references = [];
  let selectedSource = null;
  let reading = false;
  let locked = false;
  let version = 0;
  const el = id => document.getElementById(id);

  function showError(message = '') {
    const error = el('aiVideoReferenceError');
    if (error) {error.textContent = message; error.hidden = !message;}
  }

  function render() {
    const list = el('aiVideoReferenceList');
    if (!list) return;
    list.replaceChildren();
    references.forEach((reference, index) => {
      const item = document.createElement('div');
      item.className = 'video-reference-thumb';
      const image = document.createElement('img');
      image.src = reference.source;
      image.alt = `Referentiefoto ${index + 1}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'video-reference-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Verwijder referentiefoto ${index + 1}`);
      remove.disabled = locked || reading;
      remove.addEventListener('click', () => {
        if (locked || reading) return;
        references.splice(index, 1);
        version++;
        showError();
        render();
      });
      item.append(image, remove);
      list.append(item);
    });
    const count = el('aiVideoReferenceCount');
    if (count) count.textContent = `${references.length} van ${MAX_IMAGES} referentiefoto's`;
    const input = el('aiVideoReferenceInput');
    if (input) input.disabled = locked || reading;
    const add = el('aiVideoReferenceAdd');
    if (add) add.disabled = locked || reading;
  }

  function syncSelectedImage(source) {
    if (source === selectedSource) return;
    selectedSource = source;
    version++;
    // A different gallery product/brand must not inherit the old product's photos.
    references = source ? [{source}] : [];
    showError();
    render();
  }

  function getSources() {
    syncSelectedImage(selectedImage);
    if (reading) throw new Error('Wacht tot de referentiefoto’s zijn geladen.');
    if (!references.length) throw new Error('Voeg minstens één referentiefoto toe.');
    return references.map(reference => reference.source);
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

  async function addFiles(event) {
    const input = event.target;
    const files = Array.from(input.files || []);
    input.value = '';
    if (!files.length || locked || reading) return;
    syncSelectedImage(selectedImage);
    if (references.length + files.length > MAX_IMAGES) {
      showError(`Je kunt maximaal ${MAX_IMAGES} referentiefoto's kiezen.`);
      return;
    }
    if (files.some(file => !TYPES.includes(file.type) || !file.size)) {
      showError('Gebruik niet-lege JPEG-, PNG- of WebP-foto’s.');
      return;
    }
    if (files.reduce((sum, file) => sum + file.size, 0) > MAX_BYTES) {
      showError('De referentiefoto’s mogen samen maximaal 4 MiB zijn.');
      return;
    }
    const selectionVersion = version;
    reading = true;
    showError();
    render();
    try {
      const sources = await Promise.all(files.map(readFile));
      await validateSources([...references.map(reference => reference.source), ...sources]);
      // Ignore a slow upload if the user switched to another product meanwhile.
      if (selectionVersion !== version) return;
      references.push(...sources.map(source => ({source})));
    } catch (error) {
      if (selectionVersion === version) showError(error.message);
    } finally {
      reading = false;
      render();
    }
  }

  window.aiVideoReferences = {
    syncSelectedImage, getSources, showError,
    setBusy(value) {locked = value; render();}
  };
  window.addEventListener('load', () => {
    el('aiVideoReferenceInput')?.addEventListener('change', addFiles);
    el('aiVideoReferenceAdd')?.addEventListener('click', () => el('aiVideoReferenceInput')?.click());
    syncSelectedImage(selectedImage);
    render();
  });
})();
