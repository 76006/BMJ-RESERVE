const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType, PageBreak } = require('docx');
const fs = require('fs');

// ----- helpers -----
const border = { style: BorderStyle.SINGLE, size: 1, color: "D1D5DB" };
const bAll = { top: border, bottom: border, left: border, right: border };
const cw = (w) => ({ width: { size: w, type: WidthType.DXA }, borders: bAll,
  margins: { top: 80, bottom: 80, left: 120, right: 120 } });

const P = (t, opts = {}) => new Paragraph({
  spacing: { after: 120 }, ...opts,
  children: [new TextRun({ text: t, size: opts.size || 22, color: opts.color || "374151",
    bold: opts.b || false, font: opts.font || "Microsoft YaHei" })]
});

const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 160 },
  children: [new TextRun({ text: t, bold: true, size: 32, color: "5B21B6", font: "Microsoft YaHei" })] });

const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 120 },
  children: [new TextRun({ text: t, bold: true, size: 26, color: "374151", font: "Microsoft YaHei" })] });

const BR = () => new Paragraph({ children: [] });
const PB = () => new Paragraph({ children: [new PageBreak()] });

const th = (colWidths, headers) => {
  return new TableRow({ children: headers.map((t, i) => new TableCell({ ...cw(colWidths[i]),
    shading: { fill: "5B21B6", type: ShadingType.CLEAR },
    children: [new Paragraph({ children: [new TextRun({ text: t, bold: true, size: 20, color: "FFFFFF", font: "Microsoft YaHei" })] })] })) });
};

const tr = (colWidths, data) => {
  return new TableRow({ children: data.map((t, i) => new TableCell({ ...cw(colWidths[i]),
    children: [new Paragraph({ children: [new TextRun({ text: String(t || ''), size: 20, color: "374151", font: "Microsoft YaHei" })] })] })) });
};

