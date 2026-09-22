/* Installable PWA support. Kept separate from the research prototype UI. */
(()=>{'use strict';
  if(!('serviceWorker' in navigator))return;
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('./sw.js',{scope:'./'}).catch(error=>{
      console.warn('Service Worker registration failed:',error);
    });
  });
})();
