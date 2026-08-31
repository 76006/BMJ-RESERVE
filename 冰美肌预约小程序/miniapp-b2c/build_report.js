const fs = require('fs');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        Header, Footer, AlignmentType, LevelFormat, HeadingLevel,
        BorderStyle, WidthType, ShadingType, PageNumber, PageBreak,
        TabStopType, TabStopPosition } = require('docx');

const border = { style: BorderStyle.SINGLE, size: 1, color: "BBBBBB" };
const borders = { top: border, bottom: border, left: border, right: border };
const cm = { top: 60, bottom: 60, left: 100, right: 100 };
const hs = { fill: "2D1B69", type: ShadingType.CLEAR };
const ls = { fill: "F5F3FF", type: ShadingType.CLEAR };
const ws = { fill: "FFF3CD", type: ShadingType.CLEAR };
const ds = { fill: "FEE2E2", type: ShadingType.CLEAR };
const gs = { fill: "D1FAE5", type: ShadingType.CLEAR };

function C(text, opts) {
  const p = typeof opts === 'object' ? opts : {};
  const runs = Array.isArray(text) ? text.map(t => typeof t === 'string' ? new TextRun(t) : t) : [new TextRun(Object.assign({ text: String(text) }, p))];
  return new TableCell({ borders, width: p.width ? { size: p.width, type: WidthType.DXA } : undefined, margins: cm, shading: p.shading, children: [new Paragraph({ children: runs, alignment: p.align || AlignmentType.LEFT })] });
}

function H(text, w) { return C(text, { bold: true, size: 20, color: "FFFFFF", shading: hs, width: w }); }

function P(text, opts) {
  const p = typeof opts === 'object' ? opts : {};
  const runs = Array.isArray(text) ? text.map(t => typeof t === 'string' ? new TextRun(t) : t) : [new TextRun(Object.assign({ text: String(text), size: 22, font: "Arial" }, p))];
  return new Paragraph({ children: runs, spacing: { before: p.before || 80, after: p.after || 80 } });
}

function H1(text) { return new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text, bold: true, size: 32, font: "Arial", color: "2D1B69" })], spacing: { before: 360, after: 200 } }); }
function H2(text) { return new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text, bold: true, size: 28, font: "Arial", color: "5B21B6" })], spacing: { before: 280, after: 160 } }); }
function H3(text) { return new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun({ text, bold: true, size: 24, font: "Arial", color: "374151" })], spacing: { before: 200, after: 120 } }); }

function HR() { return new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "E5E7EB", space: 8 } }, spacing: { before: 80, after: 80 }, children: [] }); }

function BT(level) {
  const map = { '高': { fill: "FEE2E2", color: "DC2626" }, '中': { fill: "FFF3CD", color: "D97706" }, '低': { fill: "D1FAE5", color: "059669" } };
  const s = map[level] || map['中'];
  return new TextRun({ text: ' ' + level + '风险 ', bold: true, size: 18, color: s.color, shading: { fill: s.fill, type: ShadingType.CLEAR }, font: "Arial" });
}

function tbl(ww, rows) {
  return new Table({ width: { size: ww.reduce((a,b)=>a+b,0), type: WidthType.DXA }, columnWidths: ww, rows: rows.map((row, ri) => new TableRow({
    children: row.map((c, i) => {
      if (c && typeof c === 'object' && c._cell) return c._cell;
      return C(c, { bold: ri === 0, width: ww[i] });
    })
  }))});
}

function pageBreak() { return new Paragraph({ children: [new PageBreak()] }); }

