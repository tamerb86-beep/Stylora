#!/usr/bin/env python3
"""
Script to add i18n translations to WalkInQueue.tsx component
"""

import re

# Read the original file
with open('/home/ubuntu/barbertime-website/client/src/components/WalkInQueue.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Add useTranslation import
if 'useTranslation' not in content:
    content = content.replace(
        'import { useState } from "react";',
        'import { useState } from "react";\nimport { useTranslation } from "react-i18next";'
    )

# Add date-fns locales
content = content.replace(
    'import { nb } from "date-fns/locale";',
    'import { nb, ar, enUS, uk } from "date-fns/locale";'
)

# Add useTranslation hook after component declaration
content = content.replace(
    'export function WalkInQueue() {\n  const [, setLocation] = useLocation();',
    'export function WalkInQueue() {\n  const { t, i18n } = useTranslation();\n  const [, setLocation] = useLocation();'
)

# Add getDateLocale function after useState declarations
insert_after = '  });'
getDateLocale_func = '''

  // Get date-fns locale based on current language
  const getDateLocale = () => {
    switch (i18n.language) {
      case 'ar': return ar;
      case 'en': return enUS;
      case 'uk': return uk;
      default: return nb;
    }
  };'''

# Find the position after the last useState
last_usestate_pos = content.rfind('  });', 0, content.find('  // Fetch queue'))
if last_usestate_pos != -1:
    content = content[:last_usestate_pos + 5] + getDateLocale_func + content[last_usestate_pos + 5:]

# Translation mappings - Norwegian to translation key
translations = {
    # Toast messages
    '"Kunde lagt til i kø"': "t('walkInQueue.successAdded')",
    '"Kunne ikke legge til kunde"': "t('walkInQueue.errorAdd')",
    '"Tjeneste startet"': "t('walkInQueue.successStarted')",
    '"Kunne ikke starte tjeneste"': "t('walkInQueue.errorStart')",
    '"Fjernet fra kø"': "t('walkInQueue.successRemoved')",
    '"Kunne ikke fjerne fra kø"': "t('walkInQueue.errorRemove')",
    '"Prioritet oppdatert"': "t('walkInQueue.successPriorityUpdated')",
    '"Kunne ikke oppdatere prioritet"': "t('walkInQueue.errorPriority')",
    '"Tjeneste fullført - omdirigerer til kasse"': "t('walkInQueue.successCompleted')",
    '"Kunne ikke fullføre tjeneste"': "t('walkInQueue.errorComplete')",
    '"Vennligst fyll ut navn og telefon"': "t('walkInQueue.errorNamePhone')",
    '"Vennligst velg en tjeneste"': "t('walkInQueue.errorService')",
    '"Vennligst oppgi grunn for prioritering"': "t('walkInQueue.errorPriorityReason')",
    '"SMS-varsel funksjon kommer snart"': "t('walkInQueue.smsNotification')",
    
    # Confirm dialogs
    '"Er du sikker på at du vil starte tjenesten for denne kunden?"': "t('walkInQueue.confirmStart')",
    '"Er du sikker på at tjenesten er fullført? Kunden vil bli sendt til kassen."': "t('walkInQueue.confirmComplete')",
    
    # UI labels
    'Walk-in Kø': "{t('walkInQueue.title')}",
    'Administrer kunder som venter uten avtale': "{t('walkInQueue.description')}",
    'TV-modus': "{t('walkInQueue.tvMode')}",
    'Legg til Kunde': "{t('walkInQueue.addCustomer')}",
    'Legg til kunde i kø': "{t('walkInQueue.addToQueue')}",
    'Registrer kunde som venter på ledig time': "{t('walkInQueue.registerCustomer')}",
    'Kundens navn \\*': "{t('walkInQueue.customerName')} *",
    'Telefonnummer \\*': "{t('walkInQueue.phoneNumber')} *",
    'Tjeneste \\*': "{t('walkInQueue.service')} *",
    'Foretrukket frisør \\(valgfritt\\)': "{t('walkInQueue.preferredBarber')}",
    'Prioritet \\*': "{t('walkInQueue.priority')} *",
    'Grunn for prioritering \\*': "{t('walkInQueue.priorityReasonRequired')}",
    'Velg tjeneste': "{t('walkInQueue.selectService')}",
    'Velg frisør': "{t('walkInQueue.selectBarber')}",
    'Velg prioritet': "{t('walkInQueue.selectPriority')}",
    'Normal': "{t('walkInQueue.normal')}",
    'Haster': "{t('walkInQueue.urgent')}",
    'VIP': "{t('walkInQueue.vip')}",
    'Avbryt': "{t('common.cancel')}",
    '"Legger til..."': "t('walkInQueue.adding')",
    '"Legg til i kø"': "t('walkInQueue.addToQueue')",
    'I kø': "{t('walkInQueue.inQueue')}",
    'Gjennomsnittlig ventetid': "{t('walkInQueue.averageWaitTime')}",
    'Ledige frisører': "{t('walkInQueue.availableBarbers')}",
    'Opptatt': "{t('walkInQueue.busy')}",
    'Ingen kunder i kø': "{t('walkInQueue.noCustomers')}",
    'Klikk "Legg til Kunde" for å registrere walk-in kunder': "{t('walkInQueue.clickAddDescription')}",
    'Tjeneste:': "{t('walkInQueue.service')}:",
    'Frisør:': "{t('walkInQueue.barber')}:",
    'Ukjent': "{t('common.unknown')}",
    'Lagt til:': "{t('walkInQueue.addedAt')}:",
    'Endre prioritet': "{t('walkInQueue.editPriority')}",
    'Varsle kunde': "{t('walkInQueue.notifyCustomer')}",
    'Start tjeneste': "{t('walkInQueue.startService')}",
    'Fjern fra kø': "{t('walkInQueue.removeFromQueue')}",
    'Kunder som får tjeneste nå': "{t('walkInQueue.inService')}",
    'Fullfør & Betal': "{t('walkInQueue.completeAndPay')}",
    'Avbryt tjeneste': "{t('walkInQueue.cancelService')}",
    'Startet:': "{t('walkInQueue.startedAt')}:",
    'Grunn:': "{t('walkInQueue.reason')}:",
    '"Oppdaterer..."': "t('walkInQueue.updating')",
    'Oppdater prioritet': "{t('walkInQueue.updatePriority')}",
}

# Apply translations
for norwegian, translation_key in translations.items():
    # Handle both string literals and JSX text
    if translation_key.startswith('t('):
        # For toast messages and confirm dialogs (already in quotes)
        content = content.replace(norwegian, translation_key)
    else:
        # For JSX text content (needs to be wrapped in {})
        content = re.sub(f'>{norwegian}<', f'>{translation_key}<', content)
        content = re.sub(f'>{norwegian}"', f'>{translation_key}"', content)
        content = re.sub(f'"{norwegian}"', translation_key.strip('{}'), content)

# Special case for confirmRemove with variable
content = re.sub(
    r'confirm\(`Er du sikker på at du vil fjerne \$\{customerName\} fra køen\?`\)',
    "confirm(t('walkInQueue.confirmRemove', { name: customerName }))",
    content
)

# Replace date locale
content = content.replace(
    'locale: nb',
    'locale: getDateLocale()'
)

# Add missing translation keys to no.json
missing_keys = {
    "description": "Administrer kunder som venter uten avtale",
    "tvMode": "TV-modus",
    "registerCustomer": "Registrer kunde som venter på ledig time",
    "busy": "Opptatt",
    "clickAddDescription": 'Klikk "Legg til Kunde" for å registrere walk-in kunder',
    "addedAt": "Lagt til",
    "startedAt": "Startet",
}

print("Translation keys that need to be added to translation files:")
for key, value in missing_keys.items():
    print(f'  "{key}": "{value}",')

# Write the updated content
with open('/home/ubuntu/barbertime-website/client/src/components/WalkInQueue.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("\n✅ WalkInQueue.tsx has been updated with i18n translations!")
