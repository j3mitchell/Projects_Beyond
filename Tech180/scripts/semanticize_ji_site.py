#!/usr/bin/env python3
"""Convert the J.I. Systems Tech180 export to semantic component classes."""

from __future__ import annotations

import argparse
from pathlib import Path

from bs4 import BeautifulSoup, Tag


def direct_children(parent: Tag, name: str | None = None) -> list[Tag]:
    return [
        child
        for child in parent.children
        if isinstance(child, Tag) and (name is None or child.name == name)
    ]


def set_class(element: Tag, *classes: str) -> None:
    element["class"] = [class_name for class_name in classes if class_name]


def set_icon(svg: Tag, modifier: str = "") -> None:
    set_class(svg, "icon", modifier)
    for descendant in svg.find_all(True):
        descendant.attrs.pop("class", None)


def semanticize(index_path: Path) -> None:
    soup = BeautifulSoup(index_path.read_text(encoding="utf-8"), "html.parser")

    for element in soup.find_all(True):
        element.attrs.pop("class", None)
        for attribute in list(element.attrs):
            if attribute.startswith("data-"):
                element.attrs.pop(attribute, None)

    for link in soup.select('link[rel~="stylesheet"]'):
        if "_astro/" in str(link.get("href", "")):
            link.decompose()

    html = soup.html
    body = soup.body
    set_class(html, "no-js")
    set_class(body, "site")

    header = body.find("header", recursive=False)
    set_class(header, "site-header")
    header_inner = direct_children(header, "div")[0]
    set_class(header_inner, "container", "site-header__inner")
    header_brand = header_inner.find("a", recursive=False)
    header_brand["href"] = "#top"
    set_class(header_brand, "brand")

    desktop_nav = header_inner.find("nav", recursive=False)
    set_class(desktop_nav, "site-nav")
    for link in desktop_nav.find_all("a", recursive=False):
        set_class(link, "site-nav__link")
        if link.get_text(strip=True) == "Contact":
            link["href"] = "#contact"
        elif link.get("href", "").startswith("https://interlaysoftware.com/#"):
            link["href"] = link["href"].split("/", 3)[-1]

    header_actions = direct_children(header_inner, "div")[-1]
    set_class(header_actions, "site-header__actions")
    header_cta = header_actions.find("a", recursive=False)
    set_class(header_cta, "button", "button--primary", "site-header__cta")
    set_icon(header_cta.find("svg"), "icon--sm")
    menu_button = header_actions.find("button", recursive=False)
    set_class(menu_button, "icon-button", "menu-toggle")
    set_icon(menu_button.find("svg"))

    mobile_menu = header.find_next_sibling("div")
    set_class(mobile_menu, "mobile-menu")
    mobile_menu["aria-hidden"] = "true"
    mobile_backdrop = mobile_menu.find("button", id="mobile-menu-backdrop")
    set_class(mobile_backdrop, "mobile-menu__backdrop")
    mobile_panel = mobile_menu.find("aside", recursive=False)
    set_class(mobile_panel, "mobile-menu__panel")
    mobile_header = direct_children(mobile_panel, "div")[0]
    set_class(mobile_header, "mobile-menu__header")
    mobile_brand = mobile_header.find("a", recursive=False)
    mobile_brand["href"] = "#top"
    set_class(mobile_brand, "brand", "brand--mobile")
    logo_image = mobile_brand.find("img")
    set_class(logo_image, "brand__mark")
    brand_text = mobile_brand.find("span")
    set_class(brand_text, "brand__name")
    mobile_close = mobile_header.find("button")
    set_class(mobile_close, "icon-button")
    set_icon(mobile_close.find("svg"))
    mobile_nav = mobile_panel.find("nav", recursive=False)
    set_class(mobile_nav, "mobile-nav")
    for link in mobile_nav.find_all("a", recursive=False):
        set_class(link, "mobile-nav__link")
        href = link.get("href", "")
        if href.startswith("https://interlaysoftware.com/#"):
            link["href"] = href.split("/", 3)[-1]
        elif link.get_text(" ", strip=True) == "Blog":
            link["href"] = "#contact"
        for svg in link.find_all("svg"):
            set_icon(svg, "icon--sm")
        icon_wrap = link.find("span")
        if icon_wrap and icon_wrap.find("svg"):
            set_class(icon_wrap, "mobile-nav__icon")
    mobile_footer = direct_children(mobile_panel, "div")[-1]
    set_class(mobile_footer, "mobile-menu__footer")
    mobile_cta = mobile_footer.find("a")
    set_class(mobile_cta, "button", "button--primary")
    set_icon(mobile_cta.find("svg"), "icon--sm")

    main = body.find("main", recursive=False)
    main["id"] = "top"
    sections = direct_children(main, "section")
    hero, services, audit, method, work, about, contact = sections

    # Hero
    hero["id"] = "home"
    set_class(hero, "hero")
    hero_inner = direct_children(hero, "div")[0]
    set_class(hero_inner, "container", "hero__inner")
    hero_content, focus_panel = direct_children(hero_inner)
    set_class(hero_content, "hero__content")
    hero_text = direct_children(hero_content)
    set_class(hero_text[0], "eyebrow")
    set_class(hero_text[1], "hero__title")
    set_class(hero_text[2], "hero__lead")
    hero_actions = hero_text[3]
    set_class(hero_actions, "hero__actions")
    hero_links = hero_actions.find_all("a", recursive=False)
    set_class(hero_links[0], "button", "button--primary")
    hero_links[1]["href"] = "#audit"
    set_class(hero_links[1], "button", "button--link")

    set_class(focus_panel, "focus-panel")
    focus_label, focus_list, focus_summary = direct_children(focus_panel)
    set_class(focus_label, "eyebrow", "eyebrow--compact")
    set_class(focus_list, "focus-list")
    for article in direct_children(focus_list, "article"):
        set_class(article, "focus-item")
        icon_box, copy = direct_children(article)
        set_class(icon_box, "icon-box")
        set_icon(icon_box.find("svg"))
        heading = copy.find(["h2", "h3"])
        heading.name = "h3"
        set_class(heading, "focus-item__title")
        set_class(copy.find("p"), "focus-item__text")
    set_class(focus_summary, "focus-summary")
    for article in direct_children(focus_summary, "article"):
        set_class(article, "focus-summary__item")
        heading_row, text = direct_children(article)
        set_class(heading_row, "focus-summary__heading")
        set_icon(heading_row.find("svg"), "icon--sm")
        heading = heading_row.find(["h2", "h3"])
        heading.name = "h3"
        set_class(heading, "focus-summary__title")
        set_class(text, "focus-summary__text")

    # Shared section helpers
    def section_heading(block: Tag, layout: str = "") -> None:
        set_class(block, "section-heading", layout)
        children = direct_children(block)
        set_class(children[0], "eyebrow")
        set_class(children[1], "section-heading__title")

    # Services
    services.attrs.pop("id", None)
    services["id"] = "services"
    set_class(services, "section", "section--white")
    services_inner = direct_children(services, "div")[0]
    set_class(services_inner, "container")
    services_intro, services_grid = direct_children(services_inner)
    set_class(services_intro, "section-intro")
    heading_block, intro_copy = direct_children(services_intro)
    section_heading(heading_block)
    set_class(intro_copy, "section-intro__copy")
    set_class(services_grid, "service-grid")
    for card in direct_children(services_grid, "article"):
        set_class(card, "service-card")
        set_icon(card.find("svg"), "service-card__icon")
        set_class(card.find("h3"), "service-card__title")
        set_class(card.find("p"), "service-card__text")

    # Audit
    set_class(audit, "section", "section--soft")
    audit_inner = direct_children(audit, "div")[0]
    set_class(audit_inner, "container", "split-layout")
    audit_copy, audit_list = direct_children(audit_inner)
    set_class(audit_copy, "split-layout__content")
    audit_children = direct_children(audit_copy)
    set_class(audit_children[0], "eyebrow")
    set_class(audit_children[1], "section-heading__title")
    set_class(audit_children[2], "section-copy")
    set_class(audit_children[3], "button", "button--primary")
    set_class(audit_list, "audit-list")
    for item in direct_children(audit_list, "article"):
        set_class(item, "audit-list__item")
        icon_wrap, copy = direct_children(item)
        set_class(icon_wrap, "audit-list__icon")
        set_icon(icon_wrap.find("svg"), "icon--sm")
        set_class(copy, "audit-list__text")

    # Method
    set_class(method, "section", "section--dark")
    method_inner = direct_children(method, "div")[0]
    set_class(method_inner, "container", "method-layout")
    method_heading, method_grid = direct_children(method_inner)
    section_heading(method_heading, "section-heading--light")
    set_class(method_grid, "method-grid")
    for step in direct_children(method_grid, "article"):
        set_class(step, "process-step")
        number, title, copy = direct_children(step)
        set_class(number, "process-step__number")
        set_class(title, "process-step__title")
        set_class(copy, "process-step__text")

    # Work
    set_class(work, "section", "section--paper")
    work_inner = direct_children(work, "div")[0]
    set_class(work_inner, "container")
    work_intro, work_grid = direct_children(work_inner)
    set_class(work_intro, "section-intro")
    work_heading, work_copy = direct_children(work_intro)
    section_heading(work_heading)
    set_class(work_copy, "section-intro__copy")
    set_class(work_grid, "work-grid")
    for card in direct_children(work_grid, "article"):
        set_class(card, "work-card")
        set_icon(card.find("svg"), "work-card__icon")
        set_class(card.find("p"), "work-card__text")

    # About
    set_class(about, "section", "section--white")
    about_inner = direct_children(about, "div")[0]
    set_class(about_inner, "container", "about-layout")
    about_heading, about_copy = direct_children(about_inner)
    section_heading(about_heading)
    set_class(about_copy, "about-copy")
    about_paragraph = about_copy.find("p", recursive=False)
    set_class(about_paragraph, "about-copy__text")
    statement = about_paragraph.find("span")
    if statement:
        statement.extract()
        statement.name = "p"
        set_class(statement, "about-copy__statement")
        about_paragraph.insert_after(statement)

    # Contact
    set_class(contact, "section", "section--soft")
    contact_inner = direct_children(contact, "div")[0]
    set_class(contact_inner, "container", "contact-layout")
    contact_copy, contact_card = direct_children(contact_inner)
    set_class(contact_copy, "contact-layout__content")
    contact_children = direct_children(contact_copy)
    set_class(contact_children[0], "eyebrow")
    set_class(contact_children[1], "section-heading__title")
    set_class(contact_children[2], "section-copy")
    set_class(contact_card, "contact-card")
    set_class(contact_card.find("h3"), "contact-card__title")
    set_class(contact_card.find("p"), "contact-card__text")
    set_class(contact_card.find("a"), "button", "button--primary", "button--full")

    # Footer
    footer = body.find("footer", recursive=False)
    set_class(footer, "site-footer")
    footer_inner = direct_children(footer, "div")[0]
    set_class(footer_inner, "container")
    footer_main, footer_legal = direct_children(footer_inner)
    set_class(footer_main, "site-footer__main")
    footer_about, footer_links = direct_children(footer_main)
    set_class(footer_about, "site-footer__about")
    footer_brand = footer_about.find("a")
    footer_brand["href"] = "#top"
    set_class(footer_brand, "brand", "brand--footer")
    set_class(footer_about.find("p"), "site-footer__description")
    set_class(footer_links, "site-footer__links")
    footer_nav = footer_links.find("nav")
    set_class(footer_nav, "footer-nav")
    footer_list = footer_nav.find("ul")
    set_class(footer_list, "footer-nav__list")
    for item in footer_list.find_all("li", recursive=False):
        set_class(item, "footer-nav__item")
        link = item.find("a")
        if not link:
            text = item.get_text(strip=True)
            href = {
                "Solutions": "#services",
                "Audit": "#audit",
                "Process": "#method",
                "Work": "#work",
            }.get(text)
            if href:
                item.clear()
                link = soup.new_tag("a", href=href)
                link.string = text
                item.append(link)
        if link:
            set_class(link, "footer-nav__link")
    contact_links = direct_children(footer_links, "div")[-1]
    set_class(contact_links, "footer-contact")
    for link in contact_links.find_all("a", recursive=False):
        set_class(link, "footer-contact__link")
        icon_wrap = link.find("span")
        if icon_wrap and icon_wrap.find("svg"):
            set_class(icon_wrap, "footer-contact__icon")
            set_icon(icon_wrap.find("svg"), "icon--sm")
    set_class(footer_legal, "site-footer__legal")
    set_class(footer_legal.find("p"), "site-footer__copyright")

    # Normalize any unclassified inline SVGs.
    for svg in soup.find_all("svg"):
        if not svg.get("class"):
            set_icon(svg)

    index_path.write_text("<!doctype html>\n" + soup.html.prettify(), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("index", type=Path)
    args = parser.parse_args()
    semanticize(args.index.resolve())


if __name__ == "__main__":
    main()
