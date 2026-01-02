# Unimicro Integrasjonsguide for Stylora

## 📋 Innholdsfortegnelse

1. [Oversikt](#oversikt)
2. [Fordeler](#fordeler)
3. [Forutsetninger](#forutsetninger)
4. [Steg 1: Opprett API-klient i Unimicro](#steg-1-opprett-api-klient-i-unimicro)
5. [Steg 2: Konfigurer Stylora](#steg-2-konfigurer-stylora)
6. [Steg 3: Test tilkoblingen](#steg-3-test-tilkoblingen)
7. [Steg 4: Velg synkroniseringsfrekvens](#steg-4-velg-synkroniseringsfrekvens)
8. [Bruk](#bruk)
9. [Feilsøking](#feilsøking)

---

## Oversikt

Unimicro-integrasjonen lar Stylora automatisk synkronisere salgsdata, kunder og betalinger til ditt Unimicro regnskapssystem. Dette eliminerer dobbeltføring og sparer deg for manuelt arbeid.

**Hva synkroniseres:**
- ✅ **Kunder** - Automatisk opprett/oppdater kunder i Unimicro
- ✅ **Fakturaer** - Konverter ordrer til fakturaer med MVA-beregning (25%)
- ✅ **Betalinger** - Registrer betalinger og oppdater fakturastatus
- ✅ **Refusjoner** - Opprett kreditnotaer for refunderte betalinger

---

## Fordeler

1. **Spar tid** - Ingen manuell dataføring
2. **Unngå feil** - Automatisk synkronisering reduserer menneskelige feil
3. **Alltid oppdatert** - Regnskapet er alltid ajour
4. **MVA-klar** - Automatisk MVA-beregning (25% norsk standard)
5. **Revisorvennlig** - Standard regnskapsformat
6. **Fleksibel synkronisering** - Velg daglig, ukentlig, månedlig eller manuell synkronisering

---

## Forutsetninger

Før du starter, sørg for at du har:

1. ✅ **Unimicro-konto** - Du må ha en aktiv Unimicro-konto
2. ✅ **Admin-tilgang** - Du må ha administratortilgang i Stylora
3. ✅ **Company ID** - Du må kjenne til din Unimicro Company ID (finnes i Unimicro-innstillinger)

---

## Steg 1: Opprett API-klient i Unimicro

### 1.1 Logg inn på Unimicro Developer Portal

1. Gå til [https://developer.unimicro.no](https://developer.unimicro.no)
2. Logg inn med din Unimicro-konto

### 1.2 Opprett ny API-klient

1. Klikk på **"Applications"** i menyen
2. Klikk på **"Create New Application"**
3. Fyll ut skjemaet:
   - **Application Name**: `Stylora Integration`
   - **Application Type**: `Server Application` (OAuth 2.0 Client Credentials)
   - **Redirect URI**: Ikke nødvendig for server-til-server
4. Klikk **"Create"**

### 1.3 Lagre legitimasjon

Etter opprettelse får du:
- **Client ID** - En unik identifikator (f.eks. `abc123def456`)
- **Client Secret** - En hemmelig nøkkel (f.eks. `xyz789uvw012`)

⚠️ **VIKTIG**: Lagre Client Secret på et trygt sted! Den vises kun én gang.

### 1.4 Finn Company ID

1. Logg inn på Unimicro (hovedsystem, ikke developer portal)
2. Gå til **Innstillinger** → **Selskap**
3. Finn **Company ID** (et tall, f.eks. `12345`)

---

## Steg 2: Konfigurer Stylora

### 2.1 Åpne Unimicro-innstillinger

1. Logg inn på Stylora som **administrator**
2. Klikk på **"Unimicro"** i sidemenyen
3. Gå til **"Innstillinger"**-fanen

### 2.2 Fyll inn API-legitimasjon

1. **Client ID**: Lim inn Client ID fra Unimicro
2. **Client Secret**: Lim inn Client Secret fra Unimicro
3. **Company ID**: Skriv inn ditt Company ID (tall)
4. **Aktiver integrasjon**: Slå på bryteren

### 2.3 Lagre innstillinger

Klikk på **"Lagre innstillinger"**-knappen nederst på siden.

---

## Steg 3: Test tilkoblingen

### 3.1 Test API-tilkobling

1. Gå til **"Innstillinger"**-fanen
2. Klikk på **"Test tilkobling"**-knappen
3. Vent på resultat

**Forventet resultat:**
- ✅ **Vellykket**: "Tilkobling vellykket! Koblingen til Unimicro fungerer"
- ❌ **Mislyktes**: Se [Feilsøking](#feilsøking) nedenfor

---

## Steg 4: Velg synkroniseringsfrekvens

### 4.1 Velg frekvens

Gå til **"Synkroniseringsfrekvens"**-seksjonen og velg:

#### **Alternativ 1: Daglig (anbefalt)**
- Synkroniserer hver natt kl. 23:00
- ✅ Anbefalt for aktive salonger
- ✅ Alltid oppdatert regnskap

#### **Alternativ 2: Ukentlig**
- Synkroniserer én gang i uken (velg dag)
- ✅ Passer for små salonger med få transaksjoner
- ⚠️ Regnskapet oppdateres kun én gang i uken

#### **Alternativ 3: Månedlig**
- Synkroniserer én gang i måneden (velg dag)
- ✅ Passer for svært små virksomheter
- ⚠️ Regnskapet oppdateres kun én gang i måneden

#### **Alternativ 4: Kun manuelt**
- Synkroniserer kun når du trykker "Synkroniser nå"
- ✅ Full kontroll over når data sendes
- ⚠️ Du må huske å synkronisere manuelt

#### **Alternativ 5: Tilpasset**
- Velg selv dag og tid
- ✅ Fleksibelt for spesielle behov

### 4.2 Lagre innstillinger

Klikk på **"Lagre innstillinger"** etter å ha valgt frekvens.

---

## Bruk

### Automatisk synkronisering

Hvis du har valgt daglig/ukentlig/månedlig synkronisering:
1. Stylora synkroniserer automatisk på valgt tidspunkt
2. Du får en e-postvarsling hvis synkroniseringen mislykkes
3. Sjekk **"Logg"**-fanen for å se synkroniseringshistorikk

### Manuell synkronisering

Hvis du vil synkronisere umiddelbart:
1. Gå til **"Status"**-fanen
2. Klikk på **"Synkroniser nå"**-knappen
3. Vent på bekreftelse

### Overvåke synkroniseringsstatus

**Status-fanen:**
- Se antall usynkroniserte kunder
- Se antall usynkroniserte ordrer
- Trigger manuell synkronisering

**Logg-fanen:**
- Se historikk over alle synkroniseringer
- Se antall vellykkede/feilede operasjoner
- Se feilmeldinger for feilede operasjoner

---

## Feilsøking

### Problem: "Tilkobling mislyktes"

**Mulige årsaker:**
1. ❌ Feil Client ID eller Client Secret
2. ❌ Feil Company ID
3. ❌ API-klienten er ikke aktivert i Unimicro
4. ❌ Nettverksproblemer

**Løsning:**
1. Dobbelsjekk at Client ID, Client Secret og Company ID er riktige
2. Logg inn på Unimicro Developer Portal og verifiser at API-klienten er aktiv
3. Kontakt Unimicro support hvis problemet vedvarer

### Problem: "Synkronisering mislyktes"

**Mulige årsaker:**
1. ❌ Manglende kundedata (f.eks. navn eller telefon)
2. ❌ Ugyldig MVA-sats
3. ❌ Unimicro API midlertidig nede

**Løsning:**
1. Gå til **"Logg"**-fanen og se feilmeldingen
2. Rett opp i dataene i Stylora
3. Prøv manuell synkronisering igjen

### Problem: "Walk-in kunder ikke støttet"

**Årsak:**
- Walk-in kunder (uten kundeinfo) kan ikke synkroniseres til Unimicro

**Løsning:**
1. Opprett en "Walk-in"-kunde i Stylora med standard kontaktinfo
2. Bruk denne kunden for alle walk-in salg
3. Synkroniser denne kunden til Unimicro først

### Problem: "Fakturaer vises ikke i Unimicro"

**Mulige årsaker:**
1. ❌ Ordre er ikke fullført i Stylora
2. ❌ Kunde er ikke synkronisert først
3. ❌ Synkronisering ikke kjørt ennå

**Løsning:**
1. Sørg for at ordren har status "Completed" i Stylora
2. Sjekk at kunden er synkronisert (se Status-fanen)
3. Trigger manuell synkronisering

---

## Kontakt support

Hvis du fortsatt har problemer:

**Stylora Support:**
- E-post: support@stylora.no
- Telefon: +47 XXX XX XXX

**Unimicro Support:**
- E-post: support@unimicro.no
- Telefon: +47 XXX XX XXX
- Developer Portal: https://developer.unimicro.no

---

## Vedlegg: API-dokumentasjon

For utviklere og teknisk personell:
- **Unimicro API Docs**: https://developer.unimicro.no/docs
- **Authentication Guide**: https://developer.unimicro.no/guide/authentication/server-application
- **Customer API**: https://developer.unimicro.no/docs/Customer
- **Invoice API**: https://developer.unimicro.no/docs/CustomerInvoice
- **Payment API**: https://developer.unimicro.no/docs/Payment

---

**Sist oppdatert**: 2. desember 2025  
**Versjon**: 1.0
