import { useEffect } from "react";
import { createLogger } from "../lib/logger";
import type {
  GuideChannel,
  MediaKind,
  PlayerMeta,
  ProgramSlot,
} from "../types/guide";

const log = createLogger("player-overlay");

type PlayerOverlayProps = {
  playerUrl: string | null;
  playerOpen: boolean;
  playerReady: boolean;
  playerKind: MediaKind | null;
  playerMeta: PlayerMeta | null;
  selectedChannel?: GuideChannel;
  selectedProgram?: ProgramSlot | null;
  showPlayerHud: boolean;
  setPlayerReady: (ready: boolean) => void;
};

export function PlayerOverlay({
  playerUrl,
  playerOpen,
  playerReady,
  playerKind,
  playerMeta,
  selectedChannel,
  selectedProgram,
  showPlayerHud,
  setPlayerReady,
}: PlayerOverlayProps) {
  useEffect(() => {
    if (!playerUrl) return;
    log.info("mount", { url: playerUrl, kind: playerKind, open: playerOpen });
    return () => {
      log.info("unmount", { url: playerUrl, kind: playerKind });
    };
  }, [playerUrl, playerKind, playerOpen]);

  useEffect(() => {
    if (!playerUrl) return;
    log.debug("state", { url: playerUrl, kind: playerKind, open: playerOpen });
  }, [playerUrl, playerKind, playerOpen]);

  if (!playerUrl) return null;

  return (
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
            onLoad={() => {
              log.info("loaded", { url: playerUrl, kind: "image" });
              setPlayerReady(true);
            }}
          />
        ) : playerKind === "video" ? (
          <video
            className="player-media player-video"
            src={playerUrl}
            autoPlay
            loop
            muted={!playerOpen}
            playsInline
            onLoadedData={() => {
              log.info("loaded", { url: playerUrl, kind: "video" });
              setPlayerReady(true);
            }}
          />
        ) : playerKind === "audio" ? (
          <div className="player-audio">
            <div className="player-audio-visual" />
            <audio
              src={playerUrl}
              autoPlay
              loop
              muted={!playerOpen}
              onCanPlay={() => {
                log.info("loaded", { url: playerUrl, kind: "audio" });
                setPlayerReady(true);
              }}
            />
          </div>
        ) : (
          <iframe
            className="player-frame"
            src={playerUrl}
            title={playerMeta?.title ?? "Program"}
            allow="autoplay; fullscreen"
            sandbox="allow-scripts allow-same-origin allow-pointer-lock"
            onLoad={() => {
              log.info("loaded", { url: playerUrl, kind: "iframe" });
              setPlayerReady(true);
            }}
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
  );
}
