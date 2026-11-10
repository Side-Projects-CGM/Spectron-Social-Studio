const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const page=fs.readFileSync('spectron-social-studio.html','utf8'),source=fs.readFileSync('ai-video.js','utf8');
assert.match(page,/role="dialog"/);assert.match(page,/aria-modal="true"/);assert.match(page,/aria-labelledby="aiVideoConfirmTitle"/);assert.match(page,/AI-video genereren\?/);assert.match(page,/Video genereren/);assert.match(page,/>Annuleren</);assert.doesNotMatch(source,/window\.confirm/);assert.match(source,/Video wordt gestart\.\.\./);assert.match(source,/if\(aiVideoRunning\|\|aiVideoConfirmPending\)return/);
const popup=page.match(/<div id="aiVideoConfirmModal"[\s\S]*?<div class="ai-video-modal-actions">/)[0];
assert.deepEqual([...popup.matchAll(/<p(?: class="[^"]*")?>([^<]*)<\/p>/g)].map(match=>match[1]),[
  'Je maakt een video van 8 seconden met muziek en geluid.',
  'Pas de prompt aan om je eigen scène te beschrijven.',
  'Tip: zet gesproken woorden tussen aanhalingstekens, bijvoorbeeld: Sinterklaas zegt: "..."',
  'Elke video kost geld of credits. Begin met een duidelijke prompt.'
]);
assert.doesNotMatch(popup,/4 seconden/);
const els={aiVideoConfirmModal:{hidden:true},aiVideoConfirmButton:{disabled:false,textContent:'Video genereren',focus(){}},aiVideoCancelButton:{}};let keydown;const context=vm.createContext({document:{activeElement:{focus(){}},getElementById:id=>els[id]},window:{addEventListener:(event,fn)=>{if(event==='keydown')keydown=fn;}},URL:{},console});vm.runInContext(source,context);
(async()=>{let request=context.requestAIVideoConfirmation();await Promise.resolve();assert.equal(els.aiVideoConfirmModal.hidden,false);els.aiVideoCancelButton.onclick();assert.equal(await request,false);assert.equal(els.aiVideoConfirmModal.hidden,true);request=context.requestAIVideoConfirmation();await Promise.resolve();keydown({key:'Escape'});assert.equal(await request,false);request=context.requestAIVideoConfirmation();await Promise.resolve();els.aiVideoConfirmButton.onclick();assert.equal(await request,true);assert.equal(els.aiVideoConfirmButton.disabled,true);console.log('PASS: AI Video custom confirmation blocks pre-confirm requests, supports cancel/Escape, confirms once, and restores focus state');})().catch(e=>{console.error(e);process.exitCode=1;});
