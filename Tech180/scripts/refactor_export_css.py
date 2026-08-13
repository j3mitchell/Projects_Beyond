#!/usr/bin/env python3
"""Convert Tech180's per-element data hooks into organized ID/class CSS."""

from __future__ import annotations

import argparse
import re
import shutil
from collections import defaultdict
from pathlib import Path

from bs4 import BeautifulSoup, Tag


RULE_PATTERN = re.compile(
    r'\[data-tech180-style="(?P<hook>t180-style-\d+)"\]\s*\{\s*'
    r"(?P<body>.*?)\s*\}\s*",
    re.DOTALL,
)
SIMPLE_CLASS = re.compile(r"^[A-Za-z_][A-Za-z0-9_-]*$")
EDITOR_ATTRIBUTES = {
    "data-tech180-active",
    "data-tech180-computed-styles",
    "data-tech180-id",
    "data-tech180-style",
    "data-tech180-visible",
}


def css_escape_identifier(value: str) -> str:
    return re.sub(r"([^A-Za-z0-9_-])", lambda match: f"\\{match.group(1)}", value)


def parse_rules(css: str) -> tuple[dict[str, str], str]:
    rules: dict[str, str] = {}
    consumed = []
    for match in RULE_PATTERN.finditer(css):
        body = "\n".join(line.rstrip() for line in match.group("body").strip().splitlines())
        rules[match.group("hook")] = body
        consumed.append((match.start(), match.end()))

    remaining_parts = []
    cursor = 0
    for start, end in consumed:
        remaining_parts.append(css[cursor:start])
        cursor = end
    remaining_parts.append(css[cursor:])
    remaining = "".join(remaining_parts).strip()
    return rules, remaining


def meaningful_classes(element: Tag) -> list[str]:
    candidates = []
    for class_name in element.get("class", []):
        if (
            SIMPLE_CLASS.fullmatch(class_name)
            and not class_name.startswith(("tech180", "t180-"))
        ):
            candidates.append(class_name)
    return sorted(candidates, key=lambda name: ("-" not in name, len(name), name))


def format_rule(selectors: list[str], body: str) -> str:
    selector_text = ",\n".join(selectors)
    return f"{selector_text} {{\n{body}\n}}"


def refactor(index_path: Path, css_path: Path) -> dict[str, int]:
    html = index_path.read_text(encoding="utf-8")
    css = css_path.read_text(encoding="utf-8")
    soup = BeautifulSoup(html, "html.parser")
    rules, remaining_css = parse_rules(css)

    hooked_elements: list[Tag] = []
    declarations_by_element: dict[int, str] = {}
    for element in soup.select("[data-tech180-style]"):
        hook = element.get("data-tech180-style")
        if hook not in rules:
            continue
        hooked_elements.append(element)
        declarations_by_element[id(element)] = rules[hook]

    all_class_elements: dict[str, list[Tag]] = defaultdict(list)
    for element in soup.find_all(True):
        for class_name in meaningful_classes(element):
            all_class_elements[class_name].append(element)

    unique_ids = {
        element.get("id")
        for element in hooked_elements
        if element.get("id")
        and len(soup.select(f'#{css_escape_identifier(element.get("id"))}')) == 1
    }

    id_groups: dict[str, list[str]] = defaultdict(list)
    class_groups: dict[tuple[str, str], list[Tag]] = defaultdict(list)
    unassigned: list[Tag] = []

    for element in hooked_elements:
        declarations = declarations_by_element[id(element)]
        element_id = element.get("id")
        if element_id in unique_ids:
            id_groups[declarations].append(f"#{css_escape_identifier(element_id)}")
            continue

        chosen_class = None
        for class_name in meaningful_classes(element):
            matches = all_class_elements[class_name]
            if matches and all(
                declarations_by_element.get(id(match)) == declarations for match in matches
            ):
                chosen_class = class_name
                break
        if chosen_class:
            class_groups[(chosen_class, declarations)].append(element)
        else:
            unassigned.append(element)

    generated_by_declarations: dict[str, list[Tag]] = defaultdict(list)
    for element in unassigned:
        generated_by_declarations[declarations_by_element[id(element)]].append(element)

    generated_rules: list[str] = []
    for number, (declarations, elements) in enumerate(
        sorted(generated_by_declarations.items(), key=lambda item: min(
            int(element.get("data-tech180-style", "t180-style-0").rsplit("-", 1)[-1])
            for element in item[1]
        )),
        start=1,
    ):
        class_name = f"t180-style-group-{number:03d}"
        for element in elements:
            classes = list(element.get("class", []))
            if class_name not in classes:
                classes.append(class_name)
            element["class"] = classes
        generated_rules.append(format_rule([f".{class_name}"], declarations))

    id_rules = [
        format_rule(sorted(selectors), declarations)
        for declarations, selectors in sorted(id_groups.items(), key=lambda item: item[1][0])
    ]
    shared_class_rules = [
        format_rule([f".{css_escape_identifier(class_name)}"], declarations)
        for (class_name, declarations), _elements in sorted(class_groups.items())
    ]

    for element in soup.find_all(True):
        for attribute in EDITOR_ATTRIBUTES:
            element.attrs.pop(attribute, None)

    sections = [
        "/* Tech180 export CSS\n"
        "   Organized into explicit IDs, reusable source classes, and generated fallback classes. */",
    ]
    if remaining_css:
        sections.extend(["/* Preserved stylesheet rules */", remaining_css])
    if id_rules:
        sections.extend(["/* ID selectors */", "\n\n".join(id_rules)])
    if shared_class_rules:
        sections.extend(["/* Reusable class selectors */", "\n\n".join(shared_class_rules)])
    if generated_rules:
        sections.extend(["/* Generated fallback classes */", "\n\n".join(generated_rules)])

    index_backup = index_path.with_suffix(index_path.suffix + ".pre-refactor.bak")
    css_backup = css_path.with_suffix(css_path.suffix + ".pre-refactor.bak")
    if not index_backup.exists():
        shutil.copy2(index_path, index_backup)
    if not css_backup.exists():
        shutil.copy2(css_path, css_backup)

    index_path.write_text("<!doctype html>\n" + str(soup.html), encoding="utf-8")
    css_path.write_text("\n\n".join(sections).rstrip() + "\n", encoding="utf-8")

    return {
        "elements": len(hooked_elements),
        "id_rules": len(id_rules),
        "class_rules": len(shared_class_rules),
        "generated_rules": len(generated_rules),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("index", type=Path)
    parser.add_argument("css", type=Path)
    args = parser.parse_args()
    stats = refactor(args.index.resolve(), args.css.resolve())
    print(
        "Refactored {elements} elements into {id_rules} ID rules, "
        "{class_rules} reusable class rules, and {generated_rules} fallback rules.".format(
            **stats
        )
    )


if __name__ == "__main__":
    main()
