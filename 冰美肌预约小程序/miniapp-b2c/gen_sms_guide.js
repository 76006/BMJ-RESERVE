// A1 阿里云短信服务开通指南
const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
  LevelFormat, PageBreak, ExternalHyperlink
} = require("docx");

const A4_WIDTH = 11906;
const CONTENT = A4_WIDTH - 2880; // 1 inch margins each side

const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };

function cell(text, opts = {}) {
  const runs = [];
  if (typeof text === "string") {
    runs.push(new TextRun({ text, bold: opts.bold || false, size: opts.size || 20, font: "Arial", color: opts.color || "333333" }));
  } else {
    // array of TextRun
    text.forEach(t => runs.push(t));
  }
  return new TableCell({
    borders,
    width: { size: opts.width || 3000, type: WidthType.DXA },
    shading: opts.shading ? { fill: opts.shading, type: ShadingType.CLEAR } : undefined,
    margins: cellMargins,
    children: [new Paragraph({ alignment: opts.align || AlignmentType.LEFT, children: runs })]
  });
}

function headerCell(text, width) {
  return cell(text, { width, bold: true, shading: "2E75B6", color: "FFFFFF" });
}

function h1(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text, font: "Arial", bold: true, size: 36, color: "1A3A5C" })] });
}

function h2(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text, font: "Arial", bold: true, size: 28, color: "2E75B6" })] });
}

function para(text, opts = {}) {
  const runs = Array.isArray(text) ? text : [new TextRun({ text, size: 22, font: "Arial", color: "333333" })];
  return new Paragraph({
    spacing: { after: 120 },
    alignment: opts.align || AlignmentType.LEFT,
    children: runs
  });
}

function note(text) {
  return new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text: "⚠ " + text, size: 20, font: "Arial", color: "E67E22", italics: true })]
  });
}

function bullet(text, level = 0) {
  return new Paragraph({
    numbering: { reference: "bullets", level },
    children: [new TextRun({ text, size: 22, font: "Arial", color: "333333" })]
  });
}

function numbered(text, level = 0) {
  return new Paragraph({
    numbering: { reference: "steps", level },
    children: [new TextRun({ text, size: 22, font: "Arial", color: "333333" })]
  });
}

function link(text, url) {
  return new ExternalHyperlink({
    children: [new TextRun({ text, style: "Hyperlink", size: 22 })],
    link: url
  });
}

