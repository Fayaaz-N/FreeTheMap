(() => {
  // ====== 1) DATA: checkpoints ======
  // Tip: per stap kun je een eigen zoom zetten met `zoom`
  const events = [
    {
      id: "theft",
      label: "Auto gestolen",
      time: "01:12",
      color: "#f6c244",
      latlng: [52.3729, 4.8936],
      zoom: 13,
      title: "Start: diefstal voertuig",
      desc: "Voertuig wordt gestolen en verplaatst richting doelwitlocatie."
    },
    {
      id: "atm",
      label: "Plofkraak",
      time: "02:03",
      color: "#EC5B62",
      latlng: [52.3676, 4.9041],
      zoom: 16,
      title: "Checkpoint: plofkraak",
      desc: "Poging tot plofkraak. Hier zoom je wat verder in."
    },
    {
      id: "arrest",
      label: "Aanhouding",
      time: "02:27",
      color: "#4ea3ff",
      latlng: [52.3842, 4.9031],
      zoom: 14,
      title: "Einde: aanhouding",
      desc: "Verdachten worden aangehouden na onderschepping."
    }
  ];

  // ====== 2) DOM ======
  const stepLabel = document.getElementById("stepLabel");
  const titleEl = document.getElementById("title");
  const descEl = document.getElementById("desc");
  const metaEl = document.getElementById("meta");
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const bar = document.getElementById("bar");
  const pct = document.getElementById("pct");
  const dot = document.getElementById("dot");

  // ====== 3) MAP INIT ======
  const map = L.map("map", { zoomControl: true }).setView(events[0].latlng, events[0].zoom ?? 13);

  // --- Basemaps (Straat + Satelliet) ---
  const streetLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  });

  // Satelliet: Esri World Imagery
  const satelliteLayer = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      attribution: "Tiles &copy; Esri"
    }
  );

  // Start met satelliet (zoals je vroeg)
  satelliteLayer.addTo(map);

  // Toggle rechtsboven
  L.control.layers(
    { "Satelliet": satelliteLayer, "Straat": streetLayer },
    null,
    { collapsed: true }
  ).addTo(map);

  // ====== 4) ROUTE + MARKERS ======
  const markers = [];
  const routeLatLngs = events.map(e => e.latlng);

  // Volledige route (grijs, achtergrond)
  const baseRoute = L.polyline(routeLatLngs, {
    weight: 5,
    opacity: 0.35
  }).addTo(map);

  // Actieve route (bouwt op per stap)
  const activeRoute = L.polyline([events[0].latlng], {
    weight: 6,
    opacity: 0.95
  }).addTo(map);

  function makeDivIcon(color, isActive) {
    const size = isActive ? 18 : 14;
    const ring = isActive
      ? `0 0 0 7px ${hexToRgba(color, 0.22)}`
      : `0 0 0 4px rgba(255,255,255,.10)`;

    return L.divIcon({
      className: "",
      iconSize: [size, size],
      html: `
        <div style="
          width:${size}px;height:${size}px;border-radius:999px;
          background:${color};
          box-shadow:${ring};
          border: 1px solid rgba(255,255,255,.45);
        "></div>
      `
    });
  }

  events.forEach((e, idx) => {
    const m = L.marker(e.latlng, { icon: makeDivIcon(e.color, idx === 0) })
      .addTo(map)
      .bindPopup(`<b>${e.label}</b><br>${e.title}<br><small>${e.time}</small>`);
    markers.push(m);
  });

  // ====== 5) STATE + UI ======
  let step = 0;

  function updateUI() {
    const e = events[step];

    stepLabel.textContent = `Stap ${step + 1}/${events.length}`;
    titleEl.textContent = e.title;
    descEl.textContent = e.desc;
    metaEl.textContent = `${e.label} • ${e.time}`;

    dot.style.background = e.color;
    dot.style.boxShadow = `0 0 0 4px ${hexToRgba(e.color, 0.18)}`;

    prevBtn.disabled = step === 0;
    nextBtn.disabled = step === events.length - 1;

    const progress = (events.length - 1) === 0 ? 0 : step / (events.length - 1);
    const percent = Math.round(progress * 100);
    bar.style.width = `${percent}%`;
    pct.textContent = `${percent}%`;

    // Route t/m huidige stap
    activeRoute.setLatLngs(routeLatLngs.slice(0, step + 1));

    // Marker highlight
    markers.forEach((m, i) => {
      m.setIcon(makeDivIcon(events[i].color, i === step));
    });

    // Per stap in-/uitzoomen
    const z = Number.isFinite(e.zoom) ? e.zoom : 14;
    map.flyTo(e.latlng, z, { duration: 0.9 });

    markers[step].openPopup();
  }

  prevBtn.addEventListener("click", () => {
    step = Math.max(0, step - 1);
    updateUI();
  });

  nextBtn.addEventListener("click", () => {
    step = Math.min(events.length - 1, step + 1);
    updateUI();
  });

  function hexToRgba(hex, a) {
    const h = String(hex).replace("#", "").trim();
    const full = h.length === 3 ? h.split("").map(x => x + x).join("") : h;
    const n = parseInt(full, 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r},${g},${b},${a})`;
  }

  // Start netjes in beeld
  map.fitBounds(baseRoute.getBounds(), { padding: [30, 30] });
  setTimeout(updateUI, 150);
})();
