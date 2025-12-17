// js/data-loader.js
// Laadt dataset uit data.json en geeft hem terug als JS object.

(function () {
  async function loadDataset(url = "data.json") {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Kon dataset niet laden: ${url} (${res.status})`);
    return await res.json();
  }

  window.loadDataset = loadDataset;
})();
