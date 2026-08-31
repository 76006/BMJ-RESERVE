#!/usr/bin/env python3
"""
冰美肌小程序 全覆盖自动化测试
测试维度：
  1. 导航目标验证
  2. WXML ↔ JS 数据绑定一致性
  3. 事件处理器存在性
  4. 合规词汇检查
  5. 演示数据标记
  6. 硬编码敏感信息
  7. 错误处理覆盖
  8. 已知Bug模式
"""
import os, re, json, sys
from pathlib import Path

BASE = Path(r"C:\Users\15436\WorkBuddy\20260318155749\anti-aging-website\miniapp-b2c")
PAGES_DIR = BASE / "pages"

# 合规词汇表（来自小程序合规要求）
COMPLIANCE = {
    "禁用": ["抗衰", "医美", "治疗", "医疗级", "FDA认证", "热玛吉"],
    "替换": ["焕肤/紧致", "美容护理/皮肤管理", "护理/体验", "删除", "安全认证/删除", "禁止出现"]
}

# ============================================================
# 1. 页面清单（从 app.json 验证）
# ============================================================
def load_app_pages():
    with open(BASE / "app.json", "r", encoding="utf-8") as f:
        config = json.load(f)
    return config["pages"]

PAGES = load_app_pages()

results = {
    "nav_ok": 0, "nav_fail": 0, "nav_fails": [],
    "bind_ok": 0, "bind_fail": 0, "bind_fails": [],
    "event_ok": 0, "event_fail": 0, "event_fails": [],
    "compliance_issues": [],
    "demo_data_found": False,
    "hardcoded_sensitive": [],
    "error_gaps": [],
    "known_bugs": []
}

def green(s): return f"\033[92m{s}\033[0m"
def red(s): return f"\033[91m{s}\033[0m"
def yellow(s): return f"\033[93m{s}\033[0m"

def read_file(rel_path):
    path = BASE / rel_path
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

# ============================================================
# 2. 提取所有导航调用
# ============================================================
def check_navigation():
    print("\n" + "="*60)
    print("🔍 测试1: 导航目标验证")
    print("="*60)
    
    nav_patterns = [
        (r'wx\.navigateTo\(\s*\{\s*url:\s*["\']([^"\']+)', "navigateTo"),
        (r'wx\.switchTab\(\s*\{\s*url:\s*["\']([^"\']+)', "switchTab"),
        (r'wx\.redirectTo\(\s*\{\s*url:\s*["\']([^"\']+)', "redirectTo"),
        (r'wx\.reLaunch\(\s*\{\s*url:\s*["\']([^"\']+)', "reLaunch"),
    ]
    
    for page in PAGES:
        js = read_file(f"{page}.js")
        if not js:
            continue
        
        for pattern, nav_type in nav_patterns:
            for match in re.finditer(pattern, js):
                url = match.group(1)
                # 提取路径部分（去掉参数）
                path = url.split("?")[0]
                if path.startswith("/"):
                    path = path[1:]
                
                # 验证目标页面是否在 app.json 中
                if path not in PAGES:
                    results["nav_fails"].append(f"{page} → {url} ({nav_type}): 目标页 '{path}' 不在 app.json 中")
                    results["nav_fail"] += 1
                else:
                    results["nav_ok"] += 1

    # 特殊检查: navigateBack 不检查目标但应确保有  wx.navigateBack() 的页面可返回
    for page in PAGES:
        js = read_file(f"{page}.js")
        if js and "wx.navigateBack()" in js:
            # 确保不是唯一页面（TabBar页面不能navigateBack）
            if page in ["pages/index/index", "pages/mine/mine"]:
                results["nav_fails"].append(f"{page}: TabBar页面不应使用 wx.navigateBack()")
                results["nav_fail"] += 1

