export function BrandIcon({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="zp-circleStroke" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7c3aed" />
          <stop offset="100%" stopColor="#5b21b6" />
        </linearGradient>
        <linearGradient id="zp-circleFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f5f3ff" />
          <stop offset="100%" stopColor="#ede9fe" />
        </linearGradient>
        <linearGradient id="zp-pinGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#6d28d9" />
        </linearGradient>
        <clipPath id="zp-bottomHalf">
          <rect x="0" y="64" width="128" height="64" />
        </clipPath>
      </defs>
      <circle cx="64" cy="64" r="56" fill="url(#zp-circleFill)" stroke="url(#zp-circleStroke)" strokeWidth="6" />
      <circle cx="64" cy="64" r="56" fill="none" stroke="url(#zp-circleStroke)" strokeWidth="10" clipPath="url(#zp-bottomHalf)" />
      <circle cx="64" cy="44" r="18" fill="url(#zp-pinGrad)" />
      <circle cx="57" cy="38" r="6" fill="#c4b5fd" opacity="0.6" />
      <polygon points="58,60 70,60 64,100" fill="url(#zp-pinGrad)" />
    </svg>
  );
}
