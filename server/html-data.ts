/** The sandbox receives only the data RPC client, never the application preload. */
export function injectHtmlDataClient(html: string): string {
  const script = `<script>
(function () {
  var pending = new Map(), nextId = 0, readyResolve;
  var ready = new Promise(function (resolve) { readyResolve = resolve; });
  window.addEventListener('message', function (event) {
    if (event.source !== window.parent || !event.data) return;
    var message = event.data;
    if (message.type === 'stashbase-data-ready') { readyResolve(); return; }
    if (message.type !== 'stashbase-data-result') return;
    var entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error));
    else entry.resolve(message.value);
  });
  function request(method, content, path) {
    var run = function () {
      return ready.then(function () {
        return new Promise(function (resolve, reject) {
          var id = ++nextId;
          pending.set(id, { resolve: resolve, reject: reject });
          window.parent.postMessage({ type: 'stashbase-data-request', id: id, method: method, content: content, path: path }, '*');
        });
      });
    };
    return run();
  }
  var data = Object.freeze({
    load: function (path) { return request('load', undefined, path); },
    update: function (value) {
      try {
        var content = JSON.stringify(value, function (key, item) {
          if (typeof item === 'undefined' || typeof item === 'function' || typeof item === 'symbol' ||
              (typeof item === 'number' && !Number.isFinite(item))) throw new Error('Data must contain only JSON values.');
          return item;
        });
        if (typeof content !== 'string') throw new Error('Data must be a JSON value.');
        return request('update', content);
      } catch (error) { return Promise.reject(error); }
    },
    save: function () { return request('save'); }
  });
  Object.defineProperty(window, 'stashbase', { value: Object.freeze({ data: data }), configurable: false, writable: false });
})();
</script>`.replace(/\n\s*/g, ' ');
  // Prepend to authored markup (after the doctype) so even a script before
  // <head> sees the API. It joins the doctype's line, so authored line
  // numbers stay those of the file. The original file is never modified.
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  const at = doctype?.[0].length ?? 0;
  return html.slice(0, at) + script + html.slice(at);
}
