import { FileTypeIcon } from '@/components/ui/file-type-icon';
import { PathTail } from '@/shared/ui/path-tail';
import { basePathName, parentPathOf } from '@/shared/utils/file-path';

/** A result row reads as file, then where it is, then what was matched. */
export function rowLabel(path: string, ...details: readonly (string | null)[]): string {
  return [basePathName(path), parentPathOf(path), ...details]
    .filter((part): part is string => part !== null && part !== '')
    .join(', ');
}

/** The file identity every backend puts at the head of a result: its name,
 *  then the folder it sits in. The folder trails the name rather than taking
 *  a line of its own, where a bare word read as a tag rather than a place;
 *  its trailing slash says what it is, and names stay on one left edge to
 *  scan. Every result's accessible name already carries the folder, so the
 *  visible one is not read twice. */
export function SourceName({ path }: { path: string }) {
  const directory = parentPathOf(path);
  return (
    <>
      {/* A 16px slot whatever size the glyph runs at, so the name starts on
       *  the indent the rows beneath it use (36px under a group's head, 24px
       *  inside an item). */}
      <span className="flex w-4 shrink-0 items-center">
        <FileTypeIcon aria-hidden="true" className="text-muted-foreground" path={path} />
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="max-w-full shrink-0 truncate font-medium text-foreground">
          {basePathName(path)}
        </span>
        {directory && (
          <PathTail aria-hidden="true" className="text-muted-foreground" path={`${directory}/`} />
        )}
      </span>
    </>
  );
}
