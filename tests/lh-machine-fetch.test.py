"""The machine fetching a file from a share link (scripts/linked-helper/lh-clipboard.py).

The service is stood in for - what is tested is what the machine KEEPS, what it turns away, and
what it says about it, since that sentence is what the person is told.

Run: python tests/lh-machine-fetch.test.py
"""
import importlib.util
import io
import json
import os
import sys
import tempfile
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    "lh_clipboard", os.path.join(HERE, "..", "scripts", "linked-helper", "lh-clipboard.py"))
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)

failures = 0


def check(name, fn):
    global failures
    try:
        fn()
        print("  ok  " + name)
    except AssertionError as e:
        failures += 1
        print("  FAIL " + name + "\n       " + str(e))


def export_bytes(account=571651, pad=2000):
    hdr = json.dumps({"linkedInAccountId": account, "version": "2.130.47", "size": pad}).encode()
    return len(hdr).to_bytes(4, "little") + hdr + b"PK\x03\x04" + b"\x00" * pad


class Reply(io.BytesIO):
    def __init__(self, body, headers=None, url="https://dl.dropboxusercontent.com/x/roland.lhd2"):
        super().__init__(body)
        self.headers = headers or {}
        self._url = url

    def geturl(self):
        return self._url


class Service:
    """Stands in for OneDrive / Drive / Dropbox."""

    def __init__(self, reply=None, error=None):
        self.reply, self.error = reply, error

    def open(self, req, timeout=None):
        if self.error:
            raise self.error
        return self.reply


def refused(fn, words):
    try:
        fn()
    except agent.Refused as e:
        assert words in str(e), "refused, but said: %s" % e
        return
    raise AssertionError("was not refused")


def keeps_a_real_export():
    d = tempfile.mkdtemp()
    body = export_bytes()
    r = agent.fetch("https://x", folder=d, opener=Service(Reply(body, {"Content-Disposition": 'attachment; filename="roland export.lhd2"'})))
    assert r["ok"] and r["kind"] == "linked-helper-export" and r["account"] == "571651", r
    assert r["bytes"] == len(body) and r["name"] == "roland export.lhd2", r
    assert os.listdir(d) == ["roland export.lhd2"], os.listdir(d)      # and no .part left behind


def names_it_by_what_it_is():
    d = tempfile.mkdtemp()
    r = agent.fetch("https://x", folder=d, opener=Service(Reply(export_bytes(), {"Content-Disposition": 'attachment; filename="backup.exe"'})))
    assert r["name"] == "backup.lhd2", r
    assert not os.access(os.path.join(d, r["name"]), os.X_OK) or os.name == "nt"


def keeps_a_csv():
    d = tempfile.mkdtemp()
    r = agent.fetch("https://x", folder=d, opener=Service(Reply(b"name,profile\nA,https://linkedin.com/in/a\n", url="https://x/list.csv")))
    assert r["kind"] == "csv" and r["name"] == "list.csv", r


def a_sign_in_page_is_said_to_be_one():
    d = tempfile.mkdtemp()
    page = b"<!DOCTYPE html><html><head><title>Sign in</title></head><body>Sign in to continue</body></html>"
    refused(lambda: agent.fetch("https://x", folder=d, opener=Service(Reply(page))), "needs a sign-in")
    assert os.listdir(d) == [], "the web page was kept: %s" % os.listdir(d)
    for code in (401, 403):
        err = urllib.error.HTTPError("https://x", code, "no", {}, None)
        refused(lambda: agent.fetch("https://x", folder=d, opener=Service(error=err)), "needs a sign-in")


def other_things_are_not_kept():
    d = tempfile.mkdtemp()
    refused(lambda: agent.fetch("https://x", folder=d, opener=Service(Reply(b"MZ\x90\x00\x03\x00\x00\x00" + b"\x00" * 500))), "was not kept")
    refused(lambda: agent.fetch("https://x", folder=d, opener=Service(Reply(b"#!/bin/sh\nrm -rf /\n"))), "was not kept")
    refused(lambda: agent.fetch("https://x", folder=d, opener=Service(Reply(b""))), "empty")
    err = urllib.error.HTTPError("https://x", 404, "gone", {}, None)
    refused(lambda: agent.fetch("https://x", folder=d, opener=Service(error=err)), "no file at that link")
    assert os.listdir(d) == [], os.listdir(d)


