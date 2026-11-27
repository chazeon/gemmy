"""The message line's timed note (web/src/ui/message.ts): its clock runs only while it is the line on show, only the
note fades, and a standing error over it leaves it to come back. Run in node through tests/viewer_bundle.py; skipped
without node. The waits are real time, so the margins between them are wide."""

from __future__ import annotations

import pytest

from viewer_bundle import available, node_json

pytestmark = pytest.mark.skipif(not available(), reason="node or web/node_modules is missing (cd web && npm ci)")

HEAD = """
const { note, setStanding, timed, fadingNote, line, STAY } = viewer;
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const undo = { label: "Undo", run() {} };
"""


def test_undo_survives_a_standing_error_longer_than_the_note_and_comes_back() -> None:
    script = (
        HEAD
        + """
note("Used the saved map", { ms: 300, action: undo });
setStanding("error", "reader failed", "error");
await wait(400);
const result = {
  // The note's time ran out under the error, but the note is still there, with its Undo, and not fading.
  noteKept: timed.value !== null,
  errorOnTop: line.value?.kind === "error",
  errorNotFaded: fadingNote.value === null,
};
setStanding("error", null);
result.undoBack = line.value?.action?.label === "Undo";
await wait(150);
result.undoStill = line.value?.action?.label === "Undo" && fadingNote.value === null;
await wait(250);
result.fadingNow = fadingNote.value !== null && fadingNote.value === line.value;
await wait(500);
result.cleared = timed.value === null;
"""
    )
    assert node_json(script) == {
        "noteKept": True,
        "errorOnTop": True,
        "errorNotFaded": True,
        "undoBack": True,
        "undoStill": True,
        "fadingNow": True,
        "cleared": True,
    }


def test_a_standing_message_never_fades_under_the_fading_note() -> None:
    script = (
        HEAD
        + """
note("Saved", { ms: 50 });
await wait(150);
const fadingBefore = fadingNote.value !== null;
setStanding("error", "reader failed", "error");
const result = {
  fadingBefore,
  errorOnTop: line.value?.kind === "error",
  // The note is fading under the error, and the error is not the faded one.
  errorNotFaded: fadingNote.value !== line.value,
};
"""
    )
    assert node_json(script) == {"fadingBefore": True, "errorOnTop": True, "errorNotFaded": True}


def test_a_stay_note_does_not_expire() -> None:
    script = (
        HEAD
        + """
note("Rendering", { ms: STAY });
await wait(120);
const result = { shown: timed.value !== null, fading: fadingNote.value !== null };
"""
    )
    assert node_json(script) == {"shown": True, "fading": False}


def test_a_pending_undo_survives_a_render_progress_update() -> None:
    # The serve page reports render progress as the standing "render" message (ui/live.ts), so it does not replace a
    # note's Undo; the Undo is still on the line when the render is cleared, and the progress shows once the Undo goes.
    script = (
        HEAD
        + """
note("Used the saved map", { ms: STAY, action: undo });
setStanding("render", "Rendering out.png…");
const during = line.value?.action?.label === "Undo";
setStanding("render", null);
const result = { during, after: timed.value?.action?.label === "Undo" };
"""
    )
    assert node_json(script) == {"during": True, "after": True}
