import antigravityMark from '@lobehub/icons-static-svg/icons/antigravity.svg?raw';
import claudeMark from '@lobehub/icons-static-svg/icons/claude-color.svg?raw';
import openAiMark from '@lobehub/icons-static-svg/icons/openai.svg?raw';

import type { IconComponentProps } from '@/lib/icon-context';

import { Logo } from './logo';

/** The vendor marks fill their whole 24-unit viewBox while lucide keeps a
 *  2-unit safe area, so the viewBox widens by that margin to give both the
 *  same optical footprint at any size. */
const VIEW_BOX = '-2 -2 28 28';

function brandIcon(source: string, displayName: string) {
  const markup = source
    .replace(/^\s*<svg[^>]*>/u, '')
    .replace(/<\/svg>\s*$/u, '')
    .replace(/<title>[^<]*<\/title>/u, '');
  function BrandIcon({ className, size = 24 }: IconComponentProps) {
    return (
      <svg
        aria-hidden="true"
        className={className}
        dangerouslySetInnerHTML={{ __html: markup }}
        fill="currentColor"
        height={size}
        viewBox={VIEW_BOX}
        width={size}
        xmlns="http://www.w3.org/2000/svg"
      />
    );
  }
  BrandIcon.displayName = displayName;
  return BrandIcon;
}

export const ClaudeIcon = brandIcon(claudeMark, 'ClaudeIcon');
/** Codex is OpenAI's coding Agent. Use the familiar OpenAI/ChatGPT knot
 * instead of the Codex terminal badge so readers can recognize its provider. */
export const CodexIcon = brandIcon(openAiMark, 'CodexIcon');
/** Antigravity is Google's coding Agent. Its single-path mark takes the ink
 *  colour; the multicolour mark's masks and filters carry fixed ids that
 *  collide when several marks share a page. */
export const AntigravityIcon = brandIcon(antigravityMark, 'AntigravityIcon');

/** The bundled Agent wears StashBase's own mark: it is the runtime the app
 *  ships rather than a vendor's, so the app's mark is what names it.
 *
 *  The logo is drawn for the 40px welcome lockup, and two things have to move
 *  for it to sit beside the vendor marks. Its box is recentred on the mark's
 *  own bounds, which sit low and left of the 512-unit square, so the glyph
 *  lands at about 11.5px of a 16px icon, near the 13.7px vendor marks. Its
 *  strokes, 1px at that size, thicken a
 *  quarter to the 1.25px the marks around them carry.
 *
 *  Like the vendor marks it ignores `strokeWidth`: the two weights are part
 *  of the drawing, and a caller's icon stroke is not the mark's to take. */
export function StashBaseIcon({ className, size = 24 }: IconComponentProps) {
  return (
    <Logo
      aria-hidden="true"
      className={className}
      height={size}
      strokeScale={1.25}
      viewBox="6 -21 512 512"
      width={size}
    />
  );
}
