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
      noFfNote:
        ' 该轴没有 feedforward 时响应收敛更慢：测量窗口内稳态略低于目标值在一定程度上是预期的，I-term 会在窗口之外补上差距。',
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
      evidenceN: (motors: string, spread: string, warn: number) =>
        `电机平均输出：${motors}% - 差距 ${spread} 个百分点（阈值 ${warn}）`,
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

    motorsBalanceShift: {
      title: (motor: string) => `${motor} 飞行中电机平衡突变`,
      detail: (motor: string) =>
        `电机平衡在飞行途中突然改变且不再恢复：突变之后 ${motor} 被明显加大输出。该电机（或其电调）在飞行中失去了推力 - 失步、绕组烧蚀、轴承老化 - 或有重物移位（电池绑带松了）。`,
      evidence: (
        motor: string,
        before: string,
        after: string,
        delta: string,
        tChange: string,
        counterNote: string,
      ) =>
        `${motor}：相对电机平均值的偏差 ${before} → ${after} 个点，发生在 t=${tChange} s 附近（Δ +${delta} 点）${counterNote}`,
      counterNote: (motor: string, delta: string) => `；对侧 ${motor} 被减载（Δ ${delta} 点）`,
      fixBetaflight: (motor: string) =>
        `短飞一趟后立刻对比各电机温度，检查 ${motor}（手转轴承、测相电阻）及其电调，并确认电池没有滑动。下次飞行开启双向 DSHOT 记录 eRPM 即可实证失步。`,
      fixInav: (motor: string) =>
        `短飞一趟后立刻对比各电机温度，检查 ${motor}（手转轴承、测相电阻）及其电调，并确认电池没有滑动。接上电调回传以记录电机转速，下次飞行即可实证失步。`,
      fixRpmLogged: (motor: string) =>
        `短飞一趟后立刻对比各电机温度，检查 ${motor}（手转轴承、测相电阻）及其电调，并确认电池没有滑动。对照突变前后记录的电机转速即可实证失步。`,
    },

    motorsFloorClip: {
      title: '平稳飞行中电机贴怠速下限',
      detail:
        '在没有操纵动作时，一台电机掉到怠速，而混控却在要求很大的差动：向下已没有任何控制余量，保持水平只能靠其余电机。这通常是严重失衡（电机变弱、重心严重偏移）的后果。',
      evidence: (pct: string, warn: number, crit: number) =>
        `平稳飞行中下限削波占 ${pct}%（warn ${warn}%，crit ${crit}%）`,
      fix: '先处理其他判定指出的失衡（电机老化、飞行中突变、重心）；若平衡正常，则调低电机怠速或给机架减重。',
    },

    controlLoss: {
      title: '飞行中失控',
      detail:
        '机体转动明显快于指令（或与指令反向），而混控已处于最大差动并触到电机上下限：控制环已命令物理极限，姿态仍在发散。这是电机脱出（失步、推力丢失）、桨叶损坏或撞击的特征。',
      evidence: (
        count: string,
        tStart: string,
        tEnd: string,
        excess: string,
        axis: string,
        spread: string,
      ) =>
        `${count} 次事件 - 最严重的在 t=${tStart}-${tEnd} s：${axis} 轴超转 ${excess} deg/s，电机差动达量程的 ${spread}%`,
      fixBetaflight:
        '找到原因之前不要再飞：检查电机（轴承、绕组）和电调、焊点与插头。开启双向 DSHOT 记录 eRPM 以实证失步。',
      fixInav:
        '找到原因之前不要再飞：检查电机（轴承、绕组）和电调、焊点与插头。接上电调回传以记录电机转速，实证失步。',
      fixRpmLogged:
        '找到原因之前不要再飞：检查电机（轴承、绕组）和电调、焊点与插头。对照该时刻记录的电机转速即可找出脱出的电机。',
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

    batteryNotLogged: {
      title: '日志中没有电池数据',
      detail:
        '日志既没有电压也没有电流：blackbox 设置里关闭了 BATTERY 字段。这不是故障，只是飞控没有记录这些数据 - 本日志中所有电池相关判定（压降、放电过度、传感器）都不适用。',
      evidence: (mask: string) =>
        `fields_disabled_mask = ${mask}（BATTERY 位已置）- 帧中没有 vbat/amperage 字段`,
      fix: '重新启用电池记录，下次的日志就能恢复压降和电压判定。',
    },

    rpmNotLogged: {
      title: '日志中没有电机转速数据',
      detail: (cause: string) =>
        `日志不包含 eRPM 遥测：电机的旋转频率未知。频谱上无法绘制"电机 ~X Hz"参考线，主导峰值无法归属到具体电机，desync 也无从察觉。${cause}`,
      causeFieldDisabled:
        'dshot_bidir = 1：遥测在飞行中正常工作（RPM 滤波器在运行），只是 blackbox 设置里没有勾选 RPM 字段。',
      causeNoBidir: 'dshot_bidir = 0：飞控收不到电调的任何转速回传，飞行和日志中都没有。',
      causeUnknown: '仅凭日志配置无法判断缺的是 DSHOT 遥测本身还是它的记录。',
      evidence: (bidir: string) => `帧中没有按电机的 eRPM 字段 - dshot_bidir = ${bidir}`,
      fixFieldDisabled: '重新启用 eRPM 记录，下次的日志就能恢复电机参考线和峰值归属。',
      fixNoBidir:
        '如果你的电调支持（BLHeli_32、Bluejay、AM32），开启双向 DSHOT：它在飞行中驱动 RPM 滤波器，也向日志提供 eRPM。',
      fixUnknown: '检查双向 DSHOT 是否开启，以及 blackbox 设置中是否勾选了 RPM 字段。',
      detailInav:
        '日志中没有电机转速：慢速帧的 escRPM 字段一直为零，ESC 遥测没有送达飞控。频谱上无法绘制"电机 ~X Hz"参考线。',
      evidenceInav: '日志所有慢速帧中 escRPM = 0',
      fixInav:
        '如果你的电调提供遥测（BLHeli_32、AM32 等），把它们的遥测焊盘接到空闲 UART 的 RX，并在 INAV 中给该端口分配 ESC 功能：日志将记录电机平均转速。',
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
        'PID 环路进入了振荡：电机之间互相较劲，频率远高于打杆能产生的范围。它会自己越振越大，最后打到上下限，一个电机满油而对角的那个被切掉。常见原因：D（或 P）过大、滤波不足让电机噪声窜进 D-term、或者动态陷波没有覆盖到电机基频。陀螺峰值能说明姿态有没有守住：几十 °/s 说明只是环路在振，机身没有失控；几百 °/s 则是撞击或翻滚，那是另一回事。',
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
        `在 t=${tStart} s 持续 ${duration} s` +
        (freq !== null ? `，${freq} Hz` : '') +
        `，幅度为正常水平的 ${ratio} 倍，${satPct} % 的采样打到限位` +
        (motors !== null ? `（${motors}）` : '') +
        `，陀螺峰值 ${gyroDps} °/s` +
        (others > 1 ? ` - 共 ${others} 段` : ''),
      fix: '按顺序排查：先看电机基频附近的滤波覆盖，之后才轮到增益。要下结论，就用 PID master 0.7 再飞一次完全相同的动作：振荡消失说明是增益，仍然存在说明是滤波。',
    },

    batteryReadingsImplausible: {
      title: '飞控的电源检测电路故障',
      detail: (currentNote: string) =>
        `日志里出现了物理上不可能的电压：大电流放电时电压反而高于空载电压。带载时电池只可能往下掉：这是飞控 ADC 在瞬态时失准，不是电池在回升。${currentNote}这既不是电池问题也不是调参问题：是飞控的电源检测电路。只要它还在说谎，Betaflight 的压降补偿和低压报警读到的就是这些假值 - 降落时不要指望电池蜂鸣器。本报告的电池判定已被撤销，以免误报电池报废。`,
      currentNote: (ampMax: string, ampP99: string) =>
        `电流测量同样失准：峰值读到 ${ampMax} A，而全程持续峰值只有约 ${ampP99} A - 这样的尖峰是传感器读数，不是真实电流。`,
      evidence: (count: number, vmax: string, vmin: string) =>
        `${count} 个采样在大负载下高于静息电压；读数范围 ${vmin} 到 ${vmax} V`,
      fix: (scales: string) =>
        `检查 vbat 测量的滤波（输入端电容）、动力线焊点，以及 ${scales} 设置。重飞一次确认后，再对电池下任何结论。`,
    },

    gpsLowSats: {
      title: '飞行中 GPS 覆盖不足',
      detail:
        '飞行途中卫星数一度低于 6 颗：那段时间 GPS rescue 并不可靠。要么是没等定位完成就起飞，要么是天线被遮挡/受干扰。',
      evidence: (min: string, max: string | null) =>
        `卫星数：最低 ${min}${max !== null ? ` / 最高 ${max}` : ''}（健康下限：6+）`,
      fix: '等到 8 颗以上卫星再起飞；让 GPS 天线远离图传和摄像头（干扰源）。',
    },

    gpsAcquisitionSlow: {
      title: 'GPS 定位不完整或过晚',
      detail:
        '起飞时接收机没有达到健康覆盖（8 颗及以上卫星），或直到本段后期才达到。定位未完成就触发 GPS rescue 风险很大。常见原因：上电后过早起飞、天线被遮挡，或电气噪声拖慢了搜星。',
      evidence: (median: string, timeS: string | null) =>
        timeS !== null
          ? `记录开始 ${timeS} 秒后才达到 8 颗卫星（本段中位数：${median} 颗）`
          : `整段记录从未达到 8 颗卫星（中位数：${median} 颗）`,
      fix: '起飞前等 GPS 定位完成（OSD 显示 8+ 颗）。若停在地面搜星仍然很慢，把 GPS 天线移离图传和动力线：射频噪声会拉长同步时间。',
    },

    gpsSatDrops: {
      title: '飞行中卫星数骤降',
      detail:
        '卫星数不时骤降又恢复：机架在机动中遮挡天线、接触不良，或瞬时干扰。每次骤降都会劣化定位；低于 5 颗时 3D 定位本身丢失，此时 rescue 等于盲飞。',
      evidence: (count: string, from: string, to: string, atS: string) =>
        `检测到 ${count} 次骤降，最严重的一次在 t=${atS} 秒从 ${from} 颗跌到 ${to} 颗`,
      fix: '检查 GPS 天线的固定和线缆，保证天线视野开阔（高于机架、远离 HD 摄像头），然后再平稳飞一圈对比。',
    },

    gpsEmiThrottle: {
      title: '油门升高时卫星数下降',
      detail:
        '油门一推卫星数就明显下降：这是电气噪声（图传、电调、动力线）致盲 GPS 接收机的典型特征。正是这种噪声让 GPS 在地面定位良好、一起飞却无法保持同步。',
      evidence: (low: string, high: string) => `中位数：低油门 ${low} 颗，高油门 ${high} 颗`,
      fix: '把 GPS 天线移离图传和电池/电调线（用支架或装到后板），把动力线绞合，然后卸桨解锁测试：推油门时卫星数不应变化。',
    },

    gpsHdopHigh: {
      title: 'GPS 精度不佳（HDOP 偏高）',
      detail:
        'HDOP 一直偏高：即使锁定了卫星，位置仍不精确。可能是几何条件差（天空被遮挡），或天线附近的射频噪声劣化了信号。',
      evidence: (median: string, worst: string | null) =>
        `HDOP 中位数 ${median}${worst !== null ? ` / 最差 ${worst}` : ''}（健康值：< 2.5）`,
      fix: '让天线视野开阔，并远离噪声源（图传、HD 摄像头、动力线）。HDOP 低于 1.5 后定位重新可靠。',
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

    inavLimited: {
      title: 'INAV 日志：部分分析',
      detail:
        '这个日志来自 INAV：飞行指标（噪声、滤波、跟踪、阶跃响应、电机、电池）照常分析，但配置检查和 CLI 命令是 Betaflight 专用的，保持禁用。请通过 INAV Configurator 应用修改。',
      evidence: (firmware: string) => `固件：${firmware}`,
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
      akira: {
        label: 'RRFPV RR Akira 9 英寸 X8（6S）',
        notes: [
          '共轴 X8：全部 8 个电机进入分析（平均输出、出力不均、饱和、振荡）。',
          '起始阈值尚未实地校准：9 英寸长机臂的原始噪声提早预警，上升时间放宽。',
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
      fix: '先扩大覆盖再动 PID。注意算法：上限在 rpm_filter_min_hz + fade_range，所以要低于最低基频的是这两者之和，而不是 min_hz 本身。同时改回 3 个动态陷波，然后再飞一次同样的动作对比。',
    },
    pidMasterConfirm: {
      title: '用一次试飞区分增益还是滤波',
      detail:
        '持续振荡要么来自增益过高，要么来自穿过 D-term 的噪声。两者在日志里留下的痕迹完全相同，事后没有任何测量能把它们分开：必须再飞一次。降低 PID master 本身并不能修好什么，它是一个测试 - 振荡消失说明是增益，完全没变说明是滤波，之后把 master 调回去没有任何代价。',
      evidence: (current: string, target: string) =>
        `simplified_master_multiplier = ${current}；建议试飞值 ${target}`,
      fix: '设成这个值，飞一次完全相同的动作，然后对比两份日志。之后改回原值：这是测试，不是修复。',
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
    flightTooShort: (seconds: string, minimum: string) =>
      `飞行太短（${seconds} 秒）- 可靠分析至少需要 ${minimum} 秒`,
    cliSessionSkipped: (n: string, kb: string) => `跳过 session ${n}（${kb} kB）`,
    cliProfile: (label: string) => `配置 ${label}`,
    cliVbatUnusable: (cells: string, count: string) =>
      `${cells}S vbat 无法测量（${count} 个不合理采样）`,
    cliVbatRange: (cells: string, max: string, min: string, sag: string) =>
      `${cells}S ${max}→${min} V（电压跌落 ${sag} V）`,
    cliCurrentMax: (amps: string) => `最大电流 ${amps} A`,
    cliCurrentUnreliable: '电流：传感器不可靠，读数已忽略',
    cliGpsSummary: (median: string, min: string, hdop: string | null) =>
      `GPS ${median} 颗卫星（最低 ${min}${hdop !== null ? `，HDOP ${hdop}` : ''}）`,
    cliTemps: (probes: string) => `温度 ${probes} °C`,
    headersUnreadable: '头部无法读取（会话损坏？）',
    dataVersionUnsupported: '解码器无法识别的数据版本（日志片段损坏？）',
    decoderRejected: (raw: string) => `无法解码：${raw}`,
    noFramesDecoded: '没有解码出任何帧（数据损坏？）',
    essentialFieldsMissing: '缺少关键字段（gyroADC/setpoint/motor/rcCommand）',
    firmwareTooOld: (firmware: string, minimum: string) =>
      `固件太旧（${firmware}）- 解码器最低需要 ${minimum}`,
    firmwareNotSupported: (flavour: string) =>
      `不支持的固件：${flavour} - 只有 Betaflight 和 INAV 能可靠解码`,

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
      updateAvailable: '有新版本',
      updateReload: '重新加载',
      updateDismiss: '稍后',
    },

    credits: {
      title: '鸣谢',
      intro: '感谢帮助本站不断进步的飞手们：测试、分享日志、报告问题和好点子。',
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
        '把你的 Betaflight 或 INAV 黑匣子日志拖进来：My Drone Can Fly Better 负责解码，并给出量化判定 - 振动、滤波、PID、电机、电池 - Betaflight 还附带可以直接粘贴的 CLI 命令。没有上传：只有信号和规则，一切可追溯。',
      heroAria: '简介',
      steps: [
        {
          title: '拖入日志',
          text: '.bbl、.bfl 或 .txt（INAV），直接从 SD 卡或 GUI 拿来。想一次丢多个文件也行。',
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
      dropHelp: '.bbl / .bfl / .txt（INAV）· 支持多个文件 · 什么都不会离开你的浏览器',
      rejected: (names: string): string => `已忽略（不是 .bbl、.bfl 或 .txt）：${names}`,
      selectedFilesAria: '已选文件',
      removeFile: (name: string): string => `移除 ${name}`,
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

    notFound: {
      text: '这个页面不存在。',
      cta: '返回分析页',
    },

    // ReportView。
    report: {
      title: '飞行报告',
      newAnalysis: '新的分析',
      flightsAria: '已分析的飞行',
      fileAria: (fileName: string): string => `报告 ${fileName}`,
      validSessions: (count: number): string => `${count} 个有效会话`,
      skippedSessions: (count: number): string => `${count} 个已忽略`,
      skippedSession: (index: string, error: string, size: string): string =>
        `会话 ${index} 已忽略 - ${error}（${size}）`,
      skippedOrphanSummary: (count: number): string =>
        `${count} 个已忽略会话 - 这些文件没有可用的飞行`,
      skippedInFileSummary: (count: number): string =>
        `本文件另有 ${count} 个已忽略会话`,
      sessionLabel: (index: string): string => `会话 ${index}`,
      sessionSublabel: (duration: string, start: string): string => `${duration} · t+${start}`,
      noUsableSession: '这个文件里没有可用的会话 - 原因见上方。',
      axisNotEvaluated: (label: string): string => `${label}：未评估 - 日志中缺少数据`,
      scoreCappedNote: '有一个轴未测量（灰色扇区），得分上限为 95。',
      axisNoData: '未评估 - 缺少数据',
      axisShare: (pct: number): string => `占总分 ${pct}%`,
      axisGoto: '点击跳转到该轴的判定',
      axisDetails: {
        securite: '飞行中触发 failsafe。',
        vibrations: '原始 gyro 机械噪声、机架共振、桨叶/电机不平衡。',
        filtres: '电机频段降噪、滤波后残留噪声、高频泄漏。',
        pid: '指令跟随、阶跃响应（超调、迟缓、稳态）、震荡、prop wash、悠悠球效应。',
        moteurs: '饱和、电机出力不均、失步。',
        batterie: '负载压降、过度放电、传感器合理性、电芯数。',
      },
      profileTag: (label: string): string => `配置档 ${label}`,
      tileDuration: '会话时长',
      tileSampleRate: '采样率',
      tileBattery: '电池',
      batterySag: (sag: string, perCell: string): string => `压降 ${sag} V（每芯 ${perCell} V）`,
      batteryRange: (min: string, max: string): string => `${min}-${max} V`,
      batteryNoVbat: '无 vbat 测量',
      tileMaxCurrent: '最大电流',
      currentAvg: (avg: string): string => `平均 ${avg} A`,
      currentUnreliable: '传感器不可靠，读数已忽略',
      tileSaturation: '电机饱和',
      tileFlightTime: '飞行时间',
      flightTimeHint: '真正离地的油门时间',
    tileGps: 'GPS',
    gpsTileHint: (min: string, max: string, hdop: string | null): string =>
      `最低 ${min} / 最高 ${max}${hdop !== null ? ` / HDOP ${hdop}` : ''}`,
      timelineCaption: '飞行时间线',
      timelineEventLine: (
        tStart: string,
        duration: string,
        freq: string,
        ratio: string,
        satPct: string,
        motors: string | null,
        gyroDps: string,
      ): string =>
        `在 ${tStart} s 测到振荡，持续 ${duration} s：电机差分上 ${freq} Hz，幅度为本次飞行正常水平的 ${ratio} 倍，${satPct} % 的采样至少有一个电机打到限位` +
        (motors !== null ? `（${motors}）` : '') +
        `。该段期间陀螺峰值：${gyroDps} °/s。`,
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
        '把这次分析用到的原始 .bbl 日志发给 Rémi（本站开发者）：文件存入本站的私有存储，并在私密频道发布下载链接。这能帮他发现规则漏掉的真实案例。点击按钮之前不会发送任何内容。',
      buttonLabel: (count: number): string => (count > 1 ? `分享这 ${count} 个日志` : '分享这个日志'),
      sending: '发送中…',
      sendingPart: (done: number, total: number): string => `发送中 ${done}/${total}…`,
      sent: '日志已发送，谢谢！',
      error: '发送失败 - 请稍后重试。',
      tooLarge: '日志总量超过 100 MB - 太大，无法自动分享。',
    },

    shareLink: {
      title: '分享这份报告',
      description:
        '复制这份报告的短链接，有效期 15 天。服务器上只保存计算出的报告（评分、结论、曲线），绝不保存你的 .bbl，它不会离开你的电脑。打开链接的人会看到这份报告的本地语言版本。',
      button: '复制链接',
      copied: '已复制到剪贴板',
      copiedSr: '分享链接已复制到剪贴板',
      building: '准备中…',
      error: '无法生成链接。',
      charCount: (n: number): string => `${n} 个字符`,
      trimmed: '图表没能塞进链接：它带的是评分、判定和数据，但没有曲线。',
      overBudget:
        '这个链接超过了 Discord 单条消息的 2000 字符上限。链接本身可用，但得换个方式发送（私信、论坛、短链接）。',
      bannerTitle: '通过链接收到的报告',
      bannerText: '这份报告是在别人的电脑上算出来的，然后编码进了网址。要分析你自己的飞行，请从日志开始。',
      bannerCta: '分析我的日志',
      decodeErrorMalformed: '这个分享链接不完整或已损坏。',
      decodeErrorVersion: '这个链接来自更新版本的网站。请刷新页面后重新索取。',
      fetchError: '找不到报告：这个短链接不存在或已过期（分享链接有效期 15 天）。',
    },

    chartHelp: {
      buttonLabel: '怎么看这张图',
      buttonAria: (chart: string): string => `怎么看：${chart}`,
      closeAria: '关闭帮助',
      readTitle: '怎么看',
      examplesTitle: '示例',
      goodTag: '良好',
      badTag: '有问题',
      timeline: {
        title: '飞行时间轴',
        intro:
          '这条横带从左到右讲述整段飞行：飞机当时的状态（地面、低油门、飞行中）、叠加的电池电压曲线，以及检测到的异常事件。',
        points: [
          '每种颜色代表一种状态：绿色块是真正在飞的时间段。',
          '黄线是电池电压：飞行中应当缓慢而平稳地下降。',
          '警告三角标记检测到的异常：位置表示时间，标签是测得的频率。',
          '黄线骤降说明电池在负载下电压崩塌（电池老化或负载过大）。',
        ],
        examples: {
          good: '连续飞行，电压平缓下降，没有任何标记：一切正常。',
          bad: '飞行中出现警告标记，电压一段段跳水：有需要处理的异常，电池状态不佳。',
        },
      },
      spectrum: {
        title: '陀螺仪频谱',
        intro:
          '无人机总会有些振动。这张图把振动按频率（Hz）排开：左边是慢振动，右边是快振动。峰越高，振动越强。',
        points: [
          '在「电机」虚线附近有一个窄峰是正常的：那是螺旋桨的转速。',
          '「共振」区必须保持低平：这里鼓起来说明机架在共振（画面果冻）。',
          '其余位置曲线应贴着底部（「噪声底」）。',
          '三种颜色是三个轴（Roll、Pitch、Yaw）：形状应当相近。',
          '如果曲线在到达右边缘前就断了（斜线阴影「无法测量」区），说明日志记录太慢：频谱看不到记录频率一半以上的内容。提高 blackbox_sample_rate 才能覆盖整个范围。',
        ],
        examples: {
          good: '噪声底低而平，只在电机频率处有一个窄峰：机况健康。',
          bad: '共振区有宽包且噪声底偏高：机械振动，检查桨叶、轴承和螺丝。',
        },
      },
      step: {
        title: '阶跃响应',
        intro:
          '我们模拟一次干脆的打杆，看飞机如何执行指令。虚线「目标 1.0」就是下达的指令：理想曲线快速升到目标并停在那里。',
        points: [
          '曲线应快速爬向目标：爬得越早，响应越快。',
          '略微冲过目标（超调 ~15% 以内）可以接受。',
          '过峰后曲线应平稳落在目标线上，不再起伏。',
          '反复回弹说明每次打杆后飞机都在震荡：调参过于激进。',
          '淡色虚线曲线不参与评判：这段飞行的打杆激励太少，无法可靠测量，其形状可能纯属伪影。',
        ],
        examples: {
          good: '干脆上升，轻微超调，然后稳稳落在目标线上：调参均衡。',
          bad: '大幅超调后反复回弹：飞机过度反应并震荡（P 过高或 D 过低）。',
          badSlow: '上升绵软，很晚才到目标：飞机跟不上打杆（P 偏低或滤波过重）。',
        },
      },
      temperature: {
        title: '温度曲线',
        intro:
          '日志中所有温度探头汇于一张图：ESC 遥测、IMU 和气压计（INAV，另加外接传感器如有），或 Betaflight 在 debug_mode ESC_SENSOR_TMP 下每个 ESC 一条曲线。点击图例中的探头可隐藏其曲线、突出其余曲线。',
        points: [
          '平稳上升后进入平台期是正常的：电子设备先升温，随后气流带走热量达到平衡。',
          'ESC 曲线一路攀升、始终不见平台，就是过热的前兆：在热保护断电前赶紧降落。',
          'Betaflight 下把各 ESC 互相对比：某个 ESC 明显比邻居更热，说明电机偏紧、ESC 有故障或桨叶受损。',
          'IMU 和气压计反映飞控板温度：适合发现封闭机架里被闷热的飞控。',
          '形状比数值更重要：60 °C 的平台期比一路爬过 70 °C 的持续上升更健康。',
        ],
        examples: {
          good: '缓慢上升后进入平台期：气流吸收了热量，健康的一趟。',
          bad: '其余曲线保持平稳，而 ESC 曲线持续攀升不见平台：过热进行中，降落并排查原因（电机偏紧、ESC 故障、散热不足）。',
        },
      },
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
        motorLineMissing: '无电机参考线 - 日志中没有 eRPM',
        motorLineInav: (hz: string): string => `电机 ~${hz} Hz（ESC 遥测）`,
        motorLineMissingInav: '无电机参考线 - 日志中没有 ESC 遥测数据',
        beyondNyquist: (hz: string): string => `无法测量 - 日志记录频率 ${hz} Hz`,
      },
      step: {
        title: '阶跃响应（0-500 ms）',
        ariaLabel: 'Roll、Pitch、Yaw 阶跃响应 - 目标 1.0，窗口 0 到 500 ms',
        overshootZone: '超调区',
        targetLine: '目标 1.0',
        xAxis: '时间（ms）',
        axisMissing: (axis: string): string => `${axis}（n/a）`,
        axisUnreliable: (axis: string): string => `${axis}*`,
        unreliableNote: '* 淡色曲线：摇杆激励不足，该轴未参与评判',
        noData: '摇杆激励不足，无法估计响应。',
      noDataWhy: '悬停时指令保持平直：PID 环路没有收到任何可测量的指令。',
      noDataHint: '飞一趟带干脆摇杆输入的航段（先 roll 后 pitch，每轴十次左右），曲线就会出现。',
      },
      temperature: {
        title: '温度（°C）',
        ariaLabel: '日志各温度探头的曲线，叠加显示，单位 °C',
        xAxis: '时间（s）',
        filterHint: '点击图例中的探头即可隐藏/显示其曲线',
        probeEsc: '电调（回传）',
        probeImu: 'IMU',
        probeBaro: '气压计',
        probeSens: (n: string): string => `探头 ${n}`,
        probeEscN: (n: string): string => `电调 ${n}`,
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

  compare: {
    title: '多次调参对比',
    tabLabel: '对比',
    tabCount: (n: number): string => `${n} 组`,
    heading: (before: string, after: string) => `${before} → ${after}`,
    sessionLabel: (fileName: string, session: string) => `${fileName} 第 ${session} 段`,
    noTuneChange: '这两次飞行之间没有改动任何设置：下面的差异来自飞行本身，而不是调参。',
    summaryNoChange: '设置无改动',
    summaryChanges: (n: number) => `改动了 ${n} 项设置`,
    caveatsCount: (n: number) => `${n} 条注意事项`,
    tuneTitle: '改动了什么',
    metricsTitle: '测量结果怎么说',
    driverNote: '简化滑块排在前面：是它们重新计算了下方列出的增益，而不是反过来。',
    deltaUnavailable: '轴不同',
    metricUnavailable: '不适用',

    metrics: {
      filtNoise: '滤波后噪声 (deg/s)',
      unfiltNoise: '原始噪声 (deg/s)',
      tracking: '跟随误差 (deg/s)',
      overshoot: '超调 (%)',
      riseTime: '上升时间 (ms)',
      ms: '灵敏度峰值 Ms',
      residualHf: '100 Hz 以上残留',
      propwash: '桨洗 (deg/s)',
      saturation: '电机饱和 (%)',
    },

    caveats: {
      inferredCraft: (board: string) =>
        `日志里没有机架名称，改按飞控板（${board}）分组：设置 craft_name 即可消除疑问。若这些飞行来自同一飞控板上的两台不同机器，则对比没有意义。`,
      firmware: (before: string, after: string) =>
        `固件不同（${before} → ${after}）：调参无法在大版本之间照搬，参数名称和含义都会变。设置对比不可靠。`,
      sampleRate: (before: string, after: string) =>
        `采样率不同（${before} → ${after} Hz）：残留噪声和频谱在这两个日志之间没有可比性。`,
      duration: (before: string, after: string) =>
        `时长相差很大（${before} s → ${after} s）：较短的一次遇到的情况更少，最差值必然偏低。`,
      stickRange: (before: string, after: string) =>
        `打杆幅度不同（峰值 ${before} → ${after} deg/s）：飞得更温和本身就会降低超调和桨洗，与设置无关。`,
      mechanical: (before: string, after: string) =>
        `原始陀螺数据变了（${before} → ${after} deg/s RMS）。它不受调参影响：两次飞行之间机械上有变化（桨、轴承、螺丝）。因此滤波后噪声的差异不再只反映滤波本身。`,
      battery: (before: string, after: string) =>
        `单节压降相差很大（${before} → ${after} V）且未启用补偿：同样的目标值给不出同样的推力。请开启 vbat_sag_compensation，或在电量相近时重飞。`,
    },
  },
};