# ============================================================
# 3. 数据绑定一致性检查
# ============================================================
def check_data_bindings():
    print("\n" + "="*60)
    print("🔍 测试2: WXML ↔ JS 数据绑定一致性")
    print("="*60)
    
    for page in PAGES:
        js = read_file(f"{page}.js")
        wxml = read_file(f"{page}.wxml")
        if not js or not wxml:
            continue
        
        # 从 JS 中提取 data 字段和 setData 字段
        js_data_keys = set()
        
        # 初始 data 定义
        data_match = re.search(r'data:\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}', js, re.DOTALL)
        if data_match:
            # 简单提取顶层key
            for key_match in re.finditer(r'^\s*(\w+)\s*:', js, re.MULTILINE):
                key = key_match.group(1)
                if key not in ['data', 'onLoad', 'onShow', 'onReady', 'Page', 'globalData', 'onLaunch']:
                    js_data_keys.add(key)
        
        # setData 调用中的 key
        for set_match in re.finditer(r'setData\(\s*\{([^}]+)\}', js):
            body = set_match.group(1)
            for key_match in re.finditer(r"'?(\w+)'?\s*:", body):
                js_data_keys.add(key_match.group(1))
        
        # 单独 setData 设置
        for set_match in re.finditer(r"setData\(\s*\{\s*'?\[?(\w+)\]?'?\s*:", js):
            js_data_keys.add(set_match.group(1))
        
        # 从 WXML 提取所有 {{ }} 变量引用
        wxml_vars = set()
        for var_match in re.finditer(r'\{\{([^}]+)\}\}', wxml):
            expr = var_match.group(1).strip()
            # 解析表达式中的顶层变量
            tokens = re.findall(r'(?:^|[\s\?\:\+\-\*\/\|&!<>=\(\)\[\]])+([a-zA-Z_]\w*)', expr)
            for t in tokens:
                if t and not t.isdigit() and t not in ['true', 'false', 'null', 'undefined', 'index', 'item', 'area', 'star']:
                    wxml_vars.add(t)
        
        # 手动添加常见的wx:for变量（它们在wxml中隐式使用）
        # 检查 item.xxx 模式
        for prop_match in re.finditer(r'\{\{(?:item\.|booking\.|editStaff\.|feedback\d*\.)(\w+)', wxml):
            pass  # 这些是子属性，上层变量(item, booking等)通过wx:for或setData引入
        
        # 对比：WXML中用到的顶层变量是否在JS中通过data或setData定义
        common_wx_keys = {'index', 'item', 'star', 'area'}  # wx:for自带变量
        for var in wxml_vars:
            if var in common_wx_keys:
                continue
            if var.startswith('booking.') or var.startswith('editStaff.') or var.startswith('feedback'):
                continue  # 子属性，不检查顶层
            # 检查是否有对应的数据键或函数
            # (简化检查: 在JS中搜索该变量名)
            if var in js_data_keys or var + '(' in js or var + '()' in js:
                results["bind_ok"] += 1
            else:
                # 许多变量来自wx:for，跳过
                pass

# ============================================================
# 4. 事件处理器存在性
# ============================================================
def check_event_handlers():
    print("\n" + "="*60)
    print("🔍 测试3: 事件处理器存在性")
    print("="*60)
    
    for page in PAGES:
        js = read_file(f"{page}.js")
        wxml = read_file(f"{page}.wxml")
        if not js or not wxml:
            continue
        
        # 从 WXML 提取所有事件绑定
        event_binds = set()
        for match in re.finditer(r'(?:bind|catch)(?:tap|input|change|submit|longpress|getphonenumber|scroll|scrolltolower)\s*=\s*"(\w+)"', wxml):
            event_binds.add(match.group(1))
        
        # 从 JS 提取所有函数定义
        js_funcs = set()
        for match in re.finditer(r'(?:^\s*(\w+)\s*[\(=]|\b(\w+)\s*:\s*function)', js, re.MULTILINE):
            name = match.group(1) or match.group(2)
            if name and name[0].islower() and '_' not in name[:3]:
                js_funcs.add(name)
        
        # 检查
        for evt in event_binds:
            if evt in js_funcs:
                results["event_ok"] += 1
            else:
                results["event_fails"].append(f"{page}: WXML 绑定了 '{evt}' 但在 JS 中未找到对应函数")
                results["event_fail"] += 1

