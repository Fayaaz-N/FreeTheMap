import json
import requests
import time

WIKIPEDIA_SQUADS = {
    2002: "Netherlands_at_the_2002_FIFA_World_Cup",
    2006: "Netherlands_at_the_2006_FIFA_World_Cup",
    2010: "Netherlands_at_the_2010_FIFA_World_Cup",
    2014: "Netherlands_at_the_2014_FIFA_World_Cup",
    2022: "Netherlands_at_the_2022_FIFA_World_Cup",
}

WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql"
HEADERS = {
    "User-Agent": "FreeTheMap school project (contact: student@example.com)"
}


def sparql(query):
    response = requests.get(
        WIKIDATA_ENDPOINT,
        headers=HEADERS,
        params={"format": "json", "query": query},
        timeout=30,
    )
    response.raise_for_status()
    return response.json()["results"]["bindings"]


def get_player_clubs(player_qid):
    query = f"""
    SELECT ?clubLabel ?start ?end ?logo ?lat ?lon WHERE {{
      wd:{player_qid} p:P54 ?st .
      ?st ps:P54 ?club .
      OPTIONAL {{ ?st pq:P580 ?start . }}
      OPTIONAL {{ ?st pq:P582 ?end . }}
      OPTIONAL {{ ?club wdt:P154 ?logo . }}
      OPTIONAL {{
        ?club wdt:P625 ?coord .
        BIND(geof:latitude(?coord) AS ?lat)
        BIND(geof:longitude(?coord) AS ?lon)
      }}
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en,nl". }}
    }}
    ORDER BY ?start
    """

    rows = sparql(query)
    clubs = []

    for r in rows:
        clubs.append({
            "club": r["clubLabel"]["value"],
            "from": int(r["start"]["value"][:4]) if "start" in r else None,
            "to": int(r["end"]["value"][:4]) if "end" in r else None,
            "latlng": (
                [float(r["lat"]["value"]), float(r["lon"]["value"])]
                if "lat" in r and "lon" in r else None
            ),
            "clubLogo": (
                "https://commons.wikimedia.org/wiki/Special:FilePath/"
                + r["logo"]["value"].split("/")[-1]
                if "logo" in r else None
            ),
        })

    return clubs


def get_squad_players_nl():
    query = """
    SELECT DISTINCT ?player ?playerLabel ?year WHERE {
      ?appearance wdt:P641 wd:Q2736 ;
                  wdt:P1414 wd:Q19317 ;
                  wdt:P585 ?date .
      ?appearance wdt:P710 wd:Q55 .
      BIND(YEAR(?date) AS ?year)
      ?player wdt:P27 wd:Q55 .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en,nl". }
    }
    """

    return sparql(query)


def main():
    output = {
        "dataset": "Netherlands World Cup squads (auto-generated)",
        "tournaments": []
    }

    for year in sorted(WIKIPEDIA_SQUADS.keys()):
        print(f"Processing {year}...")
        players = []

        squad = get_squad_players_nl()

        for p in squad:
            if int(p["year"]["value"]) != year:
                continue

            name = p["playerLabel"]["value"]
            qid = p["player"]["value"].split("/")[-1]

            print("  ", name)
            clubs = get_player_clubs(qid)

            players.append({
                "id": f"{name.lower().replace(' ', '-')}-{year}",
                "name": name,
                "clubs": clubs
            })

            time.sleep(0.25)

        if players:
            output["tournaments"].append({
                "year": year,
                "name": f"FIFA World Cup {year}",
                "players": players
            })

    with open("data.json", "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print("✅ data.json generated successfully")


if __name__ == "__main__":
    main()
