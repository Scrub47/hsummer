/**
 * A round profile photo, or the first letter of the display name.
 *
 * Uses a plain img on purpose. The src is a short-lived signed Storage URL
 * (or a legacy https provider URL). Sending that through the image optimizer
 * would store the private URL in the optimizer's cache.
 */
export function ProfileAvatar({
  name,
  url,
  alt,
  className,
}: {
  name: string;
  url: string | null;
  alt: string;
  className: string;
}) {
  const initial = [...name][0]?.toUpperCase() ?? "?";
  const shape = `inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full object-cover ${className}`;

  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt={alt} referrerPolicy="no-referrer" className={shape} />
    );
  }

  return (
    <span
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
      className={`${shape} bg-pine font-medium text-white`}
    >
      {initial}
    </span>
  );
}
