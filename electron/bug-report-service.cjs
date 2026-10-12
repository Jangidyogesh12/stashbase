'use strict';

const crypto = require('node:crypto');
const {
  prepareBugReportText,
  scanBugReportText,
} = require('./bug-report-redaction.cjs');
const {
  MAX_SCREENSHOT_BYTES,
  MAX_SCREENSHOT_EDGE,
} = require('./bug-report-screenshot.cjs');

const DRAFT_STATE = Object.freeze({
  COLLECTING: 'collecting',
  REVIEWABLE: 'reviewable',
  REVIEWING: 'reviewing',
  APPROVED: 'approved',
});

const ARTIFACT_KIND = Object.freeze({
  SCREENSHOT: 'screenshot',
  LOG: 'log',
  DIAGNOSTICS: 'diagnostics',
});

const REPORT_FIELDS = Object.freeze(['problem', 'reproduction']);
const MAX_REPORT_FIELD_LENGTH = 12_000;
const MAX_REPORT_TEXT_LENGTH = 24_000;
const MAX_LOG_PREVIEW_BYTES = 64 * 1024;

const ERROR = Object.freeze({
  INVALID_DRAFT: Object.freeze({
    code: 'INVALID_DRAFT',
    message: 'The bug report draft reference is invalid.',
  }),
  NOT_FOUND: Object.freeze({
    code: 'NOT_FOUND',
    message: 'The bug report draft is no longer available.',
  }),
  FORBIDDEN: Object.freeze({
    code: 'FORBIDDEN',
    message: 'This window cannot access that bug report draft.',
  }),
  INVALID_OWNER: Object.freeze({
    code: 'INVALID_OWNER',
    message: 'The bug report draft could not be associated with this window.',
  }),
  INVALID_STATE: Object.freeze({
    code: 'INVALID_STATE',
    message: 'That bug report action is not available in the current state.',
  }),
  INVALID_DESCRIPTION: Object.freeze({
    code: 'INVALID_DESCRIPTION',
    message: 'The bug report description is invalid or too long.',
  }),
  INVALID_ARTIFACT: Object.freeze({
    code: 'INVALID_ARTIFACT',
    message: 'The bug report artifact reference is invalid.',
  }),
  ARTIFACT_UNAVAILABLE: Object.freeze({
    code: 'ARTIFACT_UNAVAILABLE',
    message: 'That bug report artifact is unavailable.',
  }),
  PRIVACY_CHECK_FAILED: Object.freeze({
    code: 'PRIVACY_CHECK_FAILED',
    message: 'Potentially sensitive report content was excluded.',
  }),
  REVIEW_ALREADY_BOUND: Object.freeze({
    code: 'REVIEW_ALREADY_BOUND',
    message: 'The bug report draft is already being reviewed.',
  }),
  UNAVAILABLE: Object.freeze({
    code: 'UNAVAILABLE',
    message: 'The bug report service is temporarily unavailable.',
  }),
});

function copyError(error) {
  return { code: error.code, message: error.message };
}

function fail(error) {
  return { ok: false, error: copyError(error) };
}

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function createId() {
  return crypto.randomBytes(32).toString('base64url');
}

function toIso(now) {
  return new Date(now()).toISOString();
}

function prepareSafeString(value, prepareText) {
  if (typeof value !== 'string') return null;
  const prepared = prepareText(value);
  return prepared?.ok && typeof prepared.text === 'string' ? prepared.text : null;
}

function safeDiagnostics(value, prepareText) {
  if (!value || typeof value !== 'object' || !value.app || !value.os) return null;
  const { app, os } = value;
  if (
    !Number.isSafeInteger(value.schemaVersion)
    || typeof value.capturedAt !== 'string'
    || typeof app.packaged !== 'boolean'
  ) {
    return null;
  }
  const capturedAt = new Date(value.capturedAt);
  if (Number.isNaN(capturedAt.getTime()) || capturedAt.toISOString() !== value.capturedAt) return null;
  const appName = prepareSafeString(app.name, prepareText);
  const appVersion = prepareSafeString(app.version, prepareText);
  const electronVersion = prepareSafeString(app.electronVersion, prepareText);
  const platform = prepareSafeString(os.platform, prepareText);
  const release = prepareSafeString(os.release, prepareText);
  const architecture = prepareSafeString(os.arch, prepareText);
  if ([appName, appVersion, electronVersion, platform, release, architecture].includes(null)) return null;
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    capturedAt: value.capturedAt,
    app: Object.freeze({
      name: appName,
      version: appVersion,
      packaged: app.packaged,
      electronVersion,
    }),
    os: Object.freeze({
      platform,
      release,
      arch: architecture,
    }),
  });
}