// ============ 短信模板 ============
const templates = [
  {
    name: "预约提交确认",
    code: "SMS_BOOKING_SUBMIT",
    desc: "用户提交预约后，系统自动发送确认短信给用户",
    recipient: "用户",
    content: "【冰美肌】您的体验预约已提交。预约日期：${date}，时段：${time}。门店将尽快与您联系确认，请保持手机畅通。退订回T",
    vars: "${date}（预约日期）、${time}（预约时段）"
  },
  {
    name: "预约确认通知",
    code: "SMS_BOOKING_CONFIRMED",
    desc: "操作师确认预约后，通知用户按时到店",
    recipient: "用户",
    content: "【冰美肌】您的体验预约已确认！请于${date} ${time}到店体验。地址：${address}。如有变动请提前联系客服。退订回T",
    vars: "${date}（日期）、${time}（时段）、${address}（门店地址）"
  },
  {
    name: "体验完成感谢",
    code: "SMS_EXPERIENCE_DONE",
    desc: "操作师签到完成后，发送感谢短信给用户",
    recipient: "用户",
    content: "【冰美肌】感谢您今日到店体验！护理后如有任何不适或疑问，请及时联系门店${tel}。期待再次为您服务。退订回T",
    vars: "${tel}（门店电话）"
  },
  {
    name: "回访提醒",
    code: "SMS_FOLLOWUP",
    desc: "体验后30天/90天，提醒用户填写回访问卷",
    recipient: "用户",
    content: "【冰美肌】距您上次护理体验已${days}天，诚邀您花1分钟填写回访问卷，帮助我们持续改进：${url}。退订回T",
    vars: "${days}（距上次天数）、${url}（问卷链接）"
  }
];

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 36, bold: true, font: "Arial", color: "1A3A5C" },
        paragraph: { spacing: { before: 360, after: 180 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: "Arial", color: "2E75B6" },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 } },
    ]
  },
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
          { level: 1, format: LevelFormat.BULLET, text: "\u25E6", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 1440, hanging: 360 } } } }
        ]
      },
      {
        reference: "steps",
        levels: [
          { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
          { level: 1, format: LevelFormat.LOWER_LETTER, text: "%2)", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 1440, hanging: 360 } } } }
        ]
      }
    ]
  },
  sections: [
    // ============ 封面 ============
    {
      properties: {
        page: {
          size: { width: A4_WIDTH, height: 16838 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
        }
      },
      children: [
        new Paragraph({ spacing: { before: 3600 } }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 240 },
          children: [new TextRun({ text: "冰美肌小程序", size: 48, bold: true, font: "Arial", color: "1A3A5C" })]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 600 },
          children: [new TextRun({ text: "阿里云短信服务开通指南", size: 40, bold: true, font: "Arial", color: "2E75B6" })]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
          children: [new TextRun({ text: "任务编号：A1  |  负责人：Lisa  |  协助：77", size: 22, font: "Arial", color: "888888" })]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "2025年6月25日", size: 22, font: "Arial", color: "888888" })]
        }),
        new Paragraph({ children: [new PageBreak()] }),

        // ============ 目录说明 ============
        h1("一、概述"),
        para("本指南为冰美肌小程序接入阿里云短信服务的完整操作步骤。短信服务用于以下4个业务场景，覆盖用户从预约到回访的全生命周期通知。"),
        para(""),
        para([
          new TextRun({ text: "涉及支付和账号操作，所有需要登录和付款的步骤请Lisa亲自操作。", size: 22, font: "Arial", color: "E74C3C", bold: true })
        ]),
        para(""),

        // 全局时间线
        para([
          new TextRun({ text: "预计总耗时：", size: 22, font: "Arial", color: "333333", bold: true }),
          new TextRun({ text: "注册（10分钟）+ 实名认证（即时~2小时）+ 签名审核（1-2个工作日）+ 模板审核（1-2个工作日）", size: 22, font: "Arial", color: "333333" })
        ]),

        // ============ 步骤一：注册阿里云账号 ============
        para(""),
        h1("二、注册阿里云账号"),
        para(""),

        numbered("打开浏览器访问 ", 0),
        para([new TextRun({ text: "  https://www.aliyun.com/", size: 22 })]),
        numbered("点击右上角「免费注册」", 0),
        para(""),
        bullet("使用手机号注册（建议使用公司法人或负责人的手机号）"),
        bullet("设置登录密码（12位以上，含大小写字母+数字+符号）"),
        para(""),
        numbered("实名认证", 0),
        para(""),

        note("企业认证需要上传营业执照，请提前准备营业执照照片。"),
        para(""),
        bullet("登录后点击右上角头像 →「实名认证」"),
        bullet("选择「企业认证」（不是个人认证，企业认证才能开通短信服务）"),
        bullet("填写企业信息：统一社会信用代码、法人姓名、身份证号"),
        bullet("上传营业执照照片"),
        bullet("对公打款验证 或 法人支付宝扫脸验证（二选一）"),
        bullet("提交审核，通常即时到2小时内通过"),
        para(""),

        // ============ 步骤二：开通短信服务 ============
        h1("三、开通短信服务"),
        para(""),
        numbered("实名认证通过后，在阿里云控制台搜索「短信服务」", 0),
        para([new TextRun({ text: "  或直接访问：https://dysms.console.aliyun.com/", size: 22 })]),
        numbered("点击「立即开通」", 0),
        para(""),
        bullet("首次开通免费，按实际发送量计费"),
        bullet("国内短信约 0.045 元/条"),
        bullet("建议先充值 100 元测试（约 2,200 条短信）"),
        para(""),

        // 费用预估表
        h2("费用预估"),
        para(""),
        new Table({
          width: { size: CONTENT, type: WidthType.DXA },
          columnWidths: [3000, 3000, 3026],
          rows: [
            new TableRow({ children: [headerCell("场景", 3000), headerCell("预计月发送量", 3000), headerCell("月费用（约）", 3026)] }),
            new TableRow({ children: [
              cell("预约提交确认", { width: 3000 }),
              cell("50-200条", { width: 3000 }),
              cell("￥2.25 - ￥9.00", { width: 3026 })
            ]}),
            new TableRow({ children: [
              cell("预约确认通知", { width: 3000 }),
              cell("50-200条", { width: 3000 }),
              cell("￥2.25 - ￥9.00", { width: 3026 })
            ]}),
            new TableRow({ children: [
              cell("体验完成感谢", { width: 3000 }),
              cell("30-150条", { width: 3000 }),
              cell("￥1.35 - ￥6.75", { width: 3026 })
            ]}),
            new TableRow({ children: [
              cell("回访提醒", { width: 3000 }),
              cell("30-100条", { width: 3000 }),
              cell("￥1.35 - ￥4.50", { width: 3026 })
            ]}),
            new TableRow({ children: [
              cell("合计", { width: 3000, bold: true, shading: "EBF5FB" }),
              cell("160-650条/月", { width: 3000, bold: true, shading: "EBF5FB" }),
              cell("￥7 - ￥30/月", { width: 3026, bold: true, shading: "EBF5FB" })
            ]})
          ]
        }),
        para(""),
        para([new TextRun({ text: "注：", size: 20, font: "Arial", color: "888888" }), new TextRun({ text: "以上为估算值，实际费用按发送量计费，无最低消费。", size: 20, font: "Arial", color: "888888" })]),
        new Paragraph({ children: [new PageBreak()] }),

        // ============ 步骤三：申请短信签名 ============
        h1("四、申请短信签名"),
        para(""),
        para("短信签名是短信开头显示的【品牌名】，每个短信都必须带签名。"),
        para(""),

        new Table({
          width: { size: CONTENT, type: WidthType.DXA },
          columnWidths: [2500, 6526],
          rows: [
            new TableRow({ children: [headerCell("项目", 2500), headerCell("填写内容", 6526)] }),
            new TableRow({ children: [
              cell("签名名称", { width: 2500, bold: true }),
              cell("冰美肌", { width: 6526 })
            ]}),
            new TableRow({ children: [
              cell("适用场景", { width: 2500, bold: true }),
              cell("验证码、短信通知", { width: 6526 })
            ]}),
            new TableRow({ children: [
              cell("签名来源", { width: 2500, bold: true }),
              cell("企事业单位的全称或简称", { width: 6526 })
            ]}),
            new TableRow({ children: [
              cell("申请说明", { width: 2500, bold: true }),
              cell("用于冰美肌微信小程序向用户发送预约确认、回访提醒等通知短信", { width: 6526 })
            ]}),
            new TableRow({ children: [
              cell("证明文件", { width: 2500, bold: true }),
              cell("上传营业执照（与实名认证一致的企业主体）", { width: 6526 })
            ]}),
            new TableRow({ children: [
              cell("审核时长", { width: 2500, bold: true }),
              cell("1-2个工作日", { width: 6526 })
            ]})
          ]
        }),
        para(""),
        numbered("在短信服务控制台 →「国内消息」→「签名管理」→「添加签名」", 0),
        numbered("按上表填写后提交审核", 0),
        para(""),
        note("签名名称「冰美肌」必须与企业营业执照上的名称关联。如果营业执照是「XX科技有限公司」，建议签名申请说明中注明「冰美肌」为旗下品牌。"),
        para(""),

        // ============ 步骤四：申请短信模板 ============
        new Paragraph({ children: [new PageBreak()] }),
        h1("五、申请短信模板"),
        para(""),
        para("以下是4个业务场景的短信模板，需逐一提交审核。"),
        para(""),

        ...templates.flatMap((t, i) => [
          h2(`模板 ${i + 1}：${t.name}`),
          para(""),
          new Table({
            width: { size: CONTENT, type: WidthType.DXA },
            columnWidths: [2500, 6526],
            rows: [
              new TableRow({ children: [headerCell("项目", 2500), headerCell("内容", 6526)] }),
              new TableRow({ children: [
                cell("模板名称", { width: 2500, bold: true }),
                cell(t.code, { width: 6526 })
              ]}),
              new TableRow({ children: [
                cell("模板类型", { width: 2500, bold: true }),
                cell("短信通知", { width: 6526 })
              ]}),
              new TableRow({ children: [
                cell("适用场景", { width: 2500, bold: true }),
                cell(t.desc, { width: 6526 })
              ]}),
              new TableRow({ children: [
                cell("接收人", { width: 2500, bold: true }),
                cell(t.recipient, { width: 6526 })
              ]}),
              new TableRow({ children: [
                cell("模板内容", { width: 2500, bold: true, shading: "EBF5FB" }),
                cell(t.content, { width: 6526, shading: "EBF5FB" })
              ]}),
              new TableRow({ children: [
                cell("变量说明", { width: 2500, bold: true }),
                cell(t.vars, { width: 6526 })
              ]})
            ]
          }),
          para("")
        ]),

        note("模板审核通常1-2个工作日。如果被驳回，通常是因为「内容涉及营销」——此时需向审核人员说明这是「纯通知类短信，非营销推广」。"),
        para(""),

        // ============ 步骤五：获取AccessKey ============
        new Paragraph({ children: [new PageBreak()] }),
        h1("六、获取AccessKey"),
        para(""),
        para("AccessKey是程序调用阿里云API的凭证，将在A2阶段配置到微信云函数中。"),
        para(""),

        note("AccessKey Secret仅在创建时显示一次，请务必立即保存！"),
        para(""),
        numbered("在阿里云控制台右上角点击头像 →「AccessKey管理」", 0),
        para([new TextRun({ text: " 或直接访问：https://ram.console.aliyun.com/manage/ak", size: 22 })]),
        numbered("点击「创建AccessKey」→ 手机验证码确认", 0),
        numbered("立即保存显示的", 0),
        bullet("AccessKey ID（类似 LTAI5t... ）"),
        bullet("AccessKey Secret（类似 x7G2k...）——这个只显示一次！"),
        para(""),
        para([
          new TextRun({ text: "保存位置：", size: 22, font: "Arial", color: "E74C3C", bold: true }),
          new TextRun({ text: "请将 AccessKey ID 和 Secret 保存到安全位置（如：微信收藏、加密笔记），后续A2阶段需要配置到云函数环境变量中。", size: 22, font: "Arial", color: "333333" })
        ]),
        para(""),

        // ============ 步骤汇总 ============
        h1("七、操作清单"),
        para(""),
        new Table({
          width: { size: CONTENT, type: WidthType.DXA },
          columnWidths: [1200, 3400, 2226, 2200],
          rows: [
            new TableRow({ children: [
              headerCell("序号", 1200),
              headerCell("操作项", 3400),
              headerCell("预计耗时", 2226),
              headerCell("状态", 2200)
            ]}),
            new TableRow({ children: [
              cell("1", { width: 1200 }),
              cell("注册阿里云账号", { width: 3400 }),
              cell("10分钟", { width: 2226 }),
              cell("☐ 待完成", { width: 2200 })
            ]}),
            new TableRow({ children: [
              cell("2", { width: 1200 }),
              cell("企业实名认证", { width: 3400 }),
              cell("即时~2小时", { width: 2226 }),
              cell("☐ 待完成", { width: 2200 })
            ]}),
            new TableRow({ children: [
              cell("3", { width: 1200 }),
              cell("开通短信服务 + 充值", { width: 3400 }),
              cell("5分钟", { width: 2226 }),
              cell("☐ 待完成", { width: 2200 })
            ]}),
            new TableRow({ children: [
              cell("4", { width: 1200 }),
              cell("申请短信签名「冰美肌」", { width: 3400 }),
              cell("提交2分钟，审核1-2天", { width: 2226 }),
              cell("☐ 待完成", { width: 2200 })
            ]}),
            new TableRow({ children: [
              cell("5", { width: 1200 }),
              cell("申请4个短信模板", { width: 3400 }),
              cell("提交5分钟，审核1-2天", { width: 2226 }),
              cell("☐ 待完成", { width: 2200 })
            ]}),
            new TableRow({ children: [
              cell("6", { width: 1200 }),
              cell("创建AccessKey并保存", { width: 3400 }),
              cell("3分钟", { width: 2226 }),
              cell("☐ 待完成", { width: 2200 })
            ]})
          ]
        }),
        para(""),

        // ============ 后续集成方案 ============
        h1("八、后续集成方案（A2完成后）"),
        para(""),
        para("A2（微信云开发开通）完成后，77将创建云函数调用阿里云短信API。"),
        para(""),
        bullet("云函数名：cloudfunctions/sendSms/"),
        bullet("SDK：@alicloud/dysmsapi20170525"),
        bullet("环境变量：ALIBABA_ACCESS_KEY_ID / ALIBABA_ACCESS_KEY_SECRET / SMS_SIGN_NAME / SMS_TEMPLATE_CODES"),
        bullet("调用时机："),
        bullet("用户提交预约 → onBookingCreate 触发器", 1),
        bullet("操作师确认 → confirmBooking 方法内", 1),
        bullet("签到完成 → checkIn 方法内", 1),
        bullet("回访提醒 → 定时触发器（30天/90天）", 1),
        para(""),

        para([
          new TextRun({ text: "提示：", size: 22, font: "Arial", color: "2E75B6", bold: true }),
          new TextRun({ text: "签名和模板审核需要1-2个工作日，建议现在就开始操作，这样A2完成时短信已就绪，可以无缝集成。", size: 22, font: "Arial", color: "333333" })
        ]),
      ]
    }
  ]
});

const outPath = "C:/Users/15436/Desktop/A1_阿里云短信服务开通指南.docx";
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(outPath, buf);
  console.log("Done: " + outPath);
});
