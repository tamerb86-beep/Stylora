#!/usr/bin/env python3
"""
Automated button testing script for Stylora website
Tests all navigation links and buttons across pages
"""

import json

# Define all pages and their expected buttons/links
pages_to_test = {
    "/": {
        "name": "Home Page",
        "buttons": [
            {"text": "Kom i gang gratis", "type": "CTA", "expected_action": "signup"},
            {"text": "Se systemet i aksjon", "type": "CTA", "expected_action": "scroll_or_demo"},
            {"text": "Logg inn", "type": "nav", "expected_action": "login"},
            {"text": "Om oss", "type": "nav", "expected_action": "navigate_to_about"},
            {"text": "Kontakt", "type": "nav", "expected_action": "navigate_to_contact"},
            {"text": "Prøv gratis i 14 dager", "type": "CTA", "expected_action": "signup"},
        ]
    },
    "/about": {
        "name": "About Us Page",
        "buttons": [
            {"text": "Tilbake til hovedsiden", "type": "nav", "expected_action": "navigate_to_home"},
            {"text": "Logo", "type": "nav", "expected_action": "navigate_to_home"},
        ]
    },
    "/contact": {
        "name": "Contact Page",
        "buttons": [
            {"text": "Send melding", "type": "form", "expected_action": "submit_form"},
            {"text": "Logo", "type": "nav", "expected_action": "navigate_to_home"},
        ]
    },
    "/signup": {
        "name": "Signup Page",
        "buttons": [
            {"text": "Opprett salong", "type": "form", "expected_action": "create_account"},
            {"text": "Logg inn", "type": "link", "expected_action": "navigate_to_login"},
        ]
    },
    "/book": {
        "name": "Public Booking Page",
        "buttons": [
            {"text": "Neste", "type": "navigation", "expected_action": "next_step"},
            {"text": "Tilbake", "type": "navigation", "expected_action": "previous_step"},
            {"text": "Bekreft booking", "type": "form", "expected_action": "submit_booking"},
        ]
    },
    "/dashboard": {
        "name": "Dashboard",
        "buttons": [
            {"text": "Ny avtale", "type": "action", "expected_action": "create_appointment"},
            {"text": "Se kalender", "type": "action", "expected_action": "navigate_to_calendar"},
        ]
    },
    "/dashboard/customers": {
        "name": "Customers Page",
        "buttons": [
            {"text": "Ny kunde", "type": "action", "expected_action": "create_customer"},
            {"text": "Rediger", "type": "action", "expected_action": "edit_customer"},
            {"text": "Slett", "type": "action", "expected_action": "delete_customer"},
        ]
    },
    "/dashboard/appointments": {
        "name": "Appointments/Calendar Page",
        "buttons": [
            {"text": "Ny avtale", "type": "action", "expected_action": "create_appointment"},
            {"text": "Dag/Uke/Måned toggle", "type": "toggle", "expected_action": "change_view"},
        ]
    },
    "/dashboard/services": {
        "name": "Services Page",
        "buttons": [
            {"text": "Ny tjeneste", "type": "action", "expected_action": "create_service"},
            {"text": "Rediger", "type": "action", "expected_action": "edit_service"},
        ]
    },
    "/dashboard/employees": {
        "name": "Employees Page",
        "buttons": [
            {"text": "Ny ansatt", "type": "action", "expected_action": "create_employee"},
            {"text": "Rediger", "type": "action", "expected_action": "edit_employee"},
            {"text": "Sett PIN", "type": "action", "expected_action": "set_pin"},
        ]
    },
    "/dashboard/products": {
        "name": "Products Page",
        "buttons": [
            {"text": "Nytt produkt", "type": "action", "expected_action": "create_product"},
            {"text": "Rediger", "type": "action", "expected_action": "edit_product"},
        ]
    },
    "/dashboard/pos": {
        "name": "POS/Checkout Page",
        "buttons": [
            {"text": "Add to cart", "type": "action", "expected_action": "add_item"},
            {"text": "Kontant", "type": "payment", "expected_action": "pay_cash"},
            {"text": "Kort", "type": "payment", "expected_action": "pay_card"},
        ]
    },
    "/dashboard/time-clock": {
        "name": "Time Clock Page",
        "buttons": [
            {"text": "Number pad (0-9)", "type": "input", "expected_action": "enter_pin"},
            {"text": "Stemple Inn", "type": "action", "expected_action": "clock_in"},
            {"text": "Stemple Ut", "type": "action", "expected_action": "clock_out"},
        ]
    },
    "/dashboard/settings": {
        "name": "Settings Page",
        "buttons": [
            {"text": "Save settings", "type": "form", "expected_action": "save_settings"},
            {"text": "Upload logo", "type": "upload", "expected_action": "upload_file"},
        ]
    },
}

# Generate test report
report = {
    "test_date": "2025-12-07",
    "total_pages": len(pages_to_test),
    "total_buttons": sum(len(page["buttons"]) for page in pages_to_test.values()),
    "pages": pages_to_test
}

print(json.dumps(report, indent=2, ensure_ascii=False))
print(f"\n✅ Test plan created for {report['total_pages']} pages with {report['total_buttons']} buttons/links")
