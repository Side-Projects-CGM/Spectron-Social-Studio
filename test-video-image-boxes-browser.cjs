const test=require('node:test');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const {build}=require('./demo/build.cjs');
const run=require('./test-video-references-browser.cjs');
const ROOT=__dirname;
const ARTIFACTS=path.join(ROOT,'artifacts/video-image-boxes');

test('three video image slots and automatic canvas: regular/demo at desktop/mobile, all APIs mocked',{timeout:240000},async t=>{
  const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/User/Documents/Oomagent/food-for-skin-studio/node_modules/@playwright/test');
  const output=path.join(ARTIFACTS,'site');await build(output);
  const server=http.createServer(async(req,res)=>{
    try{
      const pathname=new URL(req.url,'http://local.test').pathname;
      if(pathname.startsWith('/.netlify/')){res.writeHead(500);res.end('APIs must be mocked');return;}
      const demo=pathname.startsWith('/demo/'),base=demo?output:ROOT;
      const name=demo?(pathname.slice(6)||'index.html'):(pathname.slice(1)||'spectron-social-studio.html');
      const file=path.resolve(base,name);
      if(!file.startsWith(base+path.sep)){res.writeHead(404);res.end();return;}
      const bytes=await fs.readFile(file);
      const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}[path.extname(file)]||'application/octet-stream';
      res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store'});res.end(bytes);
    }catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({channel:'chrome'});const reports=[];
  try{
    for(const demo of [false,true])await t.test(demo?'demo':'regular',async()=>{
      reports.push(...await run(browser,origin+(demo?'/demo/':'/'),{demo,artifacts:ARTIFACTS}));
    });
  }finally{
    await browser.close();await new Promise(resolve=>server.close(resolve));
    await fs.writeFile(path.join(ARTIFACTS,'report.json'),JSON.stringify(reports,null,2));
  }
});
