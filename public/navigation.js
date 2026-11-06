/* Keep Sandstorm's outer grain URL in sync with this frame. */
(function (root) {
  'use strict';
  let lastPath;
  function notify() {
    const path=root.location.pathname+root.location.search+root.location.hash;
    if(path!==lastPath){
      root.parent.postMessage({setPath:path}, '*');
      lastPath=path;
    }
  }
  function deck() {
    return new URLSearchParams(root.location.hash.slice(1)).get('deck');
  }
  function setDeck(id) {
    const hash=id?'#'+new URLSearchParams({deck:id}).toString():'';
    if(root.location.hash!==hash)root.history.replaceState(null,'',root.location.pathname+root.location.search+hash);
    notify();
  }
  root.PageNavigation={notify,deck,setDeck};
  root.addEventListener('hashchange',notify);
  root.addEventListener('popstate',notify);
  notify();
})(window);
