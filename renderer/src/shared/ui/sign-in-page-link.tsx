import { focusRing } from '@/lib/focus-ring';
import { shapeTokens } from '@/lib/shape-context';
import { cn } from '@/lib/utils';

/** The way back to a provider's sign-in page when the browser a runtime's own
 *  login opens never appeared. The page is the one that login printed. */
export function SignInPageLink({
  className,
  url,
  onOpen,
}: {
  className?: string;
  url: string;
  onOpen(url: string): void;
}) {
  return (
    <p className={cn('text-caption text-muted-foreground', className)}>
      Browser did not open?{' '}
      <button
        className={cn(
          'cursor-pointer text-foreground underline-offset-2 hover:underline',
          focusRing(shapeTokens.item),
        )}
        onClick={() => onOpen(url)}
        type="button"
      >
        Open sign-in page
      </button>
    </p>
  );
}
