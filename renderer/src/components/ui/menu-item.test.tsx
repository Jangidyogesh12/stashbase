import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChevronRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vite-plus/test';

import { expectNoA11yViolations } from '@/test/axe';

import { Button } from './button';
import { DropdownContent, DropdownMenu, DropdownTrigger } from './dropdown';
import { MenuItem } from './menu-item';

afterEach(cleanup);

/** Rows exist only inside a surface, which is what supplies the primitive they
 *  wrap themselves in. */
function openMenu(children: ReactNode) {
  return (
    <DropdownMenu defaultOpen>
      <DropdownTrigger render={<Button variant="secondary">Open</Button>} />
      <DropdownContent aria-label="Menu">{children}</DropdownContent>
    </DropdownMenu>
  );
}

/** The index each row ended up with, read off the attribute the proximity
 *  overlays and the popup primitive both key on. Queried from the popup rather
 *  than by role, because a list may hold `menuitem` and `menuitemradio` rows
 *  at once and their order together is what is under test. */
function indices(): (string | null)[] {
  const rows = screen.getByRole('menu').querySelectorAll('[data-proximity-index]');
  return [...rows].map((row) => row.getAttribute('data-proximity-index'));
}

describe('MenuItem row numbering', () => {
  it('numbers rows by DOM order when no index is passed', async () => {
    render(
      openMenu(
        <>
          <MenuItem label="Rename" />
          <MenuItem label="Duplicate" />
          <MenuItem label="Delete" />
        </>,
      ),
    );

    expect(indices()).toEqual(['0', '1', '2']);
    await expectNoA11yViolations(screen.getByRole('menu'));
  });

  it('numbers a row inserted in the middle without renumbering its caller', () => {
    // The point of DOM-order registration: the list around the new row is
    // written exactly as before, and every row after it still moves up one.
    const view = render(
      openMenu(
        <>
          <MenuItem label="First" />
          <MenuItem label="Third" />
        </>,
      ),
    );
    expect(indices()).toEqual(['0', '1']);

    view.rerender(
      openMenu(
        <>
          <MenuItem label="First" />
          <MenuItem label="Second" />
          <MenuItem label="Third" />
        </>,
      ),
    );

    expect(indices()).toEqual(['0', '1', '2']);
  });

  it('renumbers the rows after one that is removed', () => {
    const view = render(
      openMenu(
        <>
          <MenuItem label="First" />
          <MenuItem key="middle" label="Middle" />
          <MenuItem label="Last" />
        </>,
      ),
    );
    expect(indices()).toEqual(['0', '1', '2']);

    view.rerender(
      openMenu(
        <>
          <MenuItem label="First" />
          <MenuItem label="Last" />
        </>,
      ),
    );

    expect(indices()).toEqual(['0', '1']);
  });

  it('announces the checked row as the chosen radio option', () => {
    render(
      openMenu(
        <>
          <MenuItem checked={false} label="Newest first" />
          <MenuItem checked label="Oldest first" />
          <MenuItem checked={false} label="Recently opened" />
        </>,
      ),
    );

    const rows = screen.getAllByRole('menuitemradio');
    // The checked row marks itself, and the surface finds it through the same
    // derived indices the rows above are numbered by.
    expect(rows.map((row) => row.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    expect(indices()).toEqual(['0', '1', '2']);
  });
});

describe('MenuItem destructive rows', () => {
  it('keeps the error colour on the label and glyph, at rest and highlighted', () => {
    render(openMenu(<MenuItem destructive icon={ChevronRight} label="Delete" />));

    const row = screen.getByRole('menuitem', { name: 'Delete' });
    // The label's own tone class, and the drawn glyph rather than the
    // invisible one that reserves its stroke width.
    const label = row.querySelector('[data-menu-item-label]');
    const glyph = row.querySelector('.inline-grid > svg');
    expect(label?.className).toContain('text-destructive');
    expect(glyph?.getAttribute('class')).toContain('text-destructive');

    // Focus highlights the row, which lights an ordinary label to full ink.
    act(() => row.focus());
    expect(label?.className).toContain('text-destructive');
    expect(label?.className).not.toContain('text-foreground');
    expect(glyph?.getAttribute('class')).toContain('text-destructive');
    expect(glyph?.getAttribute('class')).not.toContain('text-foreground');
  });
});

describe('MenuItem rows that lead somewhere', () => {
  /** Two layers in one surface: the first row swaps the list under the
   *  pointer instead of closing the menu, the way a level list keeps its
   *  model list one layer deeper. */
  function Layers() {
    const [deep, setDeep] = useState(false);
    return openMenu(
      deep ? (
        <MenuItem checked label="Deeper choice" />
      ) : (
        <MenuItem
          closeOnClick={false}
          label="Go deeper"
          onSelect={() => setDeep(true)}
          trailingIcon={ChevronRight}
        />
      ),
    );
  }

  it('keeps the surface open when a row asks to, and wears its glyph where a check would go', async () => {
    const user = userEvent.setup();
    render(<Layers />);

    const row = screen.getByRole('menuitem', { name: 'Go deeper' });
    expect(row.querySelector('svg')).not.toBeNull();
    await expectNoA11yViolations(screen.getByRole('menu'));

    await user.click(row);
    expect(screen.getByRole('menu')).not.toBeNull();
    expect(screen.getByRole('menuitemradio', { name: 'Deeper choice' })).not.toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Go deeper' })).toBeNull();
  });
});
