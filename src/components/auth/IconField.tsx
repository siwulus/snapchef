import type { ReactNode } from "react";
import type { ControllerRenderProps } from "react-hook-form";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

interface IconFieldProps {
  field: ControllerRenderProps;
  type?: string;
  placeholder?: string;
  icon: ReactNode;
  endContent?: ReactNode;
  hint?: ReactNode;
}

export function IconField({ field, type = "text", placeholder, icon, endContent, hint }: IconFieldProps) {
  return (
    <div>
      <div className="relative">
        <span className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2">{icon}</span>
        <Input {...field} type={type} placeholder={placeholder} className={cn("h-9 pl-8", endContent && "pr-8")} />
        {endContent}
      </div>
      {hint}
    </div>
  );
}
