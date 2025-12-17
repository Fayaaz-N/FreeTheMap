import json
import time
import urllib.parse
import requests
from typing import Optional, List, Dict, Any, Tuple

WIKI_API = "https://en.wikipedia.org/w/api.php"
WD_SPARQL = "https://query.wikidata.org/sparql"

HEADERS = {
    # Wikipedia en Wikidata blokkeren vaak "lege" user agents → altijd zetten
    "User-Agent": "FreeTheMap/1.0 (local dev; contact: you@example.com)",
    "Accept": "application/json",
}

# -----------------------------
# 1) Wikipedia template → lijst met linked titles
# -----------------------------

NOISE_TITLES = set([
    "Netherlands national football team",
    "FIFA World Cup",
    "UEFA European Championship",
    "Netherlands",
    "Association football",
    "Football",
])

def wiki_template_links(template_title: str) -> List[str]:
    """
    Haalt alle links uit een Wikipedia template (parse endpoint).
    Let op: Wikipedia kan 403 geven zonder User-Agent.
    """
    params = {
        "action": "parse",
        "page": template_title,
        "prop": "links",
        "format": "json",
        "redirects": 1,
    }
    r = requests.get(WIKI_API, params=params, headers=HEADERS, timeout=30)
    r.raise_for_status()
    data = r.json()

    if "error" in data:
        return []

    links = data.get("parse", {}).get("links", [])
    titles: List[str] = []

    for l in links:
        # ns=0 => main article namespace
        if l.get("ns") != 0:
            continue
        title = l.get("*")
        if not title:
            continue
        if title in NOISE_TITLES:
            continue

        titles.append(title)

    # unique + stable order
    seen = set()
    out: List[str] = []
    for t in titles:
        if t not in seen:
            seen.add(t)
            out.append(t)
    return out


def build_oranje_squad_templates(from_year: int = 1990) -> List[Dict[str, Any]]:
    world_cups = [1990, 1994, 1998, 2002, 2006, 2010, 2014, 2018, 2022]
    euros     = [1992, 1996, 2000, 2004, 2008, 2012, 2016, 2020, 2024]

    events: List[Dict[str, Any]] = []

    for y in world_cups:
        if y < from_year:
            continue
        events.append({
            "kind": "WC",
            "year": y,
            "template": f"Template:Netherlands squad {y} FIFA World Cup",
        })

    for y in euros:
        if y < from_year:
            continue
        events.append({
            "kind": "EURO",
            "year": y,
            "template": f"Template:Netherlands squad UEFA Euro {y}",
        })

    return events


# -----------------------------
# 2) Wikipedia title → Wikidata QID (via pageprops / pageprops.wikibase_item)
# -----------------------------

def wiki_title_to_qid(title: str) -> Optional[str]:
    params = {
        "action": "query",
        "format": "json",
        "titles": title,
        "prop": "pageprops",
        "ppprop": "wikibase_item",
        "redirects": 1,
    }
    r = requests.get(WIKI_API, params=params, headers=HEADERS, timeout=30)
    r.raise_for_status()
    data = r.json()

    pages = data.get("query", {}).get("pages", {})
    for _, p in pages.items():
        props = p.get("pageprops", {})
        qid = props.get("wikibase_item")
        if qid:
            return qid
    return None


# -----------------------------
# 3) Wikidata SPARQL: player details + clubs with qualifiers
# -----------------------------

def sparql(query: str) -> Dict[str, Any]:
    r = requests.get(
        WD_SPARQL,
        params={"format": "json", "query": query},
        headers=HEADERS,
        timeout=45,
    )
    r.raise_for_status()
    return r.json()


def is_footballer(qid: str) -> bool:
    """
    Filter rommel (coach pages, captain page, etc.)
    We check: instance of human (Q5) AND has position (P413) OR occupation footballer (Q937857)
    """
    q = f"""
    SELECT ?item WHERE {{
      VALUES ?item {{ wd:{qid} }}
      ?item wdt:P31 wd:Q5 .
      OPTIONAL {{ ?item wdt:P106 wd:Q937857 . }}
      OPTIONAL {{ ?item wdt:P413 ?pos . }}
      FILTER(BOUND(?pos) || EXISTS {{ ?item wdt:P106 wd:Q937857 }})
    }} LIMIT 1
    """
    data = sparql(q)
    bindings = data.get("results", {}).get("bindings", [])
    return len(bindings) > 0


