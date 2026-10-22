import navigationLogo from "./assets/logo-light.svg";
import windowsLogo from "./assets/logo-windows.png";

// Shared porcelain tile: the SVG already includes its border and shadows.
// Accept the old preview prop without reintroducing a theme-dependent icon.
export function Logo(_props: { mode?: "light" | "dark" } = {}) {
  return <span className="dayweave-logo" aria-hidden="true">
    <img className="dayweave-logo-light" src={navigationLogo} alt="" draggable={false} />
  </span>;
}

export function ProductBrand() {
  return <section className="sidebar-brand" aria-label="今序 · Dayweave 品牌介绍">
    <div className="product-brand-heading">
      <div className="product-brand-logo"><Logo /></div>
      <div className="product-brand-text">
        <h1 className="product-brand-name">今序 · Dayweave</h1>
        <div className="product-brand-copy">
          <p className="product-brand-chinese">让今天，井然有序。</p>
          <p className="product-brand-english" lang="en">Bring order to your day.</p>
        </div>
      </div>
    </div>
  </section>;
}

export function logoUrl(_mode?: string) {
  return windowsLogo;
}