def too_big_is_stopped():
    d = tempfile.mkdtemp()
    refused(lambda: agent.fetch("https://x", folder=d, opener=Service(Reply(b"x", {"Content-Length": str(agent.MAX_FILE_BYTES + 1)}))), "bigger than")
    old = agent.MAX_FILE_BYTES
    agent.MAX_FILE_BYTES = 1000
    try:       # a service that does not say how big it is still hits the wall
        refused(lambda: agent.fetch("https://x", folder=d, opener=Service(Reply(export_bytes(pad=5000)))), "bigger than")
    finally:
        agent.MAX_FILE_BYTES = old
    assert os.listdir(d) == [], os.listdir(d)


def a_name_cannot_leave_the_folder():
    assert agent.safe_name("../../etc/cron.d/evil") == "evil"
    assert agent.safe_name("..\\..\\windows\\evil.lhd2") == "evil.lhd2"
    assert agent.safe_name("/etc/passwd") == "passwd"
    assert agent.safe_name("") == "file-from-link"
    assert agent.safe_name("...") == "file-from-link"
    assert "/" not in agent.safe_name("a/b;c|d.lhd2") and "|" not in agent.safe_name("a/b;c|d.lhd2")


def a_second_file_does_not_replace_the_first():
    d = tempfile.mkdtemp()
    hdr = {"Content-Disposition": 'attachment; filename="roland.lhd2"'}
    agent.fetch("https://x", folder=d, opener=Service(Reply(export_bytes(), hdr)))
    second = agent.fetch("https://x", folder=d, opener=Service(Reply(export_bytes(pad=3000), hdr)))
    assert len(os.listdir(d)) == 2 and second["name"] != "roland.lhd2", os.listdir(d)


def only_the_three_services_over_https():
    for ok in ("https://www.dropbox.com/s/a/x.lhd2?dl=1", "https://drive.usercontent.google.com/download?id=1",
               "https://api.onedrive.com/v1.0/shares/u!abc/root/content", "https://gracex-my.sharepoint.com/:u:/g/x?download=1"):
        assert agent.accepted_host(ok), ok
    for no in ("http://www.dropbox.com/s/a/x.lhd2", "https://example.com/x.lhd2", "https://dropbox.com.evil.example/x",
               "https://evilsharepoint.com/x", "file:///etc/passwd", "", None):
        assert not agent.accepted_host(no), no


def a_job_from_anywhere_else_is_refused_and_reported():
    sent = []
    agent.report_file = lambda conf, job_id, report: sent.append((job_id, report))
    agent.fetch_job({}, {"id": "f1", "url": "https://example.com/x.lhd2", "share_url": "https://example.com/x.lhd2"})
    assert sent and sent[0][0] == "f1" and sent[0][1]["ok"] is False, sent
    assert "OneDrive, Google Drive or Dropbox" in sent[0][1]["error"], sent


check("a real Linked Helper export is kept, and its account read from it", keeps_a_real_export)
check("it is named for what it IS, whatever the link called it", names_it_by_what_it_is)
check("a CSV is kept", keeps_a_csv)
check("a sign-in page is refused and said to be one", a_sign_in_page_is_said_to_be_one)
check("programs, scripts, empty files and dead links are not kept", other_things_are_not_kept)
check("a file that is too big is stopped, declared or not", too_big_is_stopped)
check("a file name cannot leave the Downloads folder", a_name_cannot_leave_the_folder)
check("a second file does not replace the first", a_second_file_does_not_replace_the_first)
check("only the three services, only over https", only_the_three_services_over_https)
check("a link from anywhere else is refused and the person is told", a_job_from_anywhere_else_is_refused_and_reported)

if failures:
    print("\n%d failed" % failures)
    sys.exit(1)
print("\nall passed")
