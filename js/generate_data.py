import re
import time
import json
import requests
from typing import Optional, List, Dict, Any

WIKI_TEMPLATE_URL = "https://en.wikipedia.org/wiki/Template:Netherlands_squad_{year}_FIFA_World_Cup"
WIKIDATA_API = "https://www.wikidata.org/w/api.php"

UA = {"User-Agent": "FreeTheMap/1.0 (local script; contact: none)"}

def wiki_get_oranje_squad_titles(year: int) -> List[str]:
    """
    Haalt de Wikipedia page-titles op uit de template:
    Template:Netherlands_squad_{year}_FIFA_World_Cup

    Returned: lijst met page titles (bijv. 'Johan_Cruijff')
    """
    url = WIKI_TEMPLATE_URL.format(year=year)
    r = requests.get(url, headers=UA, timeout=30)
    r.raise_for_status()
    html = r.text

    # Pak /wiki/<Title> uit de bullets op de template
    # We filteren alles wat geen speler is (Coach, c, v/t/e, etc.)
    titles = re.findall(r'href="/wiki/([^"#:%?]+)"', html)

    bad = {
        "Template", "Talk", "Main_Page", "Special:Search", "Help:Contents",
        "Netherlands_squad", "Netherlands", "FIFA_World_Cup"
    }

    cleaned = []
    for t in titles:
        if t in bad:
            continue
        # Coach staat ook als link; die wil je meestal niet als speler
        # Je kan coach apart pakken, maar voor nu filteren we niet op rol,
        # dus we doen een simpele heuristic: skip als het duidelijk geen speler-lijst item is.
        cleaned.append(t)

    # De template bevat veel navigatie-links; we willen alleen de “squad” links.
    # De truc: op de template pagina zitten spelers meestal in het blok rond “Netherlands squad – YEAR…”
    # Voor nu doen we een pragmatische aanpak: dedupe + drop obvious noise en vertrouw dat het grotendeels spelers zijn.
    # (Als je wilt, kan ik je dit 100% strak maken door HTML-sectie te isoleren.)
    cleaned = list(dict.fromkeys(cleaned))  # dedupe, behoud volgorde

    # Extra noise weghalen die vaak op templates terugkomt
    cleaned = [t for t in cleaned if not t.startswith("Category:")]
    cleaned = [t for t in cleaned if not t.startswith("File:")]
    cleaned = [t for t in cleaned if not t.startswith("Wikipedia:")]

    return cleaned

def wikidata_qid_from_enwiki_title(title: str) -> Optional[str]:
    """
    Zonder SPARQL: via wbgetentities + sites=enwiki + titles=<title>
    """
    params = {
        "action": "wbgetentities",
        "sites": "enwiki",
        "titles": title,
        "format": "json",
        "props": "info",
    }
    r = requests.get(WIKIDATA_API, params=params, headers=UA, timeout=30)
    r.raise_for_status()
    data = r.json()

    entities = data.get("entities", {})
    for k, v in entities.items():
        if k.startswith("Q"):
            return k
    return None

def wikidata_entity(qid: str) -> Dict[str, Any]:
    """
    Haal volledige entity json op.
    """
    params = {
        "action": "wbgetentities",
        "ids": qid,
        "format": "json",
        "props": "claims|labels|sitelinks",
    }
    r = requests.get(WIKIDATA_API, params=params, headers=UA, timeout=30)
    r.raise_for_status()
    return r.json()["entities"][qid]

def claim_first_entity_id(entity: Dict[str, Any], prop: str) -> Optional[str]:
    claims = entity.get("claims", {}).get(prop, [])
    if not claims:
        return None
    mainsnak = claims[0].get("mainsnak", {})
    datav = mainsnak.get("datavalue", {})
    val = datav.get("value", {})
    return val.get("id")

def claim_first_time(entity: Dict[str, Any], prop: str) -> Optional[str]:
    claims = entity.get("claims", {}).get(prop, [])
    if not claims:
        return None
    mainsnak = claims[0].get("mainsnak", {})
    datav = mainsnak.get("datavalue", {})
    val = datav.get("value", {})
    # format: "+1980-01-01T00:00:00Z"
    t = val.get("time")
    if not t:
        return None
    return t.strip("+")[:10]  # YYYY-MM-DD

def entity_label(entity: Dict[str, Any], lang: str = "en") -> str:
    return entity.get("labels", {}).get(lang, {}).get("value") or ""

def generate_oranje_for_year(year: int) -> List[Dict[str, Any]]:
    """
    Maakt een lijst spelers voor een gegeven WK jaar.
    Hier kan je straks je eigen data-structuur aan koppelen.
    """
    titles = wiki_get_oranje_squad_titles(year)
    players = []

    for title in titles:
        qid = wikidata_qid_from_enwiki_title(title)
        if not qid:
            continue

        ent = wikidata_entity(qid)

        # Basis:
        name = entity_label(ent, "en") or title.replace("_", " ")
        birth_place_qid = claim_first_entity_id(ent, "P19")   # place of birth
        birth_date = claim_first_time(ent, "P569")            # date of birth

        players.append({
            "id": qid,
            "name": name,
            "birthDate": birth_date,
            "birthPlaceQid": birth_place_qid,
            "wikiTitle": title,
            # clubs kun je hierna vullen (P54 + qualifiers) – volgende stap
        })

        time.sleep(0.1)  # lief zijn voor rate limits

    return players

if __name__ == "__main__":
    years = [2002, 2006, 2010, 2014, 2022]  # voeg hier alles toe wat je wil (ook 1974, 1978, 1990, 1994, 1998, etc.)
    out = {
        "tournaments": []
    }

    for y in years:
        print(f"Processing Oranje squad {y}…")
        squad = generate_oranje_for_year(y)
        out["tournaments"].append({
            "year": y,
            "name": f"FIFA World Cup {y}",
            "host": "",
            "result": "",
            "coach": "",
            "players": squad
        })

    with open("data.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print("✅ data.json generated with Oranje squads")