function copySafeDiagnosticsView(value) {
  if (value === null) return null;
  return {
    capturedAt: value.capturedAt,
    appName: value.app.name,
    appVersion: value.app.version,
    mode: value.app.packaged ? 'Packaged' : 'Development',
    electronVersion: value.app.electronVersion,
    platform: value.os.platform,
    platformRelease: value.os.release,
    architecture: value.os.arch,
  };
}

function safeScreenshot(value) {
  if (
    !value
    || !Buffer.isBuffer(value.bytes)
    || value.bytes.length === 0
    || value.bytes.length > MAX_SCREENSHOT_BYTES
    || value.mimeType !== 'image/png'
    || !isPositiveInteger(value.width)
    || !isPositiveInteger(value.height)
    || value.width > MAX_SCREENSHOT_EDGE
    || value.height > MAX_SCREENSHOT_EDGE
  ) {
    return null;
  }
  return Object.freeze({
    bytes: Buffer.from(value.bytes),
    mimeType: 'image/png',
    width: value.width,
    height: value.height,
  });
}

function safeLog(value, scanText) {
  if (
    !value
    || typeof value.text !== 'string'
    || !Number.isSafeInteger(value.byteLength)
    || value.byteLength < 0
    || typeof value.truncated !== 'boolean'
    || !Number.isSafeInteger(value.redactionCount)
    || value.redactionCount < 0
  ) {
    return null;
  }
  const byteLength = Buffer.byteLength(value.text, 'utf8');
  if (byteLength > MAX_LOG_PREVIEW_BYTES) return null;
  const scanned = scanText(value.text);
  if (!scanned?.safe) return null;
  return Object.freeze({
    text: value.text,
    byteLength,
    truncated: value.truncated,
    redactionCount: value.redactionCount,
  });
}

function copyApprovedArtifactResource(artifact) {
  if (artifact.kind === ARTIFACT_KIND.SCREENSHOT) {
    return Object.freeze({
      bytes: Buffer.from(artifact.resource.bytes),
      mimeType: artifact.resource.mimeType,
      width: artifact.resource.width,
      height: artifact.resource.height,
    });
  }
  if (artifact.kind === ARTIFACT_KIND.LOG) {
    return Object.freeze({
      text: artifact.resource.text,
      byteLength: artifact.resource.byteLength,
      truncated: artifact.resource.truncated,
      redactionCount: artifact.resource.redactionCount,
    });
  }
  return Object.freeze({
    schemaVersion: artifact.resource.schemaVersion,
    capturedAt: artifact.resource.capturedAt,
    app: Object.freeze({ ...artifact.resource.app }),
    os: Object.freeze({ ...artifact.resource.os }),
  });
}

async function collectSafely(collector, source, normalize) {
  if (typeof collector !== 'function') return null;
  try {
    return normalize(await collector({
      webContentsId: source.webContentsId,
      windowId: source.windowId,
    }));
  } catch {
    return null;
  }
}

function isExactDescriptionPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === REPORT_FIELDS.length
    && REPORT_FIELDS.every((field) => keys.includes(field) && typeof value[field] === 'string');
}