// Build all tables as variables first
const t1 = tbl([2500, 3500, 2000, 1840], [
  [H("模块", 2500), H("功能", 3500), H("状态", 2000), H("备注", 1840)],
  ["用户预约", "姓名/性别/年龄/身份证/日期时间段/手机/需求录入", "✓已完成", "含手机号一键授权UI"],
  ["隐私协议", "勾选同意后提交，提交即完成预约", "✓已完成", "弹窗展示隐私政策"],
  ["知情同意书", "6章节折叠阅读+手写签名+滑动到底确认", "✓已完成", "Canvas签名，签到流程集成"],
  ["新老客户识别", "根据本地Storage显示个性化问候", "✓已完成", "XX先生/女士，欢迎回来"],
  ["我的页面", "预约列表+状态展示+回访问卷入口", "✓已完成", "含待确认/已确认提示"],
  ["管理员登录", "扫码认证码+长按密码备用", "✓已完成", "qrconfig页生成认证码"],
  ["后台列表", "8状态筛选+快捷确认+数据导出CSV", "✓已完成", "含待确认Tab"],
  ["客户详情", "完整信息展示+状态流转+分级+备注+跟进", "✓已完成", "onShow自动刷新"],
  ["操作师编辑", "体验参数/设备型号/回访记录/照片上传", "✓已完成", "三栏对比照片"],
  ["现场签到", "扫码或手动录入设备+知情同意书签署+开始体验", "✓已完成", "签到后状态→已到店"],
  ["回访问卷", "6部位评分+整体满意度+照片+90天二次意愿", "✓已完成", "30天/90天两期"],
  ["培训师配置", "培训师ID+渠道+scene参数生成", "✓已完成", "qrconfig页面"],
  ["管理员认证码", "密码哈希+token生成+扫码自动登录", "✓已完成", "本地持久化"],
]);

const t2 = tbl([1600, 2400, 2000, 2000, 1840], [
  [H("阶段", 1600), H("任务项", 2400), H("难度", 2000), H("风险等级", 2000), H("Lisa操作", 1840)],
  ["云开发接入", "开通微信云开发，创建环境，配置数据库集合", "中等", [BT('低'), "配置类任务"], "微信公众平台→开发→云开发→新建环境"],
  ["数据库设计", "设计MongoDB集合：users/bookings/feedbacks/admins/devices，建立索引", "中等", [BT('中'), "数据结构变更需迁移"], "根据现有JS数据模型转为MongoDB Schema"],
  ["用户认证", "wx.login获取openId→云函数换token→用户唯一标识", "简单", [BT('低'), "微信原生支持"], "无需额外操作，云函数内置"],
  ["手机号解密", "getPhoneNumber返回code→云函数调用微信API解密", "中等", [BT('低'), "API调用"], "需企业小程序认证+申请手机号权限"],
  ["数据合规", "《个人信息保护法》合规：隐私政策+数据存储位置+用户删除权", "高", [BT('高'), "法律合规红线"], "起草隐私政策完整版+数据删除功能"],
  ["ICP备案", "腾讯云ICP备案（小程序类目：生活服务→美容/保健）", "中等", [BT('中'), "耗时2-4周"], "腾讯云控制台→ICP备案→提交资料"],
  ["小程序注册", "企业主体注册小程序（个体工商户或有限公司）", "低", [BT('低'), "基础条件"], "微信公众平台→注册→企业认证（300元/年）"],
  ["类目审核", "小程序类目需匹配营业执照经营范围（美容/生活服务）", "高", [BT('高'), "可能被拒"], "确认营业执照含美容/个人护理/生活服务"],
  ["订阅消息", "申请模板ID：预约确认通知/回访提醒/签到提醒", "低", [BT('低'), "审批型"], "微信公众平台→功能→订阅消息→申请模板"],
  ["小程序码", "生成带参小程序码（培训师+管理员），印制物料", "低", [BT('中'), "需上线后操作"], "云开发API或公众平台手动生成"],
  ["小程序提审", "提交微信审核（含隐私政策+用户协议+功能截图）", "中等", [BT('高'), "类目敏感可能被拒"], "提交→等待1-7个工作日→修改→重新提交"],
]);

const t3 = tbl([1800, 2200, 1600, 2000, 2240], [
  [H("维护项",1800),H("内容",2200),H("频率",1600),H("负责人",2000),H("风险",2240)],
  ["数据备份","云开发数据库定期导出","每周","77自动化/Lisa检查","数据丢失风险→设置自动备份"],
  ["隐私合规检查","确认隐私政策更新、同意书记录留存","每月","Lisa","法律风险→合规红线"],
  ["小程序版本更新","微信基础库兼容+新功能迭代","按需","77开发","兼容性测试需覆盖主流机型"],
  ["内容更新","产品图片/文案/知情同意书条款","按需","Lisa提供素材","文案合规→避免禁用词"],
  ["Bug修复","用户反馈+管理员反馈问题","随时","77","紧急Bug需快速响应"],
  ["服务器费用","云开发配额监控+续费","每月","Lisa","超配额中断服务"],
  ["合规审计","数据存储+用户删除权+痕迹保留","每季度","Lisa+法务","监管处罚风险"],
]);

