/* UI bootstrap: report missing scripts instead of leaving a dead button. */
(()=>{'use strict';
 const status=document.getElementById('genStatus'),generate=document.getElementById('generate'),decode=document.getElementById('decode');
 const fail=e=>{status.textContent='起動失敗 — '+(e.message||String(e));generate.disabled=true;decode.disabled=true;};
 window.addEventListener('error',e=>{if(!globalThis.RDStreamUIReady)fail(e.error||Error(e.message||'スクリプトの読み込み失敗'));});
 function load(name){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=name+'?v=0.3.10';s.onload=resolve;s.onerror=()=>reject(Error(name+'を読み込めません。Ctrl+Shift+Rで再読み込みしてください'));document.head.append(s);});}
 (async()=>{try{await load('zip.js');await load('app.js');if(!globalThis.RDStreamUIReady)throw Error('画面初期化が完了しませんでした');generate.disabled=false;decode.disabled=false;status.textContent='準備完了';}catch(e){fail(e);}})();
})();
