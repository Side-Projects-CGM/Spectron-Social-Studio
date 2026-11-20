/* Shared presentation only: this component never sends or retries a generation request. */
(function(root){
  'use strict';
  const AD_DURATION_MS=2000;
  const VIDEO_TIME_SCALE_MS=60000;
  const VIDEO_CEILING=95;
  function percentage(mode,elapsed){
    const time=Math.max(0,elapsed);
    return mode==='ad' ? Math.min(100,Math.floor(time/AD_DURATION_MS*100))
      : Math.min(VIDEO_CEILING-1,Math.floor(VIDEO_CEILING*(1-Math.exp(-time/VIDEO_TIME_SCALE_MS))));
  }
  function createProgress({document,now=()=>performance.now(),schedule=setTimeout,cancel=clearTimeout}={}){
    let current=null;
    function stop(){
      if(!current)return;
      const job=current;current=null;
      cancel(job.timer);cancel(job.completionTimer);
      job.overlay.remove();job.host.removeAttribute('aria-busy');
      for(const resolve of job.waiters)resolve(false);
      for(const resolve of job.completionWaiters)resolve(false);
    }
    function start(mode='ad'){
      stop();
      const host=document.getElementById('workspaceCanvas');
      if(!host)return;
      const overlay=document.createElement('div');
      overlay.className='studio-progress-overlay';
      overlay.innerHTML='<div class="studio-progress-panel"><div class="studio-progress-ring" role="progressbar" aria-valuemin="0" aria-valuemax="100"><svg viewBox="0 0 120 120" aria-hidden="true" focusable="false"><circle class="studio-progress-track" cx="60" cy="60" r="52" pathLength="100"/><circle class="studio-progress-fill" cx="60" cy="60" r="52" pathLength="100"/></svg><strong class="studio-progress-value" aria-hidden="true">0%</strong></div><p class="studio-progress-label" role="status" aria-live="polite"></p></div>';
      const job=current={mode,host,overlay,bar:overlay.querySelector('[role="progressbar"]'),
        fill:overlay.querySelector('.studio-progress-fill'),value:overlay.querySelector('.studio-progress-value'),
        label:overlay.querySelector('.studio-progress-label'),started:now(),timer:0,completionTimer:0,waiters:[],completionWaiters:[],percent:0,finishing:false};
      host.setAttribute('aria-busy','true');host.appendChild(overlay);
      if(document.defaultView?.matchMedia('(max-width: 600px)').matches) overlay.scrollIntoView({block:'center',behavior:'instant'});
      job.bar.setAttribute('aria-label',mode==='ad'?'Advertentie voorbereiden':'Video voorbereiden — geschatte voortgang');
      function tick(){
        if(current!==job||job.finishing)return;
        paint(job,percentage(mode,now()-job.started));
        if(mode==='ad'&&job.percent===100){
          for(const resolve of job.waiters.splice(0))resolve(true);
          return;
        }
        const delay=mode==='ad'?Math.min(20,Math.max(1,AD_DURATION_MS-(now()-job.started))):100;
        job.timer=schedule(tick,delay);
      }
      tick();
    }
    function paint(job,value){
      job.percent=value;job.value.textContent=value+'%';
      job.bar.setAttribute('aria-valuenow',String(value));
      job.fill.style.strokeDashoffset=String(100-value);
      const label=value===100?(job.mode==='ad'?'Even geduld…':'Je video is klaar.')
        :job.mode==='ad'?'Je advertentie wordt voorbereid…':'Je video wordt voorbereid. Geschatte voortgang.';
      if(job.label.textContent!==label)job.label.textContent=label;
    }
    function waitForAd(){
      const job=current;
      if(!job||job.mode!=='ad')return Promise.resolve(false);
      if(job.percent===100)return Promise.resolve(true);
      return new Promise(resolve=>job.waiters.push(resolve));
    }
    function complete(){
      const job=current;
      if(!job)return Promise.resolve(false);
      cancel(job.timer);job.finishing=true;paint(job,100);
      // Give the ready 100% state a visible frame before revealing the playable video.
      return new Promise(resolve=>{
        job.completionWaiters.push(resolve);
        job.completionTimer=schedule(()=>{
          if(current!==job)return;
          for(const finish of job.completionWaiters.splice(0))finish(true);
        },120);
      });
    }
    return {start,stop,waitForAd,complete};
  }
  if(typeof module==='object'&&module.exports)module.exports={createProgress,percentage,AD_DURATION_MS};
  if(root&&root.document){
    root.studioProgress=createProgress({document:root.document});
    root.addEventListener('pagehide',()=>root.studioProgress.stop());
  }
})(typeof window==='undefined'?null:window);
