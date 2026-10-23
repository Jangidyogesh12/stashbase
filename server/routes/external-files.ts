/**
 * External-file routes. Registration is process-private: only the Electron
 * main process holds the token, and it registers only paths preload read off
 * a dropped `File`. Every other route reads one granted file by its opaque
 * token, so none of them accepts a path, and none of them prepares, indexes,
 * or uploads anything.
 */
import express from 'express';
import path from 'node:path';

import {
  EXTERNAL_FILE_REGISTRATION_TOKEN_HEADER,
  externalFileOpenRequestSchema,
  externalFileOpenResultSchema,
  externalFileTokenSchema,
} from '../../shared/protocols/http/external-files.ts';
import {
  documentTextSaveResponseSchema,
  documentTextSourceResponseSchema,
  genericFilePreviewResponseSchema,
} from '../../shared/protocols/http/files.ts';
import {
  bindExternalFileLifecycle,
  externalFileGrant,
  externalFileVersionAsync,
  isEditableExternalFile,
  readExternalGenericPreviewAsync,
  readExternalTextAsync,
  registerExternalFile,
  resolveExternalFileAsync,
  revokeExternalFile,
  saveExternalTextAsync,
  type ExternalFileGrant,
} from '../external-files.ts';
import { currentWindowId } from '../folder.ts';
import { revealInOsFileManager, sendError } from '../http.ts';
import { processPrivateTokenMatches } from '../process-private-token.ts';
import { ASSET_MIME_TYPES } from './file-assets.ts';

export interface ExternalFileRouteOptions {
  registrationToken: string;
  revealInFileManager?: (absolutePath: string) => void;
}

function tokenParam(req: express.Request): string | null {
  const parsed = externalFileTokenSchema.safeParse(req.params.token);
  return parsed.success ? parsed.data : null;
}

/** The calling window's own grant; another window's token reads as missing. */
function ownGrant(req: express.Request): ExternalFileGrant | null {
  const token = tokenParam(req);
  return token ? externalFileGrant(token, currentWindowId()) : null;
}

const notFound = (res: express.Response) => res.status(404).json({ error: 'not found' });

export function mount(app: express.Express, options: ExternalFileRouteOptions): void {
  bindExternalFileLifecycle();
  const reveal = options.revealInFileManager ?? revealInOsFileManager;

  app.post('/api/internal/external-files', async (req, res) => {
    if (!processPrivateTokenMatches(req.header(EXTERNAL_FILE_REGISTRATION_TOKEN_HEADER), options.registrationToken)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const request = externalFileOpenRequestSchema.safeParse(req.body);
    if (!request.success) return res.status(400).json({ error: 'invalid request' });
    try {
      res.json(externalFileOpenResultSchema.parse(await registerExternalFile(currentWindowId(), request.data.path)));
    } catch (err: unknown) {
      sendError(res, err);
    }
  });

  app.delete('/api/external-files/:token', (req, res) => {
    const token = tokenParam(req);
    if (token) revokeExternalFile(token, currentWindowId());
    res.json({ ok: true });
  });

  app.head('/api/external-files/:token', async (req, res) => {
    const grant = ownGrant(req);
    if (!grant) return res.sendStatus(404);
    try {
      const version = await externalFileVersionAsync(grant);
      if (!version) return res.sendStatus(404);
      res.setHeader('x-stashbase-file-version', version);
      res.sendStatus(204);
    } catch (err: unknown) {
      sendError(res, err);
    }
  });

  app.get('/api/external-files/:token/text', async (req, res) => {
    const grant = ownGrant(req);
    if (!grant || !isEditableExternalFile(grant)) return notFound(res);
    try {
      const snapshot = await readExternalTextAsync(grant);
      if (!snapshot) return notFound(res);
      res.json(documentTextSourceResponseSchema.parse({ format: grant.format, name: grant.path, ...snapshot }));
    } catch (err: unknown) {
      sendError(res, err);
    }
  });

  // The same versioned save a project document uses, against the grant's file.
  app.put('/api/external-files/:token/text', async (req, res) => {
    const grant = ownGrant(req);
    if (!grant || !isEditableExternalFile(grant)) return notFound(res);
    const body = (req.body ?? {}) as { baseVersion?: unknown; content?: unknown; overwrite?: unknown };
    const overwrite = body.overwrite === true;
    if (
      typeof body.content !== 'string' ||
      body.content.length > 8 * 1024 * 1024 ||
      (!overwrite && (typeof body.baseVersion !== 'string' || !body.baseVersion))
    ) {
      return res.status(400).json({ error: 'invalid versioned text save request' });
    }
    try {
      const saved = await saveExternalTextAsync(
        grant,
        body.content,
        overwrite ? undefined : (body.baseVersion as string),
      );
      if (!saved) return notFound(res);
      res.json(documentTextSaveResponseSchema.parse({ ...saved, format: grant.format, name: grant.path }));
    } catch (err: unknown) {
      sendError(res, err);
    }
  });

  app.get('/api/external-files/:token/preview', async (req, res) => {
    const grant = ownGrant(req);
    if (!grant || grant.format !== 'generic') return notFound(res);
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', cancel);
    try {
      const preview = await readExternalGenericPreviewAsync(grant, controller.signal);
      if (!preview) return notFound(res);
      res.json(genericFilePreviewResponseSchema.parse(preview));
    } catch (err: unknown) {
      if (!controller.signal.aborted) sendError(res, err);
    } finally {
      res.off('close', cancel);
    }
  });

  app.post('/api/external-files/:token/reveal', async (req, res) => {
    const grant = ownGrant(req);
    if (!grant) return notFound(res);
    try {
      const target = await resolveExternalFileAsync(grant);
      if (!target) return notFound(res);
      reveal(target);
      res.json({});
    } catch (err: unknown) {
      sendError(res, err);
    }
  });

  // Browser-loaded bytes (img, pdf.js) carry no window identity, so the token
  // is the capability here. The trailing name only labels the URL.
  app.get('/asset/__external/:token/*', async (req, res) => {
    const token = tokenParam(req);
    const grant = token ? externalFileGrant(token, null) : null;
    if (!grant || (grant.format !== 'pdf' && grant.format !== 'image')) return res.status(404).end();
    try {
      const target = await resolveExternalFileAsync(grant);
      const version = target ? await externalFileVersionAsync(grant) : null;
      if (!target || !version) return res.status(404).end();
      res.type(ASSET_MIME_TYPES[path.extname(target).toLowerCase()] ?? 'application/octet-stream');
      res.setHeader('ETag', JSON.stringify(version));
      res.setHeader('Cache-Control', 'no-cache');
      // sendFile owns stream errors, Range requests and client disconnects.
      await new Promise<void>((resolve, reject) => {
        res.sendFile(target, { dotfiles: 'allow', etag: false, lastModified: false, cacheControl: false },
          (error) => error ? reject(error) : resolve());
      });
    } catch (err: unknown) {
      if (res.destroyed) return;
      if (res.headersSent) { res.destroy(); return; }
      sendError(res, err);
    }
  });
}
