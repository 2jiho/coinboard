// Class names for shadcn-svelte components: later Tailwind classes win over
// earlier ones (tailwind-merge), and conditional classes are allowed (clsx).
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
