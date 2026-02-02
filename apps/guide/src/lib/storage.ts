import { DISPLAY_STORAGE_KEY } from "../constants/guide";
import type { DisplaySettings } from "../types/guide";

export function loadDisplaySettings(): DisplaySettings {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(DISPLAY_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as DisplaySettings;
    return parsed ?? {};
  } catch {
    return {};
  }
}

export function loadScreenId(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem("chiba:screen") ?? "";
  } catch {
    return "";
  }
}
