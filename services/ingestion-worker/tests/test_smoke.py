from src import main


def test_main_module_importable() -> None:
    assert callable(main.main)
