"""Reading "is LinkedIn signed in?" off the Linked Helper window title
(scripts/linked-helper/lh-watchdog.py and lh-first-run.py, linkedin_state).

The title ends with the page Linked Helper's browser is on. It only says "LinkedIn logged in"
on a page with no name of its own; mid-task it names the page - LinkedIn "Veronica Mesce" profile
page - and the watchdog read that as LOGGED OUT. On 5 Oct 2026 Machine Status told Guy that his
own machine and Sam Noble's were logged out while both were working.

The wordings below are Linked Helper's own, read out of its program (2.130.55) on 6 Oct 2026.
The rule: LOGGED OUT only when the title SAYS so, and "unknown" for anything not recognised.
Both scripts carry a copy of the reader, so this also fails if the copies ever disagree.

Run: python tests/lh-linkedin-state.test.py
"""
import importlib.util
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def load(name, filename):
    spec = importlib.util.spec_from_file_location(
        name, os.path.join(HERE, "..", "scripts", "linked-helper", filename))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


wd = load("lh_watchdog", "lh-watchdog.py")
fr = load("lh_first_run", "lh-first-run.py")

failures = 0


def check(name, fn):
    global failures
    try:
        fn()
        print("  ok  " + name)
    except AssertionError as e:
        failures += 1
        print("  FAIL " + name + "\n       " + str(e))


HEAD = "Guy Wilson | Linked Helper 2 Instance #16045 | 2.130.55 | Running campaigns... | "
URL = "(https://www.linkedin.com/x/)"

# The two titles as they really read on 5-6 Oct 2026.
MID_TASK = HEAD + 'LinkedIn "Veronica Mesce" profile page (https://www.linkedin.com/in/veronica-mesce-2ba300163/)'
NEUTRAL = ("Sam Noble | Linked Helper 2 Instance #431357 | 2.130.55 | Running campaigns... | "
           "LinkedIn logged in (https://www.linkedin.com/mynetwork/invite-connect/connections/)")

CASES = [
    # signed in - every page Linked Helper only names once it has seen a signed-in session
    (MID_TASK, "ok"),
    (NEUTRAL, "ok"),
    (HEAD + "LinkedIn loading profile page... " + URL, "ok"),
    (HEAD + 'LinkedIn "Acme Pty Ltd" organization page ' + URL, "ok"),
    (HEAD + "LinkedIn loading messaging page... " + URL, "ok"),
    (HEAD + "LinkedIn messaging page " + URL, "ok"),
    (HEAD + "LinkedIn settings page " + URL, "ok"),
    (HEAD + 'SalesNavigator "Jo Bloggs" profile page ' + URL, "ok"),
    (HEAD + "SalesNavigator logged in " + URL, "ok"),
    # signed out - the title says so
    (HEAD + "LinkedIn login page " + URL, "LOGGED OUT"),
    (HEAD + "LinkedIn signup page " + URL, "LOGGED OUT"),
    (HEAD + "LinkedIn authwall page " + URL, "LOGGED OUT"),
    (HEAD + "LinkedIn home page " + URL, "LOGGED OUT"),
    # LinkedIn wants something from a person
    (HEAD + "LinkedIn restricted account page " + URL, "RESTRICTED"),
    (HEAD + "LinkedIn checkpoint challenge page " + URL, "CHALLENGE"),
    (HEAD + "LinkedIn captcha puzzle page " + URL, "CHALLENGE"),
    (HEAD + "LinkedIn enter phone to confirm its you page " + URL, "CHALLENGE"),
    (HEAD + "LinkedIn check add phone page " + URL, "CHALLENGE"),
    (HEAD + "LinkedIn check manage account " + URL, "CHALLENGE"),
    # says nothing either way - never guessed into LOGGED OUT
    (HEAD + "LinkedIn logging in... " + URL, "unknown"),
    (HEAD + "LinkedIn " + URL, "unknown"),
    (HEAD + "Loading... " + URL, "unknown"),
    (HEAD + "Navigating... (https://www.linkedin.com/feed/)", "unknown"),
    (HEAD + "Initializing...", "unknown"),
    (HEAD + "(blank)", "unknown"),
    (HEAD + "SalesNavigator login page " + URL, "unknown"),
    ("Guy Wilson | Linked Helper 2 Instance #16045 | 2.130.55 | Closing...", "unknown"),
    (HEAD + "LinkedIn some page invented in a later version " + URL, "unknown"),
    ("", "unknown"),
    (None, "unknown"),
]


def the_false_alarm_is_gone():
    assert wd.parse_title(MID_TASK)["linkedin"] == "ok", wd.parse_title(MID_TASK)
    assert wd.parse_title(MID_TASK)["state"] == "RUNNING"
    assert wd.parse_title(MID_TASK)["account"] == "16045"
    assert wd.parse_title(MID_TASK)["version"] == "2.130.55"


def every_wording_reads_right():
    for title, want in CASES:
        got = wd.linkedin_state(title)
        assert got == want, "%r -> %s, wanted %s" % (title, got, want)


def both_scripts_read_it_the_same():
    for title, _ in CASES:
        assert wd.linkedin_state(title) == fr.linkedin_state(title), title


def no_window_is_still_unknown():
    assert wd.parse_title("") == {"state": "NOT OPEN", "linkedin": "unknown", "account": None, "version": None}


def a_name_cannot_fool_it():
    # the words that mean signed out, sitting inside a person's name on a signed-in page
    assert wd.linkedin_state(HEAD + 'LinkedIn "LinkedIn login page" profile page ' + URL) == "ok"
    # a name with " | " in it - plenty of LinkedIn names carry one
    assert wd.linkedin_state(HEAD + 'LinkedIn "Jane Doe | LinkedIn Coach" profile page ' + URL) == "ok"
    # a campaign name with " | " in it, ahead of a real signed-out page
    running = ('Guy Wilson | Linked Helper 2 Instance #16045 | 2.130.55 | Running campaign #3 '
               '"Sydney | LinkedIn logged in": action #9 Waiter  | ')
    assert wd.linkedin_state(running + "LinkedIn login page " + URL) == "LOGGED OUT"


def first_run_goes_ahead_on_a_named_page():
    # The machine's own setup waits for "signed in to LinkedIn". Someone who has clicked through
    # to a profile is signed in; the old check kept it waiting.
    title = "Linked Helper 2 | Instance #571651 | 2.130.47 | Idle | LinkedIn messaging page " + URL
    assert fr.linkedin_ready(title, "571651")
    assert not fr.linkedin_ready(title, "999999")
    assert not fr.linkedin_ready("Linked Helper 2 | Instance #571651 | 2.130.47 | Idle | LinkedIn login page", "571651")
    assert not fr.linkedin_ready("Linked Helper 2 | Instance #571651 | 2.130.47 | Idle | LinkedIn checkpoint challenge page", "571651")


def fits_the_status_line():
    # routes/linkedHelperMachineRoutes.js clips the word to 20 characters
    for _, want in CASES:
        assert len(want) <= 20


check("the false alarm is gone", the_false_alarm_is_gone)
check("every wording reads right", every_wording_reads_right)
check("both scripts read it the same", both_scripts_read_it_the_same)
check("no window is still unknown", no_window_is_still_unknown)
check("a name cannot fool it", a_name_cannot_fool_it)
check("first run goes ahead on a named page", first_run_goes_ahead_on_a_named_page)
check("fits the status line", fits_the_status_line)

if failures:
    print("\n%d FAILED" % failures)
    raise SystemExit(1)
print("\nall passed")
