import type { IconComponent } from '@/lib/icon-context';
/**
 * The mark that stands for each Agent, wherever one is named.
 *
 * The Chat header, the conversation list, the runtime picker and the Agents
 * section of Settings are all identifying the same runtimes, so they
 * read the map from here rather than each choosing a glyph. A reader who
 * learns a mark in one place recognizes it in the others; two maps meant the
 * Agent panel showed a vendor mark where Settings showed a generic one.
 */
import type { AgentId } from '@/shared/domain/agent-id';

import { AntigravityIcon, ClaudeIcon, CodexIcon, StashBaseIcon } from './agent-marks';

export const AGENT_ICONS: Record<AgentId, IconComponent> = {
  stashbase: StashBaseIcon,
  codex: CodexIcon,
  claude: ClaudeIcon,
  antigravity: AntigravityIcon,
};
