import { AccountabulMark as BrandMark, type BrandVariant } from "./brand/logo";
import { useIsDark } from "@/hooks/use-theme";

export function AccountabulMark({
  small = false,
  variant = "brand",
  adaptive = false,
}: {
  small?: boolean;
  variant?: BrandVariant;
  /** When true, uses the sky→periwinkle gradient in light mode and
   *  mint→aqua in dark mode (approved brand variants per surface). */
  adaptive?: boolean;
}) {
  const isDark = useIsDark();
  const resolved: BrandVariant = adaptive ? (isDark ? "mint" : "brand") : variant;
  return <BrandMark variant={resolved} className={small ? "size-6" : "size-8"} />;
}
