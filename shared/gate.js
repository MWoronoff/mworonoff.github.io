/* Sign-in gate for the Adtaxi Market Analyzers.
   A visitor enters a work email on /analyzers/signin.html; this check sends anyone without a
   recent sign-in there first, then back to the page they asked for.
   This is a deterrent only: a static site can't truly restrict access, and data files and PDFs
   stay reachable by direct address. Remove this script (one line in each page's <head>) when
   the site moves behind the company server's sign-in. */
(function () {
  var KEY = "az-signin", DAYS = 30, SIGNIN = "/analyzers/signin.html";

  function read() {
    try { var v = localStorage.getItem(KEY); if (v) return JSON.parse(v); } catch (e) {}
    try {
      var m = document.cookie.match(/(?:^|; )az-signin=([^;]*)/);
      if (m) return JSON.parse(decodeURIComponent(m[1]));
    } catch (e) {}
    return null;
  }

  window.AdtaxiSignOut = function () {
    try { localStorage.removeItem(KEY); } catch (e) {}
    document.cookie = "az-signin=; path=/; max-age=0; samesite=lax";
    location.href = SIGNIN;
  };

  var s = read();
  if (s && s.t && Date.now() - s.t < DAYS * 864e5) return;

  document.documentElement.style.visibility = "hidden";
  location.replace(SIGNIN + "?next=" + encodeURIComponent(location.pathname + location.search + location.hash));
})();