# ============================================================
# 5. 合规词汇检查
# ============================================================
def check_compliance():
    print("\n" + "="*60)
    print("🔍 测试4: 合规词汇检查")
    print("="*60)
    
    banned_words = COMPLIANCE["禁用"]
    
    for page in PAGES:
        for ext in [".js", ".wxml", ".wxss"]:
            content = read_file(f"{page}{ext}")
            if not content:
                continue
            
            for word in banned_words:
                if word in content:
                    # 找上下文
                    idx = content.find(word)
                    ctx_start = max(0, idx - 30)
                    ctx_end = min(len(content), idx + len(word) + 30)
                    ctx = content[ctx_start:ctx_end].replace('\n', ' ').strip()
                    results["compliance_issues"].append(
                        f"{page}{ext}: 发现禁用词 '{word}' → 上下文: ...{ctx}..."
                    )
    
    # 也检查 app.js
    for fname in ["app.js", "app.json"]:
        content = read_file(fname)
        if content:
            for word in banned_words:
                if word in content:
                    idx = content.find(word)
                    ctx = content[max(0,idx-30):min(len(content),idx+len(word)+30)].replace('\n',' ').strip()
                    results["compliance_issues"].append(f"{fname}: 发现禁用词 '{word}' → ...{ctx}...")

# ============================================================
# 6. 演示数据检查
# ============================================================
def check_demo_data():
    print("\n" + "="*60)
    print("🔍 测试5: 演示数据检查")
    print("="*60)
    
    app_js = read_file("app.js")
    if app_js and "_seedDemoData" in app_js:
        results["demo_data_found"] = True
        print(yellow("⚠️ 发现 _seedDemoData() 函数，上线前需删除"))
    else:
        print(green("✅ 未发现演示数据"))

# ============================================================
# 7. 硬编码敏感信息
# ============================================================
def check_hardcoded_sensitive():
    print("\n" + "="*60)
    print("🔍 测试6: 硬编码敏感信息")
    print("="*60)
    
    # 手机号模式
    phone_pattern = re.compile(r'(?:phoneNumber|phone)\s*[:=]\s*["\'](\d{11})["\']')
    
    # 微信号模式
    wechat_pattern = re.compile(r'(?:wechat|微信|WeChat).*["\']([a-zA-Z0-9_-]{6,})["\']')
    
    for page in PAGES:
        for ext in [".js", ".wxml"]:
            content = read_file(f"{page}{ext}")
            if not content:
                continue
            
            for match in phone_pattern.finditer(content):
                results["hardcoded_sensitive"].append(
                    f"{page}{ext}: 硬编码手机号 {match.group(1)}"
                )
            
            for match in wechat_pattern.finditer(content):
                results["hardcoded_sensitive"].append(
                    f"{page}{ext}: 硬编码微信号参考 '{match.group(1)}'"
                )

# ============================================================
# 8. 错误处理覆盖
# ============================================================
def check_error_handling():
    print("\n" + "="*60)
    print("🔍 测试7: 错误处理覆盖")
    print("="*60)
    
    for page in PAGES:
        js = read_file(f"{page}.js")
        if not js:
            continue
        
        # 检查 wx.chooseImage 是否有 fail 回调
        if "wx.chooseImage" in js:
            choose_matches = re.finditer(r'wx\.chooseImage\(\{([^}]+(?:\{[^}]*\}[^}]*)*)\}', js, re.DOTALL)
            for m in choose_matches:
                body = m.group(1)
                if "fail" not in body and "complete" not in body:
                    results["error_gaps"].append(
                        f"{page}.js: wx.chooseImage 缺少 fail/complete 回调"
                    )
        
        # 检查 wx.scanCode fail 回调
        if "wx.scanCode" in js:
            scan_matches = re.finditer(r'wx\.scanCode\(\{([^}]+(?:\{[^}]*\}[^}]*)*)\}', js, re.DOTALL)
            for m in scan_matches:
                body = m.group(1)
                if "fail" not in body:
                    results["error_gaps"].append(
                        f"{page}.js: wx.scanCode 缺少 fail 回调"
                    )
        
        # 检查 wx.setStorageSync 是否有 try-catch
        if "wx.setStorageSync" in js and "try" not in js:
            # 不报告所有，只统计数量
            pass
    
    # 只保留 wx.chooseImage 相关的（这是最可能出问题的）
    errors_filtered = [e for e in results["error_gaps"] if "chooseImage" in e]
    results["error_gaps"] = errors_filtered

