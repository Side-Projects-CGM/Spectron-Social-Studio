const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {createRequire} = require('node:module');
const {execFileSync} = require('node:child_process');
const ROOT = __dirname;

// Reuse the installed Netlify CLI's real resolver; do not add a project dependency.
const cliRoot = process.env.NETLIFY_CLI_ROOT || (process.platform === 'win32'
  ? path.join(process.env.APPDATA, 'npm/node_modules/netlify-cli') : null);
async function resolveConfig(base) {
  assert.ok(cliRoot, 'Set NETLIFY_CLI_ROOT to the existing Netlify CLI installation');
  const {resolveConfig:resolve} = await import(pathToFileURL(path.join(cliRoot,'node_modules/@netlify/config/lib/main.js')).href);
  return resolve({cwd:ROOT, repositoryRoot:ROOT, defaultConfig:{build:{base}},
    baseRelDir:true, context:'deploy-preview', offline:true, logs:false});
}

test('Netlify UI base=demo discovers nested config WITHOUT an explicit config override', async () => {
  const result = await resolveConfig('demo');
  assert.equal(path.resolve(result.configPath), path.join(ROOT,'demo/netlify.toml'));
  assert.equal(path.resolve(result.buildDir), path.join(ROOT,'demo'));
  assert.equal(result.config.build.command, 'npm --prefix .. ci && node build.cjs');
  assert.equal(path.resolve(result.config.build.publish), path.join(ROOT,'demo-dist'));
  assert.equal(path.resolve(result.config.functionsDirectory), path.join(ROOT,'demo/functions'));
  assert.equal((result.config.redirects || []).some(rule => rule.to === '/spectron-social-studio.html'), false);
  assert.ok(result.config.headers.some(rule => rule.values['Cache-Control'] === 'no-store'));
});

test('private upload cleanup is scheduled in both sites without executing storage or provider calls', async () => {
  for(const directory of ['netlify/functions','demo/functions']){
    const cleanup=await import(pathToFileURL(path.join(ROOT,directory,'cleanup-video-references.mjs')).href);
    assert.equal(typeof cleanup.default,'function');assert.equal(cleanup.config.schedule,'@hourly');
  }
});

test('regular-site root base still resolves unchanged regular configuration', async () => {
  const result = await resolveConfig('.');
  assert.equal(path.resolve(result.configPath), path.join(ROOT,'netlify.toml'));
  assert.equal(path.resolve(result.config.build.publish), ROOT);
  assert.equal(path.resolve(result.config.functionsDirectory), path.join(ROOT,'netlify/functions'));
  assert.ok(result.config.redirects.some(rule => rule.from === '/' && rule.to === '/spectron-social-studio.html'));
  const original = execFileSync('git',['show','7334cdb:netlify.toml'],{cwd:ROOT});
  // Git normalizes LF while a Windows checkout may use CRLF; compare content, not checkout bytes.
  assert.equal((await fs.readFile(path.join(ROOT,'netlify.toml'),'utf8')).replaceAll('\r\n','\n'),original.toString('utf8'));
});

test('build from demo base emits isolated static output and shared functions resolve root dependencies', async () => {
  execFileSync(process.execPath,['build.cjs'],{cwd:path.join(ROOT,'demo'),stdio:'pipe'});
  const output = path.join(ROOT,'demo-dist');
  const files = await fs.readdir(output);
  for (const name of ['index.html','studio.html','runtime.js','presenter.js','studio-library.js','neutral.css']) assert.ok(files.includes(name));
  assert.equal(files.some(name => /^(?:\.env|netlify|embedded-assets|brand-images|functions|local\.cjs|artifacts)/.test(name)),false);
  const html = await fs.readFile(path.join(output,'studio.html'),'utf8');
  assert.match(html, /<title>Social Studio demo<\/title>/);
  assert.doesNotMatch(html, /src="embedded-assets\.js"/);
  const fromSharedBackend = createRequire(path.join(ROOT,'netlify/lib/demo-state.cjs'));
  assert.match(fromSharedBackend.resolve('@netlify/blobs'), /node_modules[\\/]@netlify[\\/]blobs/);
  const gateway = require('./demo/functions/demo-api.cjs');
  assert.equal(typeof gateway.default,'function'); // Import only; never invoke a provider.
});
