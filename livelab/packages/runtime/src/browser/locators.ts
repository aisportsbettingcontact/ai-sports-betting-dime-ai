import type { Locator as PwLocator, Page } from 'playwright-core';
import { Locator, LiveLabError, ERROR_CODES } from '@livelab/protocol';

/**
 * Resolve a protocol locator to a Playwright locator. Stable strategies
 * (role/label/placeholder/text/testId) are preferred; CSS is the fallback.
 */
export function resolveLocator(page: Page, locator: Locator): PwLocator {
  let resolved: PwLocator;
  switch (locator.strategy) {
    case 'role':
      resolved = page.getByRole(locator.value as Parameters<Page['getByRole']>[0], {
        name: locator.name || undefined,
      });
      break;
    case 'label':
      resolved = page.getByLabel(locator.value);
      break;
    case 'placeholder':
      resolved = page.getByPlaceholder(locator.value);
      break;
    case 'text':
      resolved = page.getByText(locator.value);
      break;
    case 'testId':
      resolved = page.getByTestId(locator.value);
      break;
    case 'css':
      resolved = page.locator(locator.value);
      break;
    default:
      throw new LiveLabError(ERROR_CODES.INVALID_INPUT, `Unknown locator strategy`);
  }
  if (locator.nth !== undefined) resolved = resolved.nth(locator.nth);
  return resolved;
}

export function describeLocator(locator: Locator): string {
  const base = `${locator.strategy}=${locator.value}`;
  return locator.name ? `${base} (name=${locator.name})` : base;
}