const t4 = tbl([1800, 3400, 2320, 2320], [
  [H("层级",1800),H("组件",3400),H("当前状态",2320),H("目标状态",2320)],
  ["前端","微信小程序 Native (WXML/WXSS/JS)","✓已完成","无变化"],
  ["存储","wx.Storage (localStorage)","当前使用","迁移至云开发MongoDB"],
  ["认证","localStorage _isAdmin 标记","简易实现","wx.login+openId白名单"],
  ["后端","无（纯前端）","当前状态","微信云开发（云函数+云数据库）"],
]);

const t5 = tbl([700, 1900, 2600, 2200, 2440], [
  [H("步",700),H("节点",1900),H("触发/操作",2600),H("前端状态变化",2200),H("需补充/风险",2440)],
  ["1","扫码进入","扫培训师小程序码→scene参数解码→渠道+培训师绑定","globalData.channel/trainerId",[BT('低'),"小程序码需上线后生成"]],
  ["2","填写信息","姓名/性别/年龄/身份证/日期时间段/需求/手机号","表单数据录入data","身份证号→敏感信息加密存储"],
  ["3","手机验证","点击一键授权→getPhoneNumber→code存入","hasPhoneAuth=true",[BT('高'),"需云函数解密手机号"]],
  ["4","隐私协议","阅读隐私政策→勾选同意","agreedPrivacy=true",[BT('中'),"隐私政策需正式版"]],
  ["5","提交预约","validate→addBooking→Storage保存→用户画像保存","status:pending_confirm","云开发后替换为云函数调用"],
  ["6","通知订阅","弹窗→允许/暂不→保存订阅状态","跳转mine页",[BT('中'),"需申请订阅消息模板"]],
  ["7","查看状态","mine页→显示预约列表+待确认提示","greeting个性化问候",[BT('低'),"依赖用户画像"]],
  ["8","等待确认","状态:待确认→操作师确认后→已确认","状态自动刷新(onShow)",[BT('中'),"无推送通知"]],
  ["9","到店签到","操作师扫码签到→知情同意书签署→录入设备","status:visited",[BT('中'),"签名图需云存储持久化"]],
  ["10","30天回访","mine页→点预约→选30天→填写回访问卷","_feedback30=true","回访触发需提醒机制"],
  ["11","90天回访","mine页→点预约→选90天→填写+二次意愿","_feedback90=true","回访触发需提醒机制"],
]);

const t6 = tbl([700, 1900, 2600, 2200, 2440], [
  [H("步",700),H("节点",1900),H("触发/操作",2600),H("前端状态变化",2200),H("需补充/风险",2440)],
  ["1","认证登录","mine页扫管理员码→token验证→本地保存","isAdmin=true",[BT('中'),"认证码=物理钥匙"]],
  ["2","查看列表","管理后台→8状态Tab筛选→点击进入详情","filterStatus切换","无"],
  ["3","确认预约","待确认→点击确认→confirmBooking","status:confirmed",[BT('低'),"需订阅消息推送通知客户"]],
  ["4","签到入口","已确认状态→显示签到入口→点击","navigateTo checkin","无"],
  ["5","知情同意书","检测未签署→跳转consent→阅读/签名→确认","saveConsent+_checkinConsent",[BT('高'),"需法务审核条款"]],
  ["6","设备录入","扫码/手动输入设备型号→确认","deviceModel写入",[BT('低'),"设备二维码需提前生成"]],
  ["7","确认签到","点击确认签到→checkIn→status:visited","done=true→返回",[BT('低'),"无"]],
  ["8","体验补录","detail页编辑模式→填参数/上传照片/回访记录","updateStaffData","照片需云存储（当前临时路径）"],
  ["9","跟进备注","添加跟进记录→内部备注→保存","addFollowUpRecord","无"],
  ["11","数据导出","导出全部→CSV复制到剪贴板→Excel分列","exportCSV",[BT('中'),"大数据量时剪贴板限制"]],
]);

