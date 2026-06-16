"use strict";
(() => {
  // extension/src/theme-init.mjs
  (function() {
    try {
      var t = localStorage.getItem("gbti-theme");
      if (!t) t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", t);
    } catch (e) {
    }
  })();
})();
