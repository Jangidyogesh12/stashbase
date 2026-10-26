import { Button } from '@/components/ui/button';
import { SignInPageLink } from '@/shared/ui/sign-in-page-link';

/** The browser half of a sign-in: what to finish there, the page again, and
 *  the way out of waiting, last and quietest. */
export function BrowserWait({
  url,
  onOpen,
  onStop,
}: {
  url: string | null;
  onOpen(url: string): void;
  onStop: (() => void) | null;
}) {
  return (
    <div className="flex flex-col items-start gap-1">
      <p className="text-foreground" role="status">
        Finish signing in to StashBase in your browser.
      </p>
      {url && <SignInPageLink url={url} onOpen={onOpen} />}
      {onStop && (
        <Button onClick={onStop} size="compact" variant="ghost">
          Stop waiting
        </Button>
      )}
    </div>
  );
}
