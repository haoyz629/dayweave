import navigationLogo from "./assets/logo-light.svg";
import windowsLogo from "./assets/logo-windows.png";
import { CopySeparator } from "./copy-separator";

// Shared porcelain tile: the SVG already includes its border and shadows.
// Accept the old preview prop without reintroducing a theme-dependent icon.
export function Logo(_props: { mode?: "light" | "dark" } = {}) {
  return <span className="dayweave-logo" aria-hidden="true">
    <img className="dayweave-logo-light" src={navigationLogo} alt="" draggable={false} />
  </span>;
}

export function ProductBrand({ weekLabel }: { weekLabel?: string } = {}) {
  return <section className="product-brand" aria-label="今序 · Dayweave 品牌标识">
    <div className="product-brand-heading">
      <div className="product-brand-logo"><Logo /></div>
      <div className="product-brand-text">
        <div className="product-brand-name-row">
          <h1 className="product-brand-name">今序<CopySeparator /><span lang="en">Dayweave</span></h1>
          {weekLabel && <span className="product-brand-week">{weekLabel}</span>}
        </div>
      </div>
    </div>
  </section>;
}

export function logoUrl(_mode?: string) {
  return windowsLogo;
}
