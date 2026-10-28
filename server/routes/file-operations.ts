import type express from 'express';
import { currentWindowId, getCurrentFolder } from '../folder.ts';
import { guardExplicitFolder } from '../http.ts';

type Receipt = { signature: string; response: { status: number; body: unknown } | null };

/** A lost response never authorizes replay. Receipts belong to one window and
 * project, and disappear with this server process. An absent receipt is unknown. */
export function mountFileOperationReceipts(app: express.Express): void {
  const receipts = new Map<string, Receipt>();
  const key = (id: string) => JSON.stringify([currentWindowId(), getCurrentFolder(), id]);
  app.get('/api/file-operations/:id', async (req, res) => {
    if (!(await guardExplicitFolder(req, res))) return;
    const receipt = receipts.get(key(req.params.id!));
    if (!receipt) return res.status(404).json({ error: 'Operation result is unknown.' });
    if (!receipt.response) return res.status(202).json({ pending: true });
    return res.json(receipt.response);
  });
  app.use(async (req, res, next) => {
    const mutation = /^\/api\/(?:files|folders|interactive-notes)(?:\/.*)?$/u.test(req.path) &&
      (req.method === 'PATCH' || req.method === 'DELETE' ||
        (req.method === 'POST' && /^\/api\/(?:files|folders|interactive-notes)$/u.test(req.path)));
    if (!mutation || req.query.operationId === undefined) return next();
    if (!(await guardExplicitFolder(req, res))) return;
    const id = req.query.operationId;
    if (typeof id !== 'string' || !/^[\w-]{1,100}$/u.test(id)) {
      return res.status(400).json({ error: 'Invalid operation identity.' });
    }
    const identity = key(id);
    const signature = JSON.stringify([req.method, req.path, req.body]);
    const existing = receipts.get(identity);
    if (existing) {
      if (existing.signature !== signature) return res.status(409).json({ error: 'Operation identity already used.' });
      if (!existing.response) return res.status(202).json({ pending: true });
      return res.status(existing.response.status).json(existing.response.body);
    }
    // Keep recent completed receipts; never evict an operation still running.
    if (receipts.size >= 1000) {
      const oldest = [...receipts].find(([, receipt]) => receipt.response !== null);
      if (oldest) receipts.delete(oldest[0]);
      else return res.status(503).json({ error: 'Too many file operations are running.' });
    }
    const receipt: Receipt = { signature, response: null };
    receipts.set(identity, receipt);
    const json = res.json.bind(res);
    res.json = (body: unknown) => {
      receipt.response = { status: res.statusCode, body };
      return json(body);
    };
    next();
  });
}
