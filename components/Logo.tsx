// MerchPay brand mark, rendered from /public/logo.jpeg (1600x893).
// The source image has a lot of dark padding, so we crop it with CSS:
//  - "mark": square crop of the "M" handshake icon (default, fits small slots)
//  - "full": the icon plus the "Merch Pay" wordmark
const CROPS = {
  // 400x400 region at (190, 245)
  mark: { aspect: 1, bgSize: "400% auto", bgPos: "15.8% 49.7%" },
  // 1220x310 region at (190, 290)
  full: { aspect: 1220 / 310, bgSize: "131.1% auto", bgPos: "50% 49.7%" },
} as const;

export default function Logo({
  size = 28,
  variant = "mark",
}: {
  size?: number;
  variant?: keyof typeof CROPS;
}) {
  const crop = CROPS[variant];
  return (
    <span
      className="logo"
      style={{
        width: Math.round(size * crop.aspect),
        height: size,
        backgroundSize: crop.bgSize,
        backgroundPosition: crop.bgPos,
      }}
      aria-label="MerchPay"
      role="img"
    />
  );
}
