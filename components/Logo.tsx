// Placeholder brand mark. Swap the contents for the real logo
// (e.g. <Image src="/logo.svg" ... />) once it is ready.
export default function Logo({ size = 28 }: { size?: number }) {
  return (
    <span
      className="logo"
      style={{ width: size, height: size }}
      aria-label="Logo placeholder"
      role="img"
    />
  );
}
