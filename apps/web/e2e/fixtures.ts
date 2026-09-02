import { test as base } from "@playwright/test";

import { signedInState } from "./session";

export { expect } from "@playwright/test";

// storageState is the one seam every consumer is built from — page, context,
// and the standalone request fixture — so refreshing it here reaches all of
// them without a spec having to remember.
export const test = base.extend({
  // `provide`, not Playwright's usual `use`: react-hooks/rules-of-hooks reads
  // a bare `use(...)` call as a misplaced React hook.
  storageState: async ({ browser }, provide) => {
    await provide(await signedInState(browser));
  },
});
