(() => {
  const $=id=>document.getElementById(id);
  const KEY='studio-demo:workspace';
  let workspace=sessionStorage.getItem(KEY), busy=false;
  const channel = new BroadcastChannel('studio-demo-reset');
  async function api(action, extra={}) {
    const response=await fetch('/.netlify/functions/demo-api',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',body:JSON.stringify({action,workspace,...extra})});
    const data=await response.json();
    if(!response.ok){const error=new Error(data.error||'De demo is niet beschikbaar.');error.status=response.status;throw error;}
    return data;
  }
  function hideWorkspace(){ $('workspaceHost').replaceChildren(); }
  function showWorkspace(){
    hideWorkspace();
    const frame=document.createElement('iframe');frame.title='Social Studio werkruimte';frame.src=`studio.html?workspace=${encodeURIComponent(workspace)}`;
    $('workspaceHost').append(frame);$('resetDemo').hidden=false;$('loginForm').hidden=true;
  }
  async function fresh(){
    workspace=(await api('create')).workspace;sessionStorage.setItem(KEY,workspace);showWorkspace();
  }
  async function start(){
    try {
      if(!(await api('session')).authenticated){
        hideWorkspace();$('loginForm').hidden=false;$('resetDemo').hidden=true;
        $('demoStatus').textContent='Meld je aan om een demosessie te openen.';return;
      }
      if(workspace){await api('check');showWorkspace();} else await fresh();
      $('demoStatus').textContent='Daglimieten: 50 teksten, 30 afbeeldingen en 10 video’s (UTC).';
    }catch(error){
      hideWorkspace();
      if(error.status===401){$('loginForm').hidden=false;$('resetDemo').hidden=true;}
      else if(error.status===410){$('resetDemo').hidden=false;$('demoStatus').textContent='Deze sessie is ingetrokken. Kies Reset demo om de opruiming af te ronden.';return;}
      else if(error.status===404 && workspace){
        // Do not silently abandon an expired workspace's provider resources after logging in again.
        $('resetDemo').hidden=false;$('loginForm').hidden=true;
        $('demoStatus').textContent='Deze demosessie is verlopen of niet beschikbaar. Kies Reset demo om eerst alle gegevens op te ruimen.';return;
      }
      $('demoStatus').textContent=error.message;
    }
  }
  $('loginForm').addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;busy=true;
    try{await api('login',{password:$('password').value});$('password').value='';await start();}
    catch(error){$('demoStatus').textContent=error.message;}
    finally{busy=false;}
  });
  $('resetDemo').onclick=()=>{if(!busy)$('resetDialog').showModal();};
  $('cancelReset').onclick=()=>$('resetDialog').close();
  async function clearBrowser(id){
    const prefix=`studio-demo:${id}:`;
    for(const storage of [localStorage,sessionStorage])for(const key of Object.keys(storage))if(key.startsWith(prefix))storage.removeItem(key);
    await new Promise((resolve,reject)=>{
      const request=indexedDB.deleteDatabase(prefix+'library');
      request.onsuccess=resolve;request.onerror=()=>reject(new Error('Browseropslag kon niet worden verwijderd.'));
      request.onblocked=()=>reject(new Error('Sluit andere tabbladen van deze demosessie en probeer Reset demo opnieuw.'));
    });
  }
  $('confirmReset').onclick=async()=>{
    if(busy)return;busy=true;$('confirmReset').disabled=true;$('resetDialog').close();
    const old=workspace;
    hideWorkspace();channel.postMessage({reset:old});$('demoStatus').textContent='Demosessie wordt opgeruimd…';
    try {
      const result=await api('reset');
      await clearBrowser(old);
      if(!result.complete){$('demoStatus').textContent='De werkruimte is geblokkeerd en browsergegevens zijn gewist. Opruiming bij Google is nog niet bevestigd. Probeer Reset demo later opnieuw; bij een onbekende aanvraag is ondersteuning nodig.';return;}
      sessionStorage.removeItem(KEY);workspace=null;await fresh();
      $('demoStatus').textContent='Demo gereset. Klaar voor de volgende klant. Daglimieten blijven gelden.';
    }catch(error){$('demoStatus').textContent=error.message;}
    finally{busy=false;$('confirmReset').disabled=false;}
  };
  channel.onmessage=event=>{
    if(event.data?.reset===workspace){hideWorkspace();$('demoStatus').textContent='Deze demosessie wordt in een ander tabblad gereset. Sluit dit tabblad.';}
  };
  window.addEventListener('pageshow',event=>{if(event.persisted)void start();});
  void start();
})();