/** Main-process authority for the complete local review lifecycle. */
function createBugReportService({
  createId: createDraftId = createId,
  createArtifactId = createId,
  createApprovalId = createId,
  now = () => Date.now(),
  captureScreenshot,
  collectDiagnostics,
  collectLog,
  prepareText = prepareBugReportText,
  scanText = scanBugReportText,
} = {}) {
  const drafts = new Map();
  const artifactIds = new Set();

  function createUniqueArtifactId() {
    const id = createArtifactId();
    if (
      typeof id !== 'string'
      || !id
      || id.length > 256
      || drafts.has(id)
      || artifactIds.has(id)
    ) {
      throw new Error('Invalid artifact identifier');
    }
    artifactIds.add(id);
    return id;
  }

  function retireDraft(draft) {
    if (!draft || drafts.get(draft.id) !== draft) return false;
    drafts.delete(draft.id);
    // reviewArtifacts is the superset while a draft is approved; artifacts set
    // aside at approval must retire with the draft, not leak their ids.
    for (const artifact of draft.reviewArtifacts ?? draft.artifacts) artifactIds.delete(artifact.id);
    return true;
  }

  function createArtifact(kind, resource) {
    const available = resource !== null;
    return {
      id: createUniqueArtifactId(),
      kind,
      available,
      included: available,
      resource,
    };
  }

  function safeDraftMetadata(draft) {
    const availability = Object.create(null);
    for (const artifact of draft.artifacts) availability[artifact.kind] = artifact.available;
    return {
      id: draft.id,
      state: draft.state,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
      available: {
        screenshot: availability.screenshot === true,
        diagnostics: availability.diagnostics === true,
        log: availability.log === true,
      },
    };
  }

  function safeReviewArtifact(artifact) {
    const base = {
      id: artifact.id,
      kind: artifact.kind,
      available: artifact.available,
      included: artifact.available && artifact.included,
    };
    if (!artifact.available) return base;
    if (artifact.kind === ARTIFACT_KIND.SCREENSHOT) {
      return {
        ...base,
        summary: {
          mimeType: artifact.resource.mimeType,
          byteLength: artifact.resource.bytes.length,
          width: artifact.resource.width,
          height: artifact.resource.height,
        },
      };
    }
    if (artifact.kind === ARTIFACT_KIND.LOG) {
      return {
        ...base,
        summary: {
          byteLength: artifact.resource.byteLength,
          truncated: artifact.resource.truncated,
          redactionCount: artifact.resource.redactionCount,
        },
      };
    }
    return {
      ...base,
      details: copySafeDiagnosticsView(artifact.resource),
    };
  }

  function safeArtifactPreview(artifact) {
    if (artifact.kind === ARTIFACT_KIND.SCREENSHOT) {
      return {
        kind: artifact.kind,
        mimeType: artifact.resource.mimeType,
        dataUrl: `data:image/png;base64,${artifact.resource.bytes.toString('base64')}`,
        byteLength: artifact.resource.bytes.length,
        width: artifact.resource.width,
        height: artifact.resource.height,
      };
    }
    if (artifact.kind === ARTIFACT_KIND.LOG) {
      return {
        kind: artifact.kind,
        text: artifact.resource.text,
        byteLength: artifact.resource.byteLength,
        truncated: artifact.resource.truncated,
        redactionCount: artifact.resource.redactionCount,
      };
    }
    return {
      kind: artifact.kind,
      details: copySafeDiagnosticsView(artifact.resource),
    };
  }

  function safeApprovedReport(draft) {
    return {
      state: DRAFT_STATE.APPROVED,
      approvedAt: draft.approvedReport.approvedAt,
      description: { ...draft.approvedReport.description },
      artifacts: draft.approvedReport.artifacts.map((artifact) => ({
        id: artifact.id,
        kind: artifact.kind,
      })),
    };
  }

  function safeReviewModel(draft) {
    return {
      state: draft.state,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
      description: { ...draft.description },
      artifacts: draft.artifacts.map(safeReviewArtifact),
      approval: draft.approvedReport === null ? null : safeApprovedReport(draft),
    };
  }

  function canAccess(draft, senderWebContentsId) {
    if (draft.reviewWebContentsId !== null) {
      return senderWebContentsId === draft.reviewWebContentsId;
    }
    return senderWebContentsId === draft.source.webContentsId;
  }

  function findAccessibleDraft(id, senderWebContentsId) {
    if (typeof id !== 'string' || !id || id.length > 256) return fail(ERROR.INVALID_DRAFT);
    const draft = drafts.get(id);
    if (!draft) return fail(ERROR.NOT_FOUND);
    if (!isPositiveInteger(senderWebContentsId) || !canAccess(draft, senderWebContentsId)) {
      return fail(ERROR.FORBIDDEN);
    }
    return { ok: true, draft };
  }

  function findReviewDraft(id, senderWebContentsId) {
    const found = findAccessibleDraft(id, senderWebContentsId);
    if (!found.ok) return found;
    if (found.draft.reviewWebContentsId !== senderWebContentsId) return fail(ERROR.FORBIDDEN);
    if (![DRAFT_STATE.REVIEWING, DRAFT_STATE.APPROVED].includes(found.draft.state)) {
      return fail(ERROR.INVALID_STATE);
    }
    return found;
  }

  function findMutableReviewDraft(id, senderWebContentsId) {
    const found = findReviewDraft(id, senderWebContentsId);
    if (!found.ok) return found;
    return found.draft.state === DRAFT_STATE.REVIEWING ? found : fail(ERROR.INVALID_STATE);
  }

  function findOwnedArtifact(draft, artifactId) {
    if (typeof artifactId !== 'string' || !artifactId || artifactId.length > 256) {
      return fail(ERROR.INVALID_ARTIFACT);
    }
    const artifact = draft.artifacts.find((candidate) => candidate.id === artifactId);
    return artifact ? { ok: true, artifact } : fail(ERROR.INVALID_ARTIFACT);
  }

  function setArtifactIncluded(id, senderWebContentsId, artifactId, included) {
    const found = findMutableReviewDraft(id, senderWebContentsId);
    if (!found.ok) return found;
    const owned = findOwnedArtifact(found.draft, artifactId);
    if (!owned.ok) return owned;
    if (!owned.artifact.available) return fail(ERROR.ARTIFACT_UNAVAILABLE);
    if (owned.artifact.included !== included) {
      owned.artifact.included = included;
      found.draft.updatedAt = toIso(now);
    }
    return { ok: true, draft: safeReviewModel(found.draft) };
  }

  function selectedContentPassesPrivacy(draft) {
    for (const field of REPORT_FIELDS) {
      if (!scanText(draft.description[field])?.safe) return false;
    }
    for (const artifact of draft.artifacts) {
      if (!artifact.available || !artifact.included) continue;
      if (artifact.kind === ARTIFACT_KIND.LOG && !scanText(artifact.resource.text)?.safe) return false;
      if (artifact.kind === ARTIFACT_KIND.DIAGNOSTICS) {
        const diagnosticText = JSON.stringify(copySafeDiagnosticsView(artifact.resource));
        if (!scanText(diagnosticText)?.safe) return false;
      }
    }
    return true;
  }

  return {
    async createDraft(source) {
      let draft = null;
      try {
        if (!source || !isPositiveInteger(source.webContentsId) || typeof source.windowId !== 'string' || !source.windowId) {
          return fail(ERROR.INVALID_OWNER);
        }
        const id = createDraftId();
        if (typeof id !== 'string' || !id || id.length > 256 || drafts.has(id) || artifactIds.has(id)) {
          return fail(ERROR.UNAVAILABLE);
        }
        const timestamp = toIso(now);
        draft = {
          id,
          state: DRAFT_STATE.COLLECTING,
          createdAt: timestamp,
          updatedAt: timestamp,
          source: {
            webContentsId: source.webContentsId,
            windowId: source.windowId,
          },
          reviewWebContentsId: null,
          description: {
            problem: '',
            reproduction: '',
          },
          artifacts: [],
          reviewArtifacts: null,
          approvedReport: null,
          approvedHandoff: null,
        };
        drafts.set(draft.id, draft);
        const [screenshot, diagnostics, log] = await Promise.all([
          collectSafely(captureScreenshot, draft.source, safeScreenshot),
          collectSafely(collectDiagnostics, draft.source, (value) => safeDiagnostics(value, prepareText)),
          collectSafely(collectLog, draft.source, (value) => safeLog(value, scanText)),
        ]);
        if (drafts.get(draft.id) !== draft) return fail(ERROR.NOT_FOUND);
        draft.artifacts.push(createArtifact(ARTIFACT_KIND.SCREENSHOT, screenshot));
        draft.artifacts.push(createArtifact(ARTIFACT_KIND.LOG, log));
        draft.artifacts.push(createArtifact(ARTIFACT_KIND.DIAGNOSTICS, diagnostics));
        draft.state = DRAFT_STATE.REVIEWABLE;
        draft.updatedAt = toIso(now);
        return { ok: true, draft: safeDraftMetadata(draft) };
      } catch {
        if (draft) retireDraft(draft);
        return fail(ERROR.UNAVAILABLE);
      }
    },

    getPreview(id, senderWebContentsId) {
      const found = findAccessibleDraft(id, senderWebContentsId);
      return found.ok ? { ok: true, draft: safeDraftMetadata(found.draft) } : found;
    },

    getReview(id, senderWebContentsId) {
      const found = findReviewDraft(id, senderWebContentsId);
      return found.ok ? { ok: true, draft: safeReviewModel(found.draft) } : found;
    },

    getArtifactPreview(id, senderWebContentsId, artifactId) {
      const found = findReviewDraft(id, senderWebContentsId);
      if (!found.ok) return found;
      const owned = findOwnedArtifact(found.draft, artifactId);
      if (!owned.ok) return owned;
      if (!owned.artifact.available) return fail(ERROR.ARTIFACT_UNAVAILABLE);
      return { ok: true, preview: safeArtifactPreview(owned.artifact) };
    },

    updateDescription(id, senderWebContentsId, payload) {
      const found = findMutableReviewDraft(id, senderWebContentsId);
      if (!found.ok) return found;
      if (!isExactDescriptionPayload(payload)) return fail(ERROR.INVALID_DESCRIPTION);
      const totalLength = REPORT_FIELDS.reduce((total, field) => total + payload[field].length, 0);
      if (
        totalLength > MAX_REPORT_TEXT_LENGTH
        || REPORT_FIELDS.some((field) => payload[field].length > MAX_REPORT_FIELD_LENGTH)
      ) {
        return fail(ERROR.INVALID_DESCRIPTION);
      }
      const description = Object.create(null);
      for (const field of REPORT_FIELDS) {
        const prepared = prepareText(payload[field]);
        if (!prepared?.ok || typeof prepared.text !== 'string') return fail(ERROR.PRIVACY_CHECK_FAILED);
        description[field] = prepared.text;
      }
      found.draft.description = {
        problem: description.problem,
        reproduction: description.reproduction,
      };
      found.draft.updatedAt = toIso(now);
      return { ok: true, draft: safeReviewModel(found.draft) };
    },

    includeArtifact(id, senderWebContentsId, artifactId) {
      return setArtifactIncluded(id, senderWebContentsId, artifactId, true);
    },

    excludeArtifact(id, senderWebContentsId, artifactId) {
      return setArtifactIncluded(id, senderWebContentsId, artifactId, false);
    },

    approveDraft(id, senderWebContentsId) {
      const found = findReviewDraft(id, senderWebContentsId);
      if (!found.ok) return found;
      if (found.draft.state === DRAFT_STATE.APPROVED) {
        return { ok: true, report: safeApprovedReport(found.draft), alreadyApproved: true };
      }
      if (!selectedContentPassesPrivacy(found.draft)) return fail(ERROR.PRIVACY_CHECK_FAILED);
      const approvedAt = toIso(now);
      const selectedArtifacts = found.draft.artifacts
        .filter((artifact) => artifact.available && artifact.included);
      found.draft.approvedReport = Object.freeze({
        approvedAt,
        description: Object.freeze({ ...found.draft.description }),
        artifacts: Object.freeze(selectedArtifacts.map((artifact) => Object.freeze({
          id: artifact.id,
          kind: artifact.kind,
          resource: artifact.resource,
        }))),
      });
      // Deselected artifacts leave every approved view but stay set aside so
      // an explicit reopen can restore the full checklist; they retire with
      // the draft.
      found.draft.reviewArtifacts = found.draft.artifacts;
      found.draft.artifacts = selectedArtifacts;
      found.draft.state = DRAFT_STATE.APPROVED;
      found.draft.updatedAt = approvedAt;
      return { ok: true, report: safeApprovedReport(found.draft), alreadyApproved: false };
    },

    reopenReview(id, senderWebContentsId) {
      const found = findReviewDraft(id, senderWebContentsId);
      if (!found.ok) return found;
      if (found.draft.state !== DRAFT_STATE.APPROVED) return fail(ERROR.INVALID_STATE);
      if (found.draft.reviewArtifacts !== null) {
        found.draft.artifacts = found.draft.reviewArtifacts;
        found.draft.reviewArtifacts = null;
      }
      found.draft.approvedReport = null;
      found.draft.approvedHandoff = null;
      found.draft.state = DRAFT_STATE.REVIEWING;
      found.draft.updatedAt = toIso(now);
      return { ok: true, draft: safeReviewModel(found.draft) };
    },

    claimApprovedReport(id, senderWebContentsId) {
      const found = findReviewDraft(id, senderWebContentsId);
      if (!found.ok) return found;
      if (found.draft.state !== DRAFT_STATE.APPROVED || found.draft.approvedReport === null) {
        return fail(ERROR.INVALID_STATE);
      }
      if (found.draft.approvedHandoff === null) {
        const approvalId = createApprovalId();
        if (typeof approvalId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(approvalId)) {
          return fail(ERROR.UNAVAILABLE);
        }
        found.draft.approvedHandoff = Object.freeze({
          approvalId,
          approvedAt: found.draft.approvedReport.approvedAt,
          description: Object.freeze({ ...found.draft.approvedReport.description }),
          artifacts: Object.freeze(found.draft.approvedReport.artifacts.map((artifact) => Object.freeze({
            kind: artifact.kind,
            resource: copyApprovedArtifactResource(artifact),
          }))),
        });
      }
      return {
        ok: true,
        report: safeApprovedReport(found.draft),
        snapshot: found.draft.approvedHandoff,
      };
    },

    discardDraft(id, senderWebContentsId) {
      const found = findAccessibleDraft(id, senderWebContentsId);
      if (!found.ok) return found;
      retireDraft(found.draft);
      return { ok: true };
    },

    bindReviewWindow(id, reviewWebContentsId) {
      try {
        if (typeof id !== 'string' || !id) return fail(ERROR.INVALID_DRAFT);
        const draft = drafts.get(id);
        if (!draft) return fail(ERROR.NOT_FOUND);
        if (!isPositiveInteger(reviewWebContentsId)) return fail(ERROR.INVALID_OWNER);
        if (draft.reviewWebContentsId !== null) return fail(ERROR.REVIEW_ALREADY_BOUND);
        if (draft.state !== DRAFT_STATE.REVIEWABLE) return fail(ERROR.INVALID_STATE);
        draft.reviewWebContentsId = reviewWebContentsId;
        draft.state = DRAFT_STATE.REVIEWING;
        draft.updatedAt = toIso(now);
        return { ok: true, draft: safeDraftMetadata(draft) };
      } catch {
        return fail(ERROR.UNAVAILABLE);
      }
    },

    discardUnreviewedDraftsForSource(sourceWebContentsId) {
      if (!isPositiveInteger(sourceWebContentsId)) return 0;
      let discarded = 0;
      for (const draft of [...drafts.values()]) {
        if (draft.source.webContentsId === sourceWebContentsId && draft.reviewWebContentsId === null) {
          if (retireDraft(draft)) discarded += 1;
        }
      }
      return discarded;
    },

    discardDraftsForReviewWindow(reviewWebContentsId) {
      if (!isPositiveInteger(reviewWebContentsId)) return 0;
      let discarded = 0;
      for (const draft of [...drafts.values()]) {
        if (draft.reviewWebContentsId === reviewWebContentsId) {
          if (retireDraft(draft)) discarded += 1;
        }
      }
      return discarded;
    },
  };
}

module.exports = {
  ARTIFACT_KIND,
  DRAFT_STATE,
  MAX_REPORT_FIELD_LENGTH,
  createBugReportService,
};
