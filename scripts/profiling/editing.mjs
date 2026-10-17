// Typing in a long Markdown document. See scripts/profiling/README.md.
//
//   node scripts/profiling/editing.mjs --label after [--runs 2] [--cpu-profile]

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { startCpuProfile, stopCpuProfile, printSummary } from "./cpu-profile.mjs";
import { writeEditingProject } from "./fixtures.mjs";
import { launchApp, parseArguments, profilingDirectory, sourceRevision } from "./harness.mjs";

const TEXT = "the quick brown fox jumps over the lazy dog again and again..";
const KEY_INTERVAL_MS = 80; // about 12 characters per second
const SETTLE_MS = 10_000; // long enough for the held edit, autosave, and refreshes

const options = parseArguments(process.argv.slice(2), { label: "", runs: 2, "cpu-profile": false });
if (!options.label) throw new Error("Pass --label, for example --label before or --label after.");

const workDirectory = profilingDirectory("editing");
const projectDirectory = path.join(workDirectory, "project");
const resultsFile = path.join(workDirectory, "results.jsonl");
const fixture = writeEditingProject(projectDirectory);
const originalCopy = path.join(workDirectory, "big.orig.md");
fs.writeFileSync(originalCopy, fixture.original);

function changedLines() {
  // `git diff --no-index` exits 1 when the files differ.
  let numstat = "";
  try {
    numstat = execFileSync("git", ["diff", "--no-index", "--numstat", originalCopy, fixture.documentPath], { encoding: "utf8" });
  } catch (error) {
    numstat = error.stdout;
  }
  const [added = 0, removed = 0] = numstat.trim().split(/\s+/u).map(Number);
  return { added, removed };
}

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
const round = (value) => Math.round(value * 10) / 10;

async function measure(app, run) {
  const { window } = app;
  fs.writeFileSync(fixture.documentPath, fixture.original);
  await window.reload();

  await window.waitFor(
    `[...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '${fixture.documentName}')`,
    { what: `${fixture.documentName} in the project tree` },
  );
  await window.evaluate(
    `[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '${fixture.documentName}').click()`,
  );
  await window.waitFor(
    `document.querySelector('.ProseMirror[contenteditable=true]') && document.querySelector('[data-markdown-state]')?.dataset.markdownState === 'ready'`,
    { what: "the Markdown editor to be ready" },
  );
  await delay(2000);

  // Caret at offset 5 of the middle paragraph.
  const paragraphs = await window.evaluate(`(() => {
    const editor = document.querySelector('.ProseMirror');
    const all = editor.querySelectorAll('p');
    const paragraph = all[Math.floor(all.length / 2)];
    paragraph.scrollIntoView({ block: 'center' });
    editor.focus();
    const range = document.createRange();
    range.setStart(paragraph.firstChild, 5);
    range.collapse(true);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    return all.length;
  })()`);
  await delay(500);

  // Latency: input event → next animation frame → the task after it, which
  // approximates when the frame showing the character is committed.
  await window.evaluate(`(() => {
    window.__profiling = { start: performance.now(), latencies: [], longTasks: [] };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__profiling.longTasks.push([Math.round(entry.startTime - window.__profiling.start), Math.round(entry.duration)]);
      }
    }).observe({ type: 'longtask' });
    window.addEventListener('beforeinput', () => {
      const t0 = performance.now();
      requestAnimationFrame(() => setTimeout(() => window.__profiling.latencies.push(performance.now() - t0)));
    }, true);
  })()`);

  const requests = [];
  await window.send("Network.enable");
  const stopListening = window.on((message) => {
    if (message.method !== "Network.requestWillBeSent") return;
    const { pathname } = new URL(message.params.request.url);
    if (pathname.startsWith("/api/")) requests.push({ pathname, method: message.params.request.method, at: Date.now() });
  });
  let sessionFileEvents = 0;
  // Watch the directory: the session file may not exist yet, and atomic
  // writes replace it.
  const sessionName = path.basename(app.sessionFile);
  const watcher = fs.watch(path.dirname(app.sessionFile), (_event, name) => {
    if (name === sessionName) sessionFileEvents++;
  });

  const typingStarted = Date.now();
  const profileFile = path.join(workDirectory, `${options.label}-${run}.cpuprofile`);
  if (options["cpu-profile"]) await startCpuProfile(window);
  await window.type(TEXT, KEY_INTERVAL_MS);
  await delay(SETTLE_MS);
  const profile = options["cpu-profile"] ? await stopCpuProfile(window, profileFile) : undefined;

  watcher.close();
  stopListening();
  await window.send("Network.disable");
  const { latencies, longTasks } = await window.evaluate("window.__profiling");
  if (latencies.length === 0) throw new Error("No keystrokes reached the editor. Check that the window has focus.");

  const sorted = [...latencies].sort((a, b) => a - b);
  const isTreeReload = (request) => request.pathname === "/api/files" && request.method === "GET";
  const count = (predicate) => requests.filter(predicate).length;
  return {
    result: {
      scenario: "editing",
      label: options.label,
      run,
      revision: sourceRevision(),
      at: new Date().toISOString(),
      cpuProfiled: options["cpu-profile"],
      indexSettled,
      paragraphs,
      keys: latencies.length,
      latencyMs: {
        p50: round(percentile(sorted, 0.5)),
        p90: round(percentile(sorted, 0.9)),
        max: round(sorted.at(-1)),
      },
      longTasks: {
        count: longTasks.length,
        totalMs: longTasks.reduce((sum, [, duration]) => sum + duration, 0),
        startAndDurationMs: longTasks,
      },
      treeReloads: count(isTreeReload),
      treeReloadsAtMs: requests.filter(isTreeReload).map((request) => request.at - typingStarted),
      saves: count((request) => request.pathname.startsWith("/api/files/") && ["PUT", "POST"].includes(request.method)),
      sessionFileEvents,
      savedTyping: fs.readFileSync(fixture.documentPath, "utf8").includes(TEXT.slice(0, 40)),
      savedFileChangedLines: changedLines(),
    },
    profile,
    profileFile,
  };
}

let indexSettled = false;
const app = await launchApp({ workDirectory });
try {
  await app.openProject(projectDirectory);
  // Measure typing, not the first index of a freshly generated project.
  // Without a working Python environment nothing indexes; runs still measure
  // typing but miss the indexing that follows each save.
  indexSettled = await app.window
    .waitFor(`fetch('/api/index-status').then((response) => response.json()).then((status) => status.total >= ${fixture.markdownFiles})`, {
      timeoutMs: 120_000,
    })
    .then(() => true, () => false);
  if (!indexSettled) console.warn(`Indexing did not finish; see ${app.logDirectory}/host.log.`);
  for (let run = 1; run <= options.runs; run++) {
    const { result, profile, profileFile } = await measure(app, run);
    fs.appendFileSync(resultsFile, `${JSON.stringify(result)}\n`);
    const { latencyMs, longTasks, treeReloads, saves, savedFileChangedLines } = result;
    console.log(
      `${options.label} #${run}: p50 ${latencyMs.p50} ms, p90 ${latencyMs.p90} ms, ` +
        `${longTasks.count} long tasks (${longTasks.totalMs} ms), ${treeReloads} tree reloads, ${saves} saves, ` +
        `saved diff +${savedFileChangedLines.added} -${savedFileChangedLines.removed}`,
    );
    if (profile) {
      console.log(`CPU profile: ${profileFile}`);
      printSummary(profile, { top: 15 });
    }
  }
  console.log(`Results appended to ${resultsFile}`);
} finally {
  await app.stop();
}
