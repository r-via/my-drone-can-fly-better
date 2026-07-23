// Diccionario español - refleja la referencia francesa (fr/) clave por clave.
import type { Dict } from './fr';

export const es: Dict = {
  // Motor de reglas (engine.ts) y perfiles de drones.
  rules: {
    noiseMechHigh: {
      title: 'Vibraciones mecánicas elevadas',
      detail: (axis: string) =>
        `El gyro en bruto (antes del filtrado) está muy agitado en ${axis}: es una vibración mecánica real, no un problema de tune. Causa probable: hélice dañada o desequilibrada, rodamiento de motor desgastado, tornillería del frame floja.`,
      evidence: (perAxis: string, warn: number, crit: number) =>
        `Ruido sin filtrar: ${perAxis} deg/s RMS (warn ${warn}, crit ${crit})`,
      fix: 'Inspecciona las hélices (grietas, equilibrado), gira cada motor a mano (punto duro = rodamiento muerto), reaprieta la tornillería del frame y el soporte de la FC.',
    },

    noiseFilteredLeak: {
      title: 'Ruido residual tras el filtrado',
      detail: (axis: string) =>
        `El gyro filtrado sigue ruidoso en ${axis}: ese ruido entra directo en el bucle PID → comandos de motor nerviosos, motores calientes, tune imposible. O el filtrado es demasiado ligero, o la fuente mecánica es demasiado fuerte.`,
      evidence: (perAxis: string, warn: number, crit: number) =>
        `Ruido filtrado: ${perAxis} deg/s RMS (warn ${warn}, crit ${crit})`,
      fix: 'Trata primero la fuente mecánica (ver ruido en bruto), luego refuerza el filtrado (multiplicador del LPF de gyro más bajo, filtro RPM activo) si el bruto ya está limpio.',
    },

    chassisResonance: {
      title: 'Resonancia del frame (40-120 Hz)',
      detail:
        'La energía vibratoria se concentra en la banda 40-120 Hz, por debajo de la rotación de los motores: firma de una resonancia del frame (brazos, cámara, stack) excitada por los motores. Es la fuente clásica del jello en la imagen.',
      evidenceHit: (axis: string, resonanceRms: string, motorRms: string) =>
        `${axis}: 40-120 Hz = ${resonanceRms} vs rango motor = ${motorRms}`,
      evidencePeak: (freqHz: string, axis: string, motor: string, distanceHz: string) =>
        ` | pico dominante ${freqHz} Hz (eje ${axis}), el más cercano a ${motor} (diferencia ${distanceHz} Hz)`,
      fix: 'Monta la FC en soft-mount (gomas en buen estado), verifica el apriete de los brazos y del soporte de cámara, y añade amortiguación de TPU si algún elemento vibra por simpatía.',
    },

    motorNoisePeak: {
      title: (motor: string) => `Pico de ruido en la fundamental de ${motor}`,
      detail: (motor: string, rpmNote: string) =>
        `El pico dominante del espectro coincide con la velocidad de rotación de ${motor}: el ruido viene de ese motor o de su hélice (desequilibrio).${rpmNote}`,
      rpmNoteNoErpm:
        ' No hay telemetría eRPM en el log: el filtro RPM no puede funcionar (hace falta dshot_bidir y un ESC compatible).',
      rpmNoteWeakAttenuation: (attenuationDb: string) =>
        ` La atenuación en el rango motor es de solo ${attenuationDb} dB: el filtro RPM parece inactivo o ineficaz, verifica que esté bien configurado.`,
      evidence: (freqHz: string, axis: string, distanceHz: string, motor: string) =>
        `Pico dominante ${freqHz} Hz en ${axis}, a ${distanceHz} Hz de la rotación de ${motor}`,
      fix: (motor: string) =>
        `Equilibra o reemplaza la hélice de ${motor}, revisa el eje del motor (¿doblado tras un crash?) y el apriete de la tuerca.`,
    },

    filtersWeak: {
      title: 'Filtrado insuficiente en el rango motor',
      detail: (attenuationDb: string, axis: string) =>
        `Entre gyro en bruto y gyro filtrado, la banda 120-350 Hz solo se atenúa ${attenuationDb} dB en ${axis}: el ruido de motor atraviesa los filtros. Un filtro RPM activo normalmente aplasta esa banda 20 dB o más.`,
      evidence: (perAxis: string) => `Atenuación 120-350 Hz: ${perAxis} dB (esperado ≥ 15 dB)`,
      fix: 'Verifica que el filtro RPM esté activo (dshot_bidir + polos de motor correctos); si no, baja el multiplicador del filtro de gyro en la pestaña de tuning.',
    },

    filtersResidualHf: {
      title: 'Fuga de alta frecuencia hacia los motores',
      detail: (axis: string) =>
        `Queda ruido por encima de 100 Hz en el gyro filtrado (${axis}). Esas altas frecuencias acaban en el comando de motor: los motores se calientan para nada y los ESC lo encajan.`,
      evidence: (perAxis: string, warn: number) =>
        `Residual >100 Hz: ${perAxis} (amplitud espectral, umbral ${warn})`,
      fix: 'Refuerza el filtrado de gyro/D-term o corrige la fuente mecánica. Toca los motores tras un vuelo: tibios = OK, ardiendo = fuga confirmada.',
    },

    trackingPoor: {
      title: 'Seguimiento de consigna mediocre',
      detail: (axis: string, advice: string) =>
        `El gyro se aleja demasiado de la consigna del stick en ${axis}: el quad responde con retraso o imprecisión. ${advice}`,
      adviceCleanGyro:
        'El gyro está limpio: puedes subir P (y el feedforward) en ese eje para apretar el seguimiento.',
      adviceNoisyGyro:
        'El gyro está ruidoso al mismo tiempo: corrige primero el ruido/filtrado - subir los PID con un gyro sucio amplificaría el ruido.',
      evidence: (perAxis: string, warn: number, crit: number) =>
        `Error medio: ${perAxis} deg/s (warn ${warn}, crit ${crit})`,
      fixCleanGyro: (axis: string) =>
        `Sube P y FF progresivamente en ${axis} (en pasos de ~10 %), vuelve a volar, vuelve a comparar.`,
      fixNoisyGyro:
        'Arregla el problema de ruido (ver veredictos de vibraciones/filtros) antes de tocar los PID.',
    },

    step: {
      /** Sufijo añadido a las evidence de las reglas step cuando < 50 % de las ventanas son aprovechables. */
      qualityNote: (pct: number) => ` - confianza limitada (${pct} % de ventanas aprovechables)`,
    },

    stepOvershoot: {
      title: (axis: string) => `Overshoot excesivo en ${axis}`,
      detail:
        'La respuesta al escalón supera claramente la consigna antes de estabilizarse: demasiado P o falta de D en ese eje. En vuelo se traduce en rebotes al final del movimiento.',
      evidence: (perAxis: string, warn: number, qualityNote: string) =>
        `Overshoot: ${perAxis} % (umbral ${warn} %)${qualityNote}`,
      fix: (axis: string) =>
        `Baja P alrededor de un 10 % o sube D alrededor de un 10 % en ${axis}, un solo cambio a la vez.`,
    },

    stepSlow: {
      title: (axis: string) => `Respuesta blanda en ${axis}`,
      detail: (filterNote: string) =>
        `El tiempo de subida 10→90 % es largo: el quad tarda en alcanzar la velocidad pedida. ${filterNote}`,
      filterNoteGainsLow: 'P/FF probablemente demasiado bajos.',
      filterNoteAggressive: (attenuationDb: string) =>
        `Los filtros son muy agresivos (${attenuationDb} dB de atenuación): la latencia de gyro que añaden puede explicar la blandura - aligera el filtrado antes de subir las ganancias.`,
      evidence: (perAxis: string, warnMs: number, qualityNote: string) =>
        `Tiempo de subida: ${perAxis} ms (umbral ${warnMs} ms)${qualityNote}`,
      fix: 'Sube FF (reactividad inmediata) y luego P si hace falta; si los filtros son la causa, sube el multiplicador del LPF de gyro un punto.',
    },

    stepSettleOff: {
      title: (axis: string) => `Estabilización desviada en ${axis}`,
      detail:
        'Tras el transitorio, la respuesta no se estabiliza en 1 (la consigna): el rate alcanzado deriva respecto a lo pedido. Típicamente es el I-term (demasiado bajo si <1, demasiado alto o en lucha si >1) o un feedforward mal calibrado.',
      noFfNote:
        ' Sin feedforward en este eje, la respuesta converge más despacio: estabilizarse un poco por debajo de la consigna dentro de la ventana de medida es en parte esperable, el I-term cierra la brecha más allá.',
      evidence: (axis: string, settleValue: string, qualityNote: string) =>
        `Valor de estabilización ${axis} = ${settleValue} (esperado entre 0.85 y 1.15)${qualityNote}`,
      fix: (axis: string) =>
        `Ajusta I en ${axis}: súbelo si la respuesta se queda por debajo de la consigna, bájalo si se mantiene por encima.`,
    },

    motorsSaturation: {
      title: 'Motores en saturación',
      detail:
        'Los motores tocan el máximo durante parte del vuelo: el bucle PID pierde toda autoridad en esos instantes (oscilaciones, wobbles en los punchs). Quad demasiado cargado, ganancias demasiado altas o pack demasiado flojo.',
      evidence: (pct: string, warn: number, crit: number) =>
        `Saturación ${pct} % del vuelo (warn ${warn} %, crit ${crit} %)`,
      fix: 'Aligera el quad o baja el master multiplier; verifica también que el pack aguante la tensión bajo carga.',
    },

    motorsImbalance: {
      title: 'Desequilibrio entre motores',
      detail: (motorHigh: string, motorLow: string) =>
        `${motorHigh} trabaja bastante más que ${motorLow} para mantener el quad plano: centro de gravedad desplazado (pack, cámara), hélice doblada o motor desgastado de ese lado.`,
      evidence: (m1: string, m2: string, m3: string, m4: string, spread: string, warn: number) =>
        `Medias de motor: M1 ${m1} / M2 ${m2} / M3 ${m3} / M4 ${m4} % - diferencia ${spread} pts (umbral ${warn})`,
      fix: (motorHigh: string) =>
        `Recentra el pack en el frame e inspecciona la hélice/el motor ${motorHigh}.`,
    },

    motorsDesync: {
      title: (motors: string) => `Desync detectado en ${motors}`,
      detail:
        'El eRPM cae a cero en vuelo: el motor se desengancha o el ESC pierde la sincronización. Es un crash en potencia - problema de ESC (firmware, timing), de conexión del motor o de rodamiento agarrotado.',
      evidence: (zeros: string) => `Ceros de eRPM en vuelo por motor: [${zeros}]`,
      fix: (motors: string) =>
        `Revisa las soldaduras y el conector del motor ${motors}, gíralo a mano (punto duro = rodamiento), y verifica el firmware/timing del ESC. No vuelvas a volar antes de arreglarlo.`,
    },

    batterySag: {
      title: 'Sag de batería importante',
      detail:
        'La tensión cae con fuerza bajo carga: pack desgastado (resistencia interna en aumento) o conexiones resistivas (XT30/XT60 oxidado, soldaduras). Menos punch y riesgo de corte al final del pack.',
      evidence: (sagTotal: string, perCell: string, warn: number, crit: number, minPerCell: string) =>
        `Sag ${sagTotal} V total, o sea ${perCell} V/celda (warn ${warn}, crit ${crit}) - mín ${minPerCell} V/celda bajo carga`,
      fix: 'Prueba con un pack nuevo para comparar; si el sag persiste, inspecciona el conector y las soldaduras del cable de potencia.',
    },

    batteryEmpty: {
      title: 'Batería descargada demasiado a fondo',
      detail: (critPerCell: string) =>
        `La tensión bajó de ${critPerCell} V/celda en vuelo: a ese nivel el pack se degrada de forma permanente (pérdida de capacidad, hinchazón).`,
      evidence: (minPerCell: string, critPerCell: string) =>
        `Mínimo ${minPerCell} V/celda (umbral ${critPerCell} V)`,
      fix: 'Aterriza antes: configura una alarma de vbat/en la radio, y recarga este pack en modo storage-check para evaluar los daños.',
    },

    batteryCellsUnexpected: {
      title: 'Número de celdas inesperado',
      detail: (cells: number, profileLabel: string, expectedCells: number) =>
        `El log muestra un pack ${cells}S cuando el perfil ${profileLabel} espera ${expectedCells}S: pack equivocado conectado, o perfil mal detectado.`,
      evidence: (cells: number, vbatMax: string, expectedCells: number) =>
        `Detectado ${cells}S (vbat máx ${vbatMax} V), esperado ${expectedCells}S`,
      fix: 'Verifica el pack usado - celdas de más pueden quemar ESC/motores, celdas de menos hunden el rendimiento.',
    },

    batteryNotLogged: {
      title: 'Batería ausente del log',
      detail:
        'El log no contiene ni tensión ni corriente: el campo BATTERY está desactivado en los ajustes de blackbox. No hay avería, la placa simplemente no graba esas medidas - todos los veredictos de batería (sag, pack agotado, sensor) quedan sin objeto en este log.',
      evidence: (mask: string) =>
        `fields_disabled_mask = ${mask} (bit BATTERY activo) - ningún campo vbat/amperage en las tramas`,
      fix: 'Reactiva el registro de batería para recuperar los veredictos de sag y tensión en tus próximos logs.',
    },

    yoyoDetected: {
      titleWarn: 'Yoyo detectado (oscilación de empuje)',
      titleInfo: 'Indicio de yoyo (por confirmar)',
      detail: (confirmNote: string) =>
        `El empuje colectivo oscila más de lo que manda el stick de throttle: el quad "bombea" verticalmente. Causas clásicas: I/anti-gravity demasiado agresivos, vibraciones que contaminan el bucle, o filtrado que desfasa la corrección.${confirmNote}`,
      confirmNote:
        ' Métrica sensible al estilo de vuelo en este tipo de máquina: confírmalo visualmente (¿el quad sube/baja solo en vuelo nivelado?) antes de retocar nada.',
      peak: (freqHz: string, mag: string) => `${freqHz} Hz (mag ${mag})`,
      evidence: (ratio: string, warn: number, peaks: string) =>
        `Ratio sd(empuje)/sd(stick) = ${ratio} (umbral ${warn})${peaks ? ` - picos de oscilación: ${peaks}` : ''}`,
      fix: 'Baja anti_gravity_gain un punto y verifica el ruido del gyro; si la oscilación es lenta (<2 Hz), mira también el I-term.',
    },

    propwashUntested: {
      title: 'Prop wash no evaluado',
      detail:
        'El vuelo no contiene ningún descenso franco a bajas revoluciones: imposible juzgar el comportamiento en prop wash con este log.',
      evidence: 'Ningún descenso con throttle bajo detectado en este vuelo',
    },

    propwashSevere: {
      title: 'Prop wash marcado en descenso',
      detail:
        'Al descender en sus propias turbulencias, el quad tiembla fuerte: las hélices baten un aire desordenado y el bucle PID sufre para seguir. Algo de prop wash es normal, a este nivel se nota en la imagen.',
      evidence: (worst: string, warn: number, eventCount: number, avg: string | null) =>
        `Severidad máx ${worst} deg/s RMS (umbral ${warn}) en ${eventCount} evento(s)` +
        (avg !== null ? `, media ${avg}` : ''),
      fix: 'Sube D (o activa/refuerza el dynamic idle si tienes el RPM filter), y vuela con hélices en buen estado.',
    },

    oscillationEvent: {
      title: (freq: string | null) =>
        freq !== null ? `Oscilación de ${freq} Hz en vuelo` : 'Oscilación en vuelo',
      detail:
        'El bucle PID entró en oscilación: los motores se pelean entre ellos a una frecuencia demasiado rápida para venir del mando. Crece sola y acaba en los topes, un motor a fondo y el opuesto cortado. Causas habituales: demasiada D (o P), ruido de motor que se cuela en el D-term por falta de filtrado, o un notch dinámico que no cubre las fundamentales. El pico de giro dice si la actitud aguantó: unas decenas de °/s, el bucle osciló sin que el dron se fuera; varios cientos, hubo un impacto o una pérdida de control, y eso es otra historia.',
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
        `En t=${tStart} s durante ${duration} s` +
        (freq !== null ? `, ${freq} Hz` : '') +
        `, amplitud ${ratio}x el nivel normal, ${satPct} % de las muestras en tope` +
        (motors !== null ? ` (${motors})` : '') +
        `, pico de giro ${gyroDps} °/s` +
        (others > 1 ? ` - ${others} episodios en total` : ''),
      fix: 'Ataca las causas en orden: primero la cobertura de filtrado alrededor de las fundamentales de motor, y solo después las ganancias. Para decidir, repite exactamente el mismo vuelo con el master PID a 0.7: si la oscilación desaparece son las ganancias, si sigue es el filtrado.',
    },

    batteryReadingsImplausible: {
      title: 'La medición de alimentación de la placa está fallando',
      detail: (currentNote: string) =>
        `El registro contiene tensiones físicamente imposibles: por encima de la tensión en vacío mientras el dron consume mucha corriente. Bajo carga una batería solo puede bajar: es el ADC de la placa que se descuelga en los transitorios, no el pack que se recupera.${currentNote} No es un problema del pack ni del tune: es el circuito de medición de alimentación de la placa. Y mientras mienta, la compensación de sag y las alarmas de tensión de Betaflight trabajan sobre esos mismos valores falsos - no te fíes del beeper de batería para aterrizar. Los veredictos de batería de este informe se retiraron antes que anunciarte en falso un pack muerto.`,
      currentNote: (ampMax: string, ampP99: string) =>
        ` La medición de corriente se descuelga igual: ${ampMax} A leídos en pico cuando el pico sostenido del vuelo ronda los ${ampP99} A - un pico así es una lectura del sensor, no una corriente.`,
      evidence: (count: number, vmax: string, vmin: string) =>
        `${count} muestra(s) por encima de la tensión de reposo bajo carga fuerte; rango leído ${vmin} a ${vmax} V`,
      fix: (scales: string) =>
        `Revisa el filtrado de la medición vbat (condensador en la entrada), las soldaduras de los cables de potencia y el ajuste ${scales}. Vuela de nuevo para confirmar antes de concluir nada sobre el pack.`,
    },

    gpsLowSats: {
      title: 'Cobertura GPS débil en vuelo',
      detail:
        'El número de satélites bajó de 6 durante el vuelo: el GPS rescue no sería fiable en ese momento. Despegue antes del fix completo, o antena tapada/con interferencias.',
      evidence: (min: string, max: string | null) =>
        `Satélites: mín ${min}${max !== null ? ` / máx ${max}` : ''} (mínimo sano: 6+)`,
      fix: 'Espera 8+ sats antes de despegar; aleja la antena GPS del VTX y de la cámara (interferencias).',
    },

    failsafeTriggered: {
      title: 'Failsafe disparado en vuelo',
      detail:
        'El enlace de radio se perdió hasta el punto de disparar el failsafe: alcance superado, antena del RX dañada/mal orientada, o interferencia. A resolver antes que todo lo demás.',
      evidence: (phases: string) => `failsafePhase: {${phases}}`,
      fix: 'Verifica la antena del RX (soldadura, orientación) y la config de failsafe, y haz un range check antes de volver a volar lejos.',
    },

    logQuality: {
      title: 'Calidad de log limitada',
      detail: (issues: string) => `Este log no permite un análisis completo: ${issues}.`,
      issueShortLog: (durationS: string) =>
        `log corto (${durationS} s): los veredictos son menos fiables`,
      issueLowSampleRate: (rateHz: string, nyquistHz: string) =>
        `muestreo a ${rateHz} Hz: el espectro se limita a ${nyquistHz} Hz (fs/2), el ruido de motor alto puede ser invisible`,
      evidence: (durationS: string, rateHz: string) =>
        `Duración ${durationS} s, muestreo ${rateHz} Hz`,
      fixLowRate: 'Pon el blackbox a resolución completa para los próximos logs de tuning.',
      fixShortLog: 'Vuela al menos 30 s con movimientos variados para un diagnóstico fiable.',
    },

    allGood: {
      title: 'Todo limpio',
      detail: (profileLabel: string) =>
        `Ningún umbral warn/crit superado para el perfil ${profileLabel}: mecánica sana, filtrado eficaz y tune coherente en este vuelo. Sigue así.`,
      strongUnfilt: (value: string) => `ruido en bruto máx ${value} deg/s`,
      strongFilt: (value: string) => `ruido filtrado máx ${value} deg/s`,
      strongTracking: (value: string) => `error de seguimiento máx ${value} deg/s`,
      strongSaturation: (pct: string) => `saturación ${pct} %`,
      strongSag: (perCell: string) => `sag ${perCell} V/celda`,
    },

    // Etiquetas y notas de los perfiles de drones.
    profiles: {
      pico: {
        label: 'BetaFPV Pavo Pico (cinewhoop 2S)',
        notes: [
          'Cinewhoop 2S con ductos: el ruido mecánico es alto por naturaleza, umbrales subidos en consecuencia.',
          'Yoyo histórico en el empuje: umbral del ratio bajado a 1.3 para cazarlo pronto.',
        ],
      },
      lr4: {
        label: 'Flywoo Explorer LR4 4" (long range 4S GPS)',
        notes: [
          'Long range de 4" con GPS + baro: prioridad al seguimiento limpio y a la salud del pack.',
          'Menos de 6 satélites en vuelo = GPS rescue no fiable, alerta dedicada.',
        ],
      },
      chimera7: {
        label: 'iFlight Chimera7 Pro V2 7" (6S)',
        notes: [
          'Frame grande de 7": vigila la banda 40-120 Hz (resonancia de brazos/cámara, fuente de jello).',
          'Equilibrado de hélices crítico: un pico en la fundamental del motor se ve directo en la imagen.',
        ],
      },
      generic: {
        label: 'Perfil genérico',
        notes: ['Perfil genérico: umbrales medianos de 5", número de celdas sin verificar.'],
      },
    },
  },

  // Lint de config CLI.
  lint: {
    rpmFilterOffBidir: {
      title: 'Filtro RPM desactivado con el DShot bidireccional activo',
      detail:
        'Tienes el retorno eRPM (dshot_bidir = ON) pero el filtro RPM está apagado. Pagas el coste del DShot bidir sin aprovechar el mejor filtro anti-ruido de motor disponible.',
      evidence: 'dshot_bidir = ON, rpm_filter_harmonics = 0',
      fix: 'Reactiva el filtro RPM (3 armónicos = valor por defecto).',
    },
    noBidir: {
      title: 'DShot bidireccional desactivado',
      detail:
        'Tu protocolo de motor es DShot pero sin retorno eRPM. Activa el bidir para desbloquear el filtro RPM: ruido de motor limpiado en la fuente, LPF de gyro/D-term más altos, menos latencia (requiere firmware de ESC BLHeli_32, Bluejay o AM32).',
      evidence: (protocol: string, bidirOff: boolean) =>
        `motor_pwm_protocol = ${protocol}, dshot_bidir = ${bidirOff ? 'OFF' : 'ausente'}`,
      fix: 'Activa el DShot bidireccional y luego el filtro RPM.',
    },
    noNotchNoRpm: {
      title: 'Ningún filtrado adaptativo activo',
      detail:
        'Dynamic notch Y filtro RPM desactivados: solo los LPF estáticos protegen tus PID del ruido de motor. Riesgo real de motores calientes, D-term saturado y oscilaciones a altas revoluciones.',
      evidence: 'dyn_notch_count = 0, rpm_filter_harmonics = 0',
      fix: 'Reactiva al menos uno de los dos (filtro RPM si tienes DShot bidir, si no dynamic notch).',
    },
    tpaNeverReached: {
      title: 'TPA nunca alcanzado en este vuelo',
      detail:
        'El throttle nunca superó el breakpoint de TPA: la atenuación de ganancias no actuó en todo el vuelo y los PID funcionaron a pleno valor. Conviene saberlo antes de culpar a TPA de un problema de tune.',
      evidence: (thrMax: string, bp: string) => `throttle máx ${thrMax} µs, tpa_breakpoint ${bp} µs`,
    },
    filterCoverageSuspect: {
      title: 'Cobertura de filtrado con un hueco',
      detail:
        'El vuelo ya muestra una oscilación o ruido que llega al bucle, y el filtrado deja un hueco que podría explicarlo. Por separado estos ajustes son de lo más normal y aparecen en máquinas perfectamente sanas: se señalan aquí solo porque hay un síntoma medido en este log. Betaflight atenúa los notches del filtro RPM por debajo de rpm_filter_min_hz + fade_range, y un solo notch dinámico no puede seguir a cuatro motores que se separan.',
      evidence: (motors: string | null, fadeTop: string | null, notch: string | null, def: number) =>
        [
          motors !== null ? `fundamentales bajo el techo de fade de ${fadeTop} Hz: ${motors}` : null,
          notch !== null ? `dyn_notch_count = ${notch} (por defecto ${def})` : null,
        ]
          .filter((x) => x !== null)
          .join('; '),
      fix: 'Amplía la cobertura antes de tocar los PID. Ojo al cálculo: el techo está en rpm_filter_min_hz + fade_range, así que es su suma la que debe quedar por debajo de tu fundamental más baja, no min_hz por sí solo. Vuelve también a 3 notches dinámicos y repite el mismo vuelo para comparar.',
    },
    pidMasterConfirm: {
      title: 'Vuelo de prueba para decidir entre ganancias y filtrado',
      detail:
        'Una oscilación mantenida viene o de ganancias demasiado altas o de ruido que atraviesa el D-term. Las dos dejan exactamente la misma huella en el log y ninguna medición las separa a posteriori: hace falta un segundo vuelo. Bajar el master PID no corrige nada por sí mismo, es una prueba - si la oscilación desaparece son las ganancias, si sigue igual es el filtrado, y volver a subir el master no cuesta nada.',
      evidence: (current: string, target: string) =>
        `simplified_master_multiplier = ${current}; vuelo de prueba propuesto a ${target}`,
      fix: 'Aplica este valor, repite exactamente el mismo vuelo y compara los dos logs. Después vuelve a tu valor original: este ajuste es una prueba, no una corrección.',
    },
    dtermLpfLow: {
      title: 'LPF1 D-term muy bajo',
      detail: (hz: string) =>
        `Un LPF1 de D-term a ${hz} Hz añade mucha latencia en la D: amortiguación blanda y prop wash amplificado. Por debajo de 70 Hz, rara vez está justificado en un quad sano.`,
      evidence: (hz: string) => `dterm_lpf1_static_hz = ${hz}`,
      fix: 'Sube el LPF1 D-term hacia 75-90 Hz (o vuelve al modo dinámico).',
    },
    gyroLpfLow: {
      title: 'LPF de gyro conservador pese al filtro RPM',
      detail: (harmonics: string, hz: string) =>
        `Con el filtro RPM activo (${harmonics} armónicos), un LPF1 de gyro estático a ${hz} Hz probablemente es demasiado bajo: añades latencia por un ruido ya tratado.`,
      evidence: (key: string, hz: string, harmonics: string) =>
        `${key} = ${hz}, rpm_filter_harmonics = ${harmonics}`,
      fix: 'Prueba a subir el LPF1 de gyro (250 Hz por defecto) y verifica el ruido residual en el siguiente vuelo.',
    },
    ffZero: {
      title: 'Feedforward a cero',
      detail:
        'Sin feedforward, el quad solo reacciona al error ya instalado: la respuesta al stick va con retraso. Vale para cinemático muy suave, penaliza en freestyle/carreras.',
      fix: 'Vuelve a poner feedforward (≈100-125 en 4.5) si quieres una respuesta de stick directa.',
    },
    antigravityOff: {
      title: 'Anti-gravity desactivado',
      detail:
        'anti_gravity_gain = 0: el I-term no recibe boost durante las variaciones rápidas de throttle, el morro puede hundirse o bombear en los punchs.',
      evidence: 'anti_gravity_gain = 0',
      fix: 'Vuelve a poner el valor por defecto si no es una elección deliberada.',
    },
    motorLimit: {
      title: 'Límite de salida de motor activo',
      detail: (pct: string) =>
        `motor_output_limit = ${pct}%: el empuje máximo está capado. Simple recordatorio por si no es intencionado (se suele usar para volar con una batería de más voltaje).`,
      evidence: (pct: string) => `motor_output_limit = ${pct}`,
    },
    vbatWarning: {
      title: 'Umbral de alerta de batería inusual',
      detail: (volts: string) =>
        `Alerta de batería ajustada a ${volts} V/celda, fuera del rango habitual 3.2-3.6 V: te avisará demasiado pronto o demasiado tarde.`,
      evidence: (raw: string, volts: string) =>
        `vbat_warning_cell_voltage = ${raw} (${volts} V/celda)`,
      fix: 'Apunta a 3.4-3.5 V/celda para un uso LiPo clásico.',
    },
  },

  // Sistema: parser bbl, worker, lectura de archivos.
  system: {
    noBlackboxHeader: 'No se encontró header de blackbox (¿archivo no .bbl?)',
    sessionTooShort: (frames: string) =>
      `Sesión demasiado corta (${frames} frames) - probable blip de armado`,
    flightTooShort: (seconds: string, minimum: string) =>
      `Vuelo demasiado corto (${seconds} s) - hacen falta al menos ${minimum} s para un análisis fiable`,
    cliSessionSkipped: (n: string, kb: string) => `sesión ${n} ignorada (${kb} kB)`,
    cliProfile: (label: string) => `perfil ${label}`,
    cliVbatUnusable: (cells: string, count: string) =>
      `${cells}S vbat no medible (${count} muestras incoherentes)`,
    cliVbatRange: (cells: string, max: string, min: string, sag: string) =>
      `${cells}S ${max}→${min} V (sag ${sag} V)`,
    cliCurrentMax: (amps: string) => `corriente máx ${amps} A`,
    cliCurrentUnreliable: 'corriente: sensor no fiable, valor descartado',
    headersUnreadable: 'Headers ilegibles (¿sesión corrupta?)',
    dataVersionUnsupported: 'Versión de datos desconocida para el decodificador (¿fragmento de log corrupto?)',
    decoderRejected: (raw: string) => `Imposible decodificar: ${raw}`,
    noFramesDecoded: 'Ningún frame decodificado (¿datos corruptos?)',
    essentialFieldsMissing: 'Faltan campos esenciales (gyroADC/setpoint/motor/rcCommand)',
    firmwareTooOld: (version: string, minimum: string) =>
      `Firmware demasiado antiguo (Betaflight ${version}) - el decodificador necesita ${minimum} como mínimo`,
    firmwareNotSupported: (flavour: string) =>
      `Firmware no compatible: ${flavour} - solo Betaflight se decodifica de forma fiable`,

    wasmLoadFailed: (httpStatus: string) =>
      `No se pudo cargar el decodificador WASM (HTTP ${httpStatus})`,
    progressLoadingDecoder: 'Cargando el decodificador…',
    progressDecoding: (fileName: string) => `Decodificando ${fileName}…`,
    progressAnalyzing: 'Análisis (FFT, step response, reglas)…',

    progressPreparing: 'Preparando…',
    workerUnexpectedError: 'Error inesperado en el worker',
  },

  // Interfaz (layout, página, componentes, gráficas).
  ui: {
    app: {
      logo: 'MY DRONE CAN FLY BETTER',
      headerTagline: 'Análisis 100 % local - tus logs no salen de tu navegador.',
      footer:
        'Análisis determinista - cada veredicto es trazable a una regla explícita. No se envía nada sin tu consentimiento.',
      languageLabel: 'Idioma',
      supportKofi: 'Apoyar en Ko-fi',
      footerKofi: '¿Este sitio te ahorra packs? Invita a un café:',
      joinDiscord: 'Discord',
      viewSource: 'El código en GitHub',
      updateAvailable: 'Nueva versión disponible',
      updateReload: 'Recargar',
      updateDismiss: 'Más tarde',
    },

    credits: {
      title: 'Agradecimientos',
      intro:
        'Gracias a los pilotos que han hecho avanzar el sitio: pruebas, logs compartidos, bugs reportados y buenas ideas.',
    },

    units: {
      mega: 'MB',
      kilo: 'KB',
    },

    page: {
      heroTagline: 'Tu vuelo, decodificado.',
      heroIntro:
        'Arrastra tus logs de blackbox de Betaflight: My Drone Can Fly Better los decodifica y te suelta veredictos con cifras - vibraciones, filtros, PID, motores, batería - con los comandos CLI listos para pegar. Sin subir nada: señal y reglas, todo trazable.',
      heroAria: 'Presentación',
      steps: [
        {
          title: 'Arrastra tus logs',
          text: '.bbl o .bfl, directo desde la tarjeta SD o la GUI. Varios archivos a la vez si quieres.',
        },
        {
          title: 'Análisis local',
          text: 'Decodificación, DSP y reglas deterministas - todo corre en tu navegador, nada se va a un servidor.',
        },
        {
          title: 'Corrige en 30 s',
          text: 'Veredictos con cifras, gráficas, y comandos CLI listos para pegar en Betaflight.',
        },
      ],
      uploadAria: 'Zona de carga de logs',
      analyzeButton: (count: number): string =>
        count > 1 ? `Analizar los ${count} logs` : 'Analizar el log',
      workingFallback: 'Análisis en curso…',
      readingFiles: 'Leyendo los archivos…',
      privacyNote: 'Corre en tu navegador - no se envía nada a ninguna parte.',
      errorTitle: 'Análisis imposible',
      errorUnknown: 'Error desconocido.',
      readErrorNotReadable:
        'Archivo ilegible - puede que la tarjeta SD se haya expulsado, o que el archivo haya cambiado desde que lo seleccionaste. Vuelve a seleccionarlo.',
      readErrorWithMessage: (message: string): string =>
        `No se pudo leer el archivo: ${message}`,
      readErrorGeneric: 'No se pudo leer el archivo.',
    },

    upload: {
      dropTitle: 'Arrastra tus logs de blackbox aquí',
      dropBrowse: ' - o haz clic para explorar',
      dropHelp: '.bbl / .bfl · varios archivos aceptados · nada sale de tu navegador',
      rejected: (names: string): string => `Ignorado (ni .bbl ni .bfl): ${names}`,
      selectedFilesAria: 'Archivos seleccionados',
      removeFile: (name: string): string => `Quitar ${name}`,
    },

    severity: {
      crit: 'Crítico',
      warn: 'Atención',
      info: 'Info',
      ok: 'OK',
    },
    verdict: {
      ok: 'Impecable - nada que señalar',
      info: 'Limpio - algunas observaciones',
      warn: 'A vigilar - puntos por corregir',
      crit: 'Crítico - corrige antes de volver a volar',
    },

    categories: {
      securite: 'Seguridad',
      vibrations: 'Vibraciones',
      filtres: 'Filtros',
      pid: 'PID',
      moteurs: 'Motores',
      batterie: 'Batería',
      config: 'Config',
      gps: 'GPS',
      log: 'Log',
    },

    finding: {
      evidenceSummary: 'Las cifras detrás de este veredicto',
      fixTitle: 'Corrección',
    },

    metricTone: {
      ok: 'estado: bueno',
      warn: 'estado: a vigilar',
      crit: 'estado: crítico',
    },

    sessionPicker: {
      listAria: 'Sesiones del archivo',
    },

    report: {
      title: 'Informe de vuelo',
      newAnalysis: 'Nuevo análisis',
    flightsAria: 'Vuelos analizados',
      fileAria: (fileName: string): string => `Informe ${fileName}`,
      validSessions: (count: number): string =>
        `${count} ${count > 1 ? 'sesiones válidas' : 'sesión válida'}`,
      skippedSessions: (count: number): string =>
        `${count} ${count > 1 ? 'ignoradas' : 'ignorada'}`,
      skippedSession: (index: string, error: string, size: string): string =>
        `Sesión ${index} ignorada - ${error} (${size})`,
      skippedOrphanSummary: (count: number): string =>
        count > 1
          ? `${count} sesiones ignoradas - archivos sin vuelo aprovechable`
          : `1 sesión ignorada - archivo sin vuelo aprovechable`,
      skippedInFileSummary: (count: number): string =>
        count > 1
          ? `${count} otras sesiones ignoradas en este archivo`
          : `1 otra sesión ignorada en este archivo`,
      sessionLabel: (index: string): string => `Sesión ${index}`,
      sessionSublabel: (duration: string, start: string): string => `${duration} · t+${start}`,
      noUsableSession: 'Ninguna sesión aprovechable en este archivo - mira los motivos arriba.',
      axisNotEvaluated: (label: string): string => `${label}: no evaluada - faltan datos en el log`,
      scoreCappedNote: 'Puntuación limitada a 95: un eje no se midió (franja gris).',
      axisNoData: 'no evaluada - faltan datos',
      axisShare: (pct: number): string => `${pct} % de la nota`,
      axisGoto: 'Clic: ir a los veredictos de este eje',
      axisDetails: {
        securite: 'Failsafe disparado en vuelo.',
        vibrations: 'Ruido mecánico del gyro en bruto, resonancia del frame, desequilibrio de hélice/motor.',
        filtres: 'Atenuación del ruido de motor, ruido residual tras el filtrado, fugas de alta frecuencia.',
        pid: 'Seguimiento de consigna, respuesta al escalón (overshoot, lentitud, estabilización), oscilaciones, prop wash, yoyo.',
        moteurs: 'Saturación, desequilibrio entre motores, desyncs.',
        batterie: 'Sag bajo carga, descarga profunda, coherencia del sensor, número de celdas.',
      },
      profileTag: (label: string): string => `perfil ${label}`,
      tileDuration: 'Duración de sesión',
      tileSampleRate: 'Muestreo',
      tileBattery: 'Batería',
      batterySag: (sag: string, perCell: string): string => `sag ${sag} V (${perCell} V/celda)`,
      batteryRange: (min: string, max: string): string => `${min}-${max} V`,
      batteryNoVbat: 'sin medida de vbat',
      tileMaxCurrent: 'Corriente máx',
      currentAvg: (avg: string): string => `media ${avg} A`,
      currentUnreliable: 'sensor no fiable, valor descartado',
      tileSaturation: 'Saturación de motores',
      tileFlightTime: 'Tiempo de vuelo',
      flightTimeHint: 'throttle realmente en el aire',
      timelineCaption: 'Timeline del vuelo',
      timelineEventLine: (
        tStart: string,
        duration: string,
        freq: string,
        ratio: string,
        satPct: string,
        motors: string | null,
        gyroDps: string,
      ): string =>
        `Oscilación medida a ${tStart} s, durante ${duration} s: ${freq} Hz en el diferencial de motores, amplitud ${ratio} veces el nivel normal del vuelo, ${satPct} % de las muestras con al menos un motor en tope` +
        (motors !== null ? ` (${motors})` : '') +
        `. Pico de giro durante el episodio: ${gyroDps} °/s.`,
      timelineEventIntro: 'Lo que dice la medición, sin interpretación:',
      noFindings: 'Ninguna regla disparada en esta sesión.',
    },

    cli: {
      sectionAria: 'Comandos CLI',
      title: 'Comandos CLI',
      countSuffix: (count: number): string => `(${count} + save)`,
      nothingToFix: 'Nada que corregir por CLI - tu config aguanta bien.',
      copyAll: 'Copiar todo',
      copied: '¡Copiado!',
      copiedSr: 'Comandos copiados al portapapeles',
      verifyNote: 'Verifica cada línea antes de pegar - quien pilota eres tú, no el informe.',
      saveWarnBefore: 'Guarda escribiendo ',
      saveWarnCode: 'save',
      saveWarnAfter:
        ' en el CLI, no con el botón Save de la GUI: en algunas versiones puede borrar toda tu config (bug conocido).',
    },

    // Switch de opt-in: comparte el .bbl bruto con el dev (final de ReportView).
    shareLog: {
      title: 'Ayudar a mejorar la herramienta',
      description:
        'Envía el/los log(s) .bbl bruto(s) de este análisis a Rémi (el dev del sitio): el archivo se deposita en el almacenamiento privado del sitio y se publica un enlace de descarga en un canal privado. Sirve para detectar casos reales que las reglas no pillan. No se envía nada hasta que pulses el botón.',
      buttonLabel: (count: number): string =>
        count > 1 ? `Compartir los ${count} logs` : 'Compartir este log',
      sending: 'Enviando…',
      sendingPart: (done: number, total: number): string => `Enviando ${done}/${total}…`,
      sent: '¡Log enviado, gracias!',
      error: 'Fallo al enviar - inténtalo más tarde.',
      tooLarge: 'Más de 100 MB de logs - demasiado para el envío automático.',
    },

    shareLink: {
      title: 'Compartir este informe',
      description:
        'El informe entero cabe en el propio enlace: no se guarda nada en ningún servidor y tu .bbl no sale de tu máquina. Quien lo abra verá este informe en su propio idioma.',
      button: 'Copiar enlace',
      copied: 'Copiado al portapapeles',
      copiedSr: 'Enlace de compartir copiado al portapapeles',
      building: 'Preparando…',
      error: 'No se pudo preparar el enlace.',
      charCount: (n: number): string => `${n} caracteres`,
      trimmed:
        'Las gráficas no cabían en el enlace: lleva la puntuación, los veredictos y las cifras, pero no las curvas.',
      overBudget:
        'Este enlace supera los 2000 caracteres de un mensaje de Discord. Funciona, pero tendrás que enviarlo por otra vía (MD, foro, acortador).',
      bannerTitle: 'Informe recibido por enlace',
      bannerText:
        'Este informe se calculó en la máquina de otra persona y luego se codificó en la dirección. Para analizar tu propio vuelo, parte de un log.',
      bannerCta: 'Analizar mi log',
      decodeErrorMalformed: 'Este enlace para compartir está incompleto o dañado.',
      decodeErrorVersion: 'Este enlace viene de una versión más reciente del sitio. Recarga la página y vuelve a pedirlo.',
    },

    chartHelp: {
      buttonLabel: 'Cómo leerla',
      buttonAria: (chart: string): string => `Cómo leer: ${chart}`,
      closeAria: 'Cerrar la ayuda',
      readTitle: 'Cómo se lee',
      examplesTitle: 'Ejemplos',
      goodTag: 'Bien',
      badTag: 'Mal',
      timeline: {
        title: 'La línea de tiempo del vuelo',
        intro:
          'Esta franja cuenta la sesión de izquierda a derecha: qué hacía el quad (en el suelo, gas bajo, en vuelo), el voltaje de la batería superpuesto y los incidentes detectados.',
        points: [
          'Cada color es un estado: los bloques verdes son los momentos realmente en vuelo.',
          'La línea amarilla es el voltaje de la batería: debe bajar despacio y de forma regular durante el vuelo.',
          'Un triángulo de alerta marca un incidente detectado: su posición dice cuándo, su etiqueta la frecuencia medida.',
          'Una caída brusca de la línea amarilla significa que la batería se hunde bajo carga (gastada o exigida de más).',
        ],
        examples: {
          good: 'Vuelo continuo, voltaje en pendiente suave, sin marcadores: nada que señalar.',
          bad: 'Marcadores de alerta en pleno vuelo y voltaje que cae a tirones: incidentes que corregir, batería sufriendo.',
        },
      },
      spectrum: {
        title: 'El espectro del giroscopio',
        intro:
          'Un quad siempre vibra un poco. Este gráfico ordena esas vibraciones por frecuencia (en Hz): a la izquierda las lentas, a la derecha las rápidas. Cuanto más alto el pico, más fuerte la vibración.',
        points: [
          'Un pico estrecho cerca de la línea discontinua «motores» es normal: es el giro de las hélices.',
          'La banda de «resonancia» debe mantenerse baja: un bulto ahí es el chasis vibrando (jello en la imagen).',
          'En el resto, la curva debe quedarse pegada abajo (el «suelo»).',
          'Los tres colores son los tres ejes (Roll, Pitch, Yaw): deben parecerse.',
          'Si las curvas se cortan antes del borde derecho (zona rayada «no medible»), el log se grabó demasiado lento: el espectro no puede ver nada por encima de la mitad de la cadencia de grabación. Graba más rápido (blackbox_sample_rate) para cubrir todo el rango.',
        ],
        examples: {
          good: 'Suelo bajo y plano, un solo pico estrecho en la frecuencia de los motores: quad sano.',
          bad: 'Bulto ancho en la banda de resonancia y suelo cargado: vibraciones mecánicas - revisa hélices, rodamientos y tornillería.',
        },
      },
      step: {
        title: 'La respuesta al escalón',
        intro:
          'Simulamos un golpe de stick franco y miramos cómo el quad sigue la orden. La línea discontinua «objetivo 1.0» es exactamente lo pedido: la curva ideal sube rápido y se queda ahí.',
        points: [
          'La curva debe subir rápido hacia el objetivo: cuanto antes suba, más rápido responde el quad.',
          'Un ligero rebase por encima del objetivo (menos de ~15 %) es aceptable.',
          'Tras el pico, la curva debe asentarse en la línea objetivo sin hacer olas.',
          'Rebotes repetidos significan que el quad oscila tras cada orden: tune demasiado nervioso.',
        ],
        examples: {
          good: 'Subida franca, ligero rebase y la curva se asienta en el objetivo: tune equilibrado.',
          bad: 'Gran rebase seguido de rebotes: el quad sobre-reacciona y oscila (P demasiado alta o D demasiado baja).',
          badSlow:
            'Subida lenta que solo alcanza el objetivo muy tarde: el quad va por detrás de los sticks (P baja o filtrado pesado).',
        },
      },
    },

    charts: {
      spectrum: {
        title: 'Espectro del gyro (0-1 kHz)',
        scaleNote: 'amplitud del gyro - escala √ (los picos dominantes siguen siendo comparables)',
        ariaLabel: (title: string): string => `${title} - ejes Roll, Pitch y Yaw superpuestos`,
        bandResonance: 'resonancia',
        bandMotors: 'motores',
        xAxis: 'Frecuencia (Hz)',
        motorLine: (hz: string): string => `motores ~${hz} Hz`,
        beyondNyquist: (hz: string): string => `no medible - log grabado a ${hz} Hz`,
      },
      step: {
        title: 'Respuesta al escalón (0-500 ms)',
        ariaLabel: 'Respuesta al escalón Roll, Pitch, Yaw - objetivo 1.0, ventana de 0 a 500 ms',
        overshootZone: 'zona de overshoot',
        targetLine: 'objetivo 1.0',
        xAxis: 'Tiempo (ms)',
        axisMissing: (axis: string): string => `${axis} (n/a)`,
        noData: 'No hay suficiente excitación de stick para estimar la respuesta.',
      },
      timeline: {
        ariaLabel: (duration: string, segmentCount: string): string =>
          `Timeline del log: ${duration}, ${segmentCount} segmentos (en tierra / gas bajo / en vuelo)`,
        stateIdle: 'en tierra',
        stateLow: 'gas bajo',
        stateFlight: 'en vuelo',
        vbat: 'vbat',
        noSegments: 'Ningún segmento detectado.',
        eventsAria: (count: string, times: string): string =>
          `${count} evento(s) señalado(s) en ${times}`,
        eventsLegend: 'oscilación detectada',
      },
    },
  },

  compare: {
    title: 'Comparación de pasadas',
    tabLabel: 'Comparación',
    tabCount: (n: number): string => `${n} ${n > 1 ? 'pares' : 'par'}`,
    heading: (before: string, after: string) => `${before} → ${after}`,
    sessionLabel: (fileName: string, session: string) => `${fileName} sesión ${session}`,
    noTuneChange:
      'No cambió ningún ajuste entre estos dos vuelos: las diferencias de abajo vienen del vuelo, no del tune.',
    summaryNoChange: 'ningún ajuste cambiado',
    summaryChanges: (n: number) => `${n} ${n > 1 ? 'ajustes cambiados' : 'ajuste cambiado'}`,
    caveatsCount: (n: number) => `${n} ${n > 1 ? 'salvedades' : 'salvedad'}`,
    tuneTitle: 'Lo que cambió',
    metricsTitle: 'Lo que dice la medición',
    driverNote:
      'Los deslizadores simplificados van primero: son ellos los que recalculan las ganancias listadas debajo, no al revés.',
    deltaUnavailable: 'ejes distintos',
    metricUnavailable: 'n/d',

    metrics: {
      filtNoise: 'Ruido filtrado (deg/s)',
      unfiltNoise: 'Ruido crudo (deg/s)',
      tracking: 'Error de seguimiento (deg/s)',
      overshoot: 'Sobreimpulso (%)',
      riseTime: 'Tiempo de subida (ms)',
      ms: 'Pico de sensibilidad Ms',
      residualHf: 'Residual >100 Hz',
      propwash: 'Prop wash (deg/s)',
      saturation: 'Saturación de motores (%)',
    },

    caveats: {
      inferredCraft: (board: string) =>
        `Vuelos agrupados por placa (${board}) porque los registros no llevan nombre de dron: pon un craft_name para despejar la duda. Si estos vuelos vienen de dos máquinas distintas sobre la misma placa, la comparación no tiene sentido.`,
      firmware: (before: string, after: string) =>
        `Firmware distinto (${before} → ${after}): un tune no se traslada entre versiones mayores, y hay parámetros que cambian de nombre o de sentido. La comparación de ajustes no es fiable.`,
      sampleRate: (before: string, after: string) =>
        `Frecuencia de muestreo distinta (${before} → ${after} Hz): el ruido residual y el espectro no se comparan entre estos registros.`,
      duration: (before: string, after: string) =>
        `Duraciones muy distintas (${before} s → ${after} s): el vuelo más corto vio menos situaciones, así que sus peores valores salen mecánicamente más bajos.`,
      stickRange: (before: string, after: string) =>
        `Exigencia de mando distinta (${before} → ${after} deg/s máximo): un vuelo más tranquilo baja el sobreimpulso y el prop wash sin que ningún ajuste intervenga.`,
      mechanical: (before: string, after: string) =>
        `El giro crudo cambió (${before} → ${after} deg/s RMS). No responde al tune: algo se movió mecánicamente entre los dos vuelos (hélice, rodamiento, tornillería). Las diferencias de ruido filtrado ya no miden solo el filtrado.`,
      battery: (before: string, after: string) =>
        `Caída por celda muy distinta (${before} → ${after} V) sin compensación activa: la misma consigna no da el mismo empuje. Activa vbat_sag_compensation o vuelve a volar con un nivel de batería comparable.`,
    },
  },
};
