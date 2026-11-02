import { Fragment } from "react";

export function CopySeparator() {
  return <b className="copy-separator" aria-hidden="true">·</b>;
}

// Only pass interface copy here; user titles, links and notes stay untouched.
export function SeparatedCopy({ text }: { text: string }) {
  return <>{text.split(/\s*·\s*/u).map((part, index) => <Fragment key={index}>{index > 0 && <CopySeparator />}{part}</Fragment>)}</>;
}
