import "./polyfills";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";

// The loading screen of index.html fades out by itself once the app is on screen: then it goes.
const splash = document.getElementById("splash");
splash?.addEventListener("transitionend", () => splash.remove());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
