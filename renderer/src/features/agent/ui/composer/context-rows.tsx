/** The composer's suggestion panel: which rows an open `@` or `/` query
 *  shows, which one is active, and what happens when the user picks it. The
 *  panel owns nothing about the draft — picking a row asks the editor to
 *  insert the chip and tells the owner which skill is now armed — so the
 *  composer shell below it stays about the message being written. */
import { Folder, Sparkles } from 'lucide-react';
import { useMemo, useState, type ReactNode, type RefObject } from 'react';

import { Button } from '@/components/ui/button';
import { FileTypeIcon } from '@/components/ui/file-type-icon';
import {
  rankMentionSuggestions,
  type AgentScopeEnvironment,
  type MentionQuery,
} from '@/features/agent/domain/context';
import type { AgentSkill } from '@/features/agent/domain/runtime-catalog';
import { agentSkills, type AgentSkillCatalog } from '@/features/agent/domain/session';
import { basePathName } from '@/shared/utils/file-path';

import type { MentionEditorHandle } from './mention-editor';
import {
  MentionListbox,
  mentionOptionId,
  type MentionListboxBinding,
  type MentionRow,
} from './mention-listbox';

const MAX_SKILL_ROWS = 8;
const ROW_ICON_CLASS = 'mt-0.5 size-3.5 shrink-0 text-muted-foreground';

export interface MentionRowsOptions {
  editorRef: RefObject<MentionEditorHandle | null>;
  /** Id the listbox and its options are named under. */
  listboxId: string;
  /** Asks the runtime to re-read the skills it can run in this scope. */
  onRefreshSkills: () => void;
  /** Arms a skill for the next turn, or disarms it with null. */
  onSkillChange: (skill: string | null) => void;
  /** The window environment, only when it describes this session's folder. */
  scoped: AgentScopeEnvironment | null;
  skillCatalog: AgentSkillCatalog;
}

export interface MentionRowsView {
  activeRow: number;
  /** The keyboard contract handed to the editor. */
  binding: MentionListboxBinding;
  label: string;
  /** What an empty skill panel explains, or undefined when rows exist. */
  notice: ReactNode | undefined;
  onHover: (index: number) => void;
  onPick: (index: number) => boolean;
  onQueryChange: (next: MentionQuery | null) => void;
  open: boolean;
  rows: MentionRow[];
}

function skillRow(entry: AgentSkill): MentionRow {
  return {
    icon: <Sparkles aria-hidden="true" className={ROW_ICON_CLASS} strokeWidth={1.5} />,
    key: `skill:${entry.id}`,
    primary: entry.label,
    secondary: entry.description,
  };
}

function suggestionRow(suggestion: { kind: 'file' | 'folder'; path: string }): MentionRow {
  return {
    icon:
      suggestion.kind === 'folder' ? (
        <Folder aria-hidden="true" className={ROW_ICON_CLASS} strokeWidth={1.5} />
      ) : (
        <FileTypeIcon aria-hidden="true" className={ROW_ICON_CLASS} path={suggestion.path} />
      ),
    key: `${suggestion.kind}:${suggestion.path}`,
    primary: basePathName(suggestion.path),
    secondary: suggestion.path === basePathName(suggestion.path) ? undefined : suggestion.path,
  };
}

/** A skill panel with nothing in it still has something to say: the folder
 *  advertises no skills, the query matched none, or the read failed. */
function SkillNotice({
  onRefreshSkills,
  skillCatalog,
}: Pick<MentionRowsOptions, 'onRefreshSkills' | 'skillCatalog'>) {
  if (skillCatalog.kind === 'failed') {
    return (
      <div
        className="flex items-center justify-between gap-2 px-2 py-1.5 text-caption text-muted-foreground"
        role="status"
      >
        <span>Could not load skills.</span>
        <Button onClick={onRefreshSkills} size="compact" variant="tertiary">
          Retry
        </Button>
      </div>
    );
  }
  return (
    <p className="m-0 px-2 py-1.5 text-caption text-muted-foreground" role="status">
      {agentSkills(skillCatalog).length === 0
        ? 'No skills are available for this folder.'
        : 'No matching skills.'}
    </p>
  );
}

export function useMentionRows({
  editorRef,
  listboxId,
  onRefreshSkills,
  onSkillChange,
  scoped,
  skillCatalog,
}: MentionRowsOptions): MentionRowsView {
  const [query, setQuery] = useState<MentionQuery | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const suggestions = useMemo(
    () =>
      query?.kind === 'mention' && scoped
        ? rankMentionSuggestions(scoped.listing, query.query, scoped.openPaths)
        : [],
    [query, scoped],
  );
  const skillMatches = useMemo(() => {
    if (query?.kind !== 'skill') return [];
    const needle = query.query.toLowerCase();
    return agentSkills(skillCatalog)
      .filter(
        (entry) =>
          entry.label.toLowerCase().includes(needle) ||
          (entry.description ?? '').toLowerCase().includes(needle),
      )
      .slice(0, MAX_SKILL_ROWS);
  }, [query, skillCatalog]);

  const rows =
    query?.kind === 'skill' ? skillMatches.map(skillRow) : suggestions.map(suggestionRow);
  // A skill query stays open with no rows: the panel is what explains that
  // the folder advertises none, or that the runtime could not read them.
  const open = query !== null && (rows.length > 0 || query.kind === 'skill');
  const activeRow = Math.min(activeIndex, Math.max(0, rows.length - 1));

  const pick = (index: number): boolean => {
    if (!query) return false;
    if (query.kind === 'skill') {
      const picked = skillMatches[index];
      if (!picked) return false;
      editorRef.current?.insertSkill(picked.label);
      onSkillChange(picked.id);
      setActiveIndex(0);
      return true;
    }
    const suggestion = suggestions[index];
    if (!suggestion) return false;
    editorRef.current?.insertMention(suggestion.path);
    setActiveIndex(0);
    return true;
  };

  return {
    activeRow,
    binding: {
      activeOptionId: rows.length > 0 ? mentionOptionId(listboxId, activeRow) : undefined,
      controls: rows.length > 0 ? listboxId : undefined,
      // An empty skill panel still owns Enter: it is explaining why there is
      // nothing to pick, so the key must not send the draft behind it.
      onAccept: () => (rows.length > 0 ? pick(activeRow) : query?.kind === 'skill'),
      onDismiss: () => setActiveIndex(0),
      onNavigate: (direction) => {
        if (rows.length === 0) return;
        setActiveIndex((activeRow + direction + rows.length) % rows.length);
      },
      open,
    },
    label: query?.kind === 'skill' ? 'Run a skill' : 'Mention a file or folder',
    notice:
      query?.kind === 'skill' && rows.length === 0 ? (
        <SkillNotice onRefreshSkills={onRefreshSkills} skillCatalog={skillCatalog} />
      ) : undefined,
    onHover: setActiveIndex,
    onPick: pick,
    onQueryChange: (next) => {
      setQuery(next);
      if (next === null) setActiveIndex(0);
    },
    open,
    rows,
  };
}

/** The panel's suggestion list while a query is open, for any field the
 *  rows serve. */
export function MentionRowsListbox({ id, panel }: { id: string; panel: MentionRowsView }) {
  if (!panel.open) return null;
  return (
    <MentionListbox
      activeIndex={panel.activeRow}
      id={id}
      label={panel.label}
      notice={panel.notice}
      onHover={panel.onHover}
      onPick={panel.onPick}
      rows={panel.rows}
    />
  );
}
