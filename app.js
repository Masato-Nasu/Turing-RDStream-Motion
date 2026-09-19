(()=>{'use strict';
 const $=id=>document.getElementById(id);let busy=false,job=null,files=[],decoded=null,previewFrames=[],previewRAF=0,previewStart=0,previewLoadToken=0,previewIndex=-1;
 function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
 function lock(on){busy=on;for(const id of ['plain','sourceFile','key','sheetSpan','generate','motionFile','decodeKey','decode'])$(id).disabled=on;$('cancel').hidden=!on;}
 function run(op,args,status){return new Promise((resolve,reject)=>{
  if(location.protocol==='file:'){reject(Error('index.htmlの直接起動には対応していません。http://localhost:8014/ で開いてください'));return;}
  if(!globalThis.isSecureContext||!globalThis.crypto?.subtle){reject(Error('暗号機能を利用できません。http://localhost:8014/ で開いてください'));return;}
  let w,timeout,done=false,started=false;const id=Date.now()+Math.random();
  const finish=(e,r)=>{if(done)return;done=true;clearTimeout(timeout);w?.terminate();job=null;e?reject(e):resolve(r)};
  job=()=>finish(Error('処理を中止しました'));
  try{w=new Worker('worker.js?v=0.3.10');}catch(e){finish(Error('Workerを起動できません: '+e.message));return;}
  status.textContent='処理を開始しています — Worker起動確認中';
  timeout=setTimeout(()=>finish(Error('Workerの起動応答がありません。Ctrl+Shift+Rで再読み込みしてください')),15000);
  w.onerror=e=>finish(Error('Worker起動／実行エラー: '+(e.message||'読み込みに失敗しました')));
  w.onmessageerror=()=>finish(Error('Workerとのデータ通信に失敗しました'));
  w.onmessage=({data})=>{
   if(data.ready&&!started){started=true;clearTimeout(timeout);status.textContent='準備中';const transfer=[];if(args.bytes)transfer.push(args.bytes);if(args.inputs)for(const x of args.inputs)transfer.push(x.buffer);try{w.postMessage({id,op,args},transfer);}catch(e){finish(e)}return;}
   if(data.id!==id)return;
   if(data.progress)status.textContent=data.progress.total?`${data.progress.phase} ${data.progress.current} / ${data.progress.total}`:'準備中';
   else finish(data.error?Error(data.error):null,data.result);
  };
 });}
 function drawGray(gray){
  const canvas=$('motionCanvas'),ctx=canvas.getContext('2d'),img=ctx.createImageData(512,512),d=img.data;
  for(let i=0,p=0;i<gray.length;i++,p+=4){const v=gray[i];d[p]=v;d[p+1]=v;d[p+2]=v;d[p+3]=255;}
  ctx.putImageData(img,0,0);
 }
 function startPreview(){
  cancelAnimationFrame(previewRAF);previewStart=performance.now();previewIndex=-1;
  const tick=now=>{if(!previewFrames.length)return;const elapsed=(now-previewStart)%5000,idx=Math.min(previewFrames.length-1,Math.floor(elapsed/5000*previewFrames.length));if(idx!==previewIndex){previewIndex=idx;drawGray(previewFrames[idx]);}previewRAF=requestAnimationFrame(tick);};
  previewRAF=requestAnimationFrame(tick);
 }
 async function preview(){
  const token=++previewLoadToken;cancelAnimationFrame(previewRAF);previewFrames=[];previewIndex=-1;
  const f=files[Number($('sheetSelect').value)||0];if(!f)return;
  try{
   const dummy={textContent:''},buffer=f.data.slice().buffer,r=await run('preview',{inputs:[{name:f.name,buffer}],infoCount:f.infoCount},dummy);
   if(token!==previewLoadToken)return;
   previewFrames=r.frames.map(b=>new Uint8Array(b));startPreview();
  }catch(e){if(token===previewLoadToken)$('genStatus').textContent='プレビュー失敗 — '+e.message;}
 }
 $('plain').oninput=()=>{$('byteCount').textContent=`${new TextEncoder().encode($('plain').value).length.toLocaleString()} / 131,072 bytes`};$('plain').oninput();
 $('cancel').onclick=()=>job?.();$('sheetSelect').onchange=preview;$('replayMotion').onclick=startPreview;
 $('generate').onclick=async()=>{if(busy)return;lock(true);files=[];previewFrames=[];cancelAnimationFrame(previewRAF);$('preview').hidden=true;$('saveMotion').disabled=true;$('saveZip').disabled=true;$('genStatus').textContent='準備中';try{const f=$('sourceFile').files[0];if(f?.size>131072)throw Error('ファイルは最大131072 bytesです');const args={text:$('plain').value,key:$('key').value,sheetSpan:Number($('sheetSpan').value)};if(f)args.bytes=await f.arrayBuffer();const r=await run('encode',args,$('genStatus'));files=r.files;$('sheetSelect').replaceChildren();files.forEach((x,i)=>{const o=document.createElement('option');o.value=i;o.textContent=`APNG ${i+1} / ${files.length}`;$('sheetSelect').append(o)});$('preview').hidden=false;$('saveMotion').disabled=false;$('saveZip').disabled=false;$('replayMotion').disabled=false;$('genStatus').textContent=`生成完了 — ${r.rawBytes.toLocaleString()} → ${r.packedBytes.toLocaleString()} bytes / ${r.count}情報フレーム / ${files.length} APNG`;lock(false);preview();return;}catch(e){files=[];$('genStatus').textContent='生成停止 — '+e.message;}finally{if(busy)lock(false);}};
 $('saveMotion').onclick=()=>{const f=files[Number($('sheetSelect').value)||0];if(f)download(new Blob([f.data],{type:'image/apng'}),f.name)};
 $('saveZip').onclick=()=>{try{if(files.length)download(RDStreamZIP.create(files),'rdstream-p03-r4-apng.zip')}catch(e){$('genStatus').textContent='保存失敗 — '+e.message}};
 $('decode').onclick=async()=>{if(busy)return;decoded=null;$('result').value='';$('saveResult').disabled=true;lock(true);try{const selected=Array.from($('motionFile').files);if(!selected.length||selected.reduce((n,x)=>n+x.size,0)>512*1024*1024)throw Error('APNG／ZIPを選択してください（合計512 MiB以下）');const inputs=[];for(const f of selected)inputs.push({name:f.name,buffer:await f.arrayBuffer()});const r=await run('decode',{inputs,key:$('decodeKey').value},$('decodeStatus'));decoded=r.bytes;$('result').value=r.text??'';$('saveResult').disabled=false;$('decodeStatus').textContent=`復号成功 — ${r.bytes.length.toLocaleString()} bytes / ${r.sheets} APNG`;}catch(e){$('decodeStatus').textContent='復号失敗 — '+e.message;}finally{lock(false);}};
 $('saveResult').onclick=()=>{if(decoded)download(new Blob([decoded],{type:'application/octet-stream'}),'rdstream-decoded.bin')};
 globalThis.RDStreamUIReady=true;
})();