const t7 = tbl([800, 2800, 3200, 3040], [
  [H("步",800),H("动作",2800),H("技术实现",3200),H("合规风险",3040)],
  ["1","用户信息自动填入","consent接收name/gender/age/idCard/phone/visitDate→基本信息章节展示","信息展示需用户确认准确性"],
  ["2","阅读6大章节","折叠展开→每章节展开标记已读→进度条更新","禁忌证列表需完整准确"],
  ["3","滑到底部确认","scroll-view bindscrolltolower→scrolledBottom=true→勾选框可用","确保用户确实看到了全部内容"],
  ["4","勾选确认","勾选「我已完整阅读并理解」→确认签署→写入booking→navigateBack",[BT('高'),"勾选时间戳法律效力"]],
  ["5","后台留存","detail页知情同意书模块→签署人/时间展示","需确保数据不可篡改"],
]);

const t8 = tbl([800, 2800, 3200, 3040], [
  [H("步",800),H("动作",2800),H("技术实现",3200),H("安全风险",3040)],
  ["1","生成认证码","qrconfig页→输入姓名+密码→_adminHash生成token→存入_admins",[BT('中'),"哈希算法为简单hash，非加密安全"]],
  ["2","印制二维码","复制scene参数→微信平台生成小程序码→印制物料",[BT('高'),"认证码=物理钥匙，泄露=管理员权限泄露"]],
  ["3","扫码认证","mine页→scanAdminQR→解析token→_handleAdminScan匹配","匹配成功→本地持久化"],
  ["4","自动登录","下次打开→读取_isAdmin→自动获得权限",[BT('中'),"无过期机制"]],
  ["5","退出管理","list页→退出管理→清除_isAdmin→恢复普通用户","退出后需重新认证"],
  ["6","升级目标","云开发接入后→openId白名单→无感自动识别",[BT('低'),"取代扫码认证"]],
]);

const t9 = tbl([800, 2800, 3200, 3040], [
  [H("步",800),H("动作",2800),H("技术实现",3200),H("需补充",3040)],
  ["1","入口判断","mine页→canFeedback=(visited||completed)→ActionSheet","30天/90天两选项"],
  ["2","问卷加载","feedback页→load已有数据→预填评分/备注","支持修改重新提交"],
  ["3","部位评分","6部位1-5星评分→至少一个部位","整体满意度可选"],
  ["4","照片上传","chooseImage→album/camera→最多3张",[BT('中'),"照片需云存储持久化"]],
  ["5","90天二次意愿","90天问卷→是否愿意二次体验→原因","收集产品复购意向"],
  ["6","提交回写","save feedbacks存储→markFeedbackDone→_feedback30/90=true","detail页显示回访状态"],
  ["7","后续计划","部署定时触发器→到期自动推送订阅消息",[BT('高'),"需云开发定时触发器"]],
]);

const t10 = tbl([1400, 1600, 1600, 2000, 3240], [
  [H("状态码",1400),H("用户端显示",1600),H("管理端显示",1600),H("触发操作",2000),H("后续可流转至",3240)],
  ["pending_confirm","待确认","新预约","用户提交预约→addBooking","confirmed / cancelled（管理员手动）"],
  ["confirmed","已确认","已预约","管理员确认→confirmBooking","visited（签到）/ cancelled"],
  ["visited","已到店","已到店","现场签到→checkIn","completed（成交）/ cancelled（流失）"],
  ["completed","已体验","已体验","管理员手动标记完成","（终态）"],
  ["cancelled","已取消","已取消","管理员手动取消","（终态）"],
]);

const t11 = tbl([2400, 2400, 2400, 2640], [
  [H("字段组",2400),H("字段",2400),H("来源",2400),H("云开发迁移后存储方式",2640)],
  ["用户填写（灰）","name/gender/age/idCard/phone/visitDate/visitTime/medicalHistory/needs","首页表单","bookings集合"],
  ["渠道来源","channel/trainerId/trainerName","扫码scene参数","bookings集合"],
  ["知情同意书","consentSignName/consentSignTime/consentSignImage","consent页Canvas签名","bookings集合+云存储(图片)"],
  ["系统字段","id/createdAt/updatedAt/_status","app.js自动生成","bookings集合+_id自动索引"],
  ["操作师填写（黄）","_clientManager/_totalEnergy/_shotDistribution/_maxLevel/deviceModel","detail页编辑模式","bookings集合"],
  ["操作师填写（黄）","_immediateSatisfaction/_comfortSatisfaction/_productFeedback/_day1/30/90回访","detail页编辑模式","bookings集合"],
  ["照片","_photos/_beforePhotos/_halfPhotos/_afterPhotos","照片上传",[BT('高'),"需迁移至云存储(fileID)"]],
  ["回访反馈","feedbacks存储(area评分/photos/remark/retry)","feedback页提交","feedbacks集合+云存储(照片)"],
  ["管理字段","_adminNote/_followUpRecords","detail页编辑","bookings集合"],
  ["管理员","_admins存储(name/token/sceneParam)","qrconfig页生成","admins集合(密码hash存储)"],
]);

