"use strict";
(() => {
  // extension/src/theme-init.mjs
  (function() {
    try {
      var t = localStorage.getItem("gbti-theme");
      if (!t) t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", t);
      var l = localStorage.getItem("gbti-layout");
      document.documentElement.setAttribute("data-layout", l === "glass" ? "glass" : "flat");
      var g = localStorage.getItem("gbti-glass");
      if (g != null) {
        var gp = Math.round(Number(g));
        if (gp === gp) document.documentElement.style.setProperty("--glass-strength", String(Math.max(0, Math.min(100, gp)) / 50));
      }
      var gw = localStorage.getItem("gbti-glass-glow");
      if (gw != null) {
        var gwp = Math.round(Number(gw));
        if (gwp === gwp) document.documentElement.style.setProperty("--glass-glow", String(Math.max(0, Math.min(100, gwp)) / 50));
      }
    } catch (e) {
    }
  })();
})();
