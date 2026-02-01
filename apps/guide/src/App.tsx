import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import "./App.css";

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
  | { type: "select" }
  | { type: "guide" }
  | { type: "info" }
  | { type: "app"; appId?: string | null }
  | { type: "controls"; appId: string; controls: RemoteControl[] }
  | {
      type: "control";
      appId: string;
      controlId: string;
      value?: number | string | boolean;
    };

const USER_PAUSE_MS = 6500;
const ROW_HEIGHT = 76;
const ROW_GAP = 12;
const AUTO_SCROLL_PX_PER_SEC = 14;
const PRELOAD_DEBOUNCE_MS = 320;
const PRELOAD_AFTER_PLAY_MS = 1200;
const PRELOAD_CACHE_TTL_MS = 3 * 60 * 1000;
const PRELOAD_CACHE_LIMIT = 4;

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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
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
  const handlerRef = useRef(onMessage);

  useEffect(() => {
    handlerRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    const url = getWsUrl();
    const socket = new WebSocket(url);
    socketRef.current = socket;
    setStatus("connecting");

    socket.addEventListener("open", () => setStatus("open"));
    socket.addEventListener("close", () => setStatus("closed"));
    socket.addEventListener("error", () => setStatus("closed"));
    socket.addEventListener("message", (event) => {
      try {
        const parsed = JSON.parse(event.data) as RemoteMessage;
        handlerRef.current?.(parsed);
      } catch {
        // ignore
      }
    });

    return () => {
      socket.close();
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

  const [now, setNow] = useState(() => new Date());
  const [indexData, setIndexData] = useState<GuideIndex>(fallbackIndex);
  const slotCount = indexData.timeSlots.length;
  const channels = indexData.channels;
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
  const [hasPreviewIframe, setHasPreviewIframe] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [memoryStats, setMemoryStats] = useState<{
    used: number;
    total: number;
    limit: number;
  } | null>(null);
  const [remoteControls, setRemoteControls] = useState<RemoteControl[]>([]);
  const [remoteControlsStatus, setRemoteControlsStatus] = useState<
    "idle" | "loading" | "ready" | "missing"
  >("idle");
  const [activeRemoteAppId, setActiveRemoteAppId] =
    useState(requestedRemoteAppId);
  const [remotePanel, setRemotePanel] =
    useState<"remote" | "app">("remote");

  const pauseUntilRef = useRef(0);
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
  const previewAttachedRef = useRef<HTMLIFrameElement | null>(null);

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
          return schedule[nextIdx]?.start ?? prev;
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
    [channels, selectedRow]
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

  const formatMb = useCallback((bytes: number) => {
    if (!Number.isFinite(bytes)) return "n/a";
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
      const existing = cache.get(url);
      const nowTs = Date.now();
      if (existing) {
        existing.lastUsed = nowTs;
        return;
      }
      const kind = getMediaKind(url);
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
    [ensurePreloadContainer, prunePreloadCache]
  );

  const openProgram = useCallback(
    (program: ProgramSlot, channel: GuideChannel) => {
      if (!program.url) return;
      setPlayerOpen(true);
      if (playerUrl !== program.url) {
        setPlayerReady(false);
        setPlayerUrl(program.url);
      }
      setShowPlayerHud(true);
      const channelIndex = channels.findIndex((item) => item.id === channel.id);
      setPlayerChannelIndex(channelIndex >= 0 ? channelIndex : activeRow);
      setPlayerMeta({
        title: program.title,
        subtitle: program.subtitle,
        channelName: channel.name,
        callSign: channel.callSign,
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
      const nextProgram =
        nextChannel?.schedule.find(
          (slot) =>
            currentSlotIndex >= slot.start && currentSlotIndex <= slot.end
        ) ?? nextChannel?.schedule[0];
      setSelectedRow(nextRow);
      setSelectedCol(currentSlotIndex);
      pauseUntilRef.current = Date.now() + USER_PAUSE_MS;
      if (nextProgram?.url && nextChannel) {
        openProgram(nextProgram, nextChannel);
      } else {
        setPlayerOpen(false);
      }
    },
    [channels, activeRow, currentSlotIndex, openProgram]
  );

  const handleSelect = useCallback(() => {
    if (!selectedChannel || !selectedProgram) return;
    const programIndex = selectedChannel.schedule.findIndex(
      (slot) => selectedCol >= slot.start && selectedCol <= slot.end
    );
    const currentProgramIndex = selectedChannel.schedule.findIndex(
      (slot) => currentSlotIndex >= slot.start && currentSlotIndex <= slot.end
    );
    if (programIndex < 0 || currentProgramIndex < 0) return;
    if (programIndex !== currentProgramIndex) return;
    if (!selectedProgram.url) return;
    openProgram(selectedProgram, selectedChannel);
  }, [
    selectedChannel,
    selectedProgram,
    selectedCol,
    currentSlotIndex,
    openProgram,
  ]);

  const { send, status } = useRemoteSocket((msg) => {
    if (viewMode === "remote") {
      if (msg.type === "app") {
        const nextAppId = msg.appId ?? "";
        if (requestedRemoteAppId) return;
        setActiveRemoteAppId(nextAppId);
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
        "--slots": slotCount,
        "--row-height": `${ROW_HEIGHT}px`,
        "--row-gap": `${ROW_GAP}px`,
      } as CSSProperties),
    [slotCount]
  );

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000 * 30);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const prev = prevViewModeRef.current;
    if (viewMode === "guide" && prev !== "guide") {
      pauseUntilRef.current = Date.now() + USER_PAUSE_MS;
    }
    prevViewModeRef.current = viewMode;
  }, [viewMode]);

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
    const cacheContainer = ensurePreloadContainer();
    const currentUrl = selectedProgram?.url ?? null;
    const cacheEntry = currentUrl
      ? preloadCacheRef.current.get(currentUrl)
      : null;
    const readyFrame =
      cacheEntry?.kind === "iframe" && cacheEntry.status === "ready"
        ? (cacheEntry.element as HTMLIFrameElement)
        : null;

    const setHiddenStyles = (frame: HTMLIFrameElement) => {
      frame.style.position = "absolute";
      frame.style.left = "-9999px";
      frame.style.top = "0";
      frame.style.width = "1px";
      frame.style.height = "1px";
      frame.style.opacity = "0";
      frame.style.pointerEvents = "none";
    };

    const setPreviewStyles = (frame: HTMLIFrameElement) => {
      frame.style.position = "absolute";
      frame.style.left = "0";
      frame.style.top = "0";
      frame.style.width = "100%";
      frame.style.height = "100%";
      frame.style.opacity = "1";
      frame.style.pointerEvents = "auto";
    };

    if (readyFrame) {
      if (
        previewAttachedRef.current &&
        previewAttachedRef.current !== readyFrame
      ) {
        setHiddenStyles(previewAttachedRef.current);
        cacheContainer.appendChild(previewAttachedRef.current);
      }
      if (readyFrame.parentElement !== container) {
        readyFrame.classList.add("poster-preview-frame");
        setPreviewStyles(readyFrame);
        container.appendChild(readyFrame);
      }
      previewAttachedRef.current = readyFrame;
      setHasPreviewIframe(true);
      return;
    }

    if (previewAttachedRef.current) {
      setHiddenStyles(previewAttachedRef.current);
      cacheContainer.appendChild(previewAttachedRef.current);
      previewAttachedRef.current = null;
    }
    setHasPreviewIframe(false);
  }, [viewMode, selectedProgram?.url, preloadTick, ensurePreloadContainer]);

  useEffect(() => {
    if (!playerOpen || !playerUrl) return;
    if (!channels.length) return;
    const baseIndex =
      playerChannelIndex ??
      clamp(activeRow, 0, Math.max(0, channels.length - 1));
    if (!Number.isFinite(baseIndex)) return;
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
  }, [viewMode, playerOpen, selectedProgram?.url, queuePreload]);

  useEffect(() => {
    if (!preloadUrl || playerOpen) return;
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
    setSelectedCol((prev) => clamp(prev, 0, Math.max(0, slotCount - 1)));
  }, [channels.length, slotCount]);

  useEffect(() => {
    let cancelled = false;
    const fetchIndex = async () => {
      try {
        const res = await fetch("/api/index");
        if (!res.ok) return;
        const data = (await res.json()) as GuideIndex;
        if (!cancelled && data.channels?.length) {
          setIndexData(data);
        }
      } catch {
        // ignore
      }
    };
    fetchIndex();
    const interval = window.setInterval(fetchIndex, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const updateRows = () => {
      const height = viewportRef.current?.clientHeight ?? 0;
      if (!height) return;
      const stride = ROW_HEIGHT + ROW_GAP;
      const rows = Math.max(3, Math.floor((height + ROW_GAP) / stride));
      setVisibleRows(rows);
    };
    updateRows();
    window.addEventListener("resize", updateRows);
    return () => window.removeEventListener("resize", updateRows);
  }, []);

  useEffect(() => {
    if (channels.length <= visibleRows) {
      setScrollOffset(0);
      return;
    }
    const maxScroll = (channels.length - visibleRows) * (ROW_HEIGHT + ROW_GAP);

    const tick = (time: number) => {
      if (lastFrameRef.current === null) lastFrameRef.current = time;
      const delta = time - lastFrameRef.current;
      lastFrameRef.current = time;

      if (Date.now() >= pauseUntilRef.current) {
        setScrollOffset((prev) => {
          const next = prev + (AUTO_SCROLL_PX_PER_SEC * delta) / 1000;
          if (next >= maxScroll) return 0;
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
        key === "]" ||
        key === "}" ||
        key === "ChannelUp" ||
        code === "BracketRight";
      const channelDown =
        key === "PageDown" ||
        key === "[" ||
        key === "{" ||
        key === "ChannelDown" ||
        code === "BracketLeft";
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

  const progressValue = ((now.getMinutes() % 30) / 30) * 100;

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
    </div>
  ) : null;

  if (viewMode === "remote") {
    return (
      <div className={`remote-shell ${hasAppControls ? "app-active" : ""}`}>
        <div className="remote-body">
          <div className="remote-top">
            <div className="remote-title">Chiba Cable</div>
            <div className={`remote-status ${status}`}>
              {status === "open" ? "Connected" : "Connecting..."}
            </div>
          </div>

          <div className="remote-screen">
            <span>Guide Remote</span>
          </div>

          {showAppPanel ? (
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
                <button>Back</button>
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
                  <button key={num} disabled>
                    {num}
                  </button>
                ))}
                <button className="zero" disabled>
                  0
                </button>
              </div>
            </>
          )}
        </div>
        {debugPanel}
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
            {selectedChannel?.previewUrl && !hasPreviewIframe ? (
              <img
                className="poster-image"
                src={selectedChannel.previewUrl}
                alt=""
              />
            ) : null}
            <div className="poster-glow" />
            <div className="poster-label">{selectedChannel?.callSign}</div>
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
          <div className="header-badges">
            <span className="badge live">LIVE</span>
            <span className="badge">HD</span>
            <span className="badge">Stereo</span>
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
            {indexData.timeSlots.map((slot, index) => (
              <div
                key={slot}
                className={`time-slot ${
                  index === selectedCol ? "is-active" : ""
                }`}
              >
                {slot}
              </div>
            ))}
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
                  {channel.schedule.map((program, index) => {
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
                          gridColumn: `span ${program.span}`,
                          borderColor: channel.accent,
                        }}
                        onClick={() => {
                          setSelectedRow(rowIndex);
                          setSelectedCol(program.start);
                        }}
                        onDoubleClick={() => {
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
          <span>
            Press arrows to move. Phone remote can emulate arrows later.
          </span>
        </div>
      </footer>

      {showQr ? (
        <div className="qr-card">
          <div className="qr-label">Scan for Remote</div>
          <img className="qr-image" src={qrUrl} alt="Remote QR code" />
          <div className="qr-url">{remoteUrl.replace(/^https?:\/\//, "")}</div>
          <div className="qr-hint">
            {window.location.hostname === "localhost" ||
            window.location.hostname === "127.0.0.1"
              ? "Tip: open with ?host=LAN_IP"
              : "Press Q to hide"}
          </div>
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
              Tuning…
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
    </div>
  );
}

export default App;
