/** Ordinary, self-contained authored HTML. The host injects only the data client. */
export const BLANK_INTERACTIVE_NOTE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Untitled note</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; color: light-dark(#27272a, #e4e4e7); background: light-dark(#fafafa, #18181b); }
    * { box-sizing: border-box; }
    body { margin: 0; }
    main { max-width: 760px; margin: 0 auto; padding: 40px 32px; }
    header { display: flex; align-items: center; justify-content: flex-end; gap: 16px; margin-bottom: 32px; }
    #status { font-size: 13px; color: light-dark(#71717a, #a1a1aa); }
    #status[data-error] { color: light-dark(#b91c1c, #fca5a5); }
    button { font: inherit; font-size: 14px; border: 1px solid light-dark(#d4d4d8, #52525b); border-radius: 8px; background: transparent; color: inherit; padding: 7px 16px; cursor: pointer; }
    button:disabled { cursor: default; opacity: .5; }
    input, textarea { display: block; width: 100%; border: 0; background: transparent; color: inherit; resize: vertical; }
    input { font: 600 30px/1.4 system-ui, sans-serif; margin-bottom: 24px; }
    textarea { font: 17px/1.75 system-ui, sans-serif; min-height: 60vh; }
    input:focus, textarea:focus { outline: none; }
    :focus-visible { outline: 2px solid #71717a; outline-offset: 4px; }
    ::placeholder { color: light-dark(#a1a1aa, #71717a); }
    @media (max-width: 480px) { main { padding: 24px 20px; } }
  </style>
</head>
<body>
  <main>
    <header><span id="status" role="status">Loading…</span></header>
    <input id="title" aria-label="Note title" placeholder="Untitled" autocomplete="off" disabled>
    <textarea id="body" aria-label="Note content" placeholder="Start writing…" disabled></textarea>
  </main>
  <script>
    const title = document.getElementById('title');
    const body = document.getElementById('body');
    const status = document.getElementById('status');
    let pending = Promise.resolve();
    let revision = 0;
    let idle;
    function report(message, error = false) {
      status.textContent = message;
      status.toggleAttribute('data-error', error);
    }
    async function start() {
      try {
        const data = (await stashbase.data.load('./assets/note.json')) ?? { title: '', body: '' };
        if (typeof data.title !== 'string' || typeof data.body !== 'string') throw new Error('This note needs title and body text. Open its data file to check the content.');
        title.value = data.title;
        body.value = data.body;
        title.disabled = body.disabled = false;
        report('Saved');
      } catch (error) { report(error.message, true); }
    }
    function changed() {
      revision++;
      report('Saving…');
      const value = { title: title.value, body: body.value };
      pending = pending.catch(() => undefined).then(() => stashbase.data.update(value));
      clearTimeout(idle);
      idle = setTimeout(save, 600);
    }
    // StashBase writes each update shortly after it; this save only confirms it.
    async function save() {
      const saving = revision;
      try {
        await pending;
        await stashbase.data.save();
        if (saving === revision) report('Saved');
      } catch (error) { report(error.message, true); }
    }
    title.addEventListener('input', changed);
    body.addEventListener('input', changed);
    start();
  </script>
</body>
</html>
`;
