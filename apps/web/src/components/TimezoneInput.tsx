import { ComboboxInput } from "@/components/ComboboxInput";

// The browser's own zone list, so the field needs no bundled table; older browsers still get a free-text field.
const ZONES: string[] = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];

export function TimezoneInput({ id, value, placeholder, onChange }: { id: string; value: string; placeholder?: string; onChange: (value: string) => void }) {
  return <ComboboxInput id={id} options={ZONES} value={value} placeholder={placeholder ?? "Asia/Jakarta"} onValueChange={(v) => onChange(v.trim())} />;
}
