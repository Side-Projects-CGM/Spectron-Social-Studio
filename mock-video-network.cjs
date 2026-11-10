'use strict';
// Test-only preload for Netlify Dev. Blocks all non-loopback, non-mocked requests.
const realFetch = globalThis.fetch;
globalThis.fetch = async function(input, options = {}) {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) return realFetch(input, options);
  if (typeof input !== 'string' && typeof input.text === 'function') {
    options = {method:input.method, body:input.method === 'GET' ? undefined : await input.text(), ...options};
  }
  if (url.hostname === 'generativelanguage.googleapis.com') {
    if (url.pathname === '/v1beta/interactions' && options.method === 'POST') {
      const body = JSON.parse(options.body);
      if (body.model !== 'gemini-omni-1.1-flash' || body.background !== true || body.response_format?.duration !== '8s') throw new Error('Invalid mocked Omni request');
      const prompt = body.input.find(content => content.type === 'text')?.text;
      if (prompt === 'mock:quota') return Response.json({error:{message:'private provider quota detail'}}, {status:429});
      if (prompt === 'mock:permission') return Response.json({error:{message:'private permission detail'}}, {status:403});
      const id = prompt === 'mock:pending' ? 'local-mock-pending' : prompt === 'mock:failed' ? 'local-mock-failed' : 'local-mock-video';
      return Response.json({id, status:'in_progress'});
    }
    if (url.pathname === '/v1beta/interactions/local-mock-large-inline') {
      return Response.json({status:'completed', steps:[{type:'model_output', content:[{
        type:'video', mime_type:'video/mp4', data:Buffer.alloc(8 * 1024 * 1024, 7).toString('base64')
      }]}]});
    }
    if (url.pathname === '/v1beta/interactions/local-mock-large-uri') {
      return Response.json({status:'completed', steps:[{type:'model_output', content:[{
        type:'video', mime_type:'video/mp4', uri:'files/local-mock-large:download'
      }]}]});
    }
    if (url.pathname === '/v1beta/files/local-mock-large:download') {
      return new Response(Buffer.alloc(8 * 1024 * 1024, 7), {headers:{'Content-Type':'video/mp4'}});
    }
    if (url.pathname === '/v1beta/interactions/local-mock-pending') return Response.json({status:'in_progress'});
    if (url.pathname === '/v1beta/interactions/local-mock-failed') return Response.json({status:'failed', error:{message:'Safety filter blocked the prompt'}});
    if (url.pathname === '/v1beta/interactions/local-mock-video') {
      return Response.json({status:'completed', steps:[{type:'model_output', content:[{
        type:'video', mime_type:'video/mp4', data:Buffer.from('mock-mp4').toString('base64')
      }]}]});
    }
  }
  throw new Error('External network blocked by local video test preload');
};
