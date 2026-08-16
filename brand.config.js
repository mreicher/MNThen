/* ============================================================================
   WHITE-LABEL BRAND CONFIG
   ----------------------------------------------------------------------------
   This is the ONLY file each organization needs to edit.
   Copy this file per-org (e.g. brand.mnthen.js, brand.wisconsin.js) and swap
   in the values below, then load the right one in index.html.

   Everything the app displays about the organization is read from window.BRAND.
   Do not hardcode org names/URLs anywhere else — reference window.BRAND.* .
   ============================================================================ */
window.BRAND = {
  /* ---- Core identity -------------------------------------------------- */
  name:            "Minnesota Then",              // App / org name
  tagline:         "Museum Without Walls",        // Shown after name in <title>
  loadingTitle:    "The Museum Without Walls",    // Big title on the loading card
  loadingSubtitle: "Where Every Step Tells a Story",
  description:     "Free GPS-driven history across Minnesota. Walk past landmarks — virtual exhibits appear with archival photos and stories. No app, no signups, no ads.",

  /* ---- URLs / domains -------------------------------------------------- */
  siteUrl:      "https://www.mnthen.com",         // No trailing slash
  canonicalUrl: "https://www.mnthen.com/",        // With trailing slash
  cdnDomain:    "cdn.mnthen.com",                 // Used in dns-prefetch (no protocol)
  apiDomain:    "api.mnthen.com",                 // Used in dns-prefetch (no protocol)

  /* ---- Images & icons -------------------------------------------------- */
  favicon: "https://www.mnthen.com/images/mnthenfav.ico",
  icon192: "https://www.mnthen.com/images/icon-192.png",
  icon512: "https://www.mnthen.com/images/icon-512.png",
  logo:    "https://mnthen.com/images/logo.webp",
  ogImage: "https://www.mnthen.com/images/index/index_1.jpg",
  ogImageAlt: "A view of the historic retail along West Seventh Street, near what is now the Xcel Energy Center, taken by photographer Jerry Mathiason in 1978",

  /* ---- Social ---------------------------------------------------------- */
  twitterHandle: "@MinnesotaThen",
  twitterUrl:    "https://twitter.com/MinnesotaThen",

  /* ---- Contact --------------------------------------------------------- */
  feedbackEmail: "mattreicher@protonmail.com",

  /* ---- Theme ----------------------------------------------------------- */
  themeColor: "#2c5282",

  /* ---- Audio / media session ------------------------------------------ */
  mediaAlbum:  "Minnesota Then Tour",
  mediaArtist: "Historical Audio",

  /* ---- Map defaults ---------------------------------------------------- */
  mapCenter: [46.392410, -94.636230],  // [lat, lng] initial view
  mapZoom:   17,

  /* ---- Structured data (JSON-LD) region ------------------------------- */
  region: {
    name:    "Minnesota",
    lat:     46.7296,
    lng:     -94.6859,
    country: "US",
  },
  foundingDate: "2024",
  orgDescription: "Digital platform preserving and sharing Minnesota's historical heritage through interactive mapping technology.",
  knowsAbout: ["Minnesota History", "Historical GIS", "Digital Heritage", "Interactive Maps"],

  /* ---- Acknowledgements / credits modal ------------------------------- */
  credits: [
    { badge: "MHS", name: "Minnesota Historical Society", url: "https://www.mnhs.org",      desc: "For their invaluable historical data, photographs, and archive materials." },
    { badge: "MSU", name: "Metropolitan State University", url: "https://www.metrostate.edu", desc: "For fostering a passion for history and research methodology." },
    { badge: "LJS", name: "Leaflet.js",                    url: "https://leafletjs.com",      desc: "The open-source JavaScript library that powers the mapping features." },
    { badge: "\u2726", name: "All Contributors",           url: null,                          desc: "Researchers, testers, and developers who made this project possible." },
  ],
};

/* ============================================================================
   BOOTSTRAP — stamps the <head> tags from window.BRAND.
   This runs immediately (the file is loaded first in <head>), so document.title,
   meta tags, favicons, and theme-color reflect the active brand.

   NOTE on SEO: social/search crawlers read the STATIC HTML, not JS-updated tags.
   If crawler-accurate OG/Twitter tags matter, do build-time token replacement
   instead (see the guide) rather than relying on this runtime patch.
   ============================================================================ */
(function applyBrand() {
  var B = window.BRAND;
  if (!B) return;

  function setMeta(selector, attr, value) {
    var el = document.querySelector(selector);
    if (el) el.setAttribute(attr, value);
  }
  function setLink(rel, href) {
    var el = document.querySelector('link[rel="' + rel + '"]');
    if (el) el.setAttribute("href", href);
  }

  // Title
  document.title = B.name + " | " + B.tagline;

  // Primary meta
  setMeta('meta[name="description"]', "content", B.description);
  setMeta('meta[name="theme-color"]', "content", B.themeColor);
  setMeta('meta[name="apple-mobile-web-app-title"]', "content", B.name);

  // Open Graph
  setMeta('meta[property="og:url"]',            "content", B.canonicalUrl);
  setMeta('meta[property="og:title"]',          "content", B.name + " | " + B.tagline);
  setMeta('meta[property="og:description"]',    "content", B.description);
  setMeta('meta[property="og:image"]',          "content", B.ogImage);
  setMeta('meta[property="og:image:alt"]',      "content", B.ogImageAlt);
  setMeta('meta[property="og:site_name"]',      "content", B.name);

  // Twitter
  setMeta('meta[name="twitter:site"]',       "content", B.twitterHandle);
  setMeta('meta[name="twitter:creator"]',    "content", B.twitterHandle);
  setMeta('meta[name="twitter:title"]',      "content", B.name + " | " + B.tagline);
  setMeta('meta[name="twitter:description"]',"content", B.description);
  setMeta('meta[name="twitter:image"]',      "content", B.ogImage);
  setMeta('meta[name="twitter:image:alt"]',  "content", B.ogImageAlt);

  // Icons / canonical
  setLink("apple-touch-icon", B.icon192);
  setLink("canonical", B.canonicalUrl);

  // JSON-LD structured data
  var ld = document.querySelector('script[type="application/ld+json"]');
  if (ld) {
    ld.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "WebApplication",
          "name": B.name,
          "url": B.siteUrl,
          "description": B.description,
          "applicationCategory": ["ProductivityApplication", "EducationApplication"],
          "operatingSystem": "Web",
          "isAccessibleForFree": true,
          "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD", "availability": "https://schema.org/InStock" },
          "creator": { "@id": "#organization" },
          "screenshot": B.ogImage,
        },
        {
          "@type": "TouristDestination",
          "name": B.region.name + " Historical Sites",
          "geo": { "@type": "GeoCoordinates", "latitude": B.region.lat, "longitude": B.region.lng },
          "containedInPlace": { "@type": "State", "name": B.region.name, "addressCountry": B.region.country },
        },
        {
          "@id": "#organization",
          "@type": "Organization",
          "name": B.name,
          "url": B.siteUrl,
          "logo": B.icon192,
          "sameAs": [B.twitterUrl],
          "foundingDate": B.foundingDate,
          "description": B.orgDescription,
          "knowsAbout": B.knowsAbout,
        },
      ],
    });
  }
})();
