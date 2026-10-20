import { logoMark } from "@/lib/brand/icons";

/**
 * The in-app bear. logo-mark.png is the source artwork with the square
 * field removed, so the bear sits on the page instead of a tile.
 * A plain img keeps the CSP happy: next/image writes an inline style,
 * and style-src does not allow that.
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
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoMark}
      alt={alt}
      width={size}
      height={size}
      fetchPriority={priority ? "high" : "auto"}
      className="bear-mark"
    />
  );
}
