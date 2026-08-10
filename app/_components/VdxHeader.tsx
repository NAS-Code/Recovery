/**
 * Vendelux-branded header bar matching the internal tool style.
 * Dark plum background, logo on left, tool name center, right slot configurable.
 */
import Image from "next/image";

interface VdxHeaderProps {
  /** Optional React node to render on the right side. Defaults to "Internal Tool" badge. */
  rightSlot?: React.ReactNode;
}

export function VdxHeader({ rightSlot }: VdxHeaderProps) {
  return (
    <header className="bg-vdx-plum">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        {/* Logo mark */}
        <Image
          src="/vdx-logo.png"
          alt="Vendelux"
          width={28}
          height={28}
          className="h-7 w-7"
          priority
        />

        {/* Tool name */}
        <span className="text-sm font-medium tracking-wide text-white/90">
          AUTOMATED Concierge
        </span>

        {/* Right slot */}
        {rightSlot ?? (
          <span className="rounded-full bg-white/15 px-3 py-0.5 text-[11px] font-medium tracking-wide text-white/80">
            Internal Tool
          </span>
        )}
      </div>
    </header>
  );
}
