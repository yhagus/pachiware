import { toast } from "sonner";

export function CopyId({ value, className = "" }: { value: string; className?: string }) {
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(value).then(() => toast.success("Copied"), () => toast.error("Copy failed"));
  };
  return <button type="button" onClick={copy} title="Copy ID" aria-label={`Copy ID ${value}`} className={`rounded px-1 font-mono text-xs text-muted-foreground hover:bg-muted hover:text-foreground ${className}`}>{value}</button>;
}
