"""Fail-closed D1 upgrade. Secrets stay in environment; row data stays in memory."""
import hashlib, json, os, re, sqlite3, subprocess, sys, urllib.request
from pathlib import Path

DB = 'bc6f8a86-9019-4fbb-ba3f-eaaf79d5378e'
FILES = ['0001_initial.sql', '0002_operations.sql', '0003_professional_users.sql']

def require(ok, message):
    if not ok:
        raise RuntimeError(message)

def schema(query):
    return {(r['type'], r['name']): re.sub(r'\s+', ' ', r['sql']).strip().rstrip(';')
            for r in query('SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL')
            if not r['name'].startswith(('sqlite_', '_cf_')) and r['name'] != 'd1_migrations'}

def expected_states():
    db = sqlite3.connect(':memory:')
    db.row_factory = sqlite3.Row
    states = []
    for file in FILES:
        # 0001 is ONLY executed in a disposable in-memory reference database.
        db.executescript(Path('migrations', file).read_text())
        states.append(schema(lambda sql: [dict(r) for r in db.execute(sql)]))
    return states

def main():
    require(os.environ.get('GITHUB_REPOSITORY') == 'midmake/placa-nfc', 'Wrong repository')
    account = os.environ.get('CLOUDFLARE_ACCOUNT_ID', '')
    token = os.environ.get('CLOUDFLARE_API_TOKEN', '')
    require(bool(re.fullmatch(r'[a-fA-F0-9]{32}', account)) and bool(token), 'Repository Secrets missing/invalid')
    base = f'https://api.cloudflare.com/client/v4/accounts/{account}/d1/database/{DB}'
    def api(path='', body=None):
        req = urllib.request.Request(base + path,
            data=json.dumps(body).encode() if body is not None else None,
            headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=120) as response:
                data = json.load(response)
        except Exception:
            raise RuntimeError('Cloudflare request failed; response body suppressed') from None
        require(data.get('success') is True, 'Cloudflare returned failure')
        return data['result']
    def query(sql):
        result = api('/query', {'sql': sql})
        require(all(r.get('success') is True for r in result), 'SQL query failed')
        return [row for r in result for row in r.get('results', [])]
    def integrity():
        require(not query('PRAGMA foreign_key_check'), 'Foreign key violation')
        rows = query('PRAGMA quick_check')
        require(len(rows) == 1 and list(rows[0].values()) == ['ok'], 'Integrity check failed')
    info = api()
    require(info.get('name') == 'placa-nfc' and info.get('uuid') == DB, 'Wrong D1 database')
    states = expected_states()
    current = schema(query)
    matches = [i for i, s in enumerate(states) if s == current]
    if len(matches) != 1:
        for i, s in enumerate(states):
            print('Schema differences versus', i + 1, sorted(k for k in set(s) | set(current) if s.get(k) != current.get(k)))
        raise RuntimeError('Partial or divergent schema; no writes performed')
    stage = matches[0]
    markers = ['0002_operations', '0003_professional_users']
    if stage:
        require({r['version'] for r in query('SELECT version FROM schema_versions')} == set(markers[:stage]), 'Version markers disagree with schema')
    integrity()
    tables = sorted(name for kind, name in current if kind == 'table')
    columns = {t: [r['name'] for r in query(f'PRAGMA table_xinfo("{t}")')] for t in tables}
    def snapshot():
        result = {}
        for table, names in columns.items():
            fields = ','.join('"' + n + '"' for n in names)
            hashes, offset = [], 0
            while True:
                rows = query(f'SELECT {fields} FROM "{table}" ORDER BY rowid LIMIT 500 OFFSET {offset}')
                hashes.extend(hashlib.sha256(json.dumps(r, sort_keys=True, separators=(',', ':')).encode()).hexdigest() for r in rows)
                if len(rows) < 500:
                    break
                offset += 500
            result[table] = sorted(hashes)
        return result
    before = snapshot()
    def unchanged():
        after = snapshot()
        if 'schema_versions' in before:
            require(set(before['schema_versions']).issubset(after['schema_versions']), 'Existing markers changed')
            after['schema_versions'] = before['schema_versions']
        require(after == before, 'Existing records changed or concurrent writes; stop')
    print('Verified initial schema stage:', stage + 1)
    print('Initial counts:', {t: len(v) for t, v in before.items()})
    for target in range(stage + 1, 3):
        require(schema(query) == states[target - 1], 'Schema changed during preflight')
        integrity()
        unchanged()
        bookmark = api('/time_travel/bookmark').get('bookmark')
        require(isinstance(bookmark, str) and bool(bookmark), 'No recovery bookmark; stop')
        print('Recovery point before', FILES[target], bookmark, flush=True)
        # Explicit immutable filename only. Never invoke migrations apply.
        result = subprocess.run(['node_modules/.bin/wrangler', 'd1', 'execute', 'DB', '--remote', '--file',
                                 'migrations/' + FILES[target], '--yes'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        require(result.returncode == 0, 'Migration failed; stop, do not deploy or retry blindly')
        require(schema(query) == states[target], 'Post-migration schema mismatch')
        integrity()
        unchanged()
        require({r['version'] for r in query('SELECT version FROM schema_versions')} == set(markers[:target]), 'Missing version marker')
        if target == 2:
            require(not query("SELECT id FROM users WHERE state<>'ACTIVE' OR commercial_type<>'EQUIPE_GEAR' OR archived_at IS NOT NULL LIMIT 1"), 'Legacy users mismatch')
            require(not query("SELECT id FROM batches WHERE product<>'GOOGLE' OR is_test<>0 OR archived_at IS NOT NULL LIMIT 1"), 'Legacy batches mismatch')
            require(not query('SELECT id FROM establishments WHERE is_test<>0 OR archived_at IS NOT NULL LIMIT 1'), 'Legacy clients mismatch')
        print(FILES[target], 'validated; original records preserved', flush=True)
    print('D1 0002: OK; D1 0003: OK; schema and foreign keys: OK')

if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print('STOP:', str(exc), file=sys.stderr)
        sys.exit(1)
