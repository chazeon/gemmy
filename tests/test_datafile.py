"""Every user-written file can be TOML or JSON, picked by extension, with the same validation."""

from __future__ import annotations

from pathlib import Path

import pytest

from gemmy.cli import resolve_settings
from gemmy.cli_args import parse
from gemmy.compile.labels import LabelError, load_label_file
from gemmy.compile.pipeline import compile_scene_from_files
from gemmy.config import load_scene_config
from gemmy.datafile import DataFileError, read_data

EXAMPLE = Path(__file__).resolve().parents[1] / "examples" / "stishovite"


def test_read_data_picks_the_format_by_extension(tmp_path: Path) -> None:
    (tmp_path / "a.toml").write_text('x = 1\n[t]\ny = "z"\n')
    (tmp_path / "a.json").write_text('{"x": 1, "t": {"y": "z"}}')
    assert read_data(tmp_path / "a.toml") == read_data(tmp_path / "a.json") == {"x": 1, "t": {"y": "z"}}


def test_errors_name_the_file_and_the_format(tmp_path: Path) -> None:
    (tmp_path / "bad.toml").write_text("x = [1,\n")
    with pytest.raises(DataFileError, match=r"bad\.toml is not valid TOML"):
        read_data(tmp_path / "bad.toml")
    with pytest.raises(DataFileError, match=r"cannot read .*missing\.json"):
        read_data(tmp_path / "missing.json")


def test_toml_config_compiles_to_the_same_scene_as_json() -> None:
    # Every example also has a TOML copy (tests/test_examples.py checks they all agree).
    assert compile_scene_from_files(EXAMPLE / "config.toml") == compile_scene_from_files(EXAMPLE / "config.json")


def test_toml_config_unknown_key_is_still_an_error(tmp_path: Path) -> None:
    toml = tmp_path / "config.toml"
    toml.write_text("[elements.O]\nradus = 0.4\n")
    with pytest.raises(ValueError, match="radus"):
        load_scene_config(toml)


def test_toml_settings_file_then_flags_override(tmp_path: Path) -> None:
    f = tmp_path / "s.toml"
    f.write_text("[quality]\nsamples = 9\n\n[camera]\nzoom = 2.0\n")
    s = resolve_settings(parse(["render", "--scene", "s.json", "--settings", str(f), "--camera.zoom", "3"]))
    assert s.quality.samples == 9 and s.camera.zoom == 3


def test_toml_label_file(tmp_path: Path) -> None:
    f = tmp_path / "labels.toml"
    f.write_text('H2 = ["5-6"]\n"4" = "H2"\n')
    assert load_label_file(f) == {4: "H2", 5: "H2", 6: "H2"}
    (tmp_path / "bad.toml").write_text("H2 = [\n")
    with pytest.raises(LabelError, match=r"bad\.toml is not valid TOML"):
        load_label_file(tmp_path / "bad.toml")


def test_config_names_its_structure_and_poscar_overrides_it(tmp_path: Path) -> None:
    from gemmy.compile.pipeline import structure_path

    config = tmp_path / "config.toml"
    config.write_text('structure = "POSCAR_HS"\n')
    assert structure_path(config) == tmp_path.resolve() / "POSCAR_HS"
    assert structure_path(config, tmp_path / "POSCAR_LS") == tmp_path / "POSCAR_LS"
    config.write_text("")
    with pytest.raises(ValueError, match="names no structure"):
        structure_path(config)
