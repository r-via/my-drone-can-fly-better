// 简体中文词典 - 与法语参考（fr/）逐键对应，结构由 Dict 类型强制保证。
// 约定：固定字符串 → string 属性；插值字符串 → 箭头函数（签名与 fr 完全一致）。
// 数值在引擎侧已格式化为 string 传入，这里绝不重新格式化。
import type { Dict } from './fr';

export const zh: Dict = {
  // ── 规则引擎（engine.ts）与机型配置档 ──
  rules: {
    noiseMechHigh: {
      title: '机械振动过大',
      detail: (axis: string) =>
        `原始 gyro（滤波前）在 ${axis} 轴上抖得厉害：这是真实的机械振动，不是调参问题。可能原因：桨叶破损或不平衡、电机轴承磨损、机架螺丝松动。`,
      evidence: (perAxis: string, warn: number, crit: number) =>
        `未滤波噪声：${perAxis} deg/s RMS（warn ${warn}，crit ${crit}）`,
      fix: '检查桨叶（裂纹、动平衡），用手转动每个电机（有卡顿感 = 轴承报废），拧紧机架螺丝和飞控固定件。',
    },

    noiseFilteredLeak: {
      title: '滤波后仍有残留噪声',
      detail: (axis: string) =>
        `滤波后的 gyro 在 ${axis} 轴上依然有噪声：这些噪声会直接进入 PID 环路，导致电机指令抖动、电机发烫、根本没法调参。要么滤波太弱，要么机械噪声源太强。`,
      evidence: (perAxis: string, warn: number, crit: number) =>
        `滤波后噪声：${perAxis} deg/s RMS（warn ${warn}，crit ${crit}）`,
      fix: '先解决机械噪声源（见原始噪声），如果原始信号已经干净，再加强滤波（调低 gyro LPF 倍数、启用 RPM 滤波器）。',
    },

    chassisResonance: {
      title: '机架共振（40-120 Hz）',
      detail:
        '振动能量集中在 40-120 Hz 频段，低于电机转速：这是机架共振（机臂、摄像头、飞塔）被电机激发的典型特征。也是画面果冻（jello）的经典来源。',
      evidenceHit: (axis: string, resonanceRms: string, motorRms: string) =>
        `${axis}：40-120 Hz = ${resonanceRms} vs 电机频段 = ${motorRms}`,
      evidencePeak: (freqHz: string, axis: string, motor: string, distanceHz: string) =>
        ` | 主峰 ${freqHz} Hz（${axis} 轴），最接近 ${motor}（相差 ${distanceHz} Hz）`,
      fix: '给飞控做软安装（确认减震胶垫状态良好），检查机臂和摄像头支架的紧固，如有部件跟着共振就加 TPU 减震件。',
    },

    motorNoisePeak: {
      title: (motor: string) => `${motor} 基频出现噪声峰`,
      detail: (motor: string, rpmNote: string) =>
        `频谱主峰紧贴 ${motor} 的转速：噪声来自这个电机或它的桨叶（不平衡）。${rpmNote}`,
      rpmNoteNoErpm:
        ' 日志里没有 eRPM 遥测：RPM 滤波器无法工作（需要 dshot_bidir 和兼容的电调）。',
      rpmNoteWeakAttenuation: (attenuationDb: string) =>
        ` 电机频段的衰减只有 ${attenuationDb} dB：RPM 滤波器似乎没生效或效果不佳，检查一下配置。`,
      evidence: (freqHz: string, axis: string, distanceHz: string, motor: string) =>
        `主峰 ${freqHz} Hz 在 ${axis} 轴上，距 ${motor} 的转速 ${distanceHz} Hz`,
      fix: (motor: string) =>
        `给 ${motor} 的桨叶做动平衡或直接换新，检查电机轴（炸机后弯了？）和桨帽螺母的紧固。`,
    },

    filtersWeak: {
      title: '电机频段滤波不足',
      detail: (attenuationDb: string, axis: string) =>
        `对比原始与滤波后的 gyro，120-350 Hz 频段在 ${axis} 轴上只衰减了 ${attenuationDb} dB：电机噪声穿透了滤波器。正常情况下，生效的 RPM 滤波器能把这个频段压掉 20 dB 以上。`,
      evidence: (perAxis: string) => `120-350 Hz 衰减：${perAxis} dB（预期 ≥ 15 dB）`,
      fix: '确认 RPM 滤波器已启用（dshot_bidir + 正确的电机极数），否则去调参页调低 gyro 滤波倍数。',
    },

    filtersResidualHf: {
      title: '高频噪声泄漏到电机',
      detail: (axis: string) =>
        `滤波后的 gyro 在 100 Hz 以上仍有残留噪声（${axis}）。这些高频会进入电机指令：电机白白发热，电调也跟着遭罪。`,
      evidence: (perAxis: string, warn: number) =>
        `>100 Hz 残留：${perAxis}（频谱幅值，阈值 ${warn}）`,
      fix: '加强 gyro/D-term 滤波，或解决机械噪声源。飞完摸一下电机：温热 = OK，烫手 = 泄漏实锤。',
    },

    trackingPoor: {
      title: '指令跟随差',
      detail: (axis: string, advice: string) =>
        `gyro 在 ${axis} 轴上偏离摇杆指令太多：机子响应迟钝或不精准。${advice}`,
      adviceCleanGyro:
        'gyro 很干净：可以在这个轴上加 P（和 feedforward）来收紧跟随。',
      adviceNoisyGyro:
        'gyro 同时还带着噪声：先解决噪声/滤波问题 - 在脏 gyro 上加 PID 只会放大噪声。',
      evidence: (perAxis: string, warn: number, crit: number) =>
        `平均误差：${perAxis} deg/s（warn ${warn}，crit ${crit}）`,
      fixCleanGyro: (axis: string) =>
        `在 ${axis} 轴上逐步加 P 和 FF（每步约 10%），飞一趟，再对比。`,
      fixNoisyGyro:
        '先处理噪声问题（见振动/滤波的判定），再去动 PID。',
    },

    step: {
      /** 当可用窗口不足 50% 时，附加在 step 类规则 evidence 后面的后缀。 */
      qualityNote: (pct: number) => ` - 置信度有限（仅 ${pct}% 的窗口可用）`,
    },

    stepOvershoot: {
      title: (axis: string) => `${axis} 轴超调过大`,
      detail:
        '阶跃响应明显冲过目标值才稳定下来：这个轴 P 太高或 D 不够。飞行中表现为动作收尾时的回弹。',
      evidence: (perAxis: string, warn: number, qualityNote: string) =>
        `超调：${perAxis}%（阈值 ${warn}%）${qualityNote}`,
      fix: (axis: string) =>
        `在 ${axis} 轴上把 P 降约 10% 或把 D 加约 10%，一次只改一项。`,
    },

    stepSlow: {
      title: (axis: string) => `${axis} 轴响应偏肉`,
      detail: (filterNote: string) =>
        `10→90% 上升时间偏长：机子要花不少时间才能达到指令角速度。${filterNote}`,
      filterNoteGainsLow: 'P/FF 很可能太低。',
      filterNoteAggressive: (attenuationDb: string) =>
        `滤波非常激进（衰减 ${attenuationDb} dB）：滤波带来的 gyro 延迟可能就是响应肉的原因 - 先减轻滤波，再考虑加增益。`,
      evidence: (perAxis: string, warnMs: number, qualityNote: string) =>
        `上升时间：${perAxis} ms（阈值 ${warnMs} ms）${qualityNote}`,
      fix: '先加 FF（响应立竿见影），必要时再加 P；如果是滤波的锅，把 gyro LPF 倍数往上调一档。',
    },

    stepSettleOff: {
      title: (axis: string) => `${axis} 轴稳态偏移`,
      detail:
        '瞬态过后，响应没有稳定在 1（目标值）：实际角速度相对指令存在偏差。典型原因是 I-term（<1 说明太低，>1 说明太高或在打架）或 feedforward 校准不当。',
      evidence: (axis: string, settleValue: string, qualityNote: string) =>
        `${axis} 稳态值 = ${settleValue}（预期在 0.85 到 1.15 之间）${qualityNote}`,
      fix: (axis: string) =>
        `调整 ${axis} 轴的 I：响应一直够不到目标就加，一直压在目标之上就减。`,
    },

    motorsSaturation: {
      title: '电机饱和',
      detail:
        '飞行中有一部分时间电机顶到了最大输出：这些瞬间 PID 环路彻底失去控制权（震荡、punch 时晃动）。机子太重、增益太高或电池太弱。',
      evidence: (pct: string, warn: number, crit: number) =>
        `饱和占飞行时间的 ${pct}%（warn ${warn}%，crit ${crit}%）`,
      fix: '给机子减重或调低 master multiplier；也确认一下电池在负载下能不能稳住电压。',
    },

    motorsImbalance: {
      title: '电机出力不均',
      detail: (motorHigh: string, motorLow: string) =>
        `为了保持机身水平，${motorHigh} 明显比 ${motorLow} 更卖力：重心偏移（电池、摄像头）、桨叶变形，或这一侧的电机老化了。`,
      evidence: (m1: string, m2: string, m3: string, m4: string, spread: string, warn: number) =>
        `电机平均输出：M1 ${m1} / M2 ${m2} / M3 ${m3} / M4 ${m4}% - 差距 ${spread} 个百分点（阈值 ${warn}）`,
      fix: (motorHigh: string) =>
        `把电池放回机架中心，并检查 ${motorHigh} 的桨叶和电机。`,
    },

    motorsDesync: {
      title: (motors: string) => `${motors} 检测到失步（desync）`,
      detail:
        '飞行中 eRPM 掉到零：电机失步或电调丢失同步。这就是一次待发生的炸机 - 电调问题（固件、timing）、电机接线问题或轴承卡死。',
      evidence: (zeros: string) => `各电机飞行中 eRPM 归零次数：[${zeros}]`,
      fix: (motors: string) =>
        `检查 ${motors} 的焊点和插头，用手转一转（有卡顿 = 轴承坏），并核对电调固件/timing。修好之前别再飞。`,
    },

    batterySag: {
      title: '电池压降严重',
      detail:
        '负载下电压大幅下跌：电池老化（内阻升高）或连接件电阻过大（XT30/XT60 氧化、焊点问题）。动力变肉，而且末段有断电风险。',
      evidence: (sagTotal: string, perCell: string, warn: number, crit: number, minPerCell: string) =>
        `压降共 ${sagTotal} V，即每芯 ${perCell} V（warn ${warn}，crit ${crit}）- 负载下最低每芯 ${minPerCell} V`,
      fix: '拿一块新电池对比测试；如果压降依旧，检查电源线的插头和焊点。',
    },

    batteryEmpty: {
      title: '电池放得太狠',
      detail: (critPerCell: string) =>
        `飞行中电压跌破每芯 ${critPerCell} V：到这个程度会对电池造成永久损伤（容量衰减、鼓包）。`,
      evidence: (minPerCell: string, critPerCell: string) =>
        `最低每芯 ${minPerCell} V（阈值 ${critPerCell} V）`,
      fix: '早点降落：设置 vbat 报警或遥控器报警，并给这块电池充到 storage 电压检查一下损伤程度。',
    },

    batteryCellsUnexpected: {
      title: '电芯数量不符',
      detail: (cells: number, profileLabel: string, expectedCells: number) =>
        `日志显示接的是 ${cells}S 电池，而 ${profileLabel} 配置档预期 ${expectedCells}S：插错电池了，或者配置档识别有误。`,
      evidence: (cells: number, vbatMax: string, expectedCells: number) =>
        `检测到 ${cells}S（vbat 最高 ${vbatMax} V），预期 ${expectedCells}S`,
      fix: '核对所用电池 - 电芯多了可能烧掉电调/电机，少了则性能大打折扣。',
    },

    yoyoDetected: {
      titleWarn: '检测到悠悠球效应（推力震荡）',
      titleInfo: '疑似悠悠球效应（待确认）',
      detail: (confirmNote: string) =>
        `总推力的波动超过了油门摇杆的指令：机子在垂直方向上"打泵"。常见原因：I/anti-gravity 太激进、振动污染了环路，或滤波让修正产生相位滞后。${confirmNote}`,
      confirmNote:
        ' 在这类机型上该指标对飞行风格敏感：先目视确认（平飞时机子自己上下浮动？）再动手改任何东西。',
      peak: (freqHz: string, mag: string) => `${freqHz} Hz（幅值 ${mag}）`,
      evidence: (ratio: string, warn: number, peaks: string) =>
        `sd(推力)/sd(摇杆) 比值 = ${ratio}（阈值 ${warn}）${peaks ? ` - 震荡峰值：${peaks}` : ''}`,
      fix: '把 anti_gravity_gain 调低一档并检查 gyro 噪声；如果震荡很慢（<2 Hz），也看看 I-term。',
    },

    propwashUntested: {
      title: 'Prop wash 未评估',
      detail:
        '这趟飞行没有低油门的干脆下降：无法从这份日志判断 prop wash 表现。',
      evidence: '本次飞行未检测到低油门下降',
    },

    propwashSevere: {
      title: '下降时 prop wash 明显',
      detail:
        '在自己的下洗气流里下降时，机子抖得厉害：桨叶搅动乱流，PID 环路跟不上。少量 prop wash 属正常，到这个程度画面上就看得见了。',
      evidence: (worst: string, warn: number, eventCount: number, avg: string | null) =>
        `最大严重度 ${worst} deg/s RMS（阈值 ${warn}），共 ${eventCount} 次事件` +
        (avg !== null ? `，平均 ${avg}` : ''),
      fix: '加 D（或者有 RPM filter 的话启用/加强 dynamic idle），并且用状态良好的桨飞。',
    },

    oscillationEvent: {
      title: (freq: string | null) =>
        freq !== null ? `飞行中出现 ${freq} Hz 振荡` : '飞行中出现振荡',
      detail:
        'PID 环路进入了振荡：电机之间互相较劲，频率远高于打杆能产生的范围。它会自己越振越大，最后打到上下限，一个电机满油而对角的那个被切掉。常见原因：D（或 P）过大、滤波不足让电机噪声窜进 D-term、或者动态陷波没有覆盖到电机基频。',
      evidence: (
        tStart: string,
        duration: string,
        freq: string | null,
        ratio: string,
        satPct: string,
        motors: string | null,
        others: number,
      ) =>
        `在 t=${tStart} s 持续 ${duration} s` +
        (freq !== null ? `，${freq} Hz` : '') +
        `，幅度为正常水平的 ${ratio} 倍，${satPct} % 的采样打到限位` +
        (motors !== null ? `（${motors}）` : '') +
        (others > 1 ? ` - 共 ${others} 段` : ''),
      fix: '把 PID master 调到 0.7 再飞一次同样的动作，确认是不是 tune 的问题。检查 dyn_notch_count 是否为 3，以及 dyn_notch_min_hz 是否低于你最低的电机基频，否则噪声会进入 D-term。',
    },

    batteryReadingsImplausible: {
      title: '电池读数不合理',
      detail:
        '日志里出现了物理上不可能的电压：在大电流放电时读数却高于空载电压。带载时电池只可能往下掉。这是 vbat 的 ADC 在电流瞬变时失准，而不是电池自己回升。只要存在这种情况，本次飞行的电压跌落和最低电压都无法测量，因此电池相关判定被撤下，而不是错误地告诉你电池已经报废。',
      evidence: (count: number, vmax: string, vmin: string) =>
        `${count} 个采样在大负载下高于静置电压；读到的范围 ${vmin} 到 ${vmax} V`,
      fix: '检查 vbat 采样的滤波（输入端电容）、电源线焊点，以及 vbat_scale 设置。在对电池下任何结论之前，再飞一次确认。',
    },

    gpsLowSats: {
      title: '飞行中 GPS 覆盖不足',
      detail:
        '飞行途中卫星数一度低于 6 颗：那段时间 GPS rescue 并不可靠。要么是没等定位完成就起飞，要么是天线被遮挡/受干扰。',
      evidence: (min: string, max: string | null) =>
        `卫星数：最低 ${min}${max !== null ? ` / 最高 ${max}` : ''}（健康下限：6+）`,
      fix: '等到 8 颗以上卫星再起飞；让 GPS 天线远离图传和摄像头（干扰源）。',
    },

    failsafeTriggered: {
      title: '飞行中触发 Failsafe',
      detail:
        '遥控链路丢失到了触发 failsafe 的程度：距离超限、接收机天线损坏/朝向不对，或受到干扰。这事优先于其他一切。',
      evidence: (phases: string) => `failsafePhase：{${phases}}`,
      fix: '检查接收机天线（焊点、朝向）和 failsafe 配置，飞远之前先重新做一次 range check。',
    },

    logQuality: {
      title: '日志质量有限',
      detail: (issues: string) => `这份日志撑不起完整分析：${issues}。`,
      issueShortLog: (durationS: string) =>
        `日志太短（${durationS} 秒）：判定可靠性下降`,
      issueLowSampleRate: (rateHz: string, nyquistHz: string) =>
        `采样率 ${rateHz} Hz：频谱上限只有 ${nyquistHz} Hz（fs/2），高频电机噪声可能看不见`,
      evidence: (durationS: string, rateHz: string) =>
        `时长 ${durationS} 秒，采样率 ${rateHz} Hz`,
      fixLowRate: '下次调参记录时把 blackbox 调到全分辨率。',
      fixShortLog: '至少飞 30 秒并做多样化的动作，诊断才靠谱。',
    },

    allGood: {
      title: '一切干净',
      detail: (profileLabel: string) =>
        `${profileLabel} 配置档的所有 warn/crit 阈值均未触发：这趟飞行机械健康、滤波有效、调参合理。继续保持。`,
      strongUnfilt: (value: string) => `原始噪声最大 ${value} deg/s`,
      strongFilt: (value: string) => `滤波后噪声最大 ${value} deg/s`,
      strongTracking: (value: string) => `跟随误差最大 ${value} deg/s`,
      strongSaturation: (pct: string) => `饱和 ${pct}%`,
      strongSag: (perCell: string) => `压降每芯 ${perCell} V`,
    },

    // 机型配置档的标签与说明（原 DroneProfile.label/notes）-
    // 以 DroneProfileId 为索引，显示时通过 dict.rules.profiles[id] 解析。
    profiles: {
      pico: {
        label: 'BetaFPV Pavo Pico（2S 涵道 cinewhoop）',
        notes: [
          '2S 涵道 cinewhoop：机械噪声天生偏高，阈值已相应放宽。',
          '这机型的推力历来有悠悠球问题：比值阈值降到 1.3，好尽早抓住它。',
        ],
      },
      lr4: {
        label: 'Flywoo Explorer LR4 4"（4S 远航 GPS）',
        notes: [
          '带 GPS + 气压计的 4" 远航机：优先保证干净的跟随和电池健康。',
          '飞行中卫星少于 6 颗 = GPS rescue 不可靠，设有专门告警。',
        ],
      },
      chimera7: {
        label: 'iFlight Chimera7 Pro V2 7"（6S）',
        notes: [
          '7" 大机架：盯紧 40-120 Hz 频段（机臂/摄像头共振，果冻的来源）。',
          '桨叶动平衡至关重要：电机基频上冒出的噪声峰在画面上一眼就能看出来。',
        ],
      },
      generic: {
        label: '通用配置档',
        notes: ['通用配置档：采用 5" 机型的中位阈值，不校验电芯数。'],
      },
    },
  },

  // ── CLI 配置 lint（src/lib/cli/config.ts）──
  lint: {
    rpmFilterOffBidir: {
      title: '双向 DShot 已开但 RPM 滤波器被关掉',
      detail:
        '你有 eRPM 回传（dshot_bidir = ON），RPM 滤波器却是关的。你付出了双向 DShot 的开销，却没用上现有最好的电机降噪滤波器。',
      evidence: 'dshot_bidir = ON, rpm_filter_harmonics = 0',
      fix: '重新启用 RPM 滤波器（3 次谐波 = 默认值）。',
    },
    noBidir: {
      title: '双向 DShot 未启用',
      detail:
        '你的电机协议是 DShot，但没有 eRPM 回传。开启 bidir 就能解锁 RPM 滤波器：电机噪声从源头清除，gyro/D-term LPF 可以调得更高，延迟更低（需要 BLHeli_32、Bluejay 或 AM32 电调固件）。',
      evidence: (protocol: string, bidirOff: boolean) =>
        `motor_pwm_protocol = ${protocol}, dshot_bidir = ${bidirOff ? 'OFF' : '缺失'}`,
      fix: '先开双向 DShot，再开 RPM 滤波器。',
    },
    noNotchNoRpm: {
      title: '没有任何自适应滤波在工作',
      detail:
        'Dynamic notch 和 RPM 滤波器双双被关：只剩静态 LPF 在替你的 PID 挡电机噪声。电机发烫、D-term 饱和、高转速震荡的风险都是实打实的。',
      evidence: 'dyn_notch_count = 0, rpm_filter_harmonics = 0',
      fix: '至少开回一个（有双向 DShot 就用 RPM 滤波器，否则用 dynamic notch）。',
    },
    tpaNeverReached: {
      title: '本次飞行从未触及 TPA',
      detail:
        '油门全程没有超过 TPA 断点，因此增益衰减整个飞行中都没有起作用，PID 一直按满值运行。在把 tune 问题归咎于 TPA 之前值得先知道这一点。',
      evidence: (thrMax: string, bp: string) => `最大油门 ${thrMax} µs，tpa_breakpoint ${bp} µs`,
    },
    filterCoverageSuspect: {
      title: '滤波覆盖存在缺口',
      detail:
        '本次飞行已经出现振荡或噪声进入控制环，而滤波留下的缺口可能正是原因。单看这些设置本身很普通，健康的机子上也常见：这里报出来只是因为本条日志里测到了症状。Betaflight 会在 rpm_filter_min_hz + fade_range 以下淡出 RPM 滤波的陷波，而单个动态陷波无法跟住四个逐渐拉开的电机。',
      evidence: (motors: string | null, fadeTop: string | null, notch: string | null, def: number) =>
        [
          motors !== null ? `低于 ${fadeTop} Hz 淡出上限的基频：${motors}` : null,
          notch !== null ? `dyn_notch_count = ${notch}（默认 ${def}）` : null,
        ]
          .filter((x) => x !== null)
          .join('；'),
      fix: '先扩大覆盖再动 PID：把 rpm_filter_min_hz 降到最低基频以下，收紧 fade_range，并改回 3 个动态陷波。再飞一次同样的动作对比。',
    },
    dtermLpfLow: {
      title: 'D-term LPF1 设得非常低',
      detail: (hz: string) =>
        `D-term LPF1 设在 ${hz} Hz 会给 D 加很多延迟：阻尼变软，prop wash 被放大。在一台健康的机子上，低于 70 Hz 很少有正当理由。`,
      evidence: (hz: string) => `dterm_lpf1_static_hz = ${hz}`,
      fix: '把 D-term LPF1 调回 75-90 Hz（或改回动态模式）。',
    },
    gyroLpfLow: {
      title: '已有 RPM 滤波器，gyro LPF 却依然保守',
      detail: (harmonics: string, hz: string) =>
        `RPM 滤波器已生效（${harmonics} 次谐波），静态 gyro LPF1 却设在 ${hz} Hz，八成太低了：噪声已经被处理，你却在白白加延迟。`,
      evidence: (key: string, hz: string, harmonics: string) =>
        `${key} = ${hz}, rpm_filter_harmonics = ${harmonics}`,
      fix: '试着把 gyro LPF1 调高（默认 250 Hz），下一趟飞行确认残留噪声。',
    },
    ffZero: {
      title: 'Feedforward 为零',
      detail:
        '没有 feedforward，机子只会对已经产生的误差做反应：摇杆响应滞后。飞很柔的 cinematic 没问题，玩 freestyle/race 就吃亏了。',
      fix: '想要直接的摇杆响应就把 feedforward 加回来（4.5 版本约 100-125）。',
    },
    antigravityOff: {
      title: 'Anti-gravity 被禁用',
      detail:
        'anti_gravity_gain = 0：油门快速变化时 I-term 得不到增强，punch 时机头可能下栽或上下打摆。',
      evidence: 'anti_gravity_gain = 0',
      fix: '如果不是刻意为之，就恢复默认值。',
    },
    motorLimit: {
      title: '电机输出限制已启用',
      detail: (pct: string) =>
        `motor_output_limit = ${pct}%：最大推力被限制了。只是提醒一下，以防这不是你有意设的（常见用途是接更高电压的电池飞）。`,
      evidence: (pct: string) => `motor_output_limit = ${pct}`,
    },
    vbatWarning: {
      title: '电池报警阈值不寻常',
      detail: (volts: string) =>
        `电池报警设在每芯 ${volts} V，超出常规范围 3.2-3.6 V：报警要么来得太早，要么来得太晚。`,
      evidence: (raw: string, volts: string) =>
        `vbat_warning_cell_voltage = ${raw}（每芯 ${volts} V）`,
      fix: '常规 LiPo 使用瞄准每芯 3.4-3.5 V。',
    },
  },

  // ── 系统消息：bbl 解析错误、worker 进度、客户端读取错误 ──
  system: {
    // src/lib/bbl/parse.ts - 用户可见错误（被忽略的会话 / 致命错误）。
    noBlackboxHeader: '没有找到 blackbox 头（文件不是 .bbl？）',
    sessionTooShort: (frames: string) =>
      `会话太短（${frames} 帧）- 八成只是一次解锁抖动`,
    cliSessionSkipped: (n: string, kb: string) => `跳过 session ${n}（${kb} kB）`,
    cliProfile: (label: string) => `配置 ${label}`,
    cliVbatUnusable: (cells: string, count: string) =>
      `${cells}S vbat 无法测量（${count} 个不合理采样）`,
    cliVbatRange: (cells: string, max: string, min: string, sag: string) =>
      `${cells}S ${max}→${min} V（电压跌落 ${sag} V）`,
    cliCurrentMax: (amps: string) => `最大电流 ${amps} A`,
    headersUnreadable: '头部无法读取（会话损坏？）',
    dataVersionUnsupported: '解码器无法识别的数据版本（日志片段损坏？）',
    decoderRejected: (raw: string) => `无法解码：${raw}`,
    noFramesDecoded: '没有解码出任何帧（数据损坏？）',
    essentialFieldsMissing: '缺少关键字段（gyroADC/setpoint/motor/rcCommand）',
    firmwareTooOld: (version: string, minimum: string) =>
      `固件太旧（Betaflight ${version}）- 解码器最低需要 ${minimum}`,
    firmwareNotSupported: (flavour: string) =>
      `不支持的固件：${flavour} - 只有 Betaflight 能可靠解码`,

    // src/worker/analyze.worker.ts - 进度 + WASM 加载错误。
    wasmLoadFailed: (httpStatus: string) =>
      `无法加载 WASM 解码器（HTTP ${httpStatus}）`,
    progressLoadingDecoder: '正在加载解码器…',
    progressDecoding: (fileName: string) => `正在解码 ${fileName}…`,
    progressAnalyzing: '正在分析（FFT、阶跃响应、规则）…',

    // src/lib/analyze-client.ts - UI 与 worker 之间的桥。
    progressPreparing: '准备中…',
    workerUnexpectedError: 'Worker 里出现意外错误',
  },

  // ── 界面（布局、页面、组件、图表）──
  ui: {
    // 页头 / 页脚 / 语言切换（layout）。
    app: {
      logo: 'MY DRONE CAN FLY BETTER',
      headerTagline: '100% 本地分析 - 你的日志不会离开浏览器。',
      footer:
        '确定性分析 - 每个判定都能追溯到一条明确的规则。未经你同意不会发送任何数据。',
      languageLabel: '语言',
      supportKofi: '在 Ko-fi 上支持',
      footerKofi: '这个网站帮你省下了电池？请杯咖啡吧：',
      joinDiscord: 'Discord',
    viewSource: 'GitHub 源码',
    },

    // 随语言变化的单位（Mo/Ko ↔ MB/KB）。
    units: {
      mega: 'MB',
      kilo: 'KB',
    },

    // 首页（hero、步骤、按钮、读取错误、加载动画）。
    page: {
      heroTagline: '你的飞行，解码给你看。',
      heroIntro:
        '把你的 Betaflight 黑匣子日志拖进来：My Drone Can Fly Better 负责解码，并给出量化判定 - 振动、滤波、PID、电机、电池 - 附带可以直接粘贴的 CLI 命令。没有上传：只有信号和规则，一切可追溯。',
      heroAria: '简介',
      steps: [
        {
          title: '拖入日志',
          text: '.bbl 或 .bfl，直接从 SD 卡或 GUI 拿来。想一次丢多个文件也行。',
        },
        {
          title: '本地分析',
          text: '解码、DSP 和确定性规则 - 全部在你的浏览器里跑，什么都不会传到服务器。',
        },
        {
          title: '30 秒完成修正',
          text: '量化判定、图表，以及可以直接粘贴进 Betaflight 的 CLI 命令。',
        },
      ],
      uploadAria: '日志上传区',
      analyzeButton: (count: number): string =>
        count > 1 ? `分析这 ${count} 份日志` : '分析日志',
      workingFallback: '分析中…',
      readingFiles: '正在读取文件…',
      privacyNote: '一切都在你的浏览器里跑 - 什么都不会被发出去。',
      errorTitle: '无法分析',
      errorUnknown: '未知错误。',
      readErrorNotReadable:
        '文件无法读取 - 可能 SD 卡被弹出了，或者文件在选中之后发生了变化。请重新选择。',
      readErrorWithMessage: (message: string): string =>
        `无法读取文件：${message}`,
      readErrorGeneric: '无法读取文件。',
    },

    // UploadZone。
    upload: {
      dropTitle: '把黑匣子日志拖到这里',
      dropBrowse: ' - 或点击浏览',
      dropHelp: '.bbl / .bfl · 支持多个文件 · 什么都不会离开你的浏览器',
      rejected: (names: string): string => `已忽略（既不是 .bbl 也不是 .bfl）：${names}`,
      selectedFilesAria: '已选文件',
      removeFile: (name: string): string => `移除 ${name}`,
      pasteSummaryBefore: '粘贴你的 ',
      pasteSummaryCode: 'diff all',
      pasteSummaryAfter: '（可选 - 不贴的话我就从日志里读配置）',
      pasteLabel: 'Betaflight 的 diff all 命令输出',
      pastePlaceholder:
        '# diff all\n# version\n# Betaflight / …\nset gyro_lpf1_static_hz = 250\n…',
      pasteNote: '配置分析以粘贴的 diff 为准，优先于日志头。',
    },

    // 严重度（FindingCard 徽章）与会话整体判定。
    severity: {
      crit: '严重',
      warn: '注意',
      info: '提示',
      ok: 'OK',
    },
    verdict: {
      ok: '完美 - 没什么可挑的',
      info: '干净 - 有几点观察',
      warn: '需要关注 - 有些地方要修',
      crit: '严重 - 修好再飞',
    },

    // 判定分类（键 = FindingCategory）。
    categories: {
      securite: '安全',
      vibrations: '振动',
      filtres: '滤波',
      pid: 'PID',
      moteurs: '电机',
      batterie: '电池',
      config: '配置',
      gps: 'GPS',
      log: '日志',
    },

    // FindingCard。
    finding: {
      evidenceSummary: '这个判定背后的数据',
      fixTitle: '修复方案',
    },

    // MetricTile - 状态点的屏幕阅读器播报。
    metricTone: {
      ok: '状态：良好',
      warn: '状态：需关注',
      crit: '状态：严重',
    },

    // SessionPicker。
    sessionPicker: {
      listAria: '文件中的会话',
    },

    // ReportView。
    report: {
      title: '飞行报告',
      newAnalysis: '新的分析',
      configAria: '配置分析',
      configTitle: '配置',
      configSourcePaste: '（粘贴的 diff all）',
      configSourceHeaders: '（日志头）',
      fileAria: (fileName: string): string => `报告 ${fileName}`,
      validSessions: (count: number): string => `${count} 个有效会话`,
      skippedSessions: (count: number): string => `${count} 个已忽略`,
      skippedSession: (index: string, error: string, size: string): string =>
        `会话 ${index} 已忽略 - ${error}（${size}）`,
      sessionLabel: (index: string): string => `会话 ${index}`,
      sessionSublabel: (duration: string, start: string): string => `${duration} · t+${start}`,
      noUsableSession: '这个文件里没有可用的会话 - 原因见上方。',
      profileTag: (label: string): string => `配置档 ${label}`,
      tileDuration: '会话时长',
      tileSampleRate: '采样率',
      tileBattery: '电池',
      batterySag: (sag: string, perCell: string): string => `压降 ${sag} V（每芯 ${perCell} V）`,
      batteryRange: (min: string, max: string): string => `${min}-${max} V`,
      batteryNoVbat: '无 vbat 测量',
      tileMaxCurrent: '最大电流',
      currentAvg: (avg: string): string => `平均 ${avg} A`,
      tileSaturation: '电机饱和',
      tileFlightTime: '飞行时间',
      flightTimeHint: '真正离地的油门时间',
      timelineCaption: '飞行时间线',
      timelineEventLine: (
        tStart: string,
        duration: string,
        freq: string,
        ratio: string,
        satPct: string,
        motors: string | null,
      ): string =>
        `在 ${tStart} s 测到振荡，持续 ${duration} s：电机差分上 ${freq} Hz，幅度为本次飞行正常水平的 ${ratio} 倍，${satPct} % 的采样至少有一个电机打到限位` +
        (motors !== null ? `（${motors}）。` : '。'),
      timelineEventIntro: '测量结果本身，不含解读：',
      noFindings: '这个会话没有触发任何规则。',
    },

    // CliExport。
    cli: {
      sectionAria: 'CLI 命令',
      title: 'CLI 命令',
      countSuffix: (count: number): string => `（${count} 条 + save）`,
      nothingToFix: 'CLI 这边没什么要改的 - 你的配置站得住脚。',
      copyAll: '全部复制',
      copied: '已复制！',
      copiedSr: '命令已复制到剪贴板',
      verifyNote: '粘贴前逐行核对 - 掌舵的是你，不是这份报告。',
      saveWarnBefore: '保存时请在 CLI 里输入 ',
      saveWarnCode: 'save',
      saveWarnAfter:
        '，别用 GUI 的 Save 按钮：在某些版本上它会清掉你的全部配置（已知 bug）。',
    },

    // 分享开关（opt-in）：把原始 .bbl 发给开发者（ReportView 底部）。
    shareLog: {
      title: '帮忙改进这个工具',
      description:
        '把这次分析用到的原始 .bbl 日志发给 Rémi（本站开发者），发到一个私密频道。这能帮他发现规则漏掉的真实案例。点击按钮之前不会发送任何内容。',
      buttonLabel: (count: number): string => (count > 1 ? `分享这 ${count} 个日志` : '分享这个日志'),
      sending: '发送中…',
      sent: '日志已发送，谢谢！',
      error: '发送失败 - 请稍后重试。',
      tooLarge: '日志太大，无法自动分享。',
    },

    // SVG 图表 - 以 `labels` prop 传入的扁平对象（纯组件，无 hook）。
    charts: {
      spectrum: {
        title: 'Gyro 频谱（0-1 kHz）',
        scaleNote: 'gyro 幅值 - √ 缩放（主峰之间仍可比较）',
        ariaLabel: (title: string): string => `${title} - Roll、Pitch、Yaw 三轴叠加`,
        bandResonance: '共振',
        bandMotors: '电机',
        xAxis: '频率（Hz）',
        motorLine: (hz: string): string => `电机 ~${hz} Hz`,
      },
      step: {
        title: '阶跃响应（0-500 ms）',
        ariaLabel: 'Roll、Pitch、Yaw 阶跃响应 - 目标 1.0，窗口 0 到 500 ms',
        overshootZone: '超调区',
        targetLine: '目标 1.0',
        xAxis: '时间（ms）',
        axisMissing: (axis: string): string => `${axis}（n/a）`,
        noData: '摇杆激励不足，无法估计响应。',
      },
      timeline: {
        ariaLabel: (duration: string, segmentCount: string): string =>
          `日志时间线：${duration}，${segmentCount} 个片段（地面 / 低油门 / 飞行中）`,
        stateIdle: '地面',
        stateLow: '低油门',
        stateFlight: '飞行中',
        vbat: 'vbat',
        noSegments: '未检测到任何片段。',
        eventsAria: (count: string, times: string): string =>
          `在 ${times} 标记了 ${count} 个事件`,
        eventsLegend: '检测到振荡',
      },
    },
  },
};
