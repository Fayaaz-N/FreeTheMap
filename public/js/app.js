(() => {
  // voorkom dubbele init bij HMR
  if (window.__ORANJE_APP_RUNNING__) return;
  window.__ORANJE_APP_RUNNING__ = true;

  // =============================
  // TheSportsDB (via webpack proxy)
  // =============================
  const TSDB_KEY = "123"; // free key
  const TSDB_BASE = `/tsdb/api/v1/json/${TSDB_KEY}`; // <-- gaat via proxy, dus geen CORS
  const TSDB_CACHE_KEY = "tsdbTeamBadgeCache_v2";

  // Zet dit bestand in: /img/club-default.png  (anders krijg je 404)
  const FALLBACK_BADGE = "/img/club-default.png";

  function loadTsdbCache() {
    try {
      return JSON.parse(localStorage.getItem(TSDB_CACHE_KEY) || "{}");
    } catch {
      return {};
    }
  }
  function saveTsdbCache(cache) {
    try {
      localStorage.setItem(TSDB_CACHE_KEY, JSON.stringify(cache));
    } catch {}
  }

  // alias map: TSDB team naming is soms anders
  const TSDB_ALIASES = {
    Groningen: "FC Groningen",
    "Inter Milan": "Inter",
    Milan: "AC Milan",
    Roma: "AS Roma",
    Lyon: "Olympique Lyonnais",
    "Newcastle United": "Newcastle",
    "Manchester United": "Man United",
    "Atlético Madrid": "Atletico Madrid",
    "Paris Saint-Germain": "Paris SG",
    "Fenerbahçe": "Fenerbahce",
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function fetchTeamFromTSDB(teamName) {
    const t = encodeURIComponent(teamName);
    const url = `${TSDB_BASE}/searchteams.php?t=${t}`;

    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;

    // Soms krijg je HTML terug als proxy stuk is; guard:
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) return null;

    const json = await res.json();
    return json?.teams?.[0] || null;
  }

  function pickBadge(team) {
    // TSDB velden verschillen soms, dus pak de beste die beschikbaar is
    return (
      team?.strTeamBadge ||
      team?.strBadge ||
      team?.strTeamLogo ||
      team?.strLogo ||
      null
    );
  }

  async function resolveBadge(teamName, cache) {
    if (!teamName) return null;

    // cache hit
    if (cache[teamName]) return cache[teamName];

    // 1) direct
    let team = await fetchTeamFromTSDB(teamName);
    let badge = pickBadge(team);

    // 2) alias
    if (!badge && TSDB_ALIASES[teamName]) {
      team = await fetchTeamFromTSDB(TSDB_ALIASES[teamName]);
      badge = pickBadge(team);
    }

    // 3) strip accents (Atlético → Atletico)
    if (!badge) {
      const simplified = teamName.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (simplified !== teamName) {
        team = await fetchTeamFromTSDB(simplified);
        badge = pickBadge(team);
      }
    }

    if (badge) {
      cache[teamName] = badge;
      saveTsdbCache(cache);
    }

    return badge;
  }

  async function applyClubLogosFromTSDB(data) {
    const cache = loadTsdbCache();

    // unieke clubs verzamelen
    const clubs = new Set();
    for (const t of data.tournaments || []) {
      for (const p of t.players || []) {
        for (const c of p.clubs || []) {
          if (c?.club) clubs.add(c.club);
        }
      }
    }

    // badges ophalen (rustig aan ivm rate limit)
    for (const clubName of clubs) {
      try {
        await resolveBadge(clubName, cache);
      } catch (e) {
        // ignore individuele failures
      }
      await sleep(200);
    }

    // inject in dataset
    for (const t of data.tournaments || []) {
      for (const p of t.players || []) {
        for (const c of p.clubs || []) {
          if (!c.clubLogo && c.club && cache[c.club]) {
            c.clubLogo = cache[c.club];
          }
        }
      }
    }

    console.log("[TSDB] cache size:", Object.keys(cache).length);
  }

  // ========= DOM =========
  const els = {
    yearSlider: document.getElementById("yearSlider"),
    yearPill: document.getElementById("yearPill"),
    metaLine: document.getElementById("metaLine"),
    snapHint: document.getElementById("snapHint"),
    tournamentTitle: document.getElementById("tournamentTitle"),
    players: document.getElementById("players"),
    playerDetail: document.getElementById("playerDetail"),
    playerSub: document.getElementById("playerSub"),
    mapSub: document.getElementById("mapSub"),
    map: document.getElementById("map"),
  };

  const required = [
    "yearSlider",
    "yearPill",
    "metaLine",
    "tournamentTitle",
    "players",
    "playerDetail",
    "playerSub",
    "mapSub",
    "map",
  ];
  const missing = required.filter((k) => !els[k]);
  if (missing.length) {
    console.error("Mist DOM elementen:", missing);
    return;
  }
  if (!window.L) {
    console.error("Leaflet niet gevonden. Voeg Leaflet JS toe vóór js/app.js.");
    return;
  }

  // ====== state ======
  let data = null;
  let years = [];
  let currentYear = null;
  let selectedPlayerId = null;

  // ====== helpers ======
  const safe = (v, fallback = "—") =>
    v === undefined || v === null || v === "" ? fallback : v;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

  function clubsUpToYear(clubs, cutoffYear) {
    const list = Array.isArray(clubs) ? clubs.slice() : [];
    const cutoff = Number(cutoffYear);

    const filtered = list.filter((c) => {
      const from = Number(c.from);
      if (!Number.isFinite(from)) return false;
      return from <= cutoff;
    });

    filtered.sort((a, b) => (Number(a.from) || 0) - (Number(b.from) || 0));

    return filtered.map((c) => {
      const to = c.to === null || c.to === undefined ? null : Number(c.to);
      const toView =
        to === null || !Number.isFinite(to) || to > cutoff ? cutoff : to;
      return { ...c, _toView: toView };
    });
  }

  function clubAtYear(clubs, year) {
    const y = Number(year);
    if (!Array.isArray(clubs) || !Number.isFinite(y)) return null;

    const list = clubs
      .map((c) => ({ ...c, _from: num(c?.from), _to: c?.to == null ? null : num(c?.to) }))
      .filter((c) => Number.isFinite(c._from))
      .sort((a, b) => (a._from ?? 0) - (b._from ?? 0));

    return (
      list.find((c) => {
        const to = c._to === null ? 9999 : c._to;
        return c._from <= y && y <= to;
      }) || null
    );
  }

  // ====== MAP ======
  let map, streetLayer, satelliteLayer, markersLayer, routeLayer;

  function initMap() {
    if (map) {
      try { map.remove(); } catch (e) {}
      map = null;
    }

    map = L.map("map", { zoomControl: true }).setView([52.3729, 4.8936], 5);

    streetLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    });

    satelliteLayer = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, attribution: "Tiles &copy; Esri" }
    );

    satelliteLayer.addTo(map);
    L.control.layers({ Satelliet: satelliteLayer, Straat: streetLayer }, null, {
      collapsed: true,
    }).addTo(map);

    markersLayer = L.layerGroup().addTo(map);
    routeLayer = L.polyline([], { weight: 4, opacity: 0.9 }).addTo(map);
  }

  function clearMap() {
    markersLayer.clearLayers();
    routeLayer.setLatLngs([]);
    els.mapSub.textContent = "Clubs van geselecteerde speler";
  }

  function getLatLngFromClub(c) {
    if (Array.isArray(c?.latlng) && c.latlng.length === 2) return c.latlng;
    const lat = num(c?.lat);
    const lng = num(c?.lng);
    if (lat !== null && lng !== null) return [lat, lng];
    return null;
  }

  function clubLogoMarker(latlng, logoUrl, fallbackText = "•") {
    const src = logoUrl || FALLBACK_BADGE;

    const html = `
      <img
        src="${src}"
        alt=""
        style="width:34px;height:34px;object-fit:contain;filter:drop-shadow(0 2px 6px rgba(0,0,0,.35));"
        onerror="this.onerror=null;this.src='${FALLBACK_BADGE}';"
      />
    `;

    return L.marker(latlng, {
      icon: L.divIcon({
        className: "club-logo-marker",
        html,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
        popupAnchor: [0, -18],
      }),
    });
  }

  function renderYearOnMap(year, players) {
    clearMap();

    const y = Number(year);
    const grouped = new Map();

    for (const p of players) {
      const stint = clubAtYear(p.clubs, y);
      if (!stint) continue;

      const ll = getLatLngFromClub(stint);
      if (!ll) continue;

      const key = `${ll[0].toFixed(6)},${ll[1].toFixed(6)}`;
      if (!grouped.has(key)) grouped.set(key, { latlng: ll, items: [] });

      grouped.get(key).items.push({
        playerName: p.name,
        club: stint.club,
        stadium: stint.stadium || null,
        clubLogo: stint.clubLogo || null,
      });
    }

    routeLayer.setLatLngs([]);

    const points = [];

    for (const { latlng, items } of grouped.values()) {
      points.push(latlng);

      const lines = items
        .sort((a, b) => a.playerName.localeCompare(b.playerName))
        .map((x) => {
          const s = x.stadium ? ` • ${x.stadium}` : "";
          return `<div>• <b>${x.playerName}</b><br><span style="opacity:.85">${x.club}${s}</span></div>`;
        })
        .join("");

      const popup = `
        <div style="min-width:240px">
          <div style="font-weight:800;margin-bottom:6px">${y} — spelers bij deze club</div>
          <div style="margin-top:8px;display:grid;gap:8px">${lines}</div>
        </div>
      `;

      const logo = items.find((i) => i.clubLogo)?.clubLogo || null;

      clubLogoMarker(latlng, logo, "•").bindPopup(popup).addTo(markersLayer);
    }

    if (!points.length) {
      els.mapSub.textContent = `Geen club-locaties gevonden voor ${y}. (Check latlng in data.json)`;
      map.setView([52.3729, 4.8936], 5);
      return;
    }

    map.fitBounds(L.latLngBounds(points), { padding: [30, 30] });
    els.mapSub.textContent = `${y} • alle spelers • ${points.length} unieke locaties`;
  }

  function renderPlayerOnMap(player) {
    clearMap();
    if (!player) return;

    const cutoff = Number(currentYear);
    const clubs = clubsUpToYear(player.clubs, cutoff);

    const grouped = new Map();
    for (const c of clubs) {
      const ll = getLatLngFromClub(c);
      if (!ll) continue;

      const key = `${ll[0].toFixed(6)},${ll[1].toFixed(6)}`;
      if (!grouped.has(key)) grouped.set(key, { latlng: ll, items: [] });
      grouped.get(key).items.push(c);
    }

    const points = [];

    for (const { latlng, items } of grouped.values()) {
      points.push(latlng);

      const lines = items
        .sort((a, b) => (Number(a.from) || 0) - (Number(b.from) || 0))
        .map((c) => {
          const period = `${c.from}–${c._toView ?? cutoff}`;
          const stadium = c.stadium ? ` • ${c.stadium}` : "";
          return `<div>• <b>${c.club}</b> (${period})${stadium}</div>`;
        })
        .join("");

      const popup = `
        <div style="min-width:220px">
          <div style="font-weight:700;margin-bottom:6px">${player.name}</div>
          <div style="opacity:.85">Clubs t/m ${cutoff}</div>
          <div style="margin-top:8px">${lines}</div>
        </div>
      `;

      const firstLogo = items.find((c) => c.clubLogo)?.clubLogo || null;

      clubLogoMarker(latlng, firstLogo, player.name?.[0] || "•")
        .bindPopup(popup)
        .addTo(markersLayer);
    }

    const routePoints = [];
    const seen = new Set();
    for (const c of clubs) {
      const ll = getLatLngFromClub(c);
      if (!ll) continue;
      const key = `${ll[0].toFixed(6)},${ll[1].toFixed(6)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      routePoints.push(ll);
    }
    routeLayer.setLatLngs(routePoints);

    if (!points.length) {
      els.mapSub.textContent = `Geen kaartpunten gevonden t/m ${cutoff}. (Check latlng in data.json)`;
      map.setView([52.3729, 4.8936], 5);
      return;
    }

    map.fitBounds(L.latLngBounds(points), { padding: [30, 30] });
    els.mapSub.textContent = `${player.name} • clubs t/m ${cutoff} • ${points.length} unieke locaties`;
  }

  // ====== UI RENDER ======
  function renderTournament(year) {
    const t = data.tournaments.find((x) => Number(x.year) === Number(year));
    if (!t) return;

    currentYear = year;
    selectedPlayerId = null;

    els.yearPill.textContent = `Jaar: ${year}`;
    els.metaLine.textContent = `${safe(t.name)} • ${safe(t.host)} • ${safe(t.result)} • Coach: ${safe(t.coach)}`;
    els.tournamentTitle.textContent = `${t.year} — ${t.name}`;

    els.players.innerHTML = "";
    t.players.forEach((p, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "player";
      btn.dataset.playerId = p.id;

      btn.innerHTML = `
        <div class="player__left">
          <div class="player__name">${idx + 1}. ${p.name}</div>
          <div class="player__meta">Geboren: ${safe(p.birthCountry)}</div>
        </div>
        <div class="badge">${safe(p.position)}</div>
      `;

      btn.addEventListener("click", () => {
        selectedPlayerId = p.id;
        document.querySelectorAll(".player").forEach((x) => x.classList.remove("is-active"));
        btn.classList.add("is-active");
        renderPlayer(t.year, p.id);
      });

      els.players.appendChild(btn);
    });

    els.playerSub.textContent = "Klik een speler";
    els.playerDetail.innerHTML = `
      <div class="empty">
        <div class="empty__dot"></div>
        <div>
          <div class="empty__title">Nog geen speler geselecteerd</div>
          <div class="empty__text">Klik links op een speler om geboorteland + clubs te zien.</div>
        </div>
      </div>
    `;

    renderYearOnMap(t.year, t.players);
  }

  function renderPlayer(year, playerId) {
    const t = data.tournaments.find((x) => Number(x.year) === Number(year));
    if (!t) return;

    const p = t.players.find((x) => x.id === playerId);
    if (!p) return;

    els.playerSub.textContent = `${p.name} • ${safe(p.position)}`;

    const cutoff = Number(currentYear);
    const clubs = clubsUpToYear(p.clubs, cutoff);

    const stintNow = clubAtYear(p.clubs, cutoff);
    const clubInYear = stintNow
      ? `${stintNow.club}${stintNow.country ? ` (${stintNow.country})` : ""}`
      : "—";

    const clubsHtml = clubs
      .map((c) => {
        const hasCoords = !!getLatLngFromClub(c);
        const extra = hasCoords ? "" : " • (geen coords)";
        const period = `${c.from}–${c._toView ?? cutoff}`;
        const logo = (c.clubLogo || FALLBACK_BADGE)
          ? `<img src="${c.clubLogo || FALLBACK_BADGE}" alt="" style="width:20px;height:20px;object-fit:contain;margin-right:8px;vertical-align:middle" onerror="this.onerror=null;this.src='${FALLBACK_BADGE}';" />`
          : "";

        return `
          <li class="club">
            <div class="club__top" style="display:flex;gap:10px;align-items:flex-start;">
              <div style="min-width:20px;line-height:0;">${logo}</div>
              <div style="flex:1;">
                <div class="club__name">${c.club}</div>
                <div class="club__meta">${period}</div>
              </div>
            </div>
            <div class="club__meta">${safe(c.country)}${extra}</div>
          </li>
        `;
      })
      .join("");

    els.playerDetail.innerHTML = `
      <h3>${p.name}</h3>
      <div class="row">
        <span class="tag">Positie: ${safe(p.position)}</span>
        <span class="tag">Geboorteland: ${safe(p.birthCountry)}</span>
        <span class="tag">Club in ${cutoff}: ${clubInYear}</span>
      </div>

      <div class="muted">Clubcarrière t/m ${cutoff} (chronologisch):</div>
      <ul class="clubs">
        ${clubsHtml || `<li class="club"><div class="club__name">Geen clubs in data</div></li>`}
      </ul>
    `;

    renderPlayerOnMap(p);
  }

  // ====== slider ======
  function initSlider() {
    if (!years.length) return;

    els.yearSlider.min = "0";
    els.yearSlider.max = String(years.length - 1);
    els.yearSlider.step = "1";
    els.yearSlider.value = String(years.length - 1);
    els.snapHint.textContent = "";

    const onInput = () => {
      const idx = parseInt(els.yearSlider.value, 10);
      const year = years[Math.max(0, Math.min(years.length - 1, idx))];
      renderTournament(year);
    };

    els.yearSlider.addEventListener("input", onInput);
    onInput();
  }

  // ====== boot ======
  async function boot() {
    initMap();

    // let op: data.json zit bij jou in /js/data.json
    const url = new URL("/js/data.json", window.location.href).toString();
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Kon data.json niet laden (${res.status}) via ${url}`);

    data = await res.json();

    // ✅ logo’s ophalen NA het laden van data
    // try {
    //   await applyClubLogosFromTSDB(data);
    // } catch (e) {
    //   console.warn("TSDB logos ophalen faalde, ga door zonder logos.", e);
    // }

    years = (data.tournaments || [])
      .map((t) => Number(t.year))
      .filter((y) => Number.isFinite(y))
      .sort((a, b) => a - b);

    if (!years.length) {
      els.metaLine.textContent = "Dataset geladen, maar geen tournaments gevonden.";
      return;
    }

    initSlider();
  }

  boot().catch((err) => {
    console.error(err);
    els.metaLine.textContent = "Fout: data.json niet geladen. Check pad/localhost.";
  });
})();