def wd_player_details(qid: str) -> Dict[str, Any]:
    """
    Haalt: position, birthPlace label, birthCountry label, citizenship label.
    """
    q = f"""
    SELECT
      ?posLabel
      ?birthPlaceLabel
      ?birthCountryLabel
      ?citizenshipLabel
    WHERE {{
      VALUES ?item {{ wd:{qid} }}

      OPTIONAL {{ ?item wdt:P413 ?pos . }}
      OPTIONAL {{ ?item wdt:P19 ?birthPlace . }}
      OPTIONAL {{ ?birthPlace wdt:P17 ?birthCountry . }}
      OPTIONAL {{ ?item wdt:P27 ?citizenship . }}

      SERVICE wikibase:label {{
        bd:serviceParam wikibase:language "en".
        ?pos rdfs:label ?posLabel .
        ?birthPlace rdfs:label ?birthPlaceLabel .
        ?birthCountry rdfs:label ?birthCountryLabel .
        ?citizenship rdfs:label ?citizenshipLabel .
      }}
    }}
    """
    data = sparql(q)
    b = data.get("results", {}).get("bindings", [])

    # Pak 1e resultaat (kan duplicates hebben)
    pos = None
    birth_place = None
    birth_country = None
    citizen = None

    if b:
        row = b[0]
        pos = row.get("posLabel", {}).get("value")
        birth_place = row.get("birthPlaceLabel", {}).get("value")
        birth_country = row.get("birthCountryLabel", {}).get("value")
        citizen = row.get("citizenshipLabel", {}).get("value")

    # birthCountry heeft prioriteit, anders citizenship
    birth_country_final = birth_country or citizen

    return {
        "position": pos,
        "birthPlace": birth_place,
        "birthCountry": birth_country_final,
    }

def commons_file_url(filename: Optional[str]) -> Optional[str]:
    if not filename:
        return None
    return "https://commons.wikimedia.org/wiki/Special:FilePath/" + urllib.parse.quote(filename)

def parse_wkt_point(wkt: Optional[str]) -> Tuple[Optional[float], Optional[float]]:
    # WKT: "Point(4.891 52.373)" => lon lat
    if not wkt:
        return (None, None)
    wkt = wkt.strip()
    if not wkt.lower().startswith("point(") or not wkt.endswith(")"):
        return (None, None)
    inside = wkt[wkt.find("(") + 1 : -1].strip()
    parts = inside.split()
    if len(parts) != 2:
        return (None, None)
    try:
        lng = float(parts[0])
        lat = float(parts[1])
        return (lat, lng)
    except:
        return (None, None)


def wd_player_clubs(qid: str) -> List[Dict[str, Any]]:
    """
    Clubs via P54 + qualifiers P580/P582.
    Verrijkt met:
      - stadium: club home venue (P115)
      - coords: eerst stadion coord (P625), anders club coord (P625)
      - clubLogo: logo image (P154), fallback image (P18) => commons url
    """
    q = f"""
    SELECT
      ?clubLabel ?startYear ?endYear ?clubCountryLabel
      ?venueLabel ?venueCoord ?clubCoord
      ?logo ?image
    WHERE {{
      VALUES ?item {{ wd:{qid} }}

      ?item p:P54 ?st .
      ?st ps:P54 ?club .

      OPTIONAL {{
        ?st pq:P580 ?start .
        BIND(YEAR(?start) AS ?startYear)
      }}
      OPTIONAL {{
        ?st pq:P582 ?end .
        BIND(YEAR(?end) AS ?endYear)
      }}

      OPTIONAL {{ ?club wdt:P17 ?clubCountry . }}

      # stadion / home venue + coord
      OPTIONAL {{
        ?club wdt:P115 ?venue .
        OPTIONAL {{ ?venue wdt:P625 ?venueCoord . }}
      }}

      # fallback club coords
      OPTIONAL {{ ?club wdt:P625 ?clubCoord . }}

      # logo / image
      OPTIONAL {{ ?club wdt:P154 ?logo . }}
      OPTIONAL {{ ?club wdt:P18  ?image . }}

      SERVICE wikibase:label {{
        bd:serviceParam wikibase:language "en".
        ?club rdfs:label ?clubLabel .
        ?clubCountry rdfs:label ?clubCountryLabel .
        ?venue rdfs:label ?venueLabel .
      }}
    }}
    """

    data = sparql(q)
    out: List[Dict[str, Any]] = []

    for row in data.get("results", {}).get("bindings", []):
        club = row.get("clubLabel", {}).get("value")
        start = row.get("startYear", {}).get("value")
        end = row.get("endYear", {}).get("value")
        club_country = row.get("clubCountryLabel", {}).get("value")
        stadium = row.get("venueLabel", {}).get("value")

        if not start:
            continue
        try:
            start_i = int(start)
        except:
            continue

        end_i: Optional[int] = None
        if end:
            try:
                end_i = int(end)
            except:
                end_i = None

        # coords: eerst venueCoord, anders clubCoord
        venue_wkt = row.get("venueCoord", {}).get("value")
        club_wkt = row.get("clubCoord", {}).get("value")

        lat, lng = parse_wkt_point(venue_wkt) if venue_wkt else (None, None)
        if lat is None or lng is None:
            lat, lng = parse_wkt_point(club_wkt)

        latlng = [lat, lng] if (lat is not None and lng is not None) else None

        # logo (bestandsnaam)
        logo_name = row.get("logo", {}).get("value") or row.get("image", {}).get("value")
        club_logo_url = commons_file_url(logo_name)

        out.append({
            "club": club,
            "from": start_i,
            "to": end_i,
            "country": club_country,
            "stadium": stadium,
            "lat": lat,
            "lng": lng,
            "latlng": latlng,
            "clubLogo": club_logo_url,
        })

    out.sort(key=lambda x: x.get("from", 0))
    return out


