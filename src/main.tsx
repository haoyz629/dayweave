import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./assets/fonts/fonts.css";
import "./styles/tokens.css";
import "./styles/controls.css";
import "./styles/shell.css";
import "./styles/workbench.css";
import "./styles/overlays.css";
import "./styles/modules.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
