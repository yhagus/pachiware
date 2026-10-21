import { useEffect, useId, useRef, useState, type ComponentProps, type KeyboardEvent } from "react";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type Props = Omit<ComponentProps<typeof Input>, "value" | "onChange" | "list"> & {
  options: string[]; value: string; onValueChange: (value: string) => void;
  /** Takes a picked option instead of `onValueChange`, for a field that adds what is picked to a list. */
  onPick?: (option: string) => void;
};

// A text field that suggests values from a list, drawn like the app's Select instead of the browser's datalist.
// Any typed value stays valid; className goes on the wrapper, so it sizes the field inside a flex row.
export function ComboboxInput({ options, value, onValueChange, onPick, className, onKeyDown, ...props }: Props) {
  const listId = useId();
  const anchor = useRef<HTMLDivElement>(null);
  // State, not a ref: the list mounts a render after it opens, and the scroll below has to run then.
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  // Opening shows every option; typing narrows them to the ones containing the text.
  const [filtering, setFiltering] = useState(false);
  const [active, setActive] = useState(-1);
  const query = value.trim().toLowerCase();
  const shown = filtering && query ? options.filter((o) => o.toLowerCase().includes(query)) : options;
  const expanded = open && shown.length > 0 && !props.disabled;
  const optionId = (i: number) => `${listId}-${i}`;

  // Keeps the active option in view by scrolling the list alone; scrollIntoView would scroll the page under it too.
  // It measures a frame later: the list takes the field's width once Radix has placed it, and long options rewrap then.
  useEffect(() => {
    const el = active >= 0 ? document.getElementById(`${listId}-${active}`) : null;
    if (!box || !el) return;
    const frame = requestAnimationFrame(() => {
      if (el.offsetTop < box.scrollTop) box.scrollTop = el.offsetTop;
      else if (el.offsetTop + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = el.offsetTop + el.offsetHeight - box.clientHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [box, active, listId]);

  const show = () => { setFiltering(false); setActive(options.indexOf(value)); setOpen(true); };
  const pick = (option: string) => { (onPick ?? onValueChange)(option); setOpen(false); };
  // The caller's onKeyDown runs after, and finds the event's default prevented when the list took the key.
  const keyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!expanded) show();
      else {
        const step = e.key === "ArrowDown" ? 1 : -1;
        setActive((i) => (i < 0 ? (step > 0 ? 0 : shown.length - 1) : (i + step + shown.length) % shown.length));
      }
    } else if (e.key === "Enter") {
      if (expanded && active >= 0) { e.preventDefault(); pick(shown[active]); }
      setOpen(false);
    }
    onKeyDown?.(e);
  };

  return (
    <Popover open={expanded} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div ref={anchor} className={cn("relative", className)}>
          <Input role="combobox" spellCheck={false} aria-expanded={expanded} aria-controls={expanded ? listId : undefined} aria-autocomplete="list" aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
            className={cn("cursor-text", options.length > 0 && "pr-9")} value={value} onClick={() => !expanded && show()} onKeyDown={keyDown}
            onChange={(e) => { onValueChange(e.target.value); setFiltering(true); setActive(-1); setOpen(true); }} {...props} />
          {options.length > 0 && <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 opacity-50" />}
        </div>
      </PopoverAnchor>
      {/* Focus stays in the field. The list sits in a portal outside any open Dialog, whose scroll lock would cancel its wheel and touch scrolling. */}
      <PopoverContent ref={setBox} id={listId} role="listbox" align="start" className="relative max-h-60 w-(--radix-popover-trigger-width) overflow-y-auto p-1"
        onOpenAutoFocus={(e) => e.preventDefault()} onCloseAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => anchor.current?.contains(e.target as Node) && e.preventDefault()}
        onWheel={(e) => e.stopPropagation()} onTouchMove={(e) => e.stopPropagation()}>
        {shown.map((o, i) => (
          <div key={o} id={optionId(i)} role="option" aria-selected={i === active} onMouseDown={(e) => e.preventDefault()} onMouseMove={() => setActive(i)} onClick={() => pick(o)}
            className="relative flex w-full items-center rounded-sm py-1.5 pr-8 pl-2 text-sm wrap-anywhere select-none aria-selected:bg-accent aria-selected:text-accent-foreground">
            {o}
            {o === value && <CheckIcon className="absolute right-2 size-4" />}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
