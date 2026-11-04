const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('spectron-social-studio.html', 'utf8');
const css = fs.readFileSync('studio-design.css', 'utf8');
const svg = fs.readFileSync('assets/branding/toytous.svg', 'utf8');
const png = fs.readFileSync('assets/branding/toytous.png');

assert.match(html, /<picture class="client-brand-picture">\s*<source srcset="assets\/branding\/toytous\.svg" type="image\/svg\+xml">\s*<img class="client-brand-logo" src="assets\/branding\/toytous\.png"/);
assert.doesNotMatch(html, /toytous-logo-cutout\.svg|toytous-logo\.jpg/);
assert.match(html, /alt="ToyToy" width="2400" height="512"/);
assert.match(css, /\.masthead \.client-brand-picture\{display:contents;\}/);
assert.match(css, /\.masthead \.client-brand-logo\{filter:none;image-rendering:auto;\}/);
assert.doesNotMatch(css, /\.client-brand-logo\{[^}]*filter:(?!none)/);
assert.match(svg, /<path\b/);
assert.doesNotMatch(svg, /<(?:image|text)\b|data:image\//);
assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
assert.equal(png.readUInt32BE(16), 2400);
assert.equal(png.readUInt32BE(20), 512);
assert.ok(fs.statSync('assets/branding/Toytous.eps').size > 0);
console.log('PASS: Cees EPS assets, true vector logo, high-resolution PNG fallback and unfiltered header styling');
