import { z } from 'zod';

/**
 * The review window's wire contract with main.
 *
 * Every channel resolves its draft from the IPC sender, so no request names a
 * draft, a window, or a path. Responses carry the service's safe review model
 * and bounded previews only; the shapes here are the ones
 * `electron/bug-report-service.cjs` and `electron/bug-report-handoff.cjs`
 * already produce, and the error envelope is theirs too.
 */
export const BUG_REPORT_REVIEW_CHANNEL = Object.freeze({
  DISCARD: 'bug-report-review:discard',
  EXCLUDE_ARTIFACT: 'bug-report-review:exclude-artifact',
  GET: 'bug-report-review:get',
  GET_ARTIFACT_PREVIEW: 'bug-report-review:get-artifact-preview',
  INCLUDE_ARTIFACT: 'bug-report-review:include-artifact',
  OPEN_GITHUB: 'bug-report-review:open-github',
  PREPARE: 'bug-report-review:prepare',
  REOPEN: 'bug-report-review:reopen',
  SAVE_ARTIFACTS: 'bug-report-review:save-artifacts',
  UPDATE_DESCRIPTION: 'bug-report-review:update-description',
});

const BUG_REPORT_MAX_FIELD_LENGTH = 12_000;

const idSchema = z.string().min(1).max(256);
const isoTimestampSchema = z.string().datetime();
const countSchema = z.number().int().nonnegative();
const fieldSchema = z.string().max(BUG_REPORT_MAX_FIELD_LENGTH);

const bugReportArtifactKindSchema = z.enum(['screenshot', 'log', 'diagnostics']);

export const bugReportDescriptionSchema = z
  .object({ problem: fieldSchema, reproduction: fieldSchema })
  .strict();

/** Artifact channels take the bare opaque id, as the legacy review page already sends. */
export const bugReportArtifactIdSchema = idSchema;

const bugReportErrorCodeSchema = z.enum([
  'ARTIFACT_UNAVAILABLE',
  'DOWNLOADS_FAILED',
  'FORBIDDEN',
  'GITHUB_OPEN_FAILED',
  'INVALID_ARTIFACT',
  'INVALID_DESCRIPTION',
  'INVALID_DRAFT',
  'INVALID_OWNER',
  'INVALID_REQUEST',
  'INVALID_STATE',
  'NOT_FOUND',
  'PREPARE_FAILED',
  'PRIVACY_CHECK_FAILED',
  'REVIEW_ALREADY_BOUND',
  'SAVE_FAILED',
  'UNAVAILABLE',
]);

const bugReportErrorSchema = z
  .object({
    code: bugReportErrorCodeSchema,
    message: z.string().trim().min(1).max(240),
  })
  .strict();

const preparedCountSchema = z.object({ artifactCount: countSchema }).strict();

const screenshotSummarySchema = z
  .object({
    byteLength: countSchema,
    height: z.number().int().positive(),
    mimeType: z.literal('image/png'),
    width: z.number().int().positive(),
  })
  .strict();

const logSummarySchema = z
  .object({
    byteLength: countSchema,
    redactionCount: countSchema,
    truncated: z.boolean(),
  })
  .strict();

const bugReportDiagnosticsDetailsSchema = z
  .object({
    appName: z.string(),
    appVersion: z.string(),
    architecture: z.string(),
    capturedAt: isoTimestampSchema,
    electronVersion: z.string(),
    mode: z.enum(['Packaged', 'Development']),
    platform: z.string(),
    platformRelease: z.string(),
  })
  .strict();

const artifactBase = {
  available: z.boolean(),
  id: idSchema,
  included: z.boolean(),
};

/** One checklist row. `summary`/`details` are present exactly when the
 *  artifact is available; an unavailable row is the bare base. */
const bugReportReviewArtifactSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...artifactBase,
      kind: z.literal('screenshot'),
      summary: screenshotSummarySchema.optional(),
    })
    .strict(),
  z
    .object({ ...artifactBase, kind: z.literal('log'), summary: logSummarySchema.optional() })
    .strict(),
  z
    .object({
      ...artifactBase,
      details: bugReportDiagnosticsDetailsSchema.nullable().optional(),
      kind: z.literal('diagnostics'),
    })
    .strict(),
]);

