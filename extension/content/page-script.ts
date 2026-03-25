// Page-script: runs in the page's JS context (not isolated world)
// Monkey-patches fetch and XHR to capture request/response bodies

(function () {
  const POST = (type: string, data: any) => {
    window.postMessage({ source: 'claudechrome-page', type, ...data }, '*');
  };

  // --- Patch fetch ---
  const origFetch = window.fetch;
  window.fetch = async function (...args: Parameters<typeof fetch>) {
    const req = new Request(...args);
    const method = req.method;
    const url = req.url;

    try {
      const resp = await origFetch.apply(this, args);
      const clone = resp.clone();
      // Read body async, don't block
      clone.text().then((body) => {
        POST('captured_body', { url, method, body: body.slice(0, 500_000) });
      }).catch(() => {});
      return resp;
    } catch (e) {
      throw e;
    }
  };

  // --- Patch XMLHttpRequest ---
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...rest: any[]) {
    (this as any).__cc_method = method;
    (this as any).__cc_url = String(url);
    return origOpen.apply(this, [method, url, ...rest] as any);
  };

  XMLHttpRequest.prototype.send = function (body?: any) {
    this.addEventListener('load', function () {
      try {
        const text = typeof this.responseText === 'string'
          ? this.responseText.slice(0, 500_000)
          : '';
        POST('captured_body', {
          url: (this as any).__cc_url,
          method: (this as any).__cc_method,
          body: text,
        });
      } catch {}
    });
    return origSend.apply(this, [body]);
  };

  // --- Intercept console ---
  const levels = ['log', 'warn', 'error', 'info', 'debug'] as const;
  for (const level of levels) {
    const orig = console[level];
    console[level] = function (...args: any[]) {
      try {
        POST('console_entry', {
          entry: {
            level,
            message: args.map(a => {
              try { return typeof a === 'string' ? a : JSON.stringify(a); }
              catch { return String(a); }
            }).join(' '),
            timestamp: Date.now(),
          },
        });
      } catch {}
      return orig.apply(this, args);
    };
  }
})();
