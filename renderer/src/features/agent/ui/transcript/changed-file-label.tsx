import { FileTypeIcon } from '@/components/ui/file-type-icon';
import { basePathName, parentPathOf } from '@/shared/utils/file-path';

/** A changed file as its row names it: the type glyph, the file's name, and
 *  the folder it sits in. `shownPath` is where the reader knows the file when
 *  that differs from the path the runtime reported. */
export function ChangedFileLabel({
  iconSize,
  path,
  shownPath = path,
}: {
  iconSize: number;
  path: string;
  shownPath?: string | undefined;
}) {
  const directory = parentPathOf(shownPath);
  return (
    <>
      <FileTypeIcon
        aria-hidden="true"
        className="shrink-0 text-muted-foreground"
        path={path}
        size={iconSize}
      />
      <span className="shrink-0 font-medium text-foreground" title={path}>
        {basePathName(path)}
      </span>
      {directory && (
        <span className="min-w-0 truncate text-muted-foreground" title={path}>
          {directory}
        </span>
      )}
    </>
  );
}
