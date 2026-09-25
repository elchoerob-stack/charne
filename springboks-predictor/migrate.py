"""Copy the office predictor's games, picks and results to its own Firebase project.

Reads every match tagged app:"cms" from the shared sa-predictions project and
creates it, unchanged, in the new project. Nothing is deleted anywhere; run
verify afterwards, then clean up the old project separately.

    python migrate.py copy   <NEW_PROJECT_ID> <NEW_API_KEY>
    python migrate.py verify <NEW_PROJECT_ID> <NEW_API_KEY>

Uses only the Python standard library and the public Firestore REST API, so the
new project's rules must allow create on /matches (the bundled firestore.rules do).
"""
import json, sys, urllib.request, urllib.error

OLD_PROJECT = "sa-predictions"
OLD_KEY = "AIzaSyA2eY7QWAlVMg2zohWVHMWWBZSHK2lMtdE"

def base(project):
    return f"https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/documents/matches"

def list_cms(project, key):
    docs, token = [], ""
    while True:
        url = f"{base(project)}?pageSize=300&key={key}" + (f"&pageToken={token}" if token else "")
        data = json.load(urllib.request.urlopen(url))
        docs += data.get("documents", [])
        token = data.get("nextPageToken")
        if not token:
            break
    return {d["name"].rsplit("/", 1)[1]: d["fields"] for d in docs
            if d["fields"].get("app", {}).get("stringValue") == "cms"}

def copy(project, key):
    src = list_cms(OLD_PROJECT, OLD_KEY)
    print(f"{len(src)} office games in {OLD_PROJECT}")
    for doc_id, fields in sorted(src.items()):
        req = urllib.request.Request(f"{base(project)}?documentId={doc_id}&key={key}",
            data=json.dumps({"fields": fields}).encode(),
            headers={"Content-Type": "application/json"}, method="POST")
        try:
            urllib.request.urlopen(req)
            print("  copied", doc_id)
        except urllib.error.HTTPError as e:
            print("  FAILED", doc_id, e.code, e.read()[:200])

def verify(project, key):
    src, dst = list_cms(OLD_PROJECT, OLD_KEY), list_cms(project, key)
    ok = True
    for doc_id, fields in sorted(src.items()):
        picks = len(fields.get("p", {}).get("mapValue", {}).get("fields", {}) or {})
        match = dst.get(doc_id) == fields
        ok &= match
        print(f"  {doc_id:10} picks {picks:3}  {'same' if match else 'DIFFERENT / MISSING'}")
    print("ALL MATCH" if ok and len(src) == len(dst) else "NOT MATCHING — do not switch the app yet")

if __name__ == "__main__":
    cmd, project, key = sys.argv[1:4]
    {"copy": copy, "verify": verify}[cmd](project, key)
