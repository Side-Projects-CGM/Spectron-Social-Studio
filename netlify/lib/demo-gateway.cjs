const {DemoError} = require('./demo-state.cjs');
const {DEMO_REQUEST} = require('./demo-context.cjs');
const {UPLOAD_OWNER,UPLOAD_SERVICE,UploadError,uploadRequest} = require('./video-reference-uploads.cjs');
const HEADERS = {'Content-Type':'application/json', 'Cache-Control':'no-store, private', 'X-Content-Type-Options':'nosniff'};
function json(status, body, headers = {}) { return new Response(JSON.stringify(body), {status,headers:{...HEADERS,...headers}}); }
const GENERATIONS = {text:'text',image:'image',video:'video'};

function createDemoGateway({stateFactory, handlers, uploadFactory=null, videoEnabled = () => true}) {
  return async function gateway(request) {
    try {
      if (request.method !== 'POST') return json(405,{error:'Methode niet toegestaan.'},{Allow:'POST'});
      if (!(request.headers.get('content-type') || '').startsWith('application/json')) return json(415,{error:'Gebruik JSON.'});
      const event = {httpMethod:'POST',headers:Object.fromEntries(request.headers),queryStringParameters:{}, [DEMO_REQUEST]:true};
      const state = await stateFactory(event);
      state.checkOrigin(event);
      let input;
      try { input = await request.json(); } catch { return json(400,{error:'Ongeldig verzoek.'}); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) return json(400,{error:'Ongeldig verzoek.'});
      if (input.action === 'login') {
        const cookie = await state.login(event,input.password);
        return json(200,{success:true},{'Set-Cookie':cookie});
      }
      if (input.action === 'session') {
        try { state.authenticate(event); return json(200,{authenticated:true}); }
        catch (error) {
          if (error instanceof DemoError && error.status === 401) return json(200,{authenticated:false});
          throw error;
        }
      }
      const auth = state.authenticate(event);
      if (input.action === 'create') return json(201,{workspace:await state.createWorkspace(auth)});
      const id = input.workspace;
      event[UPLOAD_OWNER]={owner:auth.owner,workspace:id};
      if (input.action === 'reset') {
        const result=await state.reset(auth,id);
        if(uploadFactory)await uploadFactory(event).removeWorkspace();
        return json(200,result);
      }
      await state.workspace(auth,id);
      if(input.action==='references'){
        if(!videoEnabled())return json(403,{error:'Betaalde videogeneratie is uitgeschakeld voor deze demo.'});
        if(!uploadFactory)return json(503,{error:'Foto-uploads zijn niet beschikbaar.'});
        const uploads=uploadFactory(event);event[UPLOAD_SERVICE]=uploads;
        event.body=JSON.stringify(input.input);
        const result=await uploadRequest(event);
        try{await state.workspace(auth,id);}catch(error){await uploads.removeWorkspace();throw error;}
        return response(result);
      }
      if (input.action === 'check') return json(200,{active:true});
      if (input.action === 'status' || input.action === 'download') {
        await state.authorizeOperation(auth,id,input.operation);
        event.httpMethod = 'GET'; event.queryStringParameters.operation = input.operation;
        const result = await handlers[input.action](event);
        await state.workspace(auth,id); // Reject a reset that raced the upstream read.
        if (input.action === 'status' && result.statusCode === 200) {
          const body = JSON.parse(result.body);
          if (['completed','failed'].includes(body.state)) await state.completeVideo(auth,id,input.operation);
        }
        return response(result);
      }
      if (!Object.hasOwn(GENERATIONS,input.action)) return json(400,{error:'Onbekende demoactie.'});
      if (input.action === 'video' && !videoEnabled()) return json(403,{error:'Betaalde videogeneratie is uitgeschakeld voor deze demo.'});
      if (!input.input || typeof input.input !== 'object' || Array.isArray(input.input)) return json(400,{error:'Generatiegegevens ontbreken.'});
      event.body = JSON.stringify(input.input);
      if (event.body.length > 28 * 1024 * 1024) return json(413,{error:'Het verzoek is te groot.'});
      if (input.action === 'text' && (typeof input.input.prompt !== 'string' || input.input.prompt.length > 12000)) return json(400,{error:'Ongeldige tekstbriefing.'});
      if(input.action==='video'&&input.input.upload&&uploadFactory)event[UPLOAD_SERVICE]=uploadFactory(event);
      const ticket = await state.begin(auth,id,GENERATIONS[input.action]);
      let result;
      try { result = await handlers[input.action](event); }
      catch (error) {
        await state.finish(auth,id,ticket); // Unknown video outcome stays locked, not refunded.
        throw error;
      }
      let operation;
      if (input.action === 'video' && result.statusCode === 202) {
        try { operation = JSON.parse(result.body).operation; } catch { /* Treat as unknown. */ }
      }
      // Upload resolution happens before Google. Its explicit rejection is not an unknown paid start.
      let uploadRejected=false;
      if(input.action==='video'){try{uploadRejected=JSON.parse(result.body).category==='invalid-upload';}catch{ /* No reliable rejection marker. */ }}
      // No quota refund; only clear the active-video lock when a start definitely did not happen.
      await state.finish(auth,id,ticket,{operation, definitelyFailed:result.statusCode === 400 || result.statusCode === 413 || uploadRejected});
      return response(result);
    } catch (error) {
      return json(error instanceof DemoError||error instanceof UploadError ? error.status : 503,
        {error:error instanceof DemoError||error instanceof UploadError ? error.message : 'De demoaanvraag kon niet veilig worden afgerond. Probeer de bestaande aanvraag te controleren.'});
    }
  };
}
function response(result) {
  const headers = {...result.headers,'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'};
  if (Buffer.isBuffer(result.body)) {
    let offset = 0;
    const body = new ReadableStream({pull(controller) {
      if (offset >= result.body.length) { controller.close(); return; }
      const end = Math.min(offset + 64 * 1024,result.body.length);
      controller.enqueue(result.body.subarray(offset,end)); offset = end;
    }});
    return new Response(body,{status:result.statusCode,headers});
  }
  return new Response(result.body,{status:result.statusCode,headers});
}
module.exports = {createDemoGateway};
