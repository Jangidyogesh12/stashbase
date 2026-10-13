// Compares runs by label, showing each numeric metric as a min–max range.
//
//   node scripts/profiling/compare.mjs <scenario> [--labels before,after]

import fs from "node:fs";
import path from "node:path";

import { parseArguments, profilingDirectory } from "./harness.mjs";

const [scenario, ...rest] = process.argv.slice(2);
if (!scenario) throw new Error("Usage: compare.mjs <scenario> [--labels before,after]");
const options = parseArguments(rest, { labels: "" });

const resultsFile = path.join(profilingDirectory(scenario), "results.jsonl");
if (!fs.existsSync(resultsFile)) throw new Error(`No results yet: ${resultsFile}`);
const results = fs.readFileSync(resultsFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));

function numericMetrics(value, prefix = "", metrics = {}) {
  for (const [key, entry] of Object.entries(value)) {
    if (key === "run") continue;
    const name = prefix ? `${prefix}.${key}` : key;
    if (typeof entry === "number") metrics[name] = entry;
    else if (typeof entry === "boolean") metrics[name] = Number(entry);
    else if (entry && typeof entry === "object" && !Array.isArray(entry)) numericMetrics(entry, name, metrics);
  }
  return metrics;
}

const labels = options.labels ? options.labels.split(",") : [...new Set(results.map((result) => result.label))];
const byLabel = new Map(labels.map((label) => [label, results.filter((result) => result.label === label)]));
const metricNames = [...new Set(results.flatMap((result) => Object.keys(numericMetrics(result))))];

const range = (values) => {
  if (values.length === 0) return "—";
  const low = Math.min(...values);
  const high = Math.max(...values);
  return low === high ? String(low) : `${low}–${high}`;
};

const rows = [
  ["", ...labels.map((label) => `${label} (${byLabel.get(label).length})`)],
  ["revision", ...labels.map((label) => [...new Set(byLabel.get(label).map((result) => result.revision))].join(", "))],
  ...metricNames.map((name) => [
    name,
    ...labels.map((label) => range(byLabel.get(label).map((result) => numericMetrics(result)[name]).filter((value) => value !== undefined))),
  ]),
];
const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
for (const row of rows) console.log(row.map((cell, column) => cell.padEnd(widths[column])).join("  "));
if (results.some((result) => result.cpuProfiled)) {
  console.log("\nSome runs were CPU-profiled; profiling slows the renderer, so compare them only with each other.");
}
