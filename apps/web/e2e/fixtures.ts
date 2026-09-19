import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { test as base } from "@playwright/test";

import { signedInState } from "./session";

export { expect } from "@playwright/test";

// Directly constructed contexts use signedInContext/signedInState instead.
export const test = base.extend({
  // `provide`, not Playwright's usual `use`: react-hooks/rules-of-hooks reads
  // a bare `use(...)` call as a misplaced React hook.
  storageState: async ({ browser }, provide) => {
    await provide(await signedInState(browser));
  },
  context: async ({ context }, provide) => {
    await setupClerkTestingToken({ context });
    await provide(context);
  },
});
