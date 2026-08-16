/* ============================================================
   BRAND CONFIG  —  THE ONLY FILE YOU CHANGE PER ORGANIZATION.
   ------------------------------------------------------------
   The app's index.html is IDENTICAL for every org. To launch a
   new white-label instance you deploy the same app and swap in
   this one file (plus that org's own /images and /css assets).

   No build step. This is a plain script that runs first and sets
   window.BRAND; the app reads every brand value from it.
   ============================================================ */
window.BRAND = {
  /* ---- Identity ---- */
  name: "Minnesota Then",
  tagline: "Museum Without Walls",
  description:
    "Free GPS-driven history across Minnesota. Walk past landmarks — virtual exhibits appear with archival photos and stories. No app, no signups, no ads.",
  lang: "en-US",

  /* ---- URLs & contact ---- */
  siteUrl: "https://www.mnthen.com", // no trailing slash
  feedbackEmail: "mattreicher@protonmail.com",
  twitter: "@MinnesotaThen",

  /* ---- Social share image (absolute URL) ---- */
  ogImage: "https://www.mnthen.com/images/index/index_1.jpg",
  ogImageAlt:
    "A view of the historic retail along West Seventh Street, near what is now the Xcel Energy Center, taken by photographer Jerry Mathiason in 1978",

  /* ---- Look & feel ---- */
  themeColor: "#2c5282",

  /* ---- Loading screen ---- */
  loadingTitle: "The White Label Test",
  loadingSubtitle: "Where Every Step Tells a Story",

  /* ---- Media session (lock-screen audio metadata) ---- */
  mediaArtist: "Historical Audio",
  mediaAlbum: "Minnesota Then Tour",

  /* ---- Map starting position ---- */
  mapCenter: [46.39241, -94.63623],
  mapZoom: 17,

  /* ---- Structured-data region (for SEO / JSON-LD) ---- */
  region: {
    name: "Minnesota Historical Sites",
    placeName: "Minnesota",
    country: "US",
    lat: 46.7296,
    lng: -94.6859,
    knowsAbout: [
      "Minnesota History",
      "Historical GIS",
      "Digital Heritage",
      "Interactive Maps",
    ],
  },

  /* ---- Acknowledgements ---- */
  credits: [
    {
      badge: "MHS",
      name: "Minnesota Historical Society",
      url: "https://www.mnhs.org",
      desc: "For their invaluable historical data, photographs, and archive materials.",
    },
    {
      badge: "MSU",
      name: "Metropolitan State University",
      url: "https://www.metrostate.edu",
      desc: "For fostering a passion for history and research methodology.",
    },
    {
      badge: "LJS",
      name: "Leaflet.js",
      url: "https://leafletjs.com",
      desc: "The open-source JavaScript library that powers the mapping features.",
    },
    {
      badge: "\u2726",
      name: "All Contributors",
      url: null,
      desc: "Researchers, testers, and developers who made this project possible.",
    },
  ],
};
