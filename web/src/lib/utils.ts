// The class-name helper shadcn/ui components use: joins the classes and lets a later Tailwind class win over an
// earlier one that sets the same property.
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
