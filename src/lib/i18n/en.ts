// English dictionary - mirrors the French reference (fr/) key for key.
// Plain strings stay plain strings, interpolated strings are arrow functions
// with the exact same signatures as the French source. Numbers arrive
// pre-formatted (string) whenever the engine formats them (f0/f1/f2).
import type { Dict } from './fr';

export const en: Dict = {
  // Rule engine strings (engine.ts) and drone profiles.
  rules: {
    noiseMechHigh: {
      title: 'High mechanical vibrations',
      detail: (axis: string) =>
        `The raw gyro (before filtering) is very agitated on ${axis}: this is real mechanical vibration, not a tune problem. Likely cause: damaged or unbalanced prop, worn motor bearing, loose frame hardware.`,
      evidence: (perAxis: string, warn: number, crit: number) =>
        `Unfiltered noise: ${perAxis} deg/s RMS (warn ${warn}, crit ${crit})`,
      fix: 'Inspect the props (cracks, balance), spin each motor by hand (rough spot = dead bearing), tighten the frame hardware and the FC mount.',
    },

    noiseFilteredLeak: {
      title: 'Residual noise after filtering',
      detail: (axis: string) =>
        `The filtered gyro is still noisy on ${axis}: that noise feeds straight into the PID loop, so you get twitchy motor commands, hot motors, and a tune you can't dial in. Either the filtering is too light or the mechanical source is too strong.`,
      evidence: (perAxis: string, warn: number, crit: number) =>
        `Filtered noise: ${perAxis} deg/s RMS (warn ${warn}, crit ${crit})`,
      fix: 'Fix the mechanical source first (see raw noise), then beef up the filtering (lower gyro LPF multiplier, active RPM filter) if the raw signal is already clean.',
    },

    chassisResonance: {
      title: 'Frame resonance (40-120 Hz)',
      detail:
        'Vibration energy piles up in the 40-120 Hz band, below motor rotation: the signature of a frame resonance (arms, camera, stack) excited by the motors. This is the classic source of jello in the footage.',
      evidenceHit: (axis: string, resonanceRms: string, motorRms: string) =>
        `${axis}: 40-120 Hz = ${resonanceRms} vs motor range = ${motorRms}`,
      evidencePeak: (freqHz: string, axis: string, motor: string, distanceHz: string) =>
        ` | dominant peak ${freqHz} Hz (axis ${axis}), closest to ${motor} (gap ${distanceHz} Hz)`,
      fix: 'Soft-mount the FC (grommets in good shape), check the arm and camera mount screws, add TPU damping if a part is vibrating in sympathy.',
    },

    motorNoisePeak: {
      title: (motor: string) => `Noise peak at the fundamental of ${motor}`,
      detail: (motor: string, rpmNote: string) =>
        `The dominant peak in the spectrum sits right on the rotation speed of ${motor}: the noise comes from that motor or its prop (imbalance).${rpmNote}`,
      rpmNoteNoErpm:
        ' No eRPM telemetry in the log: the RPM filter cannot work (you need dshot_bidir and a compatible ESC).',
      rpmNoteWeakAttenuation: (attenuationDb: string) =>
        ` Attenuation in the motor range is only ${attenuationDb} dB: the RPM filter looks inactive or ineffective, check that it is set up properly.`,
      evidence: (freqHz: string, axis: string, distanceHz: string, motor: string) =>
        `Dominant peak ${freqHz} Hz on ${axis}, ${distanceHz} Hz away from the rotation of ${motor}`,
      fix: (motor: string) =>
        `Balance or replace the prop on ${motor}, check the motor shaft (bent after a crash?) and the prop nut tightness.`,
    },

    filtersWeak: {
      title: 'Weak filtering in the motor range',
      detail: (attenuationDb: string, axis: string) =>
        `Between raw and filtered gyro, the 120-350 Hz band is only attenuated by ${attenuationDb} dB on ${axis}: motor noise is getting through the filters. An active RPM filter normally crushes this band by 20 dB or more.`,
      evidence: (perAxis: string) => `120-350 Hz attenuation: ${perAxis} dB (expected ≥ 15 dB)`,
      fix: 'Check that the RPM filter is active (dshot_bidir + correct motor poles), otherwise lower the gyro filter multiplier in the tuning tab.',
    },

    filtersResidualHf: {
      title: 'High-frequency leak into the motors',
      detail: (axis: string) =>
        `There is still noise above 100 Hz in the filtered gyro (${axis}). Those high frequencies go straight into the motor commands: the motors heat up for nothing and the ESCs take the hit.`,
      evidence: (perAxis: string, warn: number) =>
        `Residual >100 Hz: ${perAxis} (spectral amplitude, threshold ${warn})`,
      fix: 'Beef up the gyro/D-term filtering or fix the mechanical source. Touch the motors after a flight: warm = OK, burning hot = leak confirmed.',
    },

    trackingPoor: {
      title: 'Poor setpoint tracking',
      detail: (axis: string, advice: string) =>
        `The gyro strays too far from the stick setpoint on ${axis}: the quad responds late or imprecisely. ${advice}`,
      adviceCleanGyro:
        'The gyro is clean: you can raise P (and feedforward) on this axis to tighten the tracking.',
      adviceNoisyGyro:
        'The gyro is noisy at the same time: fix the noise/filtering first - raising the PIDs on a dirty gyro would amplify the noise.',
      evidence: (perAxis: string, warn: number, crit: number) =>
        `Mean error: ${perAxis} deg/s (warn ${warn}, crit ${crit})`,
      fixCleanGyro: (axis: string) =>
        `Raise P and FF gradually on ${axis} (in ~10% steps), fly again, compare again.`,
      fixNoisyGyro:
        'Fix the noise problem (see the vibration/filter verdicts) before touching the PIDs.',
    },

    step: {
      /** Suffix appended to step-rule evidence when < 50% of windows are usable. */
      qualityNote: (pct: number) => ` - limited confidence (${pct}% of windows usable)`,
    },

    stepOvershoot: {
      title: (axis: string) => `Excessive overshoot on ${axis}`,
      detail:
        'The step response clearly overshoots the setpoint before settling: too much P or not enough D on this axis. In flight that shows up as bounce-back at the end of moves.',
      evidence: (perAxis: string, warn: number, qualityNote: string) =>
        `Overshoot: ${perAxis}% (threshold ${warn}%)${qualityNote}`,
      fix: (axis: string) =>
        `Lower P by about 10% or raise D by about 10% on ${axis}, one change at a time.`,
    },

    stepSlow: {
      title: (axis: string) => `Sluggish response on ${axis}`,
      detail: (filterNote: string) =>
        `The 10-90% rise time is long: the quad takes a while to reach the requested rate. ${filterNote}`,
      filterNoteGainsLow: 'P/FF probably too low.',
      filterNoteAggressive: (attenuationDb: string) =>
        `The filters are very aggressive (${attenuationDb} dB of attenuation): the gyro latency they add can explain the sluggishness - lighten the filtering before raising the gains.`,
      evidence: (perAxis: string, warnMs: number, qualityNote: string) =>
        `Rise time: ${perAxis} ms (threshold ${warnMs} ms)${qualityNote}`,
      fix: 'Raise FF (instant reactivity) then P if needed; if the filters are the culprit, bump the gyro LPF multiplier up a notch.',
    },

    stepSettleOff: {
      title: (axis: string) => `Off-target settling on ${axis}`,
      detail:
        'After the transient, the response does not settle at 1 (the setpoint): the achieved rate drifts from what was requested. Typically the I-term (too low if <1, too high or fighting if >1) or a badly calibrated feedforward.',
      evidence: (axis: string, settleValue: string, qualityNote: string) =>
        `Settling value ${axis} = ${settleValue} (expected between 0.85 and 1.15)${qualityNote}`,
      fix: (axis: string) =>
        `Adjust I on ${axis}: raise it if the response plateaus below the setpoint, lower it if it stays above.`,
    },

    motorsSaturation: {
      title: 'Motors saturating',
      detail:
        'The motors hit their max during part of the flight: the PID loop loses all authority in those moments (oscillations, wobbles on punch-outs). Quad too heavy, gains too high, or a weak pack.',
      evidence: (pct: string, warn: number, crit: number) =>
        `Saturation ${pct}% of the flight (warn ${warn}%, crit ${crit}%)`,
      fix: 'Lighten the quad or lower the master multiplier; also check that the pack holds its voltage under load.',
    },

    motorsImbalance: {
      title: 'Motor imbalance',
      detail: (motorHigh: string, motorLow: string) =>
        `${motorHigh} works noticeably harder than ${motorLow} to keep the quad level: off-center weight (pack, camera), bent prop, or a tired motor on that side.`,
      evidence: (m1: string, m2: string, m3: string, m4: string, spread: string, warn: number) =>
        `Motor averages: M1 ${m1} / M2 ${m2} / M3 ${m3} / M4 ${m4}% - spread ${spread} pts (threshold ${warn})`,
      fix: (motorHigh: string) =>
        `Recenter the pack on the frame and inspect the prop/motor on ${motorHigh}.`,
    },

    motorsDesync: {
      title: (motors: string) => `Desync detected on ${motors}`,
      detail:
        'The eRPM drops to zero mid-flight: the motor stalls or the ESC loses sync. This is a crash waiting to happen - ESC issue (firmware, timing), motor connection, or a seized bearing.',
      evidence: (zeros: string) => `In-flight eRPM zeros per motor: [${zeros}]`,
      fix: (motors: string) =>
        `Check the solder joints and connector on ${motors}, spin it by hand (rough spot = bearing), and verify the ESC firmware/timing. Do not fly again before that.`,
    },

    batterySag: {
      title: 'Heavy battery sag',
      detail:
        'The voltage drops hard under load: worn-out pack (rising internal resistance) or resistive connections (oxidized XT30/XT60, solder joints). Less punch and a risk of cutting out at the end of the pack.',
      evidence: (sagTotal: string, perCell: string, warn: number, crit: number, minPerCell: string) =>
        `Sag ${sagTotal} V total, i.e. ${perCell} V/cell (warn ${warn}, crit ${crit}) - min ${minPerCell} V/cell under load`,
      fix: 'Test with a fresh pack to compare; if the sag persists, inspect the power lead connector and solder joints.',
    },

    batteryEmpty: {
      title: 'Battery drained too low',
      detail: (critPerCell: string) =>
        `The voltage dropped below ${critPerCell} V/cell in flight: at that level you permanently damage the pack (capacity loss, puffing).`,
      evidence: (minPerCell: string, critPerCell: string) =>
        `Minimum ${minPerCell} V/cell (threshold ${critPerCell} V)`,
      fix: 'Land earlier: set a vbat alarm on the radio, and recharge this pack with a storage-check to assess the damage.',
    },

    batteryCellsUnexpected: {
      title: 'Unexpected cell count',
      detail: (cells: number, profileLabel: string, expectedCells: number) =>
        `The log shows a ${cells}S pack while the ${profileLabel} profile expects ${expectedCells}S: wrong pack plugged in, or wrong profile detected.`,
      evidence: (cells: number, vbatMax: string, expectedCells: number) =>
        `Detected ${cells}S (vbat max ${vbatMax} V), expected ${expectedCells}S`,
      fix: 'Double-check which pack you used - too many cells can fry ESCs/motors, too few kills the performance.',
    },

    yoyoDetected: {
      titleWarn: 'Yoyo detected (thrust oscillation)',
      titleInfo: 'Yoyo hint (to be confirmed)',
      detail: (confirmNote: string) =>
        `Collective thrust oscillates more than what the throttle stick commands: the quad "pumps" vertically. Classic causes: I/anti-gravity too aggressive, vibrations polluting the loop, or filtering that phase-shifts the correction.${confirmNote}`,
      confirmNote:
        ' This metric is sensitive to flying style on this kind of machine: confirm visually (does the quad climb/sink on its own in level flight?) before changing anything.',
      peak: (freqHz: string, mag: string) => `${freqHz} Hz (mag ${mag})`,
      evidence: (ratio: string, warn: number, peaks: string) =>
        `Ratio sd(thrust)/sd(stick) = ${ratio} (threshold ${warn})${peaks ? ` - oscillation peaks: ${peaks}` : ''}`,
      fix: 'Lower anti_gravity_gain a notch and check the gyro noise; if the oscillation is slow (<2 Hz), look at the I-term too.',
    },

    propwashUntested: {
      title: 'Prop wash not evaluated',
      detail:
        'This flight has no committed low-throttle descent: impossible to judge prop wash behavior on this log.',
      evidence: 'No low-throttle descent detected in this flight',
    },

    propwashSevere: {
      title: 'Heavy prop wash on descents',
      detail:
        'Descending through its own wake, the quad shakes hard: the props are churning through dirty air and the PID loop struggles to keep up. Some prop wash is normal, but at this level it shows in the footage.',
      evidence: (worst: string, warn: number, eventCount: number, avg: string | null) =>
        `Max severity ${worst} deg/s RMS (threshold ${warn}) over ${eventCount} event(s)` +
        (avg !== null ? `, average ${avg}` : ''),
      fix: 'Raise D (or enable/strengthen dynamic idle if you have the RPM filter), and fly with props in good shape.',
    },

    gpsLowSats: {
      title: 'Weak GPS coverage in flight',
      detail:
        'The satellite count dropped below 6 during the flight: GPS rescue would not be reliable at that point. Taking off before a full fix, or a masked/interfered antenna.',
      evidence: (min: string, max: string | null) =>
        `Satellites: min ${min}${max !== null ? ` / max ${max}` : ''} (healthy minimum: 6+)`,
      fix: 'Wait for 8+ sats before taking off; move the GPS antenna away from the VTX and the camera (interference).',
    },

    failsafeTriggered: {
      title: 'Failsafe triggered in flight',
      detail:
        'The radio link dropped hard enough to trigger the failsafe: out of range, damaged/badly oriented RX antenna, or interference. Deal with this before anything else.',
      evidence: (phases: string) => `failsafePhase: {${phases}}`,
      fix: 'Check the RX antenna (solder joint, orientation), the failsafe config, and do a fresh range check before flying far again.',
    },

    logQuality: {
      title: 'Limited log quality',
      detail: (issues: string) => `This log does not allow a full analysis: ${issues}.`,
      issueShortLog: (durationS: string) =>
        `short log (${durationS} s): the verdicts are less reliable`,
      issueLowSampleRate: (rateHz: string, nyquistHz: string) =>
        `sample rate ${rateHz} Hz: the spectrum is limited to ${nyquistHz} Hz (fs/2), high motor noise may be invisible`,
      evidence: (durationS: string, rateHz: string) =>
        `Duration ${durationS} s, sample rate ${rateHz} Hz`,
      fixLowRate: 'Switch the blackbox to full resolution for your next tuning logs.',
      fixShortLog: 'Fly at least 30 s with varied moves for a reliable diagnosis.',
    },

    allGood: {
      title: 'All clean',
      detail: (profileLabel: string) =>
        `No warn/crit threshold exceeded for the ${profileLabel} profile: healthy mechanics, effective filtering, and a consistent tune on this flight. Keep it up.`,
      strongUnfilt: (value: string) => `max raw noise ${value} deg/s`,
      strongFilt: (value: string) => `max filtered noise ${value} deg/s`,
      strongTracking: (value: string) => `max tracking error ${value} deg/s`,
      strongSaturation: (pct: string) => `saturation ${pct}%`,
      strongSag: (perCell: string) => `sag ${perCell} V/cell`,
    },

    // Drone profile labels and notes, indexed by DroneProfileId.
    profiles: {
      pico: {
        label: 'BetaFPV Pavo Pico (2S cinewhoop)',
        notes: [
          '2S ducted cinewhoop: mechanical noise is naturally high, thresholds raised accordingly.',
          'Known history of thrust yoyo: ratio threshold lowered to 1.3 to catch it early.',
        ],
      },
      lr4: {
        label: 'Flywoo Explorer LR4 4" (4S long range, GPS)',
        notes: [
          '4" long range with GPS + baro: priority on clean tracking and pack health.',
          'Fewer than 6 satellites in flight = unreliable GPS rescue, dedicated alert.',
        ],
      },
      chimera7: {
        label: 'iFlight Chimera7 Pro V2 7" (6S)',
        notes: [
          'Big 7" frame: watch the 40-120 Hz band (arm/camera resonance, the source of jello).',
          'Prop balancing is critical: a peak at the motor fundamental shows up straight away in the footage.',
        ],
      },
      generic: {
        label: 'Generic profile',
        notes: ['Generic profile: median 5" thresholds, cell count not checked.'],
      },
    },
  },

  // CLI config lint strings (src/lib/cli/config.ts).
  lint: {
    rpmFilterOffBidir: {
      title: 'RPM filter disabled while bidirectional DShot is active',
      detail:
        'You have eRPM feedback (dshot_bidir = ON) but the RPM filter is off. You are paying the cost of bidirectional DShot without enjoying the best motor-noise filter available.',
      evidence: 'dshot_bidir = ON, rpm_filter_harmonics = 0',
      fix: 'Re-enable the RPM filter (3 harmonics = default value).',
    },
    noBidir: {
      title: 'Bidirectional DShot disabled',
      detail:
        'Your motor protocol is DShot but without eRPM feedback. Enable bidir to unlock the RPM filter: motor noise cleaned at the source, higher gyro/D-term LPFs, less latency (BLHeli_32, Bluejay or AM32 ESC firmware required).',
      evidence: (protocol: string, bidirOff: boolean) =>
        `motor_pwm_protocol = ${protocol}, dshot_bidir = ${bidirOff ? 'OFF' : 'missing'}`,
      fix: 'Enable bidirectional DShot, then the RPM filter.',
    },
    noNotchNoRpm: {
      title: 'No adaptive filtering active',
      detail:
        'Dynamic notch AND RPM filter both disabled: only the static LPFs protect your PIDs from motor noise. Real risk of hot motors, a saturated D-term and oscillations at high throttle.',
      evidence: 'dyn_notch_count = 0, rpm_filter_harmonics = 0',
      fix: 'Re-enable at least one of the two (RPM filter if bidirectional DShot is available, otherwise dynamic notch).',
    },
    dtermLpfLow: {
      title: 'Very low D-term LPF1',
      detail: (hz: string) =>
        `A D-term LPF1 at ${hz} Hz adds a lot of latency on D: mushy damping and amplified prop wash. Below 70 Hz it is rarely justified on a healthy quad.`,
      evidence: (hz: string) => `dterm_lpf1_static_hz = ${hz}`,
      fix: 'Raise the D-term LPF1 back to 75-90 Hz (or switch back to dynamic mode).',
    },
    gyroLpfLow: {
      title: 'Conservative gyro LPF despite the RPM filter',
      detail: (harmonics: string, hz: string) =>
        `With the RPM filter active (${harmonics} harmonics), a static gyro LPF1 at ${hz} Hz is probably too low: you are adding latency for noise that is already handled.`,
      evidence: (key: string, hz: string, harmonics: string) =>
        `${key} = ${hz}, rpm_filter_harmonics = ${harmonics}`,
      fix: 'Try raising the gyro LPF1 (250 Hz default) and check the residual noise on the next flight.',
    },
    ffZero: {
      title: 'Feedforward at zero',
      detail:
        'Without feedforward, the quad only reacts to error that has already built up: the stick response is delayed. Fine for very smooth cinematic flying, a handicap in freestyle/race.',
      fix: 'Bring feedforward back (≈100-125 on 4.5) if you want a direct stick response.',
    },
    antigravityOff: {
      title: 'Anti-gravity disabled',
      detail:
        'anti_gravity_gain = 0: the I-term is not boosted during fast throttle changes, the nose can dip or pump on punch-outs.',
      evidence: 'anti_gravity_gain = 0',
      fix: 'Restore the default value unless this is a deliberate choice.',
    },
    motorLimit: {
      title: 'Motor output limit active',
      detail: (pct: string) =>
        `motor_output_limit = ${pct}%: max thrust is capped. Just a reminder in case it is not intentional (often used to fly a higher-voltage battery).`,
      evidence: (pct: string) => `motor_output_limit = ${pct}`,
    },
    vbatWarning: {
      title: 'Unusual battery warning threshold',
      detail: (volts: string) =>
        `Battery warning set to ${volts} V/cell, outside the usual 3.2-3.6 V range: you will be warned too early or too late.`,
      evidence: (raw: string, volts: string) =>
        `vbat_warning_cell_voltage = ${raw} (${volts} V/cell)`,
      fix: 'Aim for 3.4-3.5 V/cell for typical LiPo use.',
    },
  },

  // System strings: bbl parser errors, worker progress, client-side read errors.
  system: {
    noBlackboxHeader: 'No blackbox header found (not a .bbl file?)',
    sessionTooShort: (frames: string) =>
      `Session too short (${frames} frames) - probably an arming blip`,
    headersUnreadable: 'Unreadable headers (corrupted session?)',
    noFramesDecoded: 'No frames decoded (corrupted data?)',
    essentialFieldsMissing: 'Essential fields missing (gyroADC/setpoint/motor/rcCommand)',

    wasmLoadFailed: (httpStatus: string) =>
      `Could not load the WASM decoder (HTTP ${httpStatus})`,
    progressLoadingDecoder: 'Loading decoder…',
    progressDecoding: (fileName: string) => `Decoding ${fileName}…`,
    progressAnalyzing: 'Analyzing (FFT, step response, rules)…',

    progressPreparing: 'Preparing…',
    workerUnexpectedError: 'Unexpected error in the worker',
  },

  // UI strings (layout, page, components, charts).
  ui: {
    app: {
      logo: 'MY DRONE CAN FLY BETTER',
      headerTagline: '100% local analysis - your logs never leave your browser.',
      footer:
        "Deterministic analysis - every verdict traces back to an explicit rule. Nothing is sent without your consent.",
      languageLabel: 'Language',
      supportKofi: 'Support on Ko-fi',
      footerKofi: 'This site saving you packs? Buy me a coffee:',
      joinDiscord: 'Discord',
    },

    // Language-dependent units (Mo/Ko in French, MB/KB in English).
    units: {
      mega: 'MB',
      kilo: 'KB',
    },

    page: {
      heroTagline: 'Your flight, decoded.',
      heroIntro:
        'Drop your Betaflight blackbox logs: My Drone Can Fly Better decodes them and gives you numbers-backed verdicts - vibrations, filters, PID, motors, battery - with CLI commands ready to paste. No upload: signal and rules, everything traceable.',
      heroAria: 'Introduction',
      steps: [
        {
          title: 'Drop your logs',
          text: '.bbl or .bfl, straight from the SD card or the GUI. Several files at once if you want.',
        },
        {
          title: 'Local analysis',
          text: 'Decoding, DSP and deterministic rules - everything runs in your browser, nothing goes to a server.',
        },
        {
          title: 'Fix it in 30 s',
          text: 'Numbers-backed verdicts, charts, and CLI commands ready to paste into Betaflight.',
        },
      ],
      uploadAria: 'Log drop zone',
      analyzeButton: (count: number): string =>
        count > 1 ? `Analyze the ${count} logs` : 'Analyze the log',
      workingFallback: 'Analyzing…',
      readingFiles: 'Reading files…',
      privacyNote: 'Runs in your browser - nothing gets sent anywhere.',
      errorTitle: 'Analysis failed',
      errorUnknown: 'Unknown error.',
      readErrorNotReadable:
        'Unreadable file - the SD card may have been ejected, or the file changed since it was selected. Select it again.',
      readErrorWithMessage: (message: string): string =>
        `Could not read the file: ${message}`,
      readErrorGeneric: 'Could not read the file.',
    },

    // UploadZone.
    upload: {
      dropTitle: 'Drop your blackbox logs here',
      dropBrowse: ' - or click to browse',
      dropHelp: '.bbl / .bfl · several files accepted · nothing leaves your browser',
      rejected: (names: string): string => `Skipped (neither .bbl nor .bfl): ${names}`,
      selectedFilesAria: 'Selected files',
      removeFile: (name: string): string => `Remove ${name}`,
      pasteSummaryBefore: 'Paste your ',
      pasteSummaryCode: 'diff all',
      pasteSummaryAfter: ' (optional - otherwise I read the config from the log)',
      pasteLabel: 'Output of the Betaflight diff all command',
      pastePlaceholder:
        '# diff all\n# version\n# Betaflight / …\nset gyro_lpf1_static_hz = 250\n…',
      pasteNote: 'A pasted diff takes priority over the log headers for the config analysis.',
    },

    // Severities (FindingCard badges) and global session verdict.
    severity: {
      crit: 'Critical',
      warn: 'Warning',
      info: 'Info',
      ok: 'OK',
    },
    verdict: {
      ok: 'Spotless - nothing to report',
      info: 'Clean - a few observations',
      warn: 'Watch out - some things to fix',
      crit: 'Critical - fix before flying again',
    },

    // Finding categories (keys = FindingCategory).
    categories: {
      securite: 'Safety',
      vibrations: 'Vibrations',
      filtres: 'Filters',
      pid: 'PID',
      moteurs: 'Motors',
      batterie: 'Battery',
      config: 'Config',
      gps: 'GPS',
      log: 'Log',
    },

    // FindingCard.
    finding: {
      evidenceSummary: 'The numbers behind this verdict',
      fixTitle: 'Fix',
    },

    // MetricTile - screen reader announcement of the tone dot.
    metricTone: {
      ok: 'status: good',
      warn: 'status: watch',
      crit: 'status: critical',
    },

    // SessionPicker.
    sessionPicker: {
      listAria: 'Sessions in this file',
    },

    // ReportView.
    report: {
      title: 'Flight report',
      newAnalysis: 'New analysis',
      configAria: 'Config analysis',
      configTitle: 'Config',
      configSourcePaste: '(pasted diff all)',
      configSourceHeaders: '(log headers)',
      fileAria: (fileName: string): string => `Report ${fileName}`,
      validSessions: (count: number): string =>
        `${count} ${count > 1 ? 'valid sessions' : 'valid session'}`,
      skippedSessions: (count: number): string => `${count} skipped`,
      skippedSession: (index: string, error: string, size: string): string =>
        `Session ${index} skipped - ${error} (${size})`,
      sessionLabel: (index: string): string => `Session ${index}`,
      sessionSublabel: (duration: string, start: string): string => `${duration} · t+${start}`,
      noUsableSession: 'No usable session in this file - see the reasons above.',
      profileTag: (label: string): string => `${label} profile`,
      tileDuration: 'Session duration',
      tileSampleRate: 'Sample rate',
      tileBattery: 'Battery',
      batterySag: (sag: string, perCell: string): string => `sag ${sag} V (${perCell} V/cell)`,
      batteryRange: (min: string, max: string): string => `${min}-${max} V`,
      batteryNoVbat: 'no vbat reading',
      tileMaxCurrent: 'Max current',
      currentAvg: (avg: string): string => `average ${avg} A`,
      tileSaturation: 'Motor saturation',
      tileFlightTime: 'Flight time',
      flightTimeHint: 'throttle actually in the air',
      timelineCaption: 'Flight timeline',
      noFindings: 'No rules triggered on this session.',
    },

    // CliExport.
    cli: {
      sectionAria: 'CLI commands',
      title: 'CLI commands',
      countSuffix: (count: number): string => `(${count} + save)`,
      nothingToFix: 'Nothing to fix on the CLI side - your config holds up.',
      copyAll: 'Copy all',
      copied: 'Copied!',
      copiedSr: 'Commands copied to clipboard',
      verifyNote: "Check every line before pasting - you're the pilot, not the report.",
      saveWarnBefore: 'Save by typing ',
      saveWarnCode: 'save',
      saveWarnAfter:
        ' in the CLI, not with the GUI Save button: on some versions it can wipe your entire config (known bug).',
    },

    // Opt-in switch: share the raw .bbl with the dev (bottom of ReportView).
    shareLog: {
      title: 'Help improve the tool',
      description:
        "Sends the raw .bbl log(s) from this analysis to Rémi (the site's dev), on a private channel. Helps catch real-world cases the rules miss. Nothing is sent unless you flip this switch.",
      toggleLabel: (count: number): string =>
        count > 1 ? `Share the ${count} logs` : 'Share this log',
      sending: 'Sending…',
      sent: 'Log sent - thanks!',
      error: 'Send failed - try again later.',
      tooLarge: 'Log too large to share automatically.',
    },

    // SVG charts - flat objects passed as the `labels` prop (pure components, no hooks).
    charts: {
      spectrum: {
        title: 'Gyro spectrum (0-1 kHz)',
        scaleNote: 'gyro amplitude - √ scale (dominant peaks stay comparable)',
        ariaLabel: (title: string): string => `${title} - Roll, Pitch and Yaw axes overlaid`,
        bandResonance: 'resonance',
        bandMotors: 'motors',
        xAxis: 'Frequency (Hz)',
        motorLine: (hz: string): string => `motors ~${hz} Hz`,
      },
      step: {
        title: 'Step response (0-500 ms)',
        ariaLabel: 'Step response Roll, Pitch, Yaw - target 1.0, 0 to 500 ms window',
        overshootZone: 'overshoot zone',
        targetLine: 'target 1.0',
        xAxis: 'Time (ms)',
        axisMissing: (axis: string): string => `${axis} (n/a)`,
        noData: 'Not enough stick input to estimate the response.',
      },
      timeline: {
        ariaLabel: (duration: string, segmentCount: string): string =>
          `Log timeline: ${duration}, ${segmentCount} segments (on the ground / low throttle / in flight)`,
        stateIdle: 'on the ground',
        stateLow: 'low throttle',
        stateFlight: 'in flight',
        vbat: 'vbat',
        noSegments: 'No segments detected.',
      },
    },
  },
};
