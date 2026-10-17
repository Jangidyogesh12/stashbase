/** The icon a crew member's catalog entry names. The catalog sends a generic
 *  name, and one this build does not know reads as a plain person. */
import { BookOpen, PenLine, SearchCheck, Sparkle, UserRound, type LucideIcon } from 'lucide-react';

const TOOL_ICONS: Readonly<Record<string, LucideIcon>> = {
  'pen-line': PenLine,
  'search-check': SearchCheck,
  'book-open': BookOpen,
  sparkle: Sparkle,
};

export function agentToolIcon(name: string): LucideIcon {
  return TOOL_ICONS[name] ?? UserRound;
}
