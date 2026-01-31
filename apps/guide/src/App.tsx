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

type RemoteMessage =
  | { type: "nav"; dir: "up" | "down" | "left" | "right" }
  | { type: "channel"; dir: "up" | "down" }
  | { type: "select" }
  | { type: "guide" }
  | { type: "info" };

const USER_PAUSE_MS = 6500;
const ROW_HEIGHT = 76;
const ROW_GAP = 12;
const AUTO_SCROLL_PX_PER_SEC = 14;
const PRELOAD_DEBOUNCE_MS = 320;

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

function getMediaKind(url: string): "image" | "video" | "audio" | "iframe" {
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
  const [showPlayerHud, setShowPlayerHud] = useState(true);

  const pauseUntilRef = useRef(0);
  const lastFrameRef = useRef<number | null>(null);
  const autoRowRef = useRef(0);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const preloadTimerRef = useRef<number | null>(null);
  const prevViewModeRef = useRef(viewMode);
  const prevPlayerOpenRef = useRef(playerOpen);

  const moveSelection = useCallback(
    (dir: "up" | "down" | "left" | "right") => {
      const wasPaused = Date.now() < pauseUntilRef.current;
      pauseUntilRef.current = Date.now() + USER_PAUSE_MS;
      if (dir === "up") {
        setSelectedRow((prev) => {
          const base = wasPaused ? prev : autoRowRef.current;
          return (base - 1 + channels.length) % channels.length;
        });
      }
      if (dir === "down") {
        setSelectedRow((prev) => {
          const base = wasPaused ? prev : autoRowRef.current;
          return (base + 1) % channels.length;
        });
      }
      if (dir === "left") {
        const baseRow = wasPaused ? selectedRow : autoRowRef.current;
        if (!wasPaused) {
          setSelectedRow(baseRow);
        }
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
        const baseRow = wasPaused ? selectedRow : autoRowRef.current;
        if (!wasPaused) {
          setSelectedRow(baseRow);
        }
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

  const rowStride = ROW_HEIGHT + ROW_GAP;
  const anchorRow = Math.floor(visibleRows / 2);
  const autoRow = clamp(
    Math.floor(scrollOffset / rowStride) + anchorRow,
    0,
    Math.max(0, channels.length - 1)
  );
  const isPaused = Date.now() < pauseUntilRef.current;
  const activeRow = isPaused ? selectedRow : autoRow;
  autoRowRef.current = activeRow;

  const selectedChannel = channels[activeRow];
  const selectedProgram =
    selectedChannel?.schedule.find(
      (slot) => selectedCol >= slot.start && selectedCol <= slot.end
    ) ?? selectedChannel?.schedule[0];
  const playerKind = useMemo(
    () => (playerUrl ? getMediaKind(playerUrl) : null),
    [playerUrl]
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
      setPlayerMeta({
        title: program.title,
        subtitle: program.subtitle,
        channelName: channel.name,
        callSign: channel.callSign,
      });
    },
    [playerUrl]
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

  const { send, status } = useRemoteSocket(
    viewMode === "remote"
      ? undefined
      : (msg) => {
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
                setArtIndex(
                  (prev) => (prev - 1 + artItems.length) % artItems.length
                );
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
        }
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
    }, PRELOAD_DEBOUNCE_MS);
    return () => {
      if (preloadTimerRef.current) {
        window.clearTimeout(preloadTimerRef.current);
      }
    };
  }, [viewMode, playerOpen, selectedProgram?.url]);

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

  const rowStyle = useMemo(
    () =>
      ({
        transform: `translateY(-${scrollOffset}px)`,
      } as CSSProperties),
    [scrollOffset]
  );

  if (viewMode === "remote") {
    return (
      <div className="remote-shell">
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

          <div className="remote-controls">
            <div className="rocker">
              <button onClick={() => send({ type: "channel", dir: "up" })}>
                CH UP
              </button>
              <span>CH</span>
              <button onClick={() => send({ type: "channel", dir: "down" })}>
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
        </div>
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
            {selectedChannel?.previewUrl ? (
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
    </div>
  );
}

export default App;
