import { useEscapeLayer } from "@/ui";

/**
 * Dimmed layer behind a phone drawer/sheet. Tapping it, or the Android back button / Escape,
 * closes the overlay. Mount it only while the overlay is open.
 */
export function PhoneBackdrop({ onClose }: { onClose: () => void }) {
  useEscapeLayer(true, onClose);
  return <div aria-hidden className="fixed inset-0 z-30 bg-black/40" onClick={onClose} />;
}
