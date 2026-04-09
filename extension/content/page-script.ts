import {
  MAX_CAPTURED_BODY_BYTES,
  isCapturableResponseContentType,
  isKnownContentLengthWithinLimit,
  readResponseBodyPreview,
  shouldCaptureXhrBody,
} from './capture-utils';

// Page-script: runs in the page's JS context (not isolated world)
// Monkey-patches fetch and XHR to capture bounded response-body previews.

(function () {
  const CAPTURE_RESPONSE_BODIES_DATASET_KEY = 'claudechromeCaptureResponseBodies';

  const POST = (type: string, data: any) => {
    window.postMessage({ source: 'claudechrome-page', type, ...data }, '*');
  };

  const shouldCaptureResponseBodies = () =>
    document.documentElement?.dataset[CAPTURE_RESPONSE_BODIES_DATASET_KEY] === '1';

  const resolveCapturedUrl = (value: string | URL) => {
    try {
      return new URL(String(value), window.location.href).toString();
    } catch {
      return String(value);
    }
  };

  const getFetchRequestMeta = (args: Parameters<typeof fetch>) => {
    const [input, init] = args;
    let method = typeof init?.method === 'string' && init.method
      ? init.method
      : 'GET';
    let url = '';

    if (typeof input === 'string') {
      url = resolveCapturedUrl(input);
    } else if (input instanceof URL) {
      url = resolveCapturedUrl(input);
    } else if (input && typeof input === 'object') {
      const request = input as Request;
      if (typeof request.url === 'string') {
        url = resolveCapturedUrl(request.url);
      }
      if ((!init?.method || typeof init.method !== 'string') && typeof request.method === 'string' && request.method) {
        method = request.method;
      }
    }

    return { method, url };
  };

  // --- Patch fetch ---
  const origFetch = window.fetch;
  window.fetch = async function (...args: Parameters<typeof fetch>) {
    const { method, url } = getFetchRequestMeta(args);

    try {
      const resp = await origFetch.apply(this, args);
      if (!shouldCaptureResponseBodies()) {
        return resp;
      }

      const contentType = resp.headers.get('content-type') || '';
      const contentLength = resp.headers.get('content-length');
      if (!isCapturableResponseContentType(contentType) || !isKnownContentLengthWithinLimit(contentLength)) {
        return resp;
      }

      const clone = resp.clone();
      void readResponseBodyPreview(clone, MAX_CAPTURED_BODY_BYTES)
        .then((body) => {
          if (!body) {
            return;
          }
          POST('captured_body', { url, method, body });
        })
        .catch(() => {});
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
    (this as any).__cc_url = resolveCapturedUrl(url);
    return origOpen.apply(this, [method, url, ...rest] as any);
  };

  XMLHttpRequest.prototype.send = function (body?: any) {
    this.addEventListener('load', function () {
      try {
        if (!shouldCaptureResponseBodies()) {
          return;
        }

        const contentType = this.getResponseHeader('content-type') || '';
        const contentLength = this.getResponseHeader('content-length');
        if (!shouldCaptureXhrBody(contentType, contentLength, MAX_CAPTURED_BODY_BYTES)) {
          return;
        }

        const text = typeof this.responseText === 'string'
          ? this.responseText.slice(0, MAX_CAPTURED_BODY_BYTES)
          : '';
        if (!text) {
          return;
        }

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
