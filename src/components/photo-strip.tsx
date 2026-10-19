"use client";

import { useEffect, useRef, useState } from "react";

import {
  SHOT_JPEG_QUALITY,
  STRIP_HEIGHT,
  STRIP_WIDTH,
  type BoothLayout,
  type BoothTheme,
} from "@/lib/booth/fields";
import { canvasFontFamily, drawStrip } from "@/lib/booth/draw";
import { themeBundle } from "@/lib/booth/themes";

export type StripSource = {
  position: number;
  url?: string | null;
  blob?: Blob | null;
};

/**
 * Draws a strip from the saved frames, or from blobs that have not been
 * saved yet. The canvas is the picture. A download uses the same pixels.
 */
export function PhotoStrip({
  theme,
  layout,
  sources,
  dateLabel,
  label,
  onReady,
}: {
  theme: BoothTheme;
  layout: BoothLayout;
  sources: readonly StripSource[];
  dateLabel: string;
  label: string;
  onReady?: (blob: Blob) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourcesRef = useRef(sources);
  const onReadyRef = useRef(onReady);
  const paintKey = [
    theme,
    layout,
    dateLabel,
    sources
      .map(
        (source) =>
          `${source.position}:${source.url ?? source.blob?.size ?? 0}`,
      )
      .join("|"),
  ].join("\n");
  const [failureKey, setFailureKey] = useState<string | null>(null);

  useEffect(() => {
    sourcesRef.current = sources;
    onReadyRef.current = onReady;
  }, [sources, onReady]);

  useEffect(() => {
    let cancelled = false;

    async function paint() {
      const ordered = [...sourcesRef.current].sort(
        (a, b) => a.position - b.position,
      );
      const images: (CanvasImageSource | null)[] = [];
      for (const source of ordered) {
        if (cancelled) return;
        images.push(await loadFrame(source));
      }
      if (cancelled) return;
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return;
      const bundle = themeBundle(theme);
      drawStrip(context, {
        theme: bundle,
        layout,
        images,
        dateLabel,
        fontFamily: canvasFontFamily(bundle.font),
      });
      // Signed photo URLs come from another origin. Drawing them is fine.
      // Reading the canvas back is not, and the wall only needs the picture.
      // Download asks for the blob, and those frames are local files.
      if (!onReadyRef.current) return;
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/jpeg", SHOT_JPEG_QUALITY);
      });
      if (!cancelled && blob) onReadyRef.current(blob);
    }

    paint().catch(() => {
      if (!cancelled) setFailureKey(paintKey);
    });
    return () => {
      cancelled = true;
    };
  }, [theme, layout, dateLabel, paintKey]);

  const failed = failureKey === paintKey;

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvasRef}
        width={STRIP_WIDTH}
        height={STRIP_HEIGHT}
        role="img"
        aria-label={label}
        className="h-auto w-full max-w-60 rounded-2xl bg-card"
      />
      {failed ? (
        <p className="text-sm text-foreground/70">
          The strip couldn&apos;t be drawn. Reload the page and try again.
        </p>
      ) : null}
    </div>
  );
}

function loadFrame(source: StripSource): Promise<HTMLImageElement | null> {
  const url = source.blob ? URL.createObjectURL(source.blob) : source.url;
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      if (source.blob) URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      if (source.blob) URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
}
