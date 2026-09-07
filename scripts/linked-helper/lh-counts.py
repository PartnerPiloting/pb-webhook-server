#!/usr/bin/env python3
"""Row count for every table in a Linked Helper database, as JSON.

Used to prove a backup round trip lost nothing: count before, count after,
compare the whole map. A corrupt restore would be obvious; a subtly INCOMPLETE
one would not, and that is the failure worth catching.

  lh-counts.py <lh.db> <out.json>
  lh-counts.py compare <before.json> <after.json>
"""
import json
import sqlite3
import sys


def counts(db_path):
    con = sqlite3.connect("file:%s?mode=ro" % db_path, uri=True)
    cur = con.cursor()
    tables = [r[0] for r in cur.execute(
        "select name from sqlite_master where type='table' "
        "and name not like 'sqlite_%' order by name")]
    out = {}
    for t in tables:
        try:
            out[t] = cur.execute('select count(*) from "%s"' % t).fetchone()[0]
        except Exception as e:
            out[t] = "ERROR: %s" % e
    con.close()
    return out


def compare(a_path, b_path):
    a = json.load(open(a_path))
    b = json.load(open(b_path))
    only_a = sorted(set(a) - set(b))
    only_b = sorted(set(b) - set(a))
    diff = {k: (a[k], b[k]) for k in sorted(set(a) & set(b)) if a[k] != b[k]}

    total_a = sum(v for v in a.values() if isinstance(v, int))
    total_b = sum(v for v in b.values() if isinstance(v, int))
    print("tables before: %d, after: %d" % (len(a), len(b)))
    print("rows   before: %d, after: %d" % (total_a, total_b))
    if only_a:
        print("TABLES LOST      : %s" % ", ".join(only_a))
    if only_b:
        print("TABLES APPEARED  : %s" % ", ".join(only_b))
    if diff:
        print("ROW COUNTS DIFFER in %d table(s):" % len(diff))
        for k, (x, y) in list(diff.items())[:40]:
            print("   %-42s %s -> %s" % (k, x, y))
    if not only_a and not only_b and not diff:
        print("VERDICT: identical - every table present, every row count unchanged")
        return 0
    print("VERDICT: DIFFERENCES FOUND (see above)")
    return 1


if __name__ == "__main__":
    if sys.argv[1] == "compare":
        sys.exit(compare(sys.argv[2], sys.argv[3]))
    result = counts(sys.argv[1])
    json.dump(result, open(sys.argv[2], "w"), indent=1, sort_keys=True)
    ints = [v for v in result.values() if isinstance(v, int)]
    print("counted %d tables, %d rows total -> %s" % (len(result), sum(ints), sys.argv[2]))