# -----------------------------
# 4) Build tournaments in jouw format
# -----------------------------

def tournament_from_key(key: str, year: int, kind: str, player_objs: List[Dict[str, Any]]) -> Dict[str, Any]:
    name = f"FIFA World Cup {year}" if kind == "WC" else f"UEFA Euro {year}"
    return {
        "year": year,
        "name": name,
        "host": None,
        "result": None,
        "coach": None,
        "players": player_objs,
    }


def collect_squads(from_year: int = 1990) -> List[Tuple[str, int, str, List[str]]]:
    """
    Returns list of (key, year, kind, titles)
    """
    events = build_oranje_squad_templates(from_year)
    out: List[Tuple[str, int, str, List[str]]] = []

    for e in events:
        key = f"{e['kind']}_{e['year']}"
        titles = wiki_template_links(e["template"])
        print(f"== {key} == {e['template']}")
        print(f"  links: {len(titles)}")
        out.append((key, e["year"], e["kind"], titles))

        time.sleep(0.2)

    return out


def build_data_json(from_year: int = 1990, sleep_sparql: float = 0.25) -> Dict[str, Any]:
    squads = collect_squads(from_year)
    tournaments: List[Dict[str, Any]] = []

    for key, year, kind, titles in squads:
        if not titles:
            continue

        players: List[Dict[str, Any]] = []
        seen_qids = set()

        for idx, title in enumerate(titles):
            # title → qid
            qid = wiki_title_to_qid(title)
            time.sleep(0.1)

            if not qid:
                continue
            if qid in seen_qids:
                continue
            seen_qids.add(qid)

            # filter: only actual footballer-ish people
            try:
                ok = is_footballer(qid)
            except Exception:
                ok = False

            time.sleep(sleep_sparql)

            if not ok:
                continue

            # details
            try:
                details = wd_player_details(qid)
            except Exception:
                details = {"position": None, "birthPlace": None, "birthCountry": None}

            time.sleep(sleep_sparql)

            # clubs
            try:
                clubs = wd_player_clubs(qid)
            except Exception:
                clubs = []

            time.sleep(sleep_sparql)

            players.append({
                "id": f"{key}-{qid}",
                "name": title,
                "position": details.get("position"),
                "birthCountry": details.get("birthCountry"),
                # (extra, je UI negeert dit nu, maar is handig)
                "birthPlace": details.get("birthPlace"),
                "clubs": clubs,
            })

            print(f"  + {title} ({qid}) clubs={len(clubs)}")

        print(f"  spelers gefilterd: {len(players)}")

        tournaments.append(tournament_from_key(key, year, kind, players))

    tournaments.sort(key=lambda t: int(t["year"]))
    return {"tournaments": tournaments}


if __name__ == "__main__":
    data = build_data_json(from_year=1990)

    out_path = "data.json"  # je draait script in /js, dus dit komt in js/data.json
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"✅ data.json generated: {out_path} (tournaments={len(data.get('tournaments', []))})")