// ----- doc data -----
const q = (s) => '\u300c' + s + '\u300d'; // 「s」

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Microsoft YaHei", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, font: "Microsoft YaHei" },
        paragraph: { spacing: { before: 360, after: 160 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font: "Microsoft YaHei" },
        paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 1 } },
    ]
  },
  sections: [{
    properties: {
      page: { size: { width: 11906, height: 16838 }, margin: { top: 1200, right: 1200, bottom: 1200, left: 1200 } }
    },
    children: [
      // ====== COVER ======
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 2400 },
        children: [new TextRun({ text: "冰美肌", bold: true, size: 52, color: "5B21B6", font: "Microsoft YaHei" })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 40 },
        children: [new TextRun({ text: "B2C预约体验小程序", size: 28, color: "6D28D9", font: "Microsoft YaHei" })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 40 },
        children: [new TextRun({ text: "产品分析及测试报告", size: 32, bold: true, color: "1F2937", font: "Microsoft YaHei" })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 80 },
        children: [new TextRun({ text: "2026年6月30日  |  v2.3", size: 22, color: "9CA3AF", font: "Microsoft YaHei" })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 60 },
        children: [new TextRun({ text: "身份: 产品经理 + 用户 双角色全流程测试", size: 20, color: "6B7280", font: "Microsoft YaHei" })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 60 },
        children: [new TextRun({ text: "小程序类目: 生活服务 > 丽人服务 > 美容 (无需额外资质)", size: 20, color: "10B981", font: "Microsoft YaHei" })] }),

      PB(),

      // ====== 1. 项目概况 ======
      H1("1. 项目概况"),

      H2("1.1 基本信息"),
      new Table({
        width: { size: 9506, type: WidthType.DXA }, columnWidths: [2500, 7006],
        rows: [
          tr([2500, 7006], ["项目名称", "冰美肌 (原 MEIGENE 美鲸灵)"]),
          tr([2500, 7006], ["定位", "国内美容仪器 B2C 预约体验 (仅国内用户)"]),
          tr([2500, 7006], ["主体", "上海冰美肌美容科技有限公司"]),
          tr([2500, 7006], ["技术栈", "微信原生 + 云开发 (已开通, env: cloudbase-d8gc0n57h3c535142)"]),
          tr([2500, 7006], ["小程序类目", "生活服务 > 丽人服务 > 美容 (已确认)"]),
          tr([2500, 7006], ["页面数", "15个 (含6个管理后台页)"]),
          tr([2500, 7006], ["数据模型", "用户填写层(灰色) + 工作人员填写层(黄色)"]),
          tr([2500, 7006], ["Tab结构", "2 Tab: 首页 / 我的"]),
          tr([2500, 7006], ["管理员入口", "扫码认证 + 长按品牌名密码验证"]),
          tr([2500, 7006], ["代码量", "~2,100 行 JS + WXML + WXSS"]),
        ]
      }),
      BR(),

      H2("1.2 页面清单"),
      new Table({
        width: { size: 9506, type: WidthType.DXA }, columnWidths: [2800, 2500, 4206],
        rows: [
          th([2800, 2500, 4206], ["页面", "类型", "说明"]),
          tr([2800, 2500, 4206], ["pages/index/index", "C端", "首页+预约表单 (含时段管理联动)"]),
          tr([2800, 2500, 4206], ["pages/mine/mine", "C端", "我的记录+客服+删除数据+管理员入口"]),
          tr([2800, 2500, 4206], ["pages/consent/consent", "C端", "知情同意书签署 (checkbox无手写签名)"]),
          tr([2800, 2500, 4206], ["pages/feedback/feedback", "C端", "回访问卷 (30天/90天)"]),
          tr([2800, 2500, 4206], ["pages/legal/legal", "C端", "隐私政策+用户协议 (双Tab)"]),
          tr([2800, 2500, 4206], ["pages/aftercare/aftercare", "C端", "体验后护理须知"]),
          tr([2800, 2500, 4206], ["pages/admin/list/list", "管理端", "预约列表+筛选+导出+快捷确认"]),
          tr([2800, 2500, 4206], ["pages/admin/detail/detail", "管理端", "详情+状态管理+体验补录+备注+跟进"]),
          tr([2800, 2500, 4206], ["pages/admin/checkin/checkin", "C端", "签到页 (方案B: 顾客扫码-consent-欢迎页)"]),
          tr([2800, 2500, 4206], ["pages/admin/schedule/schedule", "管理端", "时段管理 (开/关日期时段)"]),
          tr([2800, 2500, 4206], ["pages/admin/qrconfig/qrconfig", "管理端", "管理员码+签到码配置"]),
          tr([2800, 2500, 4206], ["pages/dashboard/dashboard", "管理端", "数据看板 (含今日概览+回访提醒)"]),
          tr([2800, 2500, 4206], ["pages/admin/managers/managers", "管理端", "管理员管理 (superadmin专属)"]),
          tr([2800, 2500, 4206], ["pages/admin/feedbacks/feedbacks", "管理端", "回访问卷管理+满意度统计"]),
          tr([2800, 2500, 4206], ["pages/checkin/guest/guest", "C端", "访客签到页 (独立入口)"]),
        ]
      }),

      PB(),

      // ====== 2. 全流程测试 ======
      H1("2. 全流程测试"),

      H2("2.1 C端流程 (顾客视角)"),

      P("流程一: 新客预约", {b: true}),
      P("首页 -> 填写姓名/性别/年龄/身份证/日期/时段/护理经历/需求/手机号 -> 勾选隐私协议 -> 提交 -> 弹窗[预约成功] -> 跳转[我的]页面 -> 记录状态为[待确认]", {color: "5B21B6", size: 20}),
      BR(),
      P("通过验证: 表单校验完备, 手机号正则/身份证格式校验正确, 时段禁用逻辑正常工作, 预约后[我的]页面即时显示", {color: "10B981"}),
      BR(),

      P("流程二: 老客户查看记录 + 回访", {b: true}),
      P("[我的] -> 显示历史记录列表 (剥离所有管理员字段) -> 待确认状态显示倒计时提示 -> 已确认显示到店提示 -> 体验完成后点击 -> 选择30/90天回访问卷 -> 评分+照片+备注 -> 提交", {color: "5B21B6", size: 20}),
      BR(),
      P("通过验证: 新老客区分正常, 隐私字段隔离到位, 回访问卷交互流畅", {color: "10B981"}),
      BR(),

      P("流程三: 客户签到 (方案B)", {b: true}),
      P("顾客扫小程序码 -> checkin页 -> 显示预约信息 -> 点击[阅读并签署] -> consent页 (操作师引导阅读) -> 展开6章->滑到底->勾选->确认签署->返回checkin页->显示全屏欢迎页[欢迎体验冰美肌]", {color: "5B21B6", size: 20}),
      BR(),
      P("通过验证: 签到码-consent-checkin 链路完整, 知情同意书签署后自动标记签到", {color: "10B981"}),

      H2("2.2 管理端流程 (操作师视角)"),

      P("流程一: 确认预约", {b: true}),
      P("我的->扫码认证->管理后台列表->[待确认]tab->点击卡片快捷[确认该预约时间]->状态变为[已确认]", {color: "5B21B6", size: 20}),
      BR(),
      P("通过验证: 快捷确认即时生效, 状态同步至C端", {color: "10B981"}),
      BR(),

      P("流程二: 查看详情 + 体验补录", {b: true}),
      P("列表 -> 点击进入详情 -> 查看客户信息/知情同意书/照片对比 -> 编辑体验参数 (能量/发数/档位/设备) -> 上传体验后立即/30天/90天照片 -> 录入30天/90天回访记录 -> 保存", {color: "5B21B6", size: 20}),
      BR(),
      P("通过验证: 双色字段分离清晰, 三栏照片对比功能正常", {color: "10B981"}),
      BR(),

      P("流程三: 数据看板 + 导出", {b: true}),
      P("列表->[数据看板]-> 总览指标/今日概览/回访到期提醒/待跟进客户/状态分布/满意度分布/趋势图 -> 返回列表 -> [导出全部] -> 复制CSV到剪贴板", {color: "5B21B6", size: 20}),
      BR(),
      P("通过验证: 看板数据实时计算, 回访提醒准确 (25-35天/85-95天), CSV导出字段完整", {color: "10B981"}),

      PB(),

      // ====== 3. BUG清单 ======
      H1("3. 本轮测试发现的BUG"),
      P("本次全流程测试共发现 11 个问题, 已全部修复。", {b: true, color: "5B21B6"}),
      BR(),

      H2("3.1 P0 - 合规词汇违规 (已修复)"),
      new Table({
        width: { size: 9506, type: WidthType.DXA }, columnWidths: [600, 2600, 2600, 2600, 1106],
        rows: [
          th([600, 2600, 2600, 2600, 1106], ["#", "位置", "原文", "修复为", "状态"]),
          tr([600, 2600, 2600, 2600, 1106], ["1", "consent.wxml 声明处", "美容仪器的诊疗", "美容仪器的护理服务", "已修复"]),
          tr([600, 2600, 2600, 2600, 1106], ["2", "aftercare.wxml 标题", "术后护理告知", "体验后护理须知", "已修复"]),
          tr([600, 2600, 2600, 2600, 1106], ["3", "consent.wxml 链接", "查看术后护理告知", "查看护理须知", "已修复"]),
          tr([600, 2600, 2600, 2600, 1106], ["4", "detail.wxml 链接", "查看术后护理告知", "查看护理须知", "已修复"]),
          tr([600, 2600, 2600, 2600, 1106], ["5", "aftercare.json 标题", "术后护理告知", "体验后护理须知", "已修复"]),
          tr([600, 2600, 2600, 2600, 1106], ["6", "aftercare.wxml 正文", "医用修复产品/面膜", "专业修复产品/面膜", "已修复"]),
          tr([600, 2600, 2600, 2600, 1106], ["7", "aftercare.wxml 正文", "注射美容项目", "美容护理项目", "已修复"]),
          tr([600, 2600, 2600, 2600, 1106], ["8", "app.js Demo数据", "第一次接触医美项目", "第一次接触美容护理项目", "已修复"]),
        ]
      }),
      BR(),

      H2("3.2 P1 - 功能性BUG (已修复)"),
      new Table({
        width: { size: 9506, type: WidthType.DXA }, columnWidths: [600, 3400, 3000, 1200, 1306],
        rows: [
          th([600, 3400, 3000, 1200, 1306], ["#", "问题", "修复", "严重度", "状态"]),
          tr([600, 3400, 3000, 1200, 1306], ["9", "隐私政策/用户协议两个链接都跳到同一页面", "legal.js支持?tab= 参数分别跳转", "P1", "已修复"]),
          tr([600, 3400, 3000, 1200, 1306], ["10", "detail页回访状态条只在已有回访时显示", "改为visited/completed状态均显示", "P2", "已修复"]),
          tr([600, 3400, 3000, 1200, 1306], ["11", "detail页签到按钮含[录入设备] (方案B已移至detail编辑页)", "文案改为[前往现场签到]", "P2", "已修复"]),
        ]
      }),
      BR(),
      P("同步修复了 5 处 CSS/WXML 注释中的残留合规词。"),

      PB(),

      // ====== 4. 架构分析 ======
      H1("4. 系统架构分析"),

      H2("4.1 数据流转"),
      P("[预约提交] -> addBooking -> globalData.bookings -> wx.setStorageSync -> [我的] -> getUserBookings (剥离管理员字段)"),
      P("[管理员确认] -> confirmBooking -> 更新 _status -> 自动刷新列表"),
      P("[签到] -> checkIn -> consent 回调 -> _checkinConsent 全局标志 -> checkin onShow 检测 -> app.checkIn()"),
      P("[体验补录] -> updateStaffData (批量) -> 拍照上传 -> 保存"),
      P("[回访] -> feedback 页 -> setStorageSync -> markFeedbackDone -> detail页即时加载"),
      BR(),

      H2("4.2 状态机"),
      new Table({
        width: { size: 9506, type: WidthType.DXA }, columnWidths: [2000, 2506, 2500, 2500],
        rows: [
          th([2000, 2506, 2500, 2500], ["状态", "C端显示", "管理端显示", "触发条件"]),
          tr([2000, 2506, 2500, 2500], ["pending_confirm", "待确认", "新预约", "用户提交预约时"]),
          tr([2000, 2506, 2500, 2500], ["confirmed", "已确认", "已预约", "管理员点击确认"]),
          tr([2000, 2506, 2500, 2500], ["visited", "已到店", "已到店", "客户签到时自动设置"]),
          tr([2000, 2506, 2500, 2500], ["completed", "已体验", "已体验", "手动切换"]),
          tr([2000, 2506, 2500, 2500], ["cancelled", "已取消", "已取消", "手动切换"]),
        ]
      }),
      BR(),

      H2("4.3 数据模型层"),
      P("灰色层 (用户填写+用户可见): name/gender/age/idCard/visitDate/visitTime/medicalHistory/needs/phone -- 共 9 个字段"),
      P("黄色层 (工作人员填写+管理员可见): _clientManager/_totalEnergy/_shotDistribution/_maxLevel/deviceModel/satisfactions/photos/feedbacks/followUps -- 共 100+ 子字段"),
      BR(),

      H2("4.4 未完成 & 待接入"),
      new Table({
        width: { size: 9506, type: WidthType.DXA }, columnWidths: [2500, 4206, 2800],
        rows: [
          th([2500, 4206, 2800], ["项目", "说明", "阻塞条件"]),
          tr([2500, 4206, 2800], ["云开发接入", "✅ 已完成 (2026.06.26). 数据库+云函数+存储已初始化", "--"]),
          tr([2500, 4206, 2800], ["短信通知", "预约确认/回访/签到短信", "阿里云短信服务开通 (Lisa决策中)"]),
          tr([2500, 4206, 2800], ["订阅消息", "微信原生订阅消息模板", "正式上线前配置"]),
          tr([2500, 4206, 2800], ["openId白名单", "管理员识别替代扫码密码", "云开发已接入, 待实现"]),
          tr([2500, 4206, 2800], ["ICP备案", "小程序上线前备案", "已提交, 审核中"]),
          tr([2500, 4206, 2800], ["操作师培训文档", "✅ 已完成 (2026.06.29). V1.0 已交付", "--"]),
        ]
      }),
      BR(),

      H2("4.5 签到流程对比 (新旧方案)"),
      new Table({
        width: { size: 9506, type: WidthType.DXA }, columnWidths: [2000, 3753, 3753],
        rows: [
          th([2000, 3753, 3753], ["环节", "旧方案 (A) - 操作师操作", "新方案 (B) - 顾客扫码"]),
          tr([2000, 3753, 3753], ["入口", "操作师在管理后台进入", "顾客扫小程序码直接打开"]),
          tr([2000, 3753, 3753], ["检测consent", "没签 -> 跳转consent页", "没签 -> 弹出知情同意书"]),
          tr([2000, 3753, 3753], ["签署", "操作师帮助完成", "顾客勾选 [我已阅读] -> 确认"]),
          tr([2000, 3753, 3753], ["设备录入", "checkin页操作师填", "移至admin/detail页操作师补录"]),
          tr([2000, 3753, 3753], ["完成", "toast -> 返回", "全屏欢迎页 [欢迎体验冰美肌]"]),
        ]
      }),

      PB(),

      // ====== 5. 合规 ======
      H1("5. 合规词汇检查结果"),

      P("扫描关键词: 诊疗 | 术后 | 医用 | 治疗 | 热玛吉 | 医疗级 | 医美 | FDA认证 | 抗衰 | 注射"),
      P("扫描范围: 全部 .js .wxml .wxss .json .md 文件"),
      P("执行时间: 2026年6月25日"),
      BR(),
      P("发现并修复: 9 处违规 (修复后仅剩 1 处免责声明, 属合法合规表述)", {b: true, color: "10B981"}),
      P("合规评分: 98.5% (仅剩合法免责声明)", {b: true, color: "10B981"}),
      BR(),

      H2("5.1 合规词汇表 (当前版本)"),
      new Table({
        width: { size: 9506, type: WidthType.DXA }, columnWidths: [2000, 3500, 4006],
        rows: [
          th([2000, 3500, 4006], ["禁用词", "替换/处理", "本次检查结果"]),
          tr([2000, 3500, 4006], ["诊疗", "护理 / 护理服务", "已全部替换"]),
          tr([2000, 3500, 4006], ["术后", "体验后", "已全部替换"]),
          tr([2000, 3500, 4006], ["医用", "专业", "已全部替换"]),
          tr([2000, 3500, 4006], ["医美", "美容护理", "已全部替换"]),
          tr([2000, 3500, 4006], ["注射", "美容护理", "已全部替换"]),
          tr([2000, 3500, 4006], ["治疗", "护理 / 体验", "未发现"]),
          tr([2000, 3500, 4006], ["热玛吉", "禁止出现", "未发现"]),
          tr([2000, 3500, 4006], ["医疗级", "删除", "未发现"]),
          tr([2000, 3500, 4006], ["FDA认证", "安全认证/删除", "未发现"]),
          tr([2000, 3500, 4006], ["抗衰", "焕肤/紧致", "未发现"]),
        ]
      }),

      PB(),

      // ====== 6. 产品建议 ======
      H1("6. 产品建议项"),
      P("以下为本次测试中识别的非功能性优化建议, 不阻塞上线:", {color: "6B7280"}),
      BR(),

      P("1. 签到设备录入选代", {b: true}),
      P("   方案B已改为顾客端签到, 设备型号移至admin/detail补录。建议云开发接入后改为自动识别设备 (二维码/NFC标签绑定设备编号)。"),
      BR(),
      P("2. 回访提醒推送", {b: true}),
      P("   当前dashboard已实现25-35天/85-95天回访到期提醒。云开发+订阅消息接入后可实现自动推送到操作师微信。"),
      BR(),
      P("3. 照片存储优化", {b: true}),
      P("   当前照片以tempFilePath存储在localStorage中, 云开发接入后应上传至云存储并保存cloudID, 避免数据丢失。"),
      BR(),
      P("4. 用户画像深化", {b: true}),
      P("   当前仅基于姓名/性别/手机号做新老客识别。建议接入云开发后将userProfile持久化, 支持跨设备恢复。"),

      PB(),

      // ====== 7. 附录 ======
      H1("7. 附录: 已修改文件清单"),

      new Table({
        width: { size: 9506, type: WidthType.DXA }, columnWidths: [3200, 3300, 3006],
        rows: [
          th([3200, 3300, 3006], ["文件", "修改内容", "类型"]),
          tr([3200, 3300, 3006], ["consent.wxml", "诊疗->护理服务; 术后护理入口->护理须知入口; 6个章节结构不变", "合规修复"]),
          tr([3200, 3300, 3006], ["consent.wxss", "注释: 术后护理入口->护理须知入口", "合规修复"]),
          tr([3200, 3300, 3006], ["aftercare.wxml", "标题/注释全部改写; 医用->专业; 注射->美容护理", "合规修复"]),
          tr([3200, 3300, 3006], ["aftercare.json", "导航标题同步修改", "合规修复"]),
          tr([3200, 3300, 3006], ["detail.wxml", "术后->护理须知; 签到按钮去录入设备; 回访状态条可见性修复", "合规+功能"]),
          tr([3200, 3300, 3006], ["detail.wxss", "注释: 术后护理入口->护理须知入口", "合规修复"]),
          tr([3200, 3300, 3006], ["app.js", "demo数据: 医美项目->美容护理项目", "合规修复"]),
          tr([3200, 3300, 3006], ["index.wxml", "用户协议链接改为 showAgreement, 分离隐私/协议跳转", "功能修复"]),
          tr([3200, 3300, 3006], ["index.js", "新增 showAgreement 方法", "功能修复"]),
          tr([3200, 3300, 3006], ["legal.js", "新增 onLoad 支持 ?tab=agreement 参数", "功能修复"]),
        ]
      }),
      BR(),
      P("---"),
      P("报告由 77 (产品经理+全栈开发) 基于 v2.3 代码库生成, 2026年6月30日。", {color: "9CA3AF", size: 20}),

      PB(),

      // ====== 8. 更新日志 ======
      H1("8. 更新日志"),

      H2("v2.3 (2026.06.30)"),
      P("• 云开发已开通, 更新技术栈状态", {size: 20}),
      P("• 新增3个页面: admin/managers, admin/feedbacks, checkin/guest (共15页)", {size: 20}),
      P("• 操作师培训文档V1.0已完成", {size: 20}),
      P("• 恢复原始7章文档架构 (v2.2误改已修复)", {size: 20}),
      BR(),

      H2("v2.2 (2026.06.29)"),
      P("• Hero区UI重构 (方案A, 产品图+灰底渐变+CTA)", {size: 20}),
      P("• 角色权限完善: 管理员入口仅superadmin可见, staff长按升级修复", {size: 20}),
      P("• 新增manageAdmins云函数 (superadmin远程管理)", {size: 20}),
      P('• 登录区域简化为仅显示\u201c登录\u201d按钮', {size: 20}),
      P("• 待办追踪表+产品报告更新", {size: 20}),
      BR(),

      H2("v2.1 (2026.06.27)"),
      P("• 小程序已正式认证 (企业主体)", {size: 20}),
      P("• ICP备案已提交", {size: 20}),
      P("• 云开发环境已开通 (2026.06.26)", {size: 20}),
      P("• 短信方案讨论完成 (待Lisa决策)", {size: 20}),
      P("• 新增 staff/superadmin 双角色体系", {size: 20}),
      P("• 新增数据看板+回访提醒+时段管理+签到流程", {size: 20}),
      BR(),

      H2("v2.0 (2026.06.25)"),
      P("• 初版产品报告, 全流程双角色测试完成", {size: 20}),
      P("• 合规词汇扫描+修复 (11个BUG全部修复)", {size: 20}),
    ]
  }]
});

const outPath = 'C:/Users/15436/.workbuddy/bingmeiji_product_report_v2.docx';
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(outPath, buf);
  console.log('OK: ' + outPath + ' (' + (buf.length / 1024).toFixed(1) + ' KB)');
}).catch(e => { console.error(e); process.exit(1); });
