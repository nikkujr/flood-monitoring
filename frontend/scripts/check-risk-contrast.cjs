const assert = require('node:assert/strict');
const fs = require('node:fs');
const palette = fs.readFileSync('frontend/src/styles.scss', 'utf8').split('@mixin dark-theme {')[1].split('}')[0];
const css = fs.readFileSync('frontend/src/app/dss.component.scss', 'utf8');
const vars = Object.fromEntries([...palette.matchAll(/(--[\w-]+):\s*(#[\da-f]+)/gi)].map(match => [match[1], match[2]]));
const resolve = value => value.startsWith('var(') ? vars[value.slice(4, -1)] : value;
function luminance(hex) {
 const digits = hex.slice(1); const full = digits.length === 3 ? [...digits].map(c=>c+c).join('') : digits;
 const rgb = [0,2,4].map(i=>parseInt(full.slice(i,i+2),16)/255).map(v=>v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
 return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
}
function contrast(a,b) { const values=[luminance(a),luminance(b)].sort((a,b)=>b-a); return (values[0]+.05)/(values[1]+.05); }
for(const risk of ['low','moderate','high','critical']) {
 const block = risk === 'low' ? css.match(/\.risk-hero\{([^}]+)/)[1] : css.match(new RegExp('\\.risk-hero\\[data-risk='+risk+'\\]\\{([^}]+)'))[1];
 const color=resolve(block.match(/--risk-color:([^;]+)/)[1]);
 const background=resolve(block.match(/--risk-bg:([^;]+)/)[1]);
 const ratio=contrast(color,background); const bodyRatio=contrast(vars['--muted'],background);
 console.log(risk, 'heading',ratio.toFixed(2),'body',bodyRatio.toFixed(2));
 assert.ok(ratio>=4.5 && bodyRatio>=4.5, risk+' risk banner lacks dark-mode contrast');
}
console.log('Dark risk-banner contrast checks passed.');