const t12 = tbl([3600, 2800, 3440], [
  [H("风险项",3600),H("影响范围",2800),H("缓解措施",3440)],
  ["类目审核被拒","小程序无法上线","提前确认营业执照经营范围+准备多类目方案"],
  ["知情同意书法律效力不足","法律纠纷时免责条款无效","法务审核+电子签名合规技术"],
  ["签名图片丢失（临时路径）","签署证据缺失","接入云存储→自动上传→永久fileID"],
  ["数据合规违规","行政处罚/下架","完整隐私政策+数据删除功能+加密存储"],
  ["管理员认证码泄露","权限被盗用","定期更换+接入openId白名单"],
  ["云开发配额超限","服务中断","监控用量+升级付费方案"],
  ["手机号解密失败","用户信任度下降","保留手动输入兜底方案"],
  ["禁用词违规","审核不通过","严格执行合规词汇表"],
]);

const t13 = tbl([800, 2600, 1600, 2400, 2440], [
  [H("轮",800),H("问题",2600),H("级别",1600),H("修复方案",2400),H("状态",2440)],
  ["1","detail.js缺少onShow→从checkin返回数据陈旧","P0","抽取_refreshBooking方法+onShow调用","已修复"],
  ["1","手机号'一键授权'按钮误导（toast后无填入）","P1","改为'授权成功，请手动填入'提示+双行说明","已修复"],
  ["1","consent页scrollBottom取消勾选后不重置","P1","toggleAllRead取消时重置+增加scrolltolower事件","已修复"],
  ["1","签到/确认后list页不自动刷新","P1","list.js已有onShow自动刷新（验证通过）","无需修复"],
  ["1","setChannel死代码","P2","已删除","已清理"],
  ["1","phone-input样式优先级冲突","P2","添加width:auto !important","已修复"],
  ["1","管理员无退出按钮","P2","list页增加退出管理按钮+清除Storage","已新增"],
  ["2","回归验证：detail onShow从checkin返回→数据刷新正确","验证","路径已测试通过","通过"],
  ["2","回归验证：手机号授权→双行提示→用户体验改善","验证","UI验证通过","通过"],
  ["3","极限验证：pending_confirm状态checkin→切换模式→签名取消重签","验证","所有路径均已覆盖","通过"],
]);

const t14 = tbl([4920, 4920], [
  [H("77 负责（开发/技术）",4920),H("Lisa 负责（业务/运营/决策）",4920)],
  ["前端小程序全部页面开发与维护","企业主体注册+小程序认证"],
  ["云开发接入：云函数+云数据库+云存储","ICP备案申请与跟进"],
  ["数据库Schema设计与数据迁移","营业执照经营范围确认+类目匹配"],
  ["手机号解密云函数+用户认证体系","隐私政策起草+法务审核"],
  ["订阅消息模板对接+定时触发器","知情同意书条款法务审核"],
  ["应用内域名配置（如需要）", "域名购买/续费"],
  ["小程序提审+类目审核技术支持","小程序提审材料准备+提交"],
  ["日常Bug修复+版本迭代","产品图片素材提供+内容更新"],
  ["数据备份脚本+自动化","云开发费用充值+配额监控"],
  ["回访数据可视化（Dashboard）","业务数据汇总与趋势分析"],
]);

