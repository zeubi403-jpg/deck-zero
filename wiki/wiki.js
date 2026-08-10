/* Deck Zero Wiki — EN/FR + relative link lang carry */
(function () {
  function detect() {
    var q = new URLSearchParams(location.search).get("lang");
    if (q === "fr" || q === "en") return q;
    try {
      var s = localStorage.getItem("dz-lang");
      if (s === "fr" || s === "en") return s;
    } catch (_) {}
    return (navigator.language || "").toLowerCase().startsWith("fr") ? "fr" : "en";
  }

  function rewriteLinks(lang) {
    document.querySelectorAll("a[href]").forEach(function (a) {
      var href = a.getAttribute("href");
      if (!href || href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("#")) return;
      var base = href.split("?")[0].split("#")[0];
      var hash = "";
      if (href.indexOf("#") >= 0) hash = "#" + href.split("#")[1].split("?")[0];
      a.setAttribute("href", base + "?lang=" + lang + hash);
    });
  }

  function setLang(lang) {
    lang = lang === "fr" ? "fr" : "en";
    document.documentElement.lang = lang;
    try { localStorage.setItem("dz-lang", lang); } catch (_) {}
    document.querySelectorAll("[data-set-lang]").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-set-lang") === lang);
    });
    var titleEl = document.querySelector('meta[name="wiki-title-' + lang + '"]');
    if (titleEl) document.title = titleEl.getAttribute("content") || document.title;
    rewriteLinks(lang);
    try {
      var url = new URL(location.href);
      url.searchParams.set("lang", lang);
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    } catch (_) {}
  }

  document.querySelectorAll("[data-set-lang]").forEach(function (b) {
    b.addEventListener("click", function () {
      setLang(b.getAttribute("data-set-lang"));
    });
  });

  document.querySelectorAll(".era[data-era]").forEach(function (el) {
    el.setAttribute("tabindex", "0");
    el.setAttribute("role", "button");
    function toggle() {
      var open = !el.classList.contains("open");
      el.parentElement.querySelectorAll(".era[data-era]").forEach(function (y) {
        y.classList.toggle("open", y === el ? open : false);
      });
    }
    el.addEventListener("click", toggle);
    el.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });
  });

  setLang(detect());
})();
