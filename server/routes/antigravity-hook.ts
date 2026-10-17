/** Antigravity's approval hook (`~/.stashbase/bin/stashbase-antigravity-hook`)
 * asks here before each tool call a StashBase chat's `agy` process makes. The
 * answer is the hook's stdout. The private session id the chat gave its
 * process names the chat; a request without a live one is refused, never
 * granted, because the process was started with every tool permitted. */
import type express from 'express';
import { AGENT_SESSION_ID_HEADER, attributedAgentSession } from '../agent-session-registry.ts';
import { antigravitySessionForHook } from '../antigravity-session-runtime.ts';
import { errorMessage, logger } from '../log.ts';

const log = logger('antigravity-hook');

export function mount(app: express.Express): void {
  app.post('/api/agent/antigravity/hook', async (req, res) => {
    const sessionId = req.header(AGENT_SESSION_ID_HEADER) ?? '';
    const attributed = attributedAgentSession(sessionId);
    // Another runtime's process ran `agy` itself: that run's own permission
    // rules apply, exactly as outside StashBase.
    if (attributed && attributed.agentId !== 'antigravity') return res.json({ decision: 'allow' });
    const session = antigravitySessionForHook(sessionId);
    if (!session) return res.json({ decision: 'deny', reason: 'This StashBase chat has ended.' });
    const withdrawn = new AbortController();
    res.on('close', () => { if (!res.writableEnded) withdrawn.abort(); });
    try {
      res.json(await session.reviewToolCall(req.body, withdrawn.signal));
    } catch (error) {
      log.warn(`Antigravity approval failed: ${errorMessage(error)}`);
      if (!res.headersSent) res.json({ decision: 'deny', reason: 'StashBase could not review this action, so it was not run.' });
    }
  });
}
