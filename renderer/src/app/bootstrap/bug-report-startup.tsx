import { createRoot, type Root } from 'react-dom/client';

import { Providers } from '@/app/providers';
import {
  BugReportReview,
  createBugReportReviewAdapter,
  createBugReportReviewRuntime,
} from '@/features/bug-report/public';
import { readBugReportReviewBridge } from '@/platform/electron/bug-report-review';

import { StartupFailure } from './startup-failure';

/** The review window's composition root: one runtime over the preload
 *  bridge for the life of the window. Main opened this window and retires
 *  its draft when it closes, so closing is the window closing itself. */
export function mountBugReportReview(rootElement: HTMLElement): Root {
  const root = createRoot(rootElement);
  try {
    const bridge = readBugReportReviewBridge();
    const runtime = createBugReportReviewRuntime(createBugReportReviewAdapter(bridge), {
      closeWindow: () => window.close(),
    });
    root.render(
      <Providers>
        <BugReportReview runtime={runtime} />
      </Providers>,
    );
  } catch (cause) {
    console.error('StashBase bug report startup failed.', cause);
    document.title = 'Report a Bug · Startup error';
    root.render(<StartupFailure />);
  }
  document.body.dataset.bootSettled = '1';
  return root;
}
