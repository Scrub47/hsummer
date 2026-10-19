import { logoMarkLarge, logoMarkSmall } from "@/lib/brand/icons";

/**
 * The committed logo, scaled. A plain img keeps the CSP happy:
 * next/image writes an inline style, and style-src does not allow that.
 */
export function BearMark({
  size = 96,
  alt = "",
  priority = false,
}: {
  size?: number;
  alt?: string;
  priority?: boolean;
}) {
  const src = size > 256 ? logoMarkLarge : logoMarkSmall;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      fetchPriority={priority ? "high" : "auto"}
      className="bear-mark"
    />
  );
}