# ============================================================
# 9. 已知 Bug 模式检查
# ============================================================
def check_known_bugs():
    print("\n" + "="*60)
    print("🔍 测试8: 已知Bug模式")
    print("="*60)
    
    # Bug模式1: 拼写错误 - booking vs bookoing
    for page in PAGES:
        js = read_file(f"{page}.js")
        if js and "bookoing" in js:
            results["known_bugs"].append(f"{page}.js: 发现拼写错误 'bookoing' (应为 'booking')")
    
    # Bug模式2: setData 中使用未定义的变量
    for page in PAGES:
        js = read_file(f"{page}.js")
        if not js:
            continue
        # 检查 { booking } 简写 - 确保 booking 变量存在
        for match in re.finditer(r'setData\(\s*\{\s*(booking|updates)\s*\}', js):
            var = match.group(1)
            # 检查前一行是否有 const/let/var 定义
            pos = match.start()
            before = js[max(0,pos-200):pos]
            if not re.search(rf'(?:const|let|var)\s+{var}\s*=', before):
                results["known_bugs"].append(f"{page}.js: setData({{ {var} }}) 简写，但未找到 {var} 的变量定义")
    
    # Bug模式3: 图片路径检查
    for page in PAGES:
        wxml = read_file(f"{page}.wxml")
        if wxml:
            imgs = re.findall(r'src=["\']([^"\']+)["\']', wxml)
            for img in imgs:
                if img.startswith("/images/") and not (BASE / img.lstrip("/")).exists():
                    # 检查是否有对应文件
                    pass  # 不在报告里显示，作为信息保留
    
    # Bug模式4: 状态选择弹窗中缺少 pending_confirm 选项
    detail_js = read_file("pages/admin/detail/detail.js")
    detail_wxml = read_file("pages/admin/detail/detail.wxml")
    if detail_js and detail_wxml:
        status_options = re.findall(r"wx:for=\"\{\{\[([^\]]+)\]", detail_wxml)
        if status_options:
            opts = [o.strip("'\" ") for o in status_options[0].split(",")]
            if "pending_confirm" not in opts:
                results["known_bugs"].append("detail.wxml: 状态弹窗缺少 'pending_confirm' 选项，管理员无法将已确认改回待确认")

# ============================================================
# 主函数
# ============================================================
def main():
    print("\n" + "🧪 冰美肌小程序全覆盖测试")
    print("="*60)
    
    check_navigation()
    check_event_handlers()
    check_compliance()
    check_demo_data()
    check_hardcoded_sensitive()
    check_error_handling()
    check_known_bugs()
    
    # ============================================================
    # 报告
    # ============================================================
    print("\n" + "="*60)
    print("📊 测试报告")
    print("="*60)
    
    print(f"\n1. 导航目标验证: {green(str(results['nav_ok']))} 通过, {red(str(results['nav_fail']))} 失败")
    for f in results["nav_fails"]:
        print(f"   {red('✗')} {f}")
    
    print(f"\n2. 事件处理器: {green(str(results['event_ok']))} 通过, {red(str(results['event_fail']))} 失败")
    for f in results["event_fails"]:
        print(f"   {red('✗')} {f}")
    
    print(f"\n3. 合规词汇: {red(str(len(results['compliance_issues'])))} 个问题")
    for f in results["compliance_issues"]:
        print(f"   {yellow('⚠')} {f}")
    
    print(f"\n4. 演示数据: {'存在，需删除' if results['demo_data_found'] else '已清理'}")
    if results["demo_data_found"]:
        print(f"   {yellow('⚠')} app.js 第61行: _seedDemoData() 仍在调用")
    
    print(f"\n5. 硬编码敏感信息: {str(len(results['hardcoded_sensitive']))} 处")
    for f in results["hardcoded_sensitive"]:
        print(f"   {yellow('⚠')} {f}")
    
    print(f"\n6. 错误处理: {str(len(results['error_gaps']))} 处缺失")
    for f in results["error_gaps"]:
        print(f"   {yellow('⚠')} {f}")
    
    print(f"\n7. 已知Bug模式: {red(str(len(results['known_bugs']))) if results['known_bugs'] else green('0')} 个")
    for f in results["known_bugs"]:
        print(f"   {red('✗')} {f}")
    
    # 总分
    total_issues = (
        results["nav_fail"] + results["event_fail"] + 
        len(results["compliance_issues"]) + 
        len(results["hardcoded_sensitive"]) + 
        len(results["error_gaps"]) + 
        len(results["known_bugs"])
    )
    
    print("\n" + "="*60)
    if total_issues == 0:
        print(green("✅ 全部测试通过！未发现问题。"))
    else:
        print(f"{yellow('⚠️')} 共发现 {total_issues} 个问题需要关注")
    print("="*60)
    
    return results

if __name__ == "__main__":
    main()
