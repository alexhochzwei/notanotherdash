# Not Another Dash

Ein Home-Assistant-Dashboard für Wandtablets, das sich aus deinen Bereichen und Stockwerken aufbaut. Ausgelegt auf ältere iPads (Safari 15), ohne Build-Schritt.

Aufbau und Ideen angelehnt an [HausPanel](https://github.com/alpacalabs-de/hauspanel) (MIT).

## Stand

- **Übersicht:** Kopfzeile (Datum, Uhrzeit, Wetter, Status), Seitenleiste (Müllkalender, Abfahrten), Raumkacheln nach Stockwerken, Einstellungen (Zahnrad unten rechts gedrückt halten).
- **Raumansicht** (Raumkachel antippen): Szenen, Heizung mit Drehrad (Ziehen nach rechts = wärmer, gesendet beim Loslassen), Presets, einzelne Heizkörper, 24-h-Temperaturverlauf; Lichter (Tippen schaltet, seitlich Wischen dimmt); Rollläden hochkant (Ziehen stellt die Position ein, Gruppe antippen zeigt die einzelnen).

- **Energie:** Gas pro Tag mit erwartetem Verbrauch aus der Außentemperatur (Heizgradtage, Ausgleichsgerade über die letzten 30 Tage), Monatssumme mit Abweichung, Prognose für 7 Tage aus der Wettervorhersage, Strom heute je Stunde und aktuelle Leistung. Daten aus den Langzeitstatistiken des Recorders.
- **Sauger:** Status, Start/Pause/Station, Raumauswahl, Saugkraft, Wisch-Einstellungen (Select-Entitäten des Geräts) und Restlaufzeiten der Verschleißteile.

- **Klima:** alle Räume mit Ist- und Solltemperatur, Status und Presets für alle Räume auf einmal.
- **Licht:** alle Lichter nach Räumen (Tippen schaltet, Wischen dimmt), „Alle aus“.
- **Kameras:** Standbilder (alle 10 s), Antippen für das Live-Bild.
- **Zweite Ebene in der Raumansicht:** Pfeil in der Heizungskarte (jedes Thermostat einzeln, Betriebsart, Presets) und langes Drücken auf ein Licht (Helligkeit, Farbtemperatur, Farbe).
- **Abfahrten:** ganze Haltestelle der Integration [ha_departures](https://github.com/alex-jung/ha-departures) (alle Linien zusammengeführt, Verspätung, Ausfälle) oder einzelne Sensoren.

### Energie einrichten

Einstellungen → „Energie & Sauger“: Gaszähler und Stromzähler (Zählerstand mit `state_class: total_increasing`), aktuelle Leistung, Heizgrenze (Standard 15 °C). Die Außentemperatur kommt aus „Kopfzeile & Leiste“; sie braucht Langzeitstatistik (`state_class: measurement`). Ein Min/Max-Helfer hat das.

### Roborock einrichten

Für die interaktive Karte die Integration [Roborock Custom Map](https://github.com/Python-roborock/RoborockCustomMap) installieren (HACS, benutzerdefiniertes Repository). Sie liefert eine Bild-Entität (`image.…_custom`) mit Kalibrierungspunkten und Raumumrissen; das Dashboard findet sie automatisch und legt die Raumnamen auf die Karte. Antippen wählt Räume aus.

Einstellungen → „Energie & Sauger“: Saugroboter wählen, „Räume laden“ (aus der Karte und `roborock.get_maps`) und jedem Bereich seinen Roborock-Raum zuordnen; daraus kommen die Namen auf der Karte. Gereinigt wird mit `vacuum.send_command` / `app_segment_clean`.

## Installation

**HACS** (nur mit öffentlichem Repo): HACS → Benutzerdefinierte Repositories → `https://github.com/alexhochzwei/notanotherdash`, Typ „Integration“. Installieren, Home Assistant neu starten.

**Manuell** (auch bei privatem Repo), z. B. bei HA Container:

```bash
git clone https://github.com/alexhochzwei/notanotherdash.git /opt/notanotherdash
ln -s /opt/notanotherdash/custom_components/notanotherdash /pfad/zu/ha-config/custom_components/notanotherdash
# Update: git -C /opt/notanotherdash pull, danach HA neu starten
```

Hinweis für Docker: Ein Symlink muss innerhalb des Containers auflösbar sein. Sonst den Ordner kopieren oder `/opt/notanotherdash` zusätzlich in den Container mounten.

Danach: Einstellungen → Geräte & Dienste → Integration hinzufügen → „Not Another Dash“. Das Panel erscheint als „Dashboard“ in der Seitenleiste.

## Regeln (kein Raten)

- **Räume** sind die Bereiche aus HA, gruppiert nach Stockwerken (Erdgeschoss, aufwärts, Keller, dann Bereiche ohne Stockwerk).
- **Zuordnung:** Der Bereich der Entität gilt vor dem des Geräts.
- **Ausblenden:** In HA versteckte oder deaktivierte Entitäten, Diagnose-/Konfigurations-Entitäten sowie alles mit dem Label **„Dashboard aus“** (`dashboard_aus`) – an Entität, Gerät oder Bereich. Ganze Räume lassen sich auch in den Einstellungen ausblenden.
- **Raumtemperatur/-feuchte:** aus der Bereichseinstellung in HA; ohne Eintrag die Ist-Temperatur des Thermostats im Raum.
- **Szenen** eines Raums: Szenen-Entitäten, die dem Bereich zugeordnet sind. **CO₂:** Sensoren mit Geräteklasse `carbon_dioxide`.
- **Fenster:** `binary_sensor` mit Geräteklasse `window` oder `opening`. **Anwesenheit:** `motion`, `occupancy`, `presence`.

## Einstellungen

Zahnrad unten rechts **gedrückt halten**. Gespeichert wird in Home Assistant (`.storage/notanotherdash.settings`) und gilt für alle Geräte; der Lite-Modus gilt nur für das jeweilige Gerät.

- **Außentemperatur:** eigener Sensor statt Wetterdienst. Mehrere Sensoren am besten in HA mit einem Min/Max-Helfer (Typ „Minimum“) zusammenfassen.
- **Abfahrten:** Haltestelle (Gerät) der Integration ha_departures, deren Sensoren `line_name`, `direction` und `times` liefern; alternativ ein Sensor mit einer Liste in `departures`, `next_departures` oder `journeys`.

## Entwicklung

```bash
npm test                        # Tests für das Datenmodell (Node 18+)
NOTANOTHERDASH_DEV=1            # Umgebungsvariable für HA: Frontend ohne Cache ausliefern
```
