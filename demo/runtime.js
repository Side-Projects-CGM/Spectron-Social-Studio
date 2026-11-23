(() => {
  const workspace = new URL(location.href).searchParams.get('workspace');
  if (!/^[a-f0-9-]{36}$/.test(workspace || '') || window.parent === window) throw new Error('Open de demo via de presenterpagina.');
  window.demoStoragePrefix = `studio-demo:${workspace}:`;
  const originalFetch = window.fetch.bind(window);
  const actions = {'video-reference-upload':'references','generate':'text','generate-ai-image':'image','start-veo-video':'video','veo-video-status':'status','download-veo-video':'download'};
  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url,location.href);
    if(url.origin !== location.origin || !url.pathname.startsWith('/.netlify/functions/')) return originalFetch(input,options);
    const action = actions[url.pathname.split('/').pop()];
    if(!action) throw new Error('Deze functie is niet beschikbaar in de demo.');
    return originalFetch('/.netlify/functions/demo-api', {method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',
      signal:options.signal,body:JSON.stringify({action,workspace,operation:url.searchParams.get('operation'),input:options.body ? JSON.parse(options.body) : undefined})});
  };
  // A persisted library must remain reachable after refresh, even with no selected upload/output.
  document.addEventListener('DOMContentLoaded',()=>{
    const library=document.getElementById('savedLibrary');
    const count=document.getElementById('savedCount');
    document.getElementById('workspaceCanvas').append(library);
    const sync=()=>{const hidden=Number(count.textContent)===0;if(library.hidden!==hidden)library.hidden=hidden;};
    new MutationObserver(sync).observe(count,{childList:true,subtree:true,characterData:true});
    new MutationObserver(sync).observe(library,{attributes:true,attributeFilter:['hidden']});
    sync();
  });
  // Downloads also pass through ownership checks; never expose a provider URI or cookie in a URL.
  document.addEventListener('click',async event=>{
    const link=event.target.closest('a[href*="/.netlify/functions/download-veo-video"]');
    if(!link)return;
    event.preventDefault();
    try {
      const response=await window.fetch(link.href);
      if(!response.ok)throw new Error('Download niet beschikbaar in deze demosessie.');
      const blob=await response.blob(); const url=URL.createObjectURL(blob);
      const download=document.createElement('a');download.href=url;download.download='social-studio-video.mp4';download.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch(error) { document.getElementById('studioStatus').textContent=error.message; }
  },true);
})();
