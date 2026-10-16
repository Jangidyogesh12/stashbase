/**
 * A scheduled task's "What to do": the Chat composer's own field, with the
 * same `@` mentions, the same chips and the same suggestions, but no Send.
 * A reader can write a sentence, mention project files, or both; the task
 * keeps the files as paths and the run reads them as they are then.
 */
import { useId, useMemo, useRef } from 'react';

import type { InputMessageEditorContext } from '@/components/ui/input-message';
import type { AgentScopeEnvironment, ContextStatus } from '@/features/agent/domain/context';
import { MentionRowsListbox, useMentionRows } from '@/features/agent/ui/composer/context-rows';
import {
  MentionEditor,
  type MentionEditorHandle,
} from '@/features/agent/ui/composer/mention-editor';
import { FOCUS_RING_TINT } from '@/lib/focus-ring';
import { shapeTokens } from '@/lib/shape-context';
import { cn } from '@/lib/utils';

export interface ScheduledPromptValue {
  readonly files: readonly string[];
  readonly text: string;
}

const METRICS = { fontSize: 14, lineHeight: 20, paddingX: 0, paddingY: 0 };
const NO_SKILLS = { kind: 'empty' } as const;
const ignore = () => {};

export function ScheduledPromptField({
  describedBy,
  disabled,
  environment,
  label,
  onChange,
  value,
}: {
  describedBy?: string | undefined;
  disabled: boolean;
  /** The project's listing, which mentions are offered from and checked
   *  against; null while it is still being read. */
  environment: AgentScopeEnvironment | null;
  label: string;
  onChange(value: ScheduledPromptValue): void;
  value: ScheduledPromptValue;
}) {
  const editorRef = useRef<MentionEditorHandle>(null);
  const listboxId = useId();
  // Typing a mention reports the new text and the new file in one tick, so
  // each change builds on the last one rather than on the last render.
  const latest = useRef(value);
  latest.current = value;
  const change = (next: ScheduledPromptValue) => {
    latest.current = next;
    onChange(next);
  };
  const panel = useMentionRows({
    editorRef,
    listboxId,
    onRefreshSkills: ignore,
    onSkillChange: ignore,
    scoped: environment,
    skillCatalog: NO_SKILLS,
  });

  // A file the project no longer lists shows on its chip, the way a stale
  // mention does in Chat; the run would be refused for it.
  const statuses = useMemo(() => {
    const listed = new Set(environment?.listing.files.map((file) => file.path));
    const next: Record<string, ContextStatus> = {};
    if (!environment) return next;
    for (const file of value.files) if (!listed.has(file)) next[file] = 'stale';
    return next;
  }, [environment, value.files]);

  const ctx: InputMessageEditorContext = {
    ariaDescribedBy: describedBy,
    ariaLabel: label,
    disabled,
    maxRows: 8,
    metrics: METRICS,
    minRows: 3,
    onValueChange: (text) => change({ ...latest.current, text }),
    placeholder: 'Say what to do, or @ a file for it to follow',
    submit: ignore,
    value: value.text,
  };

  return (
    // The field is the editor inside, so the box rings while focus is within.
    <div
      className={cn(
        'relative w-full border border-border bg-surface-3 px-3 py-2 text-body focus-within:ring-1',
        FOCUS_RING_TINT,
        shapeTokens.panel,
        disabled && 'opacity-50',
      )}
    >
      <MentionRowsListbox id={listboxId} panel={panel} />
      <MentionEditor
        chipPaths={value.files}
        ctx={ctx}
        listbox={panel.binding}
        onMentionAdded={(path) => {
          const current = latest.current;
          if (current.files.includes(path)) return;
          if (!environment?.listing.files.some((file) => file.path === path)) return;
          change({ ...current, files: [...current.files, path] });
        }}
        onMentionRemoved={(path) => {
          const current = latest.current;
          change({ ...current, files: current.files.filter((file) => file !== path) });
        }}
        onQueryChange={panel.onQueryChange}
        onSkillRemoved={ignore}
        ref={editorRef}
        skill={null}
        skillsEnabled={false}
        statuses={statuses}
      />
    </div>
  );
}
