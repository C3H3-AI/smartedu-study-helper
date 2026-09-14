# 国家智慧教育公共服务平台 · 暑期教师研修 秒学工具

> Smart Education of China - Summer Teacher Training Auto Completion Tool

支持 **2026年暑期教师研修**（基础教育/职教/高教）的自动完成，半分钟搞定10学时。

## 方法一：Tampermonkey 油猴脚本（推荐，最简单）

### 安装步骤

1. **安装 Tampermonkey 扩展**
   - Chrome 用户：打开 [Chrome 网上应用店](https://chrome.google.com/webstore) 搜索 "Tampermonkey" 安装
   - Edge 用户：打开 [Edge 加载项](https://microsoftedge.microsoft.com/addons) 搜索 "Tampermonkey" 安装

2. **安装脚本**
   - 打开此链接安装：[智慧中小学秒刷.user.js](https://scriptcat.org/scripts/code/7353/%E6%99%BA%E6%85%A7%E4%B8%AD%E5%B0%8F%E5%AD%A6%E7%A7%92%E5%88%B7!!%E5%AE%8C%E5%85%A8%E5%85%8D%E8%B4%B9%E4%B8%80%E9%94%AE%E5%AE%8C%E6%88%90!!%E5%9B%BD%E5%AE%B6%E4%B8%AD%E5%B0%8F%E5%AD%A6%E6%99%BA%E6%85%A7%E6%95%99%E8%82%B2%E5%B9%B3%E5%8F%B0%C2%B72026%E6%9A%91%E6%9C%9F%E6%95%99%E5%B8%88%E7%A0%94%E4%BF%AE%C2%B7%E7%A7%92%E5%88%B7%E5%AD%A6%E4%B9%A0%E5%8A%A9%E6%89%8B.user.js)
   - 或访问 ScriptCat 市场搜索「智慧中小学秒刷」
   - 📦 **本地副本**：仓库内 [smartedu-flash.user.js](smartedu-flash.user.js)（已修复收款码显示问题，可直接安装）

3. **运行**
   - 打开 [https://basic.smartedu.cn/training/2026jjsqpx](https://basic.smartedu.cn/training/2026jjsqpx)
   - 刷新页面，脚本自动运行，半分钟完成10学时

### 特点
- 完全免费，零外链、零GM权限
- 秒刷完成，半分钟学完所有课程
- 直接调用API，不需要实际播放视频
- 自动处理所有课程，共10学时

## 方法二：Python 脚本（适合开发者）

### 使用前提

需要从浏览器中获取以下认证信息（存储在 localStorage 中）：

```json
{
  "access_token": "your_token",
  "mac_key": "your_key",
  "user_id": "your_user_id"
}
```

### 获取方式

1. 登录 [https://www.smartedu.cn](https://www.smartedu.cn)
2. 打开浏览器开发者工具（F12）
3. 在 Console 中运行：
   ```javascript
   var pat = /ND_UC_AUTH-([0-9a-fA-F-]+)&ncet-xedu&token/;
   for (var k in localStorage) {
     var m = k.match(pat);
     if (m) {
       var v = JSON.parse(localStorage.getItem(k));
       var t = typeof v.value === 'string' ? JSON.parse(v.value) : v.value;
       if (t && t.mac_key && t.access_token) {
         console.log(JSON.stringify({
           access_token: t.access_token,
           mac_key: t.mac_key,
           user_id: t.user_id
         }, null, 2));
       }
     }
   }
   ```

### 运行

```bash
pip install requests
python smartedu_instant.py
```

### 主要 API 接口

| 用途 | 方法 | URL |
|------|------|-----|
| 提交学习记录 | POST | `x-study-record-api.ykt.eduyun.cn/v1/study_details` |
| 同步进度 | POST | `elearning-train-gateway.ykt.eduyun.cn/v1/spi/trains/{id}/courses/{courseId}/progress/actions/async` |
| 保存播放位置 | PUT | `x-study-record-api.ykt.eduyun.cn/v1/resource_learning_positions/{resourceId}/{userId}` |

## 认证方式

该平台使用 MAC Token 认证（HMAC-SHA256）：

```
Authorization: MAC id="access_token",nonce="timestamp:random",mac="base64_signature"
```

签名规则：
```
raw = nonce + "\n" + method + "\n" + path + "\n" + host + "\n"
signature = HMAC-SHA256(mac_key, raw)
```

## 💝 赞助

如果这个工具帮到了你，欢迎请我们喝杯咖啡 ☕

| 微信支付 | 支付宝 |
|:--------:|:------:|
| ![微信](sponsor/wechat.jpg) | ![支付宝](sponsor/alipay.jpg) |

## 免责声明

本项目仅供学习研究使用，请勿用于非法用途。使用本工具产生的任何后果由使用者自行承担。