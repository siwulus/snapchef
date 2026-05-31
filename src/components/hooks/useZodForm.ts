import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const useZodForm = <Schema extends z.ZodType<any, any>>(schema: Schema, defaultValues: z.infer<Schema>) =>
  useForm<z.infer<Schema>>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema as any),
    defaultValues,
  });