// ASSEMBLE DOCUMENT
const doc = new Document({
  styles: { default: { document: { run: { font: "Arial", size: 22 } } } },
  sections: [
    // Cover
    {
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      children: [
        P("", { before: 2400 }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "冰美肌", bold: true, size: 52, color: "5B21B6", font: "Arial" })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 160 }, children: [new TextRun({ text: "B2C预约体验小程序", size: 32, color: "6B7280", font: "Arial" })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 800 }, children: [new TextRun({ text: "前后端流程分析报告", bold: true, size: 44, color: "111827", font: "Arial" })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 400 }, children: [new TextRun({ text: "版本 v1.0 | 2026年6月25日", size: 24, color: "9CA3AF", font: "Arial" })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 80 }, children: [new TextRun({ text: "面向国内用户 | B2C预约体验小程序", size: 22, color: "9CA3AF", font: "Arial" })] }),
        P("", { before: 2000 }),
        HR(),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "机密文档 · 仅供项目团队内部使用", size: 20, color: "D1D5DB", italics: true, font: "Arial" })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "编制：产品经理 (77) | 负责人：Lisa", size: 20, color: "D1D5DB", font: "Arial" })] }),
      ]
    },
    // Main Content
    {
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1200, right: 1200, bottom: 1200, left: 1200 } } },
      headers: { default: new Header({ children: [new Paragraph({
        alignment: AlignmentType.RIGHT, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "E5E7EB", space: 4 } },
        children: [new TextRun({ text: "冰美肌 · 前后端流程分析报告", size: 18, color: "9CA3AF", font: "Arial" }), new TextRun("\t"), new TextRun({ text: "v1.0", size: 18, color: "9CA3AF", font: "Arial" })],
        tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
      })]}) },
      footers: { default: new Footer({ children: [new Paragraph({
        alignment: AlignmentType.CENTER, border: { top: { style: BorderStyle.SINGLE, size: 4, color: "E5E7EB", space: 4 } },
        children: [new TextRun({ text: "第 ", size: 18, color: "9CA3AF", font: "Arial" }), new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "9CA3AF", font: "Arial" }), new TextRun({ text: " 页", size: 18, color: "9CA3AF", font: "Arial" })],
      })]}) },
      children: [
        H1("执行摘要"),
        P("本报告为冰美肌B2C预约体验小程序的全面前后端流程分析，涵盖功能开发现状、上线部署路径、日常维护需求、未完成事项清单，以及完整的前后端流程架构图。"),
        P("当前项目处于前端原型阶段，所有数据通过微信小程序本地存储（wx.Storage）模拟，尚未接入后端服务和数据库。前端功能已覆盖用户预约、知情同意书签署、现场签到、操作师后台管理、回访问卷等核心业务流程。"),
        HR(),

        H1("第一部分：功能开发 → 上线 → 日常维护任务清单"),
        H2("1.1 当前阶段已完成（前端原型）"),
        t1, P(""),
        H2("1.2 待开发：后端/云服务层（Lisa需完成）"),
        t2, P(""),
        H2("1.3 日常维护（上线后持续）"),
        t3,

        pageBreak(),
        H1("第二部分：未完成事项清单"),
        H2("2.1 核心阻塞项（必须先完成）"),
        P("1. 企业主体小程序注册：这是所有后续工作的前提。需要营业执照（个体工商户或有限公司），经营范围需包含美容/个人护理/生活服务相关类目。注册费用300元/年认证费。"),
        P("2. 微信云开发开通：创建云环境、配置数据库、部署云函数。当前所有数据存储在wx.Storage本地，无法跨设备同步。云开发基础版免费配额：2GB存储/5GB数据库/5GB CDN。"),
        P("3. ICP备案：小程序必须有ICP备案号才能上线。流程：腾讯云控制台→ICP备案→提交主体资料→管局审核（通常2-4周）。"),
        H2("2.2 数据层（需77开发）"),
        P("1. 数据库集合设计：将app.js中的booking数据结构转为MongoDB Schema，设计索引（手机号、状态、日期），处理数据迁移。"),
        P("2. 用户体系：wx.login获取code→云函数换openId和session_key→用户唯一标识。替换当前基于Storage的单设备多用户模式。"),
        P("3. 手机号解密云函数：接收getPhoneNumber的code→调用微信服务端API→解密返回真实手机号→自动填入表单。"),
        P("4. 数据CRUD云函数：预约创建/状态更新/回访提交/CSV导出的云端版本，替换当前Storage直接读写。"),
        P("5. 数据备份脚本：定时导出云数据库到腾讯云COS或本地，防止误删。"),
        H2("2.3 合规层（需Lisa推进）"),
        P("1. 隐私政策完整版：当前为简版弹窗，需扩展为正式隐私政策页面，涵盖：信息收集/使用目的/第三方分享/存储期限/用户权利/投诉渠道。"),
        P("2. 知情同意书法律审核：当前为模板文本，需法务或律师审核条款的有效性和合规性（特别是免责条款和风险告知）。"),
        P("3. 数据删除权实现：根据《个人信息保护法》，用户有权要求删除全部个人数据。需开发注销账号/删除数据功能。"),
        P("4. 敏感个人信息保护：身份证号、手机号、面部照片属于敏感个人信息，需单独授权+加密存储+访问日志。"),
        H2("2.4 提审准备清单"),
        P("1. 小程序截图：首页、预约页、知情同意书、我的页面、后台管理5-8张功能截图。"),
        P("2. 测试账号：提供给审核人员的测试手机号和验证流程。"),
        P("3. 隐私政策URL：需一个可公开访问的隐私政策页面链接（可托管于云开发静态网站）。"),
        P("4. 用户协议：使用条款/免责声明/知识产权声明。"),
        P("5. 功能说明文档：每个页面的功能说明和操作流程。"),
        P("6. 关闭演示数据：删除app.js中的_seedDemoData()和演示数据。"),
        pageBreak(),
        H1("第三部分：前后端完整流程架构"),
        H2("3.1 系统架构总览"),
        P("以下为冰美肌小程序的端到端架构，覆盖从用户入口到管理员后台的完整数据流。"),
        t4, P(""),
        H2("3.2 用户端完整流程（预约→体验→回访）"),
        P([new TextRun({ text: "角色：", bold: true }), new TextRun("客户（C端）")]),
        P([new TextRun({ text: "页面路径：", bold: true }), new TextRun("首页(index) → 我的(mine) → 回访(feedback)")]),
        t5, P(""),
        H2("3.3 操作师端完整流程（确认→签到→补录）"),
        P([new TextRun({ text: "角色：", bold: true }), new TextRun("操作师/管理员")]),
        P([new TextRun({ text: "页面路径：", bold: true }), new TextRun("管理后台(list) → 客户详情(detail) → 签到(checkin) → 知情同意书(consent)")]),
        t6, P(""),
        H2("3.4 知情同意书签署子流程（关键路径）"),
        P("这是整个流程中法律合规风险最高的节点，需特别注意。"),
        t7, P(""),
        H2("3.5 管理员认证子流程"),
        t8, P(""),
        H2("3.6 回访问卷子流程（30天/90天）"),
        t9,

        pageBreak(),
        H2("3.7 状态流转图（booking._status生命周期）"),
        P("以下为一条预约记录从创建到完成的完整状态流转路径，以及每个状态对应的触发操作和页面显示。"),
        t10, P(""),
        H2("3.8 数据模型（booking核心字段）"),
        t11, P(""),
        H2("3.9 风险矩阵总览"),
        t12,

        pageBreak(),
        H1("附录A：第1-3轮模拟测试摘要"),
        P([new TextRun({ text: "测试日期：", bold: true }), new TextRun("2026年6月25日")]),
        P([new TextRun({ text: "测试方式：", bold: true }), new TextRun("代码级完整流程走查，模拟新客户、老客户、操作师角色遍历全部页面和交互")]),
        H3("A.1 发现的BUG及修复"),
        t13, P(""),
        H3("A.2 用户体验建议"),
        P("• 预约提交后添加预约成功全屏过渡页（当前仅有弹窗）"),
        P("• 知情同意书签名区增加笔触粗细调节（当前固定2.5px）"),
        P("• 操作师后台增加批量操作（批量确认/批量导出）"),
        P("• 增加数据看板可视化图表（dashboard页已有入口）"),
        P("• 增加客户搜索功能（按姓名/手机号）"),

        P(""),
        HR(),
        H1("附录B：77与Lisa分工总览"),
        t14,
        P(""),
        P([new TextRun({ text: "— 报告完 —", italics: true, color: "9CA3AF" })], { alignment: AlignmentType.CENTER }),
      ]
    }
  ]
});

const outPath = 'C:/Users/15436/WorkBuddy/20260318155749/anti-aging-website/miniapp-b2c/冰美肌_前后端流程分析报告.docx';
Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync(outPath, buffer);
  console.log('OK: ' + outPath + ' (' + (buffer.length/1024).toFixed(1) + ' KB)');
}).catch(e => console.error('ERR:', e.message));
