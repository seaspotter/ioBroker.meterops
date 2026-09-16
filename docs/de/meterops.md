# ioBroker.meterops

Kontinuierliche Zählerstandshistorie mit automatischer Gerätewechselabwicklung und berechneten
Energie-KPIs.

Zähler werden im Laufe der Jahre ausgetauscht (Zählerwechsel, eine neue Wallbox, eine neue
Wärmepumpe). MeterOps hält einen *logischen* Zählerstand pro Zähler (z. B. "Netzbezug") über
solche Wechsel hinweg durchgängig - über eine Registry physischer Geräte mit Gültigkeitszeiträumen
und Offsets - und berechnet einen festen Katalog von Energie-KPIs (Eigenverbrauchsquote,
Autarkiegrad, COP, spezifischer Ertrag, Batterieeffizienz und weitere) aus den jeweils
konfigurierten Rollen. Siehe [MeterOps-Concept.md](../../MeterOps-Concept.md) für den vollständigen
Konzepthintergrund, die KPI-Formeln und die Begründung jeder Architekturentscheidung (auf
Englisch).

## Konfiguration

Die Admin-Oberfläche hat vier Tabs:

- **General** - welche History-Instanz (z. B. `influxdb.0`) Meter-/Gruppen-/KPI-/Tarif-Datenpunkte
  automatisch protokolliert, sowie den Cron-Zeitplan für periodische Snapshots (für
  periodenbasierte KPIs, siehe unten).
- **Meters** - Rolle, Bezeichnung, Einheit und Quellenhistorie jedes logischen Zählers (der rohe
  ioBroker-Datenpunkt, aus dem gelesen wird, mit Gültigkeitszeitraum, Skalierung und Offset -
  mehrere Quellen pro Zähler für Gerätewechsel).
- **Groups** - benannte Summen über bestimmte Zähler (z. B. "alle Wallboxen zusammen"), nur zur
  Anzeige.
- **Tariffs** - Festpreis-Registries (z. B. Netzbezugs-/Einspeisepreis) mit Gültigkeitszeiträumen.

## KPIs

Werden automatisch berechnet, sobald die benötigten Rollen konfiguriert sind - siehe
[MeterOps-Concept.md](../../MeterOps-Concept.md#kpi-catalog-fixed-code-no-user-defined-formulas)
für die genauen Formeln (auf Englisch):

| KPI | Benötigt |
|-----|----------|
| `total_consumption` (Gesamtverbrauch) | Netzbezug/-einspeisung, PV-Erzeugung, Batterie Lade-/Entladeleistung |
| `self_consumption_ratio` (Eigenverbrauchsquote) | PV-Erzeugung, Netzeinspeisung |
| `autarky` (Autarkiegrad) | Gesamtverbrauch, Netzbezug |
| `pv_share_of_consumption` (PV-Anteil am Verbrauch) | PV-Erzeugung, Netzeinspeisung, Gesamtverbrauch |
| `cop` (Leistungszahl der Wärmepumpe) | Wärmepumpe elektrisch + thermisch |
| `battery_efficiency` (Batterie-Wirkungsgrad) | Batterie Lade-/Entladeleistung |
| `specific_yield` (spezifischer Ertrag) | PV-Erzeugung, installierte kWp |
| `household_consumption` (Haushaltsverbrauch) | Gesamtverbrauch minus bekannter Unterzähler (Residualgröße) |

Von jedem KPI werden zwei Varianten geschrieben: `kpis.*` (live, aus dem kumulierten
Lebenszeitwert jedes Zählers) und `periodKpis.*` (aus der Differenz zweier periodischer
Snapshots - siehe die Anmerkung im Concept-Dokument dazu, warum Verhältnis-KPIs das brauchen, um
physikalisch sinnvoll zu bleiben, sobald Zähler unterschiedlich lange in Betrieb sind).
