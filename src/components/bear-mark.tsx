import Image from "next/image";

/** The sitting bear from the logo, on a transparent background. */
export function BearMark({
  size = 96,
  alt = "",
  priority = false,
}: {
  size?: number;
  alt?: string;
  priority?: boolean;
}) {
  const src = size > 256 ? "/brand/bear-512.webp" : "/brand/bear-256.webp";
  return (
    <Image
      src={src}
      alt={alt}
      width={size}
      height={size}
      priority={priority}
      className="bear-mark"
    />
  );
}
