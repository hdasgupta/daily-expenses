#!/usr/bin/env python3

from pathlib import Path
import shutil
import re
import sys

ROOT = Path(__file__).resolve().parent
FILE = ROOT / "frontend" / "src" / "pages" / "Crud.jsx"


def backup(path):
    backup = path.with_suffix(path.suffix + ".bak")

    if not backup.exists():
        shutil.copy2(path, backup)
        print(f"Backup created: {backup}")

    return backup


def main():
    if not FILE.exists():
        print(f"ERROR: File not found:\n{FILE}")
        sys.exit(1)

    text = FILE.read_text(encoding="utf-8")
    original = text

    print(f"Checking:\n{FILE}\n")

    # ---------------------------------------------------------------
    # Fix:
    #
    # useEffect(load, [dependencies]);
    #
    # where load() returns a Promise.
    #
    # Change to:
    #
    # useEffect(() => {
    #     load();
    # }, [dependencies]);
    #
    # ---------------------------------------------------------------

    pattern = re.compile(
        r"useEffect\s*\(\s*([A-Za-z_$][\w$]*)\s*,\s*(\[[^\]]*\])\s*\)"
    )

    matches = list(pattern.finditer(text))

    for match in reversed(matches):
        function_name = match.group(1)
        dependencies = match.group(2)

        replacement = (
            "useEffect(() => {\n"
            f"    {function_name}();\n"
            f"  }}, {dependencies})"
        )

        text = (
            text[:match.start()]
            + replacement
            + text[match.end():]
        )

        print(
            f"Changed: useEffect({function_name}, "
            f"{dependencies})"
        )

    # ---------------------------------------------------------------
    # Specifically make loadCats safe.
    #
    # BEFORE:
    #
    # const loadCats = () => api(...).then(setCats);
    #
    # AFTER:
    #
    # const loadCats = async () => {
    #     const result = await api(...);
    #     setCats(result);
    # };
    #
    # This is safe when called from an effect because the effect itself
    # does NOT return the Promise.
    # ---------------------------------------------------------------

    old = 'const loadCats = () => api("/meta/categories").then(setCats);'

    new = '''const loadCats = async () => {
    const result = await api("/meta/categories");
    setCats(result);
  };'''

    if old in text:
        text = text.replace(old, new)
        print("Changed: loadCats()")

    # ---------------------------------------------------------------
    # Remove accidental "return promise" from useEffect callbacks.
    #
    # Example:
    #
    # useEffect(() => {
    #     return load();
    # }, []);
    #
    # becomes:
    #
    # useEffect(() => {
    #     load();
    # }, []);
    # ---------------------------------------------------------------

    return_pattern = re.compile(
        r"(useEffect\s*\(\s*\(\)\s*=>\s*\{\s*)"
        r"return\s+([A-Za-z_$][\w$]*)\(\)\s*;"
    )

    def remove_return(match):
        return match.group(1) + match.group(2) + "();"

    text, count = return_pattern.subn(remove_return, text)

    if count:
        print(f"Removed {count} Promise-returning effect cleanup(s)")

    # ---------------------------------------------------------------
    # Write only if something changed.
    # ---------------------------------------------------------------

    if text == original:
        print("\nNo changes were necessary.")
        print("\nShow the Categories & Items section with:")
        print("  sed -n '230,280p' frontend/src/pages/Crud.jsx")
        return

    backup(FILE)

    FILE.write_text(text, encoding="utf-8")

    print("\n----------------------------------------")
    print("Crud.jsx updated")
    print("----------------------------------------")

    print("\nReview the changes:")
    print("  git diff -- frontend/src/pages/Crud.jsx")

    print("\nThen restart Vite:")
    print("  cd frontend")
    print("  npm run dev")


if __name__ == "__main__":
    main()
