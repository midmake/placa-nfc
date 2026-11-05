"""Apply only the additive Pix migration to the configured Gear Go database."""
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import urllib.request

DB = "bc6f8a86-9019-4fbb-ba3f-eaaf79d5378e"
FILE = Path("migrations/0004_pix_links.sql")
def require(ok, msg):
    if not ok:
        raise RuntimeError(msg)

def main():
    require(os.environ.get("GITHUB_REPOSITORY") == "midmake/placa-nfc" and os.environ.get("GITHUB_REF") == "refs/heads/main", "Unexpected repository or branch")
    account = os.environ["CLOUDFLARE_ACCOUNT_ID"]
    require(re.fullmatch(r"[0-9a-fA-F]{32}", account), "Invalid account configuration")
    base = f"https://api.cloudflare.com/client/v4/accounts/{account}/d1/database/{DB}"
    def api(path, body=None):
        req = urllib.request.Request(base+path, data=json.dumps(body).encode() if body is not None else None, headers={"Authorization":"Bearer "+os.environ["CLOUDFLARE_API_TOKEN"], "Content-Type":"application/json"})
        try:
            with urllib.request.urlopen(req,timeout=60) as res:
                obj=json.load(res)
        except Exception:
            raise RuntimeError("Cloudflare request failed; response suppressed") from None
        require(obj.get("success"), "Cloudflare request unsuccessful")
        return obj["result"]
    def query(sql):
        result=api("/query",{"sql":sql})
        require(len(result)==1 and result[0].get("success"), "SQL check failed")
        return result[0]["results"]
    info=api("")
    require(info.get("name")=="placa-nfc" and info.get("uuid")==DB,"Wrong database")
    legacy={"0002_operations","0003_professional_users"}
    marker="0004_pix_links"
    def markers():
        return {r["version"] for r in query("SELECT version FROM schema_versions")}
    def definition():
        return query("SELECT type,sql FROM sqlite_master WHERE name='pix_links'")
    # This new table is created only by this file. Compare its full constraints.
    reference=sqlite3.connect(":memory:")
    reference.execute("CREATE TABLE schema_versions(version TEXT PRIMARY KEY)")
    reference.executescript(FILE.read_text())
    expected=reference.execute("SELECT sql FROM sqlite_master WHERE name='pix_links'").fetchone()[0]
    def verify():
        require(markers()==legacy|{marker} and definition()==[{"type":"table","sql":expected}], "Pix schema or marker diverges; stopping")
    if marker in markers() or definition():
        verify()
        print("Pix schema already verified. No writes.")
        return
    require(markers()==legacy, "Unexpected migration stage")
    require(query("PRAGMA quick_check")==[{"quick_check":"ok"}] and not query("PRAGMA foreign_key_check"), "Integrity check failed")
    bookmark=api("/time_travel/bookmark").get("bookmark")
    require(bookmark,"Recovery point unavailable")
    print("D1 recovery bookmark before Pix migration:",bookmark,flush=True)
    # The remote file import is transactional. Never run generic migrations apply.
    result=subprocess.run(["node_modules/.bin/wrangler","d1","execute","DB","--remote","--file",str(FILE),"--yes"],capture_output=True)
    require(result.returncode==0,"Pix migration failed; deployment stopped")
    verify()
    require(not query("PRAGMA foreign_key_check"),"Foreign key check failed")
    print("0004_pix_links verified. No existing client or plate records updated.")
if __name__=="__main__":
    main()
