import { useState } from "react";

/**
 * `value`, or while it is empty the last value it held. A dialog or sheet opens on `value` and draws its content from this,
 * so the content stays as it was while the dialog animates closed after `value` is cleared.
 */
export function useLastShown<T>(value: T): T {
  const [shown, setShown] = useState(value);
  if (value && value !== shown) setShown(value);
  return value || shown;
}
