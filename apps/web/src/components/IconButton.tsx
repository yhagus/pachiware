import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function IconButton({ label, children, ...props }: { label: string } & Omit<ComponentProps<typeof Button>, "size" | "title">) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild><Button size="icon" variant="ghost" aria-label={label} {...props}>{children}</Button></TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
