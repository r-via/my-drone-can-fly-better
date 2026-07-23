// Deutsches Wörterbuch - spiegelt die französische Referenz (fr/) Schlüssel für Schlüssel.
import type { Dict } from './fr';

export const de: Dict = {
  // Regel-Engine und Drohnenprofile.
  rules: {
    noiseMechHigh: {
      title: 'Hohe mechanische Vibrationen',
      detail: (axis: string) =>
        `Das rohe Gyro-Signal (vor dem Filtern) ist auf ${axis} sehr unruhig: das ist echte mechanische Vibration, kein Tuning-Problem. Wahrscheinliche Ursache: beschädigter oder unwuchtiger Prop, verschlissenes Motorlager, lockere Frame-Schrauben.`,
      evidence: (perAxis: string, warn: number, crit: number) =>
        `Ungefiltertes Rauschen: ${perAxis} deg/s RMS (warn ${warn}, crit ${crit})`,
      fix: 'Check die Props (Risse, Wucht), dreh jeden Motor von Hand (harter Punkt = Lager hinüber), zieh die Frame-Schrauben und die FC-Befestigung nach.',
    },

    noiseFilteredLeak: {
      title: 'Restrauschen nach dem Filtern',
      detail: (axis: string) =>
        `Das gefilterte Gyro-Signal bleibt auf ${axis} verrauscht: dieses Rauschen geht direkt in den PID-Loop → nervöse Motorkommandos, heiße Motoren, Tuning unmöglich. Entweder ist das Filtern zu schwach oder die mechanische Quelle zu stark.`,
      evidence: (perAxis: string, warn: number, crit: number) =>
        `Gefiltertes Rauschen: ${perAxis} deg/s RMS (warn ${warn}, crit ${crit})`,
      fix: 'Behebe zuerst die mechanische Quelle (siehe Rohrauschen), dann verstärke das Filtern (niedrigerer Gyro-LPF-Multiplikator, RPM-Filter aktiv), falls das Rohsignal schon sauber ist.',
    },

    chassisResonance: {
      title: 'Frame-Resonanz (40-120 Hz)',
      detail:
        'Die Vibrationsenergie konzentriert sich im Band 40-120 Hz, unterhalb der Motordrehzahl: typische Signatur einer Frame-Resonanz (Arme, Kamera, Stack), angeregt durch die Motoren. Das ist die klassische Quelle für Jello im Bild.',
      evidenceHit: (axis: string, resonanceRms: string, motorRms: string) =>
        `${axis}: 40-120 Hz = ${resonanceRms} vs. Motorbereich = ${motorRms}`,
      evidencePeak: (freqHz: string, axis: string, motor: string, distanceHz: string) =>
        ` | dominanter Peak ${freqHz} Hz (Achse ${axis}), am nächsten an ${motor} (Abstand ${distanceHz} Hz)`,
      fix: 'Soft-Mounte die FC (Gummis in gutem Zustand), prüfe den festen Sitz von Armen und Kamerahalterung, ergänze TPU-Dämpfung, falls ein Teil mitschwingt.',
    },

    motorNoisePeak: {
      title: (motor: string) => `Rauschpeak auf der Grundfrequenz von ${motor}`,
      detail: (motor: string, rpmNote: string) =>
        `Der dominante Peak im Spektrum klebt an der Drehzahl von ${motor}: das Rauschen kommt von diesem Motor oder seinem Prop (Unwucht).${rpmNote}`,
      rpmNoteNoErpm:
        ' Keine eRPM-Telemetrie im Log: der RPM-Filter kann nicht arbeiten (braucht dshot_bidir und einen kompatiblen ESC).',
      rpmNoteWeakAttenuation: (attenuationDb: string) =>
        ` Die Dämpfung im Motorbereich beträgt nur ${attenuationDb} dB: der RPM-Filter scheint inaktiv oder wirkungslos, prüfe seine Konfiguration.`,
      evidence: (freqHz: string, axis: string, distanceHz: string, motor: string) =>
        `Dominanter Peak ${freqHz} Hz auf ${axis}, ${distanceHz} Hz von der Drehzahl von ${motor} entfernt`,
      fix: (motor: string) =>
        `Wuchte oder ersetze den Prop von ${motor}, prüfe die Motorwelle (nach Crash verbogen?) und den festen Sitz der Mutter.`,
    },

    filtersWeak: {
      title: 'Unzureichendes Filtern im Motorbereich',
      detail: (attenuationDb: string, axis: string) =>
        `Zwischen rohem und gefiltertem Gyro wird das Band 120-350 Hz auf ${axis} nur um ${attenuationDb} dB gedämpft: das Motorrauschen kommt durch die Filter. Ein aktiver RPM-Filter drückt dieses Band normalerweise um 20 dB oder mehr.`,
      evidence: (perAxis: string) => `Dämpfung 120-350 Hz: ${perAxis} dB (erwartet ≥ 15 dB)`,
      fix: 'Prüfe, ob der RPM-Filter aktiv ist (dshot_bidir + korrekte Motorpole), sonst senke den Gyro-Filter-Multiplikator im Tuning-Tab.',
    },

    filtersResidualHf: {
      title: 'Hochfrequenz-Leck Richtung Motoren',
      detail: (axis: string) =>
        `Im gefilterten Gyro bleibt Rauschen über 100 Hz (${axis}). Diese hohen Frequenzen landen im Motorsignal: die Motoren werden umsonst heiß und die ESCs müssen es ausbaden.`,
      evidence: (perAxis: string, warn: number) =>
        `Rest >100 Hz: ${perAxis} (spektrale Amplitude, Schwelle ${warn})`,
      fix: 'Verstärke das Gyro/D-Term-Filtern oder behebe die mechanische Quelle. Fass die Motoren nach dem Flug an: lauwarm = OK, glühend heiß = Leck bestätigt.',
    },

    trackingPoor: {
      title: 'Schwaches Setpoint-Tracking',
      detail: (axis: string, advice: string) =>
        `Das Gyro weicht auf ${axis} zu stark vom Stick-Setpoint ab: der Quad reagiert verzögert oder unpräzise. ${advice}`,
      adviceCleanGyro:
        'Das Gyro ist sauber: du kannst P (und Feedforward) auf dieser Achse anheben, um das Tracking zu straffen.',
      adviceNoisyGyro:
        'Das Gyro ist gleichzeitig verrauscht: behebe zuerst das Rausch-/Filterproblem - PIDs auf einem dreckigen Gyro hochzudrehen würde das Rauschen verstärken.',
      evidence: (perAxis: string, warn: number, crit: number) =>
        `Mittlerer Fehler: ${perAxis} deg/s (warn ${warn}, crit ${crit})`,
      fixCleanGyro: (axis: string) =>
        `Heb P und FF schrittweise auf ${axis} an (in ~10 %-Schritten), flieg erneut, vergleich nochmal.`,
      fixNoisyGyro:
        'Löse das Rauschproblem (siehe Vibrations-/Filter-Verdikte), bevor du an die PIDs gehst.',
    },

    step: {
      /** Suffix an den Evidence-Texten der Step-Regeln, wenn < 50 % der Fenster nutzbar sind. */
      qualityNote: (pct: number) => ` - begrenzte Konfidenz (${pct} % der Fenster nutzbar)`,
    },

    stepOvershoot: {
      title: (axis: string) => `Zu viel Overshoot auf ${axis}`,
      detail:
        'Die Step Response schießt deutlich über den Setpoint hinaus, bevor sie sich stabilisiert: zu viel P oder zu wenig D auf dieser Achse. Im Flug zeigt sich das als Nachwippen am Ende der Bewegung.',
      evidence: (perAxis: string, warn: number, qualityNote: string) =>
        `Overshoot: ${perAxis} % (Schwelle ${warn} %)${qualityNote}`,
      fix: (axis: string) =>
        `Senke P um etwa 10 % oder heb D um etwa 10 % auf ${axis} an, immer nur eine Änderung auf einmal.`,
    },

    stepSlow: {
      title: (axis: string) => `Träge Reaktion auf ${axis}`,
      detail: (filterNote: string) =>
        `Die Rise Time 10→90 % ist lang: der Quad braucht Zeit, um die geforderte Rate zu erreichen. ${filterNote}`,
      filterNoteGainsLow: 'P/FF vermutlich zu niedrig.',
      filterNoteAggressive: (attenuationDb: string) =>
        `Die Filter sind sehr aggressiv (${attenuationDb} dB Dämpfung): die dadurch erzeugte Gyro-Latenz kann die Trägheit erklären - entlaste das Filtern, bevor du die Gains anhebst.`,
      evidence: (perAxis: string, warnMs: number, qualityNote: string) =>
        `Rise Time: ${perAxis} ms (Schwelle ${warnMs} ms)${qualityNote}`,
      fix: 'Heb FF an (direkte Reaktion), dann bei Bedarf P; sind die Filter schuld, dreh den Gyro-LPF-Multiplikator eine Stufe hoch.',
    },

    stepSettleOff: {
      title: (axis: string) => `Versetztes Einschwingen auf ${axis}`,
      detail:
        'Nach dem Transienten pendelt sich die Antwort nicht bei 1 (dem Setpoint) ein: die erreichte Rate driftet gegenüber der Vorgabe. Typisch ist der I-Term (zu niedrig bei <1, zu hoch oder im Kampf bei >1) oder ein schlecht kalibrierter Feedforward.',
      noFfNote:
        ' Ohne Feedforward auf dieser Achse konvergiert die Antwort langsamer: ein Einschwingen leicht unter dem Setpoint im Messfenster ist teilweise zu erwarten, der I-Term schließt die Lücke danach.',
      evidence: (axis: string, settleValue: string, qualityNote: string) =>
        `Einschwingwert ${axis} = ${settleValue} (erwartet zwischen 0.85 und 1.15)${qualityNote}`,
      fix: (axis: string) =>
        `Justiere I auf ${axis}: heb ihn an, wenn die Antwort unter dem Setpoint hängen bleibt, senk ihn, wenn sie darüber bleibt.`,
    },

    motorsSaturation: {
      title: 'Motoren in Sättigung',
      detail:
        'Die Motoren hängen einen Teil des Flugs am Maximum: der PID-Loop verliert in diesen Momenten jede Autorität (Oszillationen, Wobbles beim Punch). Quad zu schwer, Gains zu hoch oder Pack zu schwach.',
      evidence: (pct: string, warn: number, crit: number) =>
        `Sättigung ${pct} % des Flugs (warn ${warn} %, crit ${crit} %)`,
      fix: 'Mach den Quad leichter oder senke den Master Multiplier; prüfe auch, ob der Pack die Spannung unter Last hält.',
    },

    motorsImbalance: {
      title: 'Ungleichgewicht zwischen den Motoren',
      detail: (motorHigh: string, motorLow: string) =>
        `${motorHigh} arbeitet deutlich härter als ${motorLow}, um den Quad gerade zu halten: verschobener Schwerpunkt (Pack, Kamera), verbogener Prop oder müder Motor auf dieser Seite.`,
      evidence: (m1: string, m2: string, m3: string, m4: string, spread: string, warn: number) =>
        `Motor-Mittelwerte: M1 ${m1} / M2 ${m2} / M3 ${m3} / M4 ${m4} % - Abstand ${spread} Pkt (Schwelle ${warn})`,
      fix: (motorHigh: string) =>
        `Zentriere den Pack auf dem Frame und inspiziere Prop/Motor ${motorHigh}.`,
    },

    motorsDesync: {
      title: (motors: string) => `Desync erkannt auf ${motors}`,
      detail:
        'Die eRPM fällt im Flug auf null: der Motor reißt ab oder der ESC verliert die Synchronisation. Das ist ein Crash auf Abruf - Problem am ESC (Firmware, Timing), an der Motorverbindung oder ein festsitzendes Lager.',
      evidence: (zeros: string) => `eRPM-Nullen im Flug pro Motor: [${zeros}]`,
      fix: (motors: string) =>
        `Prüfe Lötstellen und Stecker von Motor ${motors}, dreh ihn von Hand (harter Punkt = Lager) und check Firmware/Timing des ESC. Flieg vorher nicht wieder.`,
    },

    batterySag: {
      title: 'Starker Batterie-Sag',
      detail:
        'Die Spannung bricht unter Last stark ein: müder Pack (steigender Innenwiderstand) oder Widerstand in der Verkabelung (oxidierter XT30/XT60, Lötstellen). Weniger Punch und Abschaltrisiko am Ende des Packs.',
      evidence: (sagTotal: string, perCell: string, warn: number, crit: number, minPerCell: string) =>
        `Sag ${sagTotal} V gesamt, also ${perCell} V/Zelle (warn ${warn}, crit ${crit}) - min ${minPerCell} V/Zelle unter Last`,
      fix: 'Teste zum Vergleich mit einem frischen Pack; bleibt der Sag, inspiziere Stecker und Lötstellen der Stromkabel.',
    },

    batteryEmpty: {
      title: 'Batterie zu tief entladen',
      detail: (critPerCell: string) =>
        `Die Spannung ist im Flug unter ${critPerCell} V/Zelle gefallen: auf diesem Niveau nimmt der Pack dauerhaften Schaden (Kapazitätsverlust, Aufblähen).`,
      evidence: (minPerCell: string, critPerCell: string) =>
        `Minimum ${minPerCell} V/Zelle (Schwelle ${critPerCell} V)`,
      fix: 'Lande früher: stell einen vbat-Alarm an der Funke ein und lade diesen Pack auf Storage, um den Schaden zu bewerten.',
    },

    batteryCellsUnexpected: {
      title: 'Unerwartete Zellenzahl',
      detail: (cells: number, profileLabel: string, expectedCells: number) =>
        `Das Log zeigt einen ${cells}S-Pack, während das Profil ${profileLabel} ${expectedCells}S erwartet: falscher Pack angesteckt oder Profil falsch erkannt.`,
      evidence: (cells: number, vbatMax: string, expectedCells: number) =>
        `Erkannt ${cells}S (vbat max ${vbatMax} V), erwartet ${expectedCells}S`,
      fix: 'Prüfe den verwendeten Pack - zu viele Zellen können ESC/Motoren grillen, zu wenige würgen die Performance ab.',
    },

    batteryNotLogged: {
      title: 'Batterie fehlt im Log',
      detail:
        'Das Log enthält weder Spannung noch Strom: das BATTERY-Feld ist in den Blackbox-Einstellungen deaktiviert. Nichts ist kaputt, die Karte zeichnet diese Messwerte schlicht nicht auf - alle Batterie-Verdikte (Sag, leerer Pack, Sensor) sind für dieses Log gegenstandslos.',
      evidence: (mask: string) =>
        `fields_disabled_mask = ${mask} (BATTERY-Bit gesetzt) - kein vbat/amperage-Feld in den Frames`,
      fix: 'Aktiviere das Batterie-Logging wieder, um bei den nächsten Logs die Sag- und Spannungs-Verdikte zurückzubekommen.',
    },

    yoyoDetected: {
      titleWarn: 'Yoyo erkannt (Schuboszillation)',
      titleInfo: 'Yoyo-Verdacht (zu bestätigen)',
      detail: (confirmNote: string) =>
        `Der kollektive Schub oszilliert stärker, als der Throttle-Stick vorgibt: der Quad "pumpt" vertikal. Klassische Ursachen: zu aggressives I/Anti-Gravity, Vibrationen, die den Loop verschmutzen, oder Filter, die die Korrektur phasenverschieben.${confirmNote}`,
      confirmNote:
        ' Diese Metrik reagiert bei diesem Maschinentyp empfindlich auf den Flugstil: bestätige visuell (steigt/sinkt der Quad im Horizontalflug von allein?), bevor du irgendetwas änderst.',
      peak: (freqHz: string, mag: string) => `${freqHz} Hz (mag ${mag})`,
      evidence: (ratio: string, warn: number, peaks: string) =>
        `Ratio sd(Schub)/sd(Stick) = ${ratio} (Schwelle ${warn})${peaks ? ` - Oszillationspeaks: ${peaks}` : ''}`,
      fix: 'Senke anti_gravity_gain eine Stufe und prüfe das Gyro-Rauschen; ist die Oszillation langsam (<2 Hz), schau auch auf den I-Term.',
    },

    propwashUntested: {
      title: 'Prop Wash nicht bewertet',
      detail:
        'Der Flug enthält keinen klaren Sinkflug mit niedrigem Throttle: das Prop-Wash-Verhalten lässt sich in diesem Log nicht beurteilen.',
      evidence: 'Kein Sinkflug mit niedrigem Throttle in diesem Flug erkannt',
    },

    propwashSevere: {
      title: 'Deutlicher Prop Wash im Sinkflug',
      detail:
        'Beim Sinken durch die eigenen Wirbel zittert der Quad stark: die Props schlagen in unruhiger Luft und der PID-Loop kommt kaum hinterher. Etwas Prop Wash ist normal, auf diesem Niveau sieht man es im Bild.',
      evidence: (worst: string, warn: number, eventCount: number, avg: string | null) =>
        `Max. Schweregrad ${worst} deg/s RMS (Schwelle ${warn}) bei ${eventCount} Event(s)` +
        (avg !== null ? `, Durchschnitt ${avg}` : ''),
      fix: 'Heb D an (oder aktiviere/verstärke Dynamic Idle, wenn du den RPM-Filter hast) und flieg mit Props in gutem Zustand.',
    },

    oscillationEvent: {
      title: (freq: string | null) =>
        freq !== null ? `${freq} Hz Oszillation im Flug` : 'Oszillation im Flug',
      detail:
        'Der PID-Loop ist in Schwingung geraten: die Motoren arbeiten gegeneinander, viel zu schnell um vom Knüppel zu kommen. Das schaukelt sich von selbst auf und endet an den Anschlägen, ein Motor voll auf, der gegenüberliegende aus. Übliche Ursachen: zu viel D (oder P), Motorrauschen das mangels Filterung in den D-Term durchschlägt, oder ein Dynamic Notch der die Motorgrundfrequenzen nicht abdeckt. Die Gyro-Spitze sagt, ob die Lage gehalten hat: ein paar Dutzend °/s heißt, der Loop hat geschwungen ohne dass der Copter weggegangen ist; mehrere Hundert heißt Einschlag oder Abkippen, und das ist eine andere Geschichte.',
      evidence: (
        tStart: string,
        duration: string,
        freq: string | null,
        ratio: string,
        satPct: string,
        motors: string | null,
        others: number,
        gyroDps: string,
      ) =>
        `Bei t=${tStart} s für ${duration} s` +
        (freq !== null ? `, ${freq} Hz` : '') +
        `, Amplitude ${ratio}x des Normalniveaus, ${satPct} % der Samples am Anschlag` +
        (motors !== null ? ` (${motors})` : '') +
        `, Gyro-Spitze ${gyroDps} °/s` +
        (others > 1 ? ` - ${others} Episoden insgesamt` : ''),
      fix: 'Geh die Ursachen der Reihe nach an: zuerst die Filterabdeckung rund um die Motorgrundfrequenzen, erst danach die Gains. Zum Entscheiden denselben Flug nochmal mit dem PID-Master-Multiplikator auf 0.7: verschwindet die Oszillation, sind es die Gains; bleibt sie, ist es die Filterung.',
    },

    batteryReadingsImplausible: {
      title: 'Die Spannungs-/Strommessung des Boards versagt',
      detail: (currentNote: string) =>
        `Das Log enthält physikalisch unmögliche Spannungen: über der Leerlaufspannung, während der Copter viel Strom zieht. Unter Last kann eine Batterie nur sinken: da bricht der ADC des Boards bei Transienten ein, nicht der Akku, der sich erholt.${currentNote} Das ist weder ein Akku- noch ein Tune-Problem: es ist die Versorgungsmessung des Boards. Und solange sie lügt, arbeiten Betaflights Sag-Kompensation und Spannungsalarme mit genau diesen falschen Werten - verlass dich zum Landen nicht auf den Batterie-Beeper. Die Batterie-Urteile dieses Berichts wurden zurückgehalten, statt dir fälschlich einen toten Akku zu melden.`,
      currentNote: (ampMax: string, ampP99: string) =>
        ` Die Strommessung bricht genauso ein: ${ampMax} A als Spitze gelesen, während die gehaltene Spitze des Flugs bei etwa ${ampP99} A liegt - so eine Spitze ist ein Sensorwert, kein Strom.`,
      evidence: (count: number, vmax: string, vmin: string) =>
        `${count} Sample(s) über der Ruhespannung unter hoher Last; gelesener Bereich ${vmin} bis ${vmax} V`,
      fix: (scales: string) =>
        `Prüf die Filterung der vbat-Messung (Kondensator am Eingang), die Lötstellen der Stromkabel und die Einstellung ${scales}. Flieg zur Bestätigung erneut, bevor du irgendetwas über den Akku schließt.`,
    },

    gpsLowSats: {
      title: 'Schwache GPS-Abdeckung im Flug',
      detail:
        'Die Satellitenzahl ist während des Flugs unter 6 gefallen: GPS Rescue wäre in dem Moment nicht zuverlässig. Start vor dem vollständigen Fix oder Antenne verdeckt/gestört.',
      evidence: (min: string, max: string | null) =>
        `Satelliten: min ${min}${max !== null ? ` / max ${max}` : ''} (gesundes Minimum: 6+)`,
      fix: 'Warte vor dem Start auf 8+ Sats; halte die GPS-Antenne von VTX und Kamera fern (Störungen).',
    },

    failsafeTriggered: {
      title: 'Failsafe im Flug ausgelöst',
      detail:
        'Der Funklink war so weit weg, dass der Failsafe ausgelöst hat: Reichweite überschritten, RX-Antenne beschädigt/schlecht ausgerichtet oder Störung. Vor allem anderen zu beheben.',
      evidence: (phases: string) => `failsafePhase: {${phases}}`,
      fix: 'Prüfe die RX-Antenne (Lötstelle, Ausrichtung) und die Failsafe-Konfiguration, und mach einen Range Check, bevor du wieder weit fliegst.',
    },

    logQuality: {
      title: 'Begrenzte Log-Qualität',
      detail: (issues: string) => `Dieses Log erlaubt keine vollständige Analyse: ${issues}.`,
      issueShortLog: (durationS: string) =>
        `kurzes Log (${durationS} s): die Verdikte sind weniger zuverlässig`,
      issueLowSampleRate: (rateHz: string, nyquistHz: string) =>
        `Sampling ${rateHz} Hz: das Spektrum ist auf ${nyquistHz} Hz begrenzt (fs/2), hohes Motorrauschen kann unsichtbar bleiben`,
      evidence: (durationS: string, rateHz: string) =>
        `Dauer ${durationS} s, Sampling ${rateHz} Hz`,
      fixLowRate: 'Stell die Blackbox für die nächsten Tuning-Logs auf volle Auflösung.',
      fixShortLog: 'Flieg mindestens 30 s mit abwechslungsreichen Manövern für eine zuverlässige Diagnose.',
    },

    allGood: {
      title: 'Alles sauber',
      detail: (profileLabel: string) =>
        `Keine warn/crit-Schwelle für das Profil ${profileLabel} überschritten: Mechanik gesund, Filter wirksam und Tune stimmig in diesem Flug. Weiter so.`,
      strongUnfilt: (value: string) => `Rohrauschen max ${value} deg/s`,
      strongFilt: (value: string) => `gefiltertes Rauschen max ${value} deg/s`,
      strongTracking: (value: string) => `Tracking-Fehler max ${value} deg/s`,
      strongSaturation: (pct: string) => `Sättigung ${pct} %`,
      strongSag: (perCell: string) => `Sag ${perCell} V/Zelle`,
    },

    // Labels und Notizen der Drohnenprofile.
    profiles: {
      pico: {
        label: 'BetaFPV Pavo Pico (Cinewhoop 2S)',
        notes: [
          'Cinewhoop 2S mit Ducts: mechanisches Rauschen ist naturgemäß hoch, Schwellen entsprechend angehoben.',
          'Historisches Yoyo auf dem Schub: Ratio-Schwelle auf 1.3 gesenkt, um es früh zu erwischen.',
        ],
      },
      lr4: {
        label: 'Flywoo Explorer LR4 4" (Long Range 4S GPS)',
        notes: [
          'Long Range 4" mit GPS + Baro: Priorität auf sauberem Tracking und Pack-Gesundheit.',
          'Weniger als 6 Satelliten im Flug = GPS Rescue nicht zuverlässig, eigener Alarm dafür.',
        ],
      },
      chimera7: {
        label: 'iFlight Chimera7 Pro V2 7" (6S)',
        notes: [
          'Großer 7"-Frame: behalte das Band 40-120 Hz im Auge (Arm-/Kamera-Resonanz, Jello-Quelle).',
          'Prop-Wuchtung kritisch: ein Peak auf der Motor-Grundfrequenz ist sofort im Bild sichtbar.',
        ],
      },
      generic: {
        label: 'Generisches Profil',
        notes: ['Generisches Profil: mittlere 5"-Schwellen, Zellenzahl nicht geprüft.'],
      },
    },
  },

  // Config-Lint (CLI).
  lint: {
    rpmFilterOffBidir: {
      title: 'RPM-Filter deaktiviert, obwohl bidirektionales DShot aktiv ist',
      detail:
        'Du hast eRPM-Feedback (dshot_bidir = ON), aber der RPM-Filter ist aus. Du zahlst den Preis von DShot Bidir, ohne den besten verfügbaren Filter gegen Motorrauschen zu nutzen.',
      evidence: 'dshot_bidir = ON, rpm_filter_harmonics = 0',
      fix: 'Aktiviere den RPM-Filter wieder (3 Harmonische = Standardwert).',
    },
    noBidir: {
      title: 'Bidirektionales DShot deaktiviert',
      detail:
        'Dein Motorprotokoll ist DShot, aber ohne eRPM-Feedback. Aktiviere Bidir, um den RPM-Filter freizuschalten: Motorrauschen an der Quelle bereinigt, höhere Gyro/D-Term-LPFs, weniger Latenz (ESC-Firmware BLHeli_32, Bluejay oder AM32 nötig).',
      evidence: (protocol: string, bidirOff: boolean) =>
        `motor_pwm_protocol = ${protocol}, dshot_bidir = ${bidirOff ? 'OFF' : 'fehlt'}`,
      fix: 'Aktiviere bidirektionales DShot und dann den RPM-Filter.',
    },
    noNotchNoRpm: {
      title: 'Kein adaptives Filtern aktiv',
      detail:
        'Dynamic Notch UND RPM-Filter deaktiviert: nur die statischen LPFs schützen deine PIDs vor Motorrauschen. Reales Risiko für heiße Motoren, gesättigten D-Term und Oszillationen bei hoher Drehzahl.',
      evidence: 'dyn_notch_count = 0, rpm_filter_harmonics = 0',
      fix: 'Aktiviere mindestens einen von beiden wieder (RPM-Filter, wenn DShot Bidir verfügbar, sonst Dynamic Notch).',
    },
    tpaNeverReached: {
      title: 'TPA in diesem Flug nie erreicht',
      detail:
        'Der Throttle kam nie über den TPA-Breakpoint, die Gain-Absenkung hat also im ganzen Flug nie gegriffen und die PIDs liefen durchgehend auf vollem Wert. Gut zu wissen, bevor man ein Tune-Problem bei TPA sucht.',
      evidence: (thrMax: string, bp: string) => `max. Throttle ${thrMax} µs, tpa_breakpoint ${bp} µs`,
    },
    filterCoverageSuspect: {
      title: 'Lücke in der Filterabdeckung',
      detail:
        'Dieser Flug zeigt bereits eine Oszillation oder Rauschen, das den Loop erreicht, und die Filterung lässt eine Lücke, die das erklären könnte. Für sich genommen sind diese Einstellungen unauffällig und finden sich auf völlig gesunden Maschinen: sie werden hier nur gemeldet, weil in diesem Log ein Symptom gemessen wird. Betaflight blendet die Notches des RPM-Filters unterhalb von rpm_filter_min_hz + fade_range aus, und ein einzelner dynamischer Notch kann vier auseinanderlaufenden Motoren nicht folgen.',
      evidence: (motors: string | null, fadeTop: string | null, notch: string | null, def: number) =>
        [
          motors !== null ? `Grundfrequenzen unter der Fade-Grenze ${fadeTop} Hz: ${motors}` : null,
          notch !== null ? `dyn_notch_count = ${notch} (Standard ${def})` : null,
        ]
          .filter((x) => x !== null)
          .join('; '),
      fix: 'Erweitere die Abdeckung, bevor du an die PIDs gehst. Achtung beim Rechnen: die Obergrenze liegt bei rpm_filter_min_hz + fade_range, also muss ihre Summe unter deine niedrigste Grundfrequenz fallen, nicht min_hz allein. Geh außerdem zurück auf 3 dynamische Notches und flieg denselben Flug nochmal zum Vergleich.',
    },
    pidMasterConfirm: {
      title: 'Testflug zur Entscheidung Gains oder Filterung',
      detail:
        'Eine anhaltende Oszillation kommt entweder von zu hohen Gains oder von Rauschen das durch den D-Term kommt. Beides hinterlässt exakt dieselbe Spur im Log, und keine Messung trennt sie im Nachhinein: es braucht einen zweiten Flug. Den PID-Master zu senken behebt für sich nichts, es ist ein Test - verschwindet die Oszillation, liegt es an den Gains; bleibt sie gleich, ist es die Filterung, und den Master danach wieder hochzusetzen kostet nichts.',
      evidence: (current: string, target: string) =>
        `simplified_master_multiplier = ${current}; Testflug vorgeschlagen bei ${target}`,
      fix: 'Setz diesen Wert, flieg exakt denselben Flug und vergleich die beiden Logs. Stell danach deinen ursprünglichen Wert wieder her: diese Einstellung ist ein Test, keine Korrektur.',
    },
    dtermLpfLow: {
      title: 'D-Term-LPF1 sehr niedrig',
      detail: (hz: string) =>
        `Ein D-Term-LPF1 bei ${hz} Hz fügt dem D viel Latenz hinzu: weiche Dämpfung und verstärkter Prop Wash. Unter 70 Hz ist das auf einem gesunden Quad selten gerechtfertigt.`,
      evidence: (hz: string) => `dterm_lpf1_static_hz = ${hz}`,
      fix: 'Heb den D-Term-LPF1 Richtung 75-90 Hz an (oder geh zurück in den dynamischen Modus).',
    },
    gyroLpfLow: {
      title: 'Konservativer Gyro-LPF trotz RPM-Filter',
      detail: (harmonics: string, hz: string) =>
        `Mit aktivem RPM-Filter (${harmonics} Harmonische) ist ein statischer Gyro-LPF1 bei ${hz} Hz vermutlich zu niedrig: du fügst Latenz für Rauschen hinzu, das schon behandelt wird.`,
      evidence: (key: string, hz: string, harmonics: string) =>
        `${key} = ${hz}, rpm_filter_harmonics = ${harmonics}`,
      fix: 'Versuch, den Gyro-LPF1 anzuheben (250 Hz Standard), und prüfe das Restrauschen beim nächsten Flug.',
    },
    ffZero: {
      title: 'Feedforward auf null',
      detail:
        'Ohne Feedforward reagiert der Quad nur auf den bereits vorhandenen Fehler: die Stick-Antwort ist verzögert. Ok für sehr weiches Cinematic-Fliegen, hinderlich in Freestyle/Race.',
      fix: 'Stell wieder Feedforward ein (≈100-125 in 4.5), wenn du eine direkte Stick-Antwort willst.',
    },
    antigravityOff: {
      title: 'Anti-Gravity deaktiviert',
      detail:
        'anti_gravity_gain = 0: der I-Term wird bei schnellen Throttle-Änderungen nicht geboostet, die Nase kann bei Punch-Outs abtauchen oder pumpen.',
      evidence: 'anti_gravity_gain = 0',
      fix: 'Stell den Standardwert wieder ein, falls das keine bewusste Entscheidung ist.',
    },
    motorLimit: {
      title: 'Motor-Output-Limit aktiv',
      detail: (pct: string) =>
        `motor_output_limit = ${pct}%: der maximale Schub ist gedrosselt. Nur ein Hinweis, falls das nicht gewollt ist (oft genutzt, um mit einer Batterie höherer Spannung zu fliegen).`,
      evidence: (pct: string) => `motor_output_limit = ${pct}`,
    },
    vbatWarning: {
      title: 'Ungewöhnliche Batterie-Warnschwelle',
      detail: (volts: string) =>
        `Batteriealarm auf ${volts} V/Zelle eingestellt, außerhalb des üblichen Bereichs 3.2-3.6 V: du wirst zu früh oder zu spät gewarnt.`,
      evidence: (raw: string, volts: string) =>
        `vbat_warning_cell_voltage = ${raw} (${volts} V/Zelle)`,
      fix: 'Ziel 3.4-3.5 V/Zelle für klassische LiPo-Nutzung.',
    },
  },

  // Systemmeldungen: Parser, Worker, Client.
  system: {
    noBlackboxHeader: 'Kein Blackbox-Header gefunden (Datei keine .bbl?)',
    sessionTooShort: (frames: string) =>
      `Session zu kurz (${frames} Frames) - vermutlich ein Arming-Blip`,
    flightTooShort: (seconds: string, minimum: string) =>
      `Flug zu kurz (${seconds} s) - für eine verlässliche Analyse braucht es mindestens ${minimum} s`,
    cliSessionSkipped: (n: string, kb: string) => `Session ${n} übersprungen (${kb} kB)`,
    cliProfile: (label: string) => `Profil ${label}`,
    cliVbatUnusable: (cells: string, count: string) =>
      `${cells}S vbat nicht messbar (${count} unplausible Samples)`,
    cliVbatRange: (cells: string, max: string, min: string, sag: string) =>
      `${cells}S ${max}→${min} V (Sag ${sag} V)`,
    cliCurrentMax: (amps: string) => `max. Strom ${amps} A`,
    cliCurrentUnreliable: 'Strom: Sensor unzuverlässig, Wert verworfen',
    headersUnreadable: 'Header unlesbar (Session beschädigt?)',
    dataVersionUnsupported: 'Datenversion dem Decoder unbekannt (beschädigtes Log-Fragment?)',
    decoderRejected: (raw: string) => `Dekodierung nicht möglich: ${raw}`,
    noFramesDecoded: 'Keine Frames dekodiert (Daten beschädigt?)',
    essentialFieldsMissing: 'Essenzielle Felder fehlen (gyroADC/setpoint/motor/rcCommand)',
    firmwareTooOld: (version: string, minimum: string) =>
      `Firmware zu alt (Betaflight ${version}) - der Decoder braucht mindestens ${minimum}`,
    firmwareNotSupported: (flavour: string) =>
      `Firmware nicht unterstützt: ${flavour} - nur Betaflight wird zuverlässig dekodiert`,

    wasmLoadFailed: (httpStatus: string) =>
      `WASM-Decoder konnte nicht geladen werden (HTTP ${httpStatus})`,
    progressLoadingDecoder: 'Decoder wird geladen…',
    progressDecoding: (fileName: string) => `Dekodiere ${fileName}…`,
    progressAnalyzing: 'Analyse (FFT, Step Response, Regeln)…',

    progressPreparing: 'Vorbereitung…',
    workerUnexpectedError: 'Unerwarteter Fehler im Worker',
  },

  // Oberfläche (Layout, Seite, Komponenten, Graphen).
  ui: {
    app: {
      logo: 'MY DRONE CAN FLY BETTER',
      headerTagline: 'Analyse 100 % lokal - deine Logs verlassen deinen Browser nicht.',
      footer:
        'Deterministische Analyse - jedes Verdikt ist auf eine explizite Regel zurückführbar. Es wird nichts ohne deine Zustimmung gesendet.',
      languageLabel: 'Sprache',
      supportKofi: 'Auf Ko-fi unterstützen',
      footerKofi: 'Diese Seite rettet dir Packs? Spendier einen Kaffee:',
      joinDiscord: 'Discord',
      viewSource: 'Quellcode auf GitHub',
      updateAvailable: 'Neue Version verfügbar',
      updateReload: 'Neu laden',
      updateDismiss: 'Später',
    },

    credits: {
      title: 'Danksagung',
      intro:
        'Danke an die Piloten, die die Seite vorangebracht haben: Tests, geteilte Logs, gemeldete Bugs und gute Ideen.',
    },

    units: {
      mega: 'MB',
      kilo: 'KB',
    },

    page: {
      heroTagline: 'Dein Flug, dekodiert.',
      heroIntro:
        'Zieh deine Betaflight-Blackbox-Logs rein: My Drone Can Fly Better dekodiert sie und liefert dir Verdikte mit Zahlen - Vibrationen, Filter, PID, Motoren, Batterie - samt CLI-Kommandos zum direkten Einfügen. Kein Upload: nur Signal und Regeln, alles nachvollziehbar.',
      heroAria: 'Überblick',
      steps: [
        {
          title: 'Zieh deine Logs rein',
          text: '.bbl oder .bfl, direkt von der SD-Karte oder aus der GUI. Auch mehrere Dateien auf einmal.',
        },
        {
          title: 'Lokale Analyse',
          text: 'Dekodierung, DSP und deterministische Regeln - alles läuft in deinem Browser, nichts geht an einen Server.',
        },
        {
          title: 'In 30 s korrigiert',
          text: 'Verdikte mit Zahlen, Graphen und CLI-Kommandos zum direkten Einfügen in Betaflight.',
        },
      ],
      uploadAria: 'Log-Ablage',
      analyzeButton: (count: number): string =>
        count > 1 ? `${count} Logs analysieren` : 'Log analysieren',
      workingFallback: 'Analyse läuft…',
      readingFiles: 'Dateien werden gelesen…',
      privacyNote: 'Läuft in deinem Browser - nichts wird irgendwohin gesendet.',
      errorTitle: 'Analyse nicht möglich',
      errorUnknown: 'Unbekannter Fehler.',
      readErrorNotReadable:
        'Datei unlesbar - vielleicht wurde die SD-Karte ausgeworfen oder die Datei hat sich seit der Auswahl geändert. Wähl sie erneut aus.',
      readErrorWithMessage: (message: string): string =>
        `Datei konnte nicht gelesen werden: ${message}`,
      readErrorGeneric: 'Datei konnte nicht gelesen werden.',
    },

    upload: {
      dropTitle: 'Zieh deine Blackbox-Logs hierher',
      dropBrowse: ' - oder klick zum Durchsuchen',
      dropHelp: '.bbl / .bfl · mehrere Dateien möglich · nichts verlässt deinen Browser',
      rejected: (names: string): string => `Ignoriert (weder .bbl noch .bfl): ${names}`,
      selectedFilesAria: 'Ausgewählte Dateien',
      removeFile: (name: string): string => `${name} entfernen`,
    },

    severity: {
      crit: 'Kritisch',
      warn: 'Achtung',
      info: 'Info',
      ok: 'OK',
    },
    verdict: {
      ok: 'Top - nichts zu beanstanden',
      info: 'Sauber - ein paar Beobachtungen',
      warn: 'Im Blick behalten - ein paar Punkte zu beheben',
      crit: 'Kritisch - beheb das, bevor du wieder fliegst',
    },

    categories: {
      securite: 'Sicherheit',
      vibrations: 'Vibrationen',
      filtres: 'Filter',
      pid: 'PID',
      moteurs: 'Motoren',
      batterie: 'Batterie',
      config: 'Config',
      gps: 'GPS',
      log: 'Log',
    },

    finding: {
      evidenceSummary: 'Die Zahlen hinter diesem Verdikt',
      fixTitle: 'Fix',
    },

    metricTone: {
      ok: 'Status: gut',
      warn: 'Status: im Blick behalten',
      crit: 'Status: kritisch',
    },

    sessionPicker: {
      listAria: 'Sessions der Datei',
    },

    notFound: {
      text: 'Diese Seite existiert nicht.',
      cta: 'Zurück zur Analyse',
    },

    report: {
      title: 'Flugbericht',
      newAnalysis: 'Neue Analyse',
    flightsAria: 'Analysierte Flüge',
      fileAria: (fileName: string): string => `Bericht ${fileName}`,
      validSessions: (count: number): string =>
        `${count} ${count > 1 ? 'gültige Sessions' : 'gültige Session'}`,
      skippedSessions: (count: number): string => `${count} ignoriert`,
      skippedSession: (index: string, error: string, size: string): string =>
        `Session ${index} ignoriert - ${error} (${size})`,
      skippedOrphanSummary: (count: number): string =>
        count > 1
          ? `${count} ignorierte Sessions - Dateien ohne nutzbaren Flug`
          : `1 ignorierte Session - Datei ohne nutzbaren Flug`,
      skippedInFileSummary: (count: number): string =>
        count > 1
          ? `${count} weitere ignorierte Sessions in dieser Datei`
          : `1 weitere ignorierte Session in dieser Datei`,
      sessionLabel: (index: string): string => `Session ${index}`,
      sessionSublabel: (duration: string, start: string): string => `${duration} · t+${start}`,
      noUsableSession: 'Keine nutzbare Session in dieser Datei - siehe Gründe oben.',
      axisNotEvaluated: (label: string): string => `${label}: nicht bewertet - Daten fehlen im Log`,
      scoreCappedNote: 'Score auf 95 gedeckelt: eine Achse wurde nicht gemessen (graues Segment).',
      axisNoData: 'nicht bewertet - Daten fehlen',
      axisShare: (pct: number): string => `${pct} % des Scores`,
      axisGoto: 'Klick: zu den Verdikten dieser Achse springen',
      axisDetails: {
        securite: 'Failsafe im Flug ausgelöst.',
        vibrations: 'Mechanisches Rauschen des rohen Gyros, Rahmenresonanz, Unwucht von Prop/Motor.',
        filtres: 'Dämpfung des Motorrauschens, Restrauschen nach dem Filtern, Hochfrequenz-Leckage.',
        pid: 'Setpoint-Folgung, Sprungantwort (Überschwingen, Trägheit, Einschwingen), Oszillationen, Prop wash, Yoyo.',
        moteurs: 'Sättigung, Ungleichgewicht zwischen Motoren, Desyncs.',
        batterie: 'Sag unter Last, Tiefentladung, Sensorplausibilität, Zellenzahl.',
      },
      profileTag: (label: string): string => `Profil ${label}`,
      tileDuration: 'Session-Dauer',
      tileSampleRate: 'Sampling',
      tileBattery: 'Batterie',
      batterySag: (sag: string, perCell: string): string => `Sag ${sag} V (${perCell} V/Zelle)`,
      batteryRange: (min: string, max: string): string => `${min}-${max} V`,
      batteryNoVbat: 'keine vbat-Messung',
      tileMaxCurrent: 'Max. Strom',
      currentAvg: (avg: string): string => `Durchschnitt ${avg} A`,
      currentUnreliable: 'Sensor unzuverlässig, Wert verworfen',
      tileSaturation: 'Motor-Sättigung',
      tileFlightTime: 'Flugzeit',
      flightTimeHint: 'Throttle tatsächlich in der Luft',
      timelineCaption: 'Flug-Timeline',
      timelineEventLine: (
        tStart: string,
        duration: string,
        freq: string,
        ratio: string,
        satPct: string,
        motors: string | null,
        gyroDps: string,
      ): string =>
        `Oszillation gemessen bei ${tStart} s, über ${duration} s: ${freq} Hz auf dem Motordifferential, Amplitude ${ratio} mal das normale Niveau dieses Flugs, ${satPct} % der Samples mit mindestens einem Motor am Anschlag` +
        (motors !== null ? ` (${motors})` : '') +
        `. Gyro-Spitze während der Episode: ${gyroDps} °/s.`,
      timelineEventIntro: 'Was die Messung sagt, ohne Interpretation:',
      noFindings: 'Keine Regel hat in dieser Session ausgelöst.',
    },

    cli: {
      sectionAria: 'CLI-Kommandos',
      title: 'CLI-Kommandos',
      countSuffix: (count: number): string => `(${count} + save)`,
      nothingToFix: 'Nichts zu fixen auf CLI-Seite - deine Config passt.',
      copyAll: 'Alles kopieren',
      copied: 'Kopiert!',
      copiedSr: 'Kommandos in die Zwischenablage kopiert',
      verifyNote: 'Prüf jede Zeile vor dem Einfügen - du fliegst den Quad, nicht der Bericht.',
      saveWarnBefore: 'Speichere per ',
      saveWarnCode: 'save',
      saveWarnAfter:
        ' im CLI, nicht mit dem Save-Button der GUI: auf manchen Versionen kann er deine komplette Config löschen (bekannter Bug).',
    },

    // Opt-in-Switch: rohe .bbl-Datei mit dem Dev teilen (unten in ReportView).
    shareLog: {
      title: 'Hilf mit, das Tool zu verbessern',
      description:
        'Schickt das/die rohe(n) .bbl-Log(s) dieser Analyse an Rémi (den Dev der Seite): die Datei landet im privaten Speicher der Seite und ein Download-Link wird in einen privaten Kanal gepostet. Hilft, echte Fälle zu finden, die die Regeln übersehen. Es wird nichts gesendet, bevor du auf den Button klickst.',
      buttonLabel: (count: number): string =>
        count > 1 ? `${count} Logs teilen` : 'Dieses Log teilen',
      sending: 'Wird gesendet…',
      sendingPart: (done: number, total: number): string => `Sende ${done}/${total}…`,
      sent: 'Log gesendet - danke!',
      error: 'Senden fehlgeschlagen - versuch es später noch mal.',
      tooLarge: 'Über 100 MB Logs - zu groß für den automatischen Versand.',
    },

    shareLink: {
      title: 'Diesen Bericht teilen',
      description:
        'Der ganze Bericht steckt im Link selbst: nichts wird auf einem Server abgelegt, und dein .bbl verlässt deinen Rechner nicht. Wer ihn öffnet, sieht diesen Bericht in seiner eigenen Sprache.',
      button: 'Link kopieren',
      copied: 'In die Zwischenablage kopiert',
      copiedSr: 'Teilen-Link in die Zwischenablage kopiert',
      building: 'Wird vorbereitet…',
      error: 'Link konnte nicht erstellt werden.',
      charCount: (n: number): string => `${n} Zeichen`,
      trimmed:
        'Die Diagramme haben nicht in den Link gepasst: er trägt Score, Verdikte und Zahlen, aber keine Kurven.',
      overBudget:
        'Dieser Link überschreitet die 2000 Zeichen einer Discord-Nachricht. Er funktioniert, muss aber anders verschickt werden (DM, Forum, URL-Kürzer).',
      bannerTitle: 'Bericht per Link erhalten',
      bannerText:
        'Dieser Bericht wurde auf dem Rechner einer anderen Person berechnet und dann in die Adresse kodiert. Für deinen eigenen Flug fang mit einem Log an.',
      bannerCta: 'Mein Log analysieren',
      decodeErrorMalformed: 'Dieser Teilen-Link ist unvollständig oder beschädigt.',
      decodeErrorVersion:
        'Dieser Link stammt aus einer neueren Version der Seite. Lade die Seite neu und frag ihn noch einmal an.',
    },

    chartHelp: {
      buttonLabel: 'Lesehilfe',
      buttonAria: (chart: string): string => `Lesehilfe: ${chart}`,
      closeAria: 'Hilfe schließen',
      readTitle: 'So liest du sie',
      examplesTitle: 'Beispiele',
      goodTag: 'Gut',
      badTag: 'Nicht gut',
      timeline: {
        title: 'Die Flug-Timeline',
        intro:
          'Dieser Streifen erzählt die Session von links nach rechts: was der Quad gerade tat (am Boden, wenig Gas, im Flug), darüber die Akkuspannung und die erkannten Vorfälle.',
        points: [
          'Jede Farbe ist ein Zustand: die grünen Blöcke sind die Momente wirklich im Flug.',
          'Die gelbe Linie ist die Akkuspannung: sie soll im Flug langsam und gleichmäßig sinken.',
          'Ein Warndreieck markiert einen erkannten Vorfall: die Position sagt wann, das Etikett die gemessene Frequenz.',
          'Ein steiler Absturz der gelben Linie heißt: der Akku bricht unter Last ein (verschlissen oder überfordert).',
        ],
        examples: {
          good: 'Durchgehender Flug, Spannung in sanfter Neigung, keine Marker: nichts zu melden.',
          bad: 'Warnmarker mitten im Flug und ruckartig einbrechende Spannung: Vorfälle beheben, der Akku leidet.',
        },
      },
      spectrum: {
        title: 'Das Gyro-Spektrum',
        intro:
          'Ein Quad vibriert immer ein wenig. Dieses Diagramm sortiert die Vibrationen nach Frequenz (in Hz): links die langsamen, rechts die schnellen. Je höher ein Peak, desto stärker die Vibration.',
        points: [
          'Ein schmaler Peak nahe der gestrichelten „Motoren“-Linie ist normal: das ist die Drehung der Propeller.',
          'Das „Resonanz“-Band muss niedrig bleiben: ein Buckel dort ist der Rahmen, der mitschwingt (Jello im Bild).',
          'Überall sonst soll die Kurve unten am „Boden“ kleben.',
          'Die drei Farben sind die drei Achsen (Roll, Pitch, Yaw): sie sollten sich ähneln.',
          'Enden die Kurven vor dem rechten Rand (schraffierte Zone „nicht messbar“), wurde das Log zu langsam aufgezeichnet: oberhalb der halben Aufzeichnungsrate kann das Spektrum nichts sehen. Zeichne schneller auf (blackbox_sample_rate), um den ganzen Bereich abzudecken.',
        ],
        examples: {
          good: 'Niedriger, flacher Boden, ein einziger schmaler Peak bei der Motorfrequenz: gesunder Quad.',
          bad: 'Breiter Buckel im Resonanzband und belasteter Boden: mechanische Vibrationen - Propeller, Lager und Verschraubung prüfen.',
        },
      },
      step: {
        title: 'Die Sprungantwort',
        intro:
          'Wir simulieren einen zackigen Stick-Ausschlag und schauen, wie der Quad dem Befehl folgt. Die gestrichelte Linie „Ziel 1.0“ ist genau der Befehl: die ideale Kurve steigt schnell dorthin und bleibt dort.',
        points: [
          'Die Kurve soll schnell Richtung Ziel steigen: je früher, desto schneller reagiert der Quad.',
          'Ein leichtes Überschwingen über das Ziel (unter ~15 %) ist in Ordnung.',
          'Nach der Spitze soll sich die Kurve ohne Wellen auf die Ziellinie legen.',
          'Wiederholte Schwinger heißen: der Quad oszilliert nach jedem Befehl, der Tune ist zu nervös.',
        ],
        examples: {
          good: 'Zackiger Anstieg, leichtes Überschwingen, dann legt sich die Kurve aufs Ziel: ausgewogener Tune.',
          bad: 'Starkes Überschwingen mit Nachschwingern: der Quad überreagiert und oszilliert (P zu hoch oder D zu niedrig).',
          badSlow:
            'Träger Anstieg, der das Ziel erst sehr spät erreicht: der Quad hängt den Sticks hinterher (P zu niedrig oder Filter zu schwer).',
        },
      },
    },

    charts: {
      spectrum: {
        title: 'Gyro-Spektrum (0-1 kHz)',
        scaleNote: 'Gyro-Amplitude - √-Skala (dominante Peaks bleiben vergleichbar)',
        ariaLabel: (title: string): string => `${title} - Roll, Pitch und Yaw überlagert`,
        bandResonance: 'Resonanz',
        bandMotors: 'Motoren',
        xAxis: 'Frequenz (Hz)',
        motorLine: (hz: string): string => `Motoren ~${hz} Hz`,
        beyondNyquist: (hz: string): string => `nicht messbar - Log mit ${hz} Hz aufgezeichnet`,
      },
      step: {
        title: 'Step Response (0-500 ms)',
        ariaLabel: 'Step Response Roll, Pitch, Yaw - Ziel 1.0, Fenster 0 bis 500 ms',
        overshootZone: 'Overshoot-Zone',
        targetLine: 'Ziel 1.0',
        xAxis: 'Zeit (ms)',
        axisMissing: (axis: string): string => `${axis} (n/a)`,
        noData: 'Nicht genug Stick-Anregung, um die Antwort zu schätzen.',
      },
      timeline: {
        ariaLabel: (duration: string, segmentCount: string): string =>
          `Log-Timeline: ${duration}, ${segmentCount} Segmente (am Boden / Throttle niedrig / im Flug)`,
        stateIdle: 'am Boden',
        stateLow: 'Throttle niedrig',
        stateFlight: 'im Flug',
        vbat: 'vbat',
        noSegments: 'Keine Segmente erkannt.',
        eventsAria: (count: string, times: string): string =>
          `${count} Event(s) markiert bei ${times}`,
        eventsLegend: 'Oszillation erkannt',
      },
    },
  },

  compare: {
    title: 'Vergleich der Durchgänge',
    tabLabel: 'Vergleich',
    tabCount: (n: number): string => `${n} ${n > 1 ? 'Paare' : 'Paar'}`,
    heading: (before: string, after: string) => `${before} → ${after}`,
    sessionLabel: (fileName: string, session: string) => `${fileName} Session ${session}`,
    noTuneChange:
      'Zwischen diesen beiden Flügen wurde keine Einstellung geändert: die Unterschiede unten kommen vom Fliegen, nicht vom Tune.',
    summaryNoChange: 'keine Einstellung geändert',
    summaryChanges: (n: number) => `${n} ${n > 1 ? 'Einstellungen geändert' : 'Einstellung geändert'}`,
    caveatsCount: (n: number) => `${n} ${n > 1 ? 'Vorbehalte' : 'Vorbehalt'}`,
    tuneTitle: 'Was sich geändert hat',
    metricsTitle: 'Was die Messung dazu sagt',
    driverNote:
      'Die vereinfachten Regler stehen oben: sie berechnen die darunter gelisteten Gains neu, nicht umgekehrt.',
    deltaUnavailable: 'andere Achsen',
    metricUnavailable: 'n/v',

    metrics: {
      filtNoise: 'Gefiltertes Rauschen (deg/s)',
      unfiltNoise: 'Rohes Rauschen (deg/s)',
      tracking: 'Folgefehler (deg/s)',
      overshoot: 'Überschwingen (%)',
      riseTime: 'Anstiegszeit (ms)',
      ms: 'Empfindlichkeitsgipfel Ms',
      residualHf: 'Rest >100 Hz',
      propwash: 'Propwash (deg/s)',
      saturation: 'Motorsättigung (%)',
    },

    caveats: {
      inferredCraft: (board: string) =>
        `Flüge nach Board (${board}) gruppiert, weil die Logs keinen Craft-Namen tragen: setz einen craft_name, um den Zweifel auszuräumen. Stammen diese Flüge von zwei verschiedenen Maschinen auf demselben Board, ist der Vergleich sinnlos.`,
      firmware: (before: string, after: string) =>
        `Anderes Firmware (${before} → ${after}): ein Tune lässt sich nicht zwischen Hauptversionen übertragen, und Parameter ändern Namen oder Bedeutung. Der Einstellungsvergleich ist nicht verlässlich.`,
      sampleRate: (before: string, after: string) =>
        `Andere Abtastrate (${before} → ${after} Hz): Restrauschen und Spektrum sind zwischen diesen Logs nicht vergleichbar.`,
      duration: (before: string, after: string) =>
        `Sehr unterschiedliche Dauer (${before} s → ${after} s): der kürzere Flug hat weniger Situationen gesehen, seine Spitzenwerte fallen zwangsläufig niedriger aus.`,
      stickRange: (before: string, after: string) =>
        `Andere Knüppelforderung (${before} → ${after} deg/s Maximum): ein ruhigerer Flug senkt Überschwingen und Propwash, ohne dass eine Einstellung beteiligt wäre.`,
      mechanical: (before: string, after: string) =>
        `Das rohe Gyro hat sich verändert (${before} → ${after} deg/s RMS). Es reagiert nicht auf den Tune: zwischen den beiden Flügen hat sich mechanisch etwas bewegt (Propeller, Lager, Schrauben). Unterschiede im gefilterten Rauschen messen damit nicht mehr allein die Filterung.`,
      battery: (before: string, after: string) =>
        `Sehr unterschiedlicher Sag pro Zelle (${before} → ${after} V) ohne aktive Kompensation: derselbe Sollwert ergibt nicht denselben Schub. Aktiviere vbat_sag_compensation oder flieg erneut bei vergleichbarem Akkustand.`,
    },
  },
};
