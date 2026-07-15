import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  src: string;
  children: ReactNode;
  /** Extra scroll distance (in viewport heights) used to scrub the video. */
  scrubVh?: number;
}

/**
 * Pins a hero section and scrubs a background video with scroll progress.
 * The container is tall (100vh + scrubVh*vh). The inner sticky layer stays
 * pinned while the user scrolls through the scrub distance, then unpins so
 * the rest of the page continues normally.
 */
export function ScrollVideoHero({ src, children, scrubVh = 200 }: Props) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const targetTimeRef = useRef(0);

  useEffect(() => {
    const video = videoRef.current;
    const wrapper = wrapperRef.current;
    if (!video || !wrapper) return;

    const update = () => {
      rafRef.current = null;
      const rect = wrapper.getBoundingClientRect();
      const scrubbable = rect.height - window.innerHeight;
      if (scrubbable <= 0) return;
      // progress: 0 while wrapper top is at viewport top, 1 when scrubbable consumed
      const progress = Math.min(1, Math.max(0, -rect.top / scrubbable));
      const duration = video.duration;
      if (!duration || Number.isNaN(duration)) return;
      targetTimeRef.current = progress * duration;
      try {
        video.currentTime = targetTimeRef.current;
      } catch {
        /* ignore seek errors */
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
    // initial
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
      className="relative"
    >
      <div className="sticky top-0 h-screen w-full overflow-hidden">
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
        {/* Ambient overlay to blend the video with the theme */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "linear-gradient(180deg, hsl(var(--background) / 0.55) 0%, hsl(var(--background) / 0.35) 40%, hsl(var(--background) / 0.85) 100%)",
          }}
        />
        <div className="relative z-10 flex h-full w-full items-center justify-center">
          {children}
        </div>
      </div>
    </div>
  );
}

export default ScrollVideoHero;