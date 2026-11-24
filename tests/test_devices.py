import pytest

from gemmy.render.blender.renderer import choose_device

KEYS = ["NONE", "CUDA", "OPTIX", "HIP", "METAL", "ONEAPI"]


def test_auto_picks_gpu_when_reported():
    c = choose_device("AUTO", KEYS, ["CPU", "METAL"])
    assert (c.device, c.compute_type, c.use_gpu_devices) == ("GPU", "METAL", True)


def test_auto_prefers_optix_over_cuda():
    assert choose_device("AUTO", KEYS, ["CUDA", "OPTIX"]).compute_type == "OPTIX"


def test_auto_falls_back_to_cpu():
    assert choose_device("AUTO", KEYS, ["CPU"]).device == "CPU"
    assert choose_device("AUTO", ["NONE"], []).device == "CPU"


def test_cpu_forced():
    assert choose_device("cpu", KEYS, ["METAL"]).device == "CPU"


def test_gpu_without_device_falls_back():
    assert choose_device("GPU", KEYS, ["CPU"]).device == "CPU"


def test_invalid():
    with pytest.raises(ValueError):
        choose_device("TPU", KEYS, [])
