'use strict';

/** electron-updater's inherited timeout waits for Node's `socket` event, which
 * Electron ClientRequest never emits. Keep its executor (proxy, redirects,
 * cancellation and checksum handling), replacing only that ineffective hook. */
function installUpdateRequestTimeout(executor, { idleTimeoutMs = 60_000 } = {}) {
  if (!executor || typeof executor.addTimeOutHandler !== 'function') {
    throw new Error('The update HTTP executor does not support request timeouts.');
  }
  executor.addTimeOutHandler = (request, callback, requestedTimeout = idleTimeoutMs) => {
    const timeoutMs = Math.min(requestedTimeout, idleTimeoutMs);
    let timer;
    let response;
    let finished = false;
    function cleanup() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      request.removeListener('response', onResponse);
      for (const event of ['abort', 'error']) request.removeListener(event, cleanup);
      response?.removeListener('data', progress);
      for (const event of ['end', 'close', 'aborted', 'error']) response?.removeListener(event, cleanup);
    }
    function progress() {
      if (finished) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        cleanup();
        const error = Object.assign(new Error(`Update request received no data for ${timeoutMs / 1000} seconds.`), { code: 'ETIMEDOUT' });
        // Report the timeout before abort emits its less specific error.
        try { callback(error); } finally { request.abort(); }
      }, timeoutMs);
      timer.unref?.();
    }
    function onResponse(incoming) {
      response = incoming;
      progress();
      response.on('data', progress);
      for (const event of ['end', 'close', 'aborted', 'error']) response.once(event, cleanup);
    }
    // ClientRequest is writable: `close` can follow upload completion while the
    // response is still pending. Only response completion or cancellation ends it.
    request.once('response', onResponse);
    for (const event of ['abort', 'error']) request.once(event, cleanup);
    progress();
  };
}

module.exports = { installUpdateRequestTimeout };
