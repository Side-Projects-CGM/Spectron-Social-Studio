const fs = require('node:fs/promises');
const path = require('node:path');
const ROOT = path.resolve(__dirname,'..');
async function build(output = path.join(ROOT,'demo-dist')) {
  await fs.mkdir(output,{recursive:true});
  // Never publish the repository root or the regular site's preset/embedded assets.
  const load = name => fs.readFile(path.join(ROOT,name),'utf8');
  function replace(source, pattern, replacement) {
    if (!pattern.test(source)) throw new Error(`Demo build source no longer matches ${pattern}`);
    return source.replace(pattern,replacement);
  }
  let html = await load('spectron-social-studio.html');
  html = replace(html, /<title>[^<]*<\/title>/, '<title>Social Studio demo</title>');
  html = replace(html, /<script src="embedded-assets\.js"><\/script>/, '<script src="runtime.js"></script>');
  html = replace(html, /const BRAND_IMAGES = \{[\s\S]*?\n\};/, 'const BRAND_IMAGES = {};');
  html = replace(html, /<picture class="client-brand-picture">[\s\S]*?<\/picture>/, '<strong>Social Studio demo</strong>');
  html = replace(html, /<div class="app-identity">[\s\S]*?<\/div>/, '');
  html = replace(html, /<select id="brand">[\s\S]*?<\/select>/, '<input type="text" id="brand" maxlength="100" autocomplete="off" placeholder="Naam van de klant (optioneel)">');
  html = html.replaceAll('Kies een merk','Naam van de klant');
  // The demo's free-text customer name is not a brand-gallery switch.
  html = replace(html, /document.getElementById\('brand'\).addEventListener\('change', \(\)=>\{\r?\n  selectedImage = null;/,
    "document.getElementById('brand').addEventListener('change', ()=>{");
  html = replace(html, /<div class="chips" id="uspChips">[\s\S]*?<\/div>/, '<div class="chips" id="uspChips"><input id="demoBenefits" type="text" maxlength="1000" placeholder="Voordelen uit de klantbriefing (optioneel)"></div>');
  html = replace(html, /function getSelectedUSPs\(\)\{[\s\S]*?\n\}/, "function getSelectedUSPs(){ const value=document.getElementById('demoBenefits').value.trim(); return value?[value]:[]; }");
  html = replace(html, /const brand = document.getElementById\('brand'\).value;\n  const product = brand \? `\$\{brand\} collectie` : "";/, "const brand = document.getElementById('brand').value.trim() || 'de klant';\n  const product = document.getElementById('promo').value.trim();");
  html = replace(html, /Je bent social copywriter voor Spectron Toys,[\s\S]*?Verzin geen productclaims/, 'Je bent social copywriter. Gebruik alleen de opgegeven klantbriefing. Verzin geen productclaims');
  // An authentication/limit/reset failure must not masquerade as successful AI generation.
  html = replace(html, /function generateOffline\(brand, product, platform, tone, usps, promo, count\)\{/, "function generateOffline(brand, product, platform, tone, usps, promo, count){ throw new Error('Live generatie niet beschikbaar.');");
  html = html.replaceAll('SPECTRON TOYS','SOCIAL STUDIO').replaceAll('Spectron Toys','Social Studio').replaceAll('spectron-ai-video.mp4','social-studio-video.mp4');
  html = replace(html, /<\/head>/, '<link rel="stylesheet" href="neutral.css"></head>');
  html = html.replace('AI-video van 4 seconden','AI-video van 8 seconden');
  await fs.writeFile(path.join(output,'studio.html'),html);
  for (const name of ['studio-design.css','social-platforms-blue.svg','instagram-platform.svg','animated-video.js']) await fs.copyFile(path.join(ROOT,name),path.join(output,name));
  for (const name of ['ai-video.js','ai-background.js','studio-library.js']) {
    let source=await load(name);
    if(name==='ai-video.js') {
      source=replace(source,/const AI_VIDEO_RECOVERY_KEY='spectron-ai-video-recovery';/,"const AI_VIDEO_RECOVERY_KEY=window.demoStoragePrefix+'video-recovery';");
      source=replace(source,/if\(p&&!p.value\)p.value=DEFAULT_AI_VIDEO_PROMPT;/,'');
    }
    if(name==='ai-background.js') source=replace(source,/const BACKGROUND_HISTORY_KEY = 'spectron-ai-background-fingerprints-v1';/,"const BACKGROUND_HISTORY_KEY = window.demoStoragePrefix+'background-history';");
    if(name==='studio-library.js') {
      source=replace(source,/indexedDB.open\('spectron-saved-ads', 2\)/,"indexedDB.open(window.demoStoragePrefix+'library', 2)");
      source=replace(source,/  selectedImage = ad.image;/,"  selectedImage = ad.image;\n  showStudioWorkflow('advertisement');");
    }
    await fs.writeFile(path.join(output,name),source);
  }
  for (const name of ['index.html','presenter.js','runtime.js','neutral.css']) await fs.copyFile(path.join(__dirname,name),path.join(output,name));
}
module.exports={build};
if(require.main===module) build().catch(()=>{console.error('Demo build failed. Check source compatibility.');process.exitCode=1;});
