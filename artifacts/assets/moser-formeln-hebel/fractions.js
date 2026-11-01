(function(global){
  'use strict';
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function parse(text){
    let i=0;
    function sequence(end){
      const nodes=[];
      while(i<text.length){
        const c=text[i];
        if(c===end){i++;break}
        if(c==='('){i++;nodes.push({type:'group',children:sequence(')')});continue}
        if(c==='√'&&text[i+1]==='('){i+=2;nodes.push({type:'root',children:sequence(')')});continue}
        if(c==='/'){nodes.push({type:'slash'});i++;continue}
        if(/\s/.test(c)){let t='';while(i<text.length&&/\s/.test(text[i]))t+=text[i++];nodes.push({type:'space',text:t});continue}
        if(/[\p{L}\p{N}·′]/u.test(c)){
          let t='';while(i<text.length){const a=text[i];if(/[\p{L}\p{N}·′]/u.test(a)||(a===','&&/\d/.test(text[i-1]||'')&&/\d/.test(text[i+1]||''))||(a==='.'&&/\d/.test(text[i-1]||'')&&/\d/.test(text[i+1]||''))){t+=a;i++}else break}
          nodes.push({type:'atom',text:t});continue;
        }
        nodes.push({type:'text',text:c});i++;
      }
      for(let j=0;j<nodes.length;j++)if(nodes[j].type==='slash'){
        let a=j-1,b=j+1;while(a>=0&&nodes[a].type==='space')a--;while(b<nodes.length&&nodes[b].type==='space')b++;
        const valid=n=>n&&['atom','group','root','frac'].includes(n.type);
        if(valid(nodes[a])&&valid(nodes[b])){nodes.splice(a,b-a+1,{type:'frac',num:nodes[a],den:nodes[b]});j=a}
      }
      return nodes;
    }
    return sequence(null);
  }
  function plain(n){if(Array.isArray(n))return n.map(plain).join('');if(n.type==='frac')return plain(n.num)+' geteilt durch '+plain(n.den);if(n.type==='group')return '('+plain(n.children)+')';if(n.type==='root')return 'Wurzel aus '+plain(n.children);if(n.type==='slash')return '/';return n.text||''}
  function html(nodes,insideFraction=false){
    if(Array.isArray(nodes))return nodes.map(n=>html(n)).join('');
    const n=nodes;
    if(n.type==='frac')return '<span class="frac" role="math" aria-label="'+esc(plain(n))+'"><span class="frac-num" aria-hidden="true">'+html(n.num,true)+'</span><span class="frac-den" aria-hidden="true">'+html(n.den,true)+'</span></span>';
    if(n.type==='group')return (insideFraction?'':'(')+html(n.children)+(insideFraction?'':')');
    if(n.type==='root')return '<span class="root">√<span class="radicand">'+html(n.children)+'</span></span>';
    if(n.type==='slash')return '/';
    return esc(n.text||'');
  }
  const api={parse,html,plain,render:text=>html(parse(text))};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  global.FractionMath=api;
  if(typeof document==='undefined')return;
  const scope='.formula,.exercise .answer,.task-head h3,.solution .answer,#flash,#quiz-questions,.feedback,.terms dd';
  function apply(root){
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);const targets=[];
    while(walker.nextNode()){
      const node=walker.currentNode,el=node.parentElement;
      if(node.nodeValue.includes('/')&&el&&!el.closest('.frac,script,style,textarea')&&el.closest(scope))targets.push(node);
    }
    for(const node of targets){
      const rendered=api.render(node.nodeValue);
      if(!rendered.includes('class="frac"'))continue;
      const template=document.createElement('template');template.innerHTML=rendered;node.replaceWith(template.content);
    }
  }
  apply(document.body);
  new MutationObserver(changes=>{for(const change of changes){if(change.target.nodeType===1&&!change.target.closest('.frac'))apply(change.target)}}).observe(document.body,{childList:true,subtree:true});
})(typeof globalThis==='undefined'?this:globalThis);
