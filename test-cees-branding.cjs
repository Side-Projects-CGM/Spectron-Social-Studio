const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');

const html = fs.readFileSync('spectron-social-studio.html', 'utf8');
const css = fs.readFileSync('studio-design.css', 'utf8');
const svg = fs.readFileSync('assets/branding/toytous.svg', 'utf8');
const png = fs.readFileSync('assets/branding/toytous.png');

assert.match(html, /<picture class="client-brand-picture">\s*<img class="client-brand-logo" src="assets\/branding\/cees-logo\.jpeg"/);
assert.doesNotMatch(html, /assets\/branding\/toytous\.(svg|png)/);
assert.equal(crypto.createHash('sha256').update(fs.readFileSync('assets/branding/cees-logo.jpeg')).digest('hex'),
  '225fe76f34c05babf959724f913c1fd435a5979d502e38838a5d66de821e0023', 'Supplied rainbow logo remains unchanged');
assert.doesNotMatch(html, /toytous-logo-cutout\.svg|toytous-logo\.jpg/);
assert.match(html, /alt="ToyToyz" width="1600" height="341"/);
assert.match(css, /\.masthead \.client-brand-picture\{display:contents;\}/);
assert.match(css, /\.masthead \.client-brand-logo\{filter:none;image-rendering:auto;mix-blend-mode:multiply;\}/);
assert.doesNotMatch(css, /\.client-brand-logo\{[^}]*filter:(?!none)/);
assert.match(svg, /<path\b/);
assert.doesNotMatch(svg, /<(?:image|text)\b|data:image\//);
assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
assert.equal(png.readUInt32BE(16), 2400);
assert.equal(png.readUInt32BE(20), 512);
assert.ok(fs.statSync('assets/branding/Toytous.eps').size > 0);
console.log('PASS: supplied Cees rainbow logo unchanged, proportional unfiltered header and previous EPS assets preserved');
