import { useId } from "react";
import { Input } from "@/components/ui/input";

// The browser's own zone list, so the field needs no bundled table; older browsers still get a free-text field.
const ZONES: string[] = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];

export function TimezoneInput({ id, value, placeholder, onChange }: { id: string; value: string; placeholder?: string; onChange: (value: string) => void }) {
  const listId = useId();
  return (
    <>
      <Input id={id} list={listId} value={value} placeholder={placeholder ?? "Asia/Jakarta"} autoComplete="off" spellCheck={false} onChange={(e) => onChange(e.target.value.trim())} />
      <datalist id={listId}>{ZONES.map((z) => <option key={z} value={z} />)}</datalist>
    </>
  );
}
