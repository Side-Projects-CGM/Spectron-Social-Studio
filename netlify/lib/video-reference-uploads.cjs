const {randomUUID, randomBytes, createHash, timingSafeEqual} = require('node:crypto');
const {getStore, connectLambda} = require('@netlify/blobs');
const {namespace} = require('./usage.cjs');
const {MAX_REFERENCE_BYTES, MAX_REFERENCE_IMAGES, parseReferenceImages} = require('./video-references.cjs');
const {DEMO_REQUEST} = require('./demo-context.cjs');
const UPLOAD_SERVICE = Symbol('reference-upload-service');
const UPLOAD_OWNER = Symbol('reference-upload-owner');
const CHUNK_BYTES = 1024 * 1024;
const TTL_MS = 60 * 60 * 1000;
const CLAIM_GRACE_MS = 5 * 60 * 1000;
const ID = /^[a-f0-9-]{36}$/;
const HEX = /^[a-f0-9]{64}$/;
const TYPES = ['image/jpeg','image/png','image/webp'];
const hash = value => createHash('sha256').update(value).digest('hex');
class UploadError extends Error {
  constructor(status, message) {super(message);this.status=status;}
}
function openUploadStore(event) {
  if(event?.blobs)connectLambda(event);
  return getStore({name:'studio-video-reference-uploads',consistency:'strong'});
}
function createReferenceUploads({store, owner=null, client='unknown', environment=namespace(), now=Date.now}={}) {
  const base=`v1/${environment}`;
  const scope=owner?`${base}/demo/${hash(`${owner.owner}:${owner.workspace}`)}`:`${base}/regular`;
  const actor=owner?hash(owner.owner):hash(client);
  function prefix(reference) {
    if(!reference||!ID.test(reference.id||'')||!Number.isSafeInteger(reference.expiresAt)||!HEX.test(reference.token||''))throw new UploadError(404,'Upload niet gevonden of verlopen.');
    return `${scope}/${reference.expiresAt}/${reference.id}/`;
  }
  async function manifest(reference, allowClaimed=false, allowExpired=false) {
    const key=prefix(reference),record=await store.get(key+'manifest',{type:'json'});
    if(!record||!HEX.test(record.tokenHash||'')||!timingSafeEqual(Buffer.from(record.tokenHash),Buffer.from(hash(reference.token))))throw new UploadError(404,'Upload niet gevonden of verlopen.');
    if(!allowExpired&&record.expiresAt<=now())throw new UploadError(410,'De foto-upload is verlopen. Kies opnieuw Video genereren.');
    if(!allowClaimed&&await store.get(key+'claimed',{type:'json'}))throw new UploadError(409,'Deze foto-upload is al gebruikt.');
    return {key,record};
  }
  async function reserve(group, slots) {
    const hour=Math.floor(now()/TTL_MS),expires=(hour+2)*TTL_MS;
    for(let i=0;i<slots;i++){
      const result=await store.setJSON(`${base}/rate/${expires}/${group}-${hour}/${i}`,{}, {onlyIfNew:true});
      if(result.modified)return;
    }
    throw new UploadError(429,'Te veel foto-uploads. Probeer later opnieuw.');
  }
  async function create(images) {
    if(!Array.isArray(images)||images.length<1||images.length>MAX_REFERENCE_IMAGES)throw new UploadError(400,'Kies 1 tot 3 referentiefoto’s.');
    let total=0;
    const descriptions=images.map(image=>{
      if(!image||!TYPES.includes(image.mimeType)||!Number.isSafeInteger(image.size)||image.size<1||!HEX.test(image.sha256||''))throw new UploadError(400,'Ongeldige foto-upload.');
      total+=image.size;
      if(total>MAX_REFERENCE_BYTES)throw new UploadError(413,'De referentiefoto’s mogen samen maximaal 10 MiB zijn.');
      return {mimeType:image.mimeType,size:image.size,sha256:image.sha256,parts:Math.ceil(image.size/CHUNK_BYTES)};
    });
    // Previews have no cron until production includes the scheduled function.
    await sweep(100);
    await reserve('site',60);await reserve(actor,10);
    const reference={id:randomUUID(),expiresAt:now()+TTL_MS,token:randomBytes(32).toString('hex')};
    const record={images:descriptions,expiresAt:reference.expiresAt,tokenHash:hash(reference.token)};
    const result=await store.setJSON(prefix(reference)+'manifest',record,{onlyIfNew:true});
    if(!result.modified)throw new UploadError(503,'De foto-upload kon niet veilig worden gestart.');
    return {reference,chunkBytes:CHUNK_BYTES};
  }
  async function put(reference, imageIndex, part, data) {
    const {key,record}=await manifest(reference);
    const image=record.images[imageIndex];
    if(!Number.isInteger(imageIndex)||!image||!Number.isInteger(part)||part<0||part>=image.parts||typeof data!=='string'||data.length>Math.ceil(CHUNK_BYTES/3)*4||data.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(data))throw new UploadError(400,'Ongeldig foto-onderdeel.');
    const bytes=Buffer.from(data,'base64');
    const expected=Math.min(CHUNK_BYTES,image.size-part*CHUNK_BYTES);
    if(bytes.length!==expected||bytes.toString('base64')!==data)throw new UploadError(400,'Ongeldig foto-onderdeel.');
    const partKey=key+`image-${imageIndex}-${part}`;
    const result=await store.setJSON(partKey,{data},{onlyIfNew:true});
    if(!result.modified){
      const previous=await store.get(partKey,{type:'json'});
      if(!previous||previous.data!==data)throw new UploadError(409,'Dit foto-onderdeel bestaat al met andere inhoud.');
    }
    // A deletion/reset may have raced the write. Do not leave a late private chunk behind.
    try{await manifest(reference);}catch(error){await store.delete(partKey);throw error;}
  }
  async function consume(reference) {
    const {key,record}=await manifest(reference);
    const sources=[];
    for(let i=0;i<record.images.length;i++){
      const image=record.images[i],parts=[];
      for(let part=0;part<image.parts;part++){
        const chunk=await store.get(key+`image-${i}-${part}`,{type:'json'});
        if(!chunk)throw new UploadError(409,'De foto-upload is nog niet volledig. Er is geen video gestart.');
        parts.push(Buffer.from(chunk.data,'base64'));
      }
      const bytes=Buffer.concat(parts);
      if(bytes.length!==image.size||hash(bytes)!==image.sha256)throw new UploadError(400,'De foto-upload is beschadigd. Upload de foto’s opnieuw.');
      sources.push(`data:${image.mimeType};base64,${bytes.toString('base64')}`);
    }
    const parsed=parseReferenceImages({images:sources});
    if(parsed.error)throw new UploadError(400,parsed.error);
    await manifest(reference);
    // An upload is single-use: parallel/replayed starts cannot consume it twice.
    const claim=await store.setJSON(key+'claimed',{}, {onlyIfNew:true});
    if(!claim.modified)throw new UploadError(409,'Deze foto-upload is al gebruikt.');
    if(record.expiresAt<=now())throw new UploadError(410,'De foto-upload is verlopen.');
    return sources;
  }
  async function remove(reference) {
    const candidate=prefix(reference);
    if(!await store.get(candidate+'manifest',{type:'json'}))return;
    const {key,record}=await manifest(reference,true,true);
    // Retain an empty tombstone so a delayed concurrent start cannot claim this batch again.
    await store.setJSON(key+'claimed',{}, {onlyIfNew:true});
    await store.delete(key+'manifest');
    const keys=[];
    record.images.forEach((image,index)=>{for(let part=0;part<image.parts;part++)keys.push(key+`image-${index}-${part}`);});
    await Promise.all(keys.map(key=>store.delete(key)));
  }
  async function removeWorkspace() {
    if(!owner)throw new UploadError(403,'Een demosessie is vereist.');
    const keys=[];
    for await(const page of store.list({prefix:scope+'/',paginate:true}))keys.push(...page.blobs.map(blob=>blob.key));
    // Invalidate manifests first; late writes recheck them and remove themselves.
    for(const key of keys.filter(key=>key.endsWith('/manifest'))){
      await store.setJSON(key.slice(0,-8)+'claimed',{}, {onlyIfNew:true});
      await store.delete(key);
    }
    await Promise.all(keys.filter(key=>!key.endsWith('/manifest')&&!key.endsWith('/claimed')).map(key=>store.delete(key)));
  }
  async function sweep(limit=5000) {
    let deleted=0;
    // The site's production schedule also sweeps expired preview records in this private store.
    for await(const page of store.list({prefix:'v1/',paginate:true})){
      const expired=page.blobs.filter(blob=>{const expiry=Number(blob.key.split('/').at(-3)),grace=blob.key.endsWith('/claimed')?CLAIM_GRACE_MS:0;return Number.isSafeInteger(expiry)&&expiry>0&&expiry+grace<=now();}).slice(0,limit-deleted);
      for(let offset=0;offset<expired.length;offset+=20){
        await Promise.all(expired.slice(offset,offset+20).map(async blob=>{await store.delete(blob.key);deleted++;}));
      }
      if(deleted>=limit)break;
    }
    return deleted;
  }
  return {create,put,consume,remove,removeWorkspace,sweep};
}
function uploadsForEvent(event) {
  return event?.[UPLOAD_SERVICE]||createReferenceUploads({store:openUploadStore(event),owner:event?.[UPLOAD_OWNER],client:event?.headers?.['x-nf-client-connection-ip']||'unknown'});
}
async function uploadRequest(event) {
  const headers={'Content-Type':'application/json','Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'};
  const reply=(status,body)=>({statusCode:status,headers,body:JSON.stringify(body)});
  try{
    if(event.httpMethod!=='POST')return reply(405,{error:'Gebruik POST.'});
    if(!event[DEMO_REQUEST]){
      const origin=new URL(event.headers?.origin||'invalid:');
      const local=['127.0.0.1','localhost'].includes(origin.hostname);
      if(origin.host!==event.headers?.host||(origin.protocol!=='https:'&&!(local&&origin.protocol==='http:')))return reply(403,{error:'Onbekende website.'});
    }
    if(!event.headers?.['content-type']?.startsWith('application/json'))return reply(415,{error:'Gebruik JSON.'});
    if(typeof event.body!=='string'||Buffer.byteLength(event.body)>2*1024*1024)return reply(413,{error:'Het foto-onderdeel is te groot.'});
    let input;try{input=JSON.parse(event.body);}catch{return reply(400,{error:'Ongeldige uploadgegevens.'});}
    const uploads=uploadsForEvent(event);
    if(input?.action==='create')return reply(201,await uploads.create(input.images));
    if(input?.action==='chunk'){await uploads.put(input.reference,input.image,input.part,input.data);return reply(200,{success:true});}
    if(input?.action==='delete'){await uploads.remove(input.reference);return reply(200,{success:true});}
    return reply(400,{error:'Onbekende uploadactie.'});
  }catch(error){return reply(error instanceof UploadError?error.status:503,{error:error instanceof UploadError?error.message:'De foto-upload kon niet veilig worden afgerond. Er is geen nieuwe video gestart.'});}
}
module.exports={createReferenceUploads,openUploadStore,uploadsForEvent,uploadRequest,UploadError,UPLOAD_OWNER,UPLOAD_SERVICE,CHUNK_BYTES,TTL_MS};
