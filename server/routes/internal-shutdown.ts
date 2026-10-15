import express from 'express';
import { processPrivateTokenMatches } from '../process-private-token.ts';

interface InternalShutdownOptions {
  token: string;
  shutdown: (reason: 'app_shutdown' | 'app_update') => void;
}

/** Process-private graceful-shutdown handshake for the Electron owner.
 * The random token is inherited only by the child server process; ordinary
 * localhost clients cannot terminate the app server. */
export function mountInternalShutdownRoute(
  app: express.Express,
  { token, shutdown }: InternalShutdownOptions,
): void {
  app.post('/api/internal/shutdown', (req, res) => {
    if (!processPrivateTokenMatches(req.header('x-stashbase-shutdown-token'), token)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    res.status(202).json({ ok: true });
    const reason = req.header('x-stashbase-shutdown-reason') === 'app_update' ? 'app_update' : 'app_shutdown';
    setImmediate(() => shutdown(reason));
  });
}
