import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import "./App.css";
import { DEFAULT_THEME_ID, THEME_MAP, THEME_ORDER } from "./themes";

type ProgramSlot = {
  title: string;
  subtitle?: string;
  tag?: string;
  url?: string;
  durationSec?: number;
  start: number;
  span: number;
  end: number;
};

type GuideChannel = {
  id: string;
  number: string;
  name: string;
  callSign: string;
  description?: string;
  accent: string;
  previewUrl?: string;
  schedule: ProgramSlot[];
};

type GuideIndex = {
  generatedAt: number;
  slotMinutes: number;
  slotCount: number;
  startTime: string;
  timeSlots: string[];
  channels: GuideChannel[];
};

type PlayerMeta = {
  title: string;
  subtitle?: string;
  channelName?: string;
  callSign?: string;
};

type MediaDebugStats = {
  uptimeSec: number;
  active: number;
  requests: number;
  completed: number;
  bytesSent: number;
  bytesRequested: number;
  errors: number;
  lastRequestAt?: number | null;
  topPaths?: Array<{
    path: string;
    requests: number;
    bytes: number;
    lastAt: number;
  }>;
};

type DisplaySettings = {
  scale?: number;
  hours?: number;
  theme?: string;
};

type MediaKind = "image" | "video" | "audio" | "iframe";

type PreloadEntry = {
  url: string;
  kind: MediaKind;
  status: "loading" | "ready" | "error";
  element: HTMLElement;
  lastUsed: number;
};

type RemoteControl =
  | {
      id: string;
      label: string;
      type: "range";
      min: number;
      max: number;
      step?: number;
      value?: number;
    }
  | {
      id: string;
      label: string;
      type: "select";
      options: { value: string; label: string }[];
      value?: string;
    }
  | {
      id: string;
      label: string;
      type: "toggle";
      value?: boolean;
    }
  | {
      id: string;
      label: string;
      type: "button";
    };

type RemoteMessage =
  | { type: "nav"; dir: "up" | "down" | "left" | "right" }
  | { type: "channel"; dir: "up" | "down" }
  | { type: "tune"; number: string }
  | { type: "dial"; value: string; committed?: boolean }
  | { type: "select" }
  | { type: "guide" }
  | { type: "info" }
  | { type: "app"; appId?: string | null }
  | { type: "index" }
  | {
      type: "now";
      channelId?: string;
      number?: string;
      title?: string;
      url?: string;
    }
  | { type: "godselect"; channelId: string; url: string }
  | { type: "controls"; appId: string; controls: RemoteControl[] }
  | {
      type: "control";
      appId: string;
      controlId: string;
      value?: number | string | boolean;
    }
  | {
      type: "display";
      scale?: number | null;
      hours?: number | null;
      theme?: string | null;
      screenId?: string | null;
    };

const USER_PAUSE_MS = 6500;
const ROW_HEIGHT = 76;
const ROW_GAP = 12;
const AUTO_SCROLL_PX_PER_SEC = 14;
const AUTO_SCROLL_END_HOLD_MS = 2200;
const LANDSCAPE_VISIBLE_HOURS = 3;
const PORTRAIT_VISIBLE_HOURS = 2;
const MIN_VISIBLE_ROWS = 2;
const MAX_VISIBLE_ROWS = 4;
const UI_SCALE_DEFAULT = 1.1;
const DISPLAY_STORAGE_KEY = "chiba:display";
const PRELOAD_MODE: "none" | "image" | "all" = "image";
const PRELOAD_DEBOUNCE_MS = 320;
const PRELOAD_AFTER_PLAY_MS = 1200;
const PRELOAD_CACHE_TTL_MS = 60 * 1000;
const PRELOAD_CACHE_LIMIT = 2;
const DEBUG_CHANNEL_ID = "debug";
const DEBUG_CHANNEL_NUMBER = "026";
const GODMODE_CHANNEL_ID = "godmode";
const GODMODE_CHANNEL_NUMBER = "067";

function isHiddenChannel(channel: GuideChannel): boolean {
  if (!channel) return false;
  const number = normalizeChannelNumber(channel.number ?? "");
  return (
    channel.id === GODMODE_CHANNEL_ID ||
    channel.id === DEBUG_CHANNEL_ID ||
    number === normalizeChannelNumber(GODMODE_CHANNEL_NUMBER) ||
    number === normalizeChannelNumber(DEBUG_CHANNEL_NUMBER)
  );
}
const DIAL_OVERLAY_IDLE_MS = 1200;
const DIAL_OVERLAY_COMMIT_MS = 1800;

const fallbackIndex: GuideIndex = {
  generatedAt: Date.now(),
  slotMinutes: 30,
  slotCount: 6,
  startTime: "16:00",
  timeSlots: ["4:00 PM", "4:30 PM", "5:00 PM", "5:30 PM", "6:00 PM", "6:30 PM"],
  channels: [
    {
      id: "jensen-art",
      number: "042",
      name: "Jensen Art",
      callSign: "ART",
      description: "Interactive web experiments.",
      accent: "#88d6ff",
      previewUrl: "",
      schedule: [
        {
          title: "Multi Phase Field",
          subtitle: "Interactive",
          tag: "ART",
          url: "https://multi-phase-field--jensenabler.replit.app/",
          durationSec: 1800,
          start: 0,
          span: 1,
          end: 0,
        },
        {
          title: "Spiral Evolve",
          subtitle: "Interactive",
          tag: "ART",
          url: "https://spiral-evolve--jensenabler.replit.app/",
          durationSec: 1800,
          start: 1,
          span: 1,
          end: 1,
        },
        {
          title: "Squiggle Evolve",
          subtitle: "Interactive",
          tag: "ART",
          url: "https://squiggle-evolve--jensenabler.replit.app/",
          durationSec: 1800,
          start: 2,
          span: 1,
          end: 2,
        },
        {
          title: "Off Air",
          subtitle: "Standby",
          tag: "ID",
          durationSec: 1800,
          start: 3,
          span: 1,
          end: 3,
        },
        {
          title: "Off Air",
          subtitle: "Standby",
          tag: "ID",
          durationSec: 1800,
          start: 4,
          span: 1,
          end: 4,
        },
        {
          title: "Off Air",
          subtitle: "Standby",
          tag: "ID",
          durationSec: 1800,
          start: 5,
          span: 1,
          end: 5,
        },
      ],
    },
  ],
};

function ensureDebugChannel(indexData: GuideIndex): GuideIndex {
  if (
    indexData.channels.some(
      (channel) =>
        channel.id === DEBUG_CHANNEL_ID ||
        channel.number === DEBUG_CHANNEL_NUMBER
    )
  ) {
    return indexData;
  }
  const slotCount = Math.max(1, indexData.slotCount);
  const schedule: ProgramSlot[] = [
    {
      title: "Diagnostics",
      subtitle: "Bandwidth + health",
      tag: "DEBUG",
      start: 0,
      span: slotCount,
      end: slotCount - 1,
      durationSec: slotCount * indexData.slotMinutes * 60,
    },
  ];
  const debugChannel: GuideChannel = {
    id: DEBUG_CHANNEL_ID,
    number: DEBUG_CHANNEL_NUMBER,
    name: "Debug",
    callSign: "DBG",
    description: "Performance and media load.",
    accent: "#8fa7ff",
    previewUrl: "",
    schedule,
  };
  const channels = [...indexData.channels];
  const insertAt = channels.findIndex((channel) => {
    const number = normalizeChannelNumber(channel.number);
    return number !== null && number > 26;
  });
  if (insertAt === -1) {
    channels.push(debugChannel);
  } else {
    channels.splice(insertAt, 0, debugChannel);
  }
  return {
    ...indexData,
    channels,
  };
}

function ensureSystemChannels(indexData: GuideIndex): GuideIndex {
  return ensureDebugChannel(indexData);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizeChannelNumber(value: string): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function loadDisplaySettings(): DisplaySettings {
  try {
    const raw = window.localStorage.getItem(DISPLAY_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as DisplaySettings;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function loadScreenId(): string {
  try {
    return window.localStorage.getItem("chiba:screen") ?? "";
  } catch {
    return "";
  }
}

function getMediaKind(url: string): MediaKind {
  const cleaned = url.split("?")[0]?.split("#")[0]?.toLowerCase() ?? "";
  if (/\.(png|jpg|jpeg|gif|webp|avif)$/i.test(cleaned)) return "image";
  if (/\.(mp4|webm|ogg|m4v|mov)$/i.test(cleaned)) return "video";
  if (/\.(mp3|wav|aac|m4a|flac|oga)$/i.test(cleaned)) return "audio";
  return "iframe";
}

function getCurrentSlotIndex(
  now: Date,
  startTime: string,
  slotMinutes: number,
  slotCount: number
): number {
  const parts = startTime.split(":");
  const startHour = Number.parseInt(parts[0] ?? "", 10);
  const startMinute = Number.parseInt(parts[1] ?? "", 10);
  if (
    !Number.isFinite(startHour) ||
    !Number.isFinite(startMinute) ||
    slotMinutes <= 0
  ) {
    return 0;
  }
  const start = new Date(now);
  start.setHours(startHour, startMinute, 0, 0);
  const diffMs = now.getTime() - start.getTime();
  const slotIndex = Math.floor(diffMs / (slotMinutes * 60 * 1000));
  return clamp(slotIndex, 0, Math.max(0, slotCount - 1));
}

function getWsUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const wsParam = params.get("ws");
  if (wsParam) return wsParam;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

function getAppIdFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.searchParams.get("appId") ?? parsed.searchParams.get("app");
  } catch {
    return null;
  }
}

function useRemoteSocket(onMessage?: (msg: RemoteMessage) => void) {
  const [status, setStatus] = useState<"connecting" | "open" | "closed">(
    "connecting"
  );
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const retryRef = useRef(0);
  const handlerRef = useRef(onMessage);

  useEffect(() => {
    handlerRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    let cancelled = false;
    const connect = () => {
      if (cancelled) return;
      const url = getWsUrl();
      const socket = new WebSocket(url);
      socketRef.current = socket;
      setStatus("connecting");

      socket.addEventListener("open", () => {
        if (cancelled) return;
        retryRef.current = 0;
        setStatus("open");
      });
      socket.addEventListener("close", () => {
        if (cancelled) return;
        setStatus("closed");
        scheduleReconnect();
      });
      socket.addEventListener("error", () => {
        if (cancelled) return;
        setStatus("closed");
        scheduleReconnect();
      });
      socket.addEventListener("message", (event) => {
        try {
          const parsed = JSON.parse(event.data) as RemoteMessage;
          handlerRef.current?.(parsed);
        } catch {
          // ignore
        }
      });
    };

    const scheduleReconnect = () => {
      if (cancelled || reconnectTimerRef.current !== null) return;
      const attempt = retryRef.current + 1;
      retryRef.current = attempt;
      const delay = Math.min(1000 * 2 ** attempt, 10000);
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay);
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      socketRef.current?.close();
    };
  }, []);

  const send = useCallback((message: RemoteMessage) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(message));
    }
  }, []);

  return { send, status };
}

