import { useEffect, useRef } from "react";

interface Props {
  src: string;
  /** Extra scroll distance (in viewport heights) used to scrub the video while pinned. */
  scrubVh?: number;
  className?: string;
}

/**
 * Inline scroll-scrubbed video. The video is pinned in place while the user
 * scrolls through `scrubVh` viewport heights, and the video's currentTime is
 * driven by that scroll progress. Before/after the pinned range the page
 * scrolls normally.
 */
export function ScrollScrubVideo({ src, scrubVh = 150, className }: Props) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    const wrapper = wrapperRef.current;
    if (!video || !wrapper) return;

    const update = () => {
      rafRef.current = null;
      const rect = wrapper.getBoundingClientRect();
      const scrubbable = rect.height - window.innerHeight;
      if (scrubbable <= 0) return;
      const progress = Math.min(1, Math.max(0, -rect.top / scrubbable));
      const duration = video.duration;
      if (!duration || Number.isNaN(duration)) return;
      try {
        video.currentTime = progress * duration;
      } catch {
        /* ignore */
      }
    };

    const onScroll = () => {
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(update);
    };
    const onLoaded = () => update();

    video.addEventListener("loadedmetadata", onLoaded);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    if (video.readyState >= 1) update();

    return () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div
      ref={wrapperRef}
      style={{ height: `calc(100vh + ${scrubVh}vh)` }}
      className={className}
    >
      <div className="sticky top-0 flex h-screen w-full items-center justify-center">
        <div className="relative w-full max-w-2xl aspect-video overflow-hidden rounded-2xl border border-border/60 bg-card/40 shadow-[var(--shadow-soft)]">
          <video
            ref={videoRef}
            src={src}
            muted
            playsInline
            preload="auto"
            disablePictureInPicture
            disableRemotePlayback
            tabIndex={-1}
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover pointer-events-none select-none"
          />
        </div>
      </div>
    </div>
  );
}

export default ScrollScrubVideo;