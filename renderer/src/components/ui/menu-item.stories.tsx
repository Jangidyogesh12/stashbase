import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChevronLeft, ChevronRight, Copy, Lock, Pencil, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Button } from './button';
import { DropdownContent, DropdownMenu, DropdownTrigger } from './dropdown';
import { MenuItem } from './menu-item';

const meta = {
  title: 'Navigation/Menu Item',
  component: MenuItem,
  parameters: { controls: { disable: true }, fluidCanvas: { width: '26rem', minHeight: '14rem' } },
} satisfies Meta<typeof MenuItem>;

export default meta;
type Story = StoryObj;

/** A row is only ever a row of a surface — the surface supplies the primitive
 *  that owns the role and the roving highlight — so every story opens one. */
function OpenMenu({ children, label }: { children: ReactNode; label: string }) {
  return (
    <DropdownMenu defaultOpen>
      <DropdownTrigger render={<Button variant="secondary">{label}</Button>} />
      <DropdownContent aria-label={label}>{children}</DropdownContent>
    </DropdownMenu>
  );
}

/** Plain action rows. A row without `checked` announces as `menuitem`. */
export const Actions: Story = {
  render: () => (
    <OpenMenu label="Document actions">
      <MenuItem icon={Pencil} label="Rename" />
      <MenuItem icon={Copy} label="Duplicate" />
      <MenuItem disabled icon={Trash2} label="Delete" />
    </OpenMenu>
  ),
};

/** A boolean `checked` turns the row into a radio option and draws the check. */
export const Choices: Story = {
  render: function Choices() {
    const [selected, setSelected] = useState(1);
    const options = ['Newest first', 'Oldest first', 'Recently opened'];
    return (
      <OpenMenu label="Sort order">
        {options.map((label, index) => (
          <MenuItem
            checked={selected === index}
            key={label}
            label={label}
            onSelect={() => setSelected(index)}
          />
        ))}
      </OpenMenu>
    );
  },
};

/** Explanatory copy for a choice whose consequence the label cannot carry. */
export const WithDescription: Story = {
  render: () => (
    <OpenMenu label="Permission mode">
      <MenuItem description="Every edit is proposed for review." label="Ask first" />
      <MenuItem
        description="Edits inside the workspace apply immediately."
        label="Auto-accept edits"
      />
    </OpenMenu>
  ),
};

/** A compact secondary action at the row's trailing edge. */
export const WithTrailingAction: Story = {
  render: () => (
    <OpenMenu label="Recent chats">
      <MenuItem
        label="Indexing plan"
        trailingAction={{ icon: Trash2, label: 'Delete chat', onSelect: () => undefined }}
      />
      <MenuItem
        label="Release checklist"
        trailingAction={{ icon: Trash2, label: 'Delete chat', onSelect: () => undefined }}
      />
    </OpenMenu>
  ),
};

/** A row that leads to a deeper list keeps the surface open and wears a
 *  chevron where a chosen row would draw its check; the deeper list offers
 *  the way back the same way. */
export const LeadsDeeper: Story = {
  render: function LeadsDeeper() {
    const [layer, setLayer] = useState<'level' | 'model'>('level');
    return (
      <OpenMenu label="Thinking">
        {layer === 'level' ? (
          <>
            <MenuItem checked description="Balanced" label="Medium" layout="inline" />
            <MenuItem checked={false} description="Deeper reasoning" label="High" layout="inline" />
            <MenuItem
              closeOnClick={false}
              description="GPT-6"
              label="Model"
              layout="inline"
              onSelect={() => setLayer('model')}
              trailingIcon={ChevronRight}
            />
          </>
        ) : (
          <>
            <MenuItem
              closeOnClick={false}
              icon={ChevronLeft}
              label="Back"
              onSelect={() => setLayer('level')}
            />
            <MenuItem checked label="GPT-6" />
            <MenuItem checked={false} label="GPT-5" />
          </>
        )}
      </OpenMenu>
    );
  },
};

/** A badge names a fact about the row, here what a model costs against the
 *  default; the expensive ones are listed but locked. */
export const WithBadge: Story = {
  render: () => (
    <OpenMenu label="Model">
      <MenuItem
        checked
        description="1M context · 64K output"
        label="Gemini 3.8 Flash"
        layout="wrap"
      />
      <MenuItem
        badge="5× cost"
        checked={false}
        description="1M context · 128K output"
        disabled
        trailingIcon={Lock}
        label="Claude Opus 5.5"
        layout="wrap"
      />
      <MenuItem
        badge="3× cost"
        checked={false}
        description="1M context · 128K output"
        disabled
        trailingIcon={Lock}
        label="Claude Sonnet 5.5"
        layout="wrap"
      />
      <MenuItem
        checked={false}
        description="1M context · 64K output"
        label="Gemini 3.5 Flash-Lite"
        layout="wrap"
      />
    </OpenMenu>
  ),
};
