import lightLogo from "./assets/logo-light.svg";
import darkLogo from "./assets/logo-dark.svg";

// Each image has its own SVG document, so gradient IDs cannot collide.
export function Logo({ mode }: { mode?: "light" | "dark" }) {
  return <span className="jinxu-logo" data-logo-mode={mode} aria-hidden="true">
    <img className="jinxu-logo-light" src={lightLogo} alt="" draggable={false} />
    <img className="jinxu-logo-dark" src={darkLogo} alt="" draggable={false} />
  </span>;
}

export function logoUrl(mode: string | undefined) {
  return mode === "dark" ? darkLogo : lightLogo;
}
