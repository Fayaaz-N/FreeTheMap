(() => {
  // ====== 1) DATA: checkpoints ======
  // Pas dit aan naar jouw verhaal
  const events = [
    {
      id: "theft",
      label: "Auto gestolen",
      time: "01:12",
      color: "#f6c244",
      latlng: [52.3729, 4.8936],
      title: "Start: diefstal voertuig",
      desc: "Voertuig wordt gestolen en verplaatst richting doelwitlocatie."
    },
    {
      id: "atm",
      label: "Plofkraak",
      time: "02:03",
      color: "#EC5B62",
      latlng: [52.3676, 4.9041],
      title: "Checkpoint: plofkraak",
      desc: "Poging tot plofkraak. Route en tijdlijn gaan door naar de ontsnappingsroute."
    },
    {
      id: "arrest",
      label: "Aanhouding",
      time: "02:27",
      color: "#4ea3ff",
      latlng: [52.3842, 4.9031],
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
  const map = L.map("map", { zoomControl: true }).setView(events[0].latlng, 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);

  // ====== 4) ROUTE + MARKERS ======
  const markers = [];
  const routeLatLngs = events.map(e => e.latlng);

  const baseRoute = L.polyline(routeLatLngs, {
    weight: 5,
    opacity: 0.35
  }).addTo(map);

  const activeRoute = L.polyline([events[0].latlng], {
    weight: 6,
    opacity: 0.95
  }).addTo(map);

  function makeDivIcon(color, isActive) {
    const size = isActive ? 18 : 14;
    const ring = isActive ? `0 0 0 6px rgba(236,91,98,.14)` : `0 0 0 4px rgba(255,255,255,.08)`;
    return L.divIcon({
      className: "",
      iconSize: [size, size],
      html: `
        <div style="
          width:${size}px;height:${size}px;border-radius:999px;
          background:${color};
          box-shadow:${ring};
          border: 1px solid rgba(255,255,255,.35);
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

    const progress = step / (events.length - 1);
    const percent = Math.round(progress * 100);
    bar.style.width = `${percent}%`;
    pct.textContent = `${percent}%`;

    activeRoute.setLatLngs(routeLatLngs.slice(0, step + 1));

    markers.forEach((m, i) => {
      m.setIcon(makeDivIcon(events[i].color, i === step));
    });

    map.flyTo(e.latlng, 14, { duration: 0.8 });
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

  // Helpers
  function hexToRgba(hex, a) {
    const h = hex.replace("#", "").trim();
    const full = h.length === 3 ? h.split("").map(x => x + x).join("") : h;
    const n = parseInt(full, 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r},${g},${b},${a})`;
  }

  // Start view
  map.fitBounds(baseRoute.getBounds(), { padding: [30, 30] });
  setTimeout(updateUI, 150);
})();
