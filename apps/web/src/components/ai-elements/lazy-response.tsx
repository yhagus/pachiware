import { lazy, Suspense, type ComponentProps } from "react";
import type { MessageResponse as Eager } from "./message";

const Loaded = lazy(() => import("./message").then((m) => ({ default: m.MessageResponse })));

/** MessageResponse loaded on first use, so Streamdown and its highlighter stay out of the console's main bundle; the plain text shows meanwhile. */
export function MessageResponse(props: ComponentProps<typeof Eager>) {
  return (
    <Suspense fallback={<div className="whitespace-pre-wrap">{props.children}</div>}>
      <Loaded {...props} />
    </Suspense>
  );
}
