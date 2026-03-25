let lastPageInfoKey = '';
const root = document.documentElement;

if (root?.dataset.claudechromeInjectorInstalled === '1') {
  sendPageInfo();
} else {
  if (root) {
    root.dataset.claudechromeInjectorInstalled = '1';
  }

  // Content script: injects page-script.js into the page context
  // This runs in the content script isolated world
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('content/page-script.js');
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);

  sendPageInfo();
  window.addEventListener('load', sendPageInfo);
  window.addEventListener('popstate', sendPageInfo);
  window.addEventListener('hashchange', sendPageInfo);

  const titleObserverTarget = document.querySelector('title') || document.head || document.documentElement;
  if (titleObserverTarget) {
    new MutationObserver(() => sendPageInfo()).observe(titleObserverTarget, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  // Bridge: listen for messages from page-script (via window.postMessage)
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.source !== 'claudechrome-page') return;

    const msg = event.data;
    if (msg.type === 'captured_body') {
      chrome.runtime.sendMessage({
        type: 'captured_body',
        url: msg.url,
        body: msg.body,
        method: msg.method,
      });
    } else if (msg.type === 'console_entry') {
      chrome.runtime.sendMessage({
        type: 'console_entry',
        entry: msg.entry,
      });
    }
  });
}

function sendPageInfo() {
  const info = {
    url: window.location.href,
    title: document.title,
    visibleText: document.body?.innerText?.slice(0, 200_000) || '',
    html: document.documentElement?.outerHTML?.slice(0, 500_000) || '',
  };
  const nextKey = `${info.url}\n${info.title}\n${info.visibleText.length}\n${info.html.length}`;
  if (nextKey === lastPageInfoKey) return;
  lastPageInfoKey = nextKey;

  chrome.runtime.sendMessage({
    type: 'page_info',
    info,
  });
}
