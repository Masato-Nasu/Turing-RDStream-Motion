/* Fixed integer radix-2 FFT: whole-field DCT, never a block/tile transform. */
(function(root){'use strict';
 const {N,S,C,T,PC,PS}=root.RD5Tables,L=2*N;
 const rd=(n,d)=>Math.floor(n/d+0.5);
 function fft(re,im,inverse){
  for(let i=1,j=0;i<L;i++){let bit=L>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}}
  for(let len=2;len<=L;len*=2){const half=len/2,step=L/len;
   for(let p=0;p<L;p+=len)for(let j=0;j<half;j++){
    const a=p+j,b=a+half,k=j*step,wr=C[k],wi=inverse?T[k]:-T[k],tr=rd(re[b]*wr-im[b]*wi,S),ti=rd(re[b]*wi+im[b]*wr,S),ar=re[a],ai=im[a];
    if(inverse){re[a]=rd(ar+tr,2);im[a]=rd(ai+ti,2);re[b]=rd(ar-tr,2);im[b]=rd(ai-ti,2);}else{re[a]=ar+tr;im[a]=ai+ti;re[b]=ar-tr;im[b]=ai-ti;}
   }
  }
 }
 function transform2(a,inverse){
  if(a.length!==N*N)throw Error('R4.3 transform dimensions');
  const tmp=new Float64Array(N*N),out=new Float64Array(N*N),re=new Float64Array(L),im=new Float64Array(L);
  function line(source,offset,stride,dest,doff,ds){
   re.fill(0);im.fill(0);
   if(inverse){re[0]=2*N*source[offset];for(let k=1;k<N;k++){const x=source[offset+k*stride]*N;re[k]=rd(x*PC[k],S);im[k]=rd(x*PS[k],S);re[L-k]=re[k];im[L-k]=-im[k];}fft(re,im,true);for(let x=0;x<N;x++)dest[doff+x*ds]=re[x];}
   else{for(let x=0;x<N;x++)re[x]=re[L-1-x]=source[offset+x*stride];fft(re,im,false);for(let k=0;k<N;k++)dest[doff+k*ds]=rd(re[k]*PC[k]+im[k]*PS[k],2*S);}
  }
  for(let y=0;y<N;y++)line(a,y*N,1,tmp,y*N,1);
  for(let x=0;x<N;x++)line(tmp,x,N,out,x,N);
  return out;
 }
 root.RD5Transform={forward:a=>transform2(a,false),inverse:a=>Int32Array.from(transform2(a,true))};
})(globalThis);
