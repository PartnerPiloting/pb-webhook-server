"""Who goes into "My own connections" tonight when Wingguy has fill-ins waiting
(scripts/linked-helper/lh-own-connections.py, plan_tonight + clean_slug, 27 Nov 2026).

A contact the client made into a lead is visited AHEAD of the nightly picks - they chose that
person by hand - but inside the same nightly cap, and nobody goes in twice.

Run: python tests/lh-own-connections-fill-ins.test.py
"""
import importlib.util
import os
import sys
import types

# the script locks with fcntl, which only exists on the machines it runs on
sys.modules.setdefault("fcntl", types.ModuleType("fcntl"))

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    "lh_own", os.path.join(HERE, "..", "scripts", "linked-helper", "lh-own-connections.py"))
own = importlib.util.module_from_spec(spec)
spec.loader.exec_module(own)

failures = 0


def check(name, fn):
    global failures
    try:
        fn()
        print("  ok  " + name)
    except AssertionError as e:
        failures += 1
        print("  FAIL " + name + "\n       " + str(e))


def people(*slugs):
    return [{"person_id": i, "connected_at": 1000 + i, "slug": s} for i, s in enumerate(slugs)]


def slugs(ps):
    return [p["slug"] for p in ps]


def t_slug():
    assert own.clean_slug("https://www.linkedin.com/in/Pat-Lee/?trk=x") == "pat-lee"
    assert own.clean_slug("pat-lee") == "pat-lee"
    assert own.clean_slug("https://www.linkedin.com/in/pat-lee#about") == "pat-lee"
    assert own.clean_slug("") == ""
    assert own.clean_slug(None) == ""
    assert own.clean_slug("https://www.linkedin.com/company/acme") == ""


def t_no_fill_ins_is_as_before():
    fill, tonight, later = own.plan_tonight([], people("a", "b", "c"), 2)
    assert fill == []
    assert slugs(tonight) == ["a", "b"] and slugs(later) == ["c"]


def t_fill_ins_go_first_inside_the_cap():
    fill, tonight, later = own.plan_tonight(["x", "y"], people("a", "b", "c"), 3)
    assert fill == ["x", "y"]
    assert slugs(tonight) == ["a"] and slugs(later) == ["b", "c"]


def t_more_fill_ins_than_the_cap():
    fill, tonight, later = own.plan_tonight(["x", "y", "z"], people("a"), 2)
    assert fill == ["x", "y"], "the third waits - the server offers it again tomorrow"
    assert tonight == [] and slugs(later) == ["a"]


def t_nobody_twice():
    fill, tonight, later = own.plan_tonight(
        ["https://www.linkedin.com/in/A/", "a", "", "not a/slug"], people("a", "b"), 5)
    assert fill == ["a"]
    assert slugs(tonight) == ["b"] and later == []


def t_cap_of_nothing():
    fill, tonight, later = own.plan_tonight(["x"], people("a"), 0)
    assert fill == [] and tonight == [] and slugs(later) == ["a"]


print("lh-own-connections fill-ins tests")
check("a profile address or a bare slug becomes the slug; anything else is dropped", t_slug)
check("no fill-ins: the picks go exactly as before", t_no_fill_ins_is_as_before)
check("fill-ins go first, and the picks take what is left of the cap", t_fill_ins_go_first_inside_the_cap)
check("more fill-ins than the cap: the rest wait for tomorrow", t_more_fill_ins_than_the_cap)
check("the same person asked for twice, or also picked, goes in once", t_nobody_twice)
check("a cap of nothing passes nobody", t_cap_of_nothing)
print("\nall passed" if not failures else "\n%d FAILED" % failures)
sys.exit(1 if failures else 0)
