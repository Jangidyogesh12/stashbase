# Semantic Retrieval Evaluation

**Status: deferred.** The implementation remains available for future
reassessment, but its dataset, relevance judgments, and thresholds have not been
validated as a reliable measure of semantic retrieval quality. It is not a
release gate or a required baseline-collection task. See
[J05](../../code-review/journey-coverage.md#j05-search) for the evidence gap and
deferral decision.

The experimental command scores meaning-based retrieval separately from
deterministic retrieval correctness. To inspect it, run from the repository root:

```bash
pnpm eval:semantic-retrieval
pnpm eval:semantic-retrieval --out release.nosync/j05-openai-1.txt
```

The command uses the OpenAI or OpenRouter key already saved in **StashBase
Settings > Search by Meaning**. It does not read credentials from environment variables,
launch Electron, touch the user's projects, or reuse the product vector store.
It creates an isolated temporary project and store, indexes the versioned
fixtures through `MfsIndexer`, and searches through the production Retrieval
Interface. Prepared PDF fixtures also publish completed text under isolated
AppData so retrieval exercises the production source-availability checks.
The temporary data is removed after the run. `--out` additionally
writes the report to a file for inspection; the report never contains a
credential.

## Dataset and scoring

`v1/dataset.json` owns the dataset version, corpus manifest, natural-language
queries, relevance judgments, `K`, thresholds, and baseline records. Its 22
synthetic documents contain no user data. Twenty-two paraphrased judgments
cover multiple intents for direct Markdown, HTML, JSON, and PDF source identity
backed by prepared Markdown evidence. Semantic retrieval is evaluated at K=3 so
plausible distractors materially affect both retrieval and rank.

Retrieval ranks **chunks**, not documents. The runner therefore asks the index
for `topK * CHUNK_FETCH_MULTIPLIER` chunks and collapses them to distinct
sources before scoring, so K always counts documents and one long source cannot
occupy every slot. `scripts/semantic-retrieval-metrics.ts` rejects a ranking
that still repeats a source, which keeps that collapse from silently
regressing.

The corpus deliberately mixes short single-chunk notes with sources long enough
to split across several chunks — `corpus/facilities-handbook.md`,
`corpus/onboarding-handbook.md`, and the prepared `prepared/field-guide.md` —
and judges queries against a specific section of each. These fixtures let the
command exercise chunking as well as retrieval over short documents.

The report names the dataset schema/version, commit, provider, model, Recall@K,
and mean reciprocal rank (MRR). Each query prints its acceptable source set,
ordered semantic results, and—where a deliberately paraphrased query
makes the contrast useful—keyword results. Misses therefore show both the
expected evidence and unexpected top results. A report produced from a dirty
working tree says so, because the commit it names is then not what ran.

Version 1's proposed aggregate thresholds are:

- Recall@3 >= 0.90
- MRR >= 0.80

Every judgment names exactly one acceptable source, so Recall@3 takes values of
`k/22`: 0.90 allows **at most two complete misses** out of twenty-two queries
(20/22 = 0.909, 19/22 = 0.864). Read the thresholds as that miss budget rather
than as generous tolerance — they absorb rank movement, not a systematic
regression. Provider responses and ranking can vary slightly, so the gate uses
aggregate thresholds rather than requiring a fixed order or a perfect score.
Change the dataset version whenever corpus meaning or relevance judgments
change. A threshold change requires review with the result that motivated it;
do not lower a threshold merely to accept a regression.

The command reports `CALIBRATION` and does not fail on quality thresholds until
the dataset contains at least three retained baseline runs for each supported
BYOK path, OpenAI and OpenRouter. This describes the existing command's
mechanics, not an approved quality gate. If reassessment retains this approach,
calibration would require three retained reports per provider, with each run's
provider, exact model, date, unique evidence reference, Recall@3, and MRR recorded
in `baselineRuns`. The method and collected distributions would need review
before adopting any thresholds.
The dataset parser rejects duplicate run IDs, unknown providers, invalid
metrics, malformed dates, and judgments that name more acceptable sources than
K has slots. Baseline records must never contain credentials.

Baselines are keyed by provider **and exact model**, so configuring a model the
dataset has no baseline for returns the run to `CALIBRATION` and the process
exit status stops gating. That is deliberate — an unmeasured model has no
baseline to be judged against. Neither state nor a passing exit status establishes
that this evaluation is a reliable quality measure.

## Execution placement

The command is optional experimental tooling, with no required source CI,
scheduled CI, or release execution. It makes paid external embedding requests
and depends on a locally authorized BYOK provider. Quality evaluation is deferred
until its method is reassessed; collecting the existing six baseline runs alone
would not establish reliability or activate a release requirement.

`pnpm test:server` covers the metrics, manifest, and runner deterministically
and parses the shipped `v1` manifest against its fixtures, so corpus drift is
caught without credentials.
