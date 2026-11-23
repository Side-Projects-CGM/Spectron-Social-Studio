// Local browser harness only. Never imported by the deployed function.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {randomBytes, createHash} = require('node:crypto');
const {createDemoState} = require('../netlify/lib/demo-state.cjs');
const {createDemoGateway} = require('../netlify/lib/demo-gateway.cjs');
const {build} = require('./build.cjs');
const {createReferenceUploads,UPLOAD_OWNER}=require('../netlify/lib/video-reference-uploads.cjs');

// Single-process, synchronous compare-and-swap. State disappears when this runner stops.
// This is NOT a distributed lock or a substitute for production Blobs verification.
function localStore() {
  const records = new Map(); let version = 0;
  return {
    async get(key) { return structuredClone(records.get(key)?.data || null); },
    async getWithMetadata(key) { return structuredClone(records.get(key) || null); },
    async setJSON(key, data, options = {}) {
      const previous = records.get(key);
      if ((options.onlyIfNew && previous) || (options.onlyIfMatch && options.onlyIfMatch !== previous?.etag)) return {modified:false};
      const etag = String(++version); records.set(key,{data:structuredClone(data),etag});
      return {modified:true,etag};
    },
    async delete(key) { records.delete(key); },
    async *list({prefix='' }={}) {yield {blobs:[...records.keys()].filter(key=>key.startsWith(prefix)).map(key=>({key}))};}
  };
}
function mockText(event) {
  const {prompt} = JSON.parse(event.body);
  const client = /voor merk "([^"]*)"/.exec(prompt || '')?.[1] || 'de klant';
  return {statusCode:200,body:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({variants:Array.from({length:4},(_,i)=>({headline:`Voorbeeld ${i+1}`,body:`${client}: gesimuleerde tekst voor de lokale demo. Geen AI-aanvraag.`,cta:'Ontdek meer',hashtags:['demo']}))})}]}}]})};
}
function mockImage(event) {
  const input = JSON.parse(event.body);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
  // A unique valid PNG: private ancillary chunk before IEND, with a correct CRC.
  const data = createHash('sha256').update(input.image || '').update(randomBytes(16)).digest();
  const type = Buffer.from('deMo'); const body = Buffer.concat([type,data]);
  let crc=0xffffffff;
  for(const byte of body){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  const chunk=Buffer.alloc(12+data.length);chunk.writeUInt32BE(data.length);body.copy(chunk,4);chunk.writeUInt32BE((crc^0xffffffff)>>>0,chunk.length-4);
  const image=Buffer.concat([png.subarray(0,-12),chunk,png.subarray(-12)]).toString('base64');
  return {statusCode:200,body:JSON.stringify({image:`data:image/png;base64,${image}`})};
}
async function serve({live = false, port = 8891, password = process.env.DEMO_PRESENTER_PASSWORD} = {}) {
  const origin=`http://127.0.0.1:${port}`;
  if(live && !process.env.GEMINI_API_KEY)throw new Error('Live text/image mode requires a server-side GEMINI_API_KEY.');
  await build();
  const store=localStore();
  const state=createDemoState({store,password,secret:randomBytes(32).toString('hex'),origin,
    removeInteraction:async()=>{throw new Error('Video is disabled in the local runner');}});
  const gateway=createDemoGateway({stateFactory:()=>state,videoEnabled:()=>false,
    uploadFactory:event=>createReferenceUploads({store,owner:event[UPLOAD_OWNER],environment:'local-demo'}),handlers:{
    text:live ? event=>require('../netlify/functions/generate.js').handler(event) : mockText,
    image:live ? event=>require('../netlify/functions/generate-ai-image.cjs').handler(event) : mockImage
  }});
  const root=path.resolve(__dirname,'../demo-dist');
  const server=http.createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,origin);
      if(url.pathname.startsWith('/.netlify/functions/')) {
        if(url.pathname!=='/.netlify/functions/demo-api'){res.writeHead(404);res.end();return;}
        let size=0;const chunks=[];
        for await(const chunk of req){size+=chunk.length;if(size>28*1024*1024){res.writeHead(413);res.end();return;}chunks.push(chunk);}
        const request=new Request(url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks),duplex:'half'}:{})});
        const result=await gateway(request);
        res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));return;
      }
      const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
      if(!/^[\w.-]+$/.test(file)){res.writeHead(404);res.end();return;}
      const bytes=await fs.readFile(path.join(root,file));
      const mime=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html';
      res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(bytes);
    } catch { if(!res.headersSent)res.writeHead(503);res.end('Local demo request failed.'); }
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return server;
}
module.exports={serve,localStore};
if(require.main===module) {
  const live=process.argv.includes('--live-text-images');
  serve({live}).then(()=>{
    console.log(`Local demo: http://127.0.0.1:8891 (${live?'PAID text/image AI enabled':'MOCK AI, no paid calls'}; video disabled)`);
    console.log('Local quotas/session registry are in memory and restart with the server. Browser libraries persist until reset. Reset before stopping.');
  }).catch(error=>{console.error(error.message);process.exitCode=1;});
}
