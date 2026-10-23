// PDF raster backing storage across zoom, scrolling and close. No private files.
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { launchApp, parseArguments, profilingDirectory, sourceRevision } from './harness.mjs';

const options = parseArguments(process.argv.slice(2), { label: '', runs: 2 });
if (!options.label) throw new Error('Pass --label before or --label after.');
const workDirectory = profilingDirectory('pdf-memory');
const project = path.join(workDirectory, 'project');
fs.mkdirSync(project, { recursive: true });
const pages = 12;
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  `<< /Type /Pages /Count ${pages} /Kids [${Array.from({ length: pages }, (_, i) => `${i + 4} 0 R`).join(' ')}] >>`,
];
const content = '0.2 0.5 0.8 rg 40 40 532 712 re f\n';
objects.push(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
for (let i = 0; i < pages; i++) objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 3 0 R >>');
let pdf = '%PDF-1.4\n';
const offsets = [0];
objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
fs.writeFileSync(path.join(project, 'raster.pdf'), pdf);
const app = await launchApp({ workDirectory });
try {
  await app.openProject(project);
  await app.window.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false });
  for (let run = 1; run <= options.runs; run++) {
    await app.window.reload();
    await app.window.waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'raster.pdf')`);
    await app.window.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'raster.pdf').click()`);
    await app.window.waitFor(`document.querySelector('[data-page="1"] canvas')?.width > 300`);
    await app.window.evaluate(`(() => { const zoom=document.querySelector('button[aria-label="Zoom in"]'); for(let i=0;i<15;i++) zoom.click(); })()`);
    await app.window.waitFor(`document.querySelector('[data-page="1"] canvas')?.style.width === '1836px'`);
    const first = await app.window.evaluate(`(() => { const canvas=document.querySelector('[data-page="1"] canvas'); window.__pdfRetiredCanvas=canvas; return {bytes:canvas.width*canvas.height*4, cssWidth:canvas.style.width, cssHeight:canvas.style.height}; })()`);
    await app.window.evaluate(`document.querySelector('[data-page="10"]').scrollIntoView()`);
    await app.window.waitFor(`!document.querySelector('[data-page="1"] canvas') && document.querySelector('[data-page="10"] canvas')?.width > 300`);
    await delay(100);
    const retiredBytes = await app.window.evaluate(`window.__pdfRetiredCanvas.width*window.__pdfRetiredCanvas.height*4`);
    await app.window.evaluate('delete window.__pdfRetiredCanvas');
    const result = { scenario: 'pdf-memory', label: options.label, run, revision: sourceRevision(), at: new Date().toISOString(), rasterBytes: first.bytes, retiredBytes, cssWidth: first.cssWidth, cssHeight: first.cssHeight };
    fs.appendFileSync(path.join(workDirectory, 'results.jsonl'), `${JSON.stringify(result)}\n`);
    console.log(JSON.stringify(result));
  }
} finally { await app.stop(); }
