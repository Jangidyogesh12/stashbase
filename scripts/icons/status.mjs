// Native status marks derive from the same application SVG. Called by the icon
// build so shipped tray rasters stay reproducible, including Retina templates.
import { BrowserWindow } from 'electron';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function renderStatusIcons() {
  // Fixed, theme-independent badge hue from renderer/src/globals.css (--badge-red).
  const red = '#ef4444';
  const source = await readFile(new URL('../../build/icon.svg', import.meta.url), 'utf8');
  const directory = fileURLToPath(new URL('../../electron/notifications/icons/', import.meta.url));
  await mkdir(directory, { recursive: true });
  const win = new BrowserWindow({ width: 128, height: 128, show: false, frame: false,
    transparent: true, backgroundColor: '#00000000', webPreferences: { offscreen: true, sandbox: true } });
  const render = async (name, svg) => {
    await win.loadURL(`data:text/html,${encodeURIComponent(`<style>body{margin:0;background:transparent}svg{width:128px;height:128px;display:block}</style>${svg}`)}`);
    await win.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const image = await win.capturePage();
    for (const scale of [1, 2]) await writeFile(`${directory}${name}${scale === 2 ? '@2x' : ''}.png`, image.resize({ width: 18 * scale, height: 18 * scale, quality: 'best' }).toPNG());
  };
  try {
    for (const template of [false, true]) for (const state of ['idle', 'working', 'attention']) {
      let svg = source;
      if (template) svg = svg.replace(/<rect[^>]+\/>/, '').replace(/#[a-f0-9]{6}/gi, '#000000');
      const active = state !== 'idle';
      // A transparent moat separates the 3.4px dot from the mark on every surface.
      // Template images keep this geometry while macOS supplies contrast/tint.
      const marker = !active ? '' : `<circle cx="430" cy="82" r="48" fill="${state === 'attention' ? (template ? '#000' : red) : 'none'}" stroke="${template ? '#000' : '#737373'}" stroke-width="${state === 'working' ? 22 : 0}"/>`;
      const mask = '<defs><mask id="mark"><rect width="512" height="512" fill="white"/><circle cx="430" cy="82" r="78" fill="black"/></mask></defs>';
      svg = svg.replace(/(<svg[^>]*>)/, `$1${active ? mask : ''}<g${active ? ' mask="url(#mark)"' : ''}>`)
        .replace('<g stroke=', '<g transform="translate(0 32) scale(.9)"><g stroke=')
        .replace('</svg>', `</g></g>${marker}</svg>`);
      await render(`${state}${template ? 'Template' : ''}`, svg);
    }
    await render('badge', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><circle cx="256" cy="256" r="196" fill="${red}" stroke="white" stroke-width="40"/></svg>`);
  } finally { win.destroy(); }
}
