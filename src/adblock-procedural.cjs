'use strict';

function selectorWithoutHasText(node) {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'pseudo-class' && node.name === 'has-text') return '';
  if (node.type === 'compound') return node.compound.map(selectorWithoutHasText).join('');
  if (node.type === 'complex') return selectorWithoutHasText(node.left) + node.combinator + selectorWithoutHasText(node.right);
  if (node.type === 'list') return node.list.map(selectorWithoutHasText).filter(Boolean).join(',');
  return String(node.content || '');
}

function collectHasText(node, output = []) {
  if (!node || typeof node !== 'object') return output;
  if (node.type === 'pseudo-class' && node.name === 'has-text') output.push(String(node.argument || ''));
  if (node.type === 'compound') for (const child of node.compound) collectHasText(child, output);
  if (node.type === 'complex') { collectHasText(node.left, output); collectHasText(node.right, output); }
  if (node.type === 'list') for (const child of node.list) collectHasText(child, output);
  return output;
}

function buildProceduralCosmeticScript(extendedRules) {
  const rules = (Array.isArray(extendedRules) ? extendedRules : []).map((rule) => ({
    selector: selectorWithoutHasText(rule.ast) || '*',
    patterns: collectHasText(rule.ast),
    attribute: typeof rule.attribute === 'string' && /^[a-z0-9_-]{1,80}$/i.test(rule.attribute) ? rule.attribute : ''
  })).filter((rule) => rule.attribute && rule.patterns.length).slice(0, 300);
  if (!rules.length) return '';
  return `(()=>{const rules=${JSON.stringify(rules)};const test=(text,pattern)=>{try{const m=/^\\/(.*)\\/([a-z]*)$/.exec(pattern);return m?new RegExp(m[1],m[2]).test(text):text.toLocaleLowerCase().includes(pattern.toLocaleLowerCase())}catch{return false}};let timer=0;const run=()=>{timer=0;for(const r of rules){let nodes;try{nodes=document.querySelectorAll(r.selector)}catch{continue}let seen=0;for(const el of nodes){if(++seen>5000)break;const text=String(el.innerText||el.textContent||'').slice(0,20000);if(r.patterns.every(p=>test(text,p)))el.setAttribute(r.attribute,'')}}};const schedule=()=>{if(!timer)timer=setTimeout(run,250)};if(document.documentElement){run();new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true,characterData:true})}else document.addEventListener('DOMContentLoaded',()=>{run();new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true,characterData:true})},{once:true})})()`;
}

module.exports = { selectorWithoutHasText, collectHasText, buildProceduralCosmeticScript };
