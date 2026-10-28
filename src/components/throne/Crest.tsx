// OWNER: U. Crest from src/lib/crest.ts (identical markup on server, client and share images, FR-62).
import { crestSvg } from "@/lib/crest";

/** `idPrefix` must be unique per crest on the page (it namespaces the shield clip path). */
export function Crest({ name, idPrefix, className }: { name: string | null; idPrefix: string; className?: string }) {
  return (
    <span
      className={className}
      style={{ display: "block", flex: "none", lineHeight: 0 }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: crestSvg(name, { idPrefix }).replace("<svg ", '<svg width="100%" ') }}
    />
  );
}
