#!/usr/bin/env python3
"""Build compact Property Appraiser permit shards from ftp_permit.zip.

Usage: python3 scripts/build-pa-permits.py /path/to/ftp_permit.zip
Output: data/pa/addr-XX.json.gz (by street-name key) and data/pa/parcel-XX.json.gz (by parcel suffix),
plus data/pa/meta.json. Re-run whenever the PA publishes a new file (daily).
"""
import csv, gzip, io, json, os, re, sys, zipfile, collections, datetime

SRC = sys.argv[1] if len(sys.argv) > 1 else "/workspace/pa/ftp_permit.zip"
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "pa")
SUFFIX = {"DR","DRIVE","ST","STREET","AVE","AVENUE","RD","ROAD","LN","LANE","CT","COURT","BLVD","CIR","CIRCLE","WAY","PL","PLACE","TER","TRL","TRAIL","PKWY","HWY","LOOP","RUN","PATH","PT","CV","XING","SQ"}
DIRS = {"N","S","E","W","NE","NW","SE","SW"}
DATE = re.compile(r"^(\d{4}-\d{2}-\d{2})")

def street_key(s):
    w = [x for x in re.sub(r"[^A-Z0-9 ]", " ", s.upper()).split() if x]
    if len(w) > 1 and w[0] in DIRS: w = w[1:]
    if len(w) > 1 and w[-1] in SUFFIX: w = w[:-1]
    return " ".join(w)

def shard(key):  # 2-char bucket
    k = re.sub(r"[^A-Z0-9]", "", key)[:2]
    return (k + "__")[:2]

def d(v):
    m = DATE.match(v or "")
    if not m or m.group(1) < "1950" or m.group(1) > "2100": return None
    return m.group(1)

def main():
    z = zipfile.ZipFile(SRC)
    name = next(n for n in z.namelist() if n.lower().endswith(".txt"))
    rdr = csv.DictReader(io.TextIOWrapper(z.open(name), encoding="latin-1", newline=""))
    by_addr, by_parcel = collections.defaultdict(list), collections.defaultdict(list)
    n = kept = 0
    for r in rdr:
        n += 1
        if r.get("SITE_APT") is None: continue  # malformed row
        agency = (r["AGENCY_NAME"] or "").strip()
        ptype = (r["PERMIT_TYPE"] or "").strip()
        num = (r["PERMIT_NUM"] or "").strip()
        if not num or agency == "POLK COUNTY PROPERTY APPRAISER": continue
        if not re.match(r"^(RES|COM|TPP)", ptype) or "INSP" in ptype: continue  # in-house PA work items
        issued = d(r["ISSUE_DT"])
        st = street_key(f'{r["SITE_PFX"]} {r["SITE_STR"]} {r["SITE_TP"]}')
        rec = [num, agency or None, ptype, (r["DSCR"] or "").strip() or None, r["STATUS_DSCR"].strip() or None,
               issued, d(r["FINAL_DT"]), d(r["CO_DT"]), int(r["EST_VAL"]) if (r["EST_VAL"] or "").isdigit() and int(r["EST_VAL"]) > 0 else None,
               r["PARCEL_ID"].strip(), (r["SITE_NUM"] or "").strip(), " ".join(f'{r["SITE_PFX"]} {r["SITE_STR"]} {r["SITE_TP"]}'.split()), st]
        kept += 1
        if st: by_addr[shard(st)].append(rec)
        by_parcel[r["PARCEL_ID"].strip()[-2:]].append(rec)
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT): os.remove(os.path.join(OUT, f))
    for prefix, groups in (("addr", by_addr), ("parcel", by_parcel)):
        for k, recs in groups.items():
            with gzip.open(os.path.join(OUT, f"{prefix}-{k}.json.gz"), "wt", encoding="utf-8") as fh:
                json.dump(recs, fh, separators=(",", ":"))
    meta = {"source": "Polk County Property Appraiser ftp_permit", "built": datetime.date.today().isoformat(),
            "rows": n, "kept": kept,
            "fields": ["permit","agency","type","desc","status","issued","final","co","value","parcel","siteNum","street","streetKey"]}
    json.dump(meta, open(os.path.join(OUT, "meta.json"), "w"), indent=1)
    print(meta)

main()
