/**
 * `@/components/ui/dropdown` — the stable entry for every dropdown surface.
 *
 * This file is a re-export barrel and nothing else. The implementation is
 * split by surface, because one 600-line module held all of them plus their
 * shared machinery and every overlay was written more than once:
 *
 *   - `./dropdown-menu`    — the popup root and its trigger;
 *   - `./dropdown-content` — the portalled popup surface;
 *   - `./dropdown-parts`   — the group caption and separator, shared with select;
 *   - `./dropdown-surface` — the overlays, pointer/focus wiring and popup
 *     transition every one of those surfaces draws.
 *
 * There was a third surface here — `Dropdown`, an always-rendered inline panel
 * that implemented the menu keyboard pattern itself because it had no
 * primitive underneath. Nothing in the product ever mounted one; its roving
 * focus, its Home/End handling and MenuItem's whole standalone branch existed
 * to serve stories. The popup is the dropdown.
 *
 * A barrel is normally a pass-through worth deleting. This one is not: it is
 * the published import path of a vendored kit primitive, and the split behind
 * it is an implementation detail no caller should have to track. Callers keep
 * importing `@/components/ui/dropdown` and get exactly the exports they always
 * did.
 */

export { DropdownContent, pointAnchor, type DropdownAnchor } from './dropdown-content';
export { DropdownMenu, DropdownTrigger } from './dropdown-menu';
export { MenuLabel as DropdownLabel, MenuSeparator as DropdownSeparator } from './dropdown-parts';
