import type { Map as MaplibreMap } from "maplibre-gl";
import type { BasemapKind } from "../../map";
import type { Language } from "../../i18n";

const STORAGE_KEY = "forest-fires:session";
const WEBGL_RELOAD_KEY = "forest-fires:webgl-reload-attempted";
const WEBGL_RESTORE_TIMEOUT_MS = 8_000;
const WEBGL_RELOAD_COOLDOWN_MS = 60_000;

export interface PersistedAppState {
  savedAt: number;
  camera: {
    center: [number, number];
    zoom: number;
    bearing: number;
    pitch: number;
  };
  mode: "current" | "past";
  year: string;
  daysRange: number;
  basemap: BasemapKind;
  language: Language;
  activeFiresVisible: boolean;
  burntAreasVisible: boolean;
  placeLabelsVisible: boolean;
}

interface LifecycleOptions {
  map: MaplibreMap;
  captureState: () => PersistedAppState;
  pauseBackgroundWork: () => void;
  resumeBackgroundWork: (hiddenForMs: number) => void;
  reapplyMapState: () => void;
  onWebglRecoveryChange?: (recovering: boolean) => void;
}

const BASEMAPS = new Set<BasemapKind>([
  "plain",
  "positron",
  "bright",
  "liberty",
  "dark",
  "fiord",
  "satellite",
  "3d",
]);
const LANGUAGES = new Set<Language>(["en", "es", "de", "fr"]);

/** Returns a previously persisted session when its shape is still usable.
 * Storage is best-effort: privacy modes and full storage quotas must not
 * prevent the application from starting. */
export function loadPersistedAppState(): PersistedAppState | undefined {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "");
    if (!isPersistedAppState(value)) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

export function restoreMapCamera(
  map: MaplibreMap,
  state: PersistedAppState | undefined,
): void {
  if (!state) return;
  map.jumpTo({
    center: state.camera.center,
    zoom: state.camera.zoom,
    bearing: state.camera.bearing,
    pitch: state.camera.pitch,
  });
}

/** Coordinates browser page lifecycle and WebGL recovery without owning
 * application-specific timers or UI. Returns cleanup for future teardown. */
export function installAppLifecycle(options: LifecycleOptions): () => void {
  let suspended = document.visibilityState === "hidden";
  let hiddenAt = suspended ? Date.now() : undefined;
  let contextRestoreTimer: number | undefined;

  const persist = (): void => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(options.captureState()));
    } catch {
      // Persistence is an enhancement, not a prerequisite for using the map.
    }
  };

  const suspend = (): void => {
    logLifecycle("suspend");
    persist();
    if (suspended) return;
    suspended = true;
    hiddenAt = Date.now();
    options.pauseBackgroundWork();
  };

  const resume = (): void => {
    if (document.visibilityState === "hidden") return;

    const hiddenForMs = hiddenAt === undefined ? 0 : Date.now() - hiddenAt;
    hiddenAt = undefined;
    const wasSuspended = suspended;
    suspended = false;
    logLifecycle("resume", { hiddenForMs, wasSuspended });

    options.map.resize();
    options.map.triggerRepaint();
    options.reapplyMapState();
    if (wasSuspended) options.resumeBackgroundWork(hiddenForMs);
  };

  const onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") suspend();
    else resume();
  };

  const onContextLost = (): void => {
    logLifecycle("webglcontextlost");
    options.onWebglRecoveryChange?.(true);
    window.clearTimeout(contextRestoreTimer);
    contextRestoreTimer = window.setTimeout(() => {
      contextRestoreTimer = undefined;
      try {
        const lastReloadAttempt = Number(
          sessionStorage.getItem(WEBGL_RELOAD_KEY),
        );
        if (
          Number.isFinite(lastReloadAttempt) &&
          Date.now() - lastReloadAttempt < WEBGL_RELOAD_COOLDOWN_MS
        ) {
          return;
        }
        sessionStorage.setItem(WEBGL_RELOAD_KEY, String(Date.now()));
      } catch {
        // Without the one-attempt marker, reloading could create a loop.
        return;
      }
      window.location.reload();
    }, WEBGL_RESTORE_TIMEOUT_MS);
  };

  const onContextRestored = (): void => {
    logLifecycle("webglcontextrestored");
    window.clearTimeout(contextRestoreTimer);
    contextRestoreTimer = undefined;
    try {
      sessionStorage.removeItem(WEBGL_RELOAD_KEY);
    } catch {
      // Ignore unavailable session storage.
    }
    options.map.resize();
    options.reapplyMapState();
    options.map.triggerRepaint();
    options.onWebglRecoveryChange?.(false);
  };

  document.addEventListener("visibilitychange", onVisibilityChange);
  document.addEventListener("freeze", suspend);
  document.addEventListener("resume", resume);
  window.addEventListener("pagehide", persist);
  window.addEventListener("pageshow", resume);
  options.map.on("webglcontextlost", onContextLost);
  options.map.on("webglcontextrestored", onContextRestored);
  if (suspended) options.pauseBackgroundWork();

  return () => {
    persist();
    window.clearTimeout(contextRestoreTimer);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    document.removeEventListener("freeze", suspend);
    document.removeEventListener("resume", resume);
    window.removeEventListener("pagehide", persist);
    window.removeEventListener("pageshow", resume);
    options.map.off("webglcontextlost", onContextLost);
    options.map.off("webglcontextrestored", onContextRestored);
  };
}

function logLifecycle(
  event: string,
  details?: Record<string, unknown>,
): void {
  if (import.meta.env.DEV) console.info(`[Lifecycle] ${event}`, details ?? "");
}

function isPersistedAppState(value: unknown): value is PersistedAppState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<PersistedAppState>;
  const camera = state.camera;
  return (
    typeof state.savedAt === "number" &&
    (state.mode === "current" || state.mode === "past") &&
    typeof state.year === "string" &&
    [1, 7, 30].includes(state.daysRange ?? 0) &&
    BASEMAPS.has(state.basemap as BasemapKind) &&
    LANGUAGES.has(state.language as Language) &&
    typeof state.activeFiresVisible === "boolean" &&
    typeof state.burntAreasVisible === "boolean" &&
    typeof state.placeLabelsVisible === "boolean" &&
    !!camera &&
    Array.isArray(camera.center) &&
    camera.center.length === 2 &&
    camera.center.every(Number.isFinite) &&
    Number.isFinite(camera.zoom) &&
    Number.isFinite(camera.bearing) &&
    Number.isFinite(camera.pitch)
  );
}
