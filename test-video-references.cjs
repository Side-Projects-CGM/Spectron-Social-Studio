const {test,after} = require('node:test');
const assert = require('node:assert/strict');
const {MAX_REFERENCE_IMAGES,MAX_REFERENCE_BYTES,REFERENCE_INSTRUCTION,parseReferenceImages} = require('./netlify/lib/video-references.cjs');
const usage = require('./netlify/lib/usage.cjs');
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1sAAAAASUVORK5CYII=';
const photo = 'data:image/png;base64,'+png;
const previousTracker=usage.trackedFetch,previousKey=process.env.GOOGLE_DEVELOPER_API_KEY;
const calls=[];
usage.trackedFetch=async(event,details,url,options)=>{calls.push(JSON.parse(options.body));return Response.json({id:'mock-references',status:'in_progress'});};
process.env.GOOGLE_DEVELOPER_API_KEY='mock-reference-key';
const startPath=require.resolve('./netlify/functions/start-veo-test.cjs'),servicePath=require.resolve('./netlify/lib/omni-video.cjs');
delete require.cache[startPath];delete require.cache[servicePath];
const start=require(startPath).handler;
after(()=>{usage.trackedFetch=previousTracker;delete require.cache[startPath];delete require.cache[servicePath];if(previousKey===undefined)delete process.env.GOOGLE_DEVELOPER_API_KEY;else process.env.GOOGLE_DEVELOPER_API_KEY=previousKey;});
const post=body=>({httpMethod:'POST',body:JSON.stringify(body)});

for(const count of [1,2,3]) test(`${count} full reference image(s), prompt guidance, no forced task and eight-second video`,async()=>{
 const before=calls.length;
 const response=await start(post({images:Array(count).fill(photo),prompt:'Een nieuwe scène.',aspectRatio:'16:9'}));
 assert.equal(response.statusCode,202);
 assert.equal(calls.length,before+1);
 const request=calls.at(-1);
 assert.equal(request.generation_config,undefined);
 assert.equal(request.model,'gemini-omni-1.1-flash');
 assert.equal(request.response_format.duration,'8s');
 assert.equal(request.response_format.aspect_ratio,'16:9');
 assert.equal(request.input.length,count+1);
 for(const image of request.input.slice(0,-1))assert.deepEqual(image,{type:'image',data:png,mime_type:'image/png'});
 assert.equal(request.input.at(-1).text,'Een nieuwe scène.\n\n'+REFERENCE_INSTRUCTION);
});

test('legacy single-image requests remain valid reference requests',async()=>{
 const response=await start(post({image:photo,prompt:'Legacy caller',aspectRatio:'9:16'}));
 assert.equal(response.statusCode,202);
 assert.equal(calls.at(-1).input[0].data,png);
 assert.equal(calls.at(-1).generation_config,undefined);
});

test('invalid counts, file types, spoofed content, malformed base64 and oversized totals never call Google',async()=>{
 const large=Buffer.alloc(Math.floor(MAX_REFERENCE_BYTES/2)+1);Buffer.from(png,'base64').copy(large);
 const bigPhoto='data:image/png;base64,'+large.toString('base64');
 const bodies=[{images:[]},{images:Array(MAX_REFERENCE_IMAGES+1).fill(photo)},{images:photo},
  {images:['data:image/gif;base64,R0lGODlh']},{images:['data:image/png;base64,YWJj']},
  {images:['data:image/png;base64,!!!']},{images:[bigPhoto,bigPhoto]},
  {images:[{uri:'https://private.test/image.png'}]},{images:[null]}];
 const before=calls.length;
 for(const value of bodies){const result=await start(post({...value,prompt:'Test',aspectRatio:'9:16'}));assert.equal(result.statusCode,400);}
 assert.equal(calls.length,before);
});

test('JPEG/WebP signatures are accepted and a MIME/signature mismatch is rejected',()=>{
 const jpeg='data:image/jpeg;base64,'+Buffer.from([255,216,255,224,0,0]).toString('base64');
 const webp='data:image/webp;base64,'+Buffer.from('RIFF0000WEBP','ascii').toString('base64');
 assert.equal(parseReferenceImages({images:[jpeg,webp]}).images.length,2);
 assert.ok(parseReferenceImages({images:[jpeg.replace('image/jpeg','image/png')]}).error);
});

test('combined byte budget permits exact cap and rejects cap plus one',()=>{
 const bytes=Buffer.alloc(MAX_REFERENCE_BYTES);Buffer.from(png,'base64').copy(bytes);
 assert.equal(parseReferenceImages({images:['data:image/png;base64,'+bytes.toString('base64')]}).images.length,1);
 assert.ok(parseReferenceImages({images:['data:image/png;base64,'+Buffer.concat([bytes,Buffer.from([0])]).toString('base64')]}).error);
});
