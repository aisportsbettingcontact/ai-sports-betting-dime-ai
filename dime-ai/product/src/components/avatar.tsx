/**
 * Plain <img> rather than next/image: this is the one local static asset in
 * the app (prez.jpg), so the optimizer pipeline buys nothing — and the
 * Next.js image route (Next 16.2 + Turbopack) hung indefinitely (naturalWidth
 * stuck at 0) on this file's ICC color profile in local testing.
 */
export function Avatar({
  size,
  alt,
  className = "",
  style,
  ...rest
}: {
  size: number;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
} & React.ImgHTMLAttributes<HTMLImageElement>) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/prez.jpg"
      alt={alt}
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, objectFit: "cover", borderRadius: "50%", ...style }}
      {...rest}
    />
  );
}