const bugReportApprovedReportSchema = z
  .object({
    approvedAt: isoTimestampSchema,
    artifacts: z.array(z.object({ id: idSchema, kind: bugReportArtifactKindSchema }).strict()),
    description: bugReportDescriptionSchema,
    state: z.literal('approved'),
  })
  .strict();

export const bugReportReviewModelSchema = z
  .object({
    approval: bugReportApprovedReportSchema.nullable(),
    artifacts: z.array(bugReportReviewArtifactSchema),
    createdAt: isoTimestampSchema,
    description: bugReportDescriptionSchema,
    state: z.enum(['reviewing', 'approved']),
    updatedAt: isoTimestampSchema,
  })
  .strict();

/** The bounded safe preview: a PNG data URL or sanitized text, never bytes
 *  beyond what the service already retains for approval. */
const bugReportArtifactPreviewSchema = z.discriminatedUnion('kind', [
  z
    .object({
      byteLength: countSchema,
      dataUrl: z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/u),
      height: z.number().int().positive(),
      kind: z.literal('screenshot'),
      mimeType: z.literal('image/png'),
      width: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      byteLength: countSchema,
      kind: z.literal('log'),
      redactionCount: countSchema,
      text: z.string(),
      truncated: z.boolean(),
    })
    .strict(),
  z
    .object({ details: bugReportDiagnosticsDetailsSchema, kind: z.literal('diagnostics') })
    .strict(),
]);

const failure = <Extra extends z.ZodRawShape>(extra: Extra) =>
  z.object({ error: bugReportErrorSchema, ok: z.literal(false), ...extra }).strict();

const bugReportReviewFailureSchema = failure({});

export const bugReportReviewDraftResponseSchema = z.discriminatedUnion('ok', [
  z.object({ draft: bugReportReviewModelSchema, ok: z.literal(true) }).strict(),
  bugReportReviewFailureSchema,
]);

export const bugReportArtifactPreviewResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), preview: bugReportArtifactPreviewSchema }).strict(),
  bugReportReviewFailureSchema,
]);

/** Approval and materialization are one request. A failure that still
 *  carries `report` means the snapshot is approved but its files were not
 *  prepared; the window offers a retry rather than a fresh approval. */
export const bugReportPrepareResponseSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      prepared: preparedCountSchema,
      report: bugReportApprovedReportSchema,
    })
    .strict(),
  failure({
    prepared: preparedCountSchema.optional(),
    report: bugReportApprovedReportSchema.optional(),
  }),
]);

export const bugReportOpenGitHubResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), prepared: preparedCountSchema }).strict(),
  failure({ prepared: preparedCountSchema.optional() }),
]);

export const bugReportSaveArtifactsResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), saved: preparedCountSchema }).strict(),
  failure({ prepared: preparedCountSchema.optional() }),
]);

export const bugReportDiscardResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }).strict(),
  bugReportReviewFailureSchema,
]);

export type BugReportDescription = z.infer<typeof bugReportDescriptionSchema>;
export type BugReportError = z.infer<typeof bugReportErrorSchema>;
export type BugReportErrorCode = z.infer<typeof bugReportErrorCodeSchema>;
export type BugReportReviewArtifact = z.infer<typeof bugReportReviewArtifactSchema>;
export type BugReportReviewModel = z.infer<typeof bugReportReviewModelSchema>;
export type BugReportApprovedReport = z.infer<typeof bugReportApprovedReportSchema>;
export type BugReportArtifactPreview = z.infer<typeof bugReportArtifactPreviewSchema>;
export type BugReportReviewDraftResponse = z.infer<typeof bugReportReviewDraftResponseSchema>;
export type BugReportArtifactPreviewResponse = z.infer<
  typeof bugReportArtifactPreviewResponseSchema
>;
export type BugReportPrepareResponse = z.infer<typeof bugReportPrepareResponseSchema>;
export type BugReportOpenGitHubResponse = z.infer<typeof bugReportOpenGitHubResponseSchema>;
export type BugReportSaveArtifactsResponse = z.infer<typeof bugReportSaveArtifactsResponseSchema>;
export type BugReportDiscardResponse = z.infer<typeof bugReportDiscardResponseSchema>;