function App() {
  const isRemote = window.location.pathname.startsWith("/remote");
  const channelId = window.location.pathname.startsWith("/channel/")
    ? window.location.pathname.replace("/channel/", "")
    : null;
  const params = new URLSearchParams(window.location.search);
  const viewMode: "guide" | "remote" | "art" = isRemote
    ? "remote"
    : channelId
    ? "art"
    : "guide";
  const returnRowParam = Number(params.get("r") ?? "");
  const requestedRemoteAppId = params.get("app") ?? params.get("appId") ?? "";
  const scaleParam = params.get("scale");
  const hoursParam = params.get("hours");
  const themeParam = params.get("theme");
  const screenParam = params.get("screen") ?? params.get("screenId");
  const [screenId, setScreenId] = useState(() =>
    screenParam ? screenParam : loadScreenId()
  );
  const [displaySettings, setDisplaySettings] = useState<DisplaySettings>(() =>
    loadDisplaySettings()
  );
  const activeThemeId = useMemo(() => {
    const fromParam = themeParam ? themeParam.trim() : "";
    const fromSettings = displaySettings.theme ?? "";
    const candidate = fromParam || fromSettings || DEFAULT_THEME_ID;
    return THEME_MAP[candidate] ? candidate : DEFAULT_THEME_ID;
  }, [themeParam, displaySettings.theme]);
  const themeVars = useMemo(() => THEME_MAP[activeThemeId]?.vars ?? {}, [
    activeThemeId,
  ]);
  const uiScale = useMemo(() => {
    const raw = scaleParam
      ? Number(scaleParam)
      : displaySettings.scale ?? UI_SCALE_DEFAULT;
    if (!Number.isFinite(raw)) return UI_SCALE_DEFAULT;
    return clamp(raw, 0.85, 1.6);
  }, [scaleParam, displaySettings.scale]);

  const [now, setNow] = useState(() => new Date());
  const [viewportSize, setViewportSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const [indexData, setIndexData] = useState<GuideIndex>(() =>
    ensureSystemChannels(fallbackIndex)
  );
  const slotCount = indexData.timeSlots.length;
  const isPortrait = viewportSize.height >= viewportSize.width;
  const visibleHours = useMemo(() => {
    const raw = hoursParam
      ? Number(hoursParam)
      : displaySettings.hours ?? NaN;
    if (Number.isFinite(raw) && raw > 0) return raw;
    return isPortrait ? PORTRAIT_VISIBLE_HOURS : LANDSCAPE_VISIBLE_HOURS;
  }, [hoursParam, displaySettings.hours, isPortrait]);
  const visibleSlotCount = useMemo(() => {
    const minutes = Math.max(1, indexData.slotMinutes);
    return Math.max(1, Math.round((visibleHours * 60) / minutes));
  }, [indexData.slotMinutes, visibleHours]);
  const allChannels = indexData.channels;
  const channels = useMemo(
    () => allChannels.filter((channel) => !isHiddenChannel(channel)),
    [allChannels]
  );
  const currentSlotIndex = useMemo(
    () =>
      getCurrentSlotIndex(
        now,
        indexData.startTime,
        indexData.slotMinutes,
        slotCount
      ),
    [now, indexData.startTime, indexData.slotMinutes, slotCount]
  );
  const [visibleStartSlot, setVisibleStartSlot] = useState(0);

  const [selectedRow, setSelectedRow] = useState(0);
  const [selectedCol, setSelectedCol] = useState(0);
  const [showQr, setShowQr] = useState(true);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [visibleRows, setVisibleRows] = useState(6);
  const [artIndex, setArtIndex] = useState(0);
  const [artPaused, setArtPaused] = useState(false);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [playerUrl, setPlayerUrl] = useState<string | null>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [playerMeta, setPlayerMeta] = useState<PlayerMeta | null>(null);
  const [preloadUrl, setPreloadUrl] = useState<string | null>(null);
  const [showPlayerHud, setShowPlayerHud] = useState(false);
  const [playerChannelIndex, setPlayerChannelIndex] = useState<number | null>(
    null
  );
  const [preloadTick, setPreloadTick] = useState(0);
  const [hasPreviewMedia, setHasPreviewMedia] = useState(false);
  const [posterImageReady, setPosterImageReady] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [memoryStats, setMemoryStats] = useState<{
    used: number;
    total: number;
    limit: number;
  } | null>(null);
  const [mediaStats, setMediaStats] = useState<MediaDebugStats | null>(null);
  const [remoteGodmodeOpen, setRemoteGodmodeOpen] = useState(false);
  const [remoteNowChannel, setRemoteNowChannel] = useState<{
    id?: string;
    number?: string;
    title?: string;
    url?: string;
  } | null>(null);
  const [godmodeQuery, setGodmodeQuery] = useState("");
  const [dialOverlay, setDialOverlay] = useState("");
  const [dialBuffer, setDialBuffer] = useState("");
  const [remoteControls, setRemoteControls] = useState<RemoteControl[]>([]);
  const [remoteControlsStatus, setRemoteControlsStatus] = useState<
    "idle" | "loading" | "ready" | "missing"
  >("idle");
  const [activeRemoteAppId, setActiveRemoteAppId] =
    useState(requestedRemoteAppId);
  const [remotePanel, setRemotePanel] = useState<"remote" | "app">("remote");

  const pauseUntilRef = useRef(0);
  const autoHoldUntilRef = useRef(0);
  const lastFrameRef = useRef<number | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const preloadTimerRef = useRef<number | null>(null);
  const prevViewModeRef = useRef(viewMode);
  const prevPlayerOpenRef = useRef(playerOpen);
  const prevPausedRef = useRef(false);
  const lastAppMessageRef = useRef<string | null>(null);
  const preloadCacheRef = useRef<Map<string, PreloadEntry>>(new Map());
  const preloadContainerRef = useRef<HTMLDivElement | null>(null);
  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const previewAttachedRef = useRef<HTMLElement | null>(null);
  const lastCurrentSlotRef = useRef<number>(currentSlotIndex);
  const dialTimeoutRef = useRef<number | null>(null);
  const sendRef = useRef<((msg: RemoteMessage) => void) | null>(null);
  const dialOverlayTimerRef = useRef<number | null>(null);

  const moveSelection = useCallback(
    (dir: "up" | "down" | "left" | "right") => {
      pauseUntilRef.current = Date.now() + USER_PAUSE_MS;
      if (dir === "up") {
        setSelectedRow(
          (prev) => (prev - 1 + channels.length) % channels.length
        );
      }
      if (dir === "down") {
        setSelectedRow((prev) => (prev + 1) % channels.length);
      }
      if (dir === "left") {
        const baseRow = selectedRow;
        const schedule = channels[baseRow]?.schedule ?? [];
        setSelectedCol((prev) => {
          if (!schedule.length) return prev;
          const currentIdx = schedule.findIndex(
            (slot) => prev >= slot.start && prev <= slot.end
          );
          const idx = currentIdx >= 0 ? currentIdx : 0;
          const nextIdx = Math.max(idx - 1, 0);
          const target = schedule[nextIdx]?.start ?? prev;
          return Math.max(target, currentSlotIndex);
        });
      }
      if (dir === "right") {
        const baseRow = selectedRow;
        const schedule = channels[baseRow]?.schedule ?? [];
        setSelectedCol((prev) => {
          if (!schedule.length) return prev;
          const currentIdx = schedule.findIndex(
            (slot) => prev >= slot.start && prev <= slot.end
          );
          const idx = currentIdx >= 0 ? currentIdx : 0;
          const nextIdx = Math.min(idx + 1, schedule.length - 1);
          return schedule[nextIdx]?.start ?? prev;
        });
      }
    },
    [channels, selectedRow, currentSlotIndex]
  );

  const isPaused = Date.now() < pauseUntilRef.current;
  const activeRow = selectedRow;

  const selectedChannel = channels[activeRow];
  const selectedProgram =
    selectedChannel?.schedule.find(
      (slot) => selectedCol >= slot.start && selectedCol <= slot.end
    ) ?? selectedChannel?.schedule[0];
  const activeAppId = useMemo(() => getAppIdFromUrl(playerUrl), [playerUrl]);
  const playerKind = useMemo(
    () => (playerUrl ? getMediaKind(playerUrl) : null),
    [playerUrl]
  );
  const godmodeItems = useMemo(() => {
    const items: Array<{
      id: string;
      program: ProgramSlot;
      channel: GuideChannel;
    }> = [];
    const seen = new Set<string>();
    channels.forEach((channel) => {
      if (channel.id === GODMODE_CHANNEL_ID) return;
      channel.schedule.forEach((program, index) => {
        if (!program.url) return;
        const key = `${program.url}|${program.title ?? ""}`;
        if (seen.has(key)) return;
        seen.add(key);
        items.push({
          id: `${channel.id}-${index}`,
          program,
          channel,
        });
      });
    });
    return items;
  }, [channels]);
  const filteredGodmodeItems = useMemo(() => {
    const query = godmodeQuery.trim().toLowerCase();
    if (!query) return godmodeItems;
    return godmodeItems.filter((item) => {
      const haystack = [
        item.program.title,
        item.program.subtitle,
        item.channel.name,
        item.channel.callSign,
        item.channel.number,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [godmodeItems, godmodeQuery]);

  const getProgramForChannel = useCallback(
    (channel: GuideChannel | undefined) => {
      if (!channel) return null;
      return (
        channel.schedule.find(
          (slot) =>
            currentSlotIndex >= slot.start && currentSlotIndex <= slot.end
        ) ?? channel.schedule[0]
      );
    },
    [currentSlotIndex]
  );

  const showDialOverlay = useCallback((value: string, holdMs: number) => {
    if (!value) return;
    setDialOverlay(value);
    if (dialOverlayTimerRef.current) {
      window.clearTimeout(dialOverlayTimerRef.current);
    }
    dialOverlayTimerRef.current = window.setTimeout(() => {
      setDialOverlay("");
    }, holdMs);
  }, []);

  const formatMb = useCallback((bytes: number) => {
    if (!Number.isFinite(bytes)) return "n/a";
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }, []);

  const shouldPreload = useCallback((kind: MediaKind) => {
    if (PRELOAD_MODE === "all") return true;
    if (PRELOAD_MODE === "image") return kind === "image";
    return false;
  }, []);

  const ensurePreloadContainer = useCallback(() => {
    if (preloadContainerRef.current) return preloadContainerRef.current;
    const container = document.createElement("div");
    container.style.position = "absolute";
    container.style.left = "-9999px";
    container.style.top = "0";
    container.style.width = "1px";
    container.style.height = "1px";
    container.style.overflow = "hidden";
    container.style.pointerEvents = "none";
    container.style.opacity = "0";
    document.body.appendChild(container);
    preloadContainerRef.current = container;
    return container;
  }, []);

  const prunePreloadCache = useCallback(() => {
    const nowTs = Date.now();
    const cache = preloadCacheRef.current;
    for (const [key, entry] of cache.entries()) {
      if (nowTs - entry.lastUsed > PRELOAD_CACHE_TTL_MS) {
        entry.element.remove();
        cache.delete(key);
      }
    }
    if (cache.size <= PRELOAD_CACHE_LIMIT) return;
    const entries = Array.from(cache.values()).sort(
      (a, b) => a.lastUsed - b.lastUsed
    );
    const overflow = cache.size - PRELOAD_CACHE_LIMIT;
    for (let i = 0; i < overflow; i += 1) {
      const entry = entries[i];
      entry?.element.remove();
      if (entry) {
        cache.delete(entry.url);
      }
    }
  }, []);

  const queuePreload = useCallback(
    (url: string) => {
      if (!url) return;
      const cache = preloadCacheRef.current;
      const kind = getMediaKind(url);
      if (!shouldPreload(kind)) return;
      const existing = cache.get(url);
      const nowTs = Date.now();
      if (existing) {
        existing.lastUsed = nowTs;
        return;
      }
      const container = ensurePreloadContainer();
      let element: HTMLElement;
      if (kind === "image") {
        const img = document.createElement("img");
        img.src = url;
        element = img;
      } else if (kind === "video") {
        const video = document.createElement("video");
        video.src = url;
        video.muted = true;
        video.preload = "auto";
        video.playsInline = true;
        element = video;
      } else if (kind === "audio") {
        const audio = document.createElement("audio");
        audio.src = url;
        audio.muted = true;
        audio.preload = "auto";
        element = audio;
      } else {
        const frame = document.createElement("iframe");
        frame.src = url;
        frame.setAttribute(
          "sandbox",
          "allow-scripts allow-same-origin allow-pointer-lock"
        );
        frame.setAttribute("allow", "autoplay; fullscreen");
        frame.setAttribute("loading", "eager");
        element = frame;
      }
      element.style.position = "absolute";
      element.style.left = "-9999px";
      element.style.top = "0";
      element.style.width = "1px";
      element.style.height = "1px";
      element.style.opacity = "0";
      element.style.pointerEvents = "none";
      element.setAttribute("aria-hidden", "true");
      container.appendChild(element);

      const entry: PreloadEntry = {
        url,
        kind,
        status: "loading",
        element,
        lastUsed: nowTs,
      };
      cache.set(url, entry);

      if (kind === "image") {
        (element as HTMLImageElement).onload = () => {
          entry.status = "ready";
          entry.lastUsed = Date.now();
          setPreloadTick((prev) => prev + 1);
        };
        (element as HTMLImageElement).onerror = () => {
          entry.status = "error";
          setPreloadTick((prev) => prev + 1);
        };
      } else if (kind === "video") {
        (element as HTMLVideoElement).onloadeddata = () => {
          entry.status = "ready";
          entry.lastUsed = Date.now();
          setPreloadTick((prev) => prev + 1);
        };
        (element as HTMLVideoElement).onerror = () => {
          entry.status = "error";
          setPreloadTick((prev) => prev + 1);
        };
      } else if (kind === "audio") {
        (element as HTMLAudioElement).oncanplaythrough = () => {
          entry.status = "ready";
          entry.lastUsed = Date.now();
          setPreloadTick((prev) => prev + 1);
        };
        (element as HTMLAudioElement).onerror = () => {
          entry.status = "error";
          setPreloadTick((prev) => prev + 1);
        };
      } else {
        (element as HTMLIFrameElement).onload = () => {
          entry.status = "ready";
          entry.lastUsed = Date.now();
          setPreloadTick((prev) => prev + 1);
        };
        (element as HTMLIFrameElement).onerror = () => {
          entry.status = "error";
          setPreloadTick((prev) => prev + 1);
        };
      }

      prunePreloadCache();
    },
    [ensurePreloadContainer, prunePreloadCache, shouldPreload]
  );

  const openProgram = useCallback(
    (program: ProgramSlot, channel: GuideChannel) => {
      if (!program.url) return;
      setPlayerOpen(true);
      if (playerUrl !== program.url) {
        setPlayerReady(false);
        setPlayerUrl(program.url);
      }
      setShowPlayerHud(false);
      const channelIndex = channels.findIndex((item) => item.id === channel.id);
      setPlayerChannelIndex(channelIndex >= 0 ? channelIndex : activeRow);
      setPlayerMeta({
        title: program.title,
        subtitle: program.subtitle,
        channelName: channel.name,
        callSign: channel.callSign,
      });
      sendRef.current?.({
        type: "now",
        channelId: channel.id,
        number: channel.number,
        title: program.title,
        url: program.url,
      });
    },
    [playerUrl, channels, activeRow]
  );

  const handleChannelChange = useCallback(
    (dir: "up" | "down") => {
      if (!channels.length) return;
      const delta = dir === "up" ? -1 : 1;
      const nextRow = (activeRow + delta + channels.length) % channels.length;
      const nextChannel = channels[nextRow];
      setSelectedRow(nextRow);
      setSelectedCol(currentSlotIndex);
      pauseUntilRef.current = Date.now() + USER_PAUSE_MS;
      if (nextChannel?.number) {
        showDialOverlay(nextChannel.number, DIAL_OVERLAY_COMMIT_MS);
        sendRef.current?.({
          type: "dial",
          value: nextChannel.number,
          committed: true,
        });
      }
      const nextProgram = getProgramForChannel(nextChannel);
      if (nextProgram?.url && nextChannel) {
        openProgram(nextProgram, nextChannel);
      } else {
        setPlayerOpen(false);
        if (nextChannel) {
          sendRef.current?.({
            type: "now",
            channelId: nextChannel.id,
            number: nextChannel.number,
            title: nextProgram?.title,
            url: nextProgram?.url,
          });
        }
      }
    },
    [
      channels,
      activeRow,
      currentSlotIndex,
      openProgram,
      getProgramForChannel,
      showDialOverlay,
    ]
  );

  const handleTuneToNumber = useCallback(
    (value: string) => {
      const targetNumber = normalizeChannelNumber(value);
      if (targetNumber === null) return;
      if (targetNumber === normalizeChannelNumber(GODMODE_CHANNEL_NUMBER)) {
        setPlayerOpen(false);
        sendRef.current?.({
          type: "now",
          channelId: GODMODE_CHANNEL_ID,
          number: GODMODE_CHANNEL_NUMBER,
        });
        return;
      }
      if (targetNumber === normalizeChannelNumber(DEBUG_CHANNEL_NUMBER)) {
        setShowDebug(true);
        setPlayerOpen(false);
        sendRef.current?.({
          type: "now",
          channelId: DEBUG_CHANNEL_ID,
          number: DEBUG_CHANNEL_NUMBER,
          title: "Diagnostics",
        });
        return;
      }
      const targetChannel = allChannels.find((channel) => {
        const channelNumber = normalizeChannelNumber(channel.number);
        return channelNumber !== null && channelNumber === targetNumber;
      });
      if (!targetChannel) return;
      const visibleIndex = channels.findIndex(
        (channel) => channel.id === targetChannel.id
      );
      if (visibleIndex >= 0) {
        setSelectedRow(visibleIndex);
        setSelectedCol(currentSlotIndex);
        pauseUntilRef.current = Date.now() + USER_PAUSE_MS;
      }
      const program = getProgramForChannel(targetChannel);
      if (program?.url) {
        openProgram(program, targetChannel);
      } else {
        setPlayerOpen(false);
        sendRef.current?.({
          type: "now",
          channelId: targetChannel.id,
          number: targetChannel.number,
          title: program?.title,
          url: program?.url,
        });
      }
    },
    [allChannels, channels, currentSlotIndex, getProgramForChannel, openProgram]
  );

  const handleGodmodePick = useCallback(
    (program: ProgramSlot, channel: GuideChannel) => {
      const channelIndex = channels.findIndex((item) => item.id === channel.id);
      if (channelIndex >= 0) {
        setSelectedRow(channelIndex);
        setSelectedCol(program.start ?? currentSlotIndex);
      }
      openProgram(program, channel);
    },
    [channels, currentSlotIndex, openProgram]
  );

  const handleSelect = useCallback(() => {
    if (!selectedChannel) return;
    if (
      selectedChannel.id === GODMODE_CHANNEL_ID ||
      selectedChannel.number === GODMODE_CHANNEL_NUMBER
    ) {
      setPlayerOpen(false);
      sendRef.current?.({
        type: "now",
        channelId: selectedChannel.id,
        number: selectedChannel.number,
      });
      return;
    }
    if (
      selectedChannel.id === DEBUG_CHANNEL_ID ||
      selectedChannel.number === DEBUG_CHANNEL_NUMBER
    ) {
      setShowDebug((prev) => !prev);
      return;
    }
    const currentProgram = getProgramForChannel(selectedChannel);
    if (!currentProgram?.url) return;
    openProgram(currentProgram, selectedChannel);
  }, [
    selectedChannel,
    getProgramForChannel,
    openProgram,
  ]);

  const fetchIndex = useCallback(async () => {
    try {
      const res = await fetch("/api/index");
      if (!res.ok) return;
      const data = (await res.json()) as GuideIndex;
      if (data.channels?.length) {
        setIndexData(ensureSystemChannels(data));
      }
    } catch {
      // ignore
    }
  }, []);

  const applyDisplaySettings = useCallback(
    (payload: {
      scale?: number | null;
      hours?: number | null;
      theme?: string | null;
    }) => {
      setDisplaySettings((prev) => {
        const next: DisplaySettings = { ...prev };
        if (payload.scale === null) {
          delete next.scale;
        } else if (typeof payload.scale === "number") {
          next.scale = clamp(payload.scale, 0.85, 1.6);
        }
        if (payload.hours === null) {
          delete next.hours;
        } else if (typeof payload.hours === "number") {
          next.hours = clamp(payload.hours, 1, 6);
        }
        if (payload.theme === null) {
          delete next.theme;
        } else if (typeof payload.theme === "string") {
          if (THEME_MAP[payload.theme]) {
            next.theme = payload.theme;
          }
        }
        return next;
      });
    },
    []
  );

  const { send, status } = useRemoteSocket((msg) => {
    if (msg.type === "display") {
      applyDisplaySettings(msg);
      return;
    }
    if (msg.type === "index") {
      if (viewMode === "guide") {
        void fetchIndex();
      }
      return;
    }
    if (viewMode === "remote") {
      if (msg.type === "app") {
        const nextAppId = msg.appId ?? "";
        if (requestedRemoteAppId) return;
        setActiveRemoteAppId(nextAppId);
      }
      if (msg.type === "dial") {
        if (msg.value) {
          showDialOverlay(
            msg.value,
            msg.committed ? DIAL_OVERLAY_COMMIT_MS : DIAL_OVERLAY_IDLE_MS
          );
        }
      }
      if (msg.type === "now") {
        setRemoteNowChannel({
          id: msg.channelId,
          number: msg.number,
          title: msg.title,
          url: msg.url,
        });
        const normalized = normalizeChannelNumber(msg.number ?? "");
        setRemoteGodmodeOpen(
          msg.channelId === GODMODE_CHANNEL_ID || normalized === 67
        );
      }
      return;
    }

    if (msg.type === "guide") {
      if (playerOpen) {
        setPlayerOpen(false);
        return;
      }
      if (viewMode !== "guide") {
        const returnRow = Number.isFinite(returnRowParam)
          ? Math.floor(returnRowParam)
          : null;
        const target = returnRow === null ? "/" : `/?r=${returnRow}`;
        window.location.assign(target);
      }
      return;
    }
    if (msg.type === "info") {
      if (playerOpen) {
        setShowPlayerHud((prev) => !prev);
      }
      return;
    }
    if (msg.type === "dial") {
      if (msg.value) {
        showDialOverlay(
          msg.value,
          msg.committed ? DIAL_OVERLAY_COMMIT_MS : DIAL_OVERLAY_IDLE_MS
        );
      }
      return;
    }
    if (msg.type === "tune") {
      if (viewMode === "guide") {
        handleTuneToNumber(msg.number);
      }
      return;
    }
    if (msg.type === "godselect") {
      if (viewMode === "guide") {
        const channel = channels.find((item) => item.id === msg.channelId);
        const program = channel?.schedule.find((slot) => slot.url === msg.url);
        if (channel && program) {
          handleGodmodePick(program, channel);
        }
      }
      return;
    }
    if (msg.type === "channel") {
      if (viewMode === "guide") {
        handleChannelChange(msg.dir);
      }
      return;
    }
    if (msg.type === "nav") {
      if (viewMode === "art") {
        const artItems =
          channels
            .find((channel) => channel.id === (channelId ?? "jensen-art"))
            ?.schedule.filter((slot) => slot.url) ?? [];
        if (msg.dir === "left" || msg.dir === "up") {
          setArtIndex((prev) => (prev - 1 + artItems.length) % artItems.length);
        } else if (msg.dir === "right" || msg.dir === "down") {
          setArtIndex((prev) => (prev + 1) % artItems.length);
        }
        return;
      }
      moveSelection(msg.dir);
    }
    if (msg.type === "select") {
      if (viewMode === "art") {
        setArtPaused((prev) => !prev);
      } else {
        handleSelect();
      }
    }
  });

  sendRef.current = send;

  const commitDial = useCallback(
    (value: string) => {
      if (!value) return;
      const normalized = normalizeChannelNumber(value);
      if (normalized === 67) {
        setRemoteGodmodeOpen(true);
      } else {
        setRemoteGodmodeOpen(false);
      }
      send({ type: "dial", value, committed: true });
      showDialOverlay(value, DIAL_OVERLAY_COMMIT_MS);
      send({ type: "tune", number: value });
      setDialBuffer("");
    },
    [send, showDialOverlay]
  );

  const pushDialDigit = useCallback((digit: number) => {
    setDialBuffer((prev) => {
      const next = `${prev}${digit}`.slice(-3);
      return next;
    });
  }, []);

  useEffect(() => {
    if (viewMode !== "remote") {
      setDialBuffer("");
      setRemoteGodmodeOpen(false);
      setRemoteNowChannel(null);
      setGodmodeQuery("");
      return;
    }
    if (!dialBuffer) return;
    if (dialTimeoutRef.current) {
      window.clearTimeout(dialTimeoutRef.current);
    }
    send({ type: "dial", value: dialBuffer });
    showDialOverlay(dialBuffer, DIAL_OVERLAY_IDLE_MS);
    if (dialBuffer.length >= 3) {
      commitDial(dialBuffer);
      return;
    }
    dialTimeoutRef.current = window.setTimeout(() => {
      commitDial(dialBuffer);
    }, 700);
    return () => {
      if (dialTimeoutRef.current) {
        window.clearTimeout(dialTimeoutRef.current);
      }
    };
  }, [dialBuffer, commitDial, viewMode, send, showDialOverlay]);

  const mergeRemoteControls = useCallback(
    (incoming: RemoteControl[], current: RemoteControl[]) =>
      incoming.map((control) => {
        const prev = current.find((item) => item.id === control.id);
        if (!prev) return control;
        if ("value" in prev && prev.value !== undefined) {
          return { ...control, value: prev.value } as RemoteControl;
        }
        return control;
      }),
    []
  );

  const handleRemoteControl = useCallback(
    (controlId: string, value: number | string | boolean) => {
      if (!activeRemoteAppId) return;
      setRemoteControls((prev) =>
        prev.map((control) =>
          control.id === controlId ? { ...control, value } : control
        )
      );
      send({ type: "control", appId: activeRemoteAppId, controlId, value });
    },
    [activeRemoteAppId, send]
  );

  const gridStyle = useMemo(
    () =>
      ({
        "--slots": Math.min(slotCount, visibleSlotCount),
        "--row-height": `${ROW_HEIGHT * uiScale}px`,
        "--row-gap": `${ROW_GAP * uiScale}px`,
        "--ui-scale": uiScale,
        ...themeVars,
      } as CSSProperties),
    [slotCount, visibleSlotCount, uiScale, themeVars]
  );

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    try {
      const payload: DisplaySettings = {};
      if (displaySettings.scale !== undefined) {
        payload.scale = displaySettings.scale;
      }
      if (displaySettings.hours !== undefined) {
        payload.hours = displaySettings.hours;
      }
      if (displaySettings.theme !== undefined) {
        payload.theme = displaySettings.theme;
      }
      window.localStorage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore storage errors
    }
  }, [displaySettings]);

  useEffect(() => {
    if (!screenParam) return;
    setScreenId(screenParam);
    try {
      window.localStorage.setItem("chiba:screen", screenParam);
    } catch {
      // ignore
    }
  }, [screenParam]);

  useEffect(() => {
    if (!themeParam) return;
    if (THEME_MAP[themeParam]) {
      setDisplaySettings((prev) => ({ ...prev, theme: themeParam }));
    }
  }, [themeParam]);

  useEffect(() => {
    const prev = prevViewModeRef.current;
    if (viewMode === "guide" && prev !== "guide") {
      pauseUntilRef.current = Date.now() + USER_PAUSE_MS;
      const maxStart = Math.max(0, slotCount - visibleSlotCount);
      setVisibleStartSlot(clamp(currentSlotIndex, 0, maxStart));
      setSelectedCol(currentSlotIndex);
    }
    prevViewModeRef.current = viewMode;
  }, [viewMode, currentSlotIndex, slotCount, visibleSlotCount]);

  useEffect(() => {
    if (!playerOpen && prevPlayerOpenRef.current) {
      pauseUntilRef.current = Date.now() + USER_PAUSE_MS;
    }
    prevPlayerOpenRef.current = playerOpen;
  }, [playerOpen]);

  useEffect(() => {
    if (!showDebug) return;
    const update = () => {
      const memory = (performance as Performance & { memory?: any }).memory;
      if (!memory) {
        setMemoryStats(null);
        return;
      }
      setMemoryStats({
        used: memory.usedJSHeapSize,
        total: memory.totalJSHeapSize,
        limit: memory.jsHeapSizeLimit,
      });
    };
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [showDebug]);

  useEffect(() => {
    if (!showDebug) {
      setMediaStats(null);
      return;
    }
    let cancelled = false;
    const fetchStats = async () => {
      try {
        const res = await fetch("/api/debug/media");
        if (!res.ok) return;
        const data = (await res.json()) as MediaDebugStats;
        if (!cancelled) {
          setMediaStats(data);
        }
      } catch {
        // ignore
      }
    };
    void fetchStats();
    const interval = window.setInterval(fetchStats, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [showDebug]);

  useEffect(() => {
    if (!prevPausedRef.current && isPaused) {
      const maxScroll = Math.max(
        0,
        (channels.length - visibleRows) * (ROW_HEIGHT + ROW_GAP)
      );
      const anchor = Math.floor(visibleRows / 2);
      const desired = clamp(
        selectedRow - anchor,
        0,
        Math.max(0, channels.length - visibleRows)
      );
      setScrollOffset(clamp(desired * (ROW_HEIGHT + ROW_GAP), 0, maxScroll));
      lastFrameRef.current = null;
      prevPausedRef.current = true;
      return;
    }
    if (prevPausedRef.current && !isPaused) {
      const maxScroll = Math.max(
        0,
        (channels.length - visibleRows) * (ROW_HEIGHT + ROW_GAP)
      );
      const anchor = Math.floor(visibleRows / 2);
      const desired = clamp(
        selectedRow - anchor,
        0,
        Math.max(0, channels.length - visibleRows)
      );
      setScrollOffset(clamp(desired * (ROW_HEIGHT + ROW_GAP), 0, maxScroll));
      lastFrameRef.current = null;
      prevPausedRef.current = false;
      return;
    }
    prevPausedRef.current = isPaused;
  }, [isPaused, channels.length, selectedRow, visibleRows]);

  useEffect(() => {
    return () => {
      preloadCacheRef.current.forEach((entry) => entry.element.remove());
      preloadCacheRef.current.clear();
      preloadContainerRef.current?.remove();
      preloadContainerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (viewMode !== "guide") return;
    const container = previewContainerRef.current;
    if (!container) return;
    if (PRELOAD_MODE !== "all") {
      const cacheContainer = ensurePreloadContainer();
      if (previewAttachedRef.current) {
        const element = previewAttachedRef.current;
        element.style.position = "absolute";
        element.style.left = "-9999px";
        element.style.top = "0";
        element.style.width = "1px";
        element.style.height = "1px";
        element.style.opacity = "0";
        element.style.pointerEvents = "none";
        if (element instanceof HTMLVideoElement) {
          element.pause();
        }
        cacheContainer.appendChild(element);
        previewAttachedRef.current = null;
      }
      setHasPreviewMedia(false);
      return;
    }
    const cacheContainer = ensurePreloadContainer();
    const currentUrl = selectedProgram?.url ?? null;
    const cacheEntry = currentUrl
      ? preloadCacheRef.current.get(currentUrl)
      : null;
    const readyEntry =
      cacheEntry?.status === "ready" && cacheEntry.kind !== "audio"
        ? cacheEntry
        : null;
    const readyElement = readyEntry?.element ?? null;

    const setHiddenStyles = (element: HTMLElement) => {
      element.style.position = "absolute";
      element.style.left = "-9999px";
      element.style.top = "0";
      element.style.width = "1px";
      element.style.height = "1px";
      element.style.opacity = "0";
      element.style.pointerEvents = "none";
      if (element instanceof HTMLVideoElement) {
        element.pause();
      }
    };

    const setPreviewStyles = (element: HTMLElement) => {
      element.style.position = "absolute";
      element.style.left = "0";
      element.style.top = "0";
      element.style.width = "100%";
      element.style.height = "100%";
      element.style.opacity = "1";
      element.style.pointerEvents = "none";
    };

    if (readyElement && readyEntry) {
      if (
        previewAttachedRef.current &&
        previewAttachedRef.current !== readyElement
      ) {
        setHiddenStyles(previewAttachedRef.current);
        cacheContainer.appendChild(previewAttachedRef.current);
      }
      if (readyElement.parentElement !== container) {
        const previewClass =
          readyEntry.kind === "iframe"
            ? "poster-preview-frame"
            : "poster-preview-media";
        readyElement.classList.add(previewClass);
        setPreviewStyles(readyElement);
        container.appendChild(readyElement);
      }
      if (readyEntry.kind === "video") {
        const video = readyElement as HTMLVideoElement;
        video.muted = true;
        video.playsInline = true;
        video.loop = false;
        try {
          if (Number.isFinite(video.duration) && video.duration > 0) {
            video.currentTime = 0;
          }
        } catch {
          // ignore seek failures on some browsers
        }
        video.pause();
      }
      previewAttachedRef.current = readyElement;
      setHasPreviewMedia(true);
      return;
    }

    if (previewAttachedRef.current) {
      setHiddenStyles(previewAttachedRef.current);
      cacheContainer.appendChild(previewAttachedRef.current);
      previewAttachedRef.current = null;
    }
    setHasPreviewMedia(false);
  }, [viewMode, selectedProgram?.url, preloadTick, ensurePreloadContainer]);

  useEffect(() => {
    if (!playerOpen || !playerUrl) return;
    if (!channels.length) return;
    const baseIndex =
      playerChannelIndex ??
      clamp(activeRow, 0, Math.max(0, channels.length - 1));
    if (!Number.isFinite(baseIndex)) return;
    if (PRELOAD_MODE !== "all") return;
    const neighborRows = [
      (baseIndex - 1 + channels.length) % channels.length,
      (baseIndex + 1) % channels.length,
    ];
    const neighborUrls = neighborRows
      .map((row) => {
        const channel = channels[row];
        const program =
          channel?.schedule.find(
            (slot) =>
              currentSlotIndex >= slot.start && currentSlotIndex <= slot.end
          ) ?? channel?.schedule[0];
        return program?.url ?? null;
      })
      .filter(
        (url, index, all): url is string =>
          Boolean(url) && url !== playerUrl && all.indexOf(url) === index
      );
    if (!neighborUrls.length) return;
    const timer = window.setTimeout(() => {
      neighborUrls.forEach((url) => queuePreload(url));
    }, PRELOAD_AFTER_PLAY_MS);
    return () => window.clearTimeout(timer);
  }, [
    playerOpen,
    playerUrl,
    channels,
    playerChannelIndex,
    activeRow,
    currentSlotIndex,
    queuePreload,
  ]);

  useEffect(() => {
    if (viewMode !== "guide") return;
    if (playerOpen) return;
    const url = selectedProgram?.url ?? null;
    if (!url) {
      setPreloadUrl(null);
      return;
    }
    const kind = getMediaKind(url);
    if (!shouldPreload(kind)) {
      setPreloadUrl(null);
      return;
    }
    if (preloadTimerRef.current) {
      window.clearTimeout(preloadTimerRef.current);
    }
    preloadTimerRef.current = window.setTimeout(() => {
      setPreloadUrl(url);
      queuePreload(url);
    }, PRELOAD_DEBOUNCE_MS);
    return () => {
      if (preloadTimerRef.current) {
        window.clearTimeout(preloadTimerRef.current);
      }
    };
  }, [
    viewMode,
    playerOpen,
    selectedProgram?.url,
    queuePreload,
    shouldPreload,
  ]);

  useEffect(() => {
    if (!preloadUrl || playerOpen) return;
    if (PRELOAD_MODE !== "all") return;
    if (preloadUrl === playerUrl) return;
    setPlayerReady(false);
    setPlayerUrl(preloadUrl);
  }, [preloadUrl, playerOpen, playerUrl]);

  useEffect(() => {
    if (viewMode !== "guide") return;
    if (!channels.length) return;
    if (!Number.isFinite(returnRowParam)) return;
    const targetRow = clamp(Math.floor(returnRowParam), 0, channels.length - 1);
    setSelectedRow(targetRow);
    setSelectedCol(currentSlotIndex);
    pauseUntilRef.current = Date.now() + USER_PAUSE_MS;
  }, [viewMode, channels.length, returnRowParam, currentSlotIndex]);

  useEffect(() => {
    if (!channels.length) return;
    setSelectedRow((prev) => clamp(prev, 0, channels.length - 1));
    setSelectedCol((prev) =>
      clamp(
        Math.max(prev, currentSlotIndex),
        0,
        Math.max(0, slotCount - 1)
      )
    );
  }, [channels.length, slotCount, currentSlotIndex]);

  useEffect(() => {
    const maxStart = Math.max(0, slotCount - visibleSlotCount);
    setVisibleStartSlot((prev) => clamp(prev, 0, maxStart));
  }, [slotCount, visibleSlotCount]);

  useEffect(() => {
    if (viewMode !== "guide") {
      lastCurrentSlotRef.current = currentSlotIndex;
      return;
    }
    const prevSlot = lastCurrentSlotRef.current;
    if (currentSlotIndex !== prevSlot && selectedCol <= prevSlot) {
      setSelectedCol(currentSlotIndex);
    }
    lastCurrentSlotRef.current = currentSlotIndex;
  }, [viewMode, currentSlotIndex, selectedCol]);

  useEffect(() => {
    if (viewMode !== "guide") return;
    if (selectedCol !== currentSlotIndex) return;
    const maxStart = Math.max(0, slotCount - visibleSlotCount);
    const minStart = Math.min(currentSlotIndex, maxStart);
    setVisibleStartSlot(clamp(currentSlotIndex, minStart, maxStart));
  }, [viewMode, currentSlotIndex, selectedCol, slotCount, visibleSlotCount]);

  useEffect(() => {
    const maxStart = Math.max(0, slotCount - visibleSlotCount);
    const minStart = Math.min(currentSlotIndex, maxStart);
    if (selectedCol < visibleStartSlot) {
      setVisibleStartSlot(clamp(selectedCol, minStart, maxStart));
    } else if (selectedCol >= visibleStartSlot + visibleSlotCount) {
      setVisibleStartSlot(
        clamp(selectedCol - visibleSlotCount + 1, minStart, maxStart)
      );
    }
  }, [selectedCol, visibleStartSlot, visibleSlotCount, slotCount, currentSlotIndex]);

  useEffect(() => {
    void fetchIndex();
    const interval = window.setInterval(() => {
      void fetchIndex();
    }, 5000);
    return () => {
      window.clearInterval(interval);
    };
  }, [fetchIndex]);

  useEffect(() => {
    const updateRows = () => {
      const nextIsPortrait = window.innerHeight >= window.innerWidth;
      const height = viewportRef.current?.clientHeight ?? 0;
      setViewportSize({ width: window.innerWidth, height: window.innerHeight });
      if (!height) return;
      const stride = (ROW_HEIGHT + ROW_GAP) * uiScale;
      const maxRows = nextIsPortrait
        ? Math.min(3, MAX_VISIBLE_ROWS)
        : MAX_VISIBLE_ROWS;
      const minRows = nextIsPortrait
        ? MIN_VISIBLE_ROWS
        : Math.max(MIN_VISIBLE_ROWS, 3);
      const rows = Math.floor((height + ROW_GAP) / stride);
      setVisibleRows(clamp(rows, minRows, maxRows));
    };
    updateRows();
    window.addEventListener("resize", updateRows);
    return () => window.removeEventListener("resize", updateRows);
  }, [uiScale]);

  useEffect(() => {
    if (channels.length <= visibleRows) {
      setScrollOffset(0);
      return;
    }
    const maxScroll = (channels.length - visibleRows) * (ROW_HEIGHT + ROW_GAP);
    autoHoldUntilRef.current = 0;

    const tick = (time: number) => {
      if (lastFrameRef.current === null) lastFrameRef.current = time;
      const delta = time - lastFrameRef.current;
      lastFrameRef.current = time;

      const nowMs = Date.now();
      if (nowMs >= pauseUntilRef.current) {
        setScrollOffset((prev) => {
          if (autoHoldUntilRef.current > nowMs) {
            return prev;
          }
          if (prev >= maxScroll) {
            return 0;
          }
          const next = prev + (AUTO_SCROLL_PX_PER_SEC * delta) / 1000;
          if (next >= maxScroll) {
            autoHoldUntilRef.current = nowMs + AUTO_SCROLL_END_HOLD_MS;
            return maxScroll;
          }
          return next;
        });
      }

      requestAnimationFrame(tick);
    };

    const raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      lastFrameRef.current = null;
    };
  }, [channels.length, visibleRows]);

  useEffect(() => {
    if (Date.now() < pauseUntilRef.current) {
      const maxScroll = Math.max(
        0,
        (channels.length - visibleRows) * (ROW_HEIGHT + ROW_GAP)
      );
      const anchor = Math.floor(visibleRows / 2);
      const desired = clamp(
        selectedRow - anchor,
        0,
        Math.max(0, channels.length - visibleRows)
      );
      setScrollOffset(clamp(desired * (ROW_HEIGHT + ROW_GAP), 0, maxScroll));
    }
  }, [channels.length, selectedRow, visibleRows]);

  useEffect(() => {
    if (viewMode !== "art") return;
    if (artPaused) return;
    const artItems =
      channels
        .find((channel) => channel.id === (channelId ?? "jensen-art"))
        ?.schedule.filter((slot) => slot.url) ?? [];
    const item = artItems[artIndex];
    const duration = (item?.durationSec ?? 90) * 1000;
    const timer = window.setTimeout(() => {
      setArtIndex((prev) => (prev + 1) % Math.max(1, artItems.length));
    }, duration);
    return () => window.clearTimeout(timer);
  }, [artIndex, artPaused, viewMode, channels, channelId]);

  useEffect(() => {
    if (viewMode !== "art") return;
    const raw = Number(params.get("i") ?? "");
    if (!Number.isFinite(raw)) return;
    const artItems =
      channels
        .find((channel) => channel.id === (channelId ?? "jensen-art"))
        ?.schedule.filter((slot) => slot.url) ?? [];
    const safeIndex = Math.max(0, raw % Math.max(1, artItems.length));
    setArtIndex(safeIndex);
  }, [viewMode, channelId, channels, params]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.closest("input, textarea, select") ||
          target.closest('[contenteditable="true"]') ||
          target.closest('[contenteditable=""]'))
      ) {
        return;
      }
      const key = event.key;
      const code = event.code;
      const channelUp =
        key === "PageUp" ||
        key === "[" ||
        key === "{" ||
        key === "ChannelUp" ||
        code === "BracketLeft";
      const channelDown =
        key === "PageDown" ||
        key === "]" ||
        key === "}" ||
        key === "ChannelDown" ||
        code === "BracketRight";
      if (key === "q" || key === "Q") {
        setShowQr((prev) => !prev);
        return;
      }
      if (key === "d" || key === "D") {
        setShowDebug((prev) => !prev);
        return;
      }
      if (playerOpen && (key === "i" || key === "I")) {
        setShowPlayerHud((prev) => !prev);
        return;
      }
      if (viewMode === "guide" && playerOpen && (channelUp || channelDown)) {
        event.preventDefault();
        handleChannelChange(channelUp ? "up" : "down");
        return;
      }
      if (
        viewMode === "guide" &&
        playerOpen &&
        (key === "Escape" || key === "Backspace")
      ) {
        setPlayerOpen(false);
        return;
      }
      if (viewMode === "guide") {
        if (channelUp) {
          event.preventDefault();
          moveSelection("up");
          return;
        }
        if (channelDown) {
          event.preventDefault();
          moveSelection("down");
          return;
        }
      }
      if (viewMode === "art") {
        if (key === " ") {
          setArtPaused((prev) => !prev);
        }
        if (key === "ArrowLeft" || key === "ArrowUp") {
          const artItems =
            channels
              .find((channel) => channel.id === (channelId ?? "jensen-art"))
              ?.schedule.filter((slot) => slot.url) ?? [];
          setArtIndex((prev) => (prev - 1 + artItems.length) % artItems.length);
        }
        if (key === "ArrowRight" || key === "ArrowDown") {
          const artItems =
            channels
              .find((channel) => channel.id === (channelId ?? "jensen-art"))
              ?.schedule.filter((slot) => slot.url) ?? [];
          setArtIndex((prev) => (prev + 1) % artItems.length);
        }
        return;
      }
      if (key === "Enter") {
        handleSelect();
        return;
      }
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key))
        return;

      const map: Record<string, "up" | "down" | "left" | "right"> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
      };
      moveSelection(map[key]);
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [
    moveSelection,
    viewMode,
    channels,
    channelId,
    handleSelect,
    playerOpen,
    handleChannelChange,
  ]);

  const progressValue = useMemo(() => {
    if (!selectedProgram) return 0;
    const parts = indexData.startTime.split(":");
    const startHour = Number.parseInt(parts[0] ?? "", 10);
    const startMinute = Number.parseInt(parts[1] ?? "", 10);
    if (!Number.isFinite(startHour) || !Number.isFinite(startMinute)) return 0;
    const scheduleStart = new Date(now);
    scheduleStart.setHours(startHour, startMinute, 0, 0);
    const programStartMs =
      scheduleStart.getTime() +
      selectedProgram.start * indexData.slotMinutes * 60 * 1000;
    const durationMs =
      Math.max(1, selectedProgram.span) * indexData.slotMinutes * 60 * 1000;
    const elapsed = now.getTime() - programStartMs;
    const ratio = clamp(elapsed / durationMs, 0, 1);
    return ratio * 100;
  }, [now, selectedProgram, indexData.startTime, indexData.slotMinutes]);
  const posterHasVisual = hasPreviewMedia || posterImageReady;

  useEffect(() => {
    setPosterImageReady(false);
  }, [selectedChannel?.previewUrl]);

  const hostOverride = params.get("host");
  const forceHttps = params.get("https") === "1";
  const metaRemote =
    document.querySelector<HTMLMetaElement>('meta[name="remote-url"]')
      ?.content ?? "";
  const hasMeta = metaRemote && !metaRemote.includes("__REMOTE_URL__");

  const isPrivateHost = (host: string) =>
    host === "localhost" ||
    host.endsWith(".local") ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);

  const normalizeBase = (input: string) => {
    const withScheme = input.includes("://") ? input : `http://${input}`;
    try {
      const url = new URL(withScheme);
      if (!forceHttps && isPrivateHost(url.hostname)) {
        url.protocol = "http:";
      }
      return url.origin;
    } catch {
      return withScheme;
    }
  };

  const baseUrl = hostOverride
    ? normalizeBase(
        hostOverride.includes(":")
          ? hostOverride
          : `${hostOverride}:${window.location.port}`
      )
    : hasMeta
    ? normalizeBase(metaRemote)
    : normalizeBase(`${window.location.protocol}//${window.location.host}`);

  const remoteUrl = `${baseUrl}/remote`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=0&data=${encodeURIComponent(
    remoteUrl
  )}`;

  useEffect(() => {
    if (viewMode !== "remote" || !activeRemoteAppId) return;
    let cancelled = false;

    const loadControls = async () => {
      setRemoteControlsStatus((prev) => (prev === "ready" ? prev : "loading"));
      try {
        const res = await fetch(`/api/controls/${activeRemoteAppId}`);
        if (!res.ok) {
          if (!cancelled && res.status === 404) {
            setRemoteControlsStatus("missing");
          }
          return;
        }
        const data = (await res.json()) as {
          controls?: RemoteControl[];
        };
        if (cancelled) return;
        setRemoteControls((prev) =>
          mergeRemoteControls(data.controls ?? [], prev)
        );
        setRemoteControlsStatus("ready");
      } catch {
        if (!cancelled) setRemoteControlsStatus("missing");
      }
    };

    loadControls();
    const interval = window.setInterval(loadControls, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [viewMode, activeRemoteAppId, mergeRemoteControls]);

  useEffect(() => {
    if (viewMode !== "remote") return;
    setRemoteControls([]);
    setRemoteControlsStatus(activeRemoteAppId ? "loading" : "idle");
  }, [viewMode, activeRemoteAppId]);

  useEffect(() => {
    if (viewMode !== "guide") return;
    const nextAppId = playerOpen ? activeAppId : null;
    if (lastAppMessageRef.current === nextAppId) return;
    lastAppMessageRef.current = nextAppId;
    send({ type: "app", appId: nextAppId });
  }, [viewMode, playerOpen, activeAppId, send]);

  const rowStyle = useMemo(
    () =>
      ({
        transform: `translateY(-${scrollOffset}px)`,
      } as CSSProperties),
    [scrollOffset]
  );
  const hasAppControls = Boolean(activeRemoteAppId);
  const showAppPanel = hasAppControls && remotePanel === "app";
  const showGodPanel = remoteGodmodeOpen;
  useEffect(() => {
    if (!showGodPanel) {
      setGodmodeQuery("");
    }
  }, [showGodPanel]);
  const debugPanel = showDebug ? (
    <div className="debug-panel">
      <div className="debug-title">Diagnostics</div>
      {memoryStats ? (
        <>
          <div>Heap: {formatMb(memoryStats.used)} used</div>
          <div>Total: {formatMb(memoryStats.total)}</div>
          <div>Limit: {formatMb(memoryStats.limit)}</div>
        </>
      ) : (
        <div>Heap: unavailable</div>
      )}
      {mediaStats ? (
        <>
          <div>Streams: {mediaStats.active} active</div>
          <div>Requests: {mediaStats.requests} total</div>
          <div>Bytes: {formatMb(mediaStats.bytesSent)} sent</div>
          <div>Errors: {mediaStats.errors}</div>
          {mediaStats.lastRequestAt ? (
            <div>
              Last:{" "}
              {new Date(mediaStats.lastRequestAt).toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
                second: "2-digit",
              })}
            </div>
          ) : null}
          {mediaStats.topPaths?.length ? (
            <div className="debug-paths">
              {mediaStats.topPaths.slice(0, 3).map((item) => (
                <div key={item.path}>
                  {item.path.split("/").slice(-1)[0]} · {formatMb(item.bytes)}
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <div>Media: unavailable</div>
      )}
    </div>
  ) : null;
  const dialOverlayNode = dialOverlay ? (
    <div className="dial-overlay">CH {dialOverlay}</div>
  ) : null;
  const isRemoteDebug =
    remoteNowChannel?.id === DEBUG_CHANNEL_ID ||
    normalizeChannelNumber(remoteNowChannel?.number ?? "") ===
      normalizeChannelNumber(DEBUG_CHANNEL_NUMBER);
  const themeIds = THEME_ORDER;
  const themeIndex = Math.max(0, themeIds.indexOf(activeThemeId));

  if (viewMode === "remote") {
    return (
      <div
        className={`remote-shell ${hasAppControls ? "app-active" : ""} ${
          showGodPanel ? "godmode-active" : ""
        }`}
      >
        <div className="remote-body">
          <div className="remote-top">
            <div className="remote-title">Chiba Cable</div>
            <div className={`remote-status ${status}`}>
              {status === "open" ? "Connected" : "Connecting..."}
            </div>
          </div>

          {isRemoteDebug ? (
            <div className="remote-display">
              <div className="remote-display-title">Display Tuning</div>
              <div className="remote-display-row">
                <span>Scale</span>
                <div className="remote-display-controls">
                  <button
                    onClick={() =>
                      send({
                        type: "display",
                        scale: Number((uiScale - 0.05).toFixed(2)),
                      })
                    }
                  >
                    −
                  </button>
                  <div className="remote-display-value">
                    {uiScale.toFixed(2)}×
                  </div>
                  <button
                    onClick={() =>
                      send({
                        type: "display",
                        scale: Number((uiScale + 0.05).toFixed(2)),
                      })
                    }
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="remote-display-row">
                <span>Hours</span>
                <div className="remote-display-controls">
                  <button
                    onClick={() =>
                      send({
                        type: "display",
                        hours: Math.max(1, Math.round(visibleHours - 1)),
                      })
                    }
                  >
                    −
                  </button>
                  <div className="remote-display-value">
                    {Math.round(visibleHours)}h
                  </div>
                  <button
                    onClick={() =>
                      send({
                        type: "display",
                        hours: Math.min(6, Math.round(visibleHours + 1)),
                      })
                    }
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="remote-display-row">
                <span>Theme</span>
                <div className="remote-display-controls">
                  <button
                    onClick={() =>
                      send({
                        type: "display",
                        theme:
                          themeIds[
                            (themeIndex - 1 + themeIds.length) % themeIds.length
                          ],
                      })
                    }
                  >
                    ‹
                  </button>
                  <div className="remote-display-value">
                    {THEME_MAP[activeThemeId]?.label ?? activeThemeId}
                  </div>
                  <button
                    onClick={() =>
                      send({
                        type: "display",
                        theme: themeIds[(themeIndex + 1) % themeIds.length],
                      })
                    }
                  >
                    ›
                  </button>
                </div>
              </div>
              <button
                className="remote-display-reset"
                onClick={() =>
                  send({
                    type: "display",
                    scale: null,
                    hours: null,
                    theme: null,
                  })
                }
              >
                Reset Display
              </button>
            </div>
          ) : null}

          {showGodPanel ? (
            <div className="remote-god-panel">
              <div className="remote-god-title">God Mode</div>
              <div className="remote-god-subtitle">
                Pick any program
                {filteredGodmodeItems.length
                  ? ` · ${filteredGodmodeItems.length}`
                  : ""}
              </div>
              <div className="remote-god-search">
                <input
                  className="remote-god-input"
                  type="search"
                  value={godmodeQuery}
                  onChange={(event) => setGodmodeQuery(event.target.value)}
                  placeholder="Filter programs"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                />
                {godmodeQuery ? (
                  <button
                    className="remote-god-clear"
                    onClick={() => setGodmodeQuery("")}
                  >
                    Clear
                  </button>
                ) : null}
              </div>
              <div className="remote-god-list">
                {filteredGodmodeItems.length ? (
                  filteredGodmodeItems.map((item) => (
                    <button
                      key={item.id}
                      className="remote-god-item"
                      onClick={() => {
                        if (!item.program.url) return;
                        send({
                          type: "godselect",
                          channelId: item.channel.id,
                          url: item.program.url,
                        });
                        setDialBuffer("");
                        setRemoteGodmodeOpen(false);
                      }}
                    >
                      <div className="remote-god-item-title">
                        {item.program.title}
                      </div>
                      <div className="remote-god-item-meta">
                        {item.channel.number} · {item.channel.name}
                        {item.program.subtitle
                          ? ` · ${item.program.subtitle}`
                          : ""}
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="remote-god-empty">
                    {godmodeQuery ? "No matches found." : "No media found."}
                  </div>
                )}
              </div>
              <button
                className="remote-god-close"
                onClick={() => setRemoteGodmodeOpen(false)}
              >
                Close
              </button>
            </div>
          ) : showAppPanel ? (
            <div className="remote-app">
              <div className="remote-app-title">
                <span>App Controls</span>
              </div>
              <button
                className="remote-app-back"
                onClick={() => setRemotePanel("remote")}
              >
                Back to Remote
              </button>
              {remoteControlsStatus === "loading" ? (
                <div className="remote-app-status">Loading controls…</div>
              ) : null}
              {remoteControlsStatus === "missing" ? (
                <div className="remote-app-status">
                  No controls yet. Open the app once.
                </div>
              ) : null}
              {remoteControls.length ? (
                <div className="remote-app-controls">
                  {remoteControls.map((control) => {
                    if (control.type === "range") {
                      const value =
                        typeof control.value === "number"
                          ? control.value
                          : control.min;
                      return (
                        <label
                          key={control.id}
                          className="remote-control remote-range"
                        >
                          <span className="remote-control-label">
                            {control.label}
                            <span className="remote-control-value">
                              {value.toFixed(2)}
                            </span>
                          </span>
                          <input
                            type="range"
                            min={control.min}
                            max={control.max}
                            step={control.step ?? 0.1}
                            value={value}
                            onChange={(event) =>
                              handleRemoteControl(
                                control.id,
                                Number(event.currentTarget.value)
                              )
                            }
                          />
                        </label>
                      );
                    }
                    if (control.type === "select") {
                      const value =
                        control.value ?? control.options[0]?.value ?? "";
                      return (
                        <label
                          key={control.id}
                          className="remote-control remote-select"
                        >
                          <span className="remote-control-label">
                            {control.label}
                          </span>
                          <select
                            value={value}
                            onChange={(event) =>
                              handleRemoteControl(
                                control.id,
                                event.currentTarget.value
                              )
                            }
                          >
                            {control.options.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      );
                    }
                    if (control.type === "toggle") {
                      const value = Boolean(control.value);
                      return (
                        <div
                          key={control.id}
                          className="remote-control remote-toggle"
                        >
                          <span className="remote-control-label">
                            {control.label}
                          </span>
                          <button
                            className={value ? "is-on" : ""}
                            onClick={() =>
                              handleRemoteControl(control.id, !value)
                            }
                          >
                            {value ? "On" : "Off"}
                          </button>
                        </div>
                      );
                    }
                    return (
                      <div
                        key={control.id}
                        className="remote-control remote-button"
                      >
                        <span className="remote-control-label">
                          {control.label}
                        </span>
                        <button
                          onClick={() =>
                            handleRemoteControl(control.id, Date.now())
                          }
                        >
                          Trigger
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <div className="remote-controls">
                <div className="rocker">
                  <button onClick={() => send({ type: "channel", dir: "up" })}>
                    CH UP
                  </button>
                  <span>CH</span>
                  <button
                    onClick={() => send({ type: "channel", dir: "down" })}
                  >
                    CH DOWN
                  </button>
                </div>

                <div className="rocker">
                  <button disabled>VOL UP</button>
                  <span>VOL</span>
                  <button disabled>VOL DOWN</button>
                </div>
              </div>

              <div className="remote-dpad">
                <button
                  className="up"
                  onClick={() => send({ type: "nav", dir: "up" })}
                >
                  UP
                </button>
                <button
                  className="left"
                  onClick={() => send({ type: "nav", dir: "left" })}
                >
                  LEFT
                </button>
                <button className="ok" onClick={() => send({ type: "select" })}>
                  OK
                </button>
                <button
                  className="right"
                  onClick={() => send({ type: "nav", dir: "right" })}
                >
                  RIGHT
                </button>
                <button
                  className="down"
                  onClick={() => send({ type: "nav", dir: "down" })}
                >
                  DOWN
                </button>
              </div>

              <div className="remote-actions">
                <button onClick={() => send({ type: "guide" })}>Guide</button>
                <button onClick={() => send({ type: "info" })}>Info</button>
                <button onClick={() => setDialBuffer("")}>Back</button>
              </div>

              <button
                className={`remote-app-toggle ${
                  hasAppControls ? "is-active" : ""
                }`}
                disabled={!hasAppControls}
                onClick={() => setRemotePanel("app")}
              >
                App Controls
              </button>

              <div className="remote-numpad">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                  <button
                    key={num}
                    disabled={showAppPanel}
                    onClick={() => pushDialDigit(num)}
                  >
                    {num}
                  </button>
                ))}
                <button
                  className="zero"
                  disabled={showAppPanel}
                  onClick={() => pushDialDigit(0)}
                >
                  0
                </button>
              </div>
            </>
          )}
        </div>
        {debugPanel}
        {dialOverlayNode}
      </div>
    );
  }

  if (viewMode === "art") {
    const artChannel =
      channels.find((channel) => channel.id === (channelId ?? "jensen-art")) ??
      channels[0];
    const artItems = artChannel?.schedule.filter((slot) => slot.url) ?? [];
    const artItem = artItems[artIndex % Math.max(1, artItems.length)];
    return (
      <div className="art-shell">
        <iframe
          className="art-frame"
          src={artItem?.url}
          title={artItem?.title ?? "Interactive art"}
          allow="autoplay; fullscreen"
          sandbox="allow-scripts allow-same-origin allow-pointer-lock"
        />
        <div className="art-overlay">
          <div className="art-channel">{artChannel?.name ?? "Art Channel"}</div>
          <div className="art-title">{artItem?.title ?? "Loading..."}</div>
          <div className="art-subtitle">{artItem?.subtitle}</div>
          <div className="art-controls">
            {artPaused ? "Paused" : "Auto"} - arrows to navigate, space to pause
          </div>
        </div>
        {debugPanel}
        {dialOverlayNode}
      </div>
    );
  }

  return (
    <div
      className={`guide-shell ${playerOpen ? "player-open" : ""}`}
      style={gridStyle}
    >
      <div className="guide-noise" aria-hidden="true" />

      <header className="guide-header">
        <div className="header-card">
          <div className="poster">
            <div
              className="poster-preview"
              ref={previewContainerRef}
              aria-hidden="true"
            />
            {selectedChannel?.previewUrl && !hasPreviewMedia ? (
              <img
                className="poster-image"
                src={selectedChannel.previewUrl}
                alt=""
                onLoad={() => setPosterImageReady(true)}
                onError={() => setPosterImageReady(false)}
              />
            ) : null}
            {playerOpen && !playerReady ? (
              <div className="poster-loading is-active" aria-hidden="true">
                <div className="poster-loading-ring" />
                <div className="poster-loading-text">Tuning</div>
              </div>
            ) : null}
            <div className="poster-glow" />
            {!posterHasVisual ? (
              <div className="poster-label">{selectedChannel?.callSign}</div>
            ) : null}
          </div>
          <div className="header-content">
            <span className="header-eyebrow">Guide</span>
            <h1 className="header-title">{selectedProgram?.title}</h1>
            <p className="header-subtitle">
              {selectedProgram?.subtitle ?? "Live schedule"}
            </p>
            <div className="header-meta">
              <span>{selectedChannel?.name}</span>
              <span>-</span>
              <span>{selectedProgram?.tag ?? "SHOW"}</span>
            </div>
            <div className="header-progress">
              <div
                className="header-progress-bar"
                style={{ width: `${progressValue}%` }}
              />
            </div>
          </div>
        </div>
        <div className="header-right">
          <div className="header-clock">
            <span className="clock-time">
              {now.toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
            <span className="clock-date">
              {now.toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
        </div>
      </header>

      <section className="guide-grid">
        <div className="time-row">
          <div className="time-label">
            <div className="time-now">
              {now.toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
              })}
            </div>
            <div className="time-label-text">Network</div>
          </div>
          <div className="time-slots">
            {indexData.timeSlots
              .slice(
                visibleStartSlot,
                visibleStartSlot + Math.min(slotCount, visibleSlotCount)
              )
              .map((slot, index) => {
                const slotIndex = visibleStartSlot + index;
                return (
                  <div
                    key={slotIndex}
                    className={`time-slot ${
                      slotIndex === selectedCol ? "is-active" : ""
                    }`}
                  >
                    {slot}
                  </div>
                );
              })}
          </div>
        </div>

        <div className="channel-viewport" ref={viewportRef}>
          <div
            className={`channel-rows ${isPaused ? "is-paused" : "is-auto"}`}
            style={rowStyle}
          >
            {channels.map((channel, rowIndex) => (
              <div
                key={channel.id}
                className={`channel-row ${
                  rowIndex === activeRow ? "is-active" : ""
                }`}
              >
                <div
                  className="channel-cell"
                  style={{ borderColor: channel.accent }}
                >
                  <div className="channel-number">{channel.number}</div>
                  <div className="channel-name">{channel.name}</div>
                  <div className="channel-call">{channel.callSign}</div>
                </div>
                <div className="program-grid">
                  {channel.schedule
                    .filter(
                      (program) =>
                        program.end >= visibleStartSlot &&
                        program.start < visibleStartSlot + visibleSlotCount
                    )
                    .map((program, index) => {
                      const clippedStart = Math.max(
                        program.start,
                        visibleStartSlot
                      );
                      const clippedEnd = Math.min(
                        program.end,
                        visibleStartSlot + visibleSlotCount - 1
                      );
                      const span = Math.max(1, clippedEnd - clippedStart + 1);
                      const gridColumnStart =
                        clippedStart - visibleStartSlot + 1;
                      const isActive =
                        rowIndex === activeRow &&
                        selectedCol >= program.start &&
                        selectedCol <= program.end;
                      const isCurrentSlot =
                        currentSlotIndex >= program.start &&
                        currentSlotIndex <= program.end;
                      return (
                        <div
                          key={`${channel.id}-${index}`}
                          className={`program-card ${
                            isActive ? "is-active" : ""
                          }`}
                          style={{
                            gridColumn: `${gridColumnStart} / span ${span}`,
                            borderColor: channel.accent,
                          }}
                        onClick={() => {
                          setSelectedRow(rowIndex);
                          setSelectedCol(Math.max(clippedStart, currentSlotIndex));
                        }}
                          onDoubleClick={() => {
                            if (
                              channel.id === DEBUG_CHANNEL_ID ||
                              channel.number === DEBUG_CHANNEL_NUMBER
                            ) {
                              setShowDebug((prev) => !prev);
                              return;
                            }
                            if (program.url && isCurrentSlot) {
                              openProgram(program, channel);
                            }
                          }}
                        >
                          <div className="program-tag">
                            {program.tag ?? "SHOW"}
                          </div>
                          <div className="program-title">{program.title}</div>
                          <div className="program-subtitle">
                            {program.subtitle}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="guide-footer">
        <div className="ticker">
          <span>
            Auto scroll active - now browsing channel {selectedChannel?.number}
          </span>
        </div>
      </footer>

      {showQr ? (
        <div className="qr-card">
          <div className="qr-label">Scan for Remote</div>
          <img className="qr-image" src={qrUrl} alt="Remote QR code" />
        </div>
      ) : null}

      {playerUrl ? (
        <div
          className={`player-overlay ${playerOpen ? "is-open" : ""}`}
          aria-hidden={!playerOpen}
        >
          <div className="player-surface">
            {playerKind === "image" ? (
              <img
                className="player-media player-image"
                src={playerUrl}
                alt={playerMeta?.title ?? "Program image"}
                onLoad={() => setPlayerReady(true)}
              />
            ) : playerKind === "video" ? (
              <video
                className="player-media player-video"
                src={playerUrl}
                autoPlay
                loop
                muted={!playerOpen}
                playsInline
                onLoadedData={() => setPlayerReady(true)}
              />
            ) : playerKind === "audio" ? (
              <div className="player-audio">
                <div className="player-audio-visual" />
                <audio
                  src={playerUrl}
                  autoPlay
                  loop
                  muted={!playerOpen}
                  onCanPlay={() => setPlayerReady(true)}
                />
              </div>
            ) : (
              <iframe
                className="player-frame"
                src={playerUrl}
                title={playerMeta?.title ?? "Program"}
                allow="autoplay; fullscreen"
                sandbox="allow-scripts allow-same-origin allow-pointer-lock"
                onLoad={() => setPlayerReady(true)}
              />
            )}
            <div className={`player-loading ${playerReady ? "is-hidden" : ""}`}>
              <div className="player-loading-content">
                <span className="player-loading-label">Tuning…</span>
                <span className="player-loading-sub">Signal lock</span>
              </div>
            </div>
            {showPlayerHud ? (
              <div className="player-hud">
                <div className="player-channel">
                  {playerMeta?.callSign ?? selectedChannel?.callSign ?? "CH"}
                </div>
                <div className="player-title">
                  {playerMeta?.title ?? selectedProgram?.title}
                </div>
                <div className="player-subtitle">
                  {playerMeta?.subtitle ?? selectedProgram?.subtitle}
                </div>
                <div className="player-hint">Press Guide or Esc to return</div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {debugPanel}
      {dialOverlayNode}
    </div>
  );
}

export default App;
