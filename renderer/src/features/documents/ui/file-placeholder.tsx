import { FileQuestion } from 'lucide-react';
import type { ReactNode } from 'react';

/** What stands in for a file a viewer cannot show: its glyph, a title, the
 *  sentence that explains it, and whatever the reader can do next. */
export function FilePlaceholder({
  children,
  description,
  role,
  title,
}: {
  children?: ReactNode;
  description: string;
  role: 'alert' | 'status';
  title: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-8 text-center">
      <div className="max-w-md">
        <FileQuestion
          aria-hidden="true"
          className="mx-auto size-4 text-muted-foreground"
          strokeWidth={1.5}
        />
        <h2 className="mt-3 text-body font-medium">{title}</h2>
        <p className="mt-1 text-caption leading-relaxed text-muted-foreground" role={role}>
          {description}
        </p>
        {children}
      </div>
    </div>
  );
}
