import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function shortHash(hash: string, len = 8): string {
  if (!hash) return "";
  return hash.length > len * 2
    ? `${hash.slice(0, len)}...${hash.slice(-len)}`
    : hash;
}
